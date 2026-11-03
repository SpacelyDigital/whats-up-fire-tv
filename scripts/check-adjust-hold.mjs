// node scripts/check-adjust-hold.mjs  (needs the dev server: node scripts/dev-server.mjs assets 8767)
// Regression check for "holding an arrow in Adjust position runs off the map": Settings >
// Fine-tune, hold Right for about 3 s (key repeats), and check the dot is still within 800 m
// of the start (the whole view then stays on the street map), the note says how to move farther, and a short
// tap back moves 50 m. Exit code 1 on any failure.
import {launch} from './browser.mjs';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';

const BASE=process.env.CHECK_URL||'http://localhost:8767/index.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {chrome,port}=await launch(mkdtempSync(tmpdir()+'/adjhold'),['--window-size=960,540','about:blank']);
let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true})).result?.value;
const key=async(k,c)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:c});};
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
// A saved place, as after first run (Chicago, public).
await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('whatsup.settings.v1')){localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-11-02'}));localStorage.setItem('whatsup.settings.v1',JSON.stringify({place:{name:'Chicago',admin:'Illinois',country:'United States',countryCode:'US',latitude:41.85,longitude:-87.65,timeZone:'America/Chicago'},confirmed:true,layout:'atlas-dark',mapMiles:15}));}`});
await send('Page.navigate',{url:`${BASE}?demo=1`});await sleep(7000);
const fails=[];
await key('MediaPlayPause',179);await sleep(600);
for(let i=0;i<20&&await ev(`document.querySelector('#settings .focus')?.id`)!=='set-adjust';i++){await key('ArrowDown',40);await sleep(200);}
await key('Enter',13);await sleep(6000); // the street map loads
if(!await ev(`document.getElementById('stage').classList.contains('adjusting')`))fails.push('Fine-tune did not open Adjust position');
for(let i=0;i<75;i++){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39,autoRepeat:i>0});await sleep(40);}
await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await sleep(400);
const moved=await ev(`document.getElementById('adjust-moved').textContent`),note=await ev(`document.getElementById('adjust-note').textContent`);
const m=/Moved ([\d.]+) (km|m)/.exec(moved||''),metres=m?Number(m[1])*(m[2]==='km'?1000:1):0;
if(!(metres>600&&metres<=800))fails.push(`held Right ~3 s: "${moved}" (expected 600–800 m)`);
if(!/change Location/.test(note||''))fails.push(`no note at the limit (note: "${note}")`);
await key('ArrowLeft',37);await sleep(300);
const back=await ev(`document.getElementById('adjust-moved').textContent`);
if(!/750 m/.test(back||''))fails.push(`one tap back from the limit: "${back}" (expected 750 m)`);
ws.close();chrome.kill();
console.log(fails.length?'FAIL\n  '+fails.join('\n  '):'ok   Adjust position: a held arrow stops at 800 m with a note; a tap moves 50 m');
process.exit(fails.length?1:0);
