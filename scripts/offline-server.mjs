// Offline test server: node scripts/offline-server.mjs [assets|web|<dir>] [port]
// The same page serving and bridge shim as scripts/dev-server.mjs (its allow-list and shim are read
// from that file, so the two can't drift), but /proxy answers every allowed URL from tests/fixtures
// instead of the network, so the page checks (scripts/check-*.mjs) run where the services are blocked
// or the machine is offline. Nothing leaves this machine.
//   feed (adsb.fi, adsb.lol): the Chicago snapshot with its clock moved to now
//   routes: DTW-ATL for every callsign;  GeoJS: Chicago;  Open-Meteo search: Chicago, Chicago Heights,
//   London, Tokyo (by name prefix);  Census and Nominatim: one fixed match each;
//   map: the one fixture tile for every tile;  photo lookups: none.
// GET /__served answers how many proxied requests were answered.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join,resolve,extname,normalize,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO=join(dirname(fileURLToPath(import.meta.url)),'..');
const root=resolve(REPO,process.argv[2]||'assets');
const port=Number(process.argv[3])||8767;
const FIX=join(REPO,'tests','fixtures');
const FEED=JSON.parse(readFileSync(join(FIX,'chicago-feed.json'),'utf8'));
const TILE=readFileSync(join(FIX,'cincinnati-10-271-391.pbf'));
const dev=readFileSync(join(REPO,'scripts','dev-server.mjs'),'utf8');
const fromDev=(start,end)=>{const i=dev.indexOf(start);if(i<0)throw new Error('dev-server.mjs has no '+start);
  return new Function('return '+dev.slice(i+start.length,dev.indexOf(end,i)+end.length-1))();};
const ALLOWED=fromDev('const ALLOWED=','];');
const SHIM=fromDev('const SHIM=','`;');
const TYPES={'.woff2':'font/woff2','.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.json':'application/json','.jpg':'image/jpeg','.gif':'image/gif','.mp4':'video/mp4'};
const PLACES=[
  {name:'Chicago',latitude:41.85003,longitude:-87.65005,elevation:179,feature_code:'PPLA2',country_code:'US',country:'United States',admin1:'Illinois',admin2:'Cook',timezone:'America/Chicago',population:2720546},
  {name:'Chicago Heights',latitude:41.50615,longitude:-87.6356,elevation:190,feature_code:'PPL',country_code:'US',country:'United States',admin1:'Illinois',admin2:'Cook',timezone:'America/Chicago',population:30276},
  {name:'London',latitude:51.50853,longitude:-0.12574,elevation:25,feature_code:'PPLC',country_code:'GB',country:'United Kingdom',admin1:'England',timezone:'Europe/London',population:8961989},
  {name:'Tokyo',latitude:35.6895,longitude:139.69171,elevation:44,feature_code:'PPLC',country_code:'JP',country:'Japan',admin1:'Tokyo',timezone:'Asia/Tokyo',population:8336599},
];
const TILEJSON=JSON.stringify({tilejson:'3.0.0',name:'OpenFreeMap Planet',attribution:'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
  tiles:['https://tiles.openfreemap.org/planet/20251112_001001_pt/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom:14,bounds:[-180,-85.0511,180,85.0511],
  vector_layers:['water','waterway','landcover','landuse','park','boundary','aeroway','transportation','building','water_name','transportation_name','place','housenumber','poi','aerodrome_label','mountain_peak'].map(id=>({id,fields:{}}))});
let served=0;
function answer(target,binary){
  const h=new URL(target).hostname;
  if(h==='opendata.adsb.fi'||h==='api.adsb.lol')return [200,JSON.stringify({...FEED,now:Date.now()})];
  if(h==='vrs-standing-data.adsb.lol'){const call=(/\/([A-Z0-9-]+)\.json$/.exec(target)||[])[1]||'';
    return [200,JSON.stringify({callsign:call,_airport_codes_iata:'DTW-ATL',airport_codes:'KDTW-KATL',_airports:[
      {name:'Detroit Metropolitan Wayne County Airport',icao:'KDTW',iata:'DTW',location:'Detroit',countryiso2:'US',lat:42.212,lon:-83.353,alt_feet:645},
      {name:'Hartsfield-Jackson Atlanta International Airport',icao:'KATL',iata:'ATL',location:'Atlanta',countryiso2:'US',lat:33.637,lon:-84.428,alt_feet:1026}]})];}
  if(h==='get.geojs.io')return [200,JSON.stringify({city:'Chicago',region:'Illinois',country:'United States',country_code:'US',latitude:'41.85',longitude:'-87.65',timezone:'America/Chicago',accuracy:20,ip:'203.0.113.9'})];
  if(h==='geocoding-api.open-meteo.com'){const name=decodeURIComponent(((/name=([^&]*)/.exec(target)||[])[1]||'').replace(/\+/g,' ')).toLowerCase().trim();
    const hits=name.length>=2?PLACES.filter(p=>p.name.toLowerCase().startsWith(name)).map((p,i)=>({id:i+1,...p})):[];
    return [200,JSON.stringify(hits.length?{results:hits,generationtime_ms:0.5}:{generationtime_ms:0.5})];}
  if(h==='api.open-meteo.com'){const la=+(/latitude=(-?[\d.]+)/.exec(target)||[])[1],lo=+(/longitude=(-?[\d.]+)/.exec(target)||[])[1];
    const best=PLACES.slice().sort((a,b)=>Math.hypot(a.latitude-la,a.longitude-lo)-Math.hypot(b.latitude-la,b.longitude-lo))[0];
    return [200,JSON.stringify({latitude:la,longitude:lo,timezone:best.timezone,timezone_abbreviation:'X',elevation:best.elevation,utc_offset_seconds:0})];}
  if(h==='geocoding.geo.census.gov')return [200,JSON.stringify({result:{input:{},addressMatches:[{matchedAddress:'233 S WACKER DR, CHICAGO, IL, 60606',coordinates:{x:-87.6359,y:41.8789},addressComponents:{city:'CHICAGO',state:'IL',zip:'60606'}}]}})];
  if(h==='nominatim.openstreetmap.org')return [200,JSON.stringify([{lat:'51.5034',lon:'-0.1276',name:'10 Downing Street',address:{house_number:'10',road:'Downing Street',city:'London',state:'England',country:'United Kingdom',country_code:'gb'}}])];
  if(h==='tiles.openfreemap.org')return /\/planet$/.test(target)?[200,TILEJSON]:[200,binary?TILE.toString('base64'):TILE.toString('latin1')];
  if(h==='api.planespotters.net')return [200,JSON.stringify({photos:[]})];
  return ['connection_error',''];
}
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/proxy'){
    const target=url.searchParams.get('url')||'';let status='blocked',text='';
    if(ALLOWED.some(p=>p.test(target))){[status,text]=answer(target,!!url.searchParams.get('binary'));served++;await new Promise(r=>setTimeout(r,25));}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status,text}));return;
  }
  if(url.pathname==='/bridge-shim.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(SHIM);return;}
  if(url.pathname==='/__served'){res.writeHead(200);res.end(String(served));return;}
  const path=normalize(url.pathname==='/'?'/index.html':url.pathname);
  try{
    let body=await readFile(join(root,path));
    if(path==='/index.html'&&url.searchParams.get('bridge')!=='0')body=body.toString().replace('<head>','<head>\n  <script src="bridge-shim.js"></script>');
    res.writeHead(200,{'content-type':TYPES[extname(path)]||'application/octet-stream','cache-control':'no-store'});res.end(body);
  }catch{res.writeHead(404);res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`offline http://127.0.0.1:${port}/ serving ${root}`));
