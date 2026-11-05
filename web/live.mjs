// Standalone data source: builds the HA-shaped `states` the display already
// reads, from adsb.fi positions (adsb.lol's while adsb.fi isn't answering) and ADSB.lol
// standing routes. Ports the selection/history template in
// home_assistant/packages/aircraft-package.yaml and the free (ADSB.lol) part of
// custom_components/office_aircraft_routes/model.py.
import {PROFILE} from './profile.mjs';
import {IDS,number,coordinates,inZone,snapped,GRID_PAD_NM,dLon} from './core.mjs';

const HOUR=3600,SIX_HOURS=6*HOUR,DAY=24*HOUR;
export const HISTORY_KEY='whatsup.history.v1',LEDGER_KEY='whatsup.ledger.v1';
// adsb.fi serves at most 250 NM around a point (adsb.lol the same).
export const MAX_NM=250;
// Positions: adsb.fi, and adsb.lol only while adsb.fi isn't answering (startLive).
export const FEED_URL=(lat,lon,nm)=>PROFILE.feedUrl(lat,lon,nm);
export const BACKUP_URL=(lat,lon,nm)=>PROFILE.backupUrl(lat,lon,nm);
// The feed query for home: the snapped grid point, the distance widened to still cover
// everything around the true home (filtered by true distance on the TV), at most MAX_NM.
// Null when anything is malformed, so nothing odd is ever sent. `url`: FEED_URL or BACKUP_URL.
export function feedUrlFor(home,nm,url=FEED_URL){
  const c=snapped(home),d=Math.min(MAX_NM,Math.ceil(Number(nm)+GRID_PAD_NM));
  if(!coordinates(c.latitude,c.longitude)||!(d>0))return null;
  return url(c.latitude,c.longitude,d);
}
// A feed reply: a JSON object with the aircraft list. adsb.fi's is used as it comes.
const feedReply=p=>p&&typeof p==='object'&&!Array.isArray(p)&&Array.isArray(p.ac)?p:null;
// adsb.lol's v2 reply is readsb's, like adsb.fi's v3: the same field names and units (`now` is
// in ms in both; feedStamp also takes seconds). Only the fields the app reads from adsb.fi are
// kept. adsb.lol sends no owner (ownOp) or build year, so while it stands in, Amazon's cargo
// flights are told by callsign alone and no year is shown. Null: not a feed reply.
const BACKUP_FIELDS=['hex','flight','r','t','category','lat','lon','alt_baro','gs','track','baro_rate','geom_rate',
  'squawk','emergency','dbFlags','seen','seen_pos'];
export function fromBackup(payload){
  const p=feedReply(payload);if(!p)return null;
  const own=(a,k)=>Object.prototype.hasOwnProperty.call(a,k);
  return {now:p.now,ac:p.ac.filter(a=>a&&typeof a==='object').map(a=>Object.fromEntries(BACKUP_FIELDS.filter(k=>own(a,k)).map(k=>[k,a[k]])))};
}
export const ROUTE_URL=call=>`https://vrs-standing-data.adsb.lol/routes/${call.slice(0,2)}/${call}.json`;
const HEX=/^[0-9a-f]{6}$/;

// --- Network: through the Vega app when present (adsb.fi sends no CORS header),
// otherwise the browser's own fetch. Resolves {status, payload}; never throws.
// Ids start at a random point: a late reply meant for the page before a reload (Erase) must
// not answer this page's requests.
const pending=new Map();let nextRequest=Math.floor(Math.random()*1e9);
if(typeof window!=='undefined')window.__whatsupReply=(id,status,text)=>{
  const done=pending.get(id);if(done){pending.delete(id);done(status,text);}
};
// OpenFreeMap requests (TileJSON too) share the tile slots and the tile pause below.
export function getJson(url,timeoutMs=8000){
  if(!/^https:\/\/[\w.-]*openfreemap\.org\//.test(url))return rawGetJson(url,timeoutMs);
  if(performance.now()<tileCooldown)return Promise.resolve({status:'cooldown',payload:null});
  return tileSlot().then(()=>performance.now()<tileCooldown?{status:'cooldown',payload:null}:
    rawGetJson(url,timeoutMs).then(r=>{tileStatus(r.status,r.retryAfter);return r;})).finally(tileFree);
}
function rawGetJson(url,timeoutMs){
  const bridge=typeof window!=='undefined'&&window.ReactNativeWebView;
  // Non-200: `retryAfter` is the service's Retry-After in seconds, when it sent one.
  const parse=(status,text)=>{
    if(status!==200)return {status,payload:null,retryAfter:Number(text)||0};
    try{return {status,payload:JSON.parse(text)};}catch{return {status:'invalid',payload:null};}
  };
  if(bridge)return new Promise(resolve=>{
    const id=++nextRequest,timer=setTimeout(()=>{pending.delete(id);resolve({status:'connection_error',payload:null});},timeoutMs+2000);
    pending.set(id,(status,text)=>{clearTimeout(timer);resolve(parse(status,text));});
    try{bridge.postMessage(JSON.stringify({type:'get',id,url,timeoutMs}));}catch{pending.delete(id);clearTimeout(timer);resolve({status:'connection_error',payload:null});}
  });
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  return fetch(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal})
    .then(async r=>parse(r.status,r.status===200?await r.text():r.headers.get('retry-after')||''))
    .catch(()=>({status:'connection_error',payload:null}))
    .finally(()=>clearTimeout(timer));
}

