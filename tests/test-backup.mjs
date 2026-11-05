// node --test tests/test-backup.mjs — the adsb.lol backup positions (web/live.mjs): used only
// while adsb.fi isn't answering, from the same rounded point, radius and interval.
// The live source runs on a simulated clock: Date.now, performance.now, setTimeout and fetch are
// replaced, and each host answers from its own script. CVG is the test place (no one's home).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startLive,fromBackup,feedStamp,outage,resetOutage,store,LEDGER_KEY,HISTORY_KEY,BACKUP_PAUSE_S} from '../web/live.mjs';
import {start,resetLog,retryIn} from '../web/model.mjs';
import {quietText} from '../web/kit.mjs';
import {IDS,chimeGate} from '../web/core.mjs';

const T0=Date.parse('2026-11-03T05:00:00Z');
const CVG={latitude:39.05,longitude:-84.65};
const CFG={...CVG,radiusMiles:3,pollSeconds:5,searchNm:15};
const FI=/^https:\/\/opendata\.adsb\.fi\/api\/v3\/lat\/(-?[\d.]+)\/lon\/(-?[\d.]+)\/dist\/(\d+)$/;
const LOL=/^https:\/\/api\.adsb\.lol\/v2\/lat\/(-?[\d.]+)\/lon\/(-?[\d.]+)\/dist\/(\d+)$/;
// One plane from each feed, 1 mi north of CVG, so the source of every update is plain.
const plane=(hex,flight,extra={})=>({hex,flight:flight.padEnd(8),r:'N1'+hex.slice(-3),t:'B738',lat:39.065,lon:-84.65,
  alt_baro:4000,gs:220,track:90,baro_rate:-640,squawk:'2214',seen_pos:0.4,seen:0.2,...extra});
const FI_PLANE=plane('a1f1f1','FIX101'),LOL_PLANE=plane('a10101','LOL202');

// The rig: `feeds.fi` / `feeds.lol` say how each host answers now ({mode, retryAfter, body,
// nowShiftMs, seconds}); modes: ok, offline, timeout, s<code>, garbage, empty, portal, nolist.
function rig(t0=T0){
  const real={now:Date.now,perf:performance.now,set:globalThis.setTimeout,clear:globalThis.clearTimeout,fetch:globalThis.fetch,random:Math.random};
  let t=t0,inFlight=0;const timers=new Set(),calls=[],updates=[];
  const feeds={fi:{mode:'ok'},lol:{mode:'ok'}};
  Date.now=()=>t;performance.now=()=>t-t0;Math.random=()=>.5; // jitter ×1: back-offs are exact
  globalThis.setTimeout=(fn,ms)=>{const h={fn,at:t+Math.max(0,Number(ms)||0)};timers.add(h);return h;};
  globalThis.clearTimeout=h=>{timers.delete(h);};
  const res=(status,text,headers={})=>({status,url:'',headers:{get:k=>headers[k.toLowerCase()]??null},text:async()=>text});
  globalThis.fetch=(url,opts={})=>{
    url=String(url);
    const which=FI.test(url)?'fi':LOL.test(url)?'lol':/vrs-standing-data\.adsb\.lol/.test(url)?'route':'other';
    const call={t,url,which,done:null};calls.push(call);
    if(which==='route'||which==='other')return Promise.resolve(res(404,''));
    const f=feeds[which];inFlight++;
    if(inFlight>1)call.overlap=true;
    const settle=p=>p.finally(()=>{inFlight--;call.done=t;});
    const now=t+(f.nowShiftMs||0),stamp=f.seconds?now/1000:now;
    switch(f.mode){
      case 'ok':return settle(Promise.resolve(res(200,JSON.stringify(f.body||{ac:[which==='fi'?FI_PLANE:LOL_PLANE],msg:'No error',now:stamp,total:1}))));
      case 'offline':return settle(Promise.reject(new TypeError('offline')));
      case 'timeout':return settle(new Promise((_,no)=>opts.signal?.addEventListener('abort',()=>no(new Error('aborted')))));
      case 'garbage':return settle(Promise.resolve(res(200,'\u0000ÿ{"ac":[{"hex":'+'x'.repeat(40))));
      case 'portal':return settle(Promise.resolve(res(200,'<!DOCTYPE html><title>Guest Wi-Fi</title>')));
      case 'empty':return settle(Promise.resolve(res(200,'')));
      case 'nolist':return settle(Promise.resolve(res(200,JSON.stringify({msg:'maintenance'}))));
    }
    const code=Number(/^s(\d+)$/.exec(f.mode)[1]);
    return settle(Promise.resolve(res(code,'',f.retryAfter!==undefined?{'retry-after':String(f.retryAfter)}:{})));
  };
  const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
  // Run the clock forward, firing timers in order.
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
  const live=(config=CFG)=>startLive((states,ok)=>updates.push({t,ok,source:states.source||'',
    hexes:(states[IDS.feed]?.attributes?.ac||[]).map(a=>a.hex),retryAt:states.retryAt,skew:states.skew,coverage:states.coverage,states}),config);
  const feedCalls=()=>calls.filter(c=>c.which==='fi'||c.which==='lol');
  const at=(which,from=0,to=Infinity)=>calls.filter(c=>c.which===which&&c.t>=t0+from&&c.t<=t0+to).map(c=>c.t-t0);
  const restore=()=>{Date.now=real.now;performance.now=real.perf;globalThis.setTimeout=real.set;globalThis.clearTimeout=real.clear;globalThis.fetch=real.fetch;Math.random=real.random;};
  return {feeds,calls,updates,advance,live,feedCalls,at,restore,cpu:()=>real.perf.call(performance),get t(){return t-t0;}};
}
// A clean start for each test: no outage known, no saved pause.
function fresh(t0){resetOutage();resetLog();store.remove(LEDGER_KEY);store.remove(HISTORY_KEY);return rig(t0);}
const lastData=r=>r.updates.filter(u=>u.ok&&u.source).at(-1);

test('backup: adsb.fi down, positions come from adsb.lol within 20 s, same point and radius, every 10 s',async()=>{
  const r=fresh();
  try{
    r.feeds.fi={mode:'timeout'}; // adsb.fi not answering at all, as on 3 November
    const live=r.live();
    await r.advance(20000);
    // adsb.fi asked twice: at the start, and after its first 5 s back-off (each waits 4.48 s).
    assert.deepEqual(r.at('fi'),[0,9480]);
    const lol=r.at('lol');
    assert.ok(lol.length>=1&&lol[0]<=15000,`adsb.lol asked at ${lol[0]} ms`);
    const first=r.updates.find(u=>u.ok&&u.source==='adsb.lol');
    assert.ok(first&&first.t-T0<=20000,'planes from adsb.lol within 20 s');
    assert.deepEqual(first.hexes,['a10101']);
    // The same 0.05° point and distance adsb.fi gets.
    const [fi1]=r.calls.filter(c=>c.which==='fi'),[lol1]=r.calls.filter(c=>c.which==='lol');
    assert.deepEqual(LOL.exec(lol1.url).slice(1),FI.exec(fi1.url).slice(1));
    assert.deepEqual(LOL.exec(lol1.url).slice(1),['39.05','-84.65','18']);
    // Then every 10 s (adsb.lol answers adsb.fi's 5 s pace with a 429), and adsb.fi left alone
    // until its once-a-minute check.
    await r.advance(40000);
    const gaps=r.at('lol').slice(1).map((v,i)=>v-r.at('lol')[i]);
    assert.ok(gaps.length>=4&&gaps.every(g=>g===10000),`adsb.lol every 10 s: ${gaps}`);
    assert.deepEqual(r.at('fi'),[0,9480],'no adsb.fi request within a minute of the last');
    live.stop();
  }finally{r.restore();}
});

test('backup: adsb.fi recovers, positions come from adsb.fi again (checked about once a minute)',async()=>{
  const r=fresh();
  try{
    r.feeds.fi={mode:'s503'};
    const live=r.live();
    await r.advance(30000);
    assert.equal(lastData(r).source,'adsb.lol');
    r.feeds.fi={mode:'ok'}; // back
    await r.advance(60000);
    const fi=r.at('fi');
    // 0 and 5 s (503s), then one check about a minute after the last ask, which answers.
    assert.deepEqual(fi.slice(0,2),[0,5000]);
    assert.ok(fi[2]-fi[1]>=60000&&fi[2]-fi[1]<=66000,`checked ${fi[2]-fi[1]} ms after the last ask`);
    const back=r.updates.find(u=>u.ok&&u.source==='adsb.fi');
    assert.ok(back&&back.t-T0===fi[2],'its first good reply is shown');
    assert.deepEqual(back.hexes,['a1f1f1']);
    assert.equal(outage.down,false);
    // From then on adsb.fi only, every 5 s.
    const n=r.at('lol').length;
    await r.advance(30000);
    assert.equal(r.at('lol').length,n,'no adsb.lol request once adsb.fi answers');
    assert.ok(r.at('fi',fi[2]+1).length>=5);
    assert.equal(lastData(r).source,'adsb.fi');
    live.stop();
  }finally{r.restore();}
});

test('backup: both down shows "No live data, reconnecting in N s"',async()=>{
  const r=fresh();const models=[];
  try{
    r.feeds.fi={mode:'offline'};r.feeds.lol={mode:'s503'};
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push({...m,at:r.t}));
    await r.advance(120000);
    const m=models.at(-1);
    assert.equal(m.fresh,false);assert.equal(m.connecting,false);
    assert.match(quietText(m,false),/^No live data right now\. Reconnecting in \d+ s\.$/);
    assert.ok(m.retryIn>0);
    // Both still asked, each backing off: adsb.lol 10 (its floor), 10, 20 s apart.
    const lol=r.at('lol'),gaps=lol.slice(1).map((v,i)=>v-lol[i]);
    assert.deepEqual(gaps.slice(0,3),[10000,10000,20000]);
    assert.ok(r.at('fi').length>=2);
    // When adsb.lol answers again its planes show, adsb.fi still down.
    r.feeds.lol={mode:'ok'};await r.advance(90000);
    assert.equal(models.at(-1).fresh,true);assert.equal(models.at(-1).source,'adsb.lol');
    s.stop();
  }finally{r.restore();}
});

