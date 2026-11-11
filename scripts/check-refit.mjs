// Regression check: text fitted on a screen that stays open while the layout changes is fitted
// again in the new layout's font. Settings > Layout picks Cockpit (its stylesheet held back
// 800 ms, as on a slow stick), OK, then Change location at once: when Cockpit's monospace font
// arrives, the search screen's source line and the Settings rows under it must still fit
// (fuzz seed 7059 found "Search uses Open-Meteo, the U.S. Census Bureau and OpenStre" cut).
//   CHECK_URL=http://127.0.0.1:8767/index.html node scripts/check-refit.mjs
import {launch} from './browser.mjs';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const BASE=process.env.CHECK_URL||'http://127.0.0.1:8767/index.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const profile=mkdtempSync(join(tmpdir(),'refit'));
const {chrome,port}=await launch(profile,['--window-size=960,540','about:blank']);
let tabs;for(let i=0;i<40&&!tabs;i++){try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{await sleep(250);}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map(),errors=[];
ws.onmessage=async e=>{const m=JSON.parse(e.data);
  if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);return;}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description?.slice(0,120));
  // Cockpit's stylesheet arrives 800 ms late.
  if(m.method==='Fetch.requestPaused'){await sleep(800);send('Fetch.continueRequest',{requestId:m.params.requestId});}
};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true})).result?.value;
const key=async(k,code)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:code});};
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:Number(process.env.CHECK_DSF)||1,mobile:false});
const place={name:'Hebron',admin:'Kentucky',country:'United States',countryCode:'US',latitude:39.05,longitude:-84.65,timeZone:'America/New_York'};
await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-11-03'}));localStorage.setItem('whatsup.settings.v1',JSON.stringify({place:${JSON.stringify(place)},confirmed:true,layout:'atlas',mapMiles:10}))`});
await send('Page.navigate',{url:`${BASE}?demo=1`});await sleep(8000);
await send('Fetch.enable',{patterns:[{urlPattern:'*layouts/cockpit.css*',requestStage:'Request'}]});
// Settings > Layout, step to Cockpit, OK at once, then Change location at once.
await key('MediaPlayPause',179);await sleep(600);
await ev(`document.getElementById('set-layout').click()`);await sleep(600);
for(let i=0;i<20;i++){if(await ev(`/Cockpit/.test(document.getElementById('pick-name').textContent)`))break;await key('ArrowRight',39);await sleep(150);}
await key('Enter',13);
await ev(`document.getElementById('set-location').click()`);
await sleep(3000);
const cut=()=>ev(`(()=>{const out=[];const chk=(e,name)=>{if(e&&e.getClientRects().length&&e.scrollWidth>e.clientWidth+1)out.push(name+': "'+e.textContent.slice(0,60)+'" '+e.scrollWidth+'/'+e.clientWidth);};
  chk(document.getElementById('search-src'),'search line');for(const b of document.querySelectorAll('#settings .row b'))chk(b,'Settings '+b.closest('.row').id);
  return {layout:document.getElementById('stage').dataset.layout,top:[...document.querySelectorAll('.overlay')].filter(o=>!o.hidden).map(o=>o.id).join('>'),cut:out};})()`);
const onLocate=await cut();
await key('Escape',27);await sleep(1000);
const onSettings=await cut();
const fails=[];
if(onLocate.layout!=='cockpit')fails.push(`layout is ${onLocate.layout}, not cockpit`);
if(!/locate/.test(onLocate.top))fails.push(`search screen not open (${onLocate.top})`);
fails.push(...onLocate.cut.map(c=>'over the search screen: '+c),...onSettings.cut.map(c=>'back on Settings: '+c),...errors.map(e=>'page error: '+e));
ws.close();chrome.kill();await new Promise(r=>{chrome.once('exit',r);setTimeout(r,3000);});try{rmSync(profile,{recursive:true,force:true});}catch{}
if(fails.length){console.log('FAIL\n  '+fails.join('\n  '));process.exit(1);}
console.log('ok   refit: after a layout switch under open screens, the search line and Settings rows fit in the new font');
