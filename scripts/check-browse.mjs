// node scripts/check-browse.mjs [layout ...]  (needs the dev server: node scripts/dev-server.mjs assets 8767)
// Left/Right plane browsing (web/browse.mjs) in every layout at 1920×1080 and 1280×720, in the busy
// demo scene: Right steps through every plane on the map, closest first from the hero, and wraps
// round. After each press the card shows that plane (its flight on the card, one hero mark on the
// map, a different aircraft each time), the heading shows "n OF N" (or "n/N") with the plane's
// number on one line, nothing on the screen is cut, and once the plane has been held a second its photo
// credit is whole. Then Left steps back one, and Back returns to automatic without leaving the
// app (the app is told to pass Back to the page only while browsing). Photo lookups are refused
// here, so the bundled model photos show, and the demo planes hold still (&still=1) so the order
// can't change under the presses. CHECK_SIZES=1080 or 720 runs one size; CHECK_MAP sets the map radius (15).
// Exit code 1 on any failure.
import {launch} from './browser.mjs';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';

const BASE=process.env.CHECK_URL||'http://localhost:8767/index.html';
// CHECK_MAP=5: a small map radius, so the wide maps also draw demo planes past it in their corners (each must be offered).
const MAP=process.env.CHECK_MAP||15;
const SIZES=[[1920,1080],[1280,720]].filter(([,h])=>!process.env.CHECK_SIZES||process.env.CHECK_SIZES.split(',').includes(String(h)));
// Per layout: the card's flight, the card's heading, and the map's mark for the plane on the card.
const AT={fl:'.at-fl',head:'.at-kicker',mark:'.at-plane.hero:not(.at-edge)',edge:'.at-edge'};
const LAYOUTS={'atlas-dark':AT,atlas:AT,'atlas-satellite':AT,
  radar:{fl:'.panel .fl',head:'.hero-label',mark:'g.blip.hero'},
  glass:{fl:'.gl-flight',head:'.gl-hero .gl-kicker',mark:'g.gl-plane.hero'},
  departures:{fl:'.hero-line',head:'.hero-line',mark:'circle.dot.hero'},
  blueprint:{fl:'.bp-fl',head:'.bp-obj i',mark:'g.bp-plane.hero'},
  swiss:{fl:'.what .flight',head:'.kicker',mark:'.marks .plane.hero'},
  synthwave:{fl:'.h-fl',head:'.h-label',mark:'.jet.hero'},
  sectional:{fl:'.fl-row .fl',head:'.hero-st',mark:'g.ac.hero'},
  cockpit:{fl:'.pfd-mid .fl',head:'.sel',mark:'g.tcas.hero'},
  'night-sky':{fl:'.hero-label .l1',head:'.count',mark:'g.star.hero'}};
const HEBRON={name:'Hebron',admin:'Kentucky',country:'United States',countryCode:'US',latitude:39.0659,longitude:-84.7011,timeZone:'America/New_York'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// No photo lookups (model photos show); the app's 'ui' messages are kept to read what Back would do.
const MOCK=`(()=>{let v;window.__ui=[];Object.defineProperty(window,'ReactNativeWebView',{configurable:true,get:()=>v,set:b=>{const pm=b.postMessage.bind(b);
  b.postMessage=d=>{const r=JSON.parse(d);if(r.type==='ui'){window.__ui.push(r.overlay);return;}
    if(/planespotters/.test(r.url||''))return setTimeout(()=>window.__whatsupReply(r.id,404,''),30);pm(d);};v=b;}});})();`;

async function page(w,h,layout){
  const profile=mkdtempSync(tmpdir()+'/browse');
  const {chrome,port}=await launch(profile,[`--window-size=${w},${h}`,'about:blank']);
  let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]||m.params.exceptionDetails.text);};
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
  const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.value;
  const key=async(k,c)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:c});};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['*planespotters*','*plnspttrs*']});
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK+`;localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-11-03'}));
    if(!localStorage.getItem('whatsup.settings.v1'))localStorage.setItem('whatsup.settings.v1',${JSON.stringify(JSON.stringify({place:HEBRON,confirmed:true,layout,mapMiles:15}))});`});
  return {ev,key,errors,go:url=>send('Page.navigate',{url}),close(){ws.close();chrome.kill();setTimeout(()=>{try{rmSync(profile,{recursive:true,force:true});}catch{}},800);}};
}

