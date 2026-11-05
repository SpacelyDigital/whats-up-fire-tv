// Where the user is and how they like it shown. Saved on the device (localStorage).
// First launch: approximate location from the connection's IP (GeoJS, free, no key).
// "Change location": a ZIP/postcode or city name (Open-Meteo geocoding), or a street
// address (US Census geocoder for US addresses, else Nominatim). Exact coordinates stay
// on the device; the time-zone lookup and adsb.fi only see them rounded to 2 decimals.
import {getJson,store,text} from './live.mjs';
import {number,snapped} from './core.mjs';
import {CONFIG} from './config.js';

const KEY='whatsup.settings.v1';
export const IP_URL='https://get.geojs.io/v1/ip/geo.json';
export const SEARCH_URL=q=>`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
export const CENSUS_URL=q=>`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
export const NOMINATIM_URL=q=>`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&addressdetails=1`;
export const TZ_URL=(lat,lon)=>`https://api.open-meteo.com/v1/forecast?latitude=${Number(lat).toFixed(2)}&longitude=${Number(lon).toFixed(2)}&timezone=auto&forecast_days=1`;

const US={Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',
  'District of Columbia':'DC','Washington, D.C.':'DC',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',
  Kansas:'KS',Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',
  Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ',
  'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',
  Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',
  Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY','Puerto Rico':'PR'};
const CA={Alberta:'AB','British Columbia':'BC',Manitoba:'MB','New Brunswick':'NB','Newfoundland and Labrador':'NL',
  'Nova Scotia':'NS',Ontario:'ON','Prince Edward Island':'PE',Quebec:'QC',Saskatchewan:'SK',
  'Northwest Territories':'NT',Nunavut:'NU',Yukon:'YT'};
const SHORT_COUNTRY={GB:'UK',US:'USA',AE:'UAE'};
// Three-letter country codes people type after a city ("TORONTO CAN", "LONDON GBR"; RSA as in sport).
const ISO3={CAN:'CA',GBR:'GB',FRA:'FR',DEU:'DE',AUS:'AU',NZL:'NZ',JPN:'JP',ZAF:'ZA',RSA:'ZA',IRL:'IE',MEX:'MX',ESP:'ES',ITA:'IT',
  NLD:'NL',BEL:'BE',CHE:'CH',AUT:'AT',PRT:'PT',SWE:'SE',NOR:'NO',DNK:'DK',FIN:'FI',ISL:'IS',POL:'PL',GRC:'GR',TUR:'TR',ISR:'IL',
  IND:'IN',CHN:'CN',KOR:'KR',SGP:'SG',PHL:'PH',ARE:'AE',BRA:'BR',ARG:'AR',CHL:'CL',COL:'CO',EGY:'EG'};
const STATE_NAME=Object.fromEntries(Object.entries(US).map(([name,code])=>[code,name]));
// Service text: control and invisible characters (bidi overrides, zero-width) dropped, capped.
const clean=(v,n=60)=>text(v,n);
// A reply's results: a null or malformed entry is skipped (it failed the whole search).
const entries=a=>a.filter(v=>v&&typeof v==='object');

// "Cincinnati, OH", "Toronto, ON", "London, UK", "Lyon, France".
export function placeLabel(p){
  if(!p)return '';
  const cc=clean(p.countryCode,2).toUpperCase(),admin=clean(p.admin);
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k)?o[k]:''; // a region called 'constructor' is no state
  const region=cc==='US'?own(US,admin):cc==='CA'?own(CA,admin):'';
  const country=own(SHORT_COUNTRY,cc)||(clean(p.country).length<=12?clean(p.country):cc);
  return [clean(p.name),region||country].filter(Boolean).join(', ');
}
const validTz=tz=>{try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true;}catch{return false;}};
// A number, or one written as text (Nominatim, GeoJS); null, '', false or [] is none, never 0 (Null Island).
const num=v=>typeof v==='number'?v:typeof v==='string'&&v.trim()?Number(v):NaN;
function makePlace(o){
  const latitude=num(o.latitude),longitude=num(o.longitude);
  if(!number(latitude)||!number(longitude)||Math.abs(latitude)>85||Math.abs(longitude)>180)return null;
  const timeZone=validTz(o.timeZone)?o.timeZone:'UTC';
  return {name:clean(o.name)||'Unknown place',admin:clean(o.admin),country:clean(o.country),
    countryCode:clean(o.countryCode,2).toUpperCase(),latitude,longitude,timeZone,source:o.source,
    elevationM:number(num(o.elevationM))?num(o.elevationM):0,street:clean(o.street,80),
    accuracyKm:number(num(o.accuracyKm))?num(o.accuracyKm):null,...(o.tzGuess===true?{tzGuess:true}:{})};
}