// Binary GET for map tiles. On the TV through the app bridge, so every request carries the
// app's own User-Agent (OpenFreeMap's terms); the page's fetch (CORS) only where there is no
// bridge (desktop tests). At most TILE_PARALLEL in flight across the whole app, and after a
// 429, 403 or 5xx every tile request waits out a shared cooldown (1 min, doubling to 10 min);
// the maps then keep what's saved (longer when the TileJSON's Retry-After asks, up to an hour).
// Resolves bytes or null. The cooldown runs on performance.now(): a TV clock step can't stretch it.
const TILE_PARALLEL=4;
let tileSlots=TILE_PARALLEL,tileCooldown=0,tileStrikes=0;const tileQueue=[];
const tileSlot=()=>tileSlots>0?(tileSlots--,Promise.resolve()):new Promise(r=>tileQueue.push(r));
const tileFree=()=>{const next=tileQueue.shift();if(next)next();else tileSlots++;};
export const tileStats={inFlight:0,peak:0,requests:0,bytes:0};
function tileStatus(status,retryAfter=0){
  if(status===200){tileStrikes=0;return;}
  if(status===429||status===403||(typeof status==='number'&&status>=500)){
    tileCooldown=performance.now()+Math.max(Math.min(600000,60000*2**tileStrikes++),Math.min(3600,retryAfter)*1000);
  }
}
export async function getBytes(url,timeoutMs=10000){
  if(performance.now()<tileCooldown)return null;
  await tileSlot();
  tileStats.inFlight++;tileStats.peak=Math.max(tileStats.peak,tileStats.inFlight);tileStats.requests++;
  try{
    if(performance.now()<tileCooldown)return null;
    const bridge=typeof window!=='undefined'&&window.ReactNativeWebView;
    if(bridge)return await new Promise(resolve=>{
      const id=++nextRequest,timer=setTimeout(()=>{pending.delete(id);resolve(null);},timeoutMs+2000);
      pending.set(id,(status,text)=>{
        clearTimeout(timer);tileStatus(status);
        try{const b=status===200?Uint8Array.from(atob(text),c=>c.charCodeAt(0)):null;if(b)tileStats.bytes+=b.length;resolve(b);}catch{resolve(null);}
      });
      try{bridge.postMessage(JSON.stringify({type:'get',id,url,timeoutMs,binary:true}));}catch{pending.delete(id);clearTimeout(timer);resolve(null);}
    });
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const r=await fetch(url,{credentials:'omit',signal:controller.signal});tileStatus(r.status);
      if(r.status!==200)return null;
      const b=new Uint8Array(await r.arrayBuffer());tileStats.bytes+=b.length;return b;
    }catch{return null;}finally{clearTimeout(timer);}
  }finally{tileStats.inFlight--;tileFree();}
}

// --- Storage: localStorage when available, else memory for this launch only.
const memory=new Map();
// seal(): after Erase nothing may be written again (the reload's pagehide flush, a map
// build finishing during unload).
let sealed=false,freeing=false;
export const store={
  seal(){sealed=true;memory.clear();},
  get sealed(){return sealed;},
  get(k){try{const v=localStorage.getItem(k);if(v!==null)return JSON.parse(v);}catch{/* memory */}return memory.get(k)??null;},
  // Full: the saved maps make room (mapgen sets onFull), then one more try.
  set(k,v){
    if(sealed)return false;memory.set(k,v);const json=JSON.stringify(v);
    try{localStorage.setItem(k,json);return true;}catch{/* full */}
    if(!this.onFull||freeing)return false;
    freeing=true;try{this.onFull();}catch{/* nothing to free */}finally{freeing=false;}
    try{localStorage.setItem(k,json);return true;}catch{console.error('not saved: storage full');return false;}
  },
  remove(k){memory.delete(k);try{localStorage.removeItem(k);}catch{/* memory only */}},
};

