// node scripts/shot.mjs <url> <out.png> [waitMs]  — 960x540 CSS at 2x (1920x1080), via local Chrome DevTools.
// SHOT_PORT picks the DevTools port (default: one the browser picks, so several can run at once); SHOT_PROFILE keeps
// a browser profile between runs (saved maps and settings), else a fresh one each time.
// SHOT_KEYS="ArrowRight,Enter" presses keys after the wait, SHOT_KEYWAIT ms apart (default 1500).
import {launch} from './browser.mjs';import {writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';
const [url,out,wait=6000]=process.argv.slice(2);
const profile=process.env.SHOT_PROFILE||mkdtempSync(tmpdir()+'/shot');
mkdirSync(profile,{recursive:true});
const {chrome,port}=await launch(profile,['--hide-scrollbars','--window-size=960,540','about:blank'],Number(process.env.SHOT_PORT)||0);
let tabs;for(let i=0;i<40&&!tabs;i++){await new Promise(r=>setTimeout(r,250));try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map(),logs=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}
  if(m.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(m.params.type))logs.push(m.params.type+': '+m.params.args.map(a=>a.value??a.description).join(' '));
  if(m.method==='Runtime.exceptionThrown')logs.push('exception: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text));
  if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')logs.push('log: '+m.params.entry.text+' '+(m.params.entry.url||''));};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
await send('Runtime.enable');await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:2,mobile:false});
await send('Page.navigate',{url});await new Promise(r=>setTimeout(r,Number(wait)));
for(const key of (process.env.SHOT_KEYS||'').split(',').filter(Boolean)){
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:{Enter:13,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Escape:27}[key]||0});
  await new Promise(r=>setTimeout(r,Number(process.env.SHOT_KEYWAIT)||1500));
}
const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(out,Buffer.from(shot.data,'base64'));
logs.forEach(l=>console.log(l));ws.close();chrome.kill();