// Window view reach (Settings > Window distance) and whole-degree bearings.
export const VIEW_MILES=[5,10,15,20,25,30,40,50,60,75,100];
const deg=(v,d)=>Number.isFinite(Number(v))?((Math.round(Number(v))%360)+360)%360:d;
// Map radius steps (Settings > Map radius, and Up/Down on the dashboard).
export const MAP_RADII=[2,5,10,15,25,50,100,150,250];
// The alert zone sits inside the map: the ring (and the Window view's reach) never wider
// than the map radius.
export const alertFor=(radius,mapMiles)=>Math.max(1,Math.min(radius,mapMiles));
export function loadSettings(){
  const s=store.get(KEY)||{};
  const mapMiles=MAP_RADII.includes(Number(s.mapMiles))?Number(s.mapMiles):CONFIG.rangeMiles;
  return {place:s.place?makePlace(s.place):null,mapMiles,
    radiusMiles:Math.max(1,Math.min(10,Math.round(Number(s.radiusMiles))||CONFIG.radiusMiles)),
    distance:s.distance==='km'?'km':'mi',altitude:s.altitude==='m'?'m':'ft',confirmed:!!s.confirmed,
    keepAwake:s.keepAwake===true, // Settings > Keep screen awake (off unless turned on; a saved choice is kept)
    chime:['off','low','med','high'].includes(s.chime)?s.chime:'med', // Settings > Chime (a plane enters your zone)
    placeNames:['off','cities','hoods','both'].includes(s.placeNames)?s.placeNames:'cities', // Settings > Place names
    // Alert zone: 'circle' (all around, Alert radius) or 'window' (bearings from -> to, out to viewMiles).
    alertZone:s.alertZone==='window'?'window':'circle',
    // No saved window yet: an example window (ENE 74° to S 175°, 25 mi) to adjust from.
    viewFrom:deg(s.viewFrom,74),viewTo:deg(s.viewTo,175),
    viewMiles:VIEW_MILES.includes(Number(s.viewMiles))?Number(s.viewMiles):25,
    layout:typeof s.layout==='string'&&/^[a-z-]{2,20}$/.test(s.layout)?s.layout:'atlas-dark'};
}
// A saved place that can't be read (damaged), not none or an unconfirmed guess (saved as null).
export const placeDamaged=()=>{const p=store.get(KEY)?.place;return !!p&&!makePlace(p);};
// An unconfirmed location guess (from the IP address) is never stored; the rest is. A damaged
// saved place stays until a place is confirmed, so the next launch still keeps the logbook.
export const saveSettings=s=>store.set(KEY,s.confirmed&&s.place?s:{...s,place:placeDamaged()?store.get(KEY).place:null});

// Approximate place from the IP address: {place}, null when the lookup fails, and offline when nothing
// answered it (no connection, a timeout, a captive portal's redirect or page) rather than GeoJS.
export async function locateByIp(){
  const {status,payload:p}=await getJson(IP_URL,6000);
  if(status!==200||!p)return {place:null,offline:['connection_error','blocked','invalid'].includes(status)};
  return {place:makePlace({name:p.city,admin:p.region,country:p.country,countryCode:p.country_code,
    latitude:p.latitude,longitude:p.longitude,timeZone:p.timezone,source:'ip',accuracyKm:p.accuracy}),offline:false};
}

