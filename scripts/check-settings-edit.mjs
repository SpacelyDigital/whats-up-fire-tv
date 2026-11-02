// node scripts/check-settings-edit.mjs [layout ...]  (needs the dev server: node scripts/dev-server.mjs assets 8767)
// Regression check for "the value disappears while it is being edited": in every layout,
// opens Settings with Play/Pause, walks to each editable row with the arrow keys, presses OK,
// changes the value once, and checks that the value is shown whole (never cut, never zero
// width), the keys hint is shown in full on the title line inside the card, and Back undoes
// the edit and leaves edit mode; then OK, Right, OK keeps a change and the kept value is whole.
// CHECK_DSF=1.3333 runs it at 1280×720 (default 1, 960×540 CSS px).
// Exit code 1 on any failure.
import {spawn} from 'node:child_process';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';

const BASE=process.env.CHECK_URL||'http://localhost:8767/index.html';
const LAYOUTS=['atlas-dark','atlas','atlas-satellite','radar','glass','departures','blueprint','swiss','synthwave','sectional','cockpit','night-sky'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function page(){
  const port=9400+Math.floor(Math.random()*500);
  const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new',`--remote-debugging-port=${port}`,
    '--user-data-dir='+mkdtempSync(tmpdir()+'/sedit'),'--window-size=960,540','about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
  const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true})).result?.value;
  const key=async(k,c)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:c});await sleep(250);};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:Number(process.env.CHECK_DSF)||1,mobile:false});
  return {send,ev,key,close(){ws.close();chrome.kill();}};
}
// Arrow-key moves that reach a row from Location (left column first, then right column).
async function walkTo(p,target){
  for(let i=0;i<30;i++){
    const at=await p.ev(`document.querySelector('#settings .focus')?.id`);if(at===target)return true;
    const col=await p.ev(`(()=>{const t=document.getElementById('${target}'),f=document.querySelector('#settings .focus');if(!t||!f)return 0;
      const a=t.getBoundingClientRect(),b=f.getBoundingClientRect();return a.left>b.right?1:a.right<b.left?-1:a.top>b.bottom?2:-2})()`);
    if(col===1)await p.key('ArrowRight',39);else if(col===-1)await p.key('ArrowLeft',37);else if(col===2)await p.key('ArrowDown',40);else await p.key('ArrowUp',38);
  }
  return false;
}
const only=process.argv.slice(2),fails=[];
for(const layout of LAYOUTS){
  if(only.length&&!only.includes(layout))continue;
  const p=await page();
  await p.send('Page.navigate',{url:`${BASE}?q=Chicago&layout=${layout}&map=250&window=90-180-25`});await sleep(6000);
  await p.key('MediaPlayPause',179);await sleep(800);
  const rows=await p.ev(`[...document.querySelectorAll('#settings .row[data-edit]')].filter(r=>r.offsetParent).map(r=>r.id)`)||[];
  const bad=[];
  for(const row of rows){
    if(!await walkTo(p,row)){bad.push(`${row}: could not reach it with the arrow keys`);continue;}
    await p.key('Enter',13);await p.key('ArrowRight',39);await sleep(300);
    const r=await p.ev(`(()=>{const row=document.getElementById('${row}'),b=row.querySelector('b'),card=document.querySelector('#settings .card'),t=card.querySelector('.title');
      const hint=getComputedStyle(t,'::after').content,tr=t.getBoundingClientRect(),cr=card.getBoundingClientRect();
      return {editing:row.classList.contains('editing'),value:b.textContent,w:b.clientWidth,sw:b.scrollWidth,hint,hintInside:t.scrollWidth<=t.clientWidth+1&&tr.right<=cr.right}})()`);
    if(!r.editing)bad.push(`${row}: OK did not start editing`);
    if(!r.w||r.sw>r.w+1)bad.push(`${row}: value "${r.value}" cut while editing (${r.w}/${r.sw} px)`);
    if(!/OK keep/.test(r.hint||'')||!r.hintInside)bad.push(`${row}: keys hint missing or cut on the title line`);
    await p.key('Escape',27);
    if(await p.ev(`document.getElementById('${row}').classList.contains('editing')||document.querySelector('#settings .card').classList.contains('editing')`))bad.push(`${row}: Back did not leave edit mode`);
    if(await p.ev(`document.getElementById('settings').hidden`)){bad.push(`${row}: Back closed Settings instead of undoing`);await p.key('MediaPlayPause',179);}
    // OK, Right, OK keeps the change: the kept value is shown whole, with no edit hint left.
    // (Not on Alert zone: keeping a change there hides the window rows checked after it.)
    if(row!=='set-zone'){await p.key('Enter',13);await p.key('ArrowRight',39);await p.key('Enter',13);await sleep(300);
    const k=await p.ev(`(()=>{const b=document.getElementById('${row}').querySelector('b');return {value:b.textContent,w:b.clientWidth,sw:b.scrollWidth,editing:document.querySelector('#settings .card').classList.contains('editing')}})()`);
    if(k.editing)bad.push(`${row}: OK did not leave edit mode`);
    if(!k.w||k.sw>k.w+1)bad.push(`${row}: kept value "${k.value}" cut (${k.w}/${k.sw} px)`);}
  }
  p.close();
  console.log(`${bad.length?'FAIL':'ok  '} ${layout.padEnd(16)} ${rows.length} editable rows${bad.length?'\n    '+bad.join('\n    '):''}`);
  if(bad.length)fails.push(layout);
}
process.exit(fails.length?1:0);
