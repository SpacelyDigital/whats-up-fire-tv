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
