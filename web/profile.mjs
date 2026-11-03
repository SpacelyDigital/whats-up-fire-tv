// Build profile (scripts/build-web.mjs, WHATSUP_PROFILE): which services this build talks
// to. Everything the user is told (first-run consent, Privacy, search screen, credits) is
// written from the same entry, so it always matches what the build really contacts.
//  - personal (default): the developer's own TV. adsb.fi positions, Planespotters photos,
//    EOX imagery outside the US, Nominatim for addresses outside the US.
//  - store: the public app, same services; its own privacy policy. The switches stay so a
//    service can be turned off for the store build alone (photos, eox, nominatim).
// The store build draws the whole screen at STORE_STAGE_SCALE of the TV's size, centred, with
// the margin in the layout's own background, so no text sits in the outer 5% of any edge
// (Amazon's overscan guidance: a TV left on overscan crops the edges). 0.9 puts the stage's own
// edge exactly 5% in, so text clears the margin wherever a layout places it: the fixed text
// would allow 0.911 (scripts/check-safe-area.mjs measures it), but plane tags in Sectional and
// Synthwave and Radar's data blocks may sit 2-4 px from the stage edge.
export const STORE_STAGE_SCALE=0.9;
const PROFILES={
  personal:{
    id:'personal',
    stageScale:1, // full screen: the developer's TV shows the whole picture
    feed:'adsb.fi',
    feedUrl:(lat,lon,nm)=>`https://opendata.adsb.fi/api/v3/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${nm}`,
    photos:true,eox:true,nominatim:true,
    creditFlash:'Aircraft adsb.fi',
    consent:'To show planes near you, this app sends your approximate location, rounded to a few miles, to public flight and map services (adsb.fi, OpenFreeMap, Open-Meteo, USGS, EOX). It looks up the planes it shows with ADSB.lol and Planespotters. Your first city guess comes from your internet address (GeoJS). What you type in search goes to Open-Meteo, the U.S. Census Bureau or OpenStreetMap to find the place. Every service also sees your TV’s internet address. Your settings and history are saved only on this TV. No accounts, ads or analytics. You can erase it all in Settings.',
    searchAlts:['Search uses Open-Meteo, the U.S. Census Bureau and OpenStreetMap.','Search: Open-Meteo, U.S. Census Bureau, OpenStreetMap'],
  },
  // The public app: the same services as the personal build (adsb.fi agreed to this app;
  // photos credited as Planespotters asks). It differs only in its final privacy policy
  // (web/privacy-store.txt), also published at privacyUrl and shown as a QR on the Privacy page.
  store:{id:'store',privacyUrl:'https://spacelydigital.github.io/Whats-Up/privacy/',stageScale:STORE_STAGE_SCALE},
};
export const profileFor=id=>({...PROFILES.personal,...PROFILES[id]});
export const PROFILE=profileFor(globalThis.__whatsupProfile);
