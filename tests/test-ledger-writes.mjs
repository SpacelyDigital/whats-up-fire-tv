// node --test tests/test-ledger-writes.mjs — the route ledger (whatsup.ledger.v1) and 'Recently above'
// (whatsup.history.v1) are saved once a minute, at once when the app is hidden, the feed stops or adsb.lol
// asks for a pause, and 'Recently above' when its planes change: not on every poll (after a day near a
// hub the ledger is hundreds of KB, and serialising and writing it blocked a stick about 30 ms a poll).
// The live source runs on a simulated clock (Date.now, performance.now, setTimeout and fetch replaced)
// over a counting localStorage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startLive,resetOutage,store,LEDGER_KEY,HISTORY_KEY} from '../web/live.mjs';

const T0=Date.parse('2026-11-05T15:00:00Z'),CVG={latitude:39.05,longitude:-84.65},CFG={...CVG,radiusMiles:3,pollSeconds:5,searchNm:15};
const FI=/^https:\/\/opendata\.adsb\.fi\//,ROUTE=/vrs-standing-data\.adsb\.lol\/routes\/[A-Z0-9]+\/([A-Z0-9]+)\.json$/;
// An airline plane a mile north (inside the 3 mi zone; its lookup a miss) and one 7 mi north on an
// easterly AAA-BBB leg (outside: only its cached route row is put again each poll).
const INSIDE={hex:'a1f1f1',flight:'FIX101  ',r:'N1F1',t:'B738',lat:39.065,lon:-84.65,alt_baro:4000,gs:220,track:90,seen_pos:0.4};
const PASSING={hex:'a2b2b2',flight:'UAL1    ',r:'N2B2',t:'A320',lat:39.15,lon:-84.65,alt_baro:35000,gs:450,track:90,seen_pos:0.4};
const UAL1={callsign:'UAL1',_airports:[{iata:'AAA',lat:39.05,lon:-86.65},{iata:'BBB',lat:39.05,lon:-82.65}]};

function rig(){
  const real={now:Date.now,perf:performance.now,set:globalThis.setTimeout,clear:globalThis.clearTimeout,fetch:globalThis.fetch,ls:Object.getOwnPropertyDescriptor(globalThis,'localStorage')};
  let t=T0;const timers=new Set(),saved=new Map(),writes={},asked=[],routes={UAL1:{status:200,body:UAL1}};
  Date.now=()=>t;performance.now=()=>t-T0;
  globalThis.setTimeout=(fn,ms)=>{const h={fn,at:t+Math.max(0,Number(ms)||0)};timers.add(h);return h;};
  globalThis.clearTimeout=h=>{timers.delete(h);};
  globalThis.localStorage={getItem:k=>saved.has(k)?saved.get(k):null,removeItem:k=>saved.delete(k),setItem:(k,v)=>{writes[k]=(writes[k]||0)+1;saved.set(k,String(v));}};
  const res=(status,body)=>({status,url:'',headers:{get:()=>null},text:async()=>body?JSON.stringify(body):''});
  globalThis.fetch=url=>{
    url=String(url);
    if(FI.test(url))return Promise.resolve(res(200,{ac:[INSIDE,PASSING],msg:'No error',now:t}));
    const call=ROUTE.exec(url)?.[1];if(call)asked.push(call);
    const r=call&&routes[call];return Promise.resolve(r?res(r.status,r.body):res(404));
  };
  const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
  async function advance(ms){
    const end=t+ms;
    for(;;){
      await flush();
      const due=[...timers].filter(h=>h.at<=end).sort((a,b)=>a.at-b.at)[0];
      if(!due)break;
      timers.delete(due);t=Math.max(t,due.at);due.fn();
    }
    t=end;await flush();
  }
  resetOutage();store.remove(LEDGER_KEY);store.remove(HISTORY_KEY);
  const n=k=>writes[k]||0,ledger=()=>JSON.parse(saved.get(LEDGER_KEY)||'null');
  const restore=()=>{Date.now=real.now;performance.now=real.perf;globalThis.setTimeout=real.set;globalThis.clearTimeout=real.clear;globalThis.fetch=real.fetch;
    if(real.ls)Object.defineProperty(globalThis,'localStorage',real.ls);else delete globalThis.localStorage;resetOutage();};
  return {saved,asked,routes,advance,n,ledger,restore,live:(config=CFG)=>startLive(()=>{},config),get t(){return t-T0;}};
}

