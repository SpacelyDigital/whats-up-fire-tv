import * as React from 'react';
import {act, render} from '@testing-library/react-native';
import {App} from '../src/App';

jest.mock('@amazon-devices/webview', () => ({
  WebView: 'WebView',
}));

jest.mock('@amazon-devices/react-native-kepler', () => ({
  usePreventHideSplashScreen: jest.fn(),
  useHideSplashScreenCallback: jest.fn(() => jest.fn()),
  StyleSheet: {create: (styles: unknown) => styles},
  BackHandler: {addEventListener: jest.fn(() => ({remove: jest.fn()}))},
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_type: string, listener: (s: string) => void) => {
      mockAppState.listener = listener;
      return {remove: jest.fn()};
    }),
  },
  View: 'View',
}));
const mockAppState: {listener: (state: string) => void} = {listener: () => {}};

jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  KeplerVideoSurfaceView: 'KeplerVideoSurfaceView',
  VideoPlayer: jest.fn(),
}));
jest.mock('../src/chime', () => ({playChime: jest.fn(), releaseChime: jest.fn()}));
jest.mock('../src/silentLoop', () => ({
  setSurface: jest.fn(),
  startLoop: jest.fn(() => Promise.resolve()),
  stopLoop: jest.fn(),
}));
const mockLoop = jest.requireMock('../src/silentLoop');
jest.mock('@whatsup/keep-awake', () => ({
  KeepAwake: {start: jest.fn(() => ''), stop: jest.fn(() => '')},
}));
const mockKeepAwake = jest.requireMock('@whatsup/keep-awake').KeepAwake;

describe('App', () => {
  it('renders without crashing', () => {
    const {toJSON} = render(<App />);
    expect(toJSON()).toBeTruthy();
  });

  // The page reports Settings > Keep screen awake through the bridge.
  const sayAwake = (r: ReturnType<typeof render>, on: boolean) =>
    act(() =>
      r.UNSAFE_root.findByType('WebView' as any).props.onMessage({
        nativeEvent: {data: JSON.stringify({type: 'awake', on})},
      }),
    );

  it('holds off the screensaver only while shown AND the switch is on', () => {
    mockKeepAwake.start.mockClear();
    mockKeepAwake.stop.mockClear();
    const r = render(<App />);
    expect(mockKeepAwake.start).not.toHaveBeenCalled(); // off until the page says on
    sayAwake(r, true);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(1);
    act(() => mockAppState.listener('background'));
    expect(mockKeepAwake.stop).toHaveBeenCalledTimes(1);
    act(() => mockAppState.listener('active'));
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2);
    sayAwake(r, false);
    expect(mockKeepAwake.stop).toHaveBeenCalledTimes(2);
    act(() => mockAppState.listener('background'));
    act(() => mockAppState.listener('active'));
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2); // switch off: nothing reported
    r.unmount();
  });

  it('plays the silent loop only while shown and Keep screen awake is on', () => {
    mockLoop.startLoop.mockClear();
    mockLoop.stopLoop.mockClear();
    const r = render(<App />);
    expect(mockLoop.startLoop).not.toHaveBeenCalled();
    sayAwake(r, true);
    expect(mockLoop.startLoop).toHaveBeenCalled();
    act(() => mockAppState.listener('background'));
    expect(mockLoop.stopLoop).toHaveBeenCalled();
    mockLoop.startLoop.mockClear();
    act(() => mockAppState.listener('active'));
    expect(mockLoop.startLoop).toHaveBeenCalled();
    r.unmount();
  });

  it('re-reports engagement every 4 minutes only while active and on', () => {
    jest.useFakeTimers();
    mockKeepAwake.start.mockClear();
    const r = render(<App />);
    jest.advanceTimersByTime(8 * 60 * 1000);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(0);
    sayAwake(r, true);
    jest.advanceTimersByTime(4 * 60 * 1000);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2);
    act(() => mockAppState.listener('background'));
    jest.advanceTimersByTime(8 * 60 * 1000);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2);
    r.unmount();
    jest.useRealTimers();
  });

  // The fetch bridge: the backup positions (api.adsb.lol) only on the 0.05° grid, with the
  // same User-Agent as adsb.fi; any other adsb.lol API URL is refused at once.
  it('fetches the adsb.lol backup feed on the grid with the app User-Agent, nothing else there', async () => {
    const inject = jest.fn();
    const realFetch = global.fetch;
    const realError = console.error;
    console.error = jest.fn();
    const fetchMock = jest.fn(async (url: string, _init: any) => ({
      status: 200,
      url,
      headers: {get: () => null},
      text: async () => '{"ac":[],"now":1}',
    }));
    (global as any).fetch = fetchMock;
    const r = render(<App />, {createNodeMock: () => ({injectJavaScript: inject})});
    const send = async (id: number, url: string) => {
      act(() =>
        r.UNSAFE_root.findByType('WebView' as any).props.onMessage({
          nativeEvent: {data: JSON.stringify({type: 'get', id, url, timeoutMs: 4480})},
        }),
      );
      await act(async () => {
        await new Promise(done => setTimeout(done, 0));
      });
    };
    try {
      await send(1, 'https://api.adsb.lol/v2/lat/39.05/lon/-84.65/dist/18');
      await send(2, 'https://opendata.adsb.fi/api/v3/lat/39.05/lon/-84.65/dist/18');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const agent = (n: number) => fetchMock.mock.calls[n][1].headers['User-Agent'];
      expect(agent(0)).toMatch(/^WhatsUp-FireTV\/\d+\.\d+ \(Spacely Digital; spacelydigital@gmail\.com\)$/);
      expect(agent(0)).toBe(agent(1));
      expect(inject.mock.calls.map(c => c[0]).join('\n')).toContain('__whatsupReply(1,200,');
      const refused = [
        'https://api.adsb.lol/v2/lat/39.0512/lon/-84.65/dist/18',
        'https://api.adsb.lol/v2/mil',
        'https://api.adsb.lol/v2/lat/39.05/lon/-84.65/dist/18?key=x',
        'http://api.adsb.lol/v2/lat/39.05/lon/-84.65/dist/18',
        'https://api.adsb.lol/v2/lat/39.05/lon/-84.65/dist/1000',
      ];
      for (const [i, url] of refused.entries()) {
        await send(10 + i, url);
        expect(inject.mock.calls.at(-1)?.[0]).toContain(`__whatsupReply(${10 + i},"blocked","")`);
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      (global as any).fetch = realFetch;
      console.error = realError;
      r.unmount();
    }
  });
});