test('outage: the first failed poll ends "Connecting to the live feed"; the model says when the next poll is due, so the line counts down with no new model',async()=>{
  const r=fresh(),models=[];
  try{
    r.feeds.fi={mode:'s500'};r.feeds.lol={mode:'s403'}; // adsb.lol paused 15 min: nothing more is asked for a minute
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    assert.equal(quietText(models[0],false),'Connecting to the live feed','before any reply');
    await r.advance(100);
    assert.equal(quietText(models.at(-1),false),'No live data right now. Reconnecting in 5 s.','at the first failure');
    await r.advance(15000);
    const m=models.at(-1),n=models.length;
    assert.equal(m.connecting,false);
    assert.equal(m.retryAt,r.at('fi').at(-1)+60000,'due: adsb.fi\'s check a minute after its last (performance.now() ms)');
    await r.advance(20000);
    assert.equal(models.length,n,'no new model between polls');
    assert.equal(Math.round((m.retryAt-r.t)/1000),30,'30 s to go at 35 s');
    s.stop();
  }finally{r.restore();}
});

test('backup: never both feeds on one poll, never at the same time (90 min of random outages)',async()=>{
  const r=fresh();
  try{
    const modes=['ok','ok','ok','offline','timeout','s503','s500','s429','s403','garbage','empty','portal','nolist'];
    let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
    const live=r.live();
    for(let step=0;step<180;step++){
      r.feeds.fi={mode:modes[Math.floor(rnd()*modes.length)],retryAfter:rnd()<.3?Math.floor(rnd()*200):undefined};
      r.feeds.lol={mode:modes[Math.floor(rnd()*modes.length)]};
      await r.advance(30000);
    }
    const calls=r.feedCalls();
    const count=w=>calls.filter(c=>c.which===w).length;
    assert.ok(count('lol')>20&&count('fi')>20,`both feeds exercised: adsb.fi ${count('fi')}, adsb.lol ${count('lol')}`);
    assert.ok(!calls.some(c=>c.overlap),'one feed request in flight at a time');
    // Each request starts after the previous one has finished: one feed per poll.
    for(let i=1;i<calls.length;i++)assert.ok(calls[i].t>=calls[i-1].done,`request ${i} started before ${i-1} finished`);
    // adsb.lol only right after a failed adsb.fi request (it isn't answering), never after a good one.
    const isOk=c=>c.which==='fi'&&r.updates.some(u=>u.ok&&u.source==='adsb.fi'&&u.t===c.done);
    let lastFi=null;
    for(const c of calls){if(c.which==='fi')lastFi=c;else assert.ok(lastFi&&!isOk(lastFi),'adsb.lol asked while adsb.fi was answering');}
    live.stop();
  }finally{r.restore();}
});

test('backup: an adsb.lol 403 (or other 4xx but 429) pauses its positions for 15 minutes, across a restart',async()=>{
  for(const mode of ['s403','s404']){
    const r=fresh();
    try{
      r.feeds.fi={mode:'offline'};r.feeds.lol={mode};
      let live=r.live();
      await r.advance(20000);
      const [hit]=r.at('lol');assert.ok(hit!==undefined,'adsb.lol asked');
      r.feeds.lol={mode:'ok'};
      await r.advance(5*60000);
      // A restart (new radius) mid-pause doesn't ask it again.
      live.stop();live=r.live({...CFG,searchNm:30});
      await r.advance(9*60000);
      assert.deepEqual(r.at('lol'),[hit],`${mode}: no adsb.lol request for 15 minutes`);
      // adsb.fi is still checked meanwhile: once a minute at first, then as its back-off grows
      // (80 s, 160 s, 5 min).
      assert.ok(r.at('fi',hit).length>=5,`${mode}: adsb.fi checked ${r.at('fi',hit).length} times`);
      await r.advance(BACKUP_PAUSE_S*1000-14*60000+6000);
      const after=r.at('lol');
      assert.ok(after.length>=2,`${mode}: asked again after the pause`);
      assert.ok(after[1]-hit>=BACKUP_PAUSE_S*1000&&after[1]-hit<=BACKUP_PAUSE_S*1000+6000,`${mode}: after ${after[1]-hit} ms`);
      assert.equal(lastData(r).source,'adsb.lol');
      live.stop();
    }finally{r.restore();}
  }
});

test('backup: adsb.lol at most once every 10 s; on wide maps at adsb.fi\'s slower interval',async()=>{
  for(const [cfg,gap] of [[CFG,10000],[{...CFG,pollSeconds:15,searchNm:120},15000]]){
    const r=fresh();
    try{
      r.feeds.fi={mode:'offline'};
      const live=r.live(cfg);
      await r.advance(10*60000);
      const lol=r.at('lol'),gaps=lol.slice(1).map((v,i)=>v-lol[i]);
      // adsb.fi's once-a-minute checks never pull adsb.lol closer than its floor.
      assert.ok(gaps.length>20&&Math.min(...gaps)===gap,`adsb.lol gaps ${Math.min(...gaps)}..${Math.max(...gaps)}`);
      assert.ok(r.at('fi').length>=6,'adsb.fi still checked');
      live.stop();
    }finally{r.restore();}
  }
});

test('backup: an adsb.lol 429 waits out its Retry-After (60 s at least), slows to 15 then 20 s, then pauses 15 minutes',async()=>{
  const r=fresh();
  try{
    r.feeds.fi={mode:'offline'};
    const live=r.live();
    await r.advance(30000);
    // A 429 with Retry-After 3 (what adsb.lol sent at a 5 s pace): 60 s, then one every 15 s.
    r.feeds.lol={mode:'s429',retryAfter:3};
    await r.advance(10000);
    const [first]=r.at('lol',30001); // the request answered with the 429
    r.feeds.lol={mode:'ok'};
    await r.advance(3*60000);
    let after=r.at('lol',first+1);
    assert.equal(after[0]-first,60000,`first request after the 429: ${after[0]-first} ms`);
    assert.ok(after.slice(1).map((v,i)=>v-after[i]).every(g=>g===15000),'then every 15 s');
    // A 429 with a longer Retry-After (120 s): that wait, then one every 20 s.
    r.feeds.lol={mode:'s429',retryAfter:120};
    await r.advance(16000);
    const second=r.at('lol').at(-1);
    r.feeds.lol={mode:'ok'};
    await r.advance(4*60000);
    after=r.at('lol',second+1);
    assert.equal(after[0]-second,120000,`after the second 429: ${after[0]-second} ms`);
    assert.ok(after.slice(1).map((v,i)=>v-after[i]).every(g=>g===20000),'then every 20 s');
    // A 429 at 20 s: the 15-minute pause.
    r.feeds.lol={mode:'s429',retryAfter:3};
    await r.advance(21000);
    const third=r.at('lol').at(-1);
    r.feeds.lol={mode:'ok'};
    await r.advance(14*60000);
    assert.equal(r.at('lol',third+1).length,0,'nothing during the 15 minutes');
    await r.advance(90000);
    after=r.at('lol',third+1);
    assert.ok(after[0]-third>=BACKUP_PAUSE_S*1000&&after[0]-third<=BACKUP_PAUSE_S*1000+21000,`after the pause: ${after[0]-third} ms`);
    assert.equal(after[1]-after[0],20000,'still one every 20 s');
    // adsb.fi back, and later down again: adsb.lol starts again at 10 s.
    r.feeds.fi={mode:'ok'};await r.advance(6*60000);
    assert.equal(lastData(r).source,'adsb.fi');
    r.feeds.fi={mode:'offline'};const t0=r.t;await r.advance(60000);
    const again=r.at('lol',t0);
    assert.ok(again.length>=3&&again.slice(1).map((v,i)=>v-again[i]).every(g=>g===10000),`10 s again: ${again}`);
    live.stop();
  }finally{r.restore();}
});

test('Retry-After sent as an HTTP date is waited out as its seconds (with the same limits as a number): adsb.fi and adsb.lol after a 429, and photo lookups',async()=>{
  const date=ms=>new Date(Date.now()+ms).toUTCString();
  // adsb.fi: a 429 asking for 2 minutes, as a date; then 10 minutes (adsb.fi waits at most 5); then a date gone by (the 60 s floor).
  for(const [ahead,gap] of [[120000,120000],[600000,300000],[-60000,60000]]){
    const r=fresh();
    try{
      r.feeds.fi={mode:'s429',get retryAfter(){return date(ahead);}};
      const live=r.live();
      await r.advance(1000);r.feeds.fi={mode:'ok'};
      await r.advance(400000);
      assert.equal(r.at('fi')[1],gap,`adsb.fi, Retry-After ${ahead/1000} s as a date: asked again at ${r.at('fi')[1]} ms`);
      live.stop();
    }finally{r.restore();}
  }
  // adsb.lol: a 429 asking for 2 minutes, as a date.
  const r=fresh();
  try{
    r.feeds.fi={mode:'offline'};
    const live=r.live();
    await r.advance(30000);
    r.feeds.lol={mode:'s429',get retryAfter(){return date(120000);}};
    await r.advance(10000);
    const [first]=r.at('lol',30001);
    r.feeds.lol={mode:'ok'};
    await r.advance(3*60000);
    assert.equal(r.at('lol',first+1)[0]-first,120000,'adsb.lol waits the 2 minutes');
    live.stop();
  }finally{r.restore();}
  // Planespotters: a 429 with a date 20 minutes ahead pauses lookups for those 20 minutes.
  const {photoFor}=await import('../web/photos.mjs');
  const real=globalThis.fetch;
  try{
    store.remove('whatsup.photos.pause');
    globalThis.fetch=async()=>({status:429,headers:{get:k=>k.toLowerCase()==='retry-after'?date(1200000):null},text:async()=>''});
    await photoFor({hex:'a1b2c3',registration:'N12345'});
    const until=store.get('whatsup.photos.pause')?.until-Date.now();
    assert.ok(Math.abs(until-1200000)<5000,`photo lookups paused ${Math.round(until/1000)} s`);
  }finally{globalThis.fetch=real;store.remove('whatsup.photos.pause');}
});

test('backup: the 15-minute pause is saved, so a relaunch within it doesn\'t ask adsb.lol either',async()=>{
  const saved=new Map();
  globalThis.localStorage={getItem:k=>saved.has(k)?saved.get(k):null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)};
  const r=fresh();
  try{
    r.feeds.fi={mode:'offline'};r.feeds.lol={mode:'s403'};
    let live=r.live();
    await r.advance(20000);
    const [hit]=r.at('lol');
    live.stop();r.feeds.lol={mode:'ok'};
    // The app is closed and opened again 2 minutes later: a new page, nothing in memory.
    await r.advance(120000);resetOutage();
    live=r.live();
    await r.advance(10*60000);
    assert.deepEqual(r.at('lol'),[hit],'no adsb.lol request within the saved pause');
    await r.advance(4*60000);
    assert.ok(r.at('lol').length>=2,'asked again when it ends');
    assert.ok(r.at('lol')[1]-hit>=BACKUP_PAUSE_S*1000&&r.at('lol')[1]-hit<=BACKUP_PAUSE_S*1000+6000,`after ${r.at('lol')[1]-hit} ms`);
    live.stop();
  }finally{r.restore();delete globalThis.localStorage;}
});

