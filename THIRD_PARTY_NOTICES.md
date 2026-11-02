# Third-party notices

What's Up is published by Spacely Digital (spacelydigital@gmail.com).

Portions (adsb.fi selection logic, ADSB.lol route matching in `web/live.mjs`, `web/core.mjs`,
`web/routes.mjs`, the aircraft type table and aircraft silhouettes) are adapted from
https://github.com/alexlmiller/overhead, Copyright (c) 2026 Alex Miller, MIT License; the
full copyright and permission notice is in `LICENSE`.

The MIT license covers this project's code, not third-party services, fonts, datasets,
trademarks or imagery.

## Bundled

- **Fonts** (`web/fonts/*.woff2`), all SIL Open Font License 1.1, subset to Latin with
  fontTools (Inter pinned to opsz 32, EB Garamond to wght 400-600). License texts sit beside
  each font (`web/fonts/*-OFL.txt`). Sources: [google/fonts](https://github.com/google/fonts/tree/main/ofl)
  (JetBrains Mono, Michroma, Barlow Condensed, B612 Mono, Orbitron, EB Garamond) and
  [rsms/inter](https://github.com/rsms/inter) (Inter). Used by: JetBrains Mono (Radar,
  shared screens), Michroma (Glass), Inter (Swiss, Atlas and others), Barlow Condensed
  (Blueprint, Sectional), B612 Mono (Cockpit), Orbitron (Synthwave), EB Garamond (Night Sky).
- **@mapbox/vector-tile 2.0.5 and pbf 4.0.2** (`web/mvt.js`, bundled by `vendor/`):
  BSD-3-Clause, © Mapbox.
- **qrcode-generator 2.0.4** (`web/qr.js`, bundled by `vendor/`): MIT, © Kazuhiko Arase. Draws the
  QR codes that link each Planespotters photo to its page.
- **Aircraft silhouettes** (`web/silhouettes.mjs`): drawn for this app.
- **Aircraft types** (`web/aircraft-types.mjs`): factual manufacturer/model data from
  [ICAO Doc 8643](https://doc8643.icao.int/), via the MIT-licensed project above.
- **Map tile fixture** (`tests/fixtures/*.pbf`): one OpenFreeMap tile, used only by tests.
  © OpenMapTiles © OpenStreetMap contributors (ODbL).

## Services used at runtime (no keys, nothing bundled)

| Service | Used for | Terms to keep in mind |
| --- | --- | --- |
| [adsb.fi](https://github.com/adsbfi/opendata) open data | aircraft positions, polled every 5 s | personal, non-commercial use with attribution; max 1 request/s. **Commercial distribution needs a different feed or permission.** Shown on screen. |
| [ADSB.lol](https://www.adsb.lol/) standing data | flight routes, ≤1 request per 5 s, cached | ODbL data; attribution shown on screen. |
| [OpenFreeMap](https://openfreemap.org/) vector tiles (OpenMapTiles schema) | the maps, fetched once per location and saved on the device: 4–9 tiles at z10 for every layout; the street-detail layouts add ~16 tiles at z12 and ~9 at z14 (buildings near home) | free, no key, commercial use OK; attribution required and shown: "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors". |
| [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api) | ZIP/postcode or city search, time zone | free for non-commercial use under 10,000 calls/day; commercial use needs an Open-Meteo API subscription. Data from GeoNames (CC BY 4.0). |
| [US Census Geocoder](https://geocoding.geo.census.gov/) | US street addresses (one request per Search) | free, no key, public-domain US government service. |
| [Nominatim](https://nominatim.org/) (OpenStreetMap) | non-US street addresses and postcodes Open-Meteo misses | [usage policy](https://operations.osmfoundation.org/policies/nominatim/): at most 1 request/s, one request per explicit Search (never autocomplete), identifying User-Agent (set by the app bridge); ODbL, © OpenStreetMap contributors. Heavy or commercial use should move to a self-hosted or paid geocoder. |
| [Open-Meteo forecast API](https://open-meteo.com/) | time zone and elevation for a geocoded address, queried with coordinates rounded to 2 decimals | same non-commercial terms as Open-Meteo geocoding. |
| [Planespotters.net photo API](https://www.planespotters.net/photo/api) | a photo of the aircraft on screen (Atlas layouts), looked up by hex/registration | free, no key; [API terms](https://www.planespotters.net/photo/api): photographer credit next to the photo, link back to the photo page (on a TV: an on-screen QR code, which the app shows), images fetched directly and not stored, URLs unchanged, identifying User-Agent with contact, no AI training. Free public API with no stated commercial grant: **ask Planespotters before a paid release.** |
| [GeoJS](https://www.geojs.io/) | first-launch approximate location from the IP address | free, no key, "no rate limits (yet)"; data from MaxMind GeoLite2 (attribution: "includes GeoLite2 data created by MaxMind"). |

Airline names identify flights and belong to their owners; no logos are bundled.

## Model photos (`web/models/*.jpg`)

Shown as "Typical <model>" when there is no photo of the aircraft itself. From Wikimedia Commons,
resized to 240 px; author and license are also shown on screen with each photo.

| Type | Model | Author | License | Source |
| --- | --- | --- | --- | --- |
| A319 | Airbus A319 | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Germanwings_Airbus_A319-112_D-AKNP_STR_2016_01.jpg |
| A320 | Airbus A320 | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Lufthansa_Airbus_A320-211_D-AIQT_01.jpg |
| A321 | Airbus A321 | Adrian Pingstone | Public domain | https://commons.wikimedia.org/wiki/File:Middle_East_Airlines_A321-200_(F-ORMF)_landing_at_London_Heathrow_Airport.jpg |
| A21N | Airbus A321neo | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:China_Airlines_Airbus_A321neo_B-18102_departing_Taoyuan_February_2026.jpg |
| A20N | Airbus A320neo | Flywithnoe | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Airbus_A320Neo_Transavia.jpg |
| A332 | Airbus A330-200 | Adrian Pingstone | Public domain | https://commons.wikimedia.org/wiki/File:Bmi.a330-200.g-wwbb.arp.jpg |
| A333 | Airbus A330-300 | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:EVA_Air_Airbus_A330-300_B-16331_departing_Taoyuan_February_2026_1.jpg |
| A339 | Airbus A330-900 | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Delta_Airbus_A330-900_N402DX_departing_Boston_June_2025_2.jpg |
| A359 | Airbus A350-900 | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Airbus_A350-941_F-WWCF_MSN002_ILA_Berlin_2016_17.jpg |
| A35K | Airbus A350-1000 | Clemens Vasters from Viersen, Germany,… | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Airbus_A350-1000_(34598951684).jpg |
| A388 | Airbus A380 | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Emirates_Airbus_A380-861_A6-EER_MUC_2015_01.jpg |
| A306 | Airbus A300-600F | N.C (Wikimedia Commons user; file page says "self made") | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:MU_A300B4-605RPtoF_B-2306_1.jpg |
| B712 | Boeing 717 | Alf van Beem | CC0 | https://commons.wikimedia.org/wiki/File:OH-BLG_Blue1_Boeing_717-2CM_-_cn_55059_taxiing,_25august2013_pic-005.JPG |
| B737 | Boeing 737-700 | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Southwest_Airlines_Boeing_737-700_N953WN_departing_Boston_June_2025.jpg |
| B738 | Boeing 737-800 | Alf van Beem | Public domain | https://commons.wikimedia.org/wiki/File:Boeing_737-800_PH-BCA_KLM_takeoff_at_Schiphol.JPG |
| B739 | Boeing 737-900 | AlfvanBeem | CC0 | https://commons.wikimedia.org/wiki/File:Boeing_737-900_KLM_PH-BXP.jpg |
| B38M | Boeing 737 MAX 8 | DavidivardiIL | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:DAV_2777-Ryanair_Boeing_737_MAX_8-200_SP-RZM.jpg |
| B39M | Boeing 737 MAX 9 | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:United_Airlines_Boeing_737-9_MAX_N17583_departing_Boston_July_2026.jpg |
| B752 | Boeing 757-200 | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:United_Boeing_757-200_N19136_planform_view.jpg |
| B753 | Boeing 757-300 | Mark Harkin | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:TF-ISX_Boeing_757-300_Icelandair_(44139300214).jpg |
| B763 | Boeing 767-300 | Oleg Yunakov | CC0 | https://commons.wikimedia.org/wiki/File:Boeing_767-300ER_-_Delta_Air_Lines_-_N198DN.jpg |
| B764 | Boeing 767-400 | Mark Harkin | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:N826MH_Boeing_767-400_Delta_(9467285812).jpg |
| B772 | Boeing 777-200 | Aaron Davis | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:British_Airways_Boeing_777-200ER_G-VIIP.jpg |
| B77W | Boeing 777-300ER | tjdarmstadt | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:China_Airlines_(Boeing_livery)_Boeing_777-300ER_(B-18007)_at_Frankfurt_Airport.jpg |
| B77L | Boeing 777F | Steve Knight | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:B-226C_Boeing_777F_China_Southern_Cargo_Halstead_250925.jpg |
| B788 | Boeing 787-8 | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Qatar_Airways_Boeing_787-8_Dreamliner_A7-BCO_MUC_2015_02.jpg |
| B789 | Boeing 787-9 | Masahiro TAKAGI from Ichikawa, Chiba,… | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:All_Nippon_Airways_Boeing_787-9_(JA871A)_at_Tokyo_Haneda_Airport.jpg |
| B78X | Boeing 787-10 | jounigripen | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Etihad_Boeing_787-10_A6-BMI_EcoDemonstrator.jpg |
| B744 | Boeing 747-400 | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Thai_Airways_International_Boeing_747-4D7_HS-TGP_MUC_2015_03.jpg |
| B748 | Boeing 747-8F | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Atlas_Air_Boeing_747-8F_departing_Taoyuan_February_2026.jpg |
| MD11 | McDonnell Douglas MD-11F | Kambui | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Lufthansa_Cargo_McDonnell_Douglas_MD-11F_D-ALCK_(25157042382).jpg |
| DC10 | McDonnell Douglas DC-10 | spaceaero2 | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Finnair_McDonnell_Douglas_DC-10-30_Moomin_collar.jpg |
| CRJ2 | Bombardier CRJ200 | lasta29 | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:J-Air,_CRJ-200,_JA209J_(17165929830).jpg |
| CRJ7 | Bombardier CRJ700 | Colin Brown | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:N659CA_-_Bombardier_CRJ-700_-_Delta_Connection_at_Nashville_International_-_June_5,_2012.jpg |
| CRJ9 | Bombardier CRJ900 | Reinhard Zinabold | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:N932XJ_(Delta_Conn._-_Endeavor_Air)_at_Toronto_Lester_B._Pearson_Airport_20241005.jpg |
| E135 | Embraer ERJ 135 | Nuiteux731 | CC0 | https://commons.wikimedia.org/wiki/File:Embraer_ERJ_135_de_Lorizon_Aircraft_F-HSTE_%C3%A0_l%27A%C3%A9roport_de_Lorient.jpg |
| E145 | Embraer ERJ 145 | Tisch1234 | CC0 | https://commons.wikimedia.org/wiki/File:Embraer_ERJ-145_of_Amelia_International_(F-HRAM)_at_M%C3%BCnster_Osnabr%C3%BCck_Airport.png |
| E170 | Embraer 170 | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:DeltaConnection_Embraer_170_N880RW_on_final_approach_to_Boston_December_2025.jpg |
| E75L | Embraer 175 | Alexis Doine | CC0 | https://commons.wikimedia.org/wiki/File:N238JQ_Embraer_ERJ-175_of_Delta_at_Ronald_Reagan_Washington_National_Airport_(2026).jpg |
| E75S | Embraer 175 | Alexis Doine | CC0 | https://commons.wikimedia.org/wiki/File:N238JQ_Embraer_ERJ-175_of_Delta_at_Ronald_Reagan_Washington_National_Airport_(2026).jpg |
| E190 | Embraer 190 | Wilfredor | CC0 | https://commons.wikimedia.org/wiki/File:YV2911_Conviasa_Embraer_ERJ-190_in_Maiquetia_Airport.jpg |
| E195 | Embraer 195 | Dbx54 | Public domain | https://commons.wikimedia.org/wiki/File:Flybe_Embraer_195_aircraft_at_Edinburgh_Airport.jpg |
| BCS1 | Airbus A220-100 | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Delta_Airbus_A220-100_N137DU_departing_Boston_December_2025.jpg |
| BCS3 | Airbus A220-300 | 4300streetcar | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:JetBlue_Airbus_A220-300_N3196J_planform_view.jpg |
| DH8D | Dash 8 Q400 | Alf van Beem | Public domain | https://commons.wikimedia.org/wiki/File:G-JEDP_-_Bombardier_Dash_8_Q400_takeoff_from_Schiphol_pic3.JPG |
| AT72 | ATR 72 | Md Shaifuzzaman Ayon | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:S2-STA_-_Air_Astra_-_ATR_72-600_(72-212A)_-_1311_-_VGHS.jpg |
| AT76 | ATR 72-600 | Md Shaifuzzaman Ayon | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:S2-STA_-_Air_Astra_-_ATR_72-600_(72-212A)_-_1311_-_VGHS.jpg |
| SF34 | Saab 340 | lasta29 | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:JCG,_Saab_340B,_MA954_%22Hayabusa_(Falcon)%22_(18264502350).jpg |
| B190 | Beechcraft 1900 | Flox Papa | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Beechcraft_1900_Swiss_Air_Force.jpg |
| BE20 | Beechcraft King Air 200 | Armada Argentina | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Beechcraft_B-200_M_Super_King_Air_Armada_Argentina.jpg |
| BE9L | Beechcraft King Air 90 | Beech Aircraft Corporation | CC0 | https://commons.wikimedia.org/wiki/File:Beechcraft_King_Air_65-90_-_DPLA_-_080fc286c7edfb58f2b85f348e76cad7_(page_6).jpg |
| PC12 | Pilatus PC-12 | Robbie Klinkenberg | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Pilatus_PC-12_OH-WAU_at_Portim%C3%A3o_Airport_12-06-2023_(1).jpg |
| C208 | Cessna 208 Caravan | Robbie Klinkenberg | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Fallschirmsportzentrum_Saar_Cessna_208_Caravan_D-FNDA_at_Portim%C3%A3o_Airport_12-06-2023_(1).jpg |
| C172 | Cessna 172 | TRTPUWU | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:CC-STA_(Cessna_172_of_the_Temuco_Air_club).jpg |
| C182 | Cessna 182 | Sudan Envoy | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Cessna_182_-_Takeoff.jpg |
| P28A | Piper PA-28 Cherokee | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Piper_pa-28-140_cherokee_g-atoo_arp.jpg |
| SR22 | Cirrus SR22 | unknown | Public domain | https://commons.wikimedia.org/wiki/File:Cirrus.sr22.n147vc.arp.jpg |
| DA40 | Diamond DA40 | Weißnichtmiristlangweilig | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Bundesheer_(Austrian_Air_Force)_Diamond_DA40_3H-DD.jpg |
| C25A | Cessna Citation CJ2 | Kambui | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Untitled_Cessna_525A_Citation_CJ2%2B_D-IDAS_(24042804719).jpg |
| C25B | Cessna Citation CJ3 | simon butler from halesowen, uk | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:GENEVA_MAY_2006_CESSNA_AIRCRAFT_COMPANY_CESSNA_CITATION_525_CJ3_N361TL_(9477374657).jpg |
| C56X | Cessna Citation Excel | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Cessna_560XL_Citation_XLS_CS-DXK.jpg |
| C68A | Cessna Citation Latitude | kitmasterbloke | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:D-CAWN_Cessna_680A_Citation_Latitude_STN_230525.jpg |
| C700 | Cessna Citation Longitude | Sewageboy | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Cessna_Citation_Longitude_N807QS.jpg |
| CL30 | Bombardier Challenger 300 | Arpingstone | Public domain | https://commons.wikimedia.org/wiki/File:Bombardier.challenger.300.lx-pma.arp.jpg |
| CL35 | Bombardier Challenger 350 | kitmasterbloke | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:CS-CHF_Bombardier_Challenger_350_STN_310126.jpg |
| CL60 | Bombardier Challenger 604 | kitmasterbloke | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:AP-HSU_Canadair_CL-600-2B16_Challenger_605_STN_280123_A.jpg |
| GLF4 | Gulfstream IV | Planephotoman | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Gulfstream_G-400.jpg |
| GLF5 | Gulfstream V | Coldstreamer20 | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:N211DR_-_KHPN_-_8-5-24.jpg |
| GLF6 | Gulfstream G650 | Myself (Adrian Pingstone). | Public domain | https://commons.wikimedia.org/wiki/File:Gulfstream_G650_departs_Bristol_23rdAug2014_arp.jpg |
| GLEX | Bombardier Global Express | Ronnie Macdonald from Chelmsford, Unit… | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Bombardier_Global_Express_5D4_8759_(52255484597).jpg |
| E55P | Embraer Phenom 300 | Ronnie Macdonald from Chelmsford and L… | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Embraer_Phenom_300_%26_Boeing_747_(29213882252).jpg |
| E545 | Embraer Legacy 450 | DUNCAN KIRK from Coeur d'Alene, United… | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:C-FASF_Legacy_450,_Scottsdale_01-25-26_(55095902930).jpg |
| LJ45 | Learjet 45 | Coldstreamer20 | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:N356K_-_KSWF_-_11-12-24.jpg |
| H25B | Hawker 800 | Marek Ślusarczyk (Tupungato) Photo por… | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:39_Hawker_800_800XP_business_jet_-_twinjet_corporate_aircraft.jpg |
| FA7X | Dassault Falcon 7X | Dmitry A. Mottl | Public domain | https://commons.wikimedia.org/wiki/File:Dassault_Falcon_7X.jpg |
| PC24 | Pilatus PC-24 | Steve Knight | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:N282AF_-_Pilatus_PC-24_-_PlaneSense_BOS_280723.jpg |
| EC35 | Eurocopter EC135 | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:DRF_Eurocopter_EC135_Christoph_44_D-HDRK_G%C3%B6ttingen_2017_03.jpg |
| EC45 | Eurocopter EC145 | Steve Lynes from Sandshurst, United Ki… | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:EGWC_-_Eurocopter_EC145_-_G-RMAA_(43673025532).jpg |
| EC30 | Eurocopter EC130 | Tony Hisgett from Birmingham, UK | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:VH-XEV_-_Eurocopter_EC130_B4_(30670101030).jpg |
| AS50 | Eurocopter AS350 | Mark Wagner | CC BY 2.5 | https://commons.wikimedia.org/wiki/File:Eurocopter_AS350_B2_20080503.jpg |
| B06 | Bell 206 | Mfield - Matthew Field, http://www.pho… | CC BY 2.5 | https://commons.wikimedia.org/wiki/File:LAPD_Bell_206_Jetranger.jpg |
| B407 | Bell 407 | stuart.mike | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Bell_407_-N23986.jpg |
| B429 | Bell 429 | Bspor.88 | CC0 | https://commons.wikimedia.org/wiki/File:Bell_429_(N917PD),_NYPD,_August_2024.jpg |
| R44 | Robinson R44 | Ministerstwo Spraw Wewnętrznych i Admi… | CC BY 3.0 pl | https://commons.wikimedia.org/wiki/File:Robinson_R44_Stra%C5%BC_Graniczna_Polish_Border_Guard.jpg |
| S76 | Sikorsky S-76 | San Diego Air &amp; Space Museum Archi… | Public domain | https://commons.wikimedia.org/wiki/File:01_00095416_SDASM_Aircraft_Image_-_Sikorsky_S-76_(53958632386).jpg |
| H60 | Sikorsky UH-60 Black Hawk | Wolfram M. Stumpf, U.S. Air Force | Public domain | https://commons.wikimedia.org/wiki/File:Jordanian_Air_Force_UH-60_Black_Hawk_helicopter_(cropped).jpg |
| C130 | Lockheed C-130 Hercules | Balon Greyjoy | CC0 | https://commons.wikimedia.org/wiki/File:20180512_C-130J_Super_Hercules_Dyess_AFB_Air_Show_2018_1.jpg |
| C30J | Lockheed C-130J Super Hercules | Balon Greyjoy | CC0 | https://commons.wikimedia.org/wiki/File:20180512_C-130J_Super_Hercules_Dyess_AFB_Air_Show_2018_1.jpg |
| C17 | Boeing C-17 Globemaster III | U.S. Air Force | Public domain | https://commons.wikimedia.org/wiki/File:C-17_test_sortie.jpg |
| K35R | Boeing KC-135 Stratotanker | Staff Sgt. Randy Mallard, U.S. Air Force | Public domain | https://commons.wikimedia.org/wiki/File:Boeing_KC-135_Stratotanker_DGNP_990412-F-1312M-004.jpg |
| KC46 | Boeing KC-46 Pegasus | Airman 1st Class Cody Dowell | Public domain | https://commons.wikimedia.org/wiki/File:Coming_soon_to_a_base_near_you_KC-46A_Pegasus.jpg |
| A124 | Antonov An-124 | Dtom | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:An_124_forward.jpg |
| B52 | Boeing B-52 Stratofortress | Senior Airman Keifer Bowes | Public domain | https://commons.wikimedia.org/wiki/File:A_Boeing_B-52H_Stratofortress_in_flight_over_the_Persian_Gulf_(190521-F-XN348-9173).jpg |
| E3TF | Boeing E-3 Sentry | Qwexcxewq | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Boeing_Sentry.jpg |
| P8 | Boeing P-8 Poseidon | Balon Greyjoy | CC0 | https://commons.wikimedia.org/wiki/File:20190206_P-8_Poseidon_Kadena_AB-12.jpg |
| C550 | Cessna Citation Bravo | Martin Oertle | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:GLS_-_General_Logistics_Systems_(Airlink)_Cessna_550B_Citation_Bravo_OE-GLG_(21985155552).jpg |
| C560 | Cessna Citation Ultra | Duncan Kirk from Coeur d'Alene, United States | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:N444GG_Citation_Ultra,_McGregor_Executive_12-09-25_(55080790988).jpg |
| C206 | Cessna 206 Stationair | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Cessna.206h.stationair2.arp.jpg |
| C150 | Cessna 150 | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Cessna_150_(D-ETKR)_02.jpg |
| M20P | Mooney M20 | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Mooney_M20_(D-EPPP)_01.jpg |
| BE35 | Beechcraft V35 Bonanza | Duncan Kirk | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:N30ED_Beech_V35_Bonanza,_Chino_10-26-21_(55325238017).jpg |
| PA18 | Piper Super Cub | Felix König | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-18_Super_Cub_L%C3%B6chgau_2012.JPG |
| CH7A | Aeronca Champion | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Aeronca.7ac.champion.kemble.arp.jpg |
| PA22 | Piper Tri-Pacer | Ian Kirk from Broadstone, Dorset, UK | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:1955_Piper_PA-22-150_Tri-Pacer_Caribbean_G-BRNX_(8708314780).jpg |
| C180 | Cessna 180 Skywagon | Rennett Stowe from USA | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Cessna_180_(3033819308).jpg |
| PA24 | Piper Comanche | Jeroen Stroes Aviation Photography from Netherlands | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:N5411P_(46143128751).jpg |
| T206 | Cessna T206 Stationair | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Cessna_T206H_Stationair_TC_(G-CHJK)_01.jpg |
| C170 | Cessna 170 | Designism | CC0 | https://commons.wikimedia.org/wiki/File:N1646D,_Cessna_170B,_Zelienople_Municipal_Airport_(1).jpg |
| PA32 | Piper PA-32 Cherokee Six | Adrian Pingstone (Arpingstone; file name ends .arp) | Public domain | https://commons.wikimedia.org/wiki/File:Piper.pa32.cherokee.six.g-bxwp.arp.jpg |
| RV6 | Van's RV-6 | BWard 1997 | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:G-ORVG_Vans_RV-6_Duxford_28-6-2025.jpg |
| P32R | Piper Saratoga SP | kitmasterbloke | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:G-OPSL_Piper_PA-32R-301_Saratoga_SP_Chester_050925.jpg |
| AA5 | Grumman AA-5 Tiger | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Grumman_AA-5B_Tiger_(D-ENFL)_03.jpg |
| C140 | Cessna 140 | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Cessna_140_(NC89109)_08.jpg |
| C152 | Cessna 152 | Joao Carlos Medau from Campinas, Brazil | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Cessna_152_PR-EJN_(8475961209).jpg |
| ST75 | Boeing-Stearman Kaydet | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Boeing_PT-17_Kaydet_A75N1_D-EQXL_OTT_2013_03.jpg |
| C310 | Cessna 310 | Mark Harkin | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:G-BODY_Cessna_310R_(13272136325).jpg |
| RV7 | Van's RV-7 | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Vans.rv-7.g-kels.arp.jpg |
| ERCO | Ercoupe | Armchair Aviator's | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Ercoupe_415-C_(N415A).jpg |
| L8 | Luscombe Silvaire | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Luscombe.8e.g-lust.arp.jpg |
| SR20 | Cirrus SR20 | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Cirrus.sr20.g-cdly.arp.jpg |
| C185 | Cessna 185 Skywagon | D. Miller from MI. USA | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Cessna_A185F_Skywagon_(N4934E)_(3864970861).jpg |
| C210 | Cessna 210 Centurion | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Cessna.210.centurion.d-ebws.arp.jpg |
| TAYB | Taylorcraft BC | Armchair Aviator's | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Taylorcraft_BC12-D_(N96440).jpg |
| CH7B | Champion Citabria | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Bellanca.citabria.arp.jpg |
| RV8 | Van's RV-8 | D. Miller from MI. USA | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Van%27s_Aircraft_RV-8_(5879668232).jpg |
| C82S | Cessna T182 Skylane | Ian Kirk from Broadstone, Dorset, UK | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:G-IZZI_2001_Cessna_T182T_Skylane_at_Compton_Abbas_(8977582787).jpg |
| BE58 | Beechcraft Baron 58 | ZLEA | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Beechcraft_58_Baron_(N38020,_cn_TH-1208)_(4-13-2024).jpg |
| S108 | Stinson 108 Voyager | Duncan Kirk | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:N108KD_Stinson_108-3_Voyager,_Sky_Meadows_Airpark_06-21-26.jpg |
| BE95 | Beechcraft Travel Air | Armchair Aviator's | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Beechcraft_Travel_Air_(N100BH).jpg |
| P28B | Piper Cherokee 235 | Jeroen Stroes Aviation Photography from Netherlands | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-28-235_Cherokee_D-EMCO_(26430865787).jpg |
| C177 | Cessna 177 Cardinal | Ahunt (English Wikipedia user) | Public domain | https://commons.wikimedia.org/wiki/File:Cessna177BCardinal05.jpg |
| T210 | Cessna T210 Centurion | Duncan Kirk from Coeur d'Alene, United States | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:XB-QIX_Cessna_T210N,_Toluca_03-04-26_(55161236561).jpg |
| PA23 | Piper Apache | Godromil | Public domain | https://commons.wikimedia.org/wiki/File:Piper_PA-23_Apache_-_Venezia.jpg |
| PA12 | Piper Super Cruiser | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-12_Super_Cruiser_(D-ELTE)_01.jpg |
| BL8 | American Champion Super Decathlon | ZLEA | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:American_Champion_8KCAB_Super_Decathlon_(N26GK,_cn_1214-2024)_(4-10-2024).jpg |
| C82R | Cessna R182 Skylane RG | Doodybutch | CC0 | https://commons.wikimedia.org/wiki/File:N9106CAboveClouds.jpg |
| C82T | Cessna TR182 Skylane RG | Gerard van der Schaaf | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:D-EIZV_(9431925599).jpg |
| FOX | Kitfox | Armchair Aviator's | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Kitfox_III_(N27DN).jpg |
| C72R | Cessna 172RG Cutlass | Curimedia / P H O T O G R A P H Y | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Cessna_172RG_Cutlass_RG_D-EMHH_(9290220123).jpg |
| HUSK | Aviat Husky | Jim Sorbie | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Aviat_A-1C-180_Husky_(N87HU)_(36015748262).jpg |
| PA34 | Piper Seneca | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-34-220T_Seneca_V_(D-GEFI)_02.jpg |
| RV4 | Van's RV-4 | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Van%27s_RV_4_(D-ERVX)_00.jpg |
| PA31 | Piper Navajo | RuthAS | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-31-325_C-GDFR_BC_West_Chilli_12.04.08R_edited-2.jpg |
| BE23 | Beechcraft Musketeer | Jeroen Stroes Aviation Photography from Netherlands | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Beechcraft_Sundowner_D-EARR_(29787147368).jpg |
| PA46 | Piper Malibu Mirage | Steve Lynes from Sandshurst, United Kingdom | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:EGLK_-_Piper_PA-46-350P_Malibu_Mirage_-_N394SE_(43168875555).jpg |
| PA30 | Piper Twin Comanche | Ahunt | Public domain | https://commons.wikimedia.org/wiki/File:Piper_PA-30_Twin_Comanche_C-FQPK_01.JPG |
| C175 | Cessna 175 Skylark | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Cessna.175c.g-arws.arp.jpg |
| PA11 | Piper Cub Special | Fyg.medialab | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-11_Aero_Club_Chivilcoy_2025.jpg |
| NAVI | Navion | Jerry Gunner from Lincoln, UK | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:N36D,_1950_Navion_NAVION_B_in_bogus_USCG_marks_(3832646606).jpg |
| R22 | Robinson R22 | Kansai explorer | CC BY 2.5 | https://commons.wikimedia.org/wiki/File:Robinson_R22_BetaII_in_Yao_Airport02.JPG |
| SF50 | Cirrus Vision Jet | Duncan Kirk from Coeur d'Alene, United States | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:N776Y_Vision_Jet,_Scottsdale_03-25-26_(55176239221).jpg |
| TBM7 | Socata TBM 700 | Kambui | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Untitled_Socata_TBM-700_N492B_(27538908515).jpg |
| RV9 | Van's RV-9 | kitmasterbloke | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:G-RVIW_Vans_RV-9_Rougham_Fly_In_180921.jpg |
| C77R | Cessna 177RG Cardinal | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Cessna_177RG_Cardinal_RG_(HB-CNM)_02.jpg |
| C421 | Cessna 421 Golden Eagle | Duncan Kirk from Coeur d'Alene, United States | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:N421DM_Cessna_421C,_Brenham_12-07-25_(55080654366).jpg |
| P46T | Piper Meridian | Ronnie Macdonald from Chelmsford, United Kingdom | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-46_Malibu_Meridian_G-KIMI_5D4_2594_(32662875857).jpg |
| AR11 | Aeronca Chief | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Aeronca_11ac_chief_g-ivor_1940_arp.jpg |
| H500 | MD 500 | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Md_helicopters_md-500e_g-sscl_arp.jpg |
| C340 | Cessna 340 | Bob Harrington | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Cessna_340A_N7022G_BFI_3-20-06_04.jpg |
| AA1 | Grumman AA-1 Yankee | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Grumman.aa-1b.trainer.g-bdnx.arp.jpg |
| AT8T | Air Tractor AT-802 | Mussi Katz | CC0 | https://commons.wikimedia.org/wiki/File:Air_Tractor_AT-802_4X-AFY.jpg |
| T6 | North American T-6 Texan | Ktkvtsh | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:North_American_T-6_Texan_at_Vicksburg-Tallulah_Regional_Airport_October_2025.jpg |
| M7 | Maule M-7 | Ahunt | Public domain | https://commons.wikimedia.org/wiki/File:Maule_M-7-260C_Orion_C-GZAU_01.JPG |
| C120 | Cessna 120 | Adrian Pingstone | Public domain | https://commons.wikimedia.org/wiki/File:Cessna.120.g-btbw.arp.jpg |
| GLAS | Glasair | Ian Kirk from Broadstone, Dorset, UK | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Stoddard-Hamilton_Glasair_I_Compton_Abbas_30th_June_2013_(9215814791).jpg |
| C414 | Cessna 414 Chancellor | Steve Knight from Halstead, United Kingdom | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:D-IBFH_Cessna_414_Chancellor_Biggin_Air_Fair_1984_(51875060848).jpg |
| PA44 | Piper Seminole | Durksteel at English Wikipedia | Public domain | https://commons.wikimedia.org/wiki/File:Piper_PA44-180_aircraft.jpg |
| G164 | Grumman Ag Cat | TJM | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:G164B_AgCat.jpg |
| F2TH | Dassault Falcon 2000 | Adrian Pingstone | Public domain | https://commons.wikimedia.org/wiki/File:Dassault.falcon.2000.vp-bdl.arp.jpg |
| GC1 | Globe Swift | Ahunt | Public domain | https://commons.wikimedia.org/wiki/File:TEMCO_GC-1B_Swift_03.JPG |
| PTS1 | Pitts S-1 | Ronnie Macdonald from Chelmsford, United Kingdom | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Pitts_S-1T_Special_N687RB_(34614480462).jpg |
| B47G | Bell 47G | Valder137 | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Bell_47G_RSideFront_KAM_11Aug2010_(14983588322).jpg |
| UH1 | Bell UH-1 Huey | Christopher Griner | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Bell_Huey_UH-1H_Iroquois_-_ZU-ELP.jpg |
| COL4 | Cessna 400 Corvalis TT | Armchair Aviator's | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Cessna_Corvalis_TT_(N136TT).jpg |
| AC11 | Rockwell Commander 114 | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Rockwell_Commander_114_(built_1976)_Cotswold_Airport_arp.jpg |
| GLST | GlaStar | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Stoddard-hamilton.glastar.g-gery.arp.jpg |
| BE30 | Beechcraft King Air 300 | AlfvanBeem | CC0 | https://commons.wikimedia.org/wiki/File:HB-GPI_Technomag_AG_Beech_300_Super_King_Air.JPG |
| F900 | Dassault Falcon 900 | Adrian Pingstone | Public domain | https://commons.wikimedia.org/wiki/File:Dassault.falcon900.cs-dfh.arp.jpg |
| H269 | Schweizer 300 | Alf van Beem | CC0 | https://commons.wikimedia.org/wiki/File:PH-DIB_Schweizer_269C-300C_at_Hilversum_Airport_(ICAO_EHHV),_photo1.JPG |
| R66 | Robinson R66 | Waerfelu | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Robinson_R66_N66MV_in_2011.jpg |
| P210 | Cessna P210 Centurion | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Cessna_P210N_(D-EEHW)_02.jpg |
| CH60 | Zenith Zodiac CH 601 | David Álvarez López from Gijón, España | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:ULM_La_Morgal._Zenair_XL._Festival_a%C3%A9reo_internacional_de_Gij%C3%B3n_2024._(53887392028)_(cropped).jpg |
| PA25 | Piper Pawnee | Mankymuncle | CC0 | https://commons.wikimedia.org/wiki/File:Piper_Pawnee_VH-SSO_conducting_a_landing_at_the_Bacchus_Marsh_ALA.jpg |
| BE55 | Beechcraft Baron 55 | Jeroen Stroes Aviation Photography from Netherlands | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:N743P_(30246136817).jpg |
| PA38 | Piper Tomahawk | Ian Kirk from Broadstone, Dorset, UK | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-38_Tomahawk_Compton_Abbas_30th_June_2013_(9218587756).jpg |
| LGEZ | Rutan Long-EZ | NOAA | Public domain | https://commons.wikimedia.org/wiki/File:NOAA-Long-EZ.jpg |
| C195 | Cessna 195 | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Cessna_195_businessliner_g-btbj_of_1952_arp.jpg |
| AEST | Piper Aerostar | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Piper_pa-60-600_aerostar_n70vb_arp.jpg |
| BE40 | Beechjet 400 | Karelj | Public domain | https://commons.wikimedia.org/wiki/File:Hawker_400XP_Prague_airport_2015_1.jpg |
| WACF | Waco UPF-7 | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Waco_UPF-7_(G-UPFS)_arrives_RIAT_Fairford_10thJuly2014_arp.jpg |
| C337 | Cessna 337 Skymaster | Julian Herzog (Website) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Cessna_337D_Super_Skymaster_N991DM_OTT_2013_01.jpg |
| DHC2 | De Havilland Beaver | Tony Hisgett from Birmingham, UK | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:De_Havilland_Canada_DHC-2_Beaver,_C-FFHQ_(8027517572).jpg |
| CH75 | Zenith STOL CH 750 | Ahunt | CC0 | https://commons.wikimedia.org/wiki/File:Zenair_STOL_CH750_C-IKIM_1716.JPG |
| CC11 | CubCrafters Carbon Cub | James Abbott from New Westminster, B.C., Canada | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Pitt_Meadows_Airport_Days_2018-06-02_173-LR_(42553121611).jpg |
| C680 | Cessna Citation Sovereign | kitmasterbloke | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:D-CAWX_-_Cessna_680_Citation_Sovereign%2B_BHX_301024.jpg |
| BT36 | Beechcraft Turbo Bonanza | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Beechcraft_B36TC_Bonanza_(N65044)_01.jpg |
| CH70 | Zenith STOL CH 701 | Jerry Gunner from Lincoln, UK | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Red_Sky_Stol_CH_701_-_N5169B_dating_from_2004_(3832951168).jpg |
| DV20 | Diamond DA20 Katana | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Diamond_DV20_Katana_(D-EOOY)_03.jpg |
| PTS2 | Pitts S-2 | BrettGoldsmith at English Wikipedia | CC BY 2.5 | https://commons.wikimedia.org/wiki/File:Pitts_S-2C_in_Flight.jpg |
| SREY | SeaRey | Valder137 | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Progressive_Aerodyne_SeaRey_N165CB_Taxi_03_SNFSI_FOF_15April2010_(14443921747).jpg |
| BE18 | Beechcraft Model 18 | D. Miller from IL. USA | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Beech_18,_C-45_or_Twin_Beech_(2142825857).jpg |
| G280 | Gulfstream G280 | Zalasem1 | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:SP-NVM,_Gulfstream_G280.jpg |
| M5 | Maule M-5 | Ahunt | Public domain | https://commons.wikimedia.org/wiki/File:Maule_M-5-235C_C-GPYC_01.JPG |
| FDCT | Flight Design CT | Ronnie Macdonald from Chelmsford, United Kingdom | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Flight_Design_CTLS_G-CONA_5D4_2751_(32831658997).jpg |
| BE24 | Beechcraft Sierra | Linda Thomas | CC0 | https://commons.wikimedia.org/wiki/File:Beechcraft_Sierra_2n.jpg |
| C750 | Cessna Citation X | K. Krallis (SV1XV) | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Hellenic_Civil_Aviation_Authority_Cessna_Citation_X_(SX-ECI)_@_ATH,_June_2020.jpg |
| C188 | Cessna 188 AgWagon | RuthAS | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Cessna_A188A_Agwagon_N9961G_Minden_NV_27.10.05R_edited-2.jpg |
| E300 | Extra 300 | Curimedia / P H O T O G R A P H Y | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Extra_300L_D-EXTRA_(9290078221).jpg |
| C510 | Cessna Citation Mustang | Juergen Lehle | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Cessna_Citation_Mustang_N416CM.jpg |
| PA20 | Piper Pacer | Armchair Aviator's | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-20_Pacer_(N8973C).jpg |
| B14A | Bellanca Cruisair | Bzuk | Public domain | https://commons.wikimedia.org/wiki/File:Bellanca_Cruissair.jpg |
| LNC2 | Lancair 360 | Ahunt | Public domain | https://commons.wikimedia.org/wiki/File:Lancair_320-360_C-FKRO_04.JPG |
| LJ60 | Learjet 60 | Lars Henseleit (Lhensele at de.wikipedia) | Public domain | https://commons.wikimedia.org/wiki/File:Learjet_60_D-CKKK.jpg |
| LA4 | Lake Buccaneer | Jeroen Stroes Aviation Photography from Netherlands | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:N6163V_(45318821252).jpg |
| DA42 | Diamond DA42 Twin Star | Kuba Bożanowski from Warsaw, Poland | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Diamond_DA42_Twin_Star_SP-NBA_--_static_(3318015925).jpg |
| J3 | Piper J-3 Cub | kitmasterbloke | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:G-NCUB_Piper_J-3C-65_Cub_-_52507216285.jpg |
| S22T | Cirrus SR22T | Dakins at English Wikipedia | Public domain | https://commons.wikimedia.org/wiki/File:ChicagoCirrus.JPG |
| P28R | Piper Arrow | Huhu Uet | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Piper_PA-28R-201_Arrow_(D-EXXD)_01.jpg |
| BE33 | Beechcraft Bonanza 33 | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Beech.bonanza.takeoff.arp.jpg |
| B350 | Beechcraft King Air 350 | Steve Lynes from Sandshurst, United Kingdom | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:EGLK_-_Beech_300_Super_King_Air_350_-_SE-LLU_(40431918920).jpg |
| SONX | Sonex | Adrian Pingstone (Arpingstone) | Public domain | https://commons.wikimedia.org/wiki/File:Sonex_Aircraft_Sonex_(G-CIDX)_at_Cotswold_Airport_England_18Jun2016_arp.jpg |
| RV3 | Van's RV-3 | Ahunt at English Wikipedia | Public domain | https://commons.wikimedia.org/wiki/File:VansRV-301.jpg |
| CRER | Rans S-7 Courier | Doubleh63 | CC0 | https://commons.wikimedia.org/wiki/File:Rans_S-7_Courier_with_damaged_propeller_at_Brioude_aerodrome.jpg |
| RV10 | Van's RV-10 | Ahunt at English Wikipedia | Public domain | https://commons.wikimedia.org/wiki/File:VansRV-10N104CD.jpg |
| RV12 | Van's RV-12 | Mark Harkin | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:G-RMPS_(8532178590).jpg |
| BL17 | Bellanca Viking | happy days photos and art | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:G-VIKE_Bellanca_17-30A_Super_Viking_(7344507090).jpg |
| BE36 | Beechcraft A36 Bonanza | Davidi Vardi (דוידי ורדי), via the PikiWiki Israel free image collection | CC BY 2.5 | https://commons.wikimedia.org/wiki/File:140024_parking_in_rosh_pina_PikiWiki_Israel.jpg |
