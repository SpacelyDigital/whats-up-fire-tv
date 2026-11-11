// node scripts/check-settings-ok.mjs  (needs the dev server: node scripts/dev-server.mjs assets 8767)
// Regression check for "OK lost while the cog shows": in Settings, a viewer changes a value
// (Right), presses OK while the busy cog shows (a slow stick: frames here are held back 400 ms
// so the cog stays up), then Down once it has gone. The OK must still take effect: the row
// leaves edit mode with the one change kept, and Down moves to the next row instead of changing
// the value. Pressing OK three times during the cog must not start a new edit (no stacking).
// Rows: a window bearing (its redraw starts 350 ms after the press) and Distance units.
// CHECK_DSF=1.3333 runs it at 1280×720. Exit code 1 on any failure.
import {launch} from './browser.mjs';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';
const BASE=process.env.CHECK_URL||'http://localhost:8767/index.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const profile=mkdtempSync(tmpdir()+'/setok');
const {chrome,port}=await launch(profile,['--window-size=960,540','about:blank']);
let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]||m.params.exceptionDetails.text);};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true})).result?.value;
const until=async(x,ms)=>{for(let t=0;t<ms;t+=20){if(await ev(x))return true;await sleep(20);}return false;};
const CODE={ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Enter:13,Escape:27};
const key=async k=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:CODE[k]});};
const cogOn=`document.getElementById('busy').classList.contains('on')`;
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:Number(process.env.CHECK_DSF)||1,mobile:false});
// A slow stick: each animation frame arrives 400 ms late, so the cog (which clears after two
// frames) stays up long enough for a press to land in it.
await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__slowFrames=false;{const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=cb=>window.__slowFrames?raf(()=>setTimeout(()=>raf(cb),400)):raf(cb);}`});
await send('Page.navigate',{url:`${BASE}?q=Chicago&layout=atlas&map=10&window=90-180-25`});await sleep(6000);
await until(`document.getElementById('stage')?.dataset.layout==='atlas'`,15000);
await until(`!(${cogOn})`,5000);await key('Enter');await sleep(600); // Select on the dashboard opens Settings
const fails=[];
if(!await ev(`!document.getElementById('settings').hidden`))fails.push('Settings did not open');
async function walkTo(target){
  for(let i=0;i<30;i++){
    if(await ev(`document.querySelector('#settings .focus')?.id`)===target)return true;
    const col=await ev(`(()=>{const t=document.getElementById('${target}'),f=document.querySelector('#settings .focus');if(!t||!f)return 0;
      const a=t.getBoundingClientRect(),b=f.getBoundingClientRect();return a.left>b.right?1:a.right<b.left?-1:a.top>b.bottom?2:-2})()`);
    await until(`!(${cogOn})`,5000);await key(col===1?'ArrowRight':col===-1?'ArrowLeft':col===2?'ArrowDown':'ArrowUp');await sleep(300);
  }
  return false;
}
const state=row=>ev(`(()=>{const r=document.getElementById('${row}');return {value:r.querySelector('b').textContent,editing:r.classList.contains('editing'),card:document.querySelector('#settings .card').classList.contains('editing'),focus:document.querySelector('#settings .focus')?.id}})()`);
for(const [row,oks] of [['set-from',1],['set-distance',1],['set-from',3]]){
  const label=`${row}${oks>1?` (OK ×${oks})`:''}`;
  if(!await walkTo(row)){fails.push(`${label}: could not reach it with the arrow keys`);continue;}
  await until(`!(${cogOn})`,5000);await key('Enter');await sleep(400);
  const before=await state(row);
  if(!before.editing){fails.push(`${label}: OK did not start editing`);continue;}
  await ev('window.__slowFrames=true');
  await key('ArrowRight');
  if(!await until(cogOn,3000)){fails.push(`${label}: the cog never showed after the change`);await ev('window.__slowFrames=false');continue;}
  for(let i=0;i<oks;i++){await key('Enter');await sleep(60);}
  const cogged=await ev(cogOn); // the OK presses landed while the cog showed
  await until(`!(${cogOn})`,8000);await ev('window.__slowFrames=false');await sleep(400);
  const kept=await state(row);
  await key('ArrowDown');await sleep(700);await until(`!(${cogOn})`,5000);
  const after=await state(row);
  if(!cogged)fails.push(`${label}: the OK presses didn't land during the cog (test timing)`);
  if(kept.editing||kept.card)fails.push(`${label}: the OK pressed during the cog was lost (still editing)`);
  if(kept.value===before.value)fails.push(`${label}: the change wasn't made ("${kept.value}")`);
  if(after.value!==kept.value)fails.push(`${label}: Down changed the value ("${kept.value}" → "${after.value}") instead of moving`);
  if(after.focus===row)fails.push(`${label}: Down didn't move to the next row`);
  if(after.editing||after.card)fails.push(`${label}: still editing after Down`);
  // Back to the row for the next case.
  if(after.editing)await key('Escape');
}
fails.push(...errors.map(e=>'page error: '+e));
ws.close();chrome.kill();await new Promise(r=>{chrome.once('exit',r);setTimeout(r,3000);});try{rmSync(profile,{recursive:true,force:true});}catch{}
if(fails.length){console.log('FAIL\n  '+fails.join('\n  '));process.exit(1);}
console.log('ok   settings OK: an OK pressed while the cog shows still keeps the change, and Down then moves on');
