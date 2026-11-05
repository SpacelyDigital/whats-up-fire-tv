// node slow-cpu.mjs <rate> [minutes]: the store build (PORT, mocked services) with the CPU slowed
// <rate>x (Chrome's throttling, stick-class speed), adsb.fi down for the first half and back for
// the second. Measures: time to the first planes (from adsb.lol), the gaps between feed requests
// (do timers drift or stack?), adsb.fi's return, frame times while idle and while keys are
// pressed, how long a key takes to show (Settings open, Back), and JS errors.
import {open,base,setFault,sleep,state} from './lib.mjs';
const RATE=Number(process.argv[2])||6,MIN=Number(process.argv[3])||6;
state.faults={};setFault('feed','offline');
const s=await open({url:base('q=HEBRON&layout=atlas-dark'),dsf:1});
await s.send('Emulation.setCPUThrottlingRate',{rate:RATE});
const T0=s.T0,at=()=>Math.round((Date.now()-T0)/100)/10;
// Frame times from requestAnimationFrame, measured in the page.
await s.ev(`(()=>{window.__fr=[];let l=performance.now();const f=t=>{window.__fr.push(t-l);l=t;if(window.__fr.length>20000)window.__fr.shift();requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
let firstPlanes=null,back=null;const keys=[];
const half=T0+MIN*30000,end=T0+MIN*60000;let upAt=null;
while(Date.now()<end){
  await sleep(1000);
  if(!upAt&&Date.now()>=half){setFault('feed','ok');upAt=at();}
  const v=await s.ev(`({marks:document.querySelectorAll('#layout [data-hex]').length,credit:document.getElementById('credit-a').textContent.slice(0,40),on:document.getElementById('credit-flash').classList.contains('on')})`).catch(()=>null);
  if(v&&v.marks&&firstPlanes===null)firstPlanes=at();
  // Every ~45 s: Settings open (key to screen) and Back, timed in the page's own clock.
  if(Math.round(at())%45===0){
    const t0=Date.now();await s.key('MediaPlayPause');
    let open=null;for(let i=0;i<60;i++){await sleep(50);if(await s.ev(`!document.getElementById('settings').hidden`)){open=Date.now()-t0;break;}}
    const t1=Date.now();await s.key('Escape');
    let shut=null;for(let i=0;i<60;i++){await sleep(50);if(await s.ev(`document.getElementById('settings').hidden`)){shut=Date.now()-t1;break;}}
    keys.push({t:at(),settingsOpenMs:open,backMs:shut});
  }
}
const fr=await s.ev(`(()=>{const a=window.__fr.slice(5).sort((x,y)=>x-y);const q=p=>Math.round(a[Math.floor(p*(a.length-1))]);return {n:a.length,median:q(.5),p95:q(.95),max:Math.round(a.at(-1)),over100:a.filter(x=>x>100).length}})()`);
const feed=state.log.filter(e=>e.svc==='feed'||e.svc==='backup').map(e=>({t:Math.round(e.t*10)/10,svc:e.svc,status:e.status}));
const lol=feed.filter(e=>e.svc==='backup').map(e=>e.t),gaps=lol.slice(1).map((v,i)=>Math.round((v-lol[i])*10)/10);
const fiOkAfterUp=feed.find(e=>e.svc==='feed'&&upAt!==null&&e.t>=upAt&&e.status===200);
console.log(JSON.stringify({rate:RATE,minutes:MIN,firstPlanesSec:firstPlanes,adsbfiUpAt:upAt,firstAdsbfiOkAfterUp:fiOkAfterUp?.t??null,
  adsblol:{n:lol.length,minGap:Math.min(...gaps),maxGap:Math.max(...gaps),gaps:gaps.slice(0,12)},
  lolAfterUp:feed.filter(e=>e.svc==='backup'&&fiOkAfterUp&&e.t>fiOkAfterUp.t).length,
  frames:fr,keys,errors:s.errors.slice(0,5)}));
s.close();await sleep(1200);process.exit(0);
