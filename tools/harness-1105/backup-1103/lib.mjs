// Fault-injection harness for the What's Up page (store build) in headless Chrome.
// Every network request is answered here: bridge requests (window.ReactNativeWebView,
// mocked in the page and forwarded to Node through a CDP binding) and the web engine's
// own loads (images: USGS/EOX/Planespotters CDN) through CDP Fetch interception.
// Nothing reaches the internet except OpenFreeMap tiles not yet in ./tilecache (fetched
// once, then replayed from disk).
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
const CACHE=join(HERE,'tilecache');mkdirSync(CACHE,{recursive:true});
export const PORT=Number(process.env.PORT)||8802;
export const SHOTS=process.env.SHOTS||'~/Documents/ChatGPT/Vibe Coding/whatsup/qa/backup-2026-11-03/shots';mkdirSync(SHOTS,{recursive:true});
const JPG=readFileSync('~/whats-up/whatsup-fixes/build/store-assets-faults/models/A20N.jpg');
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Host allowlist, copied from src/App.tsx.
const ALLOWED=[
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
export function service(url){
  const h=(/^https?:\/\/([^/?#]+)/.exec(url)||[])[1]||'';
  if(h==='opendata.adsb.fi')return 'feed';
  if(h==='api.adsb.lol')return 'backup';
  if(/(^|\.)adsb\.lol$/.test(h))return 'routes';
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
  return 'OTHER';
}

// --- Mocked "ok" replies.
const HOME={lat:39.0489,lon:-84.6678}; // CVG airport (public)
export const PLACES={
  HEBRON:{name:'Hebron',latitude:39.0659,longitude:-84.7011,country_code:'US',country:'United States',admin1:'Kentucky',timezone:'America/New_York',elevation:270},
  CHICAGO:{name:'Chicago',latitude:41.85,longitude:-87.65,country_code:'US',country:'United States',admin1:'Illinois',timezone:'America/Chicago',elevation:180},
  ROSEMONT:{name:'Rosemont',latitude:41.9953,longitude:-87.8845,country_code:'US',country:'United States',admin1:'Illinois',timezone:'America/Chicago',elevation:195},
  LONDON:{name:'London',latitude:51.5085,longitude:-0.1257,country_code:'GB',country:'United Kingdom',admin1:'England',timezone:'Europe/London',elevation:25},
  TOKYO:{name:'Tokyo',latitude:35.6895,longitude:139.6917,country_code:'JP',country:'Japan',admin1:'Tokyo',timezone:'Asia/Tokyo',elevation:44},
  CELLA:{name:'Cvg A',latitude:39.0489,longitude:-84.6678,country_code:'US',country:'United States',admin1:'Kentucky',timezone:'America/New_York',elevation:270},
  CELLB:{name:'Cvg B',latitude:39.0611,longitude:-84.6555,country_code:'US',country:'United States',admin1:'Kentucky',timezone:'America/New_York',elevation:270},
  CELLC:{name:'Cvg C',latitude:39.0789,longitude:-84.6678,country_code:'US',country:'United States',admin1:'Kentucky',timezone:'America/New_York',elevation:270},
  LONDA:{name:'Lond A',latitude:51.5085,longitude:-0.1257,country_code:'GB',country:'United Kingdom',admin1:'England',timezone:'Europe/London',elevation:25},
  LONDB:{name:'Lond B',latitude:51.4934,longitude:-0.1438,country_code:'GB',country:'United Kingdom',admin1:'England',timezone:'Europe/London',elevation:25},
  SYDNEY:{name:'Sydney',latitude:-33.8678,longitude:151.2073,country_code:'AU',country:'Australia',admin1:'New South Wales',timezone:'Australia/Sydney',elevation:58},
};
function omSearch(url){
  const name=decodeURIComponent((/name=([^&]*)/.exec(url)||[])[1]||'').toUpperCase();
  const hits=Object.entries(PLACES).filter(([k])=>k.startsWith(name.replace(/\s+.*/,''))&&name.length>=3).map(([,v])=>v);
  return JSON.stringify(hits.length?{results:hits,generationtime_ms:0.5}:{generationtime_ms:0.5});
}
const TZ=lat=>lat>45?'Europe/London':'America/New_York';
function planes(la,lo,nowMs){
  const t=nowMs/1000,cos=Math.cos(la*Math.PI/180);
  const P=[['a1b2c3','DAL1234','N123DL','B739'],['a2c3d4','UAL567','N456UA','A320'],['a3d4e5','FDX88','N789FD','B77L'],
    ['a4e5f6','N12345','N12345','C172'],['a5f6a7','AAL2201','N321AA','A321'],['a6a7b8','SWA910','N8710M','B38M'],
    ['a7b8c9','RPA4455','N101YX','E75L'],['a8c9d0','UPS2905','N608UP','B763'],['ae1234','RCH401','05-5140','C17'],
    ['a9d0e1','EDV5012','N601XJ','CRJ9'],['aa0e1f','N75WX','N75WX','BE36'],['ab1f20','JIA5300','N546NN','CRJ7']];
  return P.map(([hex,flight,r,type],i)=>{
    const ang=(t/600+i/P.length)*2*Math.PI,rad=i<3?1.5+i*0.6:3+i*1.6; // miles; the first three inside 3 mi
    const dy=rad*Math.cos(ang)/69,dx=rad*Math.sin(ang)/(69.17*cos);
    return {hex,type:'adsb_icao',flight:flight.padEnd(8),r,t:type,alt_baro:3000+i*2500,alt_geom:3100+i*2500,gs:180+i*20,
      track:((ang*180/Math.PI)+90)%360,baro_rate:i%2?-640:832,squawk:'1200',category:i===3?'A1':'A3',lat:HOME.lat+dy,lon:HOME.lon+dx,
      nic:8,messages:1000+i,seen_pos:0.4,seen:0.2,rssi:-20};
  });
}
function feedBody(url,backup=false){
  const now=state.feedFrozen||Date.now()+(state.feedNowShift||0); // the true clock (the page's Date may be shifted)
  const m=/lat\/(-?[\d.]+)\/lon\/(-?[\d.]+)\/dist\/(\d+)/.exec(url);
  const ac=state.feedEmpty?[]:planes(+m[1],+m[2],now);
  return JSON.stringify({ac,msg:'No error',now,total:ac.length,ctime:now,ptime:3});
}
const routeBody=url=>{
  const call=(/\/([A-Z0-9-]+)\.json$/.exec(url)||[])[1]||'';
  return JSON.stringify({callsign:call,_airport_codes_iata:'DTW-ATL',airport_codes:'KDTW-KATL',
    _airports:[{name:'Detroit Metropolitan Wayne County Airport',icao:'KDTW',iata:'DTW',location:'Detroit',countryiso2:'US',lat:42.212,lon:-83.353,alt_feet:645},
      {name:'Hartsfield-Jackson Atlanta International Airport',icao:'KATL',iata:'ATL',location:'Atlanta',countryiso2:'US',lat:33.637,lon:-84.428,alt_feet:1026}]});
};
const photoBody=url=>{
  const id=(/\/(hex|reg)\/([^/]+)$/.exec(url)||[])[2];
  return JSON.stringify({photos:[{id:'1',thumbnail:{src:`https://t.plnspttrs.net/1/${id}_t.jpg`,size:{width:200,height:133}},
    thumbnail_large:{src:`https://t.plnspttrs.net/1/${id}_280.jpg`,size:{width:420,height:280}},
    link:`https://www.planespotters.net/photo/1/${id}`,photographer:'Test Photographer'}]});
};
const censusBody=()=>JSON.stringify({result:{input:{},addressMatches:[{matchedAddress:'3087 TERMINAL DR, HEBRON, KY, 41048',
  coordinates:{x:-84.6663,y:39.0502},addressComponents:{city:'HEBRON',state:'KY',zip:'41048'}}]}});
const nominatimBody=()=>JSON.stringify(state.nomMulti?[
  {lat:'51.5034',lon:'-0.1276',name:'Downing Street',address:{house_number:'10',road:'Downing Street',city:'London',state:'England',country:'United Kingdom',country_code:'gb'}},
  {lat:'53.4808',lon:'-2.2426',name:'Downing Street',address:{house_number:'10',road:'Downing Street',city:'Manchester',state:'England',country:'United Kingdom',country_code:'gb'}},
  {lat:'52.2053',lon:'0.1218',name:'Downing Street',address:{house_number:'10',road:'Downing Street',city:'Cambridge',state:'England',country:'United Kingdom',country_code:'gb'}}]:[{lat:'51.5034',lon:'-0.1276',name:'10 Downing Street',
  address:{house_number:'10',road:'Downing Street',city:'London',state:'England',country:'United Kingdom',country_code:'gb'}}]);
let TILEJSON=null;
async function tile(url){
  const f=join(CACHE,url.replace(/^https:\/\//,'').replace(/[^\w.-]/g,'_'));
  if(existsSync(f))return readFileSync(f);
  state.liveTiles++;
  const r=await fetch(url,{headers:{'User-Agent':'WhatsUp-FireTV QA replay cache (Spacely Digital; spacelydigital@gmail.com)'}});
  if(r.status!==200)throw new Error('live tile '+r.status);
  const b=Buffer.from(await r.arrayBuffer());writeFileSync(f,b);return b;
}
async function okReply(svc,url,binary){
  switch(svc){
    case 'feed':return feedBody(url);
    case 'backup':return feedBody(url,true);
    case 'routes':return routeBody(url);
    case 'psapi':return photoBody(url);
    case 'geojs':return JSON.stringify({city:'Hebron',region:'Kentucky',country:'United States',country_code:'US',latitude:'39.0659',longitude:'-84.7011',timezone:'America/New_York',accuracy:20,ip:'203.0.113.9'});
    case 'omsearch':return omSearch(url);
    case 'omforecast':{const la=+(/latitude=(-?[\d.]+)/.exec(url)||[])[1];return JSON.stringify({latitude:la,timezone:TZ(la),elevation:250,utc_offset_seconds:0});}
    case 'census':return censusBody();
    case 'nominatim':return nominatimBody();
    case 'tilejson':{
      if(!TILEJSON){const f=join(CACHE,'tilejson.json');if(!existsSync(f)){state.liveTiles++;writeFileSync(f,await (await fetch(url)).text());}TILEJSON=readFileSync(f,'utf8');}
      return TILEJSON;}
    case 'tiles':return (await tile(url)).toString('base64');
  }
  return '';
}

// --- Faults. state.faults[svc] = {mode, retryAfter, partial(0..1), delayMs}
export const state={faults:{},log:[],liveTiles:0,feedEmpty:false,clockOffsetMs:0};
export const setFault=(svc,mode,opts={})=>{if(mode==='ok'||!mode)delete state.faults[svc];else state.faults[svc]={mode,...opts};};
export const setAll=(mode,opts)=>{for(const s of ['feed','backup','routes','psapi','psimg','tilejson','tiles','usgs','eox','omsearch','omforecast','census','nominatim','geojs'])setFault(s,mode,opts);};
const PORTAL='<!DOCTYPE html><html><head><title>Guest Wi-Fi</title></head><body><h1>Welcome to Hotel Wi-Fi</h1><form action="/login"><input name="room"></form></body></html>';
// The bridge reply for a request, honouring the host's semantics (src/App.tsx): it caps the
// wait at min(12 s, max(1 s, timeoutMs)) and then answers connection_error.
async function bridgeReply(svc,url,binary,timeoutMs){
  const f=state.faults[svc];
  const cap=Math.min(12000,Math.max(1000,Number(timeoutMs)||8000));
  if(!f){
    let delay=30;
    try{return {delay,status:200,text:await okReply(svc,url,binary)};}catch(e){return {delay,status:'connection_error',text:''};}
  }
  if(f.partial!==undefined&&Math.random()>=f.partial){try{return {delay:30,status:200,text:await okReply(svc,url,binary)};}catch{return {delay:30,status:'connection_error',text:''};}}
  const b=s=>binary?Buffer.from(s).toString('base64'):s;
  switch(f.mode){
    case 'offline':return {delay:20,status:'connection_error',text:''};
    case 's403':return {delay:60,status:403,text:''};
    case 's404':return {delay:60,status:404,text:''};
    case 's500':return {delay:60,status:500,text:''};
    case 's503':return {delay:60,status:503,text:f.retryAfter?String(f.retryAfter):''};
    case 's429':return {delay:60,status:429,text:f.retryAfter!==undefined?String(f.retryAfter):''};
    case 'timeout':return {delay:cap,status:'connection_error',text:''};
    case 'slow30':return 30000>cap?{delay:cap,status:'connection_error',text:''}:{delay:30000,status:200,text:await okReply(svc,url,binary)};
    case 'noreply':return null; // a host that never answers (not the real host; tests the page's own timer)
    case 'garbage':return {delay:60,status:200,text:binary?Buffer.from(Array.from({length:3000},(_,i)=>(i*7919+13)%256)).toString('base64'):'\u0000ÿ{"ac":[{"hex":'+'x'.repeat(50)};
    case 'portal':return {delay:60,status:200,text:b(PORTAL)};
    case 'empty':return {delay:60,status:200,text:''};
    case 'redirect':return {delay:60,status:'blocked',text:''}; // a portal redirect to another host: the host refuses it
  }
  return {delay:30,status:200,text:await okReply(svc,url,binary)};
}

// --- Chrome
export async function open({url,clock=0,size=[960,540],keepProfile=null,dsf=1}={}){
  state.log=[];state.clockOffsetMs=clock;
  // Port 0: Chrome picks a free debugging port and writes it to DevToolsActivePort in its profile,
  // so two browsers never share one (a shared port let one run drive another run's page).
  const profile=keepProfile||mkdtempSync(tmpdir()+'/faults');try{rmSync(join(profile,'DevToolsActivePort'));}catch{}
  const chrome=spawn(process.env.CHECK_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--use-mock-keychain','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
    '--user-data-dir='+profile,`--window-size=${size[0]},${size[1]}`,'--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-component-update','--disable-sync','--disable-domain-reliability','--metrics-recording-only','about:blank'],{stdio:'ignore'});
  let port=0;for(let i=0;i<80&&!port;i++){await sleep(250);try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])||0;}catch{}}
  let tabs;for(let i=0;i<60&&!tabs;i++){try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{await sleep(250);}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map(),errors=[];
  const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
  const T0=Date.now();
  const rec=e=>{e.t=(Date.now()-T0)/1000;state.log.push(e);return e;};
  ws.onmessage=async e=>{
    const m=JSON.parse(e.data);
    if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result||{error:m.error});waiting.delete(m.id);return;}
    if(m.method==='Runtime.exceptionThrown')errors.push('exception: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text).split('\n').slice(0,2).join(' | '));
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push('console.error: '+m.params.args.map(a=>a.value??a.description).join(' ').slice(0,200));
    if(m.method==='Runtime.bindingCalled'&&m.params.name==='__qaBridge'){
      const q=JSON.parse(m.params.payload);
      if(q.type!=='get'){rec({kind:'msg',type:q.type,detail:q});return;}
      const svc=service(q.url),allowed=ALLOWED.some(p=>p.test(q.url));
      const entry=rec({kind:'bridge',svc,url:q.url,binary:!!q.binary,timeoutMs:q.timeoutMs,allowed,fault:state.faults[svc]?.mode||'ok'});
      const reply=allowed?await bridgeReply(svc,q.url,q.binary,q.timeoutMs):{delay:5,status:'blocked',text:''};
      if(!reply){entry.status='(no reply)';return;}
      entry.status=reply.status;
      setTimeout(()=>send('Runtime.evaluate',{expression:`window.__whatsupReply&&window.__whatsupReply(${q.id},${JSON.stringify(reply.status)},${JSON.stringify(reply.text)})`}),reply.delay);
      return;
    }
    if(m.method==='Fetch.requestPaused'){
      const {requestId,request}=m.params,u=request.url;
      if(u.startsWith(`http://127.0.0.1:${PORT}/`)||u.startsWith(`http://localhost:${PORT}/`)||u.startsWith('data:')){send('Fetch.continueRequest',{requestId});return;}
      const svc=service(u),f=state.faults[svc];
      const entry=rec({kind:'direct',svc,url:u,type:m.params.resourceType,fault:f?.mode||'ok'});
      const ok=()=>send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/jpeg'},{name:'Access-Control-Allow-Origin',value:'*'}],body:JPG.toString('base64')});
      const fulfill=(code,body,ct='image/jpeg')=>send('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:ct}],body:Buffer.from(body).toString('base64')});
      if(svc==='OTHER'){entry.status='failed';send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return;}
      const mode=f&&(f.partial===undefined||Math.random()<f.partial)?f.mode:'ok';
      entry.status=mode;
      if(mode==='ok')return ok();
      if(mode==='offline')return send('Fetch.failRequest',{requestId,errorReason:'InternetDisconnected'});
      if(/^s(\d+)$/.test(mode))return fulfill(+mode.slice(1),'error','text/plain');
      if(mode==='timeout'||mode==='noreply'){state.held=(state.held||[]);state.held.push(requestId);return;} // never answered
      if(mode==='slow30')return setTimeout(ok,30000);
      if(mode==='garbage')return fulfill(200,Buffer.from(Array.from({length:3000},(_,i)=>(i*7919+13)%256)));
      if(mode==='portal')return fulfill(200,PORTAL,'text/html');
      if(mode==='empty')return fulfill(200,'');
      return ok();
    }
  };
  await new Promise(r=>ws.onopen=r);
  await send('Runtime.enable');await send('Page.enable');
  await send('Runtime.addBinding',{name:'__qaBridge'});
  await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:size[0],height:size[1],deviceScaleFactor:dsf,mobile:false});
  // The mocked app bridge and a shiftable clock (window.__qaClock ms, changeable later).
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    window.__qaClock=${Number(clock)||0};
    const D=Date;
    class FakeDate extends D{constructor(...a){if(a.length)super(...a);else super(D.now()+window.__qaClock);}
      static now(){return D.now()+window.__qaClock;}}
    FakeDate.UTC=D.UTC;FakeDate.parse=D.parse;window.Date=FakeDate;
    window.ReactNativeWebView={postMessage(d){window.__qaBridge(d);}};
  })();`});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return r.result?.value;};
  const key=async(k,code)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k.length===1?'Key'+k.toUpperCase():k,windowsVirtualKeyCode:code||({ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Enter:13,Escape:27,MediaPlayPause:179}[k]||k.toUpperCase().charCodeAt(0))});await sleep(120);};
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(SHOTS,name+'.png'),Buffer.from(r.data,'base64'));return join(SHOTS,name+'.png');};
  const text=()=>ev(`(()=>{const out=[];for(const id of ['layout-note','toast']){const e=document.getElementById(id);if(e&&e.textContent.trim()&&getComputedStyle(e).opacity!=='0')out.push(id+': '+e.textContent.trim());}
    const ov=[...document.querySelectorAll('.overlay')].filter(o=>!o.hidden);
    return {overlays:ov.map(o=>o.id),screen:(ov.length?ov.at(-1):document.getElementById('layout')).innerText.replace(/\\s+/g,' ').trim().slice(0,600),notes:out};})()`);
  const setClock=ms=>{state.clockOffsetMs=ms;return ev(`window.__qaClock=${ms}`);};
  if(url)await send('Page.navigate',{url});
  return {send,ev,key,shot,text,errors,setClock,T0,close(){ws.close();chrome.kill();if(!keepProfile)setTimeout(()=>{try{rmSync(profile,{recursive:true,force:true});}catch{}},500);},profile};
}
export const base=(qs='')=>`http://127.0.0.1:${PORT}/index.html?bridge=0${qs?'&'+qs:''}`;
// Requests per service in a time window [t0,t1] (seconds since open).
export function rate(svc,t0=0,t1=1e9){return state.log.filter(e=>(e.kind==='bridge'||e.kind==='direct')&&e.svc===svc&&e.t>=t0&&e.t<=t1);}
export function gaps(list){const t=list.map(e=>e.t);return t.slice(1).map((v,i)=>Math.round((v-t[i])*10)/10);}