// ZIP/postcode or place name -> up to 6 places, biggest first. Open-Meteo matches names
// only, so "Rosemont, Illinois" or "Rosemont IL" finds nothing: then the leading words are
// searched as the name and only places whose state, region or country matches the rest kept.
export async function searchPlaces(query){
  const q=clean(query,60);
  if(q.length<2)return [];
  const found=await searchNames(q);
  if(!found||found.length)return found;
  const [name,rest]=q.includes(',')?[q.slice(0,q.indexOf(',')),q.slice(q.indexOf(',')+1)]:[q.replace(/\s+\S+$/,''),(q.match(/\s(\S+)$/)||['',''])[1]];
  const r=rest.trim().toLowerCase().replace(/[.]/g,'');
  if(!r||name.trim().length<2||name.trim()===q)return found;
  const near=await searchNames(name.trim());
  if(!near)return null;
  const code=p=>p.countryCode==='US'?US[p.admin]:p.countryCode==='CA'?CA[p.admin]:'';
  return near.filter(p=>[p.admin,p.country,code(p),p.countryCode,SHORT_COUNTRY[p.countryCode]].some(v=>v&&String(v).toLowerCase().replace(/[.]/g,'')===r)
    ||String(p.admin).toLowerCase().startsWith(r)&&r.length>=3||ISO3[r.toUpperCase()]===p.countryCode);
}
async function searchNames(q){
  const {status,payload}=await getJson(SEARCH_URL(q),6000);
  if(status!==200||!Array.isArray(payload?.results))return status===200?[]:null;
  return entries(payload.results).slice(0,10).map(r=>makePlace({name:r.name,admin:r.admin1,country:r.country,countryCode:r.country_code,
    latitude:r.latitude,longitude:r.longitude,timeZone:r.timezone,elevationM:r.elevation,source:'search'})).filter(Boolean)
    // Same name in the same region (a city and its prefecture): keep the first, biggest.
    .filter((p,i,all)=>all.findIndex(q=>placeLabel(q)===placeLabel(p)&&q.admin===p.admin)===i);
}

// "123 Main St ...", "10 Downing Street" or "350 5th Ave ...": a house number, then a word or an ordinal.
// A postal code: short, with at least one digit (UK "SW1A 2AA", Canada "M5V 3L9", "75008").
export const looksLikePostcode=q=>{const t=clean(q);return t.length<=10&&/\d/.test(t)&&/^[A-Z0-9][A-Z0-9 -]*$/i.test(t);};
export const looksLikeAddress=q=>/^\d+[A-Z]?\s+([A-Z]|\d+(st|nd|rd|th)\b)/i.test(clean(q))&&!/^\d{5}(-\d{4})?$/.test(clean(q));
// A street address the U.S. Census geocoder covers: a house number and street, plus a U.S.
// state, territory (Puerto Rico, Island Areas) or ZIP. Only such text is ever sent to it.
const TERRITORIES={'Guam':'GU','U.S. Virgin Islands':'VI','Virgin Islands':'VI','American Samoa':'AS','Northern Mariana Islands':'MP'};
const US_CODES=new Set([...Object.values(US),...Object.values(TERRITORIES)]);
const US_NAMES=[...Object.keys(US),...Object.keys(TERRITORIES),'United States','USA'].map(n=>n.toLowerCase().replace(/[.,]/g,''));
// State codes that are also countries' (Germany DE, India IN, Colombia CO, Montenegro ME...): "... Berlin DE" is
// no Delaware address, so these count only after a comma, with a ZIP, or after a street type that follows the street's
// name, then the town ("233 S Wacker Dr Chicago IL"; not "5 Unter den Linden Berlin DE", "12 Avenue Habib Bourguiba Tunis TN").
const NOT_ONLY_US=new Set(['DE','IN','CO','ME','AL','AR','GA','ID','IL','LA','MA','MD','MN','MS','MT','NE','PA','SC','SD','TN','VA']);
const STREET_TYPE=/^(st|street|ave|avenue|dr|drive|rd|road|blvd|boulevard|ln|lane|ct|court|pl|place|way|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail|loop|pike|sq|square|cv|cove)$/i;
export function looksLikeUSAddress(query){
  const q=clean(query,120);
  if(!looksLikeAddress(q))return false;
  const rest=q.replace(/^\d+[A-Z]?\s+/i,'');
  if(/\b\d{5}(-\d{4})?\s*$/.test(rest)||/,\s*\d{5}(-\d{4})?\b/.test(rest))return true; // a ZIP at the end or after a comma
  const words=rest.replace(/[.]/g,'').split(/[\s,]+/).filter(Boolean);
  const last=words.at(-1)?.toUpperCase()||'';
  if(US_CODES.has(last)&&words.length>2&&(!NOT_ONLY_US.has(last)||words.slice(1,-2).some(w=>STREET_TYPE.test(w))))return true; // "... Cincinnati OH", "... Wacker Dr Chicago IL"
  if([...rest.matchAll(/,\s*([A-Za-z]{2})\b/g)].some(m=>US_CODES.has(m[1].toUpperCase())))return true; // "..., OH ..."
  // A state's name at the end, or as a part after a comma ("..., Ohio, USA"); never in the street or town
  // ("800 W Georgia St Vancouver BC", "10 Station Rd Virginia Water").
  const flat=rest.toLowerCase().replace(/[.]/g,'').replace(/[\s,]+$/,'').replace(/\s+/g,' '),parts=flat.split(/\s*,\s*/).slice(1);
  return US_NAMES.some(n=>flat.endsWith(` ${n}`)||parts.includes(n));
}
const title=s=>s.toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase());

