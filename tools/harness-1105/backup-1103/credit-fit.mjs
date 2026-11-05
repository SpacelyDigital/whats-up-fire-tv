// node credit-fit.mjs <dsf> [layouts]: with adsb.fi down and adsb.lol answering (mocked), the
// opening credit line in every layout at 960x540 CSS × dsf (2 = 1080, 1.3333 = 720), on the build
// served at PORT. Reports the wording fitLine chose, its font size, and any clipping, overflow or
// text outside the stage. One JSON line per layout.
import {open,base,setFault,sleep,state} from './lib.mjs';
const dsf=Number(process.argv[2])||2;
const L=(process.argv[3]||'atlas-dark,atlas,atlas-satellite,radar,glass,departures,blueprint,swiss,synthwave,sectional,cockpit,night-sky').split(',');
for(const layout of L){
  state.faults={};setFault('feed','offline');
  const s=await open({url:base(`q=HEBRON&layout=${layout}`),dsf});
  let r=null;const t0=Date.now();
  while(Date.now()-t0<45000){
    await sleep(500);
    r=await s.ev(`(()=>{const c=document.getElementById('credit-flash'),a=document.getElementById('credit-a');
      if(!c.classList.contains('on')||!/routes ADSB\\.lol/.test(a.textContent))return null;
      const st=document.getElementById('stage').getBoundingClientRect(),cr=c.getBoundingClientRect(),ar=a.getBoundingClientRect();
      const rg=document.createRange();rg.selectNodeContents(a);const tr=rg.getBoundingClientRect();
      return {text:a.textContent,alt:(a._alts||[]).indexOf(a.textContent),alts:(a._alts||[]).length,font:getComputedStyle(a).fontSize,
        clipped:a.scrollWidth>a.clientWidth+1||tr.width>ar.width+1,boxOverflow:c.scrollWidth>c.clientWidth+1,
        insideStage:cr.left>=st.left-1&&cr.right<=st.right+1&&cr.bottom<=st.bottom+1&&cr.top>=st.top-1,
        insideScreen:cr.left>=0&&cr.right<=innerWidth&&cr.bottom<=innerHeight,second:document.getElementById('credit-b').textContent.slice(0,40)};})()`);
    if(r)break;
  }
  if(r&&layout==='atlas-satellite'&&dsf===2)await s.shot(`credit-backup-${process.env.BUILD||'build'}-${layout}`);
  const backupAsked=state.log.filter(e=>e.svc==='backup').length;
  console.log(JSON.stringify({layout,dsf,build:process.env.BUILD||'',found:!!r,...(r||{}),backupAsked,errors:s.errors.slice(0,3)}));
  s.close();await sleep(800);
}
process.exit(0);
