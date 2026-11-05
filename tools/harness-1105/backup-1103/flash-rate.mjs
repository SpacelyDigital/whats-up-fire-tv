// node flash-rate.mjs [minutes]: adsb.fi flaps (down ~80 s, up until the app is back on it,
// again and again) while adsb.lol answers; every time the opening credit line appears is logged
// with its text, next to the feed switches seen in the request log. The line may come back for
// a change of source at most once every 10 minutes.
import {open,base,setFault,sleep,state} from './lib.mjs';
const MIN=Number(process.argv[2])||11.5;
state.faults={};setFault('feed','offline');
const s=await open({url:base('q=HEBRON&layout=atlas-dark'),dsf:1});
const flashes=[],T=()=>Math.round((Date.now()-s.T0)/100)/10;let was=false,lastFault='offline';
const toggles=[];
const end=Date.now()+MIN*60000;
let next=Date.now()+40000; // first recovery 40 s in
while(Date.now()<end){
  await sleep(250);
  const r=await s.ev(`(()=>{const c=document.getElementById('credit-flash');return {on:c.classList.contains('on'),text:document.getElementById('credit-a').textContent}})()`);
  if(r.on&&!was)flashes.push({t:T(),text:r.text.replace(/ · Map.*$/,'')});
  was=r.on;
  if(Date.now()>=next){
    // Flip adsb.fi: down for ~80 s, then up until the app has asked it again and got data.
    lastFault=lastFault==='offline'?'ok':'offline';setFault('feed',lastFault);toggles.push({t:T(),adsbfi:lastFault==='ok'?'up':'down'});
    next=Date.now()+(lastFault==='ok'?70000:80000);
  }
}
// Which feed answered each data request, in order: the switches the app made.
const answers=state.log.filter(e=>(e.svc==='feed'||e.svc==='backup')&&e.status===200).map(e=>({t:Math.round(e.t),svc:e.svc==='feed'?'adsb.fi':'adsb.lol'}));
const switches=[];for(const a of answers)if(!switches.length||switches.at(-1).svc!==a.svc)switches.push(a);
console.log(JSON.stringify({minutes:MIN,toggles,switches,flashes,errors:s.errors.slice(0,3)},null,1));
s.close();process.exit(0);