// Time zone and elevation for a geocoded address (the snapped grid point only). If the
// lookup fails, the TV's own time zone stands in, marked tzGuess, and the app looks it up
// again later (refineZone): a geocoder's default (New York, UTC) was saved for good.
const deviceTz=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch{return '';}};
// An address match: a stand-in time zone until the user picks it (the policy: Open-Meteo gets
// "when you pick a street address, that place's rounded location"); refineZone then looks it up.
const guessZone=p=>makePlace({...p,timeZone:validTz(deviceTz())?deviceTz():p.timeZone,tzGuess:true});
// A saved place whose time zone was a stand-in: the looked-up one, or null.
export async function refineZone(p){
  if(!p?.tzGuess)return null;
  const g=snapped(p);
  const {status,payload}=await getJson(TZ_URL(g.latitude,g.longitude),6000);
  return status===200&&validTz(payload?.timezone)?makePlace({...p,timeZone:payload.timezone,elevationM:payload?.elevation??p.elevationM,tzGuess:false}):null;
}

// Street address -> matches: the U.S. Census geocoder for text that looks like a U.S.
// address (census), then Nominatim where the profile allows it (nominatim); one request
// per search, never as you type.
// Results are kept per query for the session (Nominatim's usage policy asks apps to
// cache); failures are not kept, so Try again asks again.
const addressCache=new Map();
export async function searchAddress(query,opts={}){
  const key=`${clean(query,120).toLowerCase()}|${!!opts.census}|${!!opts.nominatim}`;
  if(addressCache.has(key))return addressCache.get(key);
  const found=await searchAddressUncached(query,opts);
  if(found){addressCache.set(key,found);if(addressCache.size>50)addressCache.delete(addressCache.keys().next().value);}
  return found;
}
async function searchAddressUncached(query,{census=false,nominatim=false}={}){
  const q=clean(query,120);
  let failed=false;
  if(census&&looksLikeUSAddress(q)){
    const {status,payload}=await getJson(CENSUS_URL(q),10000);
    const matches=status===200&&Array.isArray(payload?.result?.addressMatches)?payload.result.addressMatches:[];
    if(status!==200)failed=true;
    const found=[];
    for(const m of entries(matches).slice(0,4)){
      const a=m.addressComponents||{},full=clean(m.matchedAddress,120);
      const street=title(full.split(',')[0]||'');
      const p=guessZone({name:title(a.city||''),admin:STATE_NAME[a.state]||a.state,country:'United States',countryCode:'US',
        latitude:m.coordinates?.y,longitude:m.coordinates?.x,timeZone:'America/New_York',street,source:'census',accuracyKm:.05});
      if(p)found.push(p);
    }
    if(found.length)return found;
  }
  // Nominatim only for what the others couldn't find, never because Census couldn't answer:
  // a failed Census search ends as "Search is unavailable", with Try again.
  if(failed)return null;
  if(!nominatim)return [];
  const {status,payload}=await getJson(NOMINATIM_URL(q),10000);
  if(status!==200||!Array.isArray(payload))return status!==200?null:[];
  const found=[];
  for(const r of entries(payload).slice(0,4)){
    const a=r.address||{};
    const street=[a.house_number,a.road].filter(Boolean).join(' ')||clean(r.name);
    const p=guessZone({name:a.city||a.town||a.village||a.suburb||a.county||clean(r.name),admin:a.state,country:a.country,
      countryCode:a.country_code,latitude:r.lat,longitude:r.lon,timeZone:'UTC',street,source:'nominatim',accuracyKm:.1});
    if(p)found.push(p);
  }
  return found;
}