// What the screen shows now: the plane on the card (as read out to screen readers), the card's
// flight and heading, the hero marks, and anything cut (the fit checks' rules).
const READ=sel=>`(()=>{const L=document.getElementById('layout'),q=s=>L.querySelector(s),txt=e=>e?e.textContent.replace(/\\s+/g,' ').trim():'';
  const vis=e=>{for(let x=e;x&&x.nodeType===1;x=x.parentElement){const cs=getComputedStyle(x);if(cs.display==='none'||cs.visibility==='hidden'||x.hidden)return false;}return true;};
  const st=document.getElementById('stage').getBoundingClientRect(),bad=[];
  for(const e of L.querySelectorAll('*')){
    if(e.children.length||!(e.textContent||'').trim()||e.closest('svg')||e.closest('.sr-only')||!vis(e))continue; // screen-reader-only text has no visible box: it is clipped by design
    const cs=getComputedStyle(e),r=e.getBoundingClientRect();if(!r.width)continue;
    if(e.scrollWidth>e.clientWidth+1&&cs.overflow!=='visible')bad.push('CLIP '+(e.className||e.tagName)+': '+e.textContent.slice(0,40));
    if(/…/.test(e.textContent))bad.push('ELLIPSIS '+e.textContent.slice(0,40));
    const rg=document.createRange();rg.selectNodeContents(e);const t=rg.getBoundingClientRect();
    for(let a=e;a&&a!==document.body;a=a.parentElement){const as=getComputedStyle(a);if(as.overflowX==='visible'&&as.overflowY==='visible')continue;
      const b=a.getBoundingClientRect(),k=b.width/(a.offsetWidth||b.width||1),pl=(parseFloat(as.paddingLeft)+parseFloat(as.borderLeftWidth))*k,pr=(parseFloat(as.paddingRight)+parseFloat(as.borderRightWidth))*k,
        pt=(parseFloat(as.paddingTop)+parseFloat(as.borderTopWidth))*k,pb=(parseFloat(as.paddingBottom)+parseFloat(as.borderBottomWidth))*k,v=parseFloat(cs.fontSize)*.3*k;
      const dir=t.right>b.right-pr+k?'right':t.left<b.left+pl-k?'left':t.bottom>b.bottom-pb+v?'bottom':t.top<b.top+pt-v?'top':'';
      if(dir){bad.push('CUT-BY '+(a===e?'itself':a.className||a.tagName)+' ('+dir+'): '+e.textContent.slice(0,40));break;}}
  }
  const credits=[...L.querySelectorAll('.ph-cap,.at-credit')].filter(c=>vis(c)&&c.textContent.trim()).map(c=>({t:txt(c),clip:c.scrollWidth>c.clientWidth+1||c.scrollHeight>c.clientHeight+1}));
  const marks=[...L.querySelectorAll('${sel.mark}')].filter(e=>e.getBoundingClientRect().width);
  const hd=q('${sel.head}'),hr=document.createRange();if(hd)hr.selectNodeContents(hd);
  const headLines=hd?new Set([...hr.getClientRects()].filter(r=>r.width>1).map(r=>Math.round(r.top))).size:0;
  return {sr:txt(document.getElementById('sr-live')),fl:txt(q('${sel.fl}')),head:txt(hd),headLines,
    marks:marks.map(e=>e.dataset.hex||''),edge:${sel.edge?`!!q('${sel.edge}')`:'false'},bad,credits,ui:window.__ui.at(-1)};})()`;

