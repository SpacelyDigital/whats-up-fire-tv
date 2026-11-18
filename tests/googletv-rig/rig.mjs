// rig.mjs: the Google TV app (android/) around the page, in headless Chromium (Playwright). See README.md.
// It copies the app closely enough that the page meets the same world as on a TV:
//  - the page at https://appassets.androidplatform.net/www/index.html, served as PageFiles.kt serves it
//    (only /www/ paths made of plain segments, its MIME types; anything else the web view asks for is
//    refused with an empty 403, except the picture hosts in the page's img-src, answered from fixtures)
//  - window.WhatsUpHost.postMessage(string) and Bridge.kt's handling of each message: get (allow-list,
//    'blocked' at once, timeoutMs = Number(x)||8000 clamped to 1000..12000, binary===true), chime (only
//    while the app is started; volume Number(x)||0.55, clamped 0..1), awake (on!==false), ui (overlay===true)
//  - Fetcher's answers (HTTP status + body, or + Retry-After for non-200; 'oversize'; base64 for binary;
//    redirects checked hop by hop, at most 5; one deadline per request from when a thread takes it) and
//    MainActivity's pool of 6 network threads (a 7th request waits for a free thread)
//  - MainActivity's keys and lifecycle: Back goes to the page while it reports a screen open (ui), otherwise
//    the app goes to the background (0.1.3: moveTaskToBack on every Android version; the page stays, so
//    the next launch is a hot return); Menu is a synthetic ContextMenu keydown/keyup dispatched on document; D-pad and OK are
//    the web view's own key events; Home and return run __whatsupActive(false/true) and freeze the page
//    while the app is stopped (pauseTimers); the page's process ending makes the web view again (a fresh
//    page, the app's overlay flag reset); more than 3 losses in a minute close the app
//  - a TV-sized mobile viewport (Android's web view widens the layout viewport, and innerWidth, to overflow)
// Not copied: real rendering speed (use cpuThrottle), the real audio, the system's own screens.
import {createRequire} from 'node:module';
import {readFileSync,existsSync,mkdirSync,writeFileSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
const REPO=join(HERE,'..','..'),FIX=join(REPO,'tests','fixtures');
// Playwright is not one of the repository's dependencies: npm install -g playwright, then run with
// NODE_PATH="$(npm root -g)" (or install it in any node_modules folder above this one).
const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require('playwright'));}catch{throw new Error('the rig needs Playwright: npm install -g playwright, then run with NODE_PATH="$(npm root -g)"');}
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export const ORIGIN='https://appassets.androidplatform.net';
export const START=ORIGIN+'/www/index.html';
// Google TV screens as Android's web view sees them: CSS px = physical px / (dpi/160).
export const DEVICES={
  'tv-1080':{w:960,h:540,dsf:2,note:'1080p UI at 320 dpi (xhdpi): the usual Google TV setup, e.g. Chromecast with Google TV'},
  'tv-720':{w:960,h:540,dsf:4/3,note:'720p UI at 213 dpi (tvdpi)'},
  'hd-240':{w:1280,h:720,dsf:1.5,note:'1080p UI at 240 dpi'},
  'mdpi-1080':{w:1920,h:1080,dsf:1,note:'1080p UI at 160 dpi (some boxes)'},
  '4k-640':{w:960,h:540,dsf:4,note:'4K UI at 640 dpi'},
  '4k-480':{w:1280,h:720,dsf:3,note:'4K UI at 480 dpi'},
  'odd-1366':{w:1366,h:768,dsf:1,note:'a 1366x768 panel at 160 dpi'},
  'odd-544':{w:960,h:544,dsf:2,note:'a 1080p panel with a 1088-line mode'},
};
export const PICTURE_HOSTS=['basemap.nationalmap.gov','tiles.maps.eox.at','cdn.planespotters.net','*.plnspttrs.net'];
// Net.kt AllowList.PATTERNS, same order.
export const ALLOWED=[
  /^https:\/\/opendata\.adsb\.fi\/api\/v3\/lat\/-?\d{1,2}\.\d{2}\/lon\/-?\d{1,3}\.\d{2}\/dist\/\d{1,3}$/,
  /^https:\/\/api\.adsb\.lol\/v2\/lat\/-?\d{1,2}\.\d{2}\/lon\/-?\d{1,3}\.\d{2}\/dist\/\d{1,3}$/,
  /^https:\/\/vrs-standing-data\.adsb\.lol\/routes\/[A-Z0-9-]{2}\/[A-Z0-9-]{2,10}\.json$/,
  /^https:\/\/get\.geojs\.io\/v1\/ip\/geo\.json$/,
  /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=[^&#]{1,200}&count=\d{1,2}&language=en&format=json$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet$/,
  /^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress\?address=[^&#]{1,300}&benchmark=Public_AR_Current&format=json$/,
  /^https:\/\/nominatim\.openstreetmap\.org\/search\?q=[^&#]{1,300}&format=jsonv2&limit=5&addressdetails=1$/,
  /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=-?\d{1,2}\.\d{2}&longitude=-?\d{1,3}\.\d{2}&timezone=auto&forecast_days=1$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet\/[\w.-]+\/\d{1,2}\/\d{1,6}\/\d{1,6}\.pbf$/,
  /^https:\/\/api\.planespotters\.net\/pub\/photos\/(hex\/[0-9a-f]{6}|reg\/[A-Z0-9-]{2,10})$/,
];
export const allowed=url=>ALLOWED.some(r=>r.test(url));
const hostOf=url=>(/^https?:\/\/([^/?#]+)/.exec(url)||[])[1]||'non-http URL';
export function service(url){
  const h=hostOf(url);
  if(h==='opendata.adsb.fi')return 'feed';
  if(h==='api.adsb.lol')return 'backup';
  if(h==='vrs-standing-data.adsb.lol')return 'routes';
  if(h==='api.planespotters.net')return 'psapi';
  if(h==='cdn.planespotters.net'||/\.plnspttrs\.net$/.test(h))return 'psimg';
  if(h==='tiles.openfreemap.org')return /\/planet$/.test(url)?'tilejson':'tiles';
  if(h==='basemap.nationalmap.gov')return 'usgs';
  if(h==='tiles.maps.eox.at')return 'eox';
  if(h==='geocoding-api.open-meteo.com')return 'omsearch';
  if(h==='api.open-meteo.com')return 'omforecast';
  if(h==='geocoding.geo.census.gov')return 'census';
  if(h==='nominatim.openstreetmap.org')return 'nominatim';
  if(h==='get.geojs.io')return 'geojs';
  return 'other';
}
export const SERVICES=['feed','backup','routes','psapi','psimg','tilejson','tiles','usgs','eox','omsearch','omforecast','census','nominatim','geojs'];

// --- Places (public landmarks only). Search answers match by prefix of the typed name.
export const PLACES={
  CHICAGO:{name:'Chicago',latitude:41.85,longitude:-87.65,country_code:'US',country:'United States',admin1:'Illinois',timezone:'America/Chicago',elevation:180},
  'CHICAGO HEIGHTS':{name:'Chicago Heights',latitude:41.506,longitude:-87.636,country_code:'US',country:'United States',admin1:'Illinois',timezone:'America/Chicago',elevation:190},
  ROSEMONT:{name:'Rosemont',latitude:41.9953,longitude:-87.8845,country_code:'US',country:'United States',admin1:'Illinois',timezone:'America/Chicago',elevation:195},
  LONDON:{name:'London',latitude:51.5085,longitude:-0.1257,country_code:'GB',country:'United Kingdom',admin1:'England',timezone:'Europe/London',elevation:25},
  TOKYO:{name:'Tokyo',latitude:35.6895,longitude:139.6917,country_code:'JP',country:'Japan',admin1:'Tokyo',timezone:'Asia/Tokyo',elevation:44},
  SYDNEY:{name:'Sydney',latitude:-33.8678,longitude:151.2073,country_code:'AU',country:'Australia',admin1:'New South Wales',timezone:'Australia/Sydney',elevation:58},
  KOLKATA:{name:'Kolkata',latitude:22.5626,longitude:88.363,country_code:'IN',country:'India',admin1:'West Bengal',timezone:'Asia/Kolkata',elevation:9},
  CHATHAM:{name:'Waitangi',latitude:-43.9535,longitude:-176.5597,country_code:'NZ',country:'New Zealand',admin1:'Chatham Islands',timezone:'Pacific/Chatham',elevation:5},
  REYKJAVIK:{name:'Reykjavik',latitude:64.1355,longitude:-21.8954,country_code:'IS',country:'Iceland',admin1:'Capital Region',timezone:'Atlantic/Reykjavik',elevation:20},
  HONOLULU:{name:'Honolulu',latitude:21.3069,longitude:-157.8583,country_code:'US',country:'United States',admin1:'Hawaii',timezone:'Pacific/Honolulu',elevation:6},
  LONGYEARBYEN:{name:'Longyearbyen',latitude:78.2232,longitude:15.6267,country_code:'SJ',country:'Svalbard and Jan Mayen',admin1:'Svalbard',timezone:'Arctic/Longyearbyen',elevation:20},
  QUITO:{name:'Quito',latitude:-0.2299,longitude:-78.525,country_code:'EC',country:'Ecuador',admin1:'Pichincha',timezone:'America/Guayaquil',elevation:2850},
  SUVA:{name:'Suva',latitude:-18.1416,longitude:178.4419,country_code:'FJ',country:'Fiji',admin1:'Central',timezone:'Pacific/Fiji',elevation:10},
};
// The saved form of a place (web/place.mjs makePlace).
export const savedPlace=(p=PLACES.CHICAGO,source='search')=>({name:p.name,admin:p.admin1,country:p.country,countryCode:p.country_code,
  latitude:p.latitude,longitude:p.longitude,timeZone:p.timezone,elevationM:p.elevation,source});

// --- Mocked services.
// Feeds: planes around the asked lat/lon. kind: normal | busy | empty | one | emergency | weird | chicago (the
// repo's real Chicago snapshot, moved to the asked point) | a function (lat,lon,nowMs)=>ac[].
const TYPES=[['DAL1234','N123DL','B739'],['UAL567','N456UA','A320'],['FDX88','N789FD','B77L'],['N12345','N12345','C172'],
  ['AAL2201','N321AA','A321'],['SWA910','N8710M','B38M'],['RPA4455','N101YX','E75L'],['UPS2905','N608UP','B763'],['RCH401','05-5140','C17'],
  ['EDV5012','N601XJ','CRJ9'],['N75WX','N75WX','BE36'],['JIA5300','N546NN','CRJ7'],['N911LH','N911LH','EC35'],['BAW295','G-XWBA','A35K']];
function circle(la,lo,nowMs,n,{emergency=false}={}){
  const t=nowMs/1000,cos=Math.cos(la*Math.PI/180)||1e-6;
  return Array.from({length:n},(_,i)=>{
    const [flight,r,type]=TYPES[i%TYPES.length],hex=(0xa10000+i*0x111).toString(16);
    const ang=(t/600+i/n)*2*Math.PI,rad=i<3?1.5+i*0.6:3+(i%14)*1.6;
    const dy=rad*Math.cos(ang)/69,dx=rad*Math.sin(ang)/(69.17*cos);
    return {hex,type:'adsb_icao',flight:(i<TYPES.length?flight:flight.slice(0,3)+(100+i)).padEnd(8),r,t:type,alt_baro:3000+(i%14)*2500,alt_geom:3100+(i%14)*2500,
      gs:180+(i%14)*20,track:((ang*180/Math.PI)+90)%360,baro_rate:i%2?-640:832,squawk:emergency&&i===1?'7700':'1200',emergency:emergency&&i===1?'general':'none',
      category:type==='C172'?'A1':'A3',lat:la+dy,lon:lo+dx,nic:8,messages:1000+i,seen_pos:0.4,seen:0.2,rssi:-20,dbFlags:type==='C17'?1:0};
  });
}
const WEIRD=(la,lo)=>[
  {hex:'abcdef',flight:'‮RTL‬😀✈️',r:'N0'.repeat(20),t:'ZZZZ',lat:la+0.01,lon:lo+0.01,alt_baro:'ground',gs:0,track:0},
  {hex:'ABCDEF',flight:null,lat:la-0.02,lon:lo,alt_baro:-1200,gs:2000,track:720,baro_rate:99999},
  {hex:'~123456',flight:'TISB1',type:'tisb_other',lat:la,lon:lo+0.03,alt_baro:45000,gs:'fast'},
  {hex:'a00001',flight:'NANNAN',lat:NaN,lon:lo,alt_baro:3000},
  {hex:'a00002',flight:'OUTSIDE',lat:95,lon:200,alt_baro:3000},
  {hex:'a00003',flight:'DUPE1',lat:la+0.005,lon:lo,alt_baro:5000,gs:200,track:90},
  {hex:'a00003',flight:'DUPE2',lat:la+0.006,lon:lo,alt_baro:5100,gs:210,track:91},
  {hex:'a00004',flight:'X'.repeat(300),r:'<img src=x onerror=alert(1)>',t:'<b>B738</b>',lat:la+0.02,lon:lo-0.02,alt_baro:8000,gs:300,track:180,squawk:'7500'},
  {hex:'a00005',lat:la+0.03,lon:lo+0.03},
  null,7,'string',[],{},
];
let CHICAGO_FEED=null;
function feedPlanes(kind,la,lo,nowMs){
  if(typeof kind==='function')return kind(la,lo,nowMs);
  switch(kind){
    case 'empty':return [];
    case 'one':return circle(la,lo,nowMs,1);
    case 'busy':return circle(la,lo,nowMs,80);
    case 'emergency':return circle(la,lo,nowMs,12,{emergency:true});
    case 'weird':return [...circle(la,lo,nowMs,4),...WEIRD(la,lo)];
    case 'chicago':{
      CHICAGO_FEED??=JSON.parse(readFileSync(join(FIX,'chicago-feed.json'),'utf8'));
      return CHICAGO_FEED.ac.map(a=>({...a,lat:a.lat-41.88+la,lon:a.lon+87.63+lo}));
    }
  }
  return circle(la,lo,nowMs,12);
}
const TILE=readFileSync(join(FIX,'cincinnati-10-271-391.pbf'));
const PHOTO=readFileSync(join(REPO,'web','models','A20N.jpg')),IMAGERY=readFileSync(join(FIX,'imagery-flat.png'));
const TILEJSON=JSON.stringify({tilejson:'3.0.0',name:'OpenFreeMap Planet',attribution:'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
  tiles:['https://tiles.openfreemap.org/planet/20251112_001001_pt/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom:14,bounds:[-180,-85.0511,180,85.0511],
  vector_layers:['water','waterway','landcover','landuse','park','boundary','aeroway','transportation','building','water_name','transportation_name','place','housenumber','poi','aerodrome_label','mountain_peak'].map(id=>({id,fields:{}}))});
function okBody(app,svc,url){
  const now=app.feedNow();
  switch(svc){
    case 'feed':case 'backup':{
      const m=/lat\/(-?[\d.]+)\/lon\/(-?[\d.]+)\/dist\/(\d+)/.exec(url);
      const ac=feedPlanes(svc==='backup'?app.backupKind??app.feedKind:app.feedKind,+m[1],+m[2],now);
      return JSON.stringify({ac,msg:'No error',now,total:ac.length,ctime:now,ptime:3});
    }
    case 'routes':{
      const call=(/\/([A-Z0-9-]+)\.json$/.exec(url)||[])[1]||'';
      return JSON.stringify({callsign:call,_airport_codes_iata:'DTW-ATL',airport_codes:'KDTW-KATL',
        _airports:[{name:'Detroit Metropolitan Wayne County Airport',icao:'KDTW',iata:'DTW',location:'Detroit',countryiso2:'US',lat:42.212,lon:-83.353,alt_feet:645},
          {name:'Hartsfield-Jackson Atlanta International Airport',icao:'KATL',iata:'ATL',location:'Atlanta',countryiso2:'US',lat:33.637,lon:-84.428,alt_feet:1026}]});
    }
    case 'psapi':{
      const id=(/\/(hex|reg)\/([^/]+)$/.exec(url)||[])[2];
      return JSON.stringify({photos:[{id:'1',thumbnail:{src:`https://t.plnspttrs.net/1/${id}_t.jpg`,size:{width:200,height:133}},
        thumbnail_large:{src:`https://t.plnspttrs.net/1/${id}_280.jpg`,size:{width:420,height:280}},link:`https://www.planespotters.net/photo/1/${id}`,photographer:'Test Photographer'}]});
    }
    case 'geojs':{const p=app.ipPlace;return JSON.stringify(p?{city:p.name,region:p.admin1,country:p.country,country_code:p.country_code,latitude:String(p.latitude),longitude:String(p.longitude),timezone:p.timezone,accuracy:20,ip:'203.0.113.9'}:{ip:'203.0.113.9'});}
    case 'omsearch':{
      const name=decodeURIComponent(((/name=([^&]*)/.exec(url)||[])[1]||'').replace(/\+/g,' ')).toUpperCase().trim();
      const hits=name.length>=2?Object.entries(PLACES).filter(([k])=>k.startsWith(name)||name.startsWith(k)).map(([,v],i)=>({id:i+1,...v})):[];
      return JSON.stringify(hits.length?{results:hits,generationtime_ms:0.5}:{generationtime_ms:0.5});
    }
    case 'omforecast':{
      const la=+(/latitude=(-?[\d.]+)/.exec(url)||[])[1],lo=+(/longitude=(-?[\d.]+)/.exec(url)||[])[1];
      const best=Object.values(PLACES).sort((a,b)=>Math.hypot(a.latitude-la,a.longitude-lo)-Math.hypot(b.latitude-la,b.longitude-lo))[0];
      return JSON.stringify({latitude:la,longitude:lo,timezone:best.timezone,timezone_abbreviation:'X',elevation:best.elevation,utc_offset_seconds:0});
    }
    case 'census':return JSON.stringify({result:{input:{},addressMatches:[{matchedAddress:'233 S WACKER DR, CHICAGO, IL, 60606',
      coordinates:{x:-87.6359,y:41.8789},addressComponents:{city:'CHICAGO',state:'IL',zip:'60606'}}]}});
    case 'nominatim':return JSON.stringify([{lat:'51.5034',lon:'-0.1276',name:'10 Downing Street',
      address:{house_number:'10',road:'Downing Street',city:'London',state:'England',country:'United Kingdom',country_code:'gb'}}]);
    case 'tilejson':return TILEJSON;
    case 'tiles':return TILE;
  }
  return '';
}
const PORTAL='<!DOCTYPE html><html><head><title>Guest Wi-Fi</title></head><body><h1>Welcome to Hotel Wi-Fi</h1><form action="/login"><input name="room"></form></body></html>';

// --- The app.
const MAX_BYTES=2*1024*1024,MAX_HOPS=5,REDIRECTS=[301,302,303,307,308];
const R=(status,text='')=>({status,text});
const BLOCKED=R('blocked'),OVERSIZE=R('oversize'),CONNECTION_ERROR=R('connection_error');
// A small seeded generator, so a run with the same seed fails the same way.
export const rng=seed=>{let s=(seed>>>0)||1;return ()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};};

let BROWSER=null,BROWSER_USERS=0;
async function browser(headless){
  if(!BROWSER)BROWSER=chromium.launch({headless,args:['--disable-background-networking','--disable-component-update','--disable-sync','--disable-domain-reliability','--no-first-run','--mute-audio']});
  BROWSER_USERS++;return BROWSER;
}

export async function launch(opts={}){const app=new App(opts);await app.init();return app;}

export class App{
  constructor(o){
    this.o=o;
    this.variant=o.variant||'personal';
    this.pages=o.pagesDir||process.env.RIG_PAGES||join(HERE,'pages'); // RIG_PAGES: another build folder for every launch
    this.dir=join(this.pages,this.variant);
    if(!existsSync(join(this.dir,'index.html')))throw new Error(`no page build at ${this.dir}: run sh tests/googletv-rig/build.sh`);
    this.dev=typeof o.device==='object'?o.device:DEVICES[o.device||'tv-1080'];
    if(!this.dev)throw new Error('unknown device '+o.device);
    this.sdk=o.sdk||31;
    this.out=o.out||join(HERE,'out','run');mkdirSync(this.out,{recursive:true});
    this.feedKind=o.feed||'normal';this.backupKind=o.backupFeed;
    this.ipPlace=o.ipPlace===undefined?PLACES.CHICAGO:o.ipPlace;
    this.faults={};for(const [k,v] of Object.entries(o.faults||{}))this.setFault(k,...[].concat(v.mode?[v.mode,v]:[v]));
    this.random=rng(o.seed||1);
    this.clockOffsetMs=o.clockOffsetMs||0;this.feedShiftMs=o.feedShiftMs||0;
    // State as MainActivity keeps it.
    this.started=false;this.resumed=false;this.wantsAwake=false;this.overlay=false;this.finished=false;this.destroyed=false;
    this.losses=[];this.exits=0;this.launches=0;
    this.log=[];this.errors=[];this.T0=Date.now();
    this.busyThreads=0;this.queue=[];this.inFlight=new Set();
    this._page=null;this.pageGen=0;this.held=[];
  }
  get page(){return this._page;}
  get keepScreenOn(){return this.wantsAwake&&this.resumed;}
  t(){return (Date.now()-this.T0)/1000;}
  rec(e){e.t=this.t();this.log.push(e);if(this.o.trace)console.log(JSON.stringify(e));return e;}
  feedNow(){return this.o.feedFrozenMs||Date.now()+this.feedShiftMs;}
  setFeed(kind,backup){this.feedKind=kind;if(backup!==undefined)this.backupKind=backup;}
  // mode: ok | offline | sNNN | timeout | slow:<ms> | slowbody:<ms> | noreply (never answered: no real app does this) |
  // garbage | portal | empty | redirect (to a host off the list: 'blocked') | redirect-ok (one hop, then the answer) |
  // redirect-loop (more than 5 hops) | oversize (Content-Length over 2 MB) | big (a body over 2 MB) | bom | badutf8 | refuse (DNS/connect fails)
  // opts: {retryAfter, partial: share of requests that get the fault (0..1), delayMs}
  setFault(svc,mode,opts={}){
    const list=svc==='all'?SERVICES:[].concat(svc);
    for(const s of list){if(!mode||mode==='ok')delete this.faults[s];else this.faults[s]={mode,...opts};}
  }
  clearFaults(){this.faults={};}
  setClock(ms){this.clockOffsetMs=ms;return this.ev(v=>{window.__qaClock=v;},ms).catch(()=>{});}

  async init(){
    const o=this.o;
    this.browser=await browser(o.headless!==false);
    const storage=[];
    const consent=o.consent===undefined?true:o.consent;
    if(consent)storage.push({name:'whatsup.consent',value:JSON.stringify(consent===true?{v:5,at:'2026-11-17'}:consent)});
    const place=o.place===undefined?'CHICAGO':o.place;
    if(place||o.settings){
      const s={...(place?{place:typeof place==='string'?savedPlace(PLACES[place]):place,confirmed:true}:{}),...(o.settings||{})};
      storage.push({name:'whatsup.settings.v1',value:JSON.stringify(s)});
    }
    for(const [name,value] of Object.entries(o.storage||{}))storage.push({name,value:typeof value==='string'?value:JSON.stringify(value)});
    this.context=await this.browser.newContext({
      viewport:{width:this.dev.w,height:this.dev.h},screen:{width:this.dev.w,height:this.dev.h},deviceScaleFactor:this.dev.dsf,isMobile:true,hasTouch:false,
      userAgent:o.userAgent||'Mozilla/5.0 (Linux; Android 12; TV; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Safari/537.36',
      locale:o.locale||'en-US',timezoneId:o.timezone||'America/Chicago',colorScheme:'dark',serviceWorkers:'block',
      storageState:{cookies:[],origins:storage.length?[{origin:ORIGIN,localStorage:storage}]:[]},
    });
    await this.context.route('**/*',r=>this.onRoute(r));
    await this.context.exposeBinding('__gtvPost',(src,data)=>{if(src.page===this._page)this.onMessage(data);});
    await this.context.addInitScript(({clock,fake})=>{
      if(window.top!==window)return;
      if(fake){
        window.__qaClock=clock;const D=Date;
        class FakeDate extends D{constructor(...a){if(a.length)super(...a);else super(D.now()+window.__qaClock);}static now(){return D.now()+window.__qaClock;}}
        FakeDate.UTC=D.UTC;FakeDate.parse=D.parse;window.Date=FakeDate;
      }
      if(location.origin!=='https://appassets.androidplatform.net')return; // allowedOriginRules
      const post=window.__gtvPost;delete window.__gtvPost;
      // androidx.webkit's injected object: postMessage takes a string.
      const host={postMessage(m){if(typeof m!=='string')throw new TypeError('WhatsUpHost.postMessage: a string, please');post(m);}};
      Object.defineProperty(window,'WhatsUpHost',{value:Object.freeze(host),enumerable:false,configurable:false,writable:false});
    },{clock:this.clockOffsetMs,fake:o.fakeDate!==false});
    if(!o.noLaunch)await this.create();
  }

  // onCreate (+ onStart + onResume): a new web view loading the page.
  async create(){
    this.destroyed=false;this.finished=false;this.launches++;
    // onCreate starts the page loading; onStart and onResume follow at once, before it has loaded.
    this.started=true;this.resumed=true;
    await this.makeWeb();
    await this.js('window.__whatsupActive&&window.__whatsupActive(true);true;');
    this.rec({kind:'lifecycle',what:'create'});
    if(this.o.wait!==false)await this.settle();
  }
  async makeWeb(){
    const page=await this.context.newPage();
    this.pageGen++;const gen=this.pageGen;
    page.on('pageerror',e=>{if(gen===this.pageGen)this.errors.push(this.rec({kind:'error',what:'exception',text:String(e.stack||e).split('\n').slice(0,3).join(' | ')}).text);});
    page.on('console',m=>{if(gen!==this.pageGen)return;if(m.type()==='error'||m.type()==='warning'&&this.o.warnings)this.errors.push(this.rec({kind:'error',what:'console.'+m.type(),text:m.text().slice(0,300)}).text);});
    page.on('crash',()=>{if(gen===this.pageGen)this.onRenderProcessGone(true);});
    this._page=page;
    this.cdp=await this.context.newCDPSession(page);
    await this.cdp.send('Performance.enable').catch(()=>{});
    if(this.o.cpuThrottle)await this.cdp.send('Emulation.setCPUThrottlingRate',{rate:this.o.cpuThrottle});
    if(this.o.beforeLoad)await this.o.beforeLoad(page,this); // e.g. page.clock.install() (launch with fakeDate:false)
    await page.goto(START+(this.o.query?'?'+this.o.query.replace(/^\?/,''):''),{waitUntil:'load'}).catch(e=>this.rec({kind:'error',what:'goto',text:String(e)}));
  }
  async settle(ms=1500){await sleep(ms);}
  async dropWeb(){
    const p=this._page;this._page=null;this.pageGen++;this.overlay=false;
    if(p)await p.close().catch(()=>{});
  }
  // WebViewClient.onRenderProcessGone
  async onRenderProcessGone(didCrash){
    this.rec({kind:'lifecycle',what:'render-process-gone',didCrash});
    await this.dropWeb();
    const now=Date.now();this.losses.push(now);this.losses=this.losses.filter(t=>now-t<=60000);
    if(this.losses.length>3){this.finished=true;this.started=this.resumed=false;this.rec({kind:'lifecycle',what:'finish-after-losses'});return;}
    if(this.resumed){await this.makeWeb();await this.js('window.__whatsupActive&&window.__whatsupActive(true);true;');}
  }
  // Kill the page's process (as Android's low-memory killer or a crash would).
  async crash(){
    if(!this._page)return;
    const done=new Promise(r=>this._page.once('crash',r));
    await this.cdp.send('Page.crash').catch(()=>{});
    await Promise.race([done,sleep(3000)]);
    await sleep(300);
    if(this.o.wait!==false&&this._page)await this.settle();
  }
  // The whole app's process dies while in the background (am kill / low memory): the next return is a fresh onCreate.
  async killProcess(){
    if(this.resumed)await this.home();
    await this.dropWeb();this.destroyed=true;this.started=this.resumed=false;this.wantsAwake=false;
    this.queue=[];for(const f of this.inFlight)f.dead=true;this.inFlight.clear();this.busyThreads=0;
    this.rec({kind:'lifecycle',what:'process-killed'});
  }
  // Home (onPause + onStop): the page told it's off screen, then its timers held.
  async home(){
    if(!this.resumed)return;
    this.resumed=false;
    await this.js('window.__whatsupActive&&window.__whatsupActive(false);true;');
    this.started=false;
    // pauseTimers: no timer, task or frame runs until the app returns. (Page.setWebLifecycleState frozen doesn't hold
    // timers in headless Chromium; a debugger pause does: the page stops at the next script it would run.)
    if(this.cdp){await this.cdp.send('Debugger.enable').catch(()=>{});await this.cdp.send('Debugger.pause').catch(e=>this.rec({kind:'note',what:'pause failed '+e}));}
    this.rec({kind:'lifecycle',what:'stop'});
  }
  // Back to the app from the launcher (or a recent-apps pick): onRestart/onStart/onResume, or onCreate after a finish or a kill.
  async returnToApp(){
    if(this.resumed)return;
    if(this.destroyed||this.finished||!this._page&&!this.started&&this.launches===0)return this.create();
    this.started=true;this.resumed=true;
    if(!this._page)await this.makeWeb();
    else if(this.cdp){await this.cdp.send('Debugger.resume').catch(()=>{});await this.cdp.send('Debugger.disable').catch(()=>{});} // resumeTimers
    await this.js('window.__whatsupActive&&window.__whatsupActive(true);true;');
    this.rec({kind:'lifecycle',what:'resume'});
    if(this.o.wait!==false)await sleep(300);
  }
  // The remote's Back: the page's while it reports a screen open, else Android's own.
  async back(){
    if(!this.resumed||!this._page)return 'ignored';
    if(this.overlay){this.rec({kind:'key',key:'Back',to:'page'});await this.js('window.__whatsupBack&&window.__whatsupBack();true;');await sleep(60);return 'page';}
    const scr=await this.screen().catch(()=>null);
    this.exits++;this.rec({kind:'key',key:'Back',to:'system',screen:scr&&scr.top});
    await this.home(); // 0.1.3: moveTaskToBack on every Android version (0.1.2 finished the activity on SDK 30 and below)
    return 'exit';
  }
  // The remote's Menu (KEYCODE_MENU): the app hands the page synthetic events.
  async menu({holdRepeats=0}={}){
    if(!this.resumed||!this._page)return;
    this.rec({kind:'key',key:'Menu'});
    await this.js(menuKey('keydown',false));
    for(let i=0;i<holdRepeats;i++){await sleep(50);await this.js(menuKey('keydown',true));}
    await this.js(menuKey('keyup',false));
    await sleep(60);
  }
  // A remote key the web view gets itself: ArrowUp/Down/Left/Right, Enter (OK, D-pad centre), MediaPlayPause, digits...
  // 'Back', 'Menu' and 'Home' go through the app.
  async key(k,{holdRepeats=0,gap=120}={}){
    if(k==='Back')return this.back();
    if(k==='Menu')return this.menu({holdRepeats});
    if(k==='Home')return this.home();
    if(!this.resumed||!this._page)return 'ignored';
    this.rec({kind:'key',key:k,holdRepeats});
    const kb=this._page.keyboard;
    if(!holdRepeats)await kb.press(k).catch(()=>{});
    else{await kb.down(k).catch(()=>{});for(let i=0;i<holdRepeats;i++){await sleep(50);await kb.down(k).catch(()=>{});}await kb.up(k).catch(()=>{});}
    if(gap)await sleep(gap);
  }
  async keys(list,gap=150){for(const k of list)await this.key(k,{gap});}
  // evaluateJavascript: runs in whatever page is current (a late reply reaches a reloaded page).
  // Runs as Runtime.evaluate, which (like evaluateJavascript) the page's Content-Security-Policy doesn't stop. A script that
  // throws is the page's uncaught error, as on the TV (its console).
  async js(script){
    const p=this._page;if(!p)return;
    try{await p.evaluate(script);}catch(e){
      const t=String(e.message||e);
      if(!/Target (page, context or browser )?(has been )?closed|Execution context was destroyed|navigat|crash/i.test(t))this.errors.push(this.rec({kind:'error',what:'app script threw',script:script.slice(0,80),text:t.split('\n')[0].slice(0,200)}).text);
    }
  }
  // page.evaluate with a time limit (a page frozen while the app is off screen may not answer).
  ev(fn,arg,ms=10000){
    if(!this._page)return Promise.reject(new Error('no page'));
    let timer;const limit=new Promise((_,no)=>{timer=setTimeout(()=>no(new Error(`page.evaluate took over ${ms} ms${this.resumed?'':' (the app is off screen: the page is frozen)'}`)),ms);});
    return Promise.race([this._page.evaluate(fn,arg),limit]).finally(()=>clearTimeout(timer));
  }

  // --- Bridge.onMessage
  onMessage(raw){
    let m;try{m=JSON.parse(raw);}catch{this.rec({kind:'msg',type:'(unparsable)',raw:String(raw).slice(0,120)});return;}
    if(!m||typeof m!=='object'||Array.isArray(m)){this.rec({kind:'msg',type:'(not an object)'});return;}
    switch(m.type){
      case 'chime':{
        const v=Number(m.volume),vol=Math.min(1,Math.max(0,isNaN(v)||v===0?0.55:v));
        this.rec({kind:'chime',volume:vol,played:this.started});return;
      }
      case 'awake':this.wantsAwake=m.on!==false;this.rec({kind:'awake',on:this.wantsAwake});return;
      case 'ui':{const was=this.overlay;this.overlay=m.overlay===true;this.rec({kind:'ui',overlay:this.overlay,changed:was!==this.overlay});return;}
      // Erase all data (0.1.3): the app clears the web view's cache (pictures, tiles), as WebView.clearCache(true).
      case 'erase':this.erased=(this.erased||0)+1;this.rec({kind:'erase'});this.cdp?.send('Network.clearBrowserCache').catch(()=>{});return;
      case 'get':return this.get(m);
    }
    this.rec({kind:'msg',type:String(m.type)});
  }
  get(m){
    const id=m.id;
    if(!(typeof id==='number'&&Number.isInteger(id)&&Math.abs(id)<=Number.MAX_SAFE_INTEGER)){this.rec({kind:'msg',type:'get',bad:'id'});return;}
    const url=m.url;if(typeof url!=='string'){this.rec({kind:'msg',type:'get',bad:'url'});return;}
    const svc=service(url);
    if(!allowed(url)){
      this.rec({kind:'get',svc,url,allowed:false,status:'blocked',hidden:!this.started});
      return this.reply(id,BLOCKED,0);
    }
    const n=Number(m.timeoutMs),timeoutMs=Math.trunc(Math.min(12000,Math.max(1000,isNaN(n)||n===0?8000:n)));
    const binary=m.binary===true;
    const entry=this.rec({kind:'get',svc,url,binary,timeoutMs,allowed:true,fault:this.faults[svc]?.mode||'ok',hidden:!this.started,queued:this.busyThreads>=6});
    const job={entry,url,timeoutMs,binary,id,dead:false};
    this.queue.push(job);this.pump();
  }
  pump(){
    while(this.busyThreads<6&&this.queue.length){
      const job=this.queue.shift();this.busyThreads++;this.inFlight.add(job);
      job.entry.waitedMs=Math.round((this.t()-job.entry.t)*1000);
      this.fetch(job).then(r=>{
        this.busyThreads=Math.max(0,this.busyThreads-1);this.inFlight.delete(job);
        if(!job.dead&&r){job.entry.status=r.status;job.entry.ms=Math.round((this.t()-job.entry.t)*1000);job.entry.bytes=r.text.length;this.reply(job.id,r,0);}
        this.pump();
      });
    }
  }
  reply(id,r,delay){
    const s=`window.__whatsupReply&&window.__whatsupReply(${id},${typeof r.status==='number'?r.status:JSON.stringify(r.status)},${JSON.stringify(r.text)});true;`;
    const go=()=>this.js(s);
    if(delay)setTimeout(go,delay);else go();
  }
  // Fetcher.get, with the services mocked.
  async fetch(job){
    const {url,timeoutMs,binary}=job,start=Date.now(),left=()=>timeoutMs-(Date.now()-start);
    let where=url,redirected=0;
    for(let hop=0;hop<=MAX_HOPS;hop++){
      if(left()<=0)return CONNECTION_ERROR;
      const svc=service(where),f=this.faults[svc];
      const hit=f&&(f.partial===undefined||this.random()<f.partial);
      const mode=hit?f.mode:'ok';
      const wait=async ms=>{if(ms>=left()){await sleep(Math.max(0,left()));return false;}await sleep(ms);return true;};
      const base=f?.delayMs??25;
      if(mode==='noreply'){await new Promise(()=>{});}
      if(mode==='timeout'){await sleep(Math.max(0,left()));return CONNECTION_ERROR;}
      if(!await wait(/^slow:/.test(mode)?+mode.slice(5):base))return CONNECTION_ERROR;
      if(mode==='offline'||mode==='refuse')return CONNECTION_ERROR;
      if(/^s\d{3}$/.test(mode)){const st=+mode.slice(1);if(REDIRECTS.includes(st)&&f.location!==undefined){/* fall through to redirect */}else return R(st,f.retryAfter!==undefined?String(f.retryAfter):'');}
      if(mode==='redirect'||mode==='redirect-ok'&&redirected===0||mode==='redirect-loop'||/^s30\d$/.test(mode)){
        const loc=f.location??(mode==='redirect'?'https://captive.example.net/login?next=1':where);
        redirected++;
        let next;try{next=new URL(loc,where).toString();}catch{return BLOCKED;}
        if(!allowed(next))return BLOCKED;
        where=next;continue;
      }
      if(mode==='oversize')return OVERSIZE;
      let body;
      switch(mode){
        case 'garbage':body=binary?Buffer.from(Array.from({length:3000},(_,i)=>(i*7919+13)%256)):'\u0000ÿ{"ac":[{"hex":'+'x'.repeat(50);break;
        case 'portal':body=PORTAL;break;
        case 'empty':body='';break;
        case 'big':body=binary?Buffer.alloc(MAX_BYTES+1,7):'"'+'x'.repeat(MAX_BYTES)+'"';break;
        default:body=okBody(this,svc,where);
      }
      if(/^slowbody:/.test(mode)&&!await wait(+mode.slice(9)))return CONNECTION_ERROR;
      if(binary){
        const bytes=Buffer.isBuffer(body)?body:Buffer.from(body,'utf8');
        if(bytes.length>MAX_BYTES)return OVERSIZE;
        return R(200,bytes.toString('base64'));
      }
      let bytes=Buffer.isBuffer(body)?body:Buffer.from(body,'utf8');
      if(mode==='bom')bytes=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes]);
      if(mode==='badutf8'){const b=Buffer.from(bytes);for(let i=10;i<b.length;i+=97)b[i]=0xff;bytes=b;}
      if(bytes.length>3*MAX_BYTES)return OVERSIZE;
      const text=new TextDecoder('utf-8').decode(bytes); // drops a BOM, U+FFFD for bad bytes (Net.kt utf8())
      return text.length>MAX_BYTES?OVERSIZE:R(200,text);
    }
    return CONNECTION_ERROR;
  }

  // --- What the web view itself loads (PageFiles + shouldInterceptRequest).
  async onRoute(route){
    const req=route.request(),url=req.url();
    let u;try{u=new URL(url);}catch{return route.abort();}
    if(u.protocol==='data:'||u.protocol==='blob:'||u.protocol==='about:')return route.continue();
    if(u.protocol!=='https:'){this.rec({kind:'direct',url,refused:true,why:'scheme'});return route.fulfill({status:403,body:'',contentType:'text/plain'});}
    if(u.host==='appassets.androidplatform.net'){
      const asset=assetFor(u.pathname);
      const file=asset&&join(this.pages,this.variant,asset.slice(4));
      if(!asset||!existsSync(file)||statSync(file).isDirectory()){this.rec({kind:'direct',url,status:404,page:true});return route.fulfill({status:404,body:'',contentType:'text/plain'});}
      return route.fulfill({status:200,body:readFileSync(file),contentType:mimeType(asset)+(encoding(mimeType(asset))?'; charset=utf-8':'')});
    }
    const pic=PICTURE_HOSTS.some(h=>h.startsWith('*.')?u.host.endsWith(h.slice(1)):u.host===h);
    if(!pic){this.rec({kind:'direct',url,refused:true,type:req.resourceType()});return route.fulfill({status:403,body:'',contentType:'text/plain'});}
    const svc=service(url),f=this.faults[svc],hit=f&&(f.partial===undefined||this.random()<f.partial),mode=hit?f.mode:'ok';
    const entry=this.rec({kind:'direct',svc,url,type:req.resourceType(),fault:mode,hidden:!this.started});
    const ok=()=>route.fulfill({status:200,body:svc==='psimg'?PHOTO:IMAGERY,contentType:svc==='psimg'?'image/jpeg':'image/png'}).catch(()=>{});
    if(mode==='ok')return setTimeout(ok,f?.delayMs??20);
    if(mode==='offline'||mode==='refuse')return route.abort('internetdisconnected').catch(()=>{});
    if(/^s\d{3}$/.test(mode))return route.fulfill({status:+mode.slice(1),body:'error',contentType:'text/plain'}).catch(()=>{});
    if(mode==='timeout'||mode==='noreply'){this.held.push(route);entry.held=true;return;}
    if(/^slow:/.test(mode))return setTimeout(ok,+mode.slice(5));
    if(mode==='garbage')return route.fulfill({status:200,body:Buffer.from(Array.from({length:3000},(_,i)=>(i*7919+13)%256)),contentType:'image/jpeg'}).catch(()=>{});
    if(mode==='portal')return route.fulfill({status:200,body:PORTAL,contentType:'text/html'}).catch(()=>{});
    if(mode==='empty')return route.fulfill({status:200,body:'',contentType:'image/jpeg'}).catch(()=>{});
    return ok();
  }

  // --- Looking at the page.
  // The screens shown (top last), the focused control, the busy cog, the stage's fit, and text on screen.
  screen(){return this.ev(SCREEN);}
  // Invariants every test should hold; returns a list of problems (empty: fine).
  async check({allowExits=false}={}){
    const p=[];
    if(this.errors.length)p.push(...this.errors.map(e=>'page error: '+e));
    if(!this._page)return p;
    const s=await this.screen().catch(e=>({fail:String(e)}));
    if(s.fail)return [...p,'screen() failed: '+s.fail];
    if(s.viewport.innerW!==s.viewport.clientW||s.viewport.innerH!==s.viewport.clientH)p.push(`layout viewport widened: inner ${s.viewport.innerW}x${s.viewport.innerH} vs root ${s.viewport.clientW}x${s.viewport.clientH}`);
    if(s.viewport.scrollW>s.viewport.clientW+1||s.viewport.scrollH>s.viewport.clientH+1)p.push(`page scrolls: ${s.viewport.scrollW}x${s.viewport.scrollH} in ${s.viewport.clientW}x${s.viewport.clientH}`);
    const want=Math.min(this.dev.w/960,this.dev.h/540)*(this.variant.startsWith('store')?0.9:1);
    if(Math.abs(s.stage.scale-want)>0.002)p.push(`stage scale ${s.stage.scale.toFixed(4)}, expected ${want.toFixed(4)}`);
    if(Math.abs(s.stage.cx-this.dev.w/2)>1||Math.abs(s.stage.cy-this.dev.h/2)>1)p.push(`stage off centre: (${s.stage.cx},${s.stage.cy})`);
    // The app's Back flag against what's on screen: a screen over the map that isn't the first-run consent or the first search must catch Back.
    const top=s.top,firstRun=top==='consent'||top==='locate'&&!s.hasPlace&&s.layers.length===1;
    if(top&&!firstRun&&!this.overlay)p.push(`'${top}' is open but the app would take Back (overlay flag false): Back would leave the app`);
    if(!top&&!s.adjusting&&this.overlay&&!this.maybeBrowsing)p.push('nothing open, yet the app hands Back to the page (overlay flag true)');
    const refused=this.log.filter(e=>e.kind==='direct'&&e.refused);
    if(refused.length)p.push(`web view asked for addresses the app refuses: ${[...new Set(refused.map(e=>e.url))].slice(0,5).join(', ')}`);
    const blocked=this.log.filter(e=>e.kind==='get'&&!e.allowed);
    if(blocked.length)p.push(`page asked the bridge for addresses off the allow-list: ${[...new Set(blocked.map(e=>e.url))].slice(0,5).join(', ')}`);
    const page404=this.log.filter(e=>e.kind==='direct'&&e.page);
    if(page404.length)p.push(`page files missing: ${[...new Set(page404.map(e=>e.url))].join(', ')}`);
    const hidden=this.log.filter(e=>(e.kind==='get'||e.kind==='direct')&&e.hidden);
    if(hidden.length)p.push(`${hidden.length} requests while the app was off screen (first: ${hidden[0].url})`);
    if(!allowExits&&this.exits)p.push(`${this.exits} Back press(es) left the app`);
    return p;
  }
  async shot(name){const f=join(this.out,name.replace(/[^\w.-]/g,'_')+'.png');await this._page.screenshot({path:f});return f;}
  async metrics(){const r=await this.cdp.send('Performance.getMetrics');return Object.fromEntries(r.metrics.map(m=>[m.name,m.value]));}
  requests(svc,t0=0,t1=1e9){return this.log.filter(e=>(e.kind==='get'||e.kind==='direct')&&(!svc||e.svc===svc)&&e.t>=t0&&e.t<=t1);}
  async waitFor(fn,ms=10000,arg){const end=Date.now()+ms;while(Date.now()<end){try{if(await this.ev(fn,arg))return true;}catch{}await sleep(100);}return false;}
  saveLog(name='log'){const f=join(this.out,name+'.json');writeFileSync(f,JSON.stringify({log:this.log,errors:this.errors},null,1));return f;}
  async close(){
    for(const r of this.held)r.abort().catch(()=>{});
    await this.context.close().catch(()=>{});
    if(--BROWSER_USERS<=0&&BROWSER){const b=await BROWSER;BROWSER=null;await b.close().catch(()=>{});}
  }
}

const menuKey=(type,repeat)=>`document.dispatchEvent(new KeyboardEvent('${type}',{key:'ContextMenu',code:'ContextMenu',repeat:${repeat},bubbles:true,cancelable:true}));true;`;
// PageFiles.assetFor / mimeType / encoding
const SEGMENT=/^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
export function assetFor(path){
  if(path==null||!path.startsWith('/www/'))return null;
  const parts=path.slice(5).split('/');
  if(parts.some(p=>!SEGMENT.test(p)))return null;
  return 'www/'+parts.join('/');
}
const TYPES_MIME={html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',txt:'text/plain',json:'application/json',svg:'image/svg+xml',
  png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',woff2:'font/woff2',woff:'font/woff',ttf:'font/ttf',otf:'font/otf',
  mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',mp4:'video/mp4'};
export const mimeType=a=>TYPES_MIME[(a.includes('.')?a.slice(a.lastIndexOf('.')+1):'').toLowerCase()]||'application/octet-stream';
const encoding=m=>m.startsWith('text/')||m==='application/json'||m==='image/svg+xml';

// Runs in the page.
const SCREEN=()=>{
  const de=document.documentElement,stage=document.getElementById('stage'),r=stage.getBoundingClientRect();
  const shown=e=>e&&!e.hidden&&getComputedStyle(e).display!=='none';
  const layers=[...document.querySelectorAll('.overlay,.picker')].filter(shown).sort((a,b)=>(+a.style.zIndex||0)-(+b.style.zIndex||0)).map(e=>e.id);
  const f=document.querySelector('.focus');
  let settings={};try{settings=JSON.parse(localStorage.getItem('whatsup.settings.v1'))||{};}catch{}
  const top=layers.at(-1)||null,el=top?document.getElementById(top):document.getElementById('layout');
  const notes=['layout-note','toast'].map(id=>document.getElementById(id)).filter(e=>e&&e.textContent.trim()&&getComputedStyle(e).opacity!=='0').map(e=>e.id+': '+e.textContent.trim());
  return {
    layers,top,adjusting:stage.classList.contains('adjusting'),busy:document.getElementById('busy').classList.contains('on'),
    focused:f?(f.id||f.dataset.key||f.dataset.action||f.className)+(f.textContent?': '+f.textContent.replace(/\s+/g,' ').trim().slice(0,60):''):null,
    hasPlace:!!settings.place,layout:settings.layout||null,
    stage:{scale:+(r.width/960).toFixed(5),cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height)},
    viewport:{innerW:innerWidth,innerH:innerHeight,clientW:de.clientWidth,clientH:de.clientHeight,scrollW:de.scrollWidth,scrollH:de.scrollHeight,vvScale:visualViewport?.scale??1},
    text:(el?.innerText||'').replace(/\s+/g,' ').trim().slice(0,500),notes,
  };
};
