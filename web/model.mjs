// The display model: live aircraft (live.mjs: adsb.fi, or adsb.lol standing in, + ADSB.lol routes) enriched
// with operator, cargo brand, look-up angles, closest approach, trend and a daily
// logbook. ?demo=1 makes a synthetic sky around whatever home is set (&scene=emergency:
// a 7700 squawk; &scene=quiet: nothing in range; &scene=long: long names everywhere, to check nothing is cut off;
// &still=1: the planes hold where they start, for checks that step through them in order).
import {IDS,airspace,recentSightings,number,inZone,ABOVE_MI,designator} from './core.mjs';
import {RouteLookup} from './routes.mjs';
import {startLive,haversine,store} from './live.mjs';
import {AIRCRAFT_TYPES} from './aircraft-types.mjs';

// Developer/screenshot URL hooks; the release build (window.__whatsupRelease) has none.
export const query=new URLSearchParams(typeof location!=='undefined'&&!globalThis.window?.__whatsupRelease?location.search:'');
export const demo=query.get('demo')==='1',scene=query.get('scene')||'',still=query.get('still')==='1';
let HOME={latitude:0,longitude:0,elevationFt:0},TZ='UTC';
export const tz=()=>TZ;

// Operator names for airline callsign prefixes (ICAO designators). Lessors and
// trustees in the registered owner field are ignored.
const OPERATORS={AAL:'American',UAL:'United',DAL:'Delta',SWA:'Southwest',JBU:'JetBlue',ASA:'Alaska',NKS:'Spirit',
  FFT:'Frontier',AAY:'Allegiant',SKW:'SkyWest',RPA:'Republic',ENY:'Envoy',EDV:'Endeavor',JIA:'PSA',PDT:'Piedmont',
  ASH:'Mesa',GJS:'GoJet',UCA:'CommuteAir',QXE:'Horizon',HAL:'Hawaiian',SCX:'Sun Country',MXY:'Breeze',VXP:'Avelo',
  ACA:'Air Canada',JZA:'Jazz',WJA:'WestJet',ROU:'Air Canada Rouge',POE:'Porter',TSC:'Air Transat',AMX:'Aeroméxico',
  VOI:'Volaris',VIV:'Viva',BAW:'British Airways',VIR:'Virgin Atlantic',EZY:'easyJet',EJU:'easyJet Europe',
  RYR:'Ryanair',RUK:'Ryanair UK',TOM:'TUI',EXS:'Jet2',LOG:'Loganair',SHT:'BA Shuttle',CFE:'BA CityFlyer',
  EIN:'Aer Lingus',DLH:'Lufthansa',AFR:'Air France',KLM:'KLM',SAS:'SAS',FIN:'Finnair',IBE:'Iberia',VLG:'Vueling',
  TAP:'TAP',SWR:'Swiss',AUA:'Austrian',BEL:'Brussels',LOT:'LOT',THY:'Turkish',PGT:'Pegasus',WZZ:'Wizz Air',
  NAX:'Norwegian',ICE:'Icelandair',UAE:'Emirates',QTR:'Qatar',ETD:'Etihad',SVA:'Saudia',ELY:'El Al',
  AIC:'Air India',SIA:'Singapore',CPA:'Cathay',JAL:'JAL',ANA:'ANA',KAL:'Korean Air',AAR:'Asiana',CCA:'Air China',
  CES:'China Eastern',CSN:'China Southern',QFA:'Qantas',ANZ:'Air New Zealand',VOZ:'Virgin Australia',JST:'Jetstar',
  LAN:'LATAM',TAM:'LATAM Brasil',AVA:'Avianca',CMP:'Copa',AZU:'Azul',GLO:'Gol',ETH:'Ethiopian',
  EJA:'NetJets',LXJ:'Flexjet',XOJ:'XOJet',RCH:'US Air Force',
  FDX:'FedEx',UPS:'UPS',DHK:'DHL',BCS:'DHL',DAE:'DHL',DHX:'DHL',AHK:'Air Hong Kong',BOX:'AeroLogic',SWN:'West Atlantic',
  ABX:'ABX Air',ATN:'ATI',GTI:'Atlas Air',CLX:'Cargolux',ICV:'Cargolux Italia',CKS:'Kalitta',PAC:'Polar',
  GEC:'Lufthansa Cargo',CAO:'Air China Cargo',CKK:'China Cargo',NCA:'Nippon Cargo',MPH:'Martinair',ABW:'AirBridgeCargo',
  AJT:'Amerijet',CJT:'Cargojet',KII:'Kalitta Charters',WGN:'Western Global',KYE:'Sky Lease',NPT:'Atlantic',TAY:'ASL Belgium',MTN:'Mountain Air Cargo',
  CFS:'Empire',WIG:'Wiggins',AMF:'Ameriflight',LCO:'LATAM Cargo',QAF:'Qatar Cargo',CMB:'US Transcom'};