const fails=[],only=process.argv.slice(2);
for(const [w,h] of SIZES)for(const [layout,sel] of Object.entries(LAYOUTS)){
  if(only.length&&!only.includes(layout))continue;
  const p=await page(w,h,layout),bad=[],read=()=>p.ev(READ(sel));
  await p.go(`${BASE}?demo=1&still=1&layout=${layout}&map=${MAP}`);await sleep(9000); // builds and saves the maps; still: the demo planes hold their places
  await p.go(`${BASE}?demo=1&still=1&layout=${layout}&map=${MAP}`);await sleep(4500);
  const auto=await read();
  if(/^Plane \d/.test(auto.sr))bad.push(`browsing before any press: ${auto.sr}`);
  const seen=[],hexes=new Set();let count=0,first=0;
  for(let i=0;i<40;i++){
    await p.key('ArrowRight',39);await sleep(250);
    const s=await read(),[,n,N]=/^Plane (\d+) of (\d+)/.exec(s.sr)||[];
    const tag=`Right #${i+1}`;
    if(!n){bad.push(`${tag}: not browsing (${s.sr||'nothing read out'})`);break;}
    if(!count){count=+N;first=+n;}
    else if(+N!==count){bad.push(`${tag}: the count changed from ${count} to ${N} (a plane left or came; the scene moved)`);count=+N;}
    const expect=(first-1+i)%count+1;
    if(+n!==expect)bad.push(`${tag}: plane ${n} of ${N}, expected ${expect}`);
    const flight=s.sr.split(', ')[1]||'';
    if(!flight||!s.fl.toUpperCase().includes(flight.toUpperCase()))bad.push(`${tag}: the card shows "${s.fl.slice(0,40)}", not ${flight}`);
    const num=new RegExp(`(^|\\D)${n}( of |/)${N}(\\D|$)`,'i');
    if(!num.test(s.head))bad.push(`${tag}: heading "${s.head}" has no "${n} of ${N}"`);
    if(s.headLines!==1)bad.push(`${tag}: heading "${s.head}" takes ${s.headLines} lines`);
    if(s.marks.length!==1&&!(s.edge&&!s.marks.length))bad.push(`${tag}: ${s.marks.length} hero marks on the map`);
    if(s.ui!==true)bad.push(`${tag}: Back would leave the app (the app was told overlay ${s.ui})`);
    for(const b of s.bad)bad.push(`${tag}: ${b}`);
    seen.push(flight);s.marks[0]&&hexes.add(s.marks[0]);
    // Held a second: the photo (model photo here) and its credit, whole.
    await sleep(1300);
    const held=await read();
    for(const c of held.credits){
      if(c.clip)bad.push(`${tag}: photo credit cut: "${c.t}"`);
      if(!/(CC BY|CC0|Public domain|Planespotters)/i.test(c.t))bad.push(`${tag}: photo credit "${c.t}" lacks its licence`);
    }
    for(const b of held.bad)if(!s.bad.includes(b))bad.push(`${tag}, held: ${b}`);
    if(i+1>=count)break; // round once; the next press must come back to the first
  }
  const distinct=new Set(seen).size;
  if(count&&distinct!==count)bad.push(`${distinct} different planes shown in ${count} presses (${seen.join(' ')})`);
  if(count){
    await p.key('ArrowRight',39);await sleep(250);const again=await read();
    if(!again.sr.startsWith(`Plane ${first} of`))bad.push(`after a full round Right shows "${again.sr}", not plane ${first} again`);
    await p.key('ArrowLeft',37);await sleep(250);const back1=await read();
    if(!back1.sr.startsWith(`Plane ${(first-2+count)%count+1} of`))bad.push(`Left shows "${back1.sr}", not plane ${(first-2+count)%count+1}`);
    await p.key('Escape',27);await sleep(400);const done=await read();
    if(/^Plane \d/.test(done.sr)||/\d+ of \d+|\d+\/\d+ ·/i.test(done.head))bad.push(`Back did not return to automatic: "${done.sr}" / "${done.head}"`);
    if(done.ui!==false)bad.push(`after Back the app was not told to let Back leave the app (overlay ${done.ui})`);
  }
  if(p.errors.length)bad.push(`page errors: ${[...new Set(p.errors)].slice(0,2).join(' | ')}`);
  p.close();
  console.log(`${bad.length?'FAIL':'ok  '} ${h}p ${layout.padEnd(16)} ${count} planes, ${seen.length} presses${bad.length?'\n    '+[...new Set(bad)].slice(0,10).join('\n    '):''}`);
  if(bad.length)fails.push(`${h}p ${layout}`);
}
console.log(fails.length?`FAIL: ${fails.join(', ')}`:'browsing ok in every layout');
process.exit(fails.length?1:0);