test('backup: adsb.fi checks respect its back-off and Retry-After; 15 s of failures switch over',async()=>{
  const r=fresh();
  try{
    // A 429 with Retry-After 120 on the first poll: adsb.lol after 15 s, not 2 minutes.
    r.feeds.fi={mode:'s429',retryAfter:120};
    const live=r.live();
    await r.advance(20000);
    assert.deepEqual(r.at('fi'),[0]);
    assert.equal(r.at('lol')[0],15000);
    assert.equal(lastData(r).source,'adsb.lol');
    // The next check waits out the Retry-After (not one minute)...
    r.feeds.fi={mode:'s404'};
    await r.advance(130000);
    assert.equal(r.at('fi')[1],120000);
    // ...and after a 404 (any other 4xx: 5 minutes), five minutes.
    await r.advance(5*60000);
    assert.deepEqual(r.at('fi'),[0,120000,420000]);
    // Network errors: about once a minute, until the doubling back-off is longer.
    r.feeds.fi={mode:'offline'};
    await r.advance(15*60000);
    const gaps=r.at('fi',420000).map((v,i,a)=>i?v-a[i-1]:null).slice(1);
    assert.ok(gaps.every(g=>g>=60000),`checks ${gaps}`);
    assert.ok(gaps.at(-1)>=300000,`back-off reached 5 min: ${gaps}`);
    // adsb.lol kept the planes up throughout.
    assert.ok(r.updates.filter(u=>u.ok&&u.source==='adsb.lol').length>100);
    assert.ok(!r.updates.some(u=>!u.ok&&u.t-T0>20000),'a failed check on adsb.fi changes nothing shown');
    live.stop();
  }finally{r.restore();}
});

test('backup: no 250 NM coverage check on adsb.lol, and no "no coverage" claim from it',async()=>{
  const r=fresh();
  try{
    r.feeds.fi={mode:'ok',body:{ac:[],now:T0,msg:'No error'}};r.feeds.lol={mode:'ok',body:{ac:[],now:T0,msg:'No error'}};
    // adsb.fi up and empty: its usual widest check (and the area really has no receivers).
    let live=r.live();
    await r.advance(3000);
    assert.equal(r.calls.filter(c=>/\/dist\/250$/.test(c.url)).length,1);
    assert.equal(r.updates.filter(u=>u.ok).at(-1).coverage.none,true);
    live.stop();
    // adsb.fi down, adsb.lol empty: no wide check anywhere, and only "quiet skies".
    r.feeds.fi={mode:'s503'};
    live=r.live();
    await r.advance(3*3600000);
    assert.equal(r.calls.filter(c=>/\/dist\/250$/.test(c.url)).length,1,'no widest check on the backup');
    const u=r.updates.filter(u=>u.ok&&u.source==='adsb.lol').at(-1);
    assert.equal(u.coverage.none,false);
    live.stop();
  }finally{r.restore();}
});

test('coverage: the 250 NM probe goes at most once every 2 h for a place, across feed restarts (map radius, alert radius or zone)',async()=>{
  const r=fresh(),probes=()=>r.calls.filter(c=>/\/dist\/250$/.test(c.url)).length;
  try{
    r.feeds.fi={mode:'ok',body:{ac:[],now:T0,msg:'No error'}}; // quiet skies, and no receivers in the widest area either
    let live=r.live();
    await r.advance(3000);
    assert.equal(probes(),1);
    for(const [searchNm,radiusMiles] of [[20,3],[30,3],[30,5],[15,1]]){live.stop();live=r.live({...CFG,searchNm,radiusMiles});await r.advance(3000);}
    assert.equal(probes(),1,'no probe on a restart within 2 h');
    assert.equal(r.updates.filter(u=>u.ok).at(-1).coverage.none,true,'its answer carries over');
    await r.advance(2*3600000);
    assert.equal(probes(),2,'asked again after 2 h');
    live.stop();live=r.live({...CFG,latitude:39.5,longitude:-84.2});await r.advance(3000);
    assert.equal(probes(),3,'a new place is asked once');
    live.stop();
  }finally{r.restore();}
});

test('backup: a restarted feed (new place or radius) stays on adsb.lol while adsb.fi is down',async()=>{
  const r=fresh();
  try{
    r.feeds.fi={mode:'timeout'};
    let live=r.live();
    await r.advance(30000);
    assert.equal(lastData(r).source,'adsb.lol');
    live.stop();
    const n=r.calls.length;live=r.live({...CFG,searchNm:30});
    await r.advance(11000);
    const next=r.calls.slice(n).filter(c=>c.which!=='route');
    assert.equal(next[0].which,'lol','the new feed asks adsb.lol first');
    assert.match(next[0].url,/\/lat\/39\.05\/lon\/-84\.65\/dist\/33$/);
    assert.equal(lastData(r).source,'adsb.lol');
    live.stop();
    // adsb.fi up: a restart asks adsb.fi at once, as before.
    resetOutage();r.feeds.fi={mode:'ok'};
    const m=r.calls.length;live=r.live();await r.advance(1000);
    assert.equal(r.calls.slice(m)[0].which,'fi');
    live.stop();
  }finally{r.restore();}
});

test('restart: a new map radius, alert radius or zone for the same place keeps the last picture until the next reply, and an outage\'s countdown with it',async()=>{
  const r=fresh(),models=[],place={...CVG,timeZone:'America/New_York'},push=m=>models.push(m);let s=null;
  try{
    s=start(place,CFG,push);
    await r.advance(6000);
    assert.ok(models.at(-1).fresh&&models.at(-1).planes.length===1,'live');
    for(const cfg of [{...CFG,searchNm:30},{...CFG,radiusMiles:5},{...CFG,zone:{kind:'window',from:90,to:180,miles:10}}]){
      s.stop();const n=models.length;s=start(place,cfg,push,null,s);
      const first=models[n];
      assert.ok(first?.fresh&&!first.connecting,`no "Connecting" on the restart (${JSON.stringify(cfg)}): ${first&&quietText(first,false)}`);
      assert.deepEqual(first.planes.map(a=>a.hex),['a1f1f1'],'the planes stay');
      await r.advance(1000);
      assert.ok(models.length>n+1&&models.at(-1).fresh,'then the next reply');
    }
    // Both feeds down: the restarted feed carries on with the outage line and its countdown.
    r.feeds.fi={mode:'s503'};r.feeds.lol={mode:'s403'};
    await r.advance(90000);
    const out=models.at(-1);
    assert.match(quietText(out,false),/^No live data right now\. Reconnecting in \d+ s\.$/);
    s.stop();const n=models.length;s=start(place,{...CFG,searchNm:30},push,null,s);
    assert.equal(models[n].connecting,false);assert.equal(models[n].fresh,false);
    assert.equal(models[n].retryAt,out.retryAt,'the same next poll');
    assert.match(quietText(models[n],false),/^No live data right now\. Reconnecting in \d+ s\.$/,'the outage line, not "Connecting"');
    // Another place starts afresh.
    s.stop();const k=models.length;s=start({...place,latitude:39.3,longitude:-84.3},CFG,push,null,s);
    assert.equal(models[k].connecting,true);assert.equal(models[k].planes.length,0);
  }finally{s?.stop();r.restore();}
});

test('backup: pause and resume keep the schedule; nothing is asked while hidden',async()=>{
  const r=fresh();
  try{
    r.feeds.fi={mode:'offline'};
    const live=r.live();
    await r.advance(20000);
    live.pause();const n=r.feedCalls().length;
    await r.advance(10*60000);
    assert.equal(r.feedCalls().length,n,'nothing asked while hidden');
    live.resume();await r.advance(100);
    // Back on screen after more than a minute: adsb.fi is checked first, then adsb.lol.
    const next=r.feedCalls().slice(n);
    assert.equal(next[0].which,'fi');
    await r.advance(6000);
    assert.equal(r.feedCalls().slice(n).filter(c=>c.which==='lol').length,1);
    live.stop();
  }finally{r.restore();}
});

// An hour in the background (Home, then back): nothing is asked meanwhile, and coming back
// asks once, at adsb.fi's pace, with no burst of timers that piled up while hidden.
const HOUR=3600000;
const gapsOf=ts=>ts.slice(1).map((v,i)=>v-ts[i]);
test('background: an hour hidden on adsb.fi, then back: one request at once, no burst, nothing from adsb.lol',async()=>{
  const r=fresh();
  try{
    const live=r.live();
    await r.advance(30000);
    live.pause();const n=r.feedCalls().length,back=r.t+HOUR;
    await r.advance(HOUR);
    assert.equal(r.feedCalls().length,n,'nothing asked while hidden');
    live.resume();await r.advance(100);
    assert.deepEqual(r.at('fi',back,back+100),[back],'adsb.fi asked once, at once');
    await r.advance(60000);
    const fi=r.at('fi',back);
    assert.ok(fi.length>=10&&gapsOf(fi).every(g=>g>=5000),`then every 5 s, never closer: ${gapsOf(fi)}`);
    assert.deepEqual(r.at('lol'),[],'adsb.lol never asked');
    assert.equal(lastData(r).source,'adsb.fi');
    live.stop();
  }finally{r.restore();}
});

test('background: an hour hidden on the backup, adsb.fi back meanwhile: adsb.fi is asked first and takes over',async()=>{
  const r=fresh();
  try{
    r.feeds.fi={mode:'offline'};
    const live=r.live();
    await r.advance(40000);
    assert.equal(lastData(r).source,'adsb.lol','on the backup before Home');
    live.pause();r.feeds.fi={mode:'ok'};const back=r.t+HOUR;
    await r.advance(HOUR);live.resume();await r.advance(60000);
    const next=r.feedCalls().filter(c=>c.t-T0>=back);
    assert.equal(next[0].which,'fi','adsb.fi first');
    assert.deepEqual(r.at('lol',back),[],'no adsb.lol request once adsb.fi answers');
    assert.equal(lastData(r).source,'adsb.fi');
    live.stop();
  }finally{r.restore();}
});