// --- Selection (aircraft-package.yaml template sensors).
const finite=(v,low=-Infinity,high=Infinity)=>number(v)&&v>=low&&v<=high;
const position=(lat,lon)=>finite(lat,-85,85)&&finite(lon,-180,180);
export function haversine(lat1,lon1,lat2,lon2){
  const r=Math.PI/180,p1=lat1*r,p2=lat2*r;
  const h=Math.sin((p2-p1)/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin((lon2-lon1)*r/2)**2;
  return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
export function feedStamp(body){
  const stamp=Number(body?.now)||0;
  return stamp>100000000000?stamp/1000:stamp;
}
// One row per aircraft: a broken feed can list one twice (a stale copy hid a 7700 and filled the
// history). The one with the newest position is kept, as the map keeps it.
const posAge=a=>position(a.lat,a.lon)&&number(a.seen_pos)&&a.seen_pos>=0?a.seen_pos:Infinity;
function oneEach(ac){
  const by=new Map();
  for(const a of ac){
    if(!a||typeof a!=='object'||typeof a.hex!=='string')continue;
    const k=a.hex.toLowerCase(),o=by.get(k);
    if(!o||posAge(a)<posAge(o))by.set(k,a);
  }
  return [...by.values()];
}
// `radius`: miles (the circle), or a Window view zone {kind:'window',from,to,miles}.
export function selection(ac,stamp,home,radius,now){
  const age=now-stamp,fresh=age>=-5&&age<=15,radians=0.017453292519943295;
  let nearest=null,best=Infinity;const inside=[];
  for(const a of fresh&&Array.isArray(ac)?ac:[]){
    if(!a||typeof a!=='object'||!position(a.lat,a.lon)||typeof a.hex!=='string'||!/^[a-fA-F0-9]{6}$/.test(a.hex)||
      !number(a.alt_baro)||!number(a.seen_pos)||a.seen_pos<0||a.seen_pos+age<0||a.seen_pos+age>20)continue;
    const x=dLon(a.lon,home.longitude)*radians*Math.cos((home.latitude+a.lat)/2*radians),y=(a.lat-home.latitude)*radians;
    const miles=Math.sqrt(x*x+y*y)*3958.7613;
    const record={hex:a.hex,callsign:text(a.flight,10),registration:text(a.r,12),
      aircraft_type:text(a.t,6),latitude:a.lat,longitude:a.lon,altitude_ft:a.alt_baro,speed_kt:a.gs??null,
      heading:a.track??null,distance_mi:Math.round(miles*100)/100,position_timestamp:stamp-a.seen_pos};
    const inAlert=typeof radius==='object'?inZone(radius,x*3958.7613,y*3958.7613):miles<=radius;
    if(inAlert){inside.push(record);if(miles<best){nearest=record;best=miles;}}
  }
  // No manual selection standalone: the current aircraft is the nearest one.
  return {candidate:nearest,current:nearest,feed_fresh:fresh,inside};
}
// The last 20 distinct in-boundary sightings, newest first.
export function mergeHistory(old,inside){
  const present=new Set(inside.map(a=>a.hex));
  const rows=inside.map(a=>({hex:a.hex,callsign:a.callsign,registration:a.registration,
    aircraft_type:a.aircraft_type,last_seen:a.position_timestamp}));
  for(const a of Array.isArray(old)?old:[])
    if(a&&typeof a==='object'&&typeof a.hex==='string'&&!present.has(a.hex)&&number(a.last_seen))rows.push(a);
  return rows.sort((a,b)=>b.last_seen-a.last_seen).slice(0,20);
}

// --- Route enrichment (model.py: observations, commercial_route, Enricher/adsblol).
const DETOUR_MILES=60,DETOUR_SHARE=.05;
const SIGHTING=['latitude','longitude','heading','speed_kt','altitude_ft','vertical_rate','observed'];
export const ident=v=>{const s=String(v||'').trim().toUpperCase();return /^[A-Z0-9-]{2,10}$/.test(s)?s:'';};
export function provider(a){
  const call=ident(a.callsign),reg=ident(a.registration);
  if(String(a.callsign||'').trim()&&!call)return null;
  if(reg&&(!call||call.replaceAll('-','')===reg.replaceAll('-','')))return 'flightaware';
  return /^[A-Z]{3}[0-9][A-Z0-9]{0,5}$/.test(call)?'adsblol':null;
}
const key=a=>`${a.hex}:${ident(a.callsign)||ident(a.registration)}`;

// `radius`: miles (the circle) or a Window view zone {kind:'window',...} as in selection().
export function observations(raw,stamp,home,radius,history,now){
  if(!(now-stamp>=0&&now-stamp<=15)||!position(home.latitude,home.longitude))return [];
  const found=new Map();
  for(const a of Array.isArray(history)?history.slice(-20):[])
    if(a&&typeof a==='object'&&HEX.test(String(a.hex??''))&&number(a.last_seen)&&now-a.last_seen>=0&&now-a.last_seen<=SIX_HOURS)
      found.set(a.hex,{...a,observed:a.last_seen,live:false,inside:true});
  for(const a of Array.isArray(raw)?raw:[]){
    if(!a||typeof a!=='object')continue;
    const {lat,lon}=a,seen=a.seen_pos??999,hex=String(a.hex??'').toLowerCase();
    if(!HEX.test(hex)||!position(lat,lon)||!number(seen)||now-stamp+seen<0||now-stamp+seen>20||!number(a.alt_baro))continue;
    const rate=finite(a.baro_rate)?a.baro_rate:a.geom_rate;
    const miles=haversine(home.latitude,home.longitude,lat,lon),r=0.017453292519943295;
    const x=dLon(lon,home.longitude)*r*Math.cos((home.latitude+lat)/2*r)*3958.7613,y=(lat-home.latitude)*r*3958.7613;
    found.set(hex,{hex,callsign:ident(a.flight),registration:ident(a.r),latitude:lat,longitude:lon,
      heading:a.track,speed_kt:a.gs,altitude_ft:a.alt_baro,vertical_rate:finite(rate)?rate:null,
      observed:stamp-seen,live:true,miles,inside:typeof radius==='object'?inZone(radius,x,y):miles<=radius});
  }
  const rank=a=>Number(!(a.live&&a.inside));
  return [...found.values()].sort((a,b)=>rank(a)-rank(b)||b.observed-a.observed);
}

function bearing(lat1,lon1,lat2,lon2){
  const r=Math.PI/180,p1=lat1*r,p2=lat2*r,dl=(lon2-lon1)*r;
  return Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl));
}

