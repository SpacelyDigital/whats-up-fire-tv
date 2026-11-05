// node --test tests/test-saved-times.mjs — every pause and cache time the app saves, and every
// Retry-After it reads, against damaged or odd values: never a NaN, zero or years-long timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Ledger,Enricher,ROUTE_URL,store,startLive,resetOutage,LEDGER_KEY,HISTORY_KEY} from '../web/live.mjs';
import {savedMap,saveMap,savedDetail,detailSpec} from '../web/mapgen.mjs';
import {photoFor,setPhotoGate} from '../web/photos.mjs';

const YEARS=10*365*86400; // seconds
const CVG={latitude:39.05,longitude:-84.65};

test('ledger: a row expiring years ahead (damaged, or a clock that jumped back) is dropped; real ones are kept',()=>{
  const now=Date.now()/1000;
  const L=new Ledger({'cooldown:adsblol':{expires:now+YEARS,value:true},'lol:UAL1':{expires:now+86000,value:{}},
    'route:abc:UAL1':{expires:now+6*3600,value:{}},'cooldown:adsblol-positions':{expires:now+900,value:now+900},
    'sighting:abc:UAL1':{expires:now+YEARS,value:{}}});
  assert.deepEqual([...L.rows.keys()].sort(),['cooldown:adsblol-positions','lol:UAL1','route:abc:UAL1']);
});

test('route lookups: a damaged pause years ahead does not stop them',async()=>{
  const now=Date.now()/1000,asked=[];
  const L=new Ledger({'cooldown:adsblol':{expires:now+YEARS,value:true}});
  const e=new Enricher(L,async url=>{asked.push(url);return {status:404,payload:null};});
  await e.tick([{hex:'112233',callsign:'UAL2202',registration:'N1',latitude:39.06,longitude:-84.65,observed:now,live:true,inside:true,miles:1}],now);
  assert.deepEqual(asked,[ROUTE_URL('UAL2202')]);
});

test('photos: a damaged saved pause (years ahead, not a number, negative) does not stop lookups for years',async()=>{
  const real=globalThis.fetch;setPhotoGate(()=>Promise.resolve(true));
  try{
    for(const [i,until] of [[0,Date.now()+YEARS*1000],[1,'soon'],[2,-5],[3,null]]){
      const asked=[];globalThis.fetch=async url=>{asked.push(String(url));return new Response('',{status:404});};
      store.set('whatsup.photos.pause',{until});
      await photoFor({hex:`a0000${i}`,registration:'',type:'B738'});
      assert.equal(asked.length,1,`asked with until=${JSON.stringify(until)}`);
    }
    // A real pause (a 403's 6 hours) still holds.
    store.set('whatsup.photos.pause',{until:Date.now()+6*3600000-1000});
    const asked=[];globalThis.fetch=async url=>{asked.push(String(url));return new Response('',{status:404});};
    await photoFor({hex:'a00009',registration:'',type:'B738'});
    assert.equal(asked.length,0,'a 6-hour pause is kept');
  }finally{globalThis.fetch=real;store.remove('whatsup.photos.pause');}
});

test('maps: a saved map "built" in the future counts as old (rebuilt, not kept for ever)',()=>{
  saveMap({v:4,...CVG,range:10,built:Date.now()+YEARS*1000});
  assert.equal(savedMap(CVG,10),null,'not fresh');
  assert.equal(savedMap(CVG,10,{stale:true})?.range,10,'still shown while a new one is built');
  saveMap({v:4,...CVG,range:10,built:Date.now()-1000});
  assert.equal(savedMap(CVG,10)?.range,10,'a real one is fresh');
  // The detail map the same way (saved straight to localStorage).
  const saved=new Map();globalThis.localStorage={getItem:k=>saved.has(k)?saved.get(k):null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)};
  try{
    const spec=detailSpec(10),m={v:4,...CVG,key:spec.key,range:spec.range,zoom:spec.zoom};
    const k=spec.key==='street'?'whatsup.detail.v1':`whatsup.detail.v1.${spec.key==='r10'?'r10':'wide'}`; // mapgen's detailKey
    saved.set(k,JSON.stringify({...m,built:Date.now()+YEARS*1000}));
    assert.equal(savedDetail(CVG,spec),null,'detail map from the future: not fresh');
    assert.ok(savedDetail(CVG,spec,{stale:true}),'but shown while a new one is built');
    saved.set(k,JSON.stringify({...m,built:Date.now()-1000}));
    assert.ok(savedDetail(CVG,spec),'a real detail map is fresh');
  }finally{delete globalThis.localStorage;}
});

