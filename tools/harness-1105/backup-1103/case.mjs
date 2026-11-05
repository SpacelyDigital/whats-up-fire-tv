// node case.mjs <svc> <mode> [retryAfter] [faultSeconds]
// svc 'backup' (api.adsb.lol positions): adsb.fi is down (offline) for the whole case, so the
// backup is in use; only the backup's fault is cleared.
import {open,base,state,sleep,setFault,rate,gaps,service} from './lib.mjs';
const [svc,mode,ra,fs]=process.argv.slice(2);const F=Number(fs)||150,R=360;
const qs={usgs:'q=HEBRON&layout=atlas-satellite',eox:'q=LONDON&layout=atlas-satellite'}[svc]||'q=HEBRON&layout=atlas-dark';
setFault(svc,mode,ra!==undefined&&ra!==''?{retryAfter:Number(ra)}:{});
if(svc==='backup')setFault('feed',process.env.FEED_DOWN||'offline');
if(svc==='psapi'||svc==='psimg'){} // photos
const s=await open({url:base(qs)});
const tag=`${svc}-${mode}${ra?'-ra'+ra:''}`;
const texts=new Map();
const sample=async label=>{const t=await s.text();const full=(t.notes.join(' | ')+' || '+t.screen).slice(0,420);const k=full.replace(/\d+/g,'#');if(!texts.has(k))texts.set(k,label+': '+full);return t;};
const recovered=async t=>{
  t=t||await s.text();const sc=t.screen,notes=t.notes.join(' ');
  switch(svc){
    case 'feed':case 'backup':return /DAL1234|UAL567|FDX88|AAL2201/.test(sc)&&!/No live data|No signal/.test(sc);
    case 'routes':return /→/.test(sc);
    case 'psapi':case 'psimg':return /Photo © Test Photographer/.test(sc);
    case 'tiles':case 'tilejson':return !/unavailable|Drawing|Filling/i.test(notes)&&rate(svc).some(e=>e.fault==='ok');
    default:return rate(svc).some(e=>e.fault==='ok'&&(e.status===200||e.status==='ok'));
  }
};
let withPlanes=0,samples=0;
for(let t=0;t<F;t+=5){await sleep(5000);const x=await sample('fault@'+(t+5));samples++;if(/DAL1234|UAL567|FDX88|AAL2201/.test(x.screen)&&!/No live data|No signal/.test(x.screen))withPlanes++;if(t+5===60)await s.shot('m-'+tag+'-60s');}
const during=rate(svc,0,F+1);
// The other position feed during the fault: adsb.lol standing in for adsb.fi, or adsb.fi's checks.
const other=rate(svc==='backup'?'feed':svc==='feed'?'backup':'-',0,F+1);
const others={};for(const e of state.log)if(e.kind!=='msg'&&e.t<=F+1&&e.svc!==svc)others[e.svc]=(others[e.svc]||0)+1;
setFault(svc,'ok');const tClear=(Date.now()-s.T0)/1000;
let rec=null;
for(let t=0;t<R;t+=5){await sleep(5000);const x=await sample('after@'+(t+5));if(await recovered(x)){rec=Math.round((Date.now()-s.T0)/1000-tClear);break;}}
if(rec!==null)await s.shot('m-'+tag+'-recovered');else await s.shot('m-'+tag+'-norecover');
const g=gaps(during);
console.log(JSON.stringify({case:tag,faultSec:F,requests:during.length,statuses:[...new Set(during.map(e=>String(e.status)))],
  firstGaps:g.slice(0,10),minGap:g.length?Math.min(...g):null,maxGap:g.length?Math.max(...g):null,
  perMin:Math.round(during.length/(F/60)*10)/10,others,recoveredAfterSec:rec,
  planesShownDuringFault:`${withPlanes}/${samples}`,otherFeed:{requests:other.length,statuses:[...new Set(other.map(e=>String(e.status)))],gaps:gaps(other).slice(0,8),first:other[0]?.t??null},
  firstOkAfterClear:(()=>{const e=rate(svc,tClear).find(e=>e.fault==='ok');return e?Math.round(e.t-tClear):null;})(),
  texts:[...texts.values()],errors:s.errors.slice(0,5)}));
s.close();process.exit(0);
