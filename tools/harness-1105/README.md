# QA harness for What's Up (copied from the developer's Mac, November 2026)

Scripts assume `~/whats-up/...` paths and macOS Chrome; set `CHECK_BROWSER` to any Chromium binary.
Runner scripts in `slate/` are records of how the slates were run, not portable tools.

Setup: `npm run build:vendor` (map tests need `vendor/node_modules`), then
`WHATSUP_PROFILE=store WHATSUP_OUT=build/store-assets node scripts/build-web.mjs` (leave out the profile for the
personal build) and `node scripts/dev-server.mjs build/store-assets 8830` (path relative to the repo root).

| Check | Command (PORT = dev server; DSF 2 = 1080, 1.3333 = 720) |
|---|---|
| Unit, Jest | `npm run test:web`, `npx jest` |
| Repo checks | `CHECK_URL=http://127.0.0.1:8830/index.html [CHECK_DSF=2] node scripts/check-{settings-edit,settings-ok,drawn,browse,safe-area,picker-race,adjust-hold,refit}.mjs` |
| Fit | `PORT= DSF= node models2/fitd-p0.mjs '' [long\|longest\|emergency\|quiet]` (personal), `fitd2-p0.mjs` (store) |
| Model-photo fit | `PORT= DSF= HERO=C177\|P28B\|R44 node models2/fitd2-p0.mjs ''` |
| Privacy and QR | `PORT= DSF= EXPECT_LINE='<policy top line>' node models2/priv-p0.mjs ''`; `PORT= node backup-1103/qr-decode.mjs` (needs BarcodeDetector) |
| Consent, credit line | `PORT= BUILD=store node backup-1103/consent-fit.mjs 2`, `credit-fit.mjs 2` |
| Fault matrix | `cd backup-1103; PORT= node runall.mjs cases.txt case.mjs 4 out; python3 -I matrix.py out` |
| Host audits | `PORT= LOG=$PWD/log.json SHOTS=$PWD node backup-1103/s08-backup.mjs` (or `s08-typical.mjs`); `python3 -I backup-1103/audit.py log.json` |
| Busy-cog fuzz | `cd fuzz; seq 9001 9100 \| OUT=out PORT= xargs -P 4 -n 1 ./run-ok.sh`; `python3 -I ../slate/fuzztally.py out` |
| Cog timing | `PORT= QS='&window=90-180-25' node breakit/cog-measure.mjs sectional 6` |
| Erase, old clips | `PORT= node breakit/erase-backup.mjs`, `PORT= node breakit/clips.mjs swiss` |

Live network, so never run these at fleet scale:
- `soak2h.mjs` with `soak-server2.mjs` talks to the real adsb.fi and adsb.lol. One instance at most (adsb.lol answers a 5 s pace with 429s).
- `check-drawn` and `check-settings-edit` use the real geocoder and map tiles through the dev server's proxy.
- `lib.mjs` and the fuzz fetch OpenFreeMap tiles not yet in `./tilecache`: warm one shared cache, never one per agent.