// Select one plausible leg; `previous` [origin, destination] only breaks ties.
export function commercialRoute(payload,a,previous=null){
  if(!payload||typeof payload!=='object'||ident(payload.callsign)!==ident(a.callsign))return null;
  const airports=payload._airports;
  if(!Array.isArray(airports)||airports.length<2||airports.length>12)return null;
  if(airports.some(p=>!p||typeof p!=='object'||!position(p.lat,p.lon)))return null;
  const [lat,lon]=[a.latitude,a.longitude],heading=a.heading,climb=a.vertical_rate;
  const hasTrack=finite(heading,0,360)&&finite(a.speed_kt,120),hasClimb=finite(climb);
  const code=p=>ident(p.iata)||ident(p.icao);
  const legs=new Map();
  for(let i=0;i+1<airports.length;i++){
    const start=airports[i],end=airports[i+1],origin=code(start),destination=code(end);
    if(!origin||!destination||origin===destination)continue;
    const direct=haversine(start.lat,start.lon,end.lat,end.lon);
    const fromOrigin=haversine(lat,lon,start.lat,start.lon),toDestination=haversine(lat,lon,end.lat,end.lon);
    const detour=fromOrigin+toDestination-direct;
    if(detour>Math.max(DETOUR_MILES,DETOUR_SHARE*direct))continue;
    const departing=fromOrigin<=40&&40<toDestination,arriving=toDestination<=40&&40<fromOrigin;
    // Near one end of a leg, an arrival does not climb away and a departure does not descend;
    // neither cruises at airliner altitude within 25 mi of that airport.
    if(hasClimb&&((arriving&&climb>=1000)||(departing&&climb<=-1000)))continue;
    if(finite(a.altitude_ft,25000)&&Math.min(fromOrigin,toDestination)<=25)continue;
    // Track is useful en route, but turns near an airport must not decide
    // which half of a same-callsign round trip is in progress.
    let error=null;
    if(hasTrack&&Math.min(fromOrigin,toDestination)>25){
      const toward=((bearing(lat,lon,end.lat,end.lon)*180/Math.PI)%360+360)%360;
      error=Math.abs(((heading-toward+180)%360+360)%360-180);
      // Far from both ends a real leg points close to where the plane is heading.
      if(error>(Math.min(fromOrigin,toDestination)>100?45:100))continue;
    }
    legs.set(`${origin}>${destination}`,{origin,destination,detour,track_error:error,departing,arriving,start,end});
  }
  const candidates=[...legs.values()].sort((x,y)=>x.detour-y.detour);
  if(!candidates.length)return null;
  const nearby=candidates.filter(leg=>leg.detour-candidates[0].detour<30);
  let selected=nearby.length===1?nearby[0]:null;
  // Ties: en-route track, then a clear climb or descent near the shared airport,
  // then the leg already chosen for this flight. Otherwise the route stays blank.
  for(const chosen of [leg=>leg.track_error!==null&&leg.track_error<=60,
    leg=>hasClimb&&((climb<=-500&&leg.arriving)||(climb>=500&&leg.departing)),
    leg=>!!previous&&leg.origin===previous[0]&&leg.destination===previous[1]]){
    const matched=selected?[]:nearby.filter(chosen);
    if(matched.length===1)selected=matched[0];
  }
  if(!selected)return null;
  // Names and positions for the display (progress, city names); not used for matching.
  const place=(p,code)=>({code,name:typeof p.name==='string'?p.name.slice(0,80):'',
    city:typeof p.location==='string'?p.location.slice(0,40):'',lat:p.lat,lon:p.lon});
  return {origin:selected.origin,destination:selected.destination,flight:ident(a.callsign),
    source:'ADSB.lol',valid_from:a.observed-120,valid_until:a.observed+120,
    from:place(selected.start,selected.origin),to:place(selected.end,selected.destination)};
}

