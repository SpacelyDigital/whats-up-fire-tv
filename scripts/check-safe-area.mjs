// node scripts/check-safe-area.mjs [layout ...]  (needs the dev server on a store-profile build:
//   WHATSUP_PROFILE=store WHATSUP_OUT=$PWD/build/store-assets npm run build:web
//   node scripts/dev-server.mjs build/store-assets 8767)
// Title-safe check (Amazon's overscan guidance): no visible text inside the outer 5% of the
// screen (96 px left and right, 54 px top and bottom at 1920×1080), in every layout at
// 1920×1080 and 1280×720: the dashboard in the busy, long, longest, emergency and quiet demo
// scenes (with the opening credit line, and the map-radius toast), Settings, the layout picker,
// the location screens (keyboard with results, the match, the first-run card, Adjust
// position), Privacy and its Erase box, About and the first-run consent. Geocoding answers
// are canned and photo lookups refused here (model photos show), imagery isn't loaded; the
// map tiles come through the dev server. Prints the text closest to the edges per layout and,
// from those distances, the largest stage scale that would keep it all inside 5%.
// CHECK_SIZES=1080 or 720 runs one size. Exit code 1 if any text is inside the outer 5%.
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';

const BASE=process.env.CHECK_URL||'http://localhost:8767/index.html';
const LAYOUTS=['atlas-dark','atlas','atlas-satellite','radar','glass','departures','blueprint','swiss','synthwave','sectional','cockpit','night-sky'];
const SIZES=[[1920,1080],[1280,720]].filter(([,h])=>!process.env.CHECK_SIZES||process.env.CHECK_SIZES.split(',').includes(String(h)));
const HEBRON={name:'Hebron',admin:'Kentucky',country:'United States',countryCode:'US',latitude:39.0659,longitude:-84.7011,timeZone:'America/New_York',confirmed:true};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Canned geocoder replies and no photo lookups, in front of the dev server's bridge.
const MOCK=`(()=>{let v;const PLACES=[['Chicago','Illinois',41.85,-87.65],['Chicago Heights','Illinois',41.506,-87.636],['Chicago Ridge','Illinois',41.701,-87.779],['West Chicago','Illinois',41.885,-88.204]];
  const reply=(id,status,text)=>setTimeout(()=>window.__whatsupReply(id,status,text),30);
  Object.defineProperty(window,'ReactNativeWebView',{configurable:true,get:()=>v,set:b=>{const pm=b.postMessage.bind(b);b.postMessage=d=>{const r=JSON.parse(d),u=r.url||'';
    if(/geocoding-api\\.open-meteo\\.com/.test(u))return reply(r.id,200,JSON.stringify({results:PLACES.map(([name,admin1,latitude,longitude],i)=>({id:i+1,name,admin1,latitude,longitude,country:'United States',country_code:'US',timezone:'America/Chicago',elevation:180}))}));
    if(/api\\.open-meteo\\.com\\/v1\\/forecast/.test(u))return reply(r.id,200,JSON.stringify({timezone:'America/Chicago',elevation:180}));
    if(/planespotters/.test(u))return reply(r.id,404,'');
    pm(d);};v=b;}});})();`;

