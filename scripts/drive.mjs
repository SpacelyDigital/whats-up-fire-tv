// node scripts/drive.mjs <url> <steps.json> — drives the page in headless Chrome like the remote does and
// prints, after each step, the top screen, the focused control and the results box. Steps:
// {"keys":"ArrowRight,Enter"} {"wait":2000} {"shot":"out.png"} {"offline":true|false} {"eval":"js"} {"block":"pattern"}
// SHOT_PROFILE keeps a Chrome profile (saved settings and maps) between runs.
import {launch} from './browser.mjs';import {writeFileSync,readFileSync,mkdtempSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';
const [url,stepsFile]=process.argv.slice(2);
const steps=JSON.parse(readFileSync(stepsFile,'utf8'));
const profile=process.env.SHOT_PROFILE||mkdtempSync(tmpdir()+'/drive');
mkdirSync(profile,{recursive:true});
const {chrome,port}=await launch(profile,['--hide-scrollbars','--window-size=960,540','about:blank']);
let tabs;for(let i=0;i<40&&!tabs;i++){await new Promise(r=>setTimeout(r,250));try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result||m.error);waiting.delete(m.id);}
  if(m.method==='Runtime.exceptionThrown')console.log('  EXCEPTION',m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')console.log('  console.error',m.params.args.map(a=>a.value??a.description).join(' '));
  if(m.method==='Fetch.requestPaused')send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Failed'});};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
if(process.env.DRIVE_CPU){}
await send('Runtime.enable');await send('Network.enable');await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:2,mobile:false});
const CODES={Enter:13,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Escape:27,Backspace:8};
const STATE=`(()=>{const vis=[...document.querySelectorAll('.overlay,.picker')].filter(e=>!e.hidden).sort((a,b)=>(+b.style.zIndex||0)-(+a.style.zIndex||0));
  const f=document.querySelector('.focus');const top=vis[0];
  return JSON.stringify({top:top?.id||(document.querySelector('.adjusting')?'adjust':'dashboard'),stack:vis.map(e=>e.id+':'+(e.style.zIndex||'-')),
    focus:f?(f.id||f.dataset.key||f.textContent.trim().slice(0,30)):null,focusInTop:!!(f&&top&&top.contains(f)),
    entry:document.getElementById('entry-text')?.textContent,results:document.getElementById('results')?.textContent.trim().slice(0,90),
    place:document.querySelector('[class*=place],h1')?.textContent?.slice(0,30)});})()`;
const state=async()=>(await send('Runtime.evaluate',{expression:STATE,returnByValue:true})).result?.value;
// DRIVE_BLOCK=regex: answer matching bridge requests as a dropped connection (services down).
if(process.env.DRIVE_BLOCK)await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const re=new RegExp(${JSON.stringify(process.env.DRIVE_BLOCK)});let v;
  Object.defineProperty(window,'ReactNativeWebView',{configurable:true,get:()=>v,set:b=>{const pm=b.postMessage.bind(b);
    b.postMessage=d=>{const r=JSON.parse(d);if(r.url&&re.test(r.url))return setTimeout(()=>window.__whatsupReply(r.id,'connection_error',''),50);pm(d);};v=b;}});})();`});
if(process.env.DRIVE_CPU)await send('Emulation.setCPUThrottlingRate',{rate:+process.env.DRIVE_CPU});
await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__long=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__long.push(Math.round(e.duration))}).observe({type:"longtask",buffered:true});'});
await send('Page.navigate',{url});await new Promise(r=>setTimeout(r,Number(process.env.DRIVE_WAIT)||6000));
console.log('start',await state());
for(const s of steps){
  if(s.offline!==undefined)await send('Network.emulateNetworkConditions',{offline:s.offline,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  if(s.block){await send('Fetch.enable',{patterns:[{urlPattern:s.block}]});}
  if(s.unblock)await send('Fetch.disable');
  for(const key of (s.keys||'').split(',').filter(Boolean)){
    for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:CODES[key]||key.toUpperCase().charCodeAt(0),text:type==='keyDown'&&key.length===1?key:undefined});
    await new Promise(r=>setTimeout(r,s.gap??250));
  }
  if(s.wait)await new Promise(r=>setTimeout(r,s.wait));
  if(s.eval)console.log('  eval',(await send('Runtime.evaluate',{expression:s.eval,returnByValue:true,awaitPromise:true})).result?.value);
  if(s.shot){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(s.shot,Buffer.from(shot.data,'base64'));}
  console.log(s.label||JSON.stringify(s).slice(0,60),await state());
}
ws.close();chrome.kill();process.exit(0);
