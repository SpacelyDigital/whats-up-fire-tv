// node clips.mjs <layout> [metric]: Settings, then Change location (search screen) over it, on the
// build at PORT (mocked services, a plane with a Planespotters photo on the card). Measures the
// three lines the fuzz found cut (the search-source line, Settings' "Policy and erase", the card's
// photo credit) on each screen and after closing them, with a screenshot of each step.
import {open,base,sleep} from '../backup-1103/lib.mjs';
const [layout='swiss',metric]=process.argv.slice(2);
const s=await open({url:base(`q=HEBRON&layout=${layout}&map=5${metric?'&units=metric':''}`),dsf:1});
await sleep(9000);
const measure=label=>s.ev(`(()=>{const out={};const top=[...document.querySelectorAll('.overlay')].filter(o=>!o.hidden).map(o=>o.id);
  const m=(name,e)=>{if(!e){out[name]='none';return;}const cs=getComputedStyle(e),r=e.getBoundingClientRect();
    out[name]={text:e.textContent.slice(0,60),cut:e.scrollWidth>e.clientWidth+1,sw:e.scrollWidth,cw:e.clientWidth,font:cs.fontSize,shown:!!r.width&&cs.visibility!=='hidden'&&cs.display!=='none'&&!e.closest('[hidden]')};};
  m('searchSrc',document.getElementById('search-src'));
  m('privacyValue',[...document.querySelectorAll('#settings .row')].find(r=>/Privacy/.test(r.textContent))?.querySelector('.value,.v,span:last-child'));
  m('photoCredit',document.querySelector('#layout .ph-cap'));
  return {label:${JSON.stringify('')},top,...out};})()`).then(v=>({...v,label}));
const steps=[];
steps.push(await measure('dashboard'));await s.shot(`clip-${layout}-1-dashboard`);
await s.key('MediaPlayPause');await sleep(1500);steps.push(await measure('settings'));await s.shot(`clip-${layout}-2-settings`);
await s.ev(`document.getElementById('set-location').click()`);await sleep(2000);steps.push(await measure('settings>locate'));await s.shot(`clip-${layout}-3-locate`);
await s.key('Escape');await sleep(1200);steps.push(await measure('back to settings'));
await s.key('Escape');await sleep(1500);steps.push(await measure('back to dashboard'));await s.shot(`clip-${layout}-4-dashboard-again`);
console.log(JSON.stringify({layout,metric:!!metric,steps},null,1));
s.close();await sleep(1200);process.exit(0);
