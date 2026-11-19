// node scripts/check-edge.mjs [layout ...]  (needs the dev server: node scripts/dev-server.mjs assets 8767)
// Settings > Screen edges, end to end with the remote's keys, in each layout given (default
// Atlas Satellite, Sectional and Cockpit): a new install is full screen (1%); OK on the row, Right
// four times shrinks the whole picture live to 5% (stage 0.92 of the screen, centred, the margin
// painted, the row read "Screen edges, 5 percent", the edit hint saying what it is for), OK keeps
// it and it is saved; 10% is 0.82 and Back puts 5% back; a relaunch opens at 5%; Left back to 1%
// is full screen with no margin painted; and Privacy > Erase puts it back to 1% (the consent
// screen after it is full screen). CHECK_DSF=2 runs it at 1920×1080 (default 1, 960×540).
// Exit code 1 on any failure.
import {launch} from './browser.mjs';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';

const BASE=process.env.CHECK_URL||'http://localhost:8767/index.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function page(){
  const profile=mkdtempSync(tmpdir()+'/edge');
  const {chrome,port}=await launch(profile,['--window-size=960,540','about:blank']);
  let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]||m.params.exceptionDetails.text);};
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
  const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true})).result?.value;
  const until=async(x,ms)=>{for(let t=0;t<ms;t+=50){if(await ev(x))return true;await sleep(50);}return false;};
  // Each key waits for the busy cog to clear, as a viewer would (the app drops presses while it shows).
  const key=async(k,c)=>{await until(`!document.getElementById('busy')?.classList.contains('on')`,3000);
    for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:c});await sleep(250);};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:Number(process.env.CHECK_DSF)||1,mobile:false});
  return {send,ev,key,until,errors,close(){ws.close();chrome.kill();setTimeout(()=>{try{rmSync(profile,{recursive:true,force:true});}catch{}},800);}};
}
async function walkTo(p,target){
  for(let i=0;i<30;i++){
    const at=await p.ev(`document.querySelector('#settings .focus')?.id`);if(at===target)return true;
    const col=await p.ev(`(()=>{const t=document.getElementById('${target}'),f=document.querySelector('#settings .focus');if(!t||!f)return 0;
      const a=t.getBoundingClientRect(),b=f.getBoundingClientRect();return a.left>b.right?1:a.right<b.left?-1:a.top>b.bottom?2:-2})()`);
    if(col===1)await p.key('ArrowRight',39);else if(col===-1)await p.key('ArrowLeft',37);else if(col===2)await p.key('ArrowDown',40);else await p.key('ArrowUp',38);
  }
  return false;
}
// The stage's share of the screen, its centring, the painted margin, the row's value and spoken label, the saved value.
const STATE=`(()=>{const r=document.getElementById('stage').getBoundingClientRect(),W=innerWidth,H=innerHeight,row=document.getElementById('set-edge');
  let saved;try{saved=JSON.parse(localStorage.getItem('whatsup.settings.v1')||'null')?.edge;}catch{}
  return {scale:r.width/W,dx:Math.abs(r.left-(W-r.right)),dy:Math.abs(r.top-(H-r.bottom)),painted:document.body.style.background,
    value:row?.querySelector('b')?.textContent,label:row?.getAttribute('aria-label'),saved,hint:getComputedStyle(document.querySelector('#settings .title'),'::after').content,
    settings:!document.getElementById('settings').hidden,consent:!document.getElementById('consent')?.hidden}})()`;
const near=(a,b)=>Math.abs(a-b)<.002;