test('background: an hour hidden through the 15-minute adsb.lol pause: back on the backup at once if adsb.fi is still down',async()=>{
  const r=fresh();
  try{
    r.feeds.fi={mode:'offline'};r.feeds.lol={mode:'s403'};
    const live=r.live();
    await r.advance(60000);
    const hit=r.at('lol');assert.equal(hit.length,1,'one adsb.lol 403: paused');
    live.pause();r.feeds.lol={mode:'ok'};const back=r.t+HOUR;
    await r.advance(HOUR);live.resume();await r.advance(30000);
    const next=r.feedCalls().filter(c=>c.t-T0>=back);
    assert.equal(next[0].which,'fi','adsb.fi first');
    const lol=r.at('lol',back);
    assert.ok(lol.length&&lol[0]-back<=11000,`adsb.lol again within 11 s (the pause is over): ${lol[0]-back} ms`);
    assert.ok(gapsOf(lol).every(g=>g>=10000),`at its 10 s pace: ${gapsOf(lol)}`);
    assert.equal(lastData(r).source,'adsb.lol');
    live.stop();
  }finally{r.restore();}
});

test('background: back after an hour with both feeds down, the hour-old planes are not shown as live',async()=>{
  const r=fresh();const models=[];
  try{
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    await r.advance(30000);
    assert.ok(models.at(-1).fresh&&models.at(-1).planes.length===1,'live before Home');
    s.pause();r.feeds.fi={mode:'offline'};r.feeds.lol={mode:'offline'};
    await r.advance(HOUR);const from=models.length;
    s.resume();await r.advance(20000);
    const after=models.slice(from);
    assert.ok(after.length,'the screen is updated on return');
    assert.ok(after.every(m=>!m.fresh&&!m.planes.length),`no planes from an hour ago: ${after.map(m=>m.planes.length)}`);
    assert.match(quietText(after.at(-1),false),/^No live data right now\. Reconnecting in \d+ s\.$/);
    s.stop();
  }finally{r.restore();}
});

// A feed restarted while the app is hidden (a radius step, an alert change or a place refined just
// before Home) starts paused: nothing goes out, routes and the coverage check included, until it is shown.
test('background: a feed started while the app is hidden asks nothing until it is shown, then adsb.fi at once',async()=>{
  const r=fresh(),models=[];
  try{
    const live=r.live({...CFG,paused:true});
    await r.advance(60000);
    assert.deepEqual(r.calls,[],'nothing asked while hidden');
    live.resume();await r.advance(100);
    assert.deepEqual(r.at('fi'),[60000],'adsb.fi asked once, at once, when shown');
    await r.advance(20000);
    assert.ok(gapsOf(r.at('fi')).every(g=>g>=5000),`then every 5 s: ${gapsOf(r.at('fi'))}`);
    live.stop();
    const s=start({...CVG,timeZone:'America/New_York'},{...CFG,paused:true},m=>models.push(m)),n=r.calls.length;
    await r.advance(60000);
    assert.equal(r.calls.length,n,'nor through the model');
    assert.ok(models.length&&models.every(m=>m.connecting),'the screen waits on "Connecting"');
    s.resume();await r.advance(100);
    assert.equal(r.feedCalls().length,r.at('fi').length);assert.ok(models.at(-1).fresh,'live once shown');
    s.stop();
  }finally{r.restore();}
});

// The last picture kept through a failure is re-judged 60 s after the last good reply: not while
// the app is hidden (nothing is drawn then), but on return, even when no poll is due.
test('background: the last picture is not re-judged while the app is hidden, and is on return',async()=>{
  const r=fresh(),models=[],place={...CVG,timeZone:'America/New_York'},push=m=>models.push({...m,at:r.t});
  try{
    for(const away of [90000,20000]){
      resetOutage();store.remove(LEDGER_KEY);r.feeds.fi={mode:'ok'};r.feeds.lol={mode:'ok'};
      const t0=r.t,s=start(place,CFG,push);
      await r.advance(6000); // good replies at 0 and 5 s
      r.feeds.fi={mode:'s404'};r.feeds.lol={mode:'s404'};
      await r.advance(24000); // adsb.fi 404 at 10 s, adsb.lol 404 at 25 s: the next poll minutes away
      assert.ok(models.at(-1).fresh,'the last picture stays');
      s.pause();const n=models.length;
      await r.advance(away);
      assert.equal(models.length,n,`nothing drawn while hidden (${away} ms)`);
      s.resume();await r.advance(100);
      if(away>40000)assert.ok(models.length>n&&!models.at(-1).fresh,'past 60 s: re-judged on return');
      else{
        assert.ok(models.at(-1).fresh,'back within the minute: still the last picture');
        await r.advance(t0+66000-r.t);
        assert.ok(!models.at(-1).fresh&&!models.at(-1).planes.length,`re-judged 60 s after the last good reply: ${models.at(-1).at-t0}`);
      }
      assert.match(quietText(models.at(-1),false),/^No live data right now\. Reconnecting in \d+ (s|min)\.$/);
      s.stop();
    }
    // A feed restarted while hidden (same place, last picture carried) doesn't re-judge it either.
    resetOutage();store.remove(LEDGER_KEY);r.feeds.fi={mode:'ok'};r.feeds.lol={mode:'ok'};
    let s=start(place,CFG,push);await r.advance(6000);
    r.feeds.fi={mode:'s404'};r.feeds.lol={mode:'s404'};await r.advance(24000);
    s.pause();s.stop();s=start(place,{...CFG,searchNm:30,paused:true},push,null,s);const n=models.length;
    await r.advance(120000);
    assert.equal(models.length,n,'nothing drawn while hidden after a restart');
    s.resume();await r.advance(100);
    assert.ok(!models.at(-1).fresh,'re-judged on return');
    s.stop();
  }finally{r.restore();}
});

// adsb.fi's back-off is kept across a feed restart (Up/Down, an alert change, Adjust position, a new
// place): adsb.fi limits the TV, not one query. A failure that lands after the restart counts too.
test('restart: within 15 s of an adsb.fi failure a restart keeps its back-off and Retry-After, and adsb.lol still takes over by the 15 s mark',async()=>{
  for(const [name,fi,retry] of [['429, Retry-After 120 s',{mode:'s429',retryAfter:120},125000],['503',{mode:'s503'},10000]]){
    const r=fresh();
    try{
      let live=r.live();
      await r.advance(4000);r.feeds.fi=fi; // good at 0, then the failure at 5 s
      await r.advance(3000);live.stop();live=r.live(); // restarted 2 s after it
      await r.advance(60000);
      assert.deepEqual(r.at('fi',5001,retry-1),[],`${name}: adsb.fi not asked again before ${retry/1000} s`);
      assert.ok(r.at('lol')[0]<=20000,`${name}: adsb.lol by 15 s after the failure: ${r.at('lol')}`);
      live.stop();
    }finally{r.restore();}
  }
  // adsb.fi hanging, a restart every 3 s (each before the 4.5 s timeout): the stopped feeds' timeouts
  // still count, so adsb.lol takes over instead of adsb.fi being asked again on every restart.
  const r=fresh();
  try{
    r.feeds.fi={mode:'timeout'};
    let live=r.live();
    for(let i=0;i<20;i++){await r.advance(3000);live.stop();live=r.live();}
    assert.ok(r.at('fi').length<=3,`adsb.fi asked ${r.at('fi').length} times in 60 s`);
    assert.ok(r.at('lol')[0]<=15000,`adsb.lol asked by 15 s: ${r.at('lol')}`);
    assert.equal(lastData(r).source,'adsb.lol');
    live.stop();
    // Hidden while a request is out: its failure counts, so the return doesn't ask adsb.fi inside its back-off.
    resetOutage();r.feeds.fi={mode:'ok'};live=r.live();await r.advance(1000);
    r.feeds.fi={mode:'timeout'};const t=r.t;await r.advance(5000);live.pause(); // asked at +4 s, times out hidden
    await r.advance(5000);live.resume();await r.advance(2000);
    assert.deepEqual(r.at('fi',t+4001,t+12000),[],`not asked again on return: ${r.at('fi',t)}`);
    live.stop();
  }finally{r.restore();}
});

// A stopped feed's hung adsb.fi request times out after the restarted feed's requests have succeeded:
// that stale failure is no outage (adsb.fi is answering), so adsb.lol is never asked and adsb.fi keeps
// its cadence (it moved to adsb.lol for about a minute).
test('restart: a hung adsb.fi request that times out after a newer one succeeded is no failure (no adsb.lol, adsb.fi at its cadence)',async()=>{
  const r=fresh(),W={...CFG,pollSeconds:10,searchNm:250}; // a wide map: 10 s polls, 12 s to answer
  try{
    let live=r.live(W);
    await r.advance(9900);r.feeds.fi={mode:'timeout'}; // good at 0; the poll at 10 s hangs
    await r.advance(700);live.stop();r.feeds.fi={mode:'ok'};live=r.live(W); // Up/Down 0.6 s later: the new feed asks at 11 s
    await r.advance(60000); // the hung request times out at 22 s, after the new feed's good replies at 11 and 21 s
    assert.deepEqual(r.at('fi'),[0,10000,11000,21000,31000,41000,51000,61000],`adsb.fi at its cadence: ${r.at('fi')}`);
    assert.deepEqual(r.at('lol'),[],'adsb.lol never asked');
    assert.equal(outage.down,false);assert.equal(outage.fails,0);
    assert.equal(lastData(r).source,'adsb.fi');
    live.stop();
  }finally{r.restore();}
});

// adsb.fi asks for at most 1 request a second: a feed restart waits for it too (the new radius's
// planes come up to a second later).
test('restart: adsb.fi is never asked within a second of the last request (a step just after a poll, steps every 0.8 s, a restart shown again at once)',async()=>{
  const r=fresh();
  try{
    let live=r.live();
    await r.advance(5300);live.stop();live=r.live(); // 0.3 s after the poll at 5 s
    await r.advance(2000);
    assert.deepEqual(r.at('fi'),[0,5000,6000]);
    for(let i=0;i<6;i++){await r.advance(800);live.stop();live=r.live();}
    await r.advance(3000);
    assert.ok(gapsOf(r.at('fi')).every(g=>g>=1000),`adsb.fi gaps: ${gapsOf(r.at('fi'))}`);
    assert.ok(r.at('fi').length>=8,'each step still asks for its radius');
    // Restarted just before Home 0.3 s after a poll, shown again 0.2 s later: the first poll waits for the second.
    const n=r.at('fi').length;while(r.at('fi').length===n)await r.advance(100); // the next poll goes
    const last=r.at('fi').at(-1);await r.advance(300);live.stop();live=r.live({...CFG,paused:true});
    await r.advance(200);live.resume();await r.advance(2000);
    assert.deepEqual(r.at('fi',last+1),[last+1000],`shown again 0.5 s after the last request: asked at ${r.at('fi',last+1)}`);
    live.stop();
  }finally{r.restore();}
});

