import {WebView} from '@amazon-devices/webview';
import * as React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, BackHandler, View, StyleSheet} from 'react-native';
import {KeepAwake} from '@whatsup/keep-awake';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {setSurface, startLoop, stopLoop} from './silentLoop';
import {playChime, releaseChime} from './chime';
import {
  useHideSplashScreenCallback,
  usePreventHideSplashScreen,
} from '@amazon-devices/react-native-kepler';
import {
  WebViewErrorEvent,
  WebViewMessageEvent,
} from '@amazon-devices/webview/dist/types/WebViewTypes';

// The page (assets/, built from web/) asks the app to fetch for it: adsb.fi
// sends no CORS header, so the WebView cannot read it directly. The other
// services do send CORS headers; they are allowed here as a fallback. Only
// these read-only GETs are reachable through the bridge, each with USER_AGENT.
const ALLOWED = [
  /^https:\/\/opendata\.adsb\.fi\/api\/v3\/lat\/-?\d{1,2}\.\d{2}\/lon\/-?\d{1,3}\.\d{2}\/dist\/\d{1,3}$/,
  // Backup positions, asked only while adsb.fi isn't answering (web/live.mjs).
  /^https:\/\/api\.adsb\.lol\/v2\/lat\/-?\d{1,2}\.\d{2}\/lon\/-?\d{1,3}\.\d{2}\/dist\/\d{1,3}$/,
  /^https:\/\/vrs-standing-data\.adsb\.lol\/routes\/[A-Z0-9-]{2}\/[A-Z0-9-]{2,10}\.json$/,
  /^https:\/\/get\.geojs\.io\/v1\/ip\/geo\.json$/,
  /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=[^&#]{1,200}&count=\d{1,2}&language=en&format=json$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet$/,
  /^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress\?address=[^&#]{1,300}&benchmark=Public_AR_Current&format=json$/,
  /^https:\/\/nominatim\.openstreetmap\.org\/search\?q=[^&#]{1,300}&format=jsonv2&limit=5&addressdetails=1$/,
  /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=-?\d{1,2}\.\d{2}&longitude=-?\d{1,3}\.\d{2}&timezone=auto&forecast_days=1$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet\/[\w.-]+\/\d{1,2}\/\d{1,6}\/\d{1,6}\.pbf$/,
  /^https:\/\/api\.planespotters\.net\/pub\/photos\/(hex\/[0-9a-f]{6}|reg\/[A-Z0-9-]{2,10})$/,
];
const isAllowed = (url: string) => ALLOWED.some(p => p.test(url));
const MAX_BYTES = 2 * 1024 * 1024;
// Names the app and a contact, as Nominatim's and Planespotters' API terms ask.
const USER_AGENT = 'WhatsUp-FireTV/0.1 (Spacely Digital; spacelydigital@gmail.com)';

type Request = {
  type: 'get' | 'ui' | 'awake' | 'chime';
  on?: boolean;
  volume?: number;
  id: number;
  url: string;
  timeoutMs?: number;
  binary?: boolean;
  overlay?: boolean;
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

async function get(
  url: string,
  timeoutMs: number,
  binary: boolean,
): Promise<[number | string, string]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      // No cookies sent or kept: the services get only the request itself.
      credentials: 'omit',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: binary ? '*/*' : 'application/json',
      },
      signal: controller.signal,
    });
    // A redirect may only land on another allowed URL (P2-1).
    if (response.url && response.url !== url && !isAllowed(response.url)) {
      return ['blocked', ''];
    }
    if (response.status !== 200) {
      // Tell the page how long the service asked it to wait (429/503), so it backs off.
      return [response.status, response.headers.get('retry-after') || ''];
    }
    // Refuse an announced oversize body before downloading it (P2-2).
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      controller.abort();
      return ['oversize', ''];
    }
    if (binary) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length > MAX_BYTES
        ? ['oversize', '']
        : [200, base64(bytes)];
    }
    const text = await response.text();
    return text.length > MAX_BYTES ? ['oversize', ''] : [200, text];
  } catch {
    return ['connection_error', ''];
  } finally {
    clearTimeout(timer);
  }
}

// While the app is on screen it is a display people glance at, not a menu: tell
// Vega the user is engaged (User Engagement API, via native/keep-awake) so the
// screensaver stays away, and give that up as soon as the app leaves the screen.
const REASSERT_MS = 4 * 60 * 1000;
function engage(on: boolean) {
  try {
    const error = on ? KeepAwake.start() : KeepAwake.stop();
    if (error) {
      console.error(`[keep-awake] ${on ? 'start' : 'stop'}: ${error}`);
    }
  } catch (e) {
    console.error(`[keep-awake] ${String(e)}`);
  }
}