// --- Retry-After as the services may send it: seconds, an HTTP-date (past or future), garbage,
// empty, negative, huge, or two headers joined. Only whole seconds count; the waits stay within
// the app's bounds whatever the TV's clock says (no NaN, no zero, no years).
const FORMS=['3','120','Wed, 21 Oct 2015 07:28:00 GMT','Tue, 03 Nov 2026 09:30:00 GMT','soon','','-30','1e9','Infinity','120, 60',' 45 '];
async function nextRequestAfter429(feed,form){
  resetOutage();store.remove(LEDGER_KEY);store.remove(HISTORY_KEY);
  const real={now:Date.now,perf:performance.now,set:globalThis.setTimeout,clear:globalThis.clearTimeout,fetch:globalThis.fetch};
  const t0=Date.parse('2026-11-03T05:00:00Z');let t=t0;const timers=new Set(),calls=[];
  Date.now=()=>t;performance.now=()=>t-t0;
  globalThis.setTimeout=(fn,ms)=>{const h={fn,at:t+Math.max(0,Number(ms)||0),ms};timers.add(h);return h;};
  globalThis.clearTimeout=h=>timers.delete(h);
  let n=0;
  globalThis.fetch=async(url)=>{url=String(url);const fi=/opendata\.adsb\.fi/.test(url),lol=/api\.adsb\.lol/.test(url);
    if(fi||lol)calls.push({t,fi});
    const hit=(feed==='adsb.fi'&&fi)||(feed==='adsb.lol'&&lol);
    if(feed==='adsb.lol'&&fi)throw new TypeError('offline');
    if(hit&&n++===0)return {status:429,url,headers:{get:k=>k.toLowerCase()==='retry-after'?form:null},text:async()=>''};
    return {status:404,url,headers:{get:()=>null},text:async()=>''};};
  const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
  try{
    const live=startLive(()=>{}, {...CVG,radiusMiles:3,pollSeconds:5,searchNm:15});
    for(let i=0;i<400;i++){await flush();const due=[...timers].sort((a,b)=>a.at-b.at)[0];if(!due)break;
      assert.ok(Number.isFinite(due.at),`a NaN timer after "${form}"`);timers.delete(due);t=due.at;due.fn();
      const mine=calls.filter(c=>feed==='adsb.fi'?c.fi:!c.fi);if(mine.length>=2)break;}
    live.stop();
    const mine=calls.filter(c=>feed==='adsb.fi'?c.fi:!c.fi);
    return mine.length>=2?(mine[1].t-mine[0].t)/1000:null;
  }finally{Date.now=real.now;performance.now=real.perf;globalThis.setTimeout=real.set;globalThis.clearTimeout=real.clear;globalThis.fetch=real.fetch;}
}
test('Retry-After on adsb.fi: a 429 waits 60 s to 5 min, whatever the header says',async()=>{
  for(const form of FORMS){
    const s=await nextRequestAfter429('adsb.fi',form);
    // adsb.fi's next try (on the backup that is one of its checks, about a minute or more on).
    assert.ok(s!==null&&s>=60&&s<=305,`adsb.fi after Retry-After "${form}": ${s} s`);
    if(form==='120')assert.ok(s>=120,'whole seconds are honoured');
  }
});
test('Retry-After on adsb.lol: a 429 waits 60 s to an hour, whatever the header says',async()=>{
  for(const form of FORMS){
    const s=await nextRequestAfter429('adsb.lol',form);
    assert.ok(s!==null&&s>=60&&s<=3610,`adsb.lol after Retry-After "${form}": ${s} s`);
    if(form==='120')assert.ok(s>=120&&s<=125,'whole seconds are honoured');
    if(form==='1e9'||form==='Infinity')assert.ok(s<=3610,'capped at an hour');
  }
});