// A poll with neither feed allowed yet (both in their back-offs) still tells the screen when the
// next one goes: a new feed starts on the outage line with its countdown, not "Connecting", and a
// carried or captured time that has passed is replaced by this feed's own next poll.
test('outage: a poll skipped in a known outage counts down to the next one (a new place, a restart over a check, the 60 s re-judge)',async()=>{
  const counting=m=>/^No live data right now\. Reconnecting in \d+ (s|min)\.$/.test(quietText(m,false))&&retryIn(m.retryAt)>0;
  const place={...CVG,timeZone:'America/New_York'},near={...place,latitude:39.07};
  let r=fresh(),models=[],s=null;const push=m=>models.push({...m,at:r.t});
  try{
    s=start(place,CFG,push);await r.advance(6000);
    r.feeds.fi={mode:'s503'};r.feeds.lol={mode:'s403'};
    await r.advance(90000); // both known down: adsb.fi checked again at 135 s, adsb.lol paused 15 min
    // Adjust position (or a new place nearby): its first poll can't ask either feed.
    s.stop();const k=models.length;s=start(near,CFG,push,null,s);
    await r.advance(1100);
    const m=models.at(-1);
    assert.ok(models.length>k+1&&!m.connecting&&counting(m),`new place: ${quietText(m,false)} (${retryIn(m.retryAt)} s)`);
    assert.equal(r.feedCalls().filter(c=>c.t-T0>96000).length,0,'nothing asked for it');
    // A same-place restart while the adsb.fi check is out: the carried time (that check) has passed.
    r.feeds.fi={mode:'timeout'};await r.advance(135500-r.t);
    assert.deepEqual(r.at('fi',130000),[135000],'the check is out');
    s.stop();s=start(near,{...CFG,radiusMiles:5},push,null,s);
    await r.advance(1100);
    assert.ok(counting(models.at(-1)),`restart over a check: ${quietText(models.at(-1),false)} (${retryIn(models.at(-1).retryAt)} s)`);
    s.stop();
  }finally{r.restore();}
  // adsb.lol paused (600 s), adsb.fi good twice then a 429 (Retry-After 120 s): the poll at the 15 s
  // mark can ask neither, and the re-judge 60 s after the last good reply must still count down.
  r=fresh();models=[];
  try{
    outage.backupRetryAt=600000;
    s=start(place,CFG,push);await r.advance(6000);
    r.feeds.fi={mode:'s429',retryAfter:120};
    await r.advance(60000); // 429 at 10 s; skipped at 25 s; re-judged at 65 s
    const m=models.at(-1);
    assert.ok(!m.fresh&&counting(m),`re-judged: ${quietText(m,false)} (${retryIn(m.retryAt)} s)`);
    assert.equal(m.retryAt,130000,'the next adsb.fi check, after its Retry-After');
    s.stop();
  }finally{r.restore();}
});

// adsb.fi down, adsb.lol delivering: a new place (or Adjust position) whose first poll falls inside
// adsb.lol's 10 s spacing waits on "Connecting to the live feed" until its turn, not on the outage line.
test('outage: a new place while adsb.lol stands in waits out its spacing on "Connecting", never the outage line',async()=>{
  const r=fresh(),models=[],place={...CVG,timeZone:'America/New_York'},push=m=>models.push({...m,at:r.t});let s=null;
  try{
    r.feeds.fi={mode:'s503'};
    s=start(place,CFG,push);await r.advance(30000);
    assert.equal(models.at(-1).source,'adsb.lol');
    await r.advance(r.at('lol').at(-1)+2000-r.t); // 2 s after an adsb.lol request: its next turn 8 s away
    s.stop();const k=models.length;s=start({...place,latitude:39.5,longitude:-84.2},CFG,push,null,s);
    await r.advance(1500);
    const texts=models.slice(k).map(m=>quietText(m,false));
    assert.ok(texts.length&&texts.every(x=>x==='Connecting to the live feed'),`new place: ${texts}`);
    await r.advance(12000);
    const m=models.at(-1);
    assert.ok(m.fresh&&m.source==='adsb.lol'&&m.planes.length===1,`then adsb.lol's planes: ${quietText(m,false)}`);
    assert.ok(!models.slice(k).some(m=>/No live data/.test(quietText(m,false))),'never the outage line');
    s.stop();
  }finally{r.restore();}
});

// Storage as the page sees it: `saved` holds what is stored; setItem throws when `full`.
function withStorage(saved,full=false){
  const had=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  globalThis.localStorage={getItem:k=>saved.has(k)?saved.get(k):null,removeItem:k=>saved.delete(k),
    setItem:(k,v)=>{if(full){const e=new Error('The quota has been exceeded.');e.name='QuotaExceededError';throw e;}saved.set(k,String(v));}};
  return ()=>{if(had)Object.defineProperty(globalThis,'localStorage',had);else delete globalThis.localStorage;};
}

test('storage full: the backup, its 15-minute pause and today\'s log carry on for this launch, and nothing throws',async()=>{
  const r=fresh();const models=[],saved=new Map(),unset=withStorage(saved,true),said=[],err=console.error;
  console.error=(...a)=>said.push(a.join(' '));
  try{
    r.feeds.fi={mode:'offline'};r.feeds.lol={mode:'s403'};
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    await r.advance(60000);
    assert.equal(r.at('lol').length,1,'one adsb.lol 403');
    r.feeds.lol={mode:'ok'};
    await r.advance(10*60000);
    assert.equal(r.at('lol').length,1,'the pause holds, kept in memory');
    await r.advance(6*60000);
    assert.ok(r.at('lol').length>=2,'asked again after the pause');
    const m=models.at(-1);
    assert.equal(m.source,'adsb.lol');assert.ok(m.fresh&&m.planes.length===1,'its planes on screen');
    assert.equal(m.log.today,1,'today\'s log counts the plane');
    assert.equal(saved.size,0,'nothing could be stored');
    assert.ok(said.length&&said.every(x=>/not saved: storage full/.test(x)),`only the storage-full note is logged: ${said.slice(0,2)}`);
    s.stop();
  }finally{r.restore();unset();console.error=err;}
});

// tests/fixtures/storage-4e866d1.json: what the build on the TV (4e866d1) saved at CVG after
// adsb.fi went down: a plane logged today, its route answer, and a 15-minute adsb.lol pause
// that started at 05:02:10 UTC.
test('upgrade from the TV build (4e866d1): its saved adsb.lol pause, route answers and today\'s log carry over',async()=>{
  const {storage}=JSON.parse(readFileSync(new URL('./fixtures/storage-4e866d1.json',import.meta.url),'utf8'));
  const t0=Date.parse('2026-11-03T05:05:00Z'),end=Date.parse('2026-11-03T05:17:10Z')-t0; // relaunched 3 minutes later
  const r=fresh(t0);const models=[],unset=withStorage(new Map(Object.entries(storage)));
  try{
    r.feeds.fi={mode:'offline'};r.feeds.lol={mode:'ok'};
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    await r.advance(end-1000);
    assert.deepEqual(r.at('lol'),[],'no adsb.lol positions within the pause the TV build saved');
    await r.advance(30000);
    const lol=r.at('lol');
    assert.ok(lol.length>=2&&lol[0]>=end-1000,`asked once it is over (first at +${lol[0]} ms)`);
    const m=models.at(-1);
    assert.equal(m.source,'adsb.lol');assert.ok(m.fresh&&m.planes.length===1);
    assert.equal(m.log.today,1,'the plane the TV build logged today counts once');
    assert.equal(r.calls.filter(c=>c.which==='route').length,0,'its saved route answer is used, not asked again');
    s.stop();
  }finally{r.restore();unset();}
});

