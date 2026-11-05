// Maps, built on the device for wherever home is. OpenMapTiles vector tiles from
// OpenFreeMap (free, no key; attribution required) are decoded with
// @mapbox/vector-tile + pbf (web/mvt.js) into plain arrays in miles east/north of
// home, and saved, so tiles are fetched once per location.
// * base (z10, the 10-mile scope): water, rivers, motorways/trunk roads, runways,
//   airport labels, motorway shields and town names. Every layout uses it.
// * detail (z12 over ~6.5 mi, plus z14 buildings within ~1.3 mi): every road class,
//   rail, waterways, landuse, parks, aeroways and place names. Built only when a
//   layout asks for it (Atlas, Glass, Blueprint, ...).
import {getJson,getBytes,store} from './live.mjs';
import {snapped,GRID_PAD_MI,number,dLon as eastOf} from './core.mjs';

export const MAP_ATTRIBUTION='© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';
const TILEJSON='https://tiles.openfreemap.org/planet';
const TILE_URL=/^https:\/\/tiles\.openfreemap\.org\/planet\/[\w.-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/;
const KEY='whatsup.map.v2',VERSION=5,MAX_AGE=30*86400000; // v3: airfields, v4: shore, v5: no tile failed or empty (a v4 map can be blank or have holes)
// Built within the last 30 days. A map "built" in the future (damage, or a TV clock that was
// ahead) counts as old, so it is rebuilt rather than kept for ever.
const freshMap=m=>{const age=Date.now()-m.built;return age>=0&&age<MAX_AGE;};
const DETAIL_KEY='whatsup.detail.v1',DETAIL_VERSION=5; // v2: shore, v3: whole-radius reach, v4: inner side streets, v5: as VERSION
// z10: one tile is ~19 mi wide at 40° latitude, so a 10-mile scope needs 4-9 tiles,
// and z10 already carries runways and IATA-coded airport labels. Wider map radii use
// lower zooms (fewer, coarser tiles: 2-9 at any radius); OpenMapTiles drops minor
// features at low zooms by itself.
const ZOOM=10;
export const zoomFor=range=>range<=15?10:range<=25?9:range<=50?8:range<=100?7:6;
// Small airfields are only in z10 tiles (lower zooms carry international airports only),
// so maps up to this radius read their labels from z10 tiles too (one extra pass).
export const AIRFIELD_MAX_RANGE=50;
// The street-detail map is drawn up to a 15-mile map radius; wider views draw the base map.
export const DETAIL_MAX_RANGE=15;
const STREETS=new Set(['motorway','trunk','primary','secondary','tertiary','minor','service']),MAJOR=new Set(['motorway','trunk','primary','secondary']);
const DETAIL_ROADS=new Set(['motorway','trunk','primary','secondary','tertiary','minor','service','rail']);
const LANDUSE=new Set(['residential','commercial','industrial','retail','cemetery','hospital','school','university','college',
  'stadium','railway','military','pitch','zoo','theme_park','playground']);
const PLACES=new Set(['city','town','village','suburb','neighbourhood','quarter']);

const DEG=Math.PI/180;
const tileX=(lon,z)=>(lon+180)/360*2**z;
const tileY=(lat,z)=>{const s=Math.sin(lat*DEG);return (.5-Math.log((1+s)/(1-s))/(4*Math.PI))*2**z;};
const lonOf=(x,z)=>x/2**z*360-180;
const latOf=(y,z)=>Math.atan(Math.sinh(Math.PI-2*Math.PI*y/2**z))/DEG;

// Douglas-Peucker on [x,y] miles.
function simplify(pts,tol){
  if(pts.length<3)return pts;
  const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;
  const stack=[[0,pts.length-1]];
  while(stack.length){
    const [a,b]=stack.pop(),[ax,ay]=pts[a],[bx,by]=pts[b],dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
    let worst=0,at=-1;
    // A closed ring starts and ends on the same point: measure from that point.
    for(let i=a+1;i<b;i++){
      const d=len<1e-9?Math.hypot(pts[i][0]-ax,pts[i][1]-ay):Math.abs(dy*(pts[i][0]-ax)-dx*(pts[i][1]-ay))/len;
      if(d>worst){worst=d;at=i;}
    }
    if(worst>tol){keep[at]=1;stack.push([a,at],[at,b]);}
  }
  return pts.filter((_,i)=>keep[i]);
}
const rounder=k=>pts=>pts.map(([x,y])=>[Math.round(x*k)/k,Math.round(y*k)/k]);
const round=rounder(100);

// Lines: keep the runs that come within the box (plus one point either side).
function clipLine(pts,lim){
  const runs=[];let run=null;
  const inside=([x,y])=>Math.abs(x)<=lim&&Math.abs(y)<=lim;
  for(let i=0;i<pts.length;i++){
    const near=inside(pts[i])||(i>0&&inside(pts[i-1]))||(i+1<pts.length&&inside(pts[i+1]));
    if(near){(run||(run=[])).push(pts[i]);}else if(run){runs.push(run);run=null;}
  }
  if(run)runs.push(run);
  return runs.filter(r=>r.length>1);
}
const touches=(pts,lim)=>{
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const [x,y] of pts){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  return x1>=-lim&&x0<=lim&&y1>=-lim&&y0<=lim;
};

// No TileJSON or a tile not fetched: the network, not a fault (the app logs it as a warning).
const netError=m=>Object.assign(new Error(m),{net:true});
// The tile URL (it names the current planet build) is asked for once an hour, not per build.
const templates=new Map(); // keyed by the fetch function (the app's is always the same)
async function tileTemplate(net){
  const known=templates.get(net.getJson);if(known&&Date.now()-known.at<3600000)return known.url;
  const {status,payload}=await net.getJson(TILEJSON,8000);
  const url=status===200&&Array.isArray(payload?.tiles)?payload.tiles[0]:'';
  if(!TILE_URL.test(url))throw netError(`tilejson ${status}`);
  templates.set(net.getJson,{url,at:Date.now()});
  return url;
}

// Calls fn(tile, helpers) for each tile at `zoom` covering `lim` miles around home.
// Tiles are decoded one at a time so only one is in memory. Returns the number fetched.
// The tile set is chosen around the snapped grid point (core.mjs), widened to still cover
// `lim` around the true home, so tile requests only reveal the grid cell; geometry is still
// measured from the true home, and callers keep only what lies within `lim` of it.
// A tile that fails twice fails the whole build (a map with a hole was saved for 30 days);
// `alive()` false (the user moved on) stops it between tiles.
export const STALE='stale';
const MAX_TILES=90;
async function eachTile(home,lim,zoom,template,net,MVT,fn,alive=()=>true,requireData=false){
  const cos=Math.cos(home.latitude*DEG);
  const toMiles=(lon,lat)=>[eastOf(lon,home.longitude)*69.172*cos,(lat-home.latitude)*69.0];
  const c=snapped(home),wide=lim+GRID_PAD_MI,ccos=Math.cos(c.latitude*DEG);
  const dLat=wide/69,dLon=wide/(69.172*ccos);
  // Far north or south a mile spans more tiles: step down up to two zooms to stay within
  // MAX_TILES (Alaska and Nordic homes asked for hundreds). Rows stop at the tile grid's top
  // and bottom (~85°): near the poles the wide radii asked for rows past them (-1: refused).
  let x0,x1,y0,y1;
  for(let z=zoom;;z--){
    x0=Math.floor(tileX(c.longitude-dLon,z));x1=Math.floor(tileX(c.longitude+dLon,z));
    y0=Math.max(0,Math.floor(tileY(c.latitude+dLat,z)));y1=Math.min(2**z-1,Math.floor(tileY(c.latitude-dLat,z)));
    if((x1-x0+1)*(y1-y0+1)<=MAX_TILES||z<=Math.max(2,zoom-2)){zoom=z;break;}
  }
  const n=2**zoom;
  let fetched=0,withData=0;
  for(let tx=x0;tx<=x1;tx++)for(let ty=y0;ty<=y1;ty++){
    if(!alive())throw new Error(STALE);
    // Across the date line the tile column wraps (geometry keeps the unwrapped column, so it
    // still lands east or west of home correctly).
    const url=template.replace('{z}',zoom).replace('{x}',((tx%n)+n)%n).replace('{y}',ty);
    let bytes=await net.getBytes(url);
    if(!bytes){await new Promise(r=>setTimeout(r,1500));if(!alive())throw new Error(STALE);bytes=await net.getBytes(url);}
    if(!bytes)throw netError('map tile unavailable'); // no tile numbers: they place the home
    fetched++;
    const tile=new MVT.VectorTile(new MVT.Pbf(bytes));
    if(Object.keys(tile.layers).length)withData++;
    const each=(name,f)=>{const layer=tile.layers[name];if(layer)for(let i=0;i<layer.length;i++)f(layer.feature(i),layer.extent);};
    const geom=(f,extent)=>f.loadGeometry().map(ring=>ring.map(p=>toMiles(lonOf(tx+p.x/extent,zoom),latOf(ty+p.y/extent,zoom))));
    const point=(f,extent)=>{const [[p]]=f.loadGeometry();return toMiles(lonOf(tx+p.x/extent,zoom),latOf(ty+p.y/extent,zoom));};
    // A polygon's real outline: its rings minus the edges where the tile cut it (both ends
    // on or past the same tile edge). Stroking whole rings drew every tile's border as a
    // grid over lakes and seas; the next tile draws the shore that lies past this one's edge.
    const shore=(f,extent)=>{
      const runs=[],cut=(a,b)=>a.x<=0&&b.x<=0||a.x>=extent&&b.x>=extent||a.y<=0&&b.y<=0||a.y>=extent&&b.y>=extent;
      const mi=p=>toMiles(lonOf(tx+p.x/extent,zoom),latOf(ty+p.y/extent,zoom));
      for(const ring of f.loadGeometry()){
        let run=[];
        for(let i=1;i<ring.length;i++){
          if(cut(ring[i-1],ring[i])){if(run.length>1)runs.push(run);run=[];continue;}
          if(!run.length)run.push(mi(ring[i-1]));run.push(mi(ring[i]));
        }
        if(run.length>1)runs.push(run);
      }
      return runs;
    };
    fn({each,geom,point,shore});
  }
  // Every tile empty (even open sea carries a water layer): something answered 200 with
  // nothing. That is a failed build, never a blank map saved for 30 days.
  if(requireData&&fetched&&!withData)throw new Error('map tiles empty'); // main passes only: the small extra passes may be empty
  return fetched;
}
const nameOf=pr=>String(pr.name_en||pr['name:en']||pr.name_int||pr.name||'').slice(0,60);

// Build the map for home; `range` in miles. Throws when tiles can't be fetched.
// detail: a close-up street map (Adjust position) instead of the radar's major roads.
// `net` and `MVT` are replaceable for tests.
export async function buildMap(home,range,{net={getJson,getBytes},MVT=globalThis.window?.WhatsUpMVT,zoom=zoomFor(range),detail=false,alive=()=>true}={}){
  if(!MVT)throw new Error('mvt.js missing');
  // Wide layouts (Glass) show ~1.5x the radius sideways; the 10-mile map keeps its original reach.
  const lim=range<=10?range+1.5:range*1.5,k=Math.max(1,range/10); // simplify/clip coarser as the view widens
  const template=await tileTemplate(net);
  const out={v:VERSION,latitude:home.latitude,longitude:home.longitude,range,zoom,built:Date.now(),
    water:[],shore:[],rivers:[],roads:[],runways:[],airports:[],airfields:[],shields:[],places:[]};
  const shields=new Map(),places=new Map();
  const fetched=await eachTile(home,lim,zoom,template,net,MVT,({each,geom,point,shore})=>{
    const lines=(f,extent,tol)=>geom(f,extent).flatMap(l=>clipLine(l,lim)).map(l=>round(simplify(l,tol)));
    each('water',(f,e)=>{
      if(f.type!==3)return;
      for(const ring of geom(f,e))if(ring.length>3&&touches(ring,lim)){const r=simplify(ring,.04*k);if(r.length>3)out.water.push(round(r));}
      for(const l of shore(f,e).flatMap(l=>clipLine(l,lim)))out.shore.push(round(simplify(l,.04*k)));
    });
    each('waterway',(f,e)=>{if(f.type===2&&f.properties.class==='river')out.rivers.push(...lines(f,e,.04*k));});
    each('transportation',(f,e)=>{
      const c=f.properties.class;
      const wanted=detail?STREETS.has(c):c==='motorway'||c==='trunk';
      if(f.type===2&&wanted&&!f.properties.ramp)
        for(const l of lines(f,e,detail?.005:.03*k))out.roads.push({c,major:detail?MAJOR.has(c):c==='motorway',p:l});
    });
    each('transportation_name',(f,e)=>{
      const ref=String(f.properties.ref||'').trim();
      if(f.type!==2||f.properties.class!=='motorway'||!ref||ref.length>8)return;
      for(const l of geom(f,e)){
        const mid=l[Math.floor(l.length/2)];
        const d=Math.hypot(...mid);
        if(d<range-1.5&&(!shields.has(ref)||shields.get(ref).d>d))shields.set(ref,{ref,x:mid[0],y:mid[1],d});
      }
    });
    each('aeroway',(f,e)=>{
      if(f.properties.class!=='runway')return;
      if(f.type===2)out.runways.push(...lines(f,e,.01));
      else if(f.type===3)for(const ring of geom(f,e))if(touches(ring,lim))out.runways.push(round(ring));
    });
    each('aerodrome_label',(f,e)=>{
      if(f.type!==1)return;
      const pr=f.properties,[x,y]=point(f,e);
      const code=String(pr.iata||pr.icao||'').toUpperCase();
      if(Math.hypot(x,y)>range*1.5+12)return;
      // Every airfield, coded or not (Atlas labels them all); `airports` stays the coded ones.
      const name=nameOf(pr);
      if(name&&out.airfields.length<200&&!out.airfields.some(a=>a.name===name))
        out.airfields.push({name,code:String(pr.iata||pr.icao||'').toUpperCase(),iata:String(pr.iata||''),
          kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
      if(!code||Math.hypot(x,y)>range+12)return;
      if(out.airports.some(a=>a.code===code))return;
      out.airports.push({code,iata:String(pr.iata||''),icao:String(pr.icao||''),name:nameOf(pr),
        kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
    });
    each('place',(f,e)=>{
      const pr=f.properties,c=String(pr.class||'');
      if(f.type!==1||!['city','town','suburb'].includes(c))return;
      const name=nameOf(pr),[x,y]=point(f,e);
      if(!name||Math.abs(x)>lim||Math.abs(y)>lim||places.has(name))return;
      places.set(name,{name,c,rank:Number(pr.rank)||20,x:Math.round(x*100)/100,y:Math.round(y*100)/100});
    });
  },alive,true);
  if(!fetched)throw new Error('no tiles');
  if(zoom<10&&range<=AIRFIELD_MAX_RANGE){
    const flim=range*.85; // Atlas, the layout that shows airfields, sees ~0.7x the radius sideways
    await eachTile(home,flim,10,template,net,MVT,({each,point})=>each('aerodrome_label',(f,e)=>{
      if(f.type!==1)return;
      const pr=f.properties,name=nameOf(pr),[x,y]=point(f,e);
      if(!name||Math.abs(x)>flim||Math.abs(y)>flim||out.airfields.length>=200||out.airfields.some(a=>a.name===name))return;
      out.airfields.push({name,code:String(pr.iata||pr.icao||'').toUpperCase(),iata:String(pr.iata||''),
        kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
    }),alive);
  }
  out.shields=[...shields.values()].map(({ref,x,y})=>({ref,x:Math.round(x*100)/100,y:Math.round(y*100)/100}));
  const order={city:0,town:1,suburb:2};
  out.places=[...places.values()].sort((a,b)=>order[a.c]-order[b.c]||a.rank-b.rank).slice(0,40);
  const rank={international:0,public:1,regional:1,military:2};
  out.airports.sort((a,b)=>(rank[a.kind]??3)-(rank[b.kind]??3)||Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y));
  out.airfields.sort((a,b)=>(rank[a.kind]??3)-(rank[b.kind]??3)||!a.code-!b.code||Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y));
  return out;
}

// Saved maps: one per map radius (each at its own tile zoom), the current radius plus the
// one before kept. A saved map near this home (within ~1 km: drawing shifts it), younger
// than 30 days, else null; with {stale:true} an older one too (shown while a new one is
// built, so an offline launch isn't blank). The 10-mile map keeps the original key, so
// maps saved before map radius existed still count.
const keyFor=range=>range===10?KEY:`${KEY}.r${range}`;
const RECENT_KEY='whatsup.map.recent',KEEP_MAPS=2;
const recentMaps=()=>{const r=store.get(RECENT_KEY);return Array.isArray(r)?r:[];}; // a damaged value counts as none
// Every layer as buildMap writes it: lines and rings of [x,y], roads {c,p}, labels with text and x/y.
// A damaged one (storage) is dropped and the map built again: the layouts' drawing threw on it for 30 days.
const line=l=>Array.isArray(l)&&l.every(p=>Array.isArray(p)&&number(p[0])&&number(p[1]));
const label=k=>f=>typeof f?.[k]==='string'&&number(f.x)&&number(f.y);
const LAYERS={water:line,shore:line,rivers:line,runways:line,roads:f=>line(f?.p),airports:label('code'),airfields:label('name'),shields:label('ref'),places:label('name')};
export function savedMap(home,range,{stale=false}={}){
  const m=store.get(keyFor(range));
  const same=m&&m.v===VERSION&&m.range===range&&Math.abs(m.latitude-home.latitude)<.01&&
    Math.abs(eastOf(m.longitude,home.longitude))<.01&&(stale||freshMap(m));
  if(same&&!Object.entries(LAYERS).every(([k,ok])=>Array.isArray(m[k])&&m[k].every(ok))){store.remove(keyFor(range));return null;}
  return same?m:null;
}
export function saveMap(m){
  const recent=[m.range,...recentMaps().filter(r=>r!==m.range)];
  for(const r of recent.slice(KEEP_MAPS))store.remove(keyFor(r));
  store.set(RECENT_KEY,recent.slice(0,KEEP_MAPS));
  if(store.set(keyFor(m.range),m))return true;
  // Storage full: drop the other saved maps (not this radius's) and try once more.
  evictMaps({keepBase:m.range});
  if(store.set(keyFor(m.range),m))return true;
  console.error(`map ${m.range} mi not saved: storage full`);return false;
}
// Frees saved maps, oldest kinds first: wide detail, then the other detail slots, then
// base maps for other radii.
// Any other save that finds storage full (logbook, settings) frees the saved maps but the
// newest base map.
store.onFull=()=>evictMaps({keepBase:recentMaps()[0]??null});
// Written only by unreleased builds of 5 November 2026 (a list of street maps, one map per wider size), never read:
// dropped with the slots, so a device that ran one of them is not left with storage full until Erase all data.
const DEAD_KEYS=['whatsup.detail.recent',...[15,25,50,100,150,250].map(r=>`${DETAIL_KEY}.r${r}`)];
const dropDetail=keep=>{for(const k of [`${DETAIL_KEY}.wide`,`${DETAIL_KEY}.r10`,DETAIL_KEY,...DEAD_KEYS])if(k!==keep)try{localStorage.removeItem(k);}catch{/* none */}};
export function evictMaps({keepBase=null,keepDetail=null}={}){
  dropDetail(keepDetail);
  for(const r of recentMaps())if(r!==keepBase)store.remove(keyFor(r));
  store.set(RECENT_KEY,keepBase?[keepBase]:[]);
}

// --- Detail map. Coordinates in thousandths of a mile (~5 ft). Each line or ring is
// saved as a delta-encoded string ("x,y,dx,dy,...") and decoded into an Int16Array,
// so ~150k points cost ~0.8 MB saved and ~0.6 MB in memory instead of nested arrays.
// Buildings are capped (nearest first) to stay well under the localStorage quota.
export const DETAIL_RANGE=6.5,BUILDING_RANGE=1.3;
// The detail map for a map radius: how far it reaches (Atlas shows ~0.7x the radius
// sideways), from which tile zoom, and whether it has buildings. Up to 15 mi it is the
// full street map (z12 + z14 buildings). Wider, it is a mid-detail map from the most
// detailed zoom that keeps it to ~16-36 tiles: roads by class as far as that zoom
// carries them, land use, parks and woods, water, streams, rail, towns and villages.
// Maps show the whole radius top to bottom and ~1.4x it sideways, so each reaches 1.4x.
// At 10 and 15 mi the side streets (z12 minor/service) come from an inner area only,
// INNER_STREETS mi around home, fading out over its last mile (paintMap). Side streets all
// the way out measured ~6 MB saved at 15 mi in Chicago (vs 2.5 MB for the old street map),
// too much for the stick's storage; this way it is ~2.3 MB.
export const INNER_STREETS=8;
const DETAIL_SPECS=[[2,DETAIL_RANGE,12,BUILDING_RANGE,0],[5,DETAIL_RANGE,12,BUILDING_RANGE,0],[10,14,11,0,INNER_STREETS],
  [15,21,11,0,INNER_STREETS],[25,35,10,0,0],[50,70,9,0,0],[100,140,8,0,0],[150,210,7,0,0],[250,350,7,0,0]];
export function detailSpec(mapMiles){
  const [max,range,zoom,buildings,inner]=DETAIL_SPECS.find(([max])=>mapMiles<=max)||DETAIL_SPECS[DETAIL_SPECS.length-1];
  return {range,zoom,buildings,inner,key:buildings?'street':`r${max}`};
}
// A built detail map serves a spec when it is the same kind, at least as far, same zoom.
export const detailFits=(m,spec)=>!!m&&(m.key||'street')===spec.key&&m.range>=spec.range&&(m.zoom||12)===spec.zoom;
const MAX_BUILDING_POINTS=40000;
// Points per mile: 1000 (~5 ft) for street maps; wide maps use fewer so ±1.6x their reach
// still fits an Int16. Clamped: the extra point clipLine keeps past the edge can be far out.
const perMile=range=>Math.min(1000,Math.floor(20000/range));
const encoder=per=>{
  const int16=v=>Math.max(-32000,Math.min(32000,Math.round(v*per)));
  return pts=>{let px=0,py=0;return pts.map(([x,y])=>{const ix=int16(x),iy=int16(y),d=`${ix-px},${iy-py}`;px=ix;py=iy;return d;}).join(',');};
};
function decode(s){
  const v=s.split(','),out=new Int16Array(v.length);let x=0,y=0;
  for(let i=0;i<v.length;i+=2){x+=+v[i];y+=+v[i+1];out[i]=x;out[i+1]=y;}
  return out;
}
const DETAIL_LAYERS=['water','shore','waterways','roads','landuse','parks','aero','buildings'];
// Saved form -> drawable form (p: line, r: ring, both Int16Array in 1/per mi; per defaults to 1000).
export function decodeDetail(m){
  if(!m)return null;
  const out={...m,decoded:true};
  for(const k of DETAIL_LAYERS)out[k]=m[k].map(f=>f.p?{...f,p:decode(f.p)}:{...f,r:decode(f.r)});
  return out;
}
export async function buildDetail(home,{net={getJson,getBytes},MVT=globalThis.window?.WhatsUpMVT,range=DETAIL_RANGE,buildings=BUILDING_RANGE,zoom=12,key='street',inner=0,alive=()=>true}={}){
  if(!MVT)throw new Error('mvt.js missing');
  const lim=range+.5,template=await tileTemplate(net),per=perMile(range),encode=encoder(per),k=Math.max(1,range/10.5);
  const out={v:DETAIL_VERSION,latitude:home.latitude,longitude:home.longitude,range,zoom,key,per,buildingRange:buildings,inner,built:Date.now(),
    water:[],shore:[],waterways:[],roads:[],landuse:[],parks:[],aero:[],buildings:[],places:[]};
  const places=new Map();
  const polys=(geom,f,e,tol,box=lim)=>geom(f,e).filter(r=>r.length>3&&touches(r,box)).map(r=>simplify(r,tol)).filter(r=>r.length>3).map(encode);
  const fetched=await eachTile(home,lim,zoom,template,net,MVT,({each,geom,point,shore})=>{
    const lines=(f,e,tol)=>geom(f,e).flatMap(l=>clipLine(l,lim)).map(l=>encode(simplify(l,tol)));
    each('water',(f,e)=>{
      if(f.type!==3||f.properties.class==='swimming_pool')return;
      for(const r of polys(geom,f,e,(.008)*k))out.water.push({r});
      for(const p of shore(f,e).flatMap(l=>clipLine(l,lim)))out.shore.push({p:encode(simplify(p,.008*k))});
    });
    each('waterway',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type===2&&['river','canal','stream'].includes(c))for(const p of lines(f,e,.008*k))out.waterways.push({c,p});
    });
    each('transportation',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type!==2||!DETAIL_ROADS.has(c)||c==='rail'&&f.properties.subclass!=='rail')return;
      for(const p of lines(f,e,.006*k))out.roads.push({c,p,...(f.properties.ramp?{ramp:1}:{}),...(f.properties.brunnel==='bridge'?{bridge:1}:{})});
    });
    each('landuse',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type===3&&LANDUSE.has(c))for(const r of polys(geom,f,e,(c==='residential'?.02:.01)*k))out.landuse.push({c,r});
    });
    each('landcover',(f,e)=>{
      const c=String(f.properties.class||''),s=String(f.properties.subclass||'');
      if(f.type===3&&(c==='wood'||c==='grass'))for(const r of polys(geom,f,e,(c==='wood'?.02:.01)*k))out.parks.push({c:s==='park'||s==='golf_course'?s:c,r});
    });
    each('park',(f,e)=>{if(f.type===3)for(const r of polys(geom,f,e,(.015)*k))out.parks.push({c:'park',r});});
    each('aeroway',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type===2&&(c==='runway'||c==='taxiway'))for(const p of lines(f,e,.004*k))out.aero.push({c,p});
      else if(f.type===3&&['runway','aerodrome','apron','taxiway'].includes(c))for(const r of polys(geom,f,e,(.004)*k))out.aero.push({c,r});
    });
    each('place',(f,e)=>{
      const pr=f.properties,c=String(pr.class||'');
      if(f.type!==1||!PLACES.has(c))return;
      const name=nameOf(pr),[x,y]=point(f,e);
      if(!name||Math.abs(x)>lim||Math.abs(y)>lim||places.has(name))return;
      places.set(name,{name,c,rank:Number(pr.rank)||20,x:Math.round(x*1000)/1000,y:Math.round(y*1000)/1000});
    });
  },alive,true);
  if(!fetched)throw new Error('no tiles');
  // Side streets near home from z12 (the wide map's own zoom doesn't carry them).
  if(inner>0){
    const ilim=inner+.2;
    await eachTile(home,ilim,12,template,net,MVT,({each,geom})=>{
      each('transportation',(f,e)=>{
        const c=String(f.properties.class||'');
        if(f.type!==2||(c!=='minor'&&c!=='service'))return;
        for(const l of geom(f,e).flatMap(l=>clipLine(l,ilim)))if(l.some(([x,y])=>Math.hypot(x,y)<=ilim))out.roads.push({c,p:encode(simplify(l,.006))});
      });
    },alive);
  }
  const order={city:0,town:1,suburb:2,village:3,quarter:4,neighbourhood:5};
  out.places=[...places.values()].sort((a,b)=>order[a.c]-order[b.c]||a.rank-b.rank).slice(0,80);
  if(buildings>0){
    const found=[],blim=buildings+.15;
    await eachTile(home,blim,14,template,net,MVT,({each,geom})=>{
      each('building',(f,e)=>{if(f.type===3)for(const r of geom(f,e))if(r.length>3&&touches(r,blim)){
        const s=simplify(r,.003);if(s.length>3)found.push(s);
      }});
    },alive);
    const dist=r=>Math.min(...r.map(([x,y])=>Math.max(Math.abs(x),Math.abs(y))));
    let points=0;
    for(const r of found.map(r=>[dist(r),r]).sort((a,b)=>a[0]-b[0]).map(([,r])=>r)){
      if((points+=r.length)>MAX_BUILDING_POINTS)break;
      out.buildings.push({r:encode(r)});
    }
  }
  return out;
}

