import {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';

// Keep screen awake (Settings): Vega holds off its screensaver only while real
// audio/video plays, and the User Engagement report alone doesn't count for an app
// like this. So while the app is on screen and the switch is on, Vega's own player
// loops a 10 s clip of black frames with silent audio (assets/media/keep-awake.mp4,
// 9 KB), drawn into a 2 px surface in a corner.
// For an Appstore build, turn the switch off by default or drop this file: faking
// playback to defeat the screensaver may not pass review.
export const SILENT_LOOP_URL = 'file:///pkg/assets/media/keep-awake.mp4';

// The loop is not media: it must not appear in the system's media controls or be paused
// by them. w3cmedia registers every player with a legacy Player Session unless the
// (unexported) MediaPlayer.isPlayerSessionEnabled is false; switch it off on the class in
// VideoPlayer's prototype chain that owns it. The app plays no other video. The chime's
// AudioPlayer shares the flag and needs no media controls either.
function noPlayerSession() {
  try {
    for (let c: any = VideoPlayer; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
      if (Object.prototype.hasOwnProperty.call(c, 'isPlayerSessionEnabled')) {
        c.isPlayerSessionEnabled = false;
        return;
      }
    }
  } catch {
    // older or newer library: leave it as it is
  }
}

let player: VideoPlayer | null = null;
let starting: Promise<void> | null = null;
let surface: string | null = null;
let wanted = false; // a stop that lands while the player is still starting wins

export function setSurface(handle: string | null) {
  surface = handle;
  if (player && handle) {
    player.setSurfaceHandle(handle);
  }
}

export function startLoop(): Promise<void> {
  wanted = true;
  if (player) {
    return Promise.resolve();
  }
  if (!starting) {
    starting = (async () => {
      noPlayerSession();
      const p = new VideoPlayer();
      await p.initialize();
      p.muted = true;
      p.loop = true;
      p.src = SILENT_LOOP_URL;
      if (surface) {
        p.setSurfaceHandle(surface);
      }
      if (!wanted) {
        await p.deinitialize();
        return;
      }
      player = p;
      await p.play();
    })()
      .catch(e => {
        console.error(`[silent-loop] start: ${String(e)}`);
        stopLoop();
      })
      .finally(() => {
        starting = null;
      });
  }
  return starting;
}

export function stopLoop() {
  wanted = false;
  const p = player;
  player = null;
  if (!p) {
    return;
  }
  try {
    p.pause();
  } catch {
    // already stopped
  }
  p.deinitialize().catch(e =>
    console.error(`[silent-loop] stop: ${String(e)}`),
  );
}