test('backup: an adsb.lol reply with missing, null, wrong-type, extra or out-of-range fields: bad aircraft left out, the rest shown with sane values',async()=>{
  const r=fresh();const models=[];
  try{
    const ok=plane('a10101','LOL202'),drop=[
      plane('b00001','BAD1',{lat:200}),plane('b00002','BAD2',{lat:null}),plane('b00003','BAD3',{lon:undefined}),
      plane('b00004','BAD4',{alt_baro:'ground'}),plane('b00005','BAD5',{alt_baro:99999}),plane('b00006','BAD6',{hex:'zzzzzz'}),
      plane('b00007','BAD7',{hex:undefined}),plane('b00008','BAD8',{seen_pos:-3})];
    const odd=[plane('a20202','ODD2',{gs:1e9,track:'x'}),
      // Wrong types where text or numbers belong; extra keys, including ones named like Object's own.
      plane('a30303','ODD3',{r:{x:1},t:42,flight:12345,squawk:7700,emergency:{},dbFlags:'x',baro_rate:'x',year:1e12,extra:[1,2],constructor:'x'}),
      plane('a40404','ODD4',{r:12345,squawk:'constructor',emergency:'constructor',category:{}})];
    r.feeds.fi={mode:'offline'};r.feeds.lol={mode:'ok',body:{ac:[ok,...drop,...odd,null,'x',7],msg:'No error',now:0,total:13}};
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    for(let t=0;t<40000;t+=5000){r.feeds.lol.body.now=Date.now();await r.advance(5000);}
    const m=models.filter(x=>x.fresh&&x.source==='adsb.lol').at(-1);
    assert.ok(m,'adsb.lol data on screen');
    assert.deepEqual(m.planes.map(a=>a.hex).sort(),['a10101','a20202','a30303','a40404'],'only the aircraft with a usable position');
    for(const a of m.planes){
      for(const k of ['flight','registration','type','operator','squawk','emergency','year'])
        assert.ok(typeof a[k]==='string'&&!/\[object|NaN|undefined/.test(a[k]),`${a.hex} ${k}: ${JSON.stringify(a[k])}`);
      for(const k of ['altitude_ft','speed_kt','heading','vertical','distance_mi'])
        assert.ok(a[k]===null||Number.isFinite(a[k]),`${a.hex} ${k}: ${a[k]}`);
    }
    const p=Object.fromEntries(m.planes.map(a=>[a.hex,a]));
    assert.equal(p.a20202.speed_kt,null,'an impossible speed is no reading');assert.equal(p.a20202.heading,null);
    assert.equal(p.a30303.squawk,'7700','a number squawk reads as its digits');assert.equal(p.a30303.emergency,'EMERGENCY');assert.equal(p.a30303.year,'');
    assert.equal(p.a40404.emergency,'','"constructor" is no emergency');
    s.stop();
  }finally{r.restore();}
});

test('backup: a huge adsb.lol reply (5,000 aircraft, about 1 MB) is cut to the nearest 300, quickly',async()=>{
  const r=fresh();const models=[];
  try{
    const ac=Array.from({length:5000},(_,i)=>plane((0xa00000+i).toString(16),`HUGE${i}`,{lat:39.05+(i%100)*0.004,lon:-84.65+Math.floor(i/100)*0.004}));
    r.feeds.fi={mode:'offline'};r.feeds.lol={mode:'ok',body:{ac,msg:'No error',now:0,total:5000}};
    assert.ok(JSON.stringify(r.feeds.lol.body).length>9e5,'a reply of about 1 MB');
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    let worst=0;
    for(let t=0;t<40000;t+=5000){r.feeds.lol.body.now=Date.now();const t0=r.cpu();await r.advance(5000);worst=Math.max(worst,r.cpu()-t0);}
    const m=models.filter(x=>x.fresh&&x.source==='adsb.lol').at(-1);
    assert.ok(m,'adsb.lol data on screen');
    assert.equal(m.planes.length,300,'the nearest 300');
    assert.ok(m.planes.every((a,i,all)=>!i||all[i-1].distance_mi<=a.distance_mi),'nearest first');
    assert.ok(worst<2000,`each 5 s of feed handled in under 2 s on this Mac (worst ${Math.round(worst)} ms)`);
    s.stop();
  }finally{r.restore();}
});

test('backup: field mapping from adsb.lol v2 to what the app reads from adsb.fi',()=>{
  // Shaped like a real api.adsb.lol/v2 reply (3 November 2026).
  const row={hex:'a513b9',type:'adsb_icao',flight:'UPS1443 ',r:'N426UP',t:'B752',alt_baro:20000,alt_geom:20850,gs:389.8,
    track:234.92,baro_rate:0,geom_rate:64,squawk:'4575',emergency:'none',category:'A4',nav_qnh:1012.8,nav_altitude_mcp:6016,
    nav_heading:243.28,nav_modes:['vnav','tcas'],lat:39.110413,lon:-84.758626,nic:8,rc:186,seen_pos:0.11,version:2,nic_baro:1,
    nac_p:10,nac_v:1,sil:3,sil_type:'perhour',gva:2,sda:2,alert:0,spi:0,mlat:[],tisb:[],messages:16399,seen:0.1,rssi:-10.6,dst:6.221,dir:305.7};
  const mil={hex:'ae1234',flight:'RCH401  ',r:'05-5140',t:'C17',alt_baro:12000,gs:330,track:40,lat:39.0,lon:-84.6,seen_pos:1.2,seen:0.5,dbFlags:1,
    lastPosition:{lat:1,lon:2}};
  const out=fromBackup({ac:[row,mil,null,'x'],msg:'No error',now:1793680938000,total:2,ctime:1793680938000,ptime:0});
  assert.equal(out.now,1793680938000);
  assert.deepEqual(Object.keys(out.ac[0]).sort(),['alt_baro','baro_rate','category','emergency','flight','geom_rate','gs','hex','lat','lon','r','seen','seen_pos','squawk','t','track']);
  assert.deepEqual(out.ac[0],{hex:'a513b9',flight:'UPS1443 ',r:'N426UP',t:'B752',category:'A4',lat:39.110413,lon:-84.758626,
    alt_baro:20000,gs:389.8,track:234.92,baro_rate:0,geom_rate:64,squawk:'4575',emergency:'none',seen:0.1,seen_pos:0.11});
  assert.equal(out.ac[1].dbFlags,1,'military flag kept');assert.equal(out.ac[1].lastPosition,undefined);
  assert.equal(out.ac.length,2,'non-objects dropped');
  // Not a feed reply: no aircraft list, a list itself, nothing.
  for(const bad of [{msg:'No error',now:1},[],null,'text',{ac:'x'}])assert.equal(fromBackup(bad),null);
  // `now`: milliseconds in both feeds (feedStamp also takes seconds).
  assert.equal(feedStamp({now:1793680938000}),1793680938);assert.equal(feedStamp({now:1793680938}),1793680938);
});

test('backup: an adsb.lol plane reads like an adsb.fi one on the dashboard (military, emergency, climb)',async()=>{
  const r=fresh();const models=[];
  try{
    r.feeds.fi={mode:'offline'};
    r.feeds.lol={mode:'ok',body:{now:T0,msg:'No error',ac:[
      plane('ae1234','RCH401',{t:'C17',dbFlags:1,baro_rate:1200}),
      plane('a20202','DAL1213',{squawk:'7700',lat:39.06,rssi:-3,nav_qnh:1013}),
      {...plane('a30303','SWA1',{}),alt_baro:'ground'}]}};
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    // Keep the feed clock in step with the simulated one.
    for(let i=0;i<5;i++){r.feeds.lol.body.now=Date.now();await r.advance(5000);}
    const m=models.filter(m=>m.fresh).at(-1);
    assert.equal(m.source,'adsb.lol');
    const by=Object.fromEntries(m.planes.map(a=>[a.hex,a]));
    assert.equal(by.ae1234.military,true);assert.equal(by.ae1234.vertical,1200);assert.equal(by.ae1234.flight,'RCH401');
    assert.equal(by.a20202.emergency,'EMERGENCY');assert.equal(m.hero.hex,'a20202');
    assert.equal(by.a30303,undefined,'on the ground: not drawn, as with adsb.fi');
    assert.equal(by.ae1234.year,'','no build year from adsb.lol');
    s.stop();
  }finally{r.restore();}
});

test('backup: feed-clock skew is measured with each feed, in ms or s',async()=>{
  for(const feed of ['fi','lol'])for(const seconds of [false,true])for(const off of [-60000,60000,-3*86400000,3*86400000]){
    const r=fresh();
    try{
      if(feed==='lol')r.feeds.fi={mode:'s503'};
      r.feeds[feed]={mode:'ok',nowShiftMs:off,seconds,body:null};
      const live=r.live();
      await r.advance(30000);
      const u=lastData(r);
      assert.equal(u.source,feed==='fi'?'adsb.fi':'adsb.lol');
      assert.ok(Math.abs(u.skew*1000-off)<1000,`${feed} ${seconds?'s':'ms'} ${off}: skew ${u.skew}`);
      assert.deepEqual(u.hexes,[feed==='fi'?'a1f1f1':'a10101']);
      assert.equal(u.states[IDS.candidate].state,feed==='fi'?'a1f1f1':'a10101',`${feed}: plane kept with the feed ${off>0?'ahead':'behind'}`);
      live.stop();
    }finally{r.restore();}
  }
});

test('backup: a reply that isn\'t a feed counts as a failure, from either service',async()=>{
  for(const mode of ['garbage','portal','empty','nolist']){
    const r=fresh();
    try{
      r.feeds.fi={mode};
      const live=r.live();
      await r.advance(20000);
      assert.equal(r.at('fi').length,2,`${mode}: two tries on adsb.fi`);
      assert.equal(lastData(r)?.source,'adsb.lol',`${mode}: then adsb.lol`);
      // The same from adsb.lol: no planes, and it backs off.
      r.feeds.lol={mode};const n=r.at('lol').length;
      await r.advance(60000);
      assert.equal(lastData(r).t-T0<=20000,true,`${mode}: nothing new shown from a bad adsb.lol reply`);
      // From the last good one: the next request 10 s on, then back-offs of 10 (the floor), 10, 20 s.
      const lol=r.at('lol').slice(n-1),gaps=lol.slice(1).map((v,i)=>v-lol[i]);
      assert.deepEqual(gaps.slice(0,4),[10000,10000,10000,20000],`${mode}: adsb.lol backs off ${gaps}`);
      live.stop();
    }finally{r.restore();}
  }
});

test('backup: a damaged saved pause (not a number, or years ahead) never keeps adsb.lol off for more than 15 minutes',async()=>{
  for(const row of [{expires:Date.parse('2040-01-01')/1000,value:'soon'},{expires:Date.parse('2040-01-01')/1000,value:Date.parse('2040-01-01')/1000},
    {expires:Date.parse('2040-01-01')/1000,value:{x:1}},{expires:Date.parse('2040-01-01')/1000,value:null}]){
    const r=fresh();
    try{
      store.set(LEDGER_KEY,{'cooldown:adsblol-positions':row});
      r.feeds.fi={mode:'offline'};
      const live=r.live();
      await r.advance(BACKUP_PAUSE_S*1000+60000);
      assert.ok(r.at('lol').length>=1,`adsb.lol asked despite ${JSON.stringify(row.value)}`);
      assert.ok(r.at('lol')[0]<=BACKUP_PAUSE_S*1000+30000,`first adsb.lol request at ${r.at('lol')[0]} ms`);
      live.stop();
    }finally{r.restore();}
  }
});

test('backup: the same aircraft from either feed counts once (today, cargo, military, recent) and rings the chime once',async()=>{
  const r=fresh();const models=[];
  try{
    // A military C-17 and an Amazon 767 (ATN, owner only from adsb.fi) inside the 3 mi zone.
    const ac=fromLol=>[plane('ae1234','RCH401',{t:'C17',dbFlags:1,lat:39.06}),
      plane('a8f0a3','ATN3417',{t:'B763',lat:39.055,...(fromLol?{}:{ownOp:'AMAZON.COM SERVICES LLC'})})];
    const body=fromLol=>({now:Date.now(),msg:'No error',ac:ac(fromLol)});
    r.feeds.fi={mode:'ok',body:body(false)};r.feeds.lol={mode:'ok',body:body(true)};
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    const step=async(ms)=>{for(let t=0;t<ms;t+=5000){for(const f of [r.feeds.fi,r.feeds.lol])if(f.body)f.body.now=Date.now();await r.advance(5000);}};
    await step(30000);                                  // adsb.fi
    r.feeds.fi={mode:'offline'};await step(90000);      // adsb.lol stands in
    r.feeds.fi={mode:'ok',body:body(false)};await step(120000); // adsb.fi back
    const sources=new Set(models.filter(m=>m.fresh).map(m=>m.source));
    assert.deepEqual([...sources].sort(),['adsb.fi','adsb.lol'],'both feeds were used');
    const last=models.filter(m=>m.fresh).at(-1);
    assert.equal(last.log.today,2,'two aircraft seen today, not four');
    assert.equal(last.log.militaryToday,1,'one military aircraft');
    assert.deepEqual(last.log.cargoBy,[['Amazon',1]],'one cargo flight, Amazon');
    assert.equal(new Set(last.recent.map(a=>a.hex)).size,last.recent.length,'no duplicate recent sightings');
    let state=null,rings=0;
    for(const m of models){const g=chimeGate(state,m.planes.filter(a=>a.inside).length,m.now,m.live&&m.fresh);state=g.state;if(g.ring)rings++;}
    assert.equal(rings,0,'no chime for planes already in the zone when the feed changed');
    s.stop();
  }finally{r.restore();}
});

test('backup: midnight on adsb.lol starts the new day once, by the feed\'s clock',async()=>{
  const r=fresh(Date.parse('2026-11-03T04:57:00Z'));const models=[];
  try{
    // From 23:57 EST on 2 November (04:57 UTC on 3 November), adsb.fi down all along.
    r.feeds.fi={mode:'offline'};r.feeds.lol={mode:'ok',body:{now:0,msg:'No error',ac:[plane('a10101','LOL202')]}};
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    for(let t=0;t<6*60000;t+=5000){r.feeds.lol.body.now=Date.now();await r.advance(5000);}
    const fresh=models.filter(m=>m.fresh&&m.source==='adsb.lol');
    assert.ok(fresh.length>10,'adsb.lol data throughout');
    assert.ok(fresh.every(m=>m.log&&m.log.today===1),`one plane seen on each side of midnight, never 0 or 2 on screen: ${fresh.map(m=>m.log?.today).join(',')}`);
    s.stop();
  }finally{r.restore();}
});

test('feed etiquette: back-off on errors, 429 at least 60 s, other 4xx 5 min, with adsb.lol standing in',async()=>{
  const r=fresh();
  try{
    // adsb.fi: 503, 503, 503, 429 (Retry-After 120), 404, then good; adsb.lol good throughout.
    const script=[{mode:'s503'},{mode:'s503'},{mode:'s503'},{mode:'s429',retryAfter:120},{mode:'s404'},{mode:'ok'}];
    let i=0;const next=()=>{r.feeds.fi=script[Math.min(i++,script.length-1)];};
    next();
    const real=globalThis.fetch;
    globalThis.fetch=(url,opts)=>{const p=real(url,opts);if(FI.test(String(url)))p.finally(next);return p;};
    const live=r.live();
    await r.advance(20*60000);
    const fi=r.at('fi'),gaps=fi.slice(1).map((v,k)=>v-fi[k]);
    // 5 s back-off; then the backup, checking adsb.fi once a minute (its 10 s and 20 s
    // back-offs are shorter), then the 429's 120 s, then the 404's 5 minutes; then every 5 s.
    assert.equal(gaps[0],5000);
    assert.ok(gaps[1]>=60000&&gaps[1]<=65000&&gaps[2]>=60000&&gaps[2]<=65000,`once a minute: ${gaps}`);
    assert.ok(gaps[3]>=120000&&gaps[3]<=125000,`429 honours Retry-After: ${gaps[3]}`);
    assert.ok(gaps[4]>=300000&&gaps[4]<=305000,`other 4xx waits 5 min: ${gaps[4]}`);
    assert.ok(gaps.slice(5).every(g=>g===5000),'then every 5 s');
    assert.equal(lastData(r).source,'adsb.fi');
    // Pause and resume: nothing while hidden; after a good reply, resume polls at once.
    live.pause();const before=r.feedCalls().length;
    await r.advance(60000);
    assert.equal(r.feedCalls().length,before,'nothing is polled while paused');
    live.resume();await r.advance(10);
    assert.equal(r.feedCalls().length,before+1,'after a good reply, resume polls at once');
    // A 429 then pause/resume: resume keeps the 429 pause (adsb.fi isn't asked before it ends).
    script.push({mode:'s429',retryAfter:120},{mode:'s429',retryAfter:120});i=script.length-2;next();
    await r.advance(5000);
    const n=r.at('fi').length,hit=r.at('fi').at(-1);
    live.pause();await r.advance(1000);live.resume();await r.advance(30000);
    assert.equal(r.at('fi').length,n,'resume keeps the 429 pause');
    assert.ok(r.at('lol',hit).length>=1,'adsb.lol stands in after 15 s');
    live.stop();
  }finally{r.restore();}
});

test('feed: an update that throws (a damaged saved value) is logged and never stops the polling',async()=>{
  const r=fresh(),err=console.error,said=[];
  console.error=(...a)=>said.push(a.map(String).join(' '));
  try{
    let calls=0;
    const live=startLive(()=>{calls++;throw new TypeError('n.split is not a function');},CFG);
    await r.advance(30000);
    assert.ok(r.at('fi').length>=6,`adsb.fi polled every 5 s: ${r.at('fi')}`);
    const logged=said.filter(t=>/^feed update TypeError/.test(t)).length;
    assert.ok(calls>=7&&logged===calls,`each throw logged: ${calls} updates, ${logged} logged`);
    r.feeds.fi={mode:'s503'};r.feeds.lol={mode:'s503'};
    await r.advance(60000);
    assert.ok(r.at('lol').length>=1,'failures handled as usual: over to adsb.lol');
    live.stop();
  }finally{console.error=err;r.restore();}
});

test('feed: a saved route row with no value (damaged storage) doesn\'t keep the planes or recent sightings off the screen',async()=>{
  const r=fresh(),models=[],err=console.error;console.error=()=>{};
  try{
    const now=T0/1000;
    store.set(LEDGER_KEY,{'route:a1f1f1:FIX101':{expires:now+6*3600,value:null},'past-route:a10101:LOL202':{expires:now+6*3600,value:null}});
    store.set(HISTORY_KEY,[{hex:'a10101',callsign:'LOL202',registration:'N1101',aircraft_type:'B738',last_seen:now-600}]);
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    await r.advance(12000);
    const m=models.at(-1);
    assert.ok(m?.fresh&&m.planes.length===1,`planes shown: ${models.length} models`);
    assert.deepEqual(m.recent.map(a=>a.hex),['a10101'],'recent sightings shown');
    s.stop();
  }finally{console.error=err;r.restore();}
});

test('backup: a 200 whose `now` is missing, not a number, 0 or below (or no time at all) counts as a failure (adsb.lol stands in)',async()=>{
  const body=now=>({ac:[FI_PLANE],msg:'No error',total:1,...now===undefined?{}:{now}});
  for(const [name,fi] of [['missing',{body:body()}],['null',{body:body(null)}],['text',{body:body('2026-11-03T05:00:00Z')}],['digits',{body:body(String(T0))}],
    ['true',{body:body(true)}],['zero',{body:body(0)}],['negative',{body:body(-T0)}],['past any date',{body:body(1e300)}]]){
    const r=fresh();
    try{
      r.feeds.fi={mode:'ok',...fi};
      const live=r.live();
      await r.advance(20000);
      assert.deepEqual(r.at('fi'),[0,5000],`${name}: adsb.fi backs off as for a 5xx`);
      assert.ok(r.updates.every(u=>!u.ok||u.source==='adsb.lol'),`${name}: no update from adsb.fi`);
      assert.equal(lastData(r)?.source,'adsb.lol',`${name}: adsb.lol stands in`);
      live.stop();
    }finally{r.restore();}
  }
  // Both feeds so: the outage sentence counts down.
  const r=fresh(),models=[];
  try{
    r.feeds.fi={mode:'ok',body:body()};r.feeds.lol={mode:'ok',body:{ac:[LOL_PLANE],msg:'No error',total:1,now:0}};
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
    await r.advance(60000);
    assert.match(quietText(models.at(-1),false),/^No live data right now\. Reconnecting in \d+ s\.$/);
    s.stop();
  }finally{r.restore();}
});

test('feed: a TV clock days or years off (the feed\'s `now` more than a week from it) keeps adsb.fi, judged by its own clock, and its planes are drawn',async()=>{
  const DAY_MS=86400000;
  for(const [name,off,seconds] of [['8 days ahead',8*DAY_MS],['8 days behind',-8*DAY_MS],['8 days ahead, in s',8*DAY_MS,true],['6 days behind',-6*DAY_MS],
    ['30 days behind',-30*DAY_MS],['TV clock 300 days behind',300*DAY_MS],['TV clock 2 years ahead, in s',-731*DAY_MS,true]]){
    const r=fresh(),models=[];
    try{
      r.feeds.fi={mode:'ok',nowShiftMs:off,seconds};
      const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
      await r.advance(20000);
      assert.deepEqual(r.at('fi'),[0,5000,10000,15000,20000],`${name}: adsb.fi every 5 s`);
      assert.deepEqual(r.at('lol'),[],`${name}: nothing sent to adsb.lol`);
      assert.ok(models.length&&models.every(m=>!m.retryAt),`${name}: no failed poll`);
      const m=models.at(-1);
      assert.equal(m.source,'adsb.fi',name);assert.equal(m.fresh,true,`${name}: fresh`);
      assert.deepEqual(m.planes.map(a=>a.hex),['a1f1f1'],`${name}: its plane drawn`);
      assert.equal(m.hero?.hex,'a1f1f1',`${name}: on the card`);
      assert.equal(m.log.today,1,`${name}: in today's logbook (the feed's day)`);
      s.stop();
    }finally{r.restore();}
  }
});

// A 200 whose clock can't be right counts as a failure (adsb.lol stands in): before 2024, more than a year
// ahead of the TV's, or more than a day before the last good reply's (a cached reply). A clock up to a year
// off the TV's is a wrong TV clock and is used (the test above).
test('feed: a 200 with an implausible clock (before 2024, over a year ahead of the TV, a day before the last good reply) counts as a failure',async()=>{
  const DAY_MS=86400000,body=now=>({ac:[FI_PLANE],msg:'No error',total:1,now});
  for(const [name,fi] of [['1972 (86400000 read as seconds)',{body:body(86400000)}],['31 December 2023',{body:body(Date.parse('2023-12-31T23:59:59Z'))}],
    ['microseconds',{body:body(T0*1000)}],['400 days ahead of the TV',{nowShiftMs:400*DAY_MS}]]){
    const r=fresh();
    try{
      r.feeds.fi={mode:'ok',...fi};
      const live=r.live();
      await r.advance(20000);
      assert.deepEqual(r.at('fi'),[0,5000],`${name}: adsb.fi backs off as for a 5xx`);
      assert.ok(r.updates.every(u=>!u.ok||u.source==='adsb.lol'),`${name}: no update from adsb.fi`);
      assert.equal(lastData(r)?.source,'adsb.lol',`${name}: adsb.lol stands in`);
      live.stop();
    }finally{r.restore();}
  }
  // After good replies, one whose clock is days behind theirs (a cached reply) is a failure; 20 h behind is used.
  for(const [name,off,used] of [['3 days before the last good reply',-3*DAY_MS,false],['20 hours before',-20*3600000,true]]){
    const r=fresh();
    try{
      const live=r.live();
      await r.advance(6000);r.feeds.fi={mode:'ok',nowShiftMs:off}; // good at 0 and 5 s
      await r.advance(20000);
      if(used){assert.deepEqual(r.at('lol'),[],`${name}: nothing sent to adsb.lol`);assert.equal(r.at('fi').length,6,`${name}: adsb.fi every 5 s`);assert.equal(lastData(r).source,'adsb.fi',name);}
      else{
        assert.deepEqual(r.at('fi'),[0,5000,10000,15000],`${name}: two failures, then adsb.lol`);
        assert.ok(!r.updates.some(u=>u.ok&&u.source==='adsb.fi'&&u.t-T0>6000),`${name}: nothing shown from it`);
        assert.equal(lastData(r).source,'adsb.lol',name);
      }
      live.stop();
    }finally{r.restore();}
  }
});

// The feeds' clocks differ by seconds: just past midnight by adsb.fi's clock, adsb.lol's reply can still read
// Thursday. The logbook day never rolls back: Friday's log keeps counting (each feed's plane once) instead of
// restarting on Thursday and again on Friday, and it stays on screen meanwhile.
test('backup: the logbook day never rolls back when the standing-in feed\'s clock is behind across midnight',async()=>{
  const r=fresh(Date.parse('2026-11-06T04:59:50Z'));const models=[]; // 23:59:50 EST Thursday
  try{
    r.feeds.fi={mode:'ok',nowShiftMs:12000};r.feeds.lol={mode:'ok',nowShiftMs:-12000}; // adsb.fi 12 s ahead, adsb.lol 12 s behind
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push({...m,at:r.t}));
    await r.advance(1000); // adsb.fi's reply reads 00:00:02 Friday: Friday's log, one plane
    assert.equal(models.at(-1).log.today,1);
    r.feeds.fi={mode:'offline'};
    await r.advance(30000); // adsb.fi fails at 5 and 10 s; adsb.lol at 15 s reads 23:59:53 Thursday, at 25 s 00:00:03 Friday
    const seen=models.filter(m=>m.fresh).map(m=>m.log.today);
    assert.ok(seen.includes(2)&&seen.lastIndexOf(1)<seen.indexOf(2),`Friday's log keeps counting: ${seen}`);
    s.stop();
  }finally{r.restore();}
});

