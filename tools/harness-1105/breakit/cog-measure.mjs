// node cog-measure.mjs <layout> [rate=6] [gaps=300,400,500]: the build at PORT (mocked services,
// CVG), CPU slowed <rate>x. For each editable Settings row:
//  1. how long the busy cog (key lock) is on after one change (Right in edit mode), and after Back
//     (cancel) puts a changed value back;
//  2. a viewer at a steady pace: Right (change), OK (keep), Down (to the next row), <gap> ms apart,
//     sent on a fixed schedule like a remote (not waiting for the page). Was the OK dropped, and
//     did the Down then change the value instead of moving down?
// Times come from the page (performance.now): the cog's class changes and each key the page saw.
import {open,base,sleep} from '../backup-1103/lib.mjs';
const [layout='atlas-satellite',rateArg,gapsArg]=process.argv.slice(2);
const RATE=Number(rateArg)||6,GAPS=(gapsArg||'300,400,500').split(',').map(Number);
const s=await open({url:base(`q=HEBRON&layout=${layout}${process.env.QS||""}`),dsf:1});
await sleep(9000);
await s.send('Emulation.setCPUThrottlingRate',{rate:RATE});
await s.ev(`(()=>{const busy=document.getElementById('busy');window.__cog=[];window.__keys=[];window.__vals=[];
  new MutationObserver(()=>{const on=busy.classList.contains('on'),l=window.__cog.at(-1);if(!l||l.on!==on)window.__cog.push({on,t:performance.now()});}).observe(busy,{attributes:true,attributeFilter:['class']});
  document.addEventListener('keydown',e=>window.__keys.push({k:e.key,t:performance.now(),busy:busy.classList.contains('on')}),true);
  new MutationObserver(()=>{for(const r of document.querySelectorAll('#settings .row[data-edit]')){const v=r.querySelector('b')?.textContent;const l=window.__vals.findLast(x=>x.id===r.id);if(!l||l.v!==v)window.__vals.push({id:r.id,v,t:performance.now()});}}).observe(document.getElementById('settings'),{subtree:true,childList:true,characterData:true});
  return true;})()`);
const now=()=>s.ev('performance.now()');
const KEY={ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Enter:13,Escape:27,MediaPlayPause:179};
const press=(k,hold=80)=>{const a=s.send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:KEY[k]});
  return new Promise(r=>setTimeout(()=>r(Promise.all([a,s.send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:k,windowsVirtualKeyCode:KEY[k]})])),hold));};
const idle=async(ms=8000)=>{for(let t=0;t<ms;t+=50){if(await s.ev(`!document.getElementById('busy').classList.contains('on')`))return true;await sleep(50);}return false;};
const calmKey=async k=>{await idle();await press(k);await sleep(300);await idle();};
const focusId=()=>s.ev(`document.querySelector('#settings .focus')?.id`);
const editingId=()=>s.ev(`document.querySelector('#settings .row.editing')?.id||''`);
async function walkTo(target){
  for(let i=0;i<30;i++){
    if(await focusId()===target)return true;
    const col=await s.ev(`(()=>{const t=document.getElementById('${target}'),f=document.querySelector('#settings .focus');if(!t||!f)return 0;
      const a=t.getBoundingClientRect(),b=f.getBoundingClientRect();return a.left>b.right?1:a.right<b.left?-1:a.top>b.bottom?2:-2})()`);
    await calmKey(col===1?'ArrowRight':col===-1?'ArrowLeft':col===2?'ArrowDown':'ArrowUp');
  }
  return false;
}
// The cog's on-time (ms) for the first "on" after t: from on to off.
const cogAfter=async t=>{const c=await s.ev('window.__cog');const i=c.findIndex(x=>x.on&&x.t>=t);if(i<0)return 0;const off=c.slice(i+1).find(x=>!x.on);return off?Math.round(off.t-c[i].t):null;};
await calmKey('MediaPlayPause');
const rows=await s.ev(`[...document.querySelectorAll('#settings .row[data-edit]')].filter(r=>r.offsetParent).map(r=>r.id)`)||[];
const out=[];
const SKIP=(process.env.SKIP||"").split(",");
for(const row of rows){
  if(SKIP.includes(row))continue;
  const r={row,cogAfterChangeMs:[],cogAfterBackMs:null,trials:[]};
  if(!await walkTo(row)){r.error='could not reach';out.push(r);continue;}
  // 1. The cog after a change, three times, then after Back.
  await calmKey('Enter');
  for(let i=0;i<3;i++){const t=await now();await press('ArrowRight');await sleep(200);await idle();await sleep(200);r.cogAfterChangeMs.push(await cogAfter(t));}
  {const t=await now();await press('Escape');await sleep(200);await idle();await sleep(300);r.cogAfterBackMs=await cogAfter(t);}
  // 2. Right, OK, Down at a steady pace.
  for(const gap of GAPS){
    await walkTo(row);await calmKey('Enter');
    if(await editingId()!==row){r.trials.push({gap,error:'OK did not start editing'});await calmKey('Escape');continue;}
    const t=await now(),nk=(await s.ev('window.__keys.length'));
    const sent=[press('ArrowRight'),sleep(gap).then(()=>press('Enter')),sleep(2*gap).then(()=>press('ArrowDown'))];
    await Promise.all(sent);await sleep(400);await idle();await sleep(400);
    const keys=(await s.ev('window.__keys')).slice(nk).map(k=>({k:k.k,dt:Math.round(k.t-t),dropped:k.busy}));
    const vals=(await s.ev('window.__vals')).filter(v=>v.id===row&&v.t>=t).map(v=>v.v);
    const stillEditing=await editingId(),focus=await focusId();
    // The value changed by the Down: more than one change after Right (or the row still editing).
    r.trials.push({gap,keys,valueChanges:vals.length,values:vals,stillEditing:stillEditing||null,focus,downChangedValue:vals.length>1});
    if(stillEditing)await calmKey('Escape');
  }
  out.push(r);
}
await s.send('Emulation.setCPUThrottlingRate',{rate:1});
console.log(JSON.stringify({layout,rate:RATE,gaps:GAPS,rows:out,errors:s.errors.slice(0,5)}));
s.close();await sleep(1200);process.exit(0);
