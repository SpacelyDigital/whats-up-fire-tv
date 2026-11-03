# What's Up for Fire TV (Vega OS)

A "what's flying over me" display for Fire TV (Vega OS), for anywhere, in twelve layouts.
Includes MIT-licensed code by Alex Miller; see `THIRD_PARTY_NOTICES.md`. By Spacely Digital (spacelydigital@gmail.com). Package id `com.spacelydigital.whatsup`.

* **Location.** First launch looks up an approximate location from the IP address (GeoJS:
  the Vega SDK has a geolocation interface, but only as native C++ IDL with no JS package)
  and shows "Watching the sky over <City, ST>" with *Change location*. Change location is an
  on-screen keyboard for the remote: type a ZIP/postcode or city, pick a result (Open-Meteo
  geocoding, which also gives the time zone). Saved on the device.
* **Precise location.** The IP guess is shown as "Is this right?" with the lookup's claimed
  accuracy and a warning that it is often off by 10+ miles. Change location also takes a full
  street address (press Search): US Census geocoder for US addresses, else Nominatim, and the
  match is shown back before it is used. *Adjust position* (Settings, or from the match) shows a
  close-up street map (OpenFreeMap z13) and the remote's arrows move the home dot ~50 m a press
  (faster when held); OK saves. Exact coordinates stay on the device: adsb.fi (and adsb.lol, as a backup) gets them rounded
  to 2 decimals (~1 km; the 15 NM query loses nothing), the time-zone lookup the same, the
  geocoders only the typed text, and map tiles only the z10/z12/z13/z14 tile area.
* **Settings** (press Select on the dashboard): layout, location, alert radius 1–10 mi, map
  radius 2–250 mi (also Up/Down on the dashboard; the alert ring never exceeds it),
  keep screen awake (on by default: a silent, invisible 10 s loop in Vega's native player
  holds off the screensaver while the app is shown; see `src/silentLoop.ts` before an Appstore build),
  distance mi/km (speed kt or km/h), altitude ft/m. Back closes.
* **Layouts.** Settings > Layout opens a bar over the live dashboard: left/right switch
  layouts on the spot, OK keeps one, Back goes back to the saved one. 1 Atlas Dark (default), 2 Atlas Light (full city map), 3 Atlas Satellite (USGS / Sentinel-2
  imagery), 4 Radar (green phosphor scope), 5 Glass, 6 Departures (split-flap board), 7 Blueprint,
  8 Swiss (poster), 9 Synthwave, 10 Sectional (VFR chart), 11 Cockpit (navigation display), 12 Night Sky. Each picks its own fields, colours, fonts and map style, handles an
  empty sky and shows squawk 7500/7600/7700 in its own style. Data and map credits show for
  ~5 s (on open, layout change and a new location's map), then fade; Settings lists them in full.
  Only the chosen layout's code, stylesheet and font are loaded.
* **Maps.** Built on the device for any location from OpenMapTiles vector tiles
  (OpenFreeMap), decoded with @mapbox/vector-tile + pbf. Every layout has the base map
  (z10, the 10-mile area: water, rivers, motorways, runways, airport codes, town names;
  4–9 tiles, ~30 KB saved). Layouts that draw streets also get a detail map, built the first
  time one is chosen: z12 tiles over ~6.5 mi (every road class, rail, waterways, landuse,
  parks, aeroways, place names) plus z14 buildings within ~1.3 mi, delta-encoded (~1.3 MB
  saved in localStorage, decoded to Int16Arrays). Both are reused for 30 days. Maps are
  painted once onto a canvas; aircraft are an SVG/DOM layer on top.
* **Display.** Hero target (route, progress, altitude/vertical speed, speed, look-up
  direction and elevation, closest approach, type, registration), cargo tonight by operator
  (callsign prefixes worldwide; Amazon Air by owner), today's logbook, recently above,
  and a red takeover on squawk 7500/7600/7700. Airports come from the map data.
* **Plane browsing.** Left/Right on the dashboard step through the planes on the map, closest
  first (Right from the hero outward, wrapping round); the chosen plane takes the main card
  ("Plane 3 of 9 · 4.2 mi NE") and its map mark. Back, a minute without Left/Right, the plane
  leaving the map or an emergency squawk give the card back to the hero. Its photo and route are
  looked up only once it has stayed on the card about a second (`web/browse.mjs`).
* **Store build.** Draws the whole screen at 90%, centred, so no text sits in the outer 5% of
  any edge (TV overscan); the personal build fills the screen (`web/profile.mjs`).
* **Backup feed.** While adsb.fi isn't answering (two failed polls in a row, or 15 s of
  failures), positions come from adsb.lol (`api.adsb.lol/v2`): the same rounded point, radius
  and interval, never on the same poll as adsb.fi. adsb.fi is checked about once a minute
  (respecting its back-off) and takes over again with its first good reply; an adsb.lol 429
  or other 4xx pauses it 15 minutes. The credit line names adsb.lol while it's in use. Both
  builds (`web/live.mjs`).

## Code

* `web/` the page. `app.mjs` (data, Settings and location screens, Adjust position, layout
  picker and loader), `kit.mjs` (what layouts share: units, plane shapes, map painter, label
  placement, credits), `layouts/<id>.mjs` + `layouts/<id>.css` (one per layout, see the
  contract at the top of `kit.mjs`), `model.mjs` (enrichment, cargo, logbook, demo),
  `mapgen.mjs` (vector tiles → base and detail maps), `place.mjs` (IP location, geocoding,
  settings), `live.mjs` (adsb.fi, adsb.lol backup positions, ADSB.lol routes), `mvt.js` (bundled vector-tile
  decoder, rebuild with `npm run build:vendor`), `fonts/` (OFL fonts, Latin subsets).
* `scripts/build-web.mjs` joins the shared modules into `assets/whatsup.js` (ES modules don't
  load from `file:///pkg/assets/`) and turns each layout into `assets/layouts/<id>.js`, which
  the page loads with a script tag when that layout is chosen and drops when another is.
* `src/App.tsx` the Vega app: a full-screen WebView plus a fetch bridge (adsb.fi sends no CORS
  header) limited to the allow-listed GET URLs, and the remote's Back button (closes a screen,
  else leaves the app).

```sh
npm install
npm run test:web                 # route selection, cargo brands, place labels, map from a real tile
node tests/smoke-live.mjs 41.88 -87.63 30   # live APIs from Node at a lat/lon
npm run serve                    # http://127.0.0.1:8767/  (?demo=1[&scene=emergency|quiet], ?q=London,
                                 #  ?layout=atlas, ?units=metric, ?screen=settings|picker|welcome|adjust,
                                 #  ?screen=locate&typed=CHICAGO, ?reset=1)
node scripts/dev-server.mjs web 8770   # the same from web/ as ES modules, no build step
node scripts/shot.mjs "http://127.0.0.1:8767/?q=Chicago" out.png 25000   # 1920x1080 via Chrome
npm run build:release            # -> build/armv7-release/whatsup_armv7.vpkg (and aarch64, x86_64)
vega run-app build/armv7-release/whatsup_armv7.vpkg com.spacelydigital.whatsup.main -d <fire-tv-ip>:5555
```

Before shipping beyond personal use: adsb.fi's open data is personal/non-commercial, and
Open-Meteo's free tier is non-commercial; see `THIRD_PARTY_NOTICES.md`.
