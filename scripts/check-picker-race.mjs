// node scripts/check-picker-race.mjs  (needs the dev server: node scripts/dev-server.mjs assets 8767)
// Regression check for "Back in the layout picker keeps the preview": the stick can take a
// moment to load a layout's script. With layout scripts held back 1.5 s, open Settings, OK on
// Layout, Right (start previewing the next layout), then Back at once; after the slow script
// arrives, the dashboard must still show the saved layout, and Settings must agree with it.
// Then Right, Right, OK quickly must keep the second preview. Exit code 1 on any failure.
import {launch} from './browser.mjs';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';

const BASE=process.env.CHECK_URL||'http://localhost:8767/index.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {chrome,port}=await launch(mkdtempSync(tmpdir()+'/race'),['--window-size=960,540','about:blank']);
let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map();
ws.onmessage=async e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}
  if(m.method==='Fetch.requestPaused'){if(/\/layouts\//.test(m.params.request.url))await sleep(1500);send('Fetch.continueRequest',{requestId:m.params.requestId});}};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true})).result?.value;
const key=async(k,c)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:c});};
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
// A saved place and layout, as after first run (Chicago, public).
await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('whatsup.settings.v1')){localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-11-02'}));localStorage.setItem('whatsup.settings.v1',JSON.stringify({place:{name:'Chicago',admin:'Illinois',country:'United States',countryCode:'US',latitude:41.85,longitude:-87.65,timeZone:'America/Chicago'},confirmed:true,layout:'radar',mapMiles:15}));}`});
await send('Page.navigate',{url:`${BASE}?demo=1`});await sleep(7000);
await send('Fetch.enable',{patterns:[{urlPattern:'*/layouts/*'}]});
const state=()=>ev(`({shown:document.getElementById('stage').dataset.layout,saved:JSON.parse(localStorage.getItem('whatsup.settings.v1')).layout,row:document.getElementById('set-layout-v')?.textContent,busy:document.getElementById('busy').classList.contains('on')})`);
const fails=[];
await key('MediaPlayPause',179);await sleep(600);
for(let i=0;i<20&&await ev(`document.querySelector('#settings .focus')?.id`)!=='set-layout';i++){await key(await ev(`document.querySelector('#settings .focus')?.closest('.col')===document.getElementById('set-layout').closest('.col')`)?'ArrowUp':'ArrowRight',39);await sleep(200);}
await key('Enter',13);await sleep(400);await key('ArrowRight',39);await sleep(200);await key('Escape',27);await sleep(3000);
let s=await state();
if(s.shown!=='radar'||s.saved!=='radar'||!/Radar/.test(s.row||''))fails.push(`Back during a slow preview: shown ${s.shown}, saved ${s.saved}, Settings says "${s.row}"`);
if(s.busy)fails.push('the busy cog stayed on after Back');
await key('Enter',13);await sleep(400);await key('ArrowRight',39);await sleep(150);await key('ArrowRight',39);await sleep(150);await key('Enter',13);await sleep(4000);
s=await state();
if(s.shown!==s.saved||s.shown==='radar')fails.push(`Right, Right, OK quickly: shown ${s.shown}, saved ${s.saved}`);
ws.close();chrome.kill();
console.log(fails.length?'FAIL\n  '+fails.join('\n  '):'ok   layout picker: Back during a slow preview keeps the saved layout; a quick OK keeps the preview');
process.exit(fails.length?1:0);