// Cargo brand by callsign prefix. FedEx/UPS/DHL feeders count as their brand;
// Amazon Air flies under ATI, ABX, Atlas, Sun Country etc., so it is found by owner.
const CARGO={FDX:'FedEx',MTN:'FedEx',CFS:'FedEx',WIG:'FedEx',TAY:'FedEx',UPS:'UPS',
  DHK:'DHL',BCS:'DHL',DAE:'DHL',DHX:'DHL',DHL:'DHL',AHK:'DHL',BOX:'DHL',SWN:'DHL',
  ABX:'ABX',ATN:'ATI',GTI:'Atlas',CLX:'Cargolux',ICV:'Cargolux',CKS:'Kalitta',PAC:'Polar',GEC:'Lufthansa',
  CAO:'Air China',CKK:'China Cargo',NCA:'NCA',MPH:'Martinair',ABW:'ABC',AJT:'Amerijet',WGN:'Western Global',
  KYE:'Sky Lease',NPT:'Atlantic',CJT:'Cargojet',AMF:'Ameriflight',LCO:'LATAM',QAF:'Qatar'};
export function cargoBrand(callsign,owner){
  const op=(owner||'').toUpperCase(),call=(callsign||'').toUpperCase();
  if(op.includes('AMAZON')||op.includes('PRIME AIR'))return 'Amazon';
  if(/^[A-Z]{3}\d/.test(call)&&CARGO[call.slice(0,3)])return CARGO[call.slice(0,3)];
  if(op.includes('FEDERAL EXPRESS'))return 'FedEx';
  if(op.includes('UNITED PARCEL'))return 'UPS';
  if(/\bDHL\b/.test(op))return 'DHL';
  return '';
}
export const EMERGENCY={'7500':'HIJACK','7600':'RADIO FAILURE','7700':'EMERGENCY'};
export const typeName=code=>code?AIRCRAFT_TYPES[String(code).toUpperCase()]||code:'';
export const compass=deg=>['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(deg/22.5)%16];

// Miles east/north of home.
export function offset(lat,lon){
  const dLon=((lon-HOME.longitude+540)%360)-180; // across the date line the short way round
  return {x:dLon*69.172*Math.cos(HOME.latitude*Math.PI/180),y:(lat-HOME.latitude)*69.0};
}
function derive(a){
  const {x,y}=offset(a.latitude,a.longitude),ground=Math.hypot(x,y);
  const bearing=(Math.atan2(x,y)*180/Math.PI+360)%360;
  const elevation=Math.atan2((a.altitude_ft-HOME.elevationFt)*0.3048,Math.max(ground,.01)*1609.344)*180/Math.PI;
  let cpa=null;
  if(number(a.heading)&&number(a.speed_kt)&&a.speed_kt>30){
    const v=a.speed_kt*1.15078/3600,vx=v*Math.sin(a.heading*Math.PI/180),vy=v*Math.cos(a.heading*Math.PI/180);
    const t=-(x*vx+y*vy)/(v*v);
    cpa=t>0?{seconds:t,miles:Math.hypot(x+vx*t,y+vy*t),x:x+vx*t,y:y+vy*t}:{seconds:0,miles:ground,x,y,receding:true};
  }
  return {x,y,ground,bearing,elevation,cpa};
}

// Logbook: per local day, saved. Seen/Highest/Fastest/Cargo count the local area (15 NM).
// Rarest and Farthest count today's aircraft that came within the current map radius:
// Rarest = the type among them seen on the fewest days-aircraft overall (all-time tally).
// Cargo "tonight" runs 18:00-06:00 local, counted per brand.
const LOG_KEY='whatsup.logbook.v1';
const localDay=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:TZ});
const localHour=t=>Number(new Date(t).toLocaleString('en-US',{hour:'numeric',hourCycle:'h23',timeZone:TZ}));
// Before 06:00 the night belongs to the previous calendar date (counted on the date itself,
// not 24 h back: after a 23-hour spring-forward day that would land two dates back).
const prevDay=d=>{const [y,m,dd]=d.split('-').map(Number);return new Date(Date.UTC(y,m-1,dd-1)).toISOString().slice(0,10);};
const tonightKey=t=>{const h=localHour(t);return h>=18?localDay(t):h<6?prevDay(localDay(t)):null;};
export const resetLog=()=>{pendingLog=null;store.remove(LOG_KEY);};
// The logbook lives in memory and is saved every 5 min, at the local midnight change and
// when the app leaves the screen (flushLog), not on every poll: it can be ~350 KB, and
// writing it twice per poll wore the stick's flash and stalled the page.
const LOG_FLUSH_MS=300000;
let pendingLog=null,lastLogSave=0;
export function flushLog(){if(pendingLog){store.set(LOG_KEY,pendingLog);pendingLog=null;lastLogSave=Date.now();}}
function saveLogSoon(log,now){
  const newDay=pendingLog&&pendingLog.day!==log.day;
  pendingLog=log;
  if(newDay||now-lastLogSave>=LOG_FLUSH_MS)flushLog();
}
// A saved logbook as loaded from storage: repaired field by field (old shapes, or a value
// damaged on the stick's flash), or dropped when it isn't a logbook at all, so a bad value
// can never stop the dashboard.
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function saneLog(log){
  if(!plain(log)||typeof log.day!=='string')return null;
  if(!plain(log.planes))log={...log,planes:Object.fromEntries((Array.isArray(log.typesToday)?log.typesToday:[]).filter(t=>typeof t==='string').map(t=>[`old-${t}`,{t,d:0}]))};
  const rec=v=>plain(v)&&typeof v.name==='string'&&Number.isFinite(v.value)?v:null,text=v=>v===undefined||typeof v==='string';
  // What the stats show is text and numbers only (a type 7 read "Rare 7"; a brand {} "[object Object]").
  const plane=v=>plain(v)&&(v.d===undefined||Number.isFinite(v.d))&&text(v.t)&&text(v.f)&&
    (v.o===undefined||plain(v.o)&&Number.isFinite(v.o.mi)&&typeof v.o.city==='string'&&typeof v.o.code==='string');
  return {...log,seen:Array.isArray(log.seen)?log.seen.filter(h=>typeof h==='string'):[],
    planes:Object.fromEntries(Object.entries(log.planes).filter(([,v])=>plane(v))),typesToday:Array.isArray(log.typesToday)?log.typesToday.filter(t=>typeof t==='string'):[],
    typesAll:plain(log.typesAll)?Object.fromEntries(Object.entries(log.typesAll).filter(([,n])=>Number.isInteger(n)&&n>=0)):{},highest:rec(log.highest),fastest:rec(log.fastest),
    cargo:plain(log.cargo)&&(typeof log.cargo.night==='string'||log.cargo.night===null)&&plain(log.cargo.seen)?
      {...log.cargo,seen:Object.fromEntries(Object.entries(log.cargo.seen).filter(([,b])=>typeof b==='string'))}:{night:null,seen:{}},
    mil:plain(log.mil)?Object.fromEntries(Object.entries(log.mil).filter(([,t])=>typeof t==='string')):{}};
}
export function updateLog(log,planes,now){
  const day=localDay(now);
  if(!log||log.day!==day)log={day,pk:1,seen:[],planes:{},highest:null,fastest:null,typesToday:[],typesAll:log?.typesAll||{},cargo:log?.cargo||{night:null,seen:{}},mil:{}};
  // Today's aircraft (any distance the feed covers): closest approach, type, callsign and
  // origin. Rarest and Farthest pick from those that came within the map radius, so they
  // follow zooming. Older logs (no planes yet): today's local types count as close (0 mi).
  if(!log.planes){log.planes={};for(const t of log.typesToday||[])log.planes[`old-${t}`]={t,d:0};}
  // Plane keys are 'x'+hex: an all-digit hex is an integer-like key, which objects keep
  // first, so the 4000 cap evicted those planes first and they were counted again.
  if(!log.pk){const old=log.planes;log.planes={};for(const [k,v] of Object.entries(old))log.planes[/^[0-9a-f]{6}$/.test(k)?'x'+k:k]=v;log.pk=1;}
  delete log.typesZone;delete log.zoneSeen;
  const night=tonightKey(now);
  if(log.cargo.night!==night||Array.isArray(log.cargo.seen))log.cargo={night,seen:{}};
  for(const a of planes){
    const from=a.route?.from,d=Math.round(a.distance_mi*10)/10;
    let rec=log.planes['x'+a.hex];
    if(!rec){
      rec=log.planes['x'+a.hex]={d};
      // All-time type tallies: once per aircraft per day, wherever it was seen.
      if(a.aircraft_type&&/^[A-Z0-9]{2,4}$/.test(a.aircraft_type)){
        log.typesAll[a.aircraft_type]=(log.typesAll[a.aircraft_type]||0)+1;
        // Bounded: ICAO designators only, at most 600 kept (the rarest-ever pick reads it).
        const ks=Object.keys(log.typesAll);if(ks.length>600){ks.sort((x,y)=>log.typesAll[y]-log.typesAll[x]);for(const k of ks.slice(600))delete log.typesAll[k];}
      }
      const keys=Object.keys(log.planes);if(keys.length>4000)delete log.planes[keys[0]];
    }
    rec.d=Math.min(rec.d,d);
    if(a.aircraft_type)rec.t=a.aircraft_type;
    if(a.flight)rec.f=a.flight;
    if(from&&number(from.lat)&&number(from.lon)&&!rec.o)
      rec.o={code:a.route.origin,city:from.city||a.route.origin,mi:Math.round(haversine(from.lat,from.lon,HOME.latitude,HOME.longitude))};
    if(a.distance_mi>LOG_MILES)continue; // Seen/Highest/Fastest/Cargo: the local area only
    if(!log.seen.includes(a.hex)){
      log.seen.push(a.hex);if(log.seen.length>3000)log.seen.shift();
      if(a.aircraft_type&&!log.typesToday.includes(a.aircraft_type))log.typesToday.push(a.aircraft_type);
    }
    const name=a.flight;
    if(number(a.altitude_ft)&&(!log.highest||a.altitude_ft>log.highest.value))log.highest={name,value:a.altitude_ft};
    if(number(a.speed_kt)&&(!log.fastest||a.speed_kt>log.fastest.value))log.fastest={name,value:a.speed_kt};
    // Amazon is told by the owner, which the backup feed (adsb.lol) doesn't send: a plane first
    // logged under its callsign's operator (ATN: ATI) becomes Amazon once the owner is known.
    if(night&&a.cargo&&(!log.cargo.seen[a.hex]||a.cargo==='Amazon'))log.cargo.seen[a.hex]=a.cargo;
    // Military today: once per aircraft per day, same local area as Seen; kept with its type.
    if(a.military){log.mil=log.mil||{};if(!(a.hex in log.mil)){log.mil[a.hex]=String(a.aircraft_type||'').slice(0,4);const k=Object.keys(log.mil);if(k.length>500)delete log.mil[k[0]];}}
  }
  return log;
}
// Rarest and Farthest among today's aircraft that came within `radius` miles.
export function pickRarest(log,radius){
  let best=null;
  for(const p of Object.values(log?.planes||{})){
    if(!p.t||p.d>radius||designator(p.t)!==p.t)continue; // a saved "b738" or ZZZZ is never tallied: it won with 0
    const n=log.typesAll[p.t]||0;
    if(!best||n<best.count)best={code:p.t,name:typeName(p.t),count:n};
  }
  return best;
}
export function pickFarthest(log,radius){
  let best=null;
  for(const p of Object.values(log?.planes||{}))
    if(p.o&&p.d<=radius&&(!best||p.o.mi>best.value))best={name:p.f||'',value:p.o.mi,from:p.o.city,code:p.o.code};
  return best;
}
// The map radius the summary filters by (set by the app; Settings > Map radius).
let logRadius=()=>17.3;
export const setLogRadius=fn=>{logRadius=fn;};
export function cargoCounts(seen){
  const counts={};for(const brand of Object.values(seen||{}))counts[brand]=(counts[brand]||0)+1;
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
// Military today by type, most seen first: [[short name, count]] ("C-17", 2).
export function militaryTypes(mil){
  const n={};for(const t of Object.values(mil||{})){const k=shortType(t)||'Unknown';n[k]=(n[k]||0)+1;}
  return Object.entries(n).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
export function logSummary(log){
  if(!log)return {today:0,highest:null,fastest:null,farthest:null,rarest:null,cargoTonight:0,cargoBy:[],night:false,militaryToday:0,militaryTypes:[]};
  const cargoBy=cargoCounts(log.cargo.seen);
  // Rarest/Farthest are read when drawn, so zooming the map changes them at once.
  return {today:log.seen.length,highest:log.highest,fastest:log.fastest,night:!!log.cargo.night,
    get rarest(){return pickRarest(log,logRadius());},get farthest(){return pickFarthest(log,logRadius());},
    cargoTonight:cargoBy.reduce((s,[,n])=>s+n,0),cargoBy,militaryToday:Object.keys(log.mil||{}).length,militaryTypes:militaryTypes(log.mil)};
}

// Trend: compare with the reading ~30 s ago; the samples double as the trail.
const samples=new Map();
function trend(a,now){
  const list=(samples.get(a.hex)||[]).filter(s=>now-s.t<=90000);
  list.push({t:now,alt:a.altitude_ft,gs:a.speed_kt,lat:a.latitude,lon:a.longitude});samples.set(a.hex,list);
  const old=list.find(s=>now-s.t>=20000)||list[0];
  const sign=(d,dead)=>!number(d)||Math.abs(d)<dead?0:Math.sign(d);
  return {alt:sign(a.altitude_ft-old.alt,150),speed:sign(a.speed_kt-old.gs,8),trail:list};
}
function pruneSamples(now){for(const [k,l] of samples)if(now-l[l.length-1].t>120000)samples.delete(k);}

// Military: adsb.fi marks it in the readsb dbFlags field, bit 1 (the same flag behind its
// /api/v2/mil list); the field is only present when it isn't 0.
export const isMilitary=raw=>(Number(raw?.dbFlags)&1)===1;
// A type's short name, as the app writes it elsewhere: "C-17 Globemaster III" -> "C-17".
export const shortType=code=>{const n=typeName(code),w=n.split(' ')[0];return /\d/.test(w)?w:code||'';};
function enrich(a,raw,route,now){
  const r=raw||{},owner=typeof r.ownOp==='string'?r.ownOp.slice(0,80).trim():''; // capped: remote text through regexes
  const call=(a.callsign||'').toUpperCase();
  const airline=/^[A-Z]{3}\d/.test(call)&&Object.prototype.hasOwnProperty.call(OPERATORS,call.slice(0,3))?OPERATORS[call.slice(0,3)]:'';
  const cargo=cargoBrand(call,owner);
  // The registered owner is never shown: for a private aircraft it can be a person's name
  // (or a holding company named after one). It only tells Amazon's cargo flights apart.
  const operator=(cargo==='Amazon'?'Amazon Air':'')||airline;
  const flight=a.callsign||a.registration||a.hex.toUpperCase();
  const squawk=typeof r.squawk==='string'?r.squawk:Number.isInteger(r.squawk)&&r.squawk>=0&&r.squawk<=7777?String(r.squawk).padStart(4,'0'):''; // a number: its 4 digits
  // Emergencies: the 7500/7600/7700 squawks, or a declared emergency (lifeguard and minimum
  // fuel are priority flights, not emergencies). Own keys only: "constructor" is no squawk.
  const declared={general:'EMERGENCY',nordo:'RADIO FAILURE',unlawful:'HIJACK',downed:'EMERGENCY'}[String(r.emergency||'')];
  const emergency=(Object.prototype.hasOwnProperty.call(EMERGENCY,squawk)?EMERGENCY[squawk]:'')||(Object.prototype.hasOwnProperty.call({general:1,nordo:1,unlawful:1,downed:1},String(r.emergency||''))?declared:'');
  let progress=null;
  if(route?.from&&route?.to&&number(route.from.lat)&&number(route.to.lat)){
    const flown=haversine(route.from.lat,route.from.lon,a.latitude,a.longitude),left=haversine(a.latitude,a.longitude,route.to.lat,route.to.lon);
    progress={flown,left,share:flown/Math.max(1,flown+left)};
  }
  const vertical=number(r.baro_rate)?r.baro_rate:number(r.geom_rate)?r.geom_rate:null;
  const military=isMilitary(r);
  // The cleaned registration only: the feed's raw one could be any type ("[object Object]").
  return {...a,flight,operator,military,registration:a.registration||'',type:typeName(a.aircraft_type),
    year:/^\d{4}$/.test(String(r.year||''))?String(r.year):'',squawk,emergency,vertical,
    cargo,route,progress,...derive(a),trend:trend(a,now)};
}

// The hero: an emergency first, then the nearest inside the alert zone, then the one
// arriving soonest, then the nearest. In Window view, "inside" means in the window's
// wedge (or right above) and "approaching" means its closest point falls in the wedge.
function inAlert(a,config){
  const z=config.zone;
  return z?.kind==='window'?inZone(z,a.x,a.y):a.distance_mi<=config.radiusMiles;
}
function pickHero(planes,config){
  const z=config.zone,win=z?.kind==='window';
  const approaching=a=>a.cpa&&!a.cpa.receding&&a.cpa.seconds<600&&a.ground<=config.rangeMiles&&(win?inZone(z,a.cpa.x,a.cpa.y):
    a.cpa.miles<config.radiusMiles+1);
  const hero=planes.find(a=>a.emergency&&a.ground<=config.rangeMiles)||planes.find(a=>a.inside)|| // an emergency off the map stays off the card
    planes.filter(approaching).sort((a,b)=>a.cpa.seconds-b.cpa.seconds)[0]||
    planes.find(a=>a.ground<=config.rangeMiles)||null; // 'Nearest' only from planes on the map
  if(hero)hero.status=hero.emergency?'Emergency':hero.inside?(win&&hero.ground>ABOVE_MI?'In your window':'Above you now'):
    approaching(hero)?'Approaching':'Nearest';
  return hero;
}

// --- Live
const MAX_PLANES=300,LOG_MILES=17.3; // 15 NM
// Seconds to the next poll; `at` is performance.now() ms, as live.mjs times it. app.mjs counts the
// outage line down with it between polls.
export const retryIn=at=>at?Math.max(0,Math.round((at-performance.now())/1000)):0;
function liveSource(config,onModel){
  const routes=new RouteLookup();let log=pendingLog||saneLog(store.get(LOG_KEY)),lastOk=0,lastGood=null,stale=0;
  const update=(states,ok)=>{
    clearTimeout(stale);
    if(ok)lastOk=Date.now();
    const now=Date.now(),retryAt=states.retryAt||0,wait=retryIn(retryAt);
    // One failed check (or a few) doesn't blank the sky: the last good picture stays up to
    // 60 s old (wide maps poll every 15 s), then "No live data, reconnecting in N s", at 60 s
    // even when the next poll is minutes away (a 4xx or a long Retry-After from both feeds).
    if(!ok&&lastGood&&now-lastOk<60000){stale=setTimeout(()=>update(states,false),lastOk+60000-now);return onModel({...lastGood,now,retryIn:wait});}
    const feedNow=now+(states.skew||0)*1000; // the feed's clock: right even when the TV's clock is off
    const {fresh,all}=airspace(states,feedNow,now-lastOk<15000);
    routes.update(states[IDS.routes]?.attributes?.routes);
    const raw=new Map((states[IDS.feed]?.attributes?.ac||[]).filter(r=>r&&typeof r==='object').map(r=>[String(r.hex).toLowerCase(),r])); // one bad entry must not drop the update
    // A 250-mile map over a busy region can hold 500+ aircraft: draw the nearest MAX_PLANES
    // (the feed is sorted by distance) to keep the stick's memory and frame rate in hand.
    const planes=all.slice(0,MAX_PLANES).map(a=>enrich(a,raw.get(a.hex),routes.get(a),now));
    for(const a of planes)a.inside=inAlert(a,config);
    pruneSamples(now);
    // Today's logbook and cargo tonight count the same local area at every map radius
    // (the original 15 NM feed), so zooming out doesn't inflate them.
    // The day follows the feed's clock; the 5-minute save timer stays on the TV's own clock
    // (flushLog stamps it with Date.now(): mixing the two wrote the log every poll, or never).
    if(fresh){log=updateLog(log,planes,feedNow);saveLogSoon(log,now);}
    // 'Recently above': the sightings are stamped by the feed's clock, as positions are, and judged by it;
    // the layouts age them against the TV's (m.now), so the stamps shown are moved onto it.
    const recent=recentSightings(states,planes.filter(a=>a.inside),feedNow).map(a=>({...a,type:typeName(a.aircraft_type),
      route:routes.get(a),cargo:cargoBrand(a.callsign,''),flight:a.callsign||a.registration||a.hex.toUpperCase(),last_seen:a.last_seen-(states.skew||0)}));
    // Today's tallies are today's: after midnight with no fresh feed yet, yesterday's don't show.
    // source: the feed these positions came from (adsb.fi, or adsb.lol standing in), for the credit line.
    // Connecting: neither a reply nor a failure yet (the first failure ends it).
    const model={now,live:true,fresh,noCoverage:!!states.coverage?.none,connecting:!lastOk&&!retryAt,planes,hero:pickHero(planes,config),recent,log:logSummary(log?.day===localDay(feedNow)?log:null),retryIn:wait,retryAt,source:states.source||''};
    if(ok&&fresh)lastGood=model;
    onModel(model);
  };
  const live=startLive(update,config);
  return {...live,stop(){clearTimeout(stale);live.stop();}};
}

// --- Demo: plausible flights around home, moving in real time. Local airports
// come from the map; the far ends are well-known hubs.
const HUBS={ATL:['Atlanta',33.637,-84.428],ORD:['Chicago',41.978,-87.905],DEN:['Denver',39.862,-104.673],
  LHR:['London',51.47,-0.454],SDF:['Louisville',38.174,-85.736],MEM:['Memphis',35.042,-89.977],
  LEJ:['Leipzig',51.432,12.241],JFK:['New York',40.641,-73.778],LAX:['Los Angeles',33.942,-118.408],
  DXB:['Dubai',25.253,55.365],CDG:['Paris',49.01,2.548],BOS:['Boston',42.364,-71.005],
  FRA:['Frankfurt am Main',50.033,8.57],DFW:['Dallas/Fort Worth',32.897,-97.038]};
function demoSource(config,onModel,airports){
  const local=(airports||[]).find(a=>a.iata)||null;
  const localPlace=local?{code:local.iata,city:local.name.replace(/ (International )?Airport$/,''),
    lat:HOME.latitude+local.y/69,lon:HOME.longitude+local.x/(69.172*Math.cos(HOME.latitude*Math.PI/180))}:null;
  const hub=code=>{const [city,lat,lon]=HUBS[code];return {code,city,lat,lon};};
  const leg=(o,d)=>{
    const from=o==='HOME'?localPlace:hub(o),to=d==='HOME'?localPlace:hub(d);
    return from&&to&&from.code!==to.code?{origin:from.code,destination:to.code,from,to}:null;
  };
  const far=(a,b)=>{const h=Object.keys(HUBS).filter(k=>k!==localPlace?.code);return [h[a%h.length],h[b%h.length]];};
  const [h1,h2]=far(1,10),[h3,h4]=far(5,4);
  // [hex, callsign, reg, type, ownOp, year, east mi, north mi, alt ft, kt, track, fpm, route]
  const DEMO=[
    ['a2b150','UAL2631','N27270','B38M','UNITED AIRLINES INC','2022',1.6,-1.9,34000,451,331,0,leg(h3,h1)],
    ['a8f0a3','ATN3417','N1997A','B763','AMAZON.COM SERVICES LLC','1997',-3.1,1.2,7400,250,215,-1100,leg('LAX','HOME')],
    ['406f2a','DHK283','G-DHLF','B77L','DHL AIR LTD','2018',-6.8,4.4,11500,284,226,-1500,leg('LEJ','HOME')],
    ['a4c5e1','UPS1139','N314UP','B763','UNITED PARCEL SERVICE CO','2004',4.8,6.3,33000,438,232,0,leg('JFK','SDF')],
    ['a1f2c4','DAL1213','N392DN','A321','DELTA AIR LINES INC','2019',-7.4,-2.6,6900,240,152,2400,leg('HOME','ATL')],
    ['a7c3b9','SWA1987','N8817L','B38M','SOUTHWEST AIRLINES CO','2019',6.9,-5.2,37000,462,198,0,leg(h4,h2)],
    ['a03b7e','N451PA','N451PA','C172','','1977',2.5,3.1,2400,96,300,300,null],
    ['a0c9f5','N8UH','N8UH','EC35','UNIVERSITY HOSPITAL','2009',-1.2,3.7,1300,118,20,0,null],
    ['ae1471','RCH481','05-5143','C17','','2005',-4.6,-3.9,12500,330,40,1200,null],
    ['ae04c2','PKSN21','58-0010','K35R','','1958',1.5,-7.0,21000,380,250,0,null], // south of home, clear of the other tags
  ];
  const MILITARY=new Set(['ae1471','ae04c2']);
  const started=Date.now(),log={today:184,highest:{name:'UAE2VL',value:41000},fastest:{name:'SWA1987',value:512},
    rarest:{code:'C130',name:typeName('C130'),count:1},farthest:{name:'DHK283',value:4207,from:'Leipzig',code:'LEJ'},night:true,cargoTonight:23,cargoBy:[['UPS',8],['FedEx',6],['DHL',5],['Amazon',4]],militaryToday:3,militaryTypes:[['C-17',2],['KC-135',1]]};
  if(scene==='long')Object.assign(log,{rarest:{code:'A124',name:typeName('A124'),count:1},
    farthest:{name:'GEC8401',value:4310,from:'Frankfurt am Main',code:'FRA'},cargoBy:[['UPS',9],['FedEx',5],['Amazon',3],['ABX',2],['DHL',2]]});
  const recentRows=[['a6d1e2','UAL1840','B739',leg('DEN','BOS'),3],['a3c4d5','ATN3121','B763',leg('LAX','HOME'),12],
    ['a9f8e7','DAL2370','B712',leg('HOME','ATL'),19],['a8b7c6','N22PG','C25B',null,28]];
  // scene=long: the hero and a neighbour get the longest names a TV is likely to see.
  // ?herotype=R44 (demo): the first aircraft flies as that type, to check photos and credits.
  const ht=/^[A-Z0-9]{2,4}$/.test(query.get('herotype')||'')?query.get('herotype'):'';
  if(ht)DEMO[0]=[DEMO[0][0],DEMO[0][1],'N44TST',ht,'',DEMO[0][5],...DEMO[0].slice(6)];
  // scene=longest: past what a TV will see (stress test for one-line fitting).
  if(scene==='longest'){
    DEMO[0]=['0d0a1b','MAA6521','XA-MAAZZ','A124','AEROTRANSPORTES MAS DE CARGA SA DE CV','1991',1.6,-1.9,34000,451,331,0,leg('FRA','DFW')];
    DEMO[1]=['a1b2c3','N1234567','N1234567','GLF6','INTERNATIONAL BUSINESS AVIATION SERVICES LLC','2021',-3,2,45000,520,90,0,null];
    Object.assign(log,{rarest:{code:'A124',name:typeName('A124'),count:1},farthest:{name:'MAA6521',value:9876,from:'Santa Cruz de la Sierra',code:'VVI'},
      cargoBy:[['UPS',19],['FedEx',15],['Amazon',13],['ABX',12],['DHL',12],['Atlas',10]],
      militaryToday:22,militaryTypes:[['KC-135',9],['C-130J',7],['UH-60',4],['CH-47',2]]});
  }
  if(scene==='long'){
    DEMO[0]=['3c4b26','GEC8401','D-ALFH','B77L','LUFTHANSA CARGO AG','2013',1.6,-1.9,34000,451,331,0,leg('FRA','DFW')];
    DEMO[5]=['a7c3b9','SWA4499','N8731J','B38M','SOUTHWEST AIRLINES CO','2019',6.9,-5.2,37000,462,198,0,leg('DFW','FRA')];
  }
  const tick=()=>{
    const now=Date.now(),t=still?0:(now-started)/1000;
    const planes=DEMO.map(([hex,callsign,registration,aircraft_type,ownOp,year,e,n,alt,gs,track,fpm,route])=>{
      const v=gs*1.15078/3600,east=e+v*t*Math.sin(track*Math.PI/180),north=n+v*t*Math.cos(track*Math.PI/180);
      const latitude=HOME.latitude+north/69,longitude=HOME.longitude+east/(69.172*Math.cos(HOME.latitude*Math.PI/180));
      const a={hex,callsign,registration,aircraft_type,latitude,longitude,altitude_ft:Math.round(alt+fpm*t/60),speed_kt:gs,
        heading:track,position_timestamp:now/1000-1};
      a.distance_mi=Math.hypot(east,north);a.inside=a.distance_mi<=config.radiusMiles;
      const raw={ownOp,year,squawk:scene==='emergency'&&hex===DEMO[0][0]?'7700':'2214',baro_rate:fpm,dbFlags:MILITARY.has(hex)?1:0};
      const p=enrich(a,raw,route?{...route,flight:callsign}:null,now);p.inside=inAlert(p,config);return p;
    }).filter(a=>a.distance_mi<config.rangeMiles+3&&scene!=='quiet')
      .sort((a,b)=>Number(b.inside)-Number(a.inside)||a.distance_mi-b.distance_mi);
    const recent=recentRows.map(([hex,flight,code,route,mins])=>({hex,flight,callsign:flight,aircraft_type:code,
      type:typeName(code),route,cargo:cargoBrand(flight,flight.startsWith('ATN')?'AMAZON':''),last_seen:now/1000-mins*60}));
    onModel({now,live:false,fresh:true,planes,hero:pickHero(planes,config),recent,log});
  };
  tick();const timer=setInterval(tick,1000);
  return {stop(){clearInterval(timer);}};
}

// Start the feed for a place; returns {stop}.
export function start(place,config,onModel,airports){
  HOME={latitude:place.latitude,longitude:place.longitude,elevationFt:(place.elevationM||0)*3.2808};TZ=place.timeZone;
  samples.clear();
  const cfg={...config,latitude:place.latitude,longitude:place.longitude};
  return demo?demoSource(cfg,onModel,airports):liveSource(cfg,onModel);
}
