// node consent-fit.mjs <dsf>: the first-run "Before we start" screen (its text now names adsb.lol
// as the backup) in every layout's colours, at 960x540 CSS × dsf, on the build at PORT. Checks the
// whole text is there and nothing is cut, overflows or leaves the screen; no request goes out.
import {open,base,sleep,state} from './lib.mjs';
const dsf=Number(process.argv[2])||2;
const L=['atlas-dark','atlas','atlas-satellite','radar','glass','departures','blueprint','swiss','synthwave','sectional','cockpit','night-sky'];
for(const layout of L){
  const s=await open({url:base(`layout=${layout}`),dsf});
  let r=null;
  for(let i=0;i<40&&!r;i++){await sleep(250);
    r=await s.ev(`(()=>{const o=document.getElementById('consent');if(!o||o.hidden)return null;const b=document.getElementById('consent-body');
      const bad=[];for(const e of o.querySelectorAll('*')){if(e.children.length||!(e.textContent||'').trim())continue;const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden')continue;
        const rc=e.getBoundingClientRect();if(!rc.width)continue;if(e.scrollWidth>e.clientWidth+1&&cs.overflow!=='visible')bad.push('CLIP '+e.id+' '+e.textContent.slice(0,30));
        if(e.scrollHeight>e.clientHeight+2&&cs.overflowY!=='visible'&&cs.overflowY!=='auto'&&cs.overflowY!=='scroll')bad.push('VCLIP '+e.id);
        if(rc.right>innerWidth+1||rc.bottom>innerHeight+1||rc.left<-1||rc.top<-1)bad.push('OFF '+(e.id||e.className)+' '+e.textContent.slice(0,30));}
      const btn=[...o.querySelectorAll('button')].map(x=>{const q=x.getBoundingClientRect();return q.bottom<=innerHeight&&q.right<=innerWidth&&q.width>0;});
      return {named:/ADSB\\.lol while adsb\\.fi is down/.test(b.textContent),chars:b.textContent.length,bad,buttonsVisible:btn.length&&btn.every(Boolean),
        bodyScrolls:b.scrollHeight>b.clientHeight+2};})()`);
  }
  const sent=state.log.filter(e=>e.kind!=='msg').length;
  if(r&&layout==='atlas-dark')await s.shot(`consent-${process.env.BUILD||'build'}-${Math.round(540*dsf)}`);
  console.log(JSON.stringify({layout,dsf,build:process.env.BUILD||'',shown:!!r,...(r||{}),requestsBeforeAgree:sent,errors:s.errors.slice(0,3)}));
  s.close();await sleep(600);
}
process.exit(0);
