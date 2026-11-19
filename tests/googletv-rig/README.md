# Google TV test rig

Tests the page as the Google TV app (`android/`) shows it, without a TV: headless Chromium (Playwright)
set up as the Android app around the page. The comment at the top of `rig.mjs` lists exactly what it
copies from the app: how `PageFiles.kt` serves the page, `Bridge.kt`'s messages, `Net.kt`'s allow-list
and answers, `MainActivity.kt`'s six network threads, keys and lifecycle, and a TV-sized mobile viewport
(Android's web view widens the layout viewport to overflow; desktop mode does not show that).

The Fire TV app's equivalent of the Android shell is `src/App.tsx`.

## Run it

Needs Node 20 or later and Playwright with its Chromium. Playwright is not one of the repository's
dependencies:

```sh
npm install -g playwright && npx playwright install chromium
export NODE_PATH="$(npm root -g)"
sh tests/googletv-rig/build.sh          # page builds -> tests/googletv-rig/pages/
node tests/googletv-rig/smoke.mjs       # the rig's self-test (about a minute), screenshots in out/smoke/
```

`build.sh [repo] [outdir]` builds five variants of the page as the app's Gradle build makes them:
`personal` (the personal APK), `store` (Google Play), `store-hidden` (store with the tip QR and Keep
screen awake switched off), and `personal-dev` and `store-dev` with the developer URL hooks on
(`?demo=1&scene=busy|long|longest|emergency|quiet&still=1&layout=<id>&screen=settings|picker|welcome|adjust|locate&typed=CHI&map=50&units=metric&window=90-180-25&edge=1..10&q=London&reset=1`).
Release variants ignore URL hooks: drive them with keys, or seed localStorage.

```js
import {launch,sleep,DEVICES,PLACES,savedPlace,SERVICES,ALLOWED,START} from './rig.mjs';
const app=await launch({
  variant:'personal',          // a folder in pages/ (see above)
  device:'tv-1080',            // DEVICES: tv-1080 960x540@2 (default), tv-720, hd-240 1280x720@1.5, mdpi-1080 1920x1080@1, 4k-640, 4k-480, odd-1366, odd-544; or {w,h,dsf}
  consent:true,                // false: first run; or a stored record {v,at}
  place:'CHICAGO',             // a PLACES key, a saved place object (savedPlace(PLACES.X)), or null (no place: first run asks)
  settings:{layout:'radar'},   // merged into whatsup.settings.v1 (place/confirmed come from `place`)
  storage:{key:value},         // any other localStorage (strings stored as-is, objects JSON'd)
  feed:'normal',               // normal | busy (80) | empty | one | emergency | weird (bad data, XSS strings) | chicago (real snapshot) | (lat,lon,nowMs)=>ac[]
  ipPlace:PLACES.CHICAGO,      // what GeoJS answers (null: no city)
  faults:{feed:'offline'},     // per service, see setFault
  locale:'en-US', timezone:'America/Chicago', // the TV's
  clockOffsetMs:0,             // the TV clock's error (Date only; performance.now stays true); setClock(ms) later
  fakeDate:true,               // false to use Playwright's page.clock instead (install it in beforeLoad)
  cpuThrottle:0,               // CDP CPU slow-down factor (a TV is several times slower than a desktop)
  sdk:31,                      // kept for old scripts: since 0.1.3 Back on the main screen moves the app to the background on every version
  out:'<folder>',              // screenshots and logs (default: out/run in this folder)
  beforeLoad:async(page,app)=>{}, noLaunch:false, warnings:false, trace:false,
});
```

- `app.page` (changes after a crash: always read it fresh), `app.context`, `app.cdp` (CDP session of the current page).
- Pages: `pagesDir` (or `RIG_PAGES`) picks another build folder, e.g. one built by `sh build.sh <repo> <outdir>`
  from another checkout; `query` adds URL hooks (dev variants).
- Erase all data: the page's `erase` message is counted in `app.erased` and clears the browser cache, as the
  app's `clearCache(true)` does.
- Keys: `await app.key('ArrowUp'|'ArrowDown'|'ArrowLeft'|'ArrowRight'|'Enter'|'MediaPlayPause'|'1'|..., {holdRepeats:n, gap:ms})`
  (Enter is the remote's OK), `app.back()` (returns 'page' | 'exit' | 'ignored'), `app.menu({holdRepeats})`, `app.home()`,
  `app.returnToApp()` (from the launcher: resume, or a fresh onCreate after a finish/kill), `app.crash()` (the page's
  render process dies; the app makes the web view again), `app.killProcess()` (the whole app process dies in the background).
- While the app is off screen (after `home()` or a Back exit) the page's scripts are held (a debugger pause, like
  pauseTimers): `app.ev()` waits until the app returns, with a 10 s limit. Call `returnToApp()` first.
- State: `app.overlay` (the app's Back flag from the page's `ui` messages), `app.wantsAwake`, `app.keepScreenOn`,
  `app.resumed`, `app.started`, `app.exits`, `app.losses`, `app.finished`, `app.log` (every bridge request with
  svc/url/status/ms/queued/hidden, direct picture loads, ui/awake/chime messages, keys, lifecycle), `app.errors`
  (page exceptions and console errors), `app.requests(svc,t0,t1)`.
- Faults: `app.setFault(svc|'all'|[svcs], mode, {retryAfter, partial:0..1, delayMs, location})`; `app.clearFaults()`.
  Services: feed (adsb.fi), backup (adsb.lol positions), routes, psapi (photo lookup), psimg (photo pictures, loaded
  by the web view itself), tilejson, tiles, usgs, eox (imagery, web view), omsearch, omforecast, census, nominatim,
  geojs. Modes: ok, offline, refuse, sNNN (any HTTP status; Retry-After from retryAfter), timeout (stalls to the
  deadline), slow:<ms>, slowbody:<ms>, noreply (never answered: not something the real app does), garbage, portal,
  empty, redirect (to a host off the list: 'blocked'), redirect-ok, redirect-loop, oversize, big, bom, badutf8.
- Looking: `await app.screen()` gives {layers (open screens, top last), top, adjusting, busy, focused, hasPlace, layout, edge,
  stage {scale,cx,cy,w,h}, viewport {innerW,innerH,clientW,clientH,scrollW,scrollH}, text, notes};
  `await app.check({allowExits})` lists broken invariants (page errors, viewport widened, page scrolls, stage scale or
  centre wrong, Back flag inconsistent with what's open, requests refused or off the list, page files missing,
  requests while off screen, Back leaving the app); `app.shot(name)`; `app.metrics()` (CDP Performance.getMetrics);
  `app.ev(fn,arg,ms)`; `app.waitFor(fn,ms)`; `app.saveLog(name)`; `await app.close()` (always).

Keep `rig.mjs` in step with the app: when `android/` changes how it serves the page, answers a message or
handles a key, change the rig the same way.

## Known limits (not bugs in the app)

- Every map tile is the same fixture tile (`tests/fixtures/cincinnati-10-271-391.pbf`), so roads and place labels
  on the maps are meaningless.
- Imagery is a flat green PNG; every photo is one JPEG (`web/models/A20N.jpg`).
- `app.check()`'s Back-flag rule can't see plane browsing (Left/Right on the dashboard steps through planes; the page
  then catches Back until browsing ends, after about a minute). Set `app.maybeBrowsing=true` while browsing.
- Replies take about 25 ms unless a fault says otherwise; a real TV is slower, and its rendering cost is not this
  machine's.

## Deliberate behaviour (not bugs)

- The first-run "Is this right?" card focuses Change, not Confirm.
- Back presses within 350 ms of the last one are dropped by the page (Fire TV reports one press twice).
- Back on the consent screen, and on the first search screen when no place is saved yet, leaves the app.
- Both builds fill the screen. Settings > Screen edges (1%, the default, up to 10%) draws the stage 1% further in from
  every edge per step (n% gives 1 - 2(n-1)/100 of the screen) for a TV that cuts off the edges; `app.check()` expects
  the saved value.
- Media keys (Play/Pause etc.) are ignored by the page on purpose (left to the system).
- Measured on a TV and accepted: Radar's sweep and Night Sky's twinkle cost about a third of a core; Cockpit's
  picker "Back cancel" wraps to two lines.
- Accepted in the Fire TV review: a feed `now` up to 365 days ahead is accepted; US addresses without a street type
  for state codes that are also country codes; an in-flight route lookup is lost on restart; the ledger's `same()`
  never matches route rows; launch reads big map strings; paintEdge calls getComputedStyle on every draw; the ledger
  makes a JSON round trip on restart.

## The Fire TV page checks without a network

`scripts/check-*.mjs` drive the page through `scripts/dev-server.mjs`, which fetches the real services. Where those
are blocked, or offline, serve the build with `node scripts/offline-server.mjs assets 8767` instead: the same page
serving and bridge shim, with every allowed URL answered from `tests/fixtures` (feed: the Chicago snapshot with its
clock moved to now; search: canned Open-Meteo answers; map: the one fixture tile; photo lookups: none).