test('ledger: 13 polls in a minute write it once, at the minute, and once a minute after; Recently above once when its plane appears and once a minute with its times',async()=>{
  const r=rig();
  try{
    const live=r.live();
    await r.advance(59000);
    assert.deepEqual(r.asked,['FIX101','UAL1'],'both lookups made');
    assert.equal(r.n(LEDGER_KEY),0,'12 polls, every one putting rows: no write within the minute');
    assert.equal(r.n(HISTORY_KEY),1,'Recently above: written when the plane appeared, not for its moving time');
    await r.advance(2000);
    assert.equal(r.n(LEDGER_KEY),1,'written at the minute');
    assert.equal(r.n(HISTORY_KEY),2,'its time refreshed with it');
    assert.deepEqual(Object.keys(r.ledger()).sort(),['lol:FIX101','lol:UAL1','route:a2b2b2:UAL1','sighting:a1f1f1:FIX101'],'the saved ledger is whole');
    assert.deepEqual(JSON.parse(r.saved.get(HISTORY_KEY)).map(a=>a.hex),['a1f1f1']);
    await r.advance(60000);
    assert.equal(r.n(LEDGER_KEY),2,'12 more polls: one more write');
    assert.equal(r.n(HISTORY_KEY),3);
    live.stop();
  }finally{r.restore();}
});

test('ledger: hidden (pause), the unsaved ledger and Recently above are written at once; shown again, the minute starts over',async()=>{
  const r=rig();
  try{
    const live=r.live();
    await r.advance(12000);
    assert.equal(r.n(LEDGER_KEY),0);assert.equal(r.n(HISTORY_KEY),1);
    live.pause();
    assert.equal(r.n(LEDGER_KEY),1,'the ledger saved on hide');
    assert.equal(r.n(HISTORY_KEY),2,'Recently above too');
    assert.deepEqual(Object.keys(r.ledger()).sort(),['lol:FIX101','lol:UAL1','route:a2b2b2:UAL1','sighting:a1f1f1:FIX101']);
    live.pause();assert.equal(r.n(LEDGER_KEY),1,'nothing new to save: no second write');
    live.resume();
    await r.advance(59000);
    assert.equal(r.n(LEDGER_KEY),1,'back on screen: not within the minute');
    await r.advance(5000);
    assert.equal(r.n(LEDGER_KEY),2,'then at the first poll past it');
    live.stop();
  }finally{r.restore();}
});

test('ledger: a stop saves it (the feed that replaces it reads the lookups back and asks for none again), not a Recently above the alert-zone change has just dropped',async()=>{
  const r=rig();
  try{
    let live=r.live();
    await r.advance(12000);
    assert.deepEqual(r.asked,['FIX101','UAL1']);
    store.remove(HISTORY_KEY); // as a kept Alert zone change does before the restart
    live.stop();
    assert.equal(r.n(LEDGER_KEY),1,'saved on stop');
    assert.equal(r.saved.has(HISTORY_KEY),false,'the dropped list is not written back');
    live=r.live();
    await r.advance(20000);
    assert.deepEqual(r.asked,['FIX101','UAL1'],'the restarted feed has both answers');
    assert.deepEqual(JSON.parse(r.saved.get(HISTORY_KEY)).map(a=>a.hex),['a1f1f1'],'Recently above starts afresh with the plane inside');
    live.stop();
  }finally{r.restore();}
});

test('ledger: a pause adsb.lol asks for on a route lookup (a 429: 15 min) is saved on that poll, so the next launch keeps it; the polls after wait for the minute again',async()=>{
  const r=rig();
  try{
    r.routes.FIX101={status:429,body:null};
    const live=r.live();
    await r.advance(100);
    assert.deepEqual(r.asked,['FIX101']);
    assert.equal(r.n(LEDGER_KEY),1,'saved at once');
    assert.deepEqual(r.ledger()['cooldown:adsblol'],{expires:T0/1000+900,value:900});
    await r.advance(30000);
    assert.equal(r.n(LEDGER_KEY),1,'six more polls, no new pause: no write');
    assert.deepEqual(r.asked,['FIX101'],'no lookup within the pause');
    live.stop();
  }finally{r.restore();}
});
