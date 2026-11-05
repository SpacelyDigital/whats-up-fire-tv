// PORT=8814 node audit.mjs: host audit of fast Left/Right cycling on the store build. Every
// request is answered by the mocked bridge (lib36.mjs: 36 airliners around CVG, all on a 15 mi
// map at Hebron). Fast cycling through 30 planes, a 2.5 s hold, 12 fast Lefts, another hold,
// then Back. Lists every Planespotters lookup and image, and every adsb.lol route request, with
// the plane on the card at that moment.
import {open,base,sleep,state} from './lib36.mjs';
const s=await open({url:base('q=HEBRON&layout=atlas-dark&map=15'),size:[1920,1080]});
const T=()=>Math.round((Date.now()-s.T0)/100)/10;
const card=()=>s.ev(`document.getElementById('sr-live').textContent`);
const marks=[];const mark=async(what)=>marks.push({t:T(),what,card:await card()});
await sleep(14000);await mark('start (automatic hero)');
const fast=async(k,code,n)=>{const t0=T();for(let i=0;i<n;i++){await s.key(k,code);await sleep(30);}return [t0,T()];};
const w1=await fast('ArrowRight',39,30);await mark('end of 30 fast Rights: hold 2.5 s');await sleep(2500);
const w2=await fast('ArrowLeft',37,12);await mark('end of 12 fast Lefts: hold 2.5 s');await sleep(2500);
await s.key('Escape');await mark('Back: automatic');await sleep(6000);
const req=state.log.filter(e=>e.kind==='bridge'||e.kind==='direct');
const by={};for(const e of req)by[e.svc]=(by[e.svc]||0)+1;
const ps=req.filter(e=>e.svc==='psapi').map(e=>({t:Math.round(e.t*10)/10,id:(/\/(hex|reg)\/([^/]+)$/.exec(e.url)||[])[2]}));
const img=req.filter(e=>e.svc==='psimg').map(e=>({t:Math.round(e.t*10)/10,id:(/\/1\/([^_]+)_/.exec(e.url)||[])[1]}));
const routes=req.filter(e=>e.svc==='routes').map(e=>({t:Math.round(e.t*10)/10,call:(/\/([A-Z0-9-]+)\.json$/.exec(e.url)||[])[1]}));
console.log(JSON.stringify({windows:{fastRights:w1,fastLefts:w2},marks,requestsByService:by,planespotters:ps,images:img,routes,errors:s.errors.slice(0,5)},null,1));
s.close();process.exit(0);