const LAYOUTS=process.argv.slice(2).length?process.argv.slice(2):['atlas-satellite','sectional','cockpit'];
const fails=[];
for(const layout of LAYOUTS){
  const p=await page(),bad=[],st=()=>p.ev(STATE);
  const expect=(s,scale,what)=>{
    if(!near(s.scale,scale))bad.push(`${what}: stage at ${(s.scale*100).toFixed(1)}% of the screen, expected ${(scale*100).toFixed(1)}%`);
    if(s.dx>1.5||s.dy>1.5)bad.push(`${what}: not centred (${s.dx.toFixed(1)}/${s.dy.toFixed(1)} px)`);
    if(scale<1&&!s.painted)bad.push(`${what}: the margin is not painted`);
    if(scale===1&&s.painted)bad.push(`${what}: a margin colour is still set at full screen (${s.painted})`);
  };
  await p.send('Page.navigate',{url:`${BASE}?q=Chicago&layout=${layout}&map=15`});await sleep(6000);
  await p.until(`document.getElementById('stage')?.dataset.layout===${JSON.stringify(layout)}`,15000);
  await p.until(`!document.getElementById('busy')?.classList.contains('on')`,15000);
  expect(await st(),1,'new install');
  await p.key('Enter',13);
  if(!await p.until(`!document.getElementById('settings').hidden`,3000))bad.push('Select did not open Settings');
  if(!await walkTo(p,'set-edge'))bad.push('could not reach Screen edges with the arrow keys');
  let s=await st();
  if(s.value!=='1% · full screen'&&!/^1%/.test(s.value||''))bad.push(`value at 1%: "${s.value}"`);
  if(s.label!=='Screen edges, 1 percent, full screen')bad.push(`spoken at 1%: "${s.label}"`);
  // 1% to 5%, live.
  await p.key('Enter',13);
  for(let i=0;i<4;i++)await p.key('ArrowRight',39);
  s=await st();expect(s,.92,'5% while editing');
  if(s.value!=='5%')bad.push(`value at 5%: "${s.value}"`);
  if(!/cuts off the edges/.test(s.hint||''))bad.push(`edit hint: ${s.hint}`);
  await p.key('Enter',13);
  s=await st();
  if(s.saved!==5)bad.push(`kept 5% saved as ${s.saved}`);
  if(s.label!=='Screen edges, 5 percent')bad.push(`spoken at 5%: "${s.label}"`);
  // 10% and Back: 5% again.
  await p.key('Enter',13);for(let i=0;i<7;i++)await p.key('ArrowRight',39);
  s=await st();expect(s,.82,'10% (more Rights stop there)');if(s.value!=='10%')bad.push(`value at 10%: "${s.value}"`);
  await p.key('Escape',27);
  s=await st();expect(s,.92,'Back from 10%');if(s.saved!==5)bad.push(`after Back saved as ${s.saved}`);if(!s.settings)bad.push('Back closed Settings');
  // Relaunch: opens at 5%, the margin in the layout's colours.
  await p.send('Page.navigate',{url:`${BASE}?layout=${layout}&map=15`});await sleep(5000);
  await p.until(`!document.getElementById('busy')?.classList.contains('on')`,15000);
  expect(await st(),.92,'relaunch at 5%');
  // Left back to 1%: full screen, nothing painted.
  await p.key('Enter',13);await p.until(`!document.getElementById('settings').hidden`,3000);
  if(!await walkTo(p,'set-edge'))bad.push('could not reach Screen edges after relaunch');
  await p.key('Enter',13);for(let i=0;i<6;i++)await p.key('ArrowLeft',37);await p.key('Enter',13);
  s=await st();expect(s,1,'back to 1%');if(s.saved!==1)bad.push(`1% saved as ${s.saved}`);
  // Erase: 3% first, then Privacy > Erase > OK; the app starts over at 1%.
  await p.key('Enter',13);for(let i=0;i<2;i++)await p.key('ArrowRight',39);await p.key('Enter',13);
  s=await st();expect(s,.96,'3%');
  await p.ev(`document.getElementById('set-privacy').click()`);await sleep(600);
  await p.ev(`document.getElementById('privacy-erase').click()`);await sleep(600);
  await p.ev(`document.getElementById('erase-ok').click()`);await sleep(4000);
  s=await st();expect(s,1,'after Erase');
  if(s.saved!==undefined&&s.saved!==null)bad.push(`after Erase saved as ${s.saved}`);
  if(!s.consent)bad.push('after Erase the consent screen is not shown');
  if(p.errors.length)bad.push(`page errors: ${[...new Set(p.errors)].slice(0,2).join(' | ')}`);
  p.close();
  console.log(`${bad.length?'FAIL':'ok  '} ${layout.padEnd(16)}${bad.length?'\n    '+bad.join('\n    '):''}`);
  if(bad.length)fails.push(layout);
  await sleep(500);
}
process.exit(fails.length?1:0);