// Keep only what route selection reads, bounded: a route reply is remote data that is
// cached for hours and saved, so every field is typed and length-capped.
// Community-sourced text: control, formatting and invisible characters (bidi overrides,
// zero-width) are dropped, spaces collapsed, then capped. Airport codes are 3-4 of A-Z, 0-9.
const INVISIBLE=/[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;
export const text=(v,n)=>typeof v==='string'?v.replace(INVISIBLE,'').replace(/\s+/g,' ').trim().slice(0,n).trim():'';
const code=v=>{const s=String(v||'').trim().toUpperCase();return /^[A-Z0-9]{3,4}$/.test(s)?s:'';};
const slim=p=>({callsign:text(p.callsign,10),_airports:Array.isArray(p._airports)?p._airports.slice(0,12).map(x=>
  ({iata:code(x?.iata),icao:code(x?.icao),name:text(x?.name,60),location:text(x?.location,40),
    lat:finite(x?.lat)?x.lat:null,lon:finite(x?.lon)?x.lon:null})):[]});

// The integration's SQLite cache, as an expiring key/value map in localStorage.
const LOL_MAX=800;
export class Ledger {
  constructor(saved=null){
    // Only well-formed rows are kept: one damaged row in storage must not stop the feed. Nothing
    // here lasts more than a day, so a row expiring later is damage (or a TV clock that jumped
    // back): kept, it would hold a cached answer or a route-lookup pause for years. A route, route
    // answer or sighting is an object (a null route stopped the feed).
    const latest=Date.now()/1000+25*3600,obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
    this.rows=new Map(Object.entries(saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{}).filter(([k,r])=>r&&typeof r==='object'&&Number.isFinite(r.expires)&&r.expires<=latest&&(!/^(route|past-route|lol|sighting):/.test(k)||obj(r.value))));this.dirty=false;
  }
  get(k,now){const row=this.rows.get(k);return row&&row.expires>now?row.value:undefined;}
  put(k,value,expires,now){
    this.rows.set(k,{expires,value});this.dirty=true;
    // Expired rows go at most once a minute (a busy feed puts hundreds of rows a poll), and at once
    // when the TV clock has stepped back past the last time (else nothing went until it caught up).
    if(!(now-this.pruned<60)||now<this.pruned){
      this.pruned=now;for(const [key,row] of this.rows)if(!row||!(row.expires>now))this.rows.delete(key);
      // Route lookups are kept a day; past LOL_MAX the ones expiring soonest go.
      const lol=[...this.rows].filter(([key])=>key.startsWith('lol:'));
      if(lol.length>LOL_MAX)for(const [key] of lol.sort((a,b)=>a[1].expires-b[1].expires).slice(0,lol.length-LOL_MAX))this.rows.delete(key);
    }
  }
  delete(k){if(this.rows.delete(k))this.dirty=true;}
  // Live routes and past routes (for 'Recently above') each have their own quota, so a
  // busy wide map can't push the past ones out.
  routes(now){
    const pick=prefix=>[...this.rows].filter(([k,row])=>k.startsWith(prefix)&&row.expires>now).sort((a,b)=>b[1].expires-a[1].expires);
    return [...pick('past-route:').slice(0,40),...pick('route:').slice(0,100)].map(([,row])=>row.value);
  }
  toJSON(){return Object.fromEntries(this.rows);}
}

// The plane picked with Left/Right, once it has stayed on the card about a second (app.mjs,
// browse.mjs): its route is the next one asked for.
let routeFocus=()=>'';
export const setRouteFocus=fn=>{routeFocus=fn;};

export class Enricher {
  constructor(ledger,request){
    this.ledger=ledger;this.request=request;this.status='idle';
    // Lookups are paced on performance.now(), which a TV clock step doesn't move. A pause saved by
    // the feed before (a restart, the last launch) carries over, never longer than it was set for
    // (its seconds; the build before saved true, so its row holds to its expiry, up to 15 min).
    const row=ledger.rows.get('cooldown:adsblol'),left=Math.min(900,typeof row?.value==='number'?row.value:900,(row?.expires??0)-Date.now()/1000);
    this.next=left>0?performance.now()+left*1000:0;
  }
  publish(a,route,now){
    if(route){
      const entry={...route,hex:a.hex,callsign:ident(a.callsign),registration:ident(a.registration),expires:now+SIX_HOURS};
      this.ledger.put('route:'+key(a),entry,now+SIX_HOURS,now);
      // Preserve the route at the in-boundary sighting, independently of
      // later live positions, route rejection, and app restarts.
      if(a.inside&&(a.live||a.recovered))this.ledger.put('past-route:'+key(a),{...entry,historical:true},now+SIX_HOURS,now);
    }else if(a.live)this.ledger.delete('route:'+key(a));
  }
  previous(a,now){
    const route=this.ledger.get('route:'+key(a),now);
    return route&&route.valid_until>=a.observed-600?[route.origin,route.destination]:null;
  }
  async tick(aircraft,now){
    const L=this.ledger,free=[];
    for(const a of aircraft){
      if(provider(a)!=='adsblol')continue;
      if(a.live){
        if(a.inside)L.put('sighting:'+key(a),Object.fromEntries(SIGHTING.map(k=>[k,finite(a[k])?a[k]:null])),now+SIX_HOURS,now);
        free.push(a);
      }else if(now-a.observed<=1800&&!L.get('past-route:'+key(a),now)){
        // A lookup can miss the minute a plane spends inside the boundary;
        // retry from the last in-boundary position.
        const seen=L.get('sighting:'+key(a),now);
        if(seen&&Math.abs(seen.observed-a.observed)<=60)free.push({...a,...seen,recovered:true});
      }
    }
    const missing=[];
    for(const a of free){
      const cached=L.get('lol:'+ident(a.callsign),now);
      if(cached===undefined)missing.push(a);
      else if(cached._airports)this.publish(a,commercialRoute(slim(cached),a,this.previous(a,now)),now); // older caches were checked less
    }
    // At most one ADSB.lol request every 5 seconds; answers, misses and 404s cached 24 h; 15 min
    // pause after a 429, 1 min after other errors. The one asked for: the plane picked with
    // Left/Right (held), then inside the zone, then the nearest (the plane on the card).
    const wait=s=>{this.next=performance.now()+s*1000;L.put('cooldown:adsblol',s,now+s,now);};
    if(missing.length&&performance.now()>=this.next){
      wait(5);
      const f=routeFocus();
      const a=missing.sort((x,y)=>Number(y.hex===f)-Number(x.hex===f)||Number(!x.inside)-Number(!y.inside)||(x.miles??1e9)-(y.miles??1e9))[0],call=ident(a.callsign);
      const {status,payload}=await this.request(ROUTE_URL(call));
      this.status=String(status);
      if((status===200&&payload&&typeof payload==='object')||status===404){
        const data=payload&&typeof payload==='object'&&payload.callsign===call?slim(payload):{};
        L.put('lol:'+call,data,now+DAY,now);
        this.publish(a,commercialRoute(data,a,this.previous(a,now)),now);
      }else wait(status===429?900:60);
    }
    return L.routes(now);
  }
}

// --- The live source the display subscribes to.
// Backup positions (PROFILE.backup, adsb.lol), asked only while adsb.fi isn't answering: the
// same rounded point and distance, never on the same poll as adsb.fi, and at most once every
// 10 s (adsb.fi's interval when that is longer): adsb.lol answers a 5 s pace with a 429.
//  - Over to the backup after two failed adsb.fi polls in a row, or 15 s of failures (a long
//    back-off ahead). A failure: an error, no reply in time, any status but 200, or a reply
//    that isn't a feed (not JSON, or no aircraft list).
//  - On the backup, adsb.fi is asked about once a minute, in place of that poll's adsb.lol
//    request and never before its back-off and Retry-After allow. Its first good reply ends it.
//  - adsb.lol's errors back off as adsb.fi's do. A 429 waits out its Retry-After (at least
//    60 s) and slows adsb.lol to one request every 15, then 20 s; a 429 at 20 s, or any other
//    4xx, pauses its positions for 15 minutes (saved with the route lookups' pause). The pace
//    goes back to 10 s when adsb.fi returns. No receiver-coverage check on it.
// The outage outlives a feed restart (place, radius or zone changed): adsb.fi's back-off, Retry-After
// and 15 s mark are kept (a failure that lands after the restart counts too), and while adsb.fi is
// known to be down the new feed starts on the backup with both back-offs kept.
export const FAILOVER_MS=15000,PROBE_MS=60000,BACKUP_PAUSE_S=900,BACKUP_STEPS_S=[10,15,20];
const BACKUP_COOLDOWN='cooldown:adsblol-positions';
// Times are performance.now() ms: the TV's clock can step (an NTP correction) and must not stall the feed.
const CLEAR={down:false,fails:0,since:0,retryAt:0,lastAsked:-Infinity,backupFails:0,backupRetryAt:0,backupStep:0,lastBackupAt:-Infinity};
export const outage={...CLEAR};
// Receiver coverage (startLive) for the last place probed: kept across feed restarts too.
const UNCHECKED={url:'',none:false,checked:-Infinity};
let coverageOf={...UNCHECKED};
export const resetOutage=()=>{Object.assign(outage,CLEAR);coverageOf={...UNCHECKED};}; // tests
// config: CONFIG plus the saved place {latitude, longitude} and radiusMiles; paused: started while
// the app is hidden (a restart just before Home), so nothing is asked until resume().
export function startLive(show,config){
  // An update the display chokes on (a damaged saved value) is logged; the polling goes on.
  const onUpdate=(s,ok)=>{try{show(s,ok);}catch(e){console.error('feed update',e);}};
  const home={latitude:config.latitude,longitude:config.longitude};
  const radius=Math.max(1,Math.min(10,Number(config.radiusMiles)||3));
  const ledger=new Ledger(store.get(LEDGER_KEY)),enricher=new Enricher(ledger,url=>getJson(url,8000));
  let history=store.get(HISTORY_KEY)||[],routes=ledger.routes(Date.now()/1000),enriching=false,timer=null,stopped=false;
  // Recently above: in Window view only planes that passed through the window (or right above).
  const zone=config.zone?.kind==='window'?config.zone:radius;
  let states=build(null,0,selection([],0,home,zone,0));
  function build(ac,stamp,sel){
    const current=sel.current||{};
    return {
      [IDS.home]:{state:'zoning',attributes:{...home}},
      [IDS.radius]:{state:String(radius)},
      [IDS.feed]:{state:String(stamp),attributes:{ac:Array.isArray(ac)?ac:[]}},
      [IDS.current]:{state:sel.current?.hex||'none',attributes:{aircraft:current,latitude:current.latitude??null,
        longitude:current.longitude??null,feed_fresh:sel.feed_fresh}},
      [IDS.candidate]:{state:sel.candidate?.hex||'none',attributes:{aircraft:sel.candidate||{},feed_fresh:sel.feed_fresh,history}},
      [IDS.routes]:{state:String(routes.length),attributes:{routes}},
    };
  }
  async function enrich(ac,stamp,now,feedNow=now){
    if(enriching||stopped)return;
    enriching=true;
    try{
      routes=await enricher.tick(observations(ac,stamp,home,zone,history,feedNow),now);
      if(stopped)return; // a stopped feed (place or zone changed) must not render or save
      states={...states,[IDS.routes]:{state:String(routes.length),attributes:{routes}}};
      if(ledger.dirty){ledger.dirty=false;store.set(LEDGER_KEY,ledger);}
      onUpdate(states,true);
    }catch{/* Routes stay as they were; retried next poll. */}
    finally{enriching=false;}
  }
  // Receiver coverage: when the feed has nothing around home, ask (at most every 2 h, a restart
  // for a new radius or zone included) for the widest area adsb.fi serves; nothing there either
  // means no feeders, not quiet skies.
  const probe=feedUrlFor(home,MAX_NM),coverage=coverageOf.url===probe?coverageOf:(coverageOf={...UNCHECKED,url:probe});
  async function checkCoverage(nowMs){
    if(nowMs-coverage.checked<7200000)return;
    coverage.checked=nowMs;
    if(!probe)return;
    const {status,payload}=await getJson(probe,8000);
    if(status===200&&payload&&typeof payload==='object')coverage.none=!(Array.isArray(payload.ac)&&payload.ac.length);
  }
  // Back-off (adsb.fi etiquette; adsb.lol's errors too): network errors and 5xx double the wait
  // (with jitter) up to 5 min; a 429 waits at least 60 s and its Retry-After; any other 4xx
  // waits 5 min. `fails` counts this failure. Polling (and with it routes, the coverage probe
  // and the checks on adsb.fi) pauses while the app is hidden.
  const backoff=(status,retryAfter,fails)=>{
    const jitter=t=>Math.round(t*(.8+Math.random()*.4));
    if(status===429)return Math.min(300000,Math.max(60000,retryAfter*1000,jitter(config.pollSeconds*1000*2**fails)));
    if(typeof status==='number'&&status>=400&&status<500)return 300000;
    return Math.min(300000,Math.max(retryAfter*1000,jitter(config.pollSeconds*1000*2**(fails-1))));
  };
  // busy: a feed request is out; next: when the next poll is due; asked: when the last request went; good: the last data came in
  let paused=!!config.paused,busy=false,next=0,asked=-Infinity,good=false,hid=0;
  // When each feed may be asked next (ms). On the backup, adsb.fi about once a minute.
  const fiAt=()=>outage.down?Math.max(outage.retryAt,outage.lastAsked+PROBE_MS):outage.retryAt;
  // adsb.lol: one request every 10 s at most (15 or 20 s after its 429s; adsb.fi's interval if longer).
  const backupGap=()=>Math.max(config.pollSeconds,BACKUP_STEPS_S[outage.backupStep]||BACKUP_STEPS_S.at(-1))*1000;
  // The saved pause (a TV clock time, for the next launch) carries over as what is left of it. It is
  // remote-free local data, but storage can be damaged: a value that isn't a time, or one further
  // off than the longest pause the app sets (an hour), counts as none.
  {const t=Date.now(),v=Number(ledger.get(BACKUP_COOLDOWN,t/1000))*1000;
    if(Number.isFinite(v)&&v<=t+3600000)outage.backupRetryAt=Math.max(outage.backupRetryAt,performance.now()+v-t);}
  const backupAt=()=>Math.max(outage.backupRetryAt,outage.lastBackupAt+backupGap());
  // The one feed this poll asks, or null when neither may be asked yet.
  function pick(t){
    if(!outage.down&&outage.fails&&t-outage.since>=FAILOVER_MS)outage.down=true; // 15 s of failures
    if(t>=fiAt())return 'adsb.fi';
    return outage.down&&t>=backupAt()?'adsb.lol':null;
  }
  // The next poll: a poll interval after this one started (at least 1 s from now), and not
  // before a feed may be asked: while adsb.fi is failing, its retry (or the 15 s mark); on the
  // backup, the next check on adsb.fi or adsb.lol's next turn, whichever comes first.
  function schedule(started){
    const now=performance.now();
    const allowed=outage.down?Math.min(fiAt(),backupAt()):outage.fails?Math.min(outage.retryAt,outage.since+FAILOVER_MS):0;
    const at=outage.fails&&!outage.down?allowed:Math.max(now+1000,started+config.pollSeconds*1000,allowed);
    clearTimeout(timer);timer=setTimeout(poll,Math.max(0,at-now));
    return next=at;
  }
  // No data this poll: the display keeps its last picture a while, then counts down to `at`.
  const failed=at=>{good=false;states={...states,retryAt:at};onUpdate(states,false);};
  const fiFailed=(status,retryAfter,started)=>{
    if(!outage.fails)outage.since=started;
    outage.retryAt=performance.now()+backoff(status,retryAfter||0,++outage.fails);
    if(outage.fails>=2)outage.down=true; // two in a row
  };
  async function poll(){
    if(stopped||paused||busy)return;
    const started=performance.now(),feed=pick(started);
    if(!feed){schedule(started);return;}
    const backup=feed!=='adsb.fi';
    const url=feedUrlFor(home,config.searchNm,backup?BACKUP_URL:FEED_URL);
    if(backup)outage.lastBackupAt=started;else outage.lastAsked=started;
    busy=true;asked=started;
    // Wide areas are big replies: more time to arrive (4 s up to 25 NM, 12 s at 250).
    const {status,payload,retryAfter}=url?await getJson(url,Math.min(12000,4000+config.searchNm*32)):{status:0};
    busy=false;
    const reply=status===200?(backup?fromBackup(payload):feedReply(payload)):null,stamp=feedStamp(reply),now=Date.now()/1000;
    // The TV's clock can be off by seconds, minutes or days: positions are judged against
    // the feed's own clock (it was just received), and the offset goes to the display. Up to
    // a week either way is trusted (a TV left with a wrong date). A reply with no usable clock
    // (none, not a number, or further off) is a failed poll, as a 5xx: none of its positions can
    // be judged (adsb.lol stands in), and a broken feed can't move the logbook's day far.
    const body=stamp>0&&Math.abs(stamp-now)<7*86400?reply:null;
    // A reply that lands while hidden or after a restart is dropped; adsb.fi's failure still counts.
    if(stopped||paused){if(!body&&!backup)fiFailed(status,retryAfter,started);return;}
    if(body){
      const ac=oneEach(body.ac),skew=stamp-now,feedNow=now+skew;
      const sel=selection(ac,stamp,home,zone,feedNow);
      if(sel.inside.length){history=mergeHistory(history,sel.inside);store.set(HISTORY_KEY,history);}
      // The coverage check is adsb.fi's widest query: never sent to the backup, which can't
      // tell "no receivers here" either.
      if(ac.length)coverage.none=false;else if(!backup){busy=true;await checkCoverage(performance.now());busy=false;}
      if(stopped)return;
      if(backup)outage.backupFails=0;else Object.assign(outage,{down:false,fails:0,since:0,retryAt:0,backupFails:0,backupStep:0});
      good=true;
      states={...build(ac,stamp,sel),coverage:{none:!backup&&coverage.none},skew,source:feed};
      onUpdate(states,true);
      enrich(ac,stamp,now,feedNow);
      schedule(started);
    }else if(backup){
      const now=performance.now();
      // A 429: wait out its Retry-After (at least 60 s, at most an hour), then one request every
      // 15, then 20 s. A 429 at 20 s, or any other 4xx: no adsb.lol positions for 15 minutes (or
      // a longer Retry-After, up to an hour), as for its route lookups (kept here for a feed
      // restart, and saved for the next launch).
      const wait=Math.min(3600,Number(retryAfter)||0);
      if(status===429&&outage.backupStep<BACKUP_STEPS_S.length-1){
        outage.backupStep++;outage.backupRetryAt=now+Math.max(60,wait)*1000;
      }else if(typeof status==='number'&&status>=400&&status<500){
        const pause=Math.max(BACKUP_PAUSE_S,wait),tv=Date.now()/1000;outage.backupRetryAt=now+pause*1000;
        ledger.put(BACKUP_COOLDOWN,tv+pause,tv+pause,tv);ledger.dirty=false;store.set(LEDGER_KEY,ledger);
      }else outage.backupRetryAt=now+backoff(status,retryAfter||0,++outage.backupFails);
      failed(schedule(started));
    }else{
      fiFailed(status,retryAfter,started);
      const at=schedule(started);
      // A failed check on adsb.fi while adsb.lol's positions are coming in changes nothing shown.
      if(!(outage.down&&good))failed(at);
    }
  }
  onUpdate(states,false);
  if(!paused)poll();
  return {stop(){stopped=true;clearTimeout(timer);},
    pause(){paused=true;clearTimeout(timer);hid=Date.now();},
    // Back on screen: the next poll when it is due (at once after a hide longer than the interval;
    // a back-off kept), never within a second of the last request, nor while one is out (it carries on).
    // The TV clock times the hide too: a standby may not move performance.now() (one early poll at most
    // if the clock was put forward meanwhile).
    resume(){if(!paused)return;paused=false;clearTimeout(timer);const t=performance.now(),away=Date.now()-hid;
      if(!busy)timer=setTimeout(poll,Math.max(0,away>config.pollSeconds*1000?0:next-t,asked+1000-t));}};
}