export const App = () => {
  const webRef = useRef<any>(null);
  // True while the page shows Settings or the location screen: Back closes it.
  const overlayRef = useRef(false);
  // Settings > Keep screen awake (the page reports it on load and when it changes; off
  // until it says otherwise).
  const [awake, setAwake] = useState(false);
  const [active, setActive] = useState(AppState.currentState !== 'background');
  // Keep the splash screen up until the page has loaded.
  usePreventHideSplashScreen();
  const hideSplashScreenCallback = useHideSplashScreenCallback();

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setActive(state === 'active');
      // The page pauses all polling while the app is not shown (and resumes on return).
      webRef.current?.injectJavaScript(
        `window.__whatsupActive&&window.__whatsupActive(${state === 'active'});true;`,
      );
    });
    return () => sub.remove();
  }, []);

  // The user-engagement report holds off the screensaver, so it runs only while the app is
  // shown AND Settings > Keep screen awake is on. Re-reported every few minutes: the
  // platform may let a single long-running report lapse (seen on the stick after ~15-20 min).
  useEffect(() => {
    if (!(awake && active)) {
      return;
    }
    engage(true);
    const timer = setInterval(() => {
      engage(false);
      engage(true);
    }, REASSERT_MS);
    return () => {
      clearInterval(timer);
      engage(false);
    };
  }, [awake, active]);

  // The silent loop plays only while the app is shown and the switch is on.
  useEffect(() => {
    if (awake && active) {
      startLoop();
    } else {
      stopLoop();
    }
  }, [awake, active]);
  useEffect(
    () => () => {
      stopLoop();
      releaseChime();
    },
    [],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!overlayRef.current) {
        return false;
      }
      webRef.current?.injectJavaScript(
        'window.__whatsupBack&&window.__whatsupBack();true;',
      );
      return true;
    });
    return () => sub.remove();
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let request: Request;
    try {
      request = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (request?.type === 'chime') {
      if (AppState.currentState !== 'background') {
        playChime(Number(request.volume) || 0.55);
      }
      return;
    }
    if (request?.type === 'awake') {
      setAwake(request.on !== false);
      return;
    }
    if (request?.type === 'ui') {
      overlayRef.current = request.overlay === true;
      return;
    }
    if (
      request?.type !== 'get' ||
      !Number.isInteger(request.id) ||
      typeof request.url !== 'string'
    ) {
      return;
    }
    // Answer a refused URL at once, so the page never waits out its timeout.
    if (!isAllowed(request.url)) {
      // The host only: a refused geocoder URL could carry a typed address (P2-4).
      console.error(`[bridge] refused ${(/^https?:\/\/([^/?#]+)/.exec(request.url) || [])[1] || 'non-http URL'}`);
      webRef.current?.injectJavaScript(
        `window.__whatsupReply&&window.__whatsupReply(${request.id},"blocked","");true;`,
      );
      return;
    }
    const timeoutMs = Math.min(
      12000,
      Math.max(1000, Number(request.timeoutMs) || 8000),
    );
    get(request.url, timeoutMs, request.binary === true).then(
      ([status, text]) => {
        webRef.current?.injectJavaScript(
          `window.__whatsupReply&&window.__whatsupReply(${
            request.id
          },${JSON.stringify(status)},${JSON.stringify(text)});true;`,
        );
      },
    );
  }, []);

  return (
    <View style={styles.container}>
      {awake && active ? (
        <View style={styles.loop}>
          <KeplerVideoSurfaceView
            style={styles.loop}
            onSurfaceViewCreated={(handle: string) => setSurface(handle)}
            onSurfaceViewDestroyed={() => setSurface(null)}
          />
        </View>
      ) : null}
      <WebView
        ref={webRef}
        style={styles.webview}
        domStorageEnabled
        hasTVPreferredFocus
        javaScriptEnabled
        mixedContentMode="never"
        source={{uri: 'file:///pkg/assets/index.html'}}
        onMessage={onMessage}
        onLoad={() => hideSplashScreenCallback()}
        onError={({
          nativeEvent: {code, url, description},
        }: WebViewErrorEvent) => {
          console.error(`[onError]: (${code}: ${url}) ${description}`);
          hideSplashScreenCallback();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#000'},
  webview: {backgroundColor: '#000'},
  // 2 px in the bottom-left corner, under the page: the silent loop's video surface.
  loop: {position: 'absolute', left: 0, bottom: 0, width: 2, height: 2},
});
