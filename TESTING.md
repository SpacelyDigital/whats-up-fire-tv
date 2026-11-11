# What's Up — test pass

Where: **D** = desktop (headless Chrome 1920x1080 through `scripts/drive.mjs` / `scripts/shot.mjs`,
the same page and the same app bridge rules via `scripts/dev-server.mjs`), **S** = the Fire TV Stick
(<fire-tv-ip>, Vega OS 2.0, remote keys injected with `inputd-cli`), **U** = automated unit tests.
Result: PASS, FAIL (bug, then what was done), FIXED (failed, fixed, re-tested), PENDING (not run yet, why).

Automated: `npm run test:web` (node, 23 tests) and `npx jest` (3 tests). All pass.

## Location

| Check | Where | Result |
| --- | --- | --- |
| Change location: type CHICAGO, pick Chicago, IL → "Use this location?" visible with focus on *Use this* | D | FIXED. Before: the confirm box opened *under* the location screen (same z-index, earlier in the page), so focus vanished onto an invisible button and OK silently chose it (reproduced on the stick). Screens now stack in opening order. |
| Search with empty entry | D | FIXED. Before: nothing happened. Now: "Type a ZIP or postal code, a city, or a street address first." |
| City only (CHICAGO, LONDON) | D | PASS: list to pick from (Chicago, IL first; London UK / ON / OH). |
| ZIP (45202) | D, U | PASS: Cincinnati, OH first. |
| Full US address (801 Plum St Cincinnati) | D, U | PASS: Census match "801 Plum St, Cincinnati, OH"; time zone looked up with rounded coordinates. |
| Non-US address (10 Downing Street London) | U | PASS: Nominatim fallback, Europe/London. |
| Garbage (XQZVQ) | D | PASS: "No places match “XQZVQ”. Check the spelling, or try a ZIP or postal code." |
| Offline / geocoder down | D | FIXED. Shows "Search is unavailable. Check the connection." with **Try again**, which now takes focus; Try again after reconnecting returns results. A search never waits more than 25 s. |
| Loading state | D | PASS: "Searching for “…”…" (pulsing) on every search. |
| *Search again* from the confirm box | D | PASS: back to the list with focus on the result that was chosen. |
| Back from location → Settings → dashboard | D | PASS. |
| First launch, IP lookup fails | D | PASS: goes straight to Change location ("We couldn’t find your location automatically…"). |
| First launch "Is this right?" Confirm / Change | D | PASS (welcome shown on fresh profiles; Change opens location entry). |
| Bridge refuses a URL not on the allow-list | code | FIXED: now answered at once with "blocked" instead of the page waiting out its timeout. |

## Remote / D-pad

| Check | Where | Result |
| --- | --- | --- |
| Settings: every row reachable, Down past *Done* and Up past *Layout* stay put (no dead end, no focus loss) | D | PASS |
| Focus always visible and inside the top screen (checked after every step) | D | PASS |
| Back closes the top screen; Back on the dashboard leaves the app (handled by the app) | D | PASS |
| Rapid key mashing (OK/Back/arrows, 40 ms apart) | D | PASS: no stuck screen or lost focus. |
| Up/Down on the dashboard = map radius (toast "Map radius 25 mi") | D | PASS |
| Long-press (held arrows) | D | PASS in Adjust position (accelerates); elsewhere repeats as single presses. |
| The same on the stick | S | PENDING (stick asleep, see below) |

## Settings

| Check | Where | Result |
| --- | --- | --- |
| Layout picker: Left/Right live preview, spam 11 presses wraps, Back reverts, OK keeps | D | PASS; only the active layout's code/CSS stay loaded (1–2 stylesheets). |
| Alert radius 1–10, clamps at 10 | D | PASS |
| Map radius 2–250 (2, 5, 10, 15, 25, 50, 100, 150, 250) | D, U | PASS |
| Alert ring wider than the map radius | D, U | PASS: shows "2 mi (the map radius)", ring drawn at the map radius, saved preference kept for wider maps. |
| Distance mi/km, altitude ft/m (labels, speeds, ring labels, scale bars) | D, U | PASS |
| Bad saved values (radius 99, units "parsecs", layout "<script>") | U | PASS: safe defaults. |
| Persistence across force-quit/relaunch and upgrade install | S | PASS for upgrade install: `vpm install --force` kept the saved location (Chicago) and settings. Force-quit/relaunch: PENDING. |

## Layouts (all 11)