// The detail map is saved straight to localStorage (not kept in memory by `store`),
// so a layout that doesn't draw it costs nothing. Three slots, the most the privacy policy
// allows: the street map (up to 5 mi), the 10-mile map (the default radius gets its own) and
// the most recent wider one (a wider size used before is built again). Storage full: the other
// two slots make room first (the base maps stay), then they and the base maps are evicted and
// it is tried once more.
const detailKey=spec=>spec.key==='street'?DETAIL_KEY:spec.key==='r10'?`${DETAIL_KEY}.r10`:`${DETAIL_KEY}.wide`;
export function savedDetail(home,spec=detailSpec(10),{stale=false}={}){
  try{
    const m=JSON.parse(localStorage.getItem(detailKey(spec))||'null');
    const same=m&&m.v===DETAIL_VERSION&&detailFits(m,spec)&&Math.abs(m.latitude-home.latitude)<.01&&Math.abs(eastOf(m.longitude,home.longitude))<.01&&
      (stale||freshMap(m));
    // Every layer as buildDetail writes it (what decodeDetail reads): a damaged one is dropped and built again.
    if(same&&!(DETAIL_LAYERS.every(k=>Array.isArray(m[k])&&m[k].every(f=>typeof (f?.p||f?.r)==='string'))&&Array.isArray(m.places)&&m.places.every(label('name')))){
      localStorage.removeItem(detailKey(spec));return null;
    }
    return same?m:null;
  }catch{return null;}
}
export function saveDetail(m){
  if(store.sealed)return false;
  const key=detailKey({key:m.key||'street'}),json=JSON.stringify(m),put=()=>{try{localStorage.setItem(key,json);return true;}catch{return false;}};
  if(put())return true;
  dropDetail(key);
  if(put())return true;
  evictMaps({keepDetail:key,keepBase:recentMaps()[0]??null});
  if(put())return true;
  console.error('street map not saved: storage full');try{localStorage.removeItem(key);}catch{/* none */}return false;
}