async function page(w,h,{consent=true,layout}){
  const port=9400+Math.floor(Math.random()*500),profile=mkdtempSync(tmpdir()+'/safe');
  const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new',`--remote-debugging-port=${port}`,
    '--user-data-dir='+profile,`--window-size=${w},${h}`,'about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]||m.params.exceptionDetails.text);};
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
  const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.value;
  const key=async(k,c)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:c});};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['*basemap.nationalmap.gov*','*tiles.maps.eox.at*','*planespotters*','*plnspttrs*']});
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
  const settings={place:HEBRON,confirmed:true,layout,mapMiles:15};
  await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK+`;try{${consent?`localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-11-03'}));`:''}
    if(!localStorage.getItem('whatsup.settings.v1'))localStorage.setItem('whatsup.settings.v1',${JSON.stringify(JSON.stringify(settings))});}catch{}`});
  return {send,ev,key,errors,go:url=>send('Page.navigate',{url}),close(){ws.close();chrome.kill();setTimeout(()=>{try{rmSync(profile,{recursive:true,force:true});}catch{}},800);}};
}

// Every visible piece of text on the stage (HTML and SVG), as screen boxes cut to whatever
// clips it, with its distance to each screen edge.
const MEASURE=`(()=>{const W=innerWidth,H=innerHeight,out=[];
  const shown=el=>{for(let e=el;e&&e.nodeType===1;e=e.parentElement){const cs=getComputedStyle(e);
    if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0||e.classList.contains('sr-only'))return false;}return true;};
  const clip=(el,r)=>{for(let e=el.parentElement;e&&e!==document.body;e=e.parentElement){const cs=getComputedStyle(e);
    if(cs.overflowX==='visible'&&cs.overflowY==='visible'&&e.tagName!=='svg')continue;const b=e.getBoundingClientRect();
    r={left:Math.max(r.left,b.left),right:Math.min(r.right,b.right),top:Math.max(r.top,b.top),bottom:Math.min(r.bottom,b.bottom)};
    if(r.right-r.left<1||r.bottom-r.top<1)return null;}
    r={left:Math.max(r.left,0),right:Math.min(r.right,W),top:Math.max(r.top,0),bottom:Math.min(r.bottom,H)};
    return r.right-r.left<1||r.bottom-r.top<1?null:r;};
  const walk=document.createTreeWalker(document.getElementById('stage'),NodeFilter.SHOW_TEXT);
  for(let n;(n=walk.nextNode());){
    const t=n.textContent.trim();if(!t)continue;const el=n.parentElement;if(!el||!shown(el))continue;
    let rects;
    if(el instanceof SVGElement)rects=[el.getBoundingClientRect()];
    else{const rg=document.createRange();rg.selectNodeContents(n);rects=[...rg.getClientRects()];}
    for(const r0 of rects){if(r0.width<1||r0.height<1)continue;const r=clip(el,r0);if(!r)continue;
      out.push({t:t.slice(0,40),cls:(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className?'.'+el.className.split(' ')[0]:el.className?.baseVal?'.'+el.className.baseVal.split(' ')[0]:''),
        l:r.left,r:W-r.right,tp:r.top,b:H-r.bottom});}
  }
  return {W,H,items:out,scale:document.getElementById('stage').getBoundingClientRect().width/W};})()`;

const fails=[],worst={x:Infinity,y:Infinity,xi:null,yi:null};let stageScale=1;
const only=process.argv.slice(2);
// One state: measure, keep the text inside 5% and the closest to each axis.
function tally(res,state,acc){
  if(!res)return acc.bad.push(`${state}: page not measured`);
  const {W,H,items}=res,mx=W*.05,my=H*.05;if(res.scale>0)stageScale=res.scale;
  if(!items.length)acc.bad.push(`${state}: no text found`);
  for(const it of items){
    const dx=Math.min(it.l,it.r),dy=Math.min(it.tp,it.b);
    if(dx<mx||dy<my)acc.inside.push(`${state}: "${it.t}" ${it.cls} ${dx<mx?`${Math.round(dx)} px from the ${it.l<it.r?'left':'right'}`:''}${dx<mx&&dy<my?', ':''}${dy<my?`${Math.round(dy)} px from the ${it.tp<it.b?'top':'bottom'}`:''}`);
    if(dx/W<acc.x){acc.x=dx/W;acc.xi=`${state}: "${it.t}" ${it.cls}`;}
    if(dy/H<acc.y){acc.y=dy/H;acc.yi=`${state}: "${it.t}" ${it.cls}`;}
  }
}
const samples=async(p,state,acc,times)=>{let t0=0;for(const t of times){await sleep(t-t0);t0=t;tally(await p.ev(MEASURE),state,acc);}};

for(const [w,h] of SIZES)for(const layout of LAYOUTS){
  if(only.length&&!only.includes(layout))continue;
  const acc={inside:[],bad:[],x:Infinity,y:Infinity,xi:'',yi:''};
  const url=q=>`${BASE}?demo=1&layout=${layout}&map=15${q?'&'+q:''}`;
  const p=await page(w,h,{layout});
  // The first load builds and saves the maps; the scenes after it reuse them.
  await p.go(url(''));await sleep(9000);
  for(const scene of ['','long','longest','emergency','quiet']){
    await p.go(url(scene&&'scene='+scene));
    await samples(p,scene||'busy',acc,[2500,7000]); // the opening credit line is up for the first 5 s
    if(!scene){await p.key('ArrowUp',38);await sleep(300);tally(await p.ev(MEASURE),'busy, map-radius toast',acc);}
  }
  for(const [state,q,then] of [['Settings','screen=settings'],['layout picker','screen=picker'],['location (keyboard and results)','screen=locate&typed=CHICAGO'],
    ['location (the match)','screen=locate&typed=CHICAGO',`document.querySelector('#results button')?.click()`],['first-run card','screen=welcome'],
    ['Adjust position','screen=adjust'],['Privacy','screen=settings',`document.getElementById('set-privacy').click()`],
    ['Erase box','screen=settings',`document.getElementById('set-privacy').click();document.getElementById('privacy-erase').click()`],
    ['About','screen=settings',`document.getElementById('set-about').click()`]]){
    await p.go(url(q));await sleep(state==='Adjust position'?4500:3000);
    if(then){await p.ev(then);await sleep(900);}
    tally(await p.ev(MEASURE),state,acc);
  }
  if(p.errors.length)acc.bad.push(`page errors: ${[...new Set(p.errors)].slice(0,2).join(' | ')}`);
  p.close();
  // First launch: the consent screen, before anything is fetched.
  const c=await page(w,h,{consent:false,layout});await c.go(`${BASE}?layout=${layout}`);await sleep(2500);
  tally(await c.ev(MEASURE),'consent',acc);c.close();
  const ok=!acc.inside.length&&!acc.bad.length;
  console.log(`${ok?'ok  ':'FAIL'} ${h}p ${layout.padEnd(16)} closest: ${(acc.x*100).toFixed(2)}% of the width (${acc.xi}), ${(acc.y*100).toFixed(2)}% of the height (${acc.yi})`);
  for(const line of [...acc.bad,...acc.inside.slice(0,8)])console.log(`     ${line}`);
  if(acc.inside.length>8)console.log(`     … ${acc.inside.length-8} more inside the outer 5%`);
  if(!ok)fails.push(`${h}p ${layout}`);
  if(acc.x<worst.x){worst.x=acc.x;worst.xi=`${h}p ${layout} ${acc.xi}`;}
  if(acc.y<worst.y){worst.y=acc.y;worst.yi=`${h}p ${layout} ${acc.yi}`;}
}
// The stage scaled by S about the centre moves text d from an edge to (1-S)/2 + S·d (as a
// share of that dimension): S = 0.9 / (1 - 2d) keeps the closest text at exactly 5%.
const S=d=>Math.min(1,.9/(1-2*d));
console.log(`\nclosest text: ${(worst.x*100).toFixed(2)}% from a side (${worst.xi}); ${(worst.y*100).toFixed(2)}% from the top or bottom (${worst.yi})`);
if(stageScale>.995)console.log(`largest stage scale that would keep all of it inside 5%: ${Math.min(S(worst.x),S(worst.y)).toFixed(4)}`);
else console.log(`stage drawn at ${(stageScale*100).toFixed(1)}% of the screen`);
console.log(fails.length?`FAIL: text inside the outer 5% in ${fails.length} of ${SIZES.length*LAYOUTS.filter(l=>!only.length||only.includes(l)).length}`:'all text inside the title-safe area');
process.exit(fails.length?1:0);