| Check | Where | Result |
| --- | --- | --- |
| Busy sky, empty sky, squawk 7700 (demo scenes) | D | PASS for all 11 (contact sheets in `.shots/sc/`). |
| Atlas column: busy and empty | D | FIXED: re-spaced to the full height; Recent hides instead of clipping when a busy hero fills it. |
| Atlas Dark (new, #6) | D | PASS: charcoal map, grey roads, cyan planes, amber hero, readable column. |
| Swiss: gap between number and red rule (1-digit, 2-digit, km) | D | FIXED: gap is now in em, so it scales with the number. |
| Credits: none on the dashboards; one line fades ~5 s after open / layout change / new map; full list in Settings | D | PASS |
| Far cities: London (GMT), Tokyo, Honolulu (previous day), Cape Town | D | PASS: local clock and date correct; coast/ocean maps draw. |
| Map radius 2 mi and 250 mi in every layout | D | PASS after fixes: hard-coded "10 mi" text in Glass, Departures, Night Sky and Swiss now follows the radius; Atlas no longer says "Drawing streets…" when wider than 10 mi. |
| Map tiles: first launch fetches (34 tiles base+detail), relaunch fetches none, a new radius fetches only its own (9 at 50 mi), a new city refetches (Sydney 30) | D | PASS |
| Hundreds of aircraft at 250 mi | D | PASS: nearest 300 drawn, ≤9 labels per layout. On the stick: PENDING. |
| Long callsigns / missing fields (N-numbers, no route, no type) | D | PASS (demo N8UH/N451PA: "Private", "Route not reported"). |
| Memory over ~30 min, layout-switch spam on the stick | S | PENDING |

## Network failures

| Check | Where | Result |
| --- | --- | --- |
| adsb.fi unreachable from launch | D | FIXED: was "Connecting…" forever; after 15 s now "No live data right now. Retrying every few seconds." |
| OpenFreeMap down (no saved map) | D | PASS: live data still shown; map note, retried every 30 s+. |
| ADSB.lol down / 404 / 429 | U | PASS (existing enricher tests: 404 cached as miss, 429 cool-down 15 min). |
| Geocoders down | D | PASS: see Location. |

## Screensaver

| Check | Where | Result |
| --- | --- | --- |
| App reports user engagement while shown (`IKeplerUserEngagementModuleV2::makeVideoPlaybackUserEngagement().start()`), re-reports every 4 min, stops when backgrounded / closed | U | PASS (jest) |
| Screensaver held off while What's Up is in front | S | FIXED with Settings > Keep screen awake (silent native video loop): app in front from 03:05:46 to past 03:24 UTC (18+ min, normal timeout ~5 min) with no screensaver, confirmed by the owner watching; memory steady 339–373 MB available, CPU mostly idle. The engagement API alone failed (screensaver at ~5 min).
| Memory while idle | S | PASS: 405–414 MB available over 5 min on Atlas; 350 MB at 250 mi with ~300 aircraft. |
| 250 mi radius on the stick | S | PASS: ~300 aircraft drawn, stayed responsive. FIXED along the way: the Today/Cargo logbook counted the whole 250 mi area; now always the local 15 NM. |
| Location search with the remote (CHICAGO by D-pad, Search, first match focused, confirm box on top) | S | PASS (screenshots in Vibe Coding/whatsup/tests/). |
| Atlas / Atlas Dark long names | D, S | FIXED: no ellipsis anywhere; operator, type, registration on their own lines; column spread over the full height. |

## Wider-radius map detail (TV, Atlas Dark, 2026-10-28)

| Radius | Detail | Lowest RAM free while building | RAM free after | Result |
| --- | --- | --- | --- | --- |
| 15 mi | full streets (z12, buildings) | 251 MB | 353 MB | PASS |
| 25 mi | mid (z11) | 336 MB | 368 MB | PASS |
| 50 mi | mid (z10) | — | 298 MB | PASS |
| 100 mi | mid (z9) | 261 MB | 355 MB | PASS |
| 150 mi | mid (z8) | 292 MB | 360 MB | PASS |
| 250 mi | mid (z8) | 316 MB | 359 MB | PASS |

Desktop: 16–36 detail tiles per radius, cached 1.1–1.6 MB per wide map; detail drawn within ~5–7 s on desktop, under the 60 s window on the TV at every step. App responsive throughout (Up/Down steps, plane updates). Limit: none needed.

## Later additions (2026-10-28)

| Check | Where | Result |
| --- | --- | --- |
| Window view: wedge membership incl. wrap across north, reach, overhead within 1 mi, saved settings | U | PASS (3 tests) |
| Window view on the TV: the example window ENE 74° → S 175°, 25 mi, which the app pre-fills when you choose Window view; changed with the remote (OK to edit, ‹ › 1°, ▲▼ 10°); wedge drawn; hero says "In your window" | S, D | PASS |
| Settings with 13 rows fits the screen | D, S | PASS after tightening rows |
| Rarest/Farthest/cargo on one line at every radius (Antonov An-124 Ruslan; Frankfurt am Main · 4,310 mi) | D, S | PASS |
| Atlas Satellite at 5/15/50 mi (USGS) and London (Sentinel-2) | S, D | PASS; lowest RAM 253 MB at 50 mi |
| Airports: coded only, ring markers, labels hide under flight tags | D, S | PASS |

## Could not test / notes

* The stick went into standby after its screensaver at 05:59 UTC and stayed asleep until at least
  07:15 UTC; injected keys and app launches do not wake it. The new build (with every fix above) is
  built but not yet installed; the on-stick checks above wait for a real remote press.
* Injected `inputd-cli` key presses may not count as user activity for the idle timer, so idle
  timing on the stick is measured from the last *real* remote press.