test('backup: after a 4xx from both feeds the last picture is called stale 60 s after the last good reply, not at the next poll minutes later',async()=>{
  for(const [name,fi] of [['adsb.fi 404',{mode:'s404'}],['adsb.fi 429, Retry-After 150 s',{mode:'s429',retryAfter:150}]]){
    const r=fresh(),models=[];
    try{
      const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push({...m,at:r.t}));
      await r.advance(6000); // good replies at 0 and 5 s
      assert.ok(models.at(-1).fresh&&models.at(-1).planes.length===1,`${name}: live`);
      r.feeds.fi=fi;r.feeds.lol={mode:'s404'};
      await r.advance(58000); // 64 s: within a minute of the last good reply, the picture stays
      assert.ok(models.at(-1).fresh,`${name}: kept up to 60 s`);
      const asked=r.feedCalls().length;
      await r.advance(2000); // 66 s
      const m=models.at(-1);
      assert.ok(!m.fresh&&!m.planes.length,`${name}: not shown as live at ${m.at} ms`);
      assert.match(quietText(m,false),/^No live data right now\. Reconnecting in \d+ (s|min)\.$/,name);
      assert.equal(r.feedCalls().length,asked,`${name}: nothing asked for it`);
      await r.advance(120000);
      assert.ok(models.filter(m=>m.at>65000).every(m=>!m.fresh),`${name}: stale until a feed answers`);
      s.stop();
      const n=models.length;await r.advance(120000);
      assert.equal(models.length,n,`${name}: nothing after stop`);
    }finally{r.restore();}
  }
});

