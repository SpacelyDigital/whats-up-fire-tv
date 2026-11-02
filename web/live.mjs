// Standalone data source: builds the HA-shaped `states` the display already
// reads, from adsb.fi positions and ADSB.lol standing routes. Ports the
// selection/history template in home_assistant/packages/aircraft-package.yaml
// and the free (ADSB.lol) part of custom_components/office_aircraft_routes/model.py.
import {PROFILE} from './profile.mjs';
import {IDS,number,coordinates,inZone,snapped,GRID_PAD_NM,dLon} from './core.mjs';

const HOUR=3600,SIX_HOURS=6*HOUR,DAY=24*HOUR;
export const HISTORY_KEY='whatsup.history.v1',LEDGER_KEY='whatsup.ledger.v1';
// adsb.fi serves at most 250 NM around a point.
export const MAX_NM=250;
// Positions: adsb.fi (personal profile) or adsb.lol (store profile); same readsb reply.
export const FEED_URL=(lat,lon,nm)=>PROFILE.feedUrl(lat,lon,nm);
// The feed query for home: the snapped grid point, the distance widened to still cover
// everything around the true home (filtered by true distance on the TV), at most MAX_NM.
// Null when anything is malformed, so nothing odd is ever sent.
export function feedUrlFor(home,nm){
  const c=snapped(home),d=Math.min(MAX_NM,Math.ceil(Number(nm)+GRID_PAD_NM));
  if(!coordinates(c.latitude,c.longitude)||!(d>0))return null;
  return FEED_URL(c.latitude,c.longitude,d);
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
// OpenFreeMap requests (TileJSON too) share the tile slots below.
export function getJson(url,timeoutMs=8000){
  if(/^https:\/\/[\w.-]*openfreemap\.org\//.test(url))return tileSlot().then(()=>rawGetJson(url,timeoutMs)).finally(tileFree);
  return rawGetJson(url,timeoutMs);
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
// the maps then keep what's saved. Resolves bytes or null.
const TILE_PARALLEL=4;
let tileSlots=TILE_PARALLEL,tileCooldown=0,tileStrikes=0;const tileQueue=[];
const tileSlot=()=>tileSlots>0?(tileSlots--,Promise.resolve()):new Promise(r=>tileQueue.push(r));
const tileFree=()=>{const next=tileQueue.shift();if(next)next();else tileSlots++;};
export const tileStats={inFlight:0,peak:0,requests:0,bytes:0};
function tileStatus(status){
  if(status===200){tileStrikes=0;return;}
  if(status===429||status===403||(typeof status==='number'&&status>=500)){
    tileCooldown=Date.now()+Math.min(600000,60000*2**tileStrikes++);
  }
}
export async function getBytes(url,timeoutMs=10000){
  if(Date.now()<tileCooldown)return null;
  await tileSlot();
  tileStats.inFlight++;tileStats.peak=Math.max(tileStats.peak,tileStats.inFlight);tileStats.requests++;
  try{
    if(Date.now()<tileCooldown)return null;
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
    // Only well-formed rows are kept: one damaged row in storage must not stop the feed.
    this.rows=new Map(Object.entries(saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{}).filter(([,r])=>r&&typeof r==='object'&&Number.isFinite(r.expires)));this.dirty=false;
  }
  get(k,now){const row=this.rows.get(k);return row&&row.expires>now?row.value:undefined;}
  put(k,value,expires,now){
    this.rows.set(k,{expires,value});this.dirty=true;
    // Expired rows go at most once a minute (a busy feed puts hundreds of rows a poll).
    if(!(now-this.pruned<60)){
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

export class Enricher {
  constructor(ledger,request){this.ledger=ledger;this.request=request;this.status='idle';}
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
    // pause after a 429, 1 min after other errors. The
    // one asked for: inside the zone first, then the nearest (the plane on the card).
    if(missing.length&&!L.get('cooldown:adsblol',now)){
      L.put('cooldown:adsblol',true,now+5,now);
      const a=missing.sort((x,y)=>Number(!x.inside)-Number(!y.inside)||(x.miles??1e9)-(y.miles??1e9))[0],call=ident(a.callsign);
      const {status,payload}=await this.request(ROUTE_URL(call));
      this.status=String(status);
      if((status===200&&payload&&typeof payload==='object')||status===404){
        const data=payload&&typeof payload==='object'&&payload.callsign===call?slim(payload):{};
        L.put('lol:'+call,data,now+DAY,now);
        this.publish(a,commercialRoute(data,a,this.previous(a,now)),now);
      }else L.put('cooldown:adsblol',true,now+(status===429?900:60),now);
    }
    return L.routes(now);
  }
}

// --- The live source the display subscribes to.
// config: CONFIG plus the saved place {latitude, longitude} and radiusMiles.
export function startLive(onUpdate,config){
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
  // Receiver coverage: when the feed has nothing around home, ask (at most every 2 h) for
  // the widest area adsb.fi serves; nothing there either means no feeders, not quiet skies.
  let coverage={none:false,checked:0};
  async function checkCoverage(nowMs){
    if(nowMs-coverage.checked<7200000)return;
    coverage.checked=nowMs;
    const url=feedUrlFor(home,MAX_NM);if(!url)return;
    const {status,payload}=await getJson(url,8000);
    if(status===200&&payload&&typeof payload==='object')coverage.none=!(Array.isArray(payload.ac)&&payload.ac.length);
  }
  // Back-off (adsb.fi etiquette): network errors and 5xx double the wait (with jitter) up
  // to 5 min; a 429 waits at least 60 s and its Retry-After; any other 4xx waits 5 min.
  // Polling (and with it routes and the coverage probe) pauses while the app is hidden.
  let fails=0,paused=false,gen=0; // gen: a poll started before a pause/resume is dropped
  const backoff=(status,retryAfter)=>{
    fails++;
    const jitter=t=>Math.round(t*(.8+Math.random()*.4));
    if(status===429)return Math.min(300000,Math.max(60000,retryAfter*1000,jitter(config.pollSeconds*1000*2**fails)));
    if(typeof status==='number'&&status>=400&&status<500)return 300000;
    return Math.min(300000,Math.max(retryAfter*1000,jitter(config.pollSeconds*1000*2**(fails-1))));
  };
  async function poll(){
    if(stopped||paused)return;
    const my=gen,started=Date.now();
    const url=feedUrlFor(home,config.searchNm);
    // Wide areas are big replies: more time to arrive (4 s up to 25 NM, 12 s at 250).
    const {status,payload,retryAfter}=url?await getJson(url,Math.min(12000,4000+config.searchNm*32)):{status:0};
    if(stopped||paused||my!==gen)return;
    if(status===200&&payload&&typeof payload==='object'){
      const now=Date.now()/1000,stamp=feedStamp(payload),ac=Array.isArray(payload.ac)?payload.ac:[];
      // The TV's clock can be off by seconds, minutes or days: positions are judged against
      // the feed's own clock (it was just received), and the offset goes to the display. Any
      // plausible feed time is trusted (2023 to 2100); only a nonsense stamp is ignored.
      const skew=stamp>1.7e9&&stamp<4.1e9?stamp-now:0,feedNow=now+skew;
      const sel=selection(ac,stamp,home,zone,feedNow);
      if(sel.inside.length){history=mergeHistory(history,sel.inside);store.set(HISTORY_KEY,history);}
      if(ac.length)coverage.none=false;else await checkCoverage(Date.now());
      if(stopped)return;
      states={...build(ac,stamp,sel),coverage:{none:coverage.none},skew};
      fails=0;
      onUpdate(states,true);
      enrich(ac,stamp,now,feedNow);
      timer=setTimeout(poll,Math.max(1000,config.pollSeconds*1000-(Date.now()-started)));
    }else{
      const wait=backoff(status,retryAfter||0);
      states={...states,retryAt:Date.now()+wait};
      onUpdate(states,false);
      timer=setTimeout(poll,wait);
    }
  }
  onUpdate(states,false);
  poll();
  return {stop(){stopped=true;clearTimeout(timer);},
    pause(){paused=true;gen++;clearTimeout(timer);},
    // Back on screen: poll now, unless the service asked to wait (back-off kept).
    resume(){if(!paused)return;paused=false;gen++;clearTimeout(timer);timer=setTimeout(poll,Math.max(0,(states.retryAt||0)-Date.now()));}};
}