// During an outage app.mjs ticks the feed once a minute: the model is run again, so the clock, the logbook day
// and the countdown move on together (the date read Friday with Thursday's Seen until the next poll).
test('outage: the minute tick past midnight moves the date and the day\'s tallies together (Seen 0 with Friday)',async()=>{
  const r=fresh(Date.parse('2026-11-06T05:58:00Z')),models=[],place={...CVG,timeZone:'America/Chicago'}; // 23:58 CST Thursday
  try{
    const s=start(place,CFG,m=>models.push({...m,at:r.t}));
    await r.advance(6000); // good replies at 0 and 5 s: a plane logged on Thursday
    r.feeds.fi={mode:'s403'};r.feeds.lol={mode:'s403'}; // both 4xx: the next poll 5 min away
    await r.advance(120000-r.t); // 00:00:00 CST Friday
    const before=models.at(-1);
    assert.ok(!before.fresh&&before.log.today===1&&before.at<120000,'re-judged 60 s after the last good reply: Thursday\'s count');
    s.tick();
    const m=models.at(-1);
    assert.ok(m!==before&&m.at===120000,'a model from the tick');
    assert.equal(new Date(m.now).toLocaleDateString('en-US',{weekday:'long',timeZone:place.timeZone}),'Friday');
    assert.equal(m.log.today,0,'Friday\'s tallies, not Thursday\'s');
    assert.ok(!m.fresh&&m.retryIn>0&&m.retryIn<=300,`the countdown moves on too: ${m.retryIn}`);
    assert.match(quietText(m,false),/^No live data right now\. Reconnecting in \d+ (s|min)\.$/);
    s.stop();
  }finally{r.restore();}
});

test('feed: an aircraft listed twice in one reply counts once, from its newest position (its 7700 kept, one history row)',async()=>{
  const reply=ac=>({mode:'ok',get body(){return {ac,msg:'No error',now:Date.now(),total:ac.length};}});
  const sos=plane('a50001','UAL101',{squawk:'7700',emergency:'general',seen_pos:0.1}),old=plane('a50001','UAL101',{squawk:'1200',emergency:'none',seen_pos:5,lat:39.066});
  for(const [name,ac] of [['newest first',[sos,old]],['newest last',[old,sos]],['in capitals',[sos,{...old,hex:'A50001'}]]]){
    const r=fresh(),models=[];
    try{
      r.feeds.fi=reply(ac);
      const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
      await r.advance(1000);
      const m=models.at(-1);
      assert.equal(m.planes.length,1,name);
      assert.deepEqual([m.hero.status,m.hero.emergency,m.hero.squawk,m.hero.latitude],['Emergency','EMERGENCY','7700',39.065],name);
      s.stop();
    }finally{r.restore();}
  }
  const r=fresh();
  try{
    r.feeds.fi=reply([...Array.from({length:25},(_,i)=>plane('a50001','UAL101',{seen_pos:i/10})),plane('a50002','UAL102')]);
    const s=start({...CVG,timeZone:'America/New_York'},CFG,()=>{});
    await r.advance(1000);
    const h=store.get(HISTORY_KEY);
    assert.deepEqual(h.map(a=>a.hex).sort(),['a50001','a50002'],'one history row each');
    assert.equal(h.find(a=>a.hex==='a50001').last_seen,T0/1000,'from the newest position');
    s.stop();
  }finally{r.restore();}
});

test('feed: a squawk sent as text is shown without control, bidi-override or line-break characters, and at most 4 long, so a declared emergency\'s notice can\'t be reordered or broken',async()=>{
  for(const [squawk,shown] of [['\u202E1200\n\u0007','1200'],['12\u2028\u202D00','1200'],['\u2066'+'Z'.repeat(60),'ZZZZ'],['7700','7700'],['','']]){
    const r=fresh(),models=[];
    try{
      r.feeds.fi={mode:'ok',get body(){return {ac:[plane('a50001','UAL101',{squawk,emergency:'general'})],now:Date.now()};}};
      const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
      await r.advance(1000);
      const h=models.at(-1).hero;
      assert.deepEqual([h.squawk,h.emergency],[shown,'EMERGENCY'],JSON.stringify(squawk));
      s.stop();
    }finally{r.restore();}
  }
});
test('feed: a squawk sent as a number reads as its four digits (7700 is an emergency)',async()=>{
  for(const [squawk,shown,emergency] of [[7700,'7700','EMERGENCY'],[7500,'7500','HIJACK'],[7600,'7600','RADIO FAILURE'],[1200,'1200',''],[17,'0017',''],
    ['7700','7700','EMERGENCY'],[7700.5,'',''],[-7700,'',''],[17700,'',''],[NaN,'','']]){
    const r=fresh(),models=[];
    try{
      r.feeds.fi={mode:'ok',get body(){return {ac:[plane('a50001','UAL101',{squawk,emergency:'none'})],now:Date.now()};}};
      const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
      await r.advance(1000);
      const h=models.at(-1).hero;
      assert.deepEqual([h.squawk,h.emergency],[shown,emergency],String(squawk));
      s.stop();
    }finally{r.restore();}
  }
});

test('feed: an emergency on the map is kept when the reply is cut to the nearest 300, in place of the farthest; one off the map or a non-emergency is not',async()=>{
  const near=Array.from({length:300},(_,i)=>plane((0xb00000+i).toString(16),`UAL${1000+i}`,{lat:39.05+(i%20)*0.004,lon:-84.65+Math.floor(i/20)*0.004}));
  const far=(extra,lat=39.25)=>plane('c0ffee','DAL911',{lat,...extra}); // 13.8 mi north, inside the 25 mi map
  for(const [name,sos,lat,kept,status] of [['7700',{squawk:'7700',emergency:'general'},39.25,true,'Emergency'],['7600 as a number',{squawk:7600},39.25,true,'Emergency'],
    ['declared, squawk 1200',{squawk:'1200',emergency:'unlawful'},39.25,true,'Emergency'],['"constructor"',{squawk:'constructor',emergency:'constructor'},39.25,false,'Above you now'],
    ['7700 off the map',{squawk:'7700'},39.5,false,'Above you now']]){
    const r=fresh(),models=[];
    try{
      r.feeds.fi={mode:'ok',get body(){return {ac:[far(sos,lat),...near],now:Date.now()};}};
      const s=start({...CVG,timeZone:'America/New_York'},{...CFG,rangeMiles:25,searchNm:25},m=>models.push(m));
      await r.advance(1000);
      const m=models.at(-1),hexes=m.planes.map(a=>a.hex);
      assert.equal(m.planes.length,300,name);
      assert.equal(hexes.includes('c0ffee'),kept,name);
      assert.equal(hexes.includes((0xb00000+299).toString(16)),!kept,`${name}: the farthest of the 300 gives way`);
      assert.ok(m.planes.every((a,i,all)=>!i||all[i-1].distance_mi<=a.distance_mi),`${name}: nearest first`);
      assert.equal(m.hero.status,status,name);if(kept)assert.equal(m.hero.hex,'c0ffee',name);
      s.stop();
    }finally{r.restore();}
  }
});
