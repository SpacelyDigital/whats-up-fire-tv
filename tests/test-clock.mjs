// node --test tests/test-clock.mjs — the TV's clock stepping while the app runs (an NTP correction,
// a wrong date put right). Here `t` is real time: timers, the feeds' own clocks and performance.now();
// Date.now() is the TV's clock, T0 + t + its error, and the cases step that error.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startLive,resetOutage,store,LEDGER_KEY,HISTORY_KEY,Ledger,Enricher,getBytes,getJson} from '../web/live.mjs';
import {start,resetLog} from '../web/model.mjs';
import {fmt} from '../web/kit.mjs';
import {step,LookupGate} from '../web/browse.mjs';
import {photoFor} from '../web/photos.mjs';

const T0=Date.parse('2026-11-05T15:00:00Z'),CVG={latitude:39.05,longitude:-84.65};
const CFG={...CVG,radiusMiles:3,pollSeconds:5,searchNm:15};
const FI=/^https:\/\/opendata\.adsb\.fi\//,LOL=/^https:\/\/api\.adsb\.lol\//;
const PLANE={hex:'a1f1f1',flight:'FIX101  ',r:'N1F1',t:'B738',lat:39.065,lon:-84.65,alt_baro:4000,gs:220,track:90,seen_pos:0.4,seen:0.2};
const gapsOf=ts=>ts.slice(1).map((v,i)=>v-ts[i]);

function rig(){
  const real={now:Date.now,perf:performance.now,set:globalThis.setTimeout,clear:globalThis.clearTimeout,fetch:globalThis.fetch,random:Math.random};
  let t=0,err=0;const timers=new Set(),calls=[],updates=[];
  const feeds={fi:{mode:'ok',ms:200},lol:{mode:'ok',ms:200}};
  Date.now=()=>T0+t+err;performance.now=()=>t;Math.random=()=>.5;
  globalThis.setTimeout=(fn,ms)=>{const h={fn,at:t+Math.max(0,Number(ms)||0)};timers.add(h);return h;};
  globalThis.clearTimeout=h=>{timers.delete(h);};
  globalThis.fetch=(url,opts={})=>new Promise((ok,no)=>{
    url=String(url);const which=FI.test(url)?'fi':LOL.test(url)?'lol':'other',f=feeds[which]||{mode:'s404',ms:0},c={t,which};calls.push(c);
    const h=globalThis.setTimeout(()=>{c.done=t;
      if(f.mode==='offline')return no(new TypeError('offline'));
      const status=f.mode==='ok'?200:Number(f.mode.slice(1));
      ok({status,url,headers:{get:()=>null},text:async()=>status===200?JSON.stringify({ac:f.ac||[PLANE],msg:'No error',now:T0+t}):''});
    },f.ms);
    opts.signal?.addEventListener('abort',()=>{globalThis.clearTimeout(h);no(new Error('aborted'));});
  });
  const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
  // Run real time forward, firing timers in order; until() stops early.
  async function advance(ms,until){
    const end=t+ms;
    for(;;){
      await flush();if(until?.())return;
      const due=[...timers].filter(h=>h.at<=end).sort((a,b)=>a.at-b.at)[0];
      if(!due)break;
      timers.delete(due);t=Math.max(t,due.at);due.fn();
    }
    t=end;await flush();
  }
  const live=(config=CFG)=>startLive((s,ok)=>updates.push({t,ok,source:s.source||''}),config);
  const feed=()=>calls.filter(c=>c.which==='fi'||c.which==='lol');
  const restore=()=>{Date.now=real.now;performance.now=real.perf;globalThis.setTimeout=real.set;globalThis.clearTimeout=real.clear;globalThis.fetch=real.fetch;Math.random=real.random;};
  return {feeds,calls,updates,advance,live,feed,restore,step(ms){err+=ms;},get t(){return t;}};
}
function fresh(){resetOutage();store.remove(LEDGER_KEY);store.remove(HISTORY_KEY);return rig();}

for(const back of [10000,120000,3600000,86400000])
  test(`feed: the TV clock stepped back ${back/1000} s during a poll: the next polls come on time`,async()=>{
    const r=fresh();
    try{
      const live=r.live();await r.advance(16000);
      r.feeds.fi.ms=1500;const n=r.feed().length;
      await r.advance(10000,()=>r.feed().length>n); // the next poll is out
      await r.advance(600);r.step(-back);r.feeds.fi.ms=200;const at=r.t;
      await r.advance(40000);
      const after=r.feed().filter(c=>c.t>at).map(c=>c.t),gaps=[after[0]-at,...gapsOf(after)];
      assert.ok(after.length>=7&&Math.max(...gaps)<=5500,`polls after the step: +${after.map(x=>x-at)} ms`);
      assert.ok(r.updates.filter(u=>u.t>at&&u.ok).length>=7,'and their planes shown');
      live.stop();
    }finally{r.restore();}
  });

test('feed: the TV clock stepped back 10 min or an hour during an outage: planes return within the 5-minute back-off',async()=>{
  for(const back of [600000,3600000]){
    const r=fresh();
    try{
      r.feeds.fi.mode='s500';r.feeds.lol.mode='s503';
      const live=r.live();await r.advance(40000);
      r.step(-back);r.feeds.fi.mode='ok';const at=r.t;
      await r.advance(400000,()=>r.updates.some(u=>u.t>at&&u.ok));
      const ok=r.updates.find(u=>u.t>at&&u.ok);
      assert.ok(ok&&ok.t-at<=300000,`-${back/60000} min: planes ${ok?ok.t-at+' ms':'not'} after the feeds came back`);
      assert.equal(ok.source,'adsb.fi');
      live.stop();
    }finally{r.restore();}
  }
});

test('route lookups: one every 5 s by performance.now(), whatever the TV clock says; a 429 pauses 15 min, also for the next feed',async()=>{
  const real=performance.now;let p=1000;performance.now=()=>p;resetOutage(); // the pace is kept across Enrichers
  try{
    const now=Date.now()/1000,asked=[],L=new Ledger(),answer={status:404,payload:null};
    const e=new Enricher(L,async url=>{asked.push(url);return answer;});
    const a=n=>({hex:'a0000'+n,callsign:'UAL10'+n,registration:'',latitude:39.06,longitude:-84.65,observed:now,live:true,inside:true,miles:1});
    await e.tick([a(1)],now);assert.equal(asked.length,1);
    p+=3000;await e.tick([a(2)],now-3600);assert.equal(asked.length,1,'not within 5 s');
    p+=3000;await e.tick([a(2)],now-3597);assert.equal(asked.length,2,'5 s on, though the TV clock stepped back an hour');
    p+=6000;await e.tick([a(3)],now+86400);assert.equal(asked.length,3,'and forward a day');
    answer.status=429;p+=6000;await e.tick([a(4)],now);assert.equal(asked.length,4);
    p+=14*60000;await e.tick([a(5)],now-7200);assert.equal(asked.length,4,'paused after a 429, whatever the TV clock says');
    // A restart (place, radius or zone changed) mid-pause: the saved pause holds.
    const e2=new Enricher(new Ledger(JSON.parse(JSON.stringify(L))),async url=>{asked.push(url);return {status:404,payload:null};});
    await e2.tick([a(5)],now);assert.equal(asked.length,4,'the next feed keeps the pause');
    p+=15*60000+1000;await e2.tick([a(5)],now);assert.equal(asked.length,5,'asked once it is over');
  }finally{performance.now=real;}
});

test('map tiles: a 429\'s pause runs on performance.now(): the TV clock stepped back an hour doesn\'t stretch it',async()=>{
  const real={now:Date.now,perf:performance.now,fetch:globalThis.fetch};let d=T0,p=1000,status=429,calls=0;
  Date.now=()=>d;performance.now=()=>p;globalThis.fetch=async()=>{calls++;return {status,arrayBuffer:async()=>new ArrayBuffer(8)};};
  const TILE='https://tiles.openfreemap.org/planet/x/10/271/391.pbf';
  try{
    assert.equal(await getBytes(TILE),null);status=200;
    p+=30000;d+=30000;assert.equal(await getBytes(TILE),null,'paused');assert.equal(calls,1);
    p+=31000;d-=3600000;assert.equal((await getBytes(TILE))?.length,8,'asked again a minute after the 429');assert.equal(calls,2);
  }finally{Date.now=real.now;performance.now=real.perf;globalThis.fetch=real.fetch;resetOutage();}
});

test('map: a 429 on the TileJSON waits out its Retry-After and the tile pause; neither it nor a tile is asked meanwhile',async()=>{
  const real={perf:performance.now,fetch:globalThis.fetch};let p=1e7,status=429;const asked=[];
  performance.now=()=>p;
  globalThis.fetch=async url=>{asked.push(String(url));return {status,headers:{get:k=>k==='retry-after'?'600':null},
    text:async()=>JSON.stringify({tiles:['https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf']}),arrayBuffer:async()=>new ArrayBuffer(8)};};
  const TILEJSON='https://tiles.openfreemap.org/planet',TILE='https://tiles.openfreemap.org/planet/x/10/271/391.pbf';
  try{
    assert.equal((await getJson(TILEJSON)).status,429);status=200;
    p+=61000; // past the tile pause's first minute, well within the Retry-After
    assert.notEqual((await getJson(TILEJSON)).status,200,'TileJSON not asked within its Retry-After');
    assert.equal(await getBytes(TILE),null,'nor a tile');
    assert.equal(asked.length,1,`asked: ${asked.join(' ')}`);
    p+=540000; // 601 s after the 429
    assert.equal((await getJson(TILEJSON)).status,200);assert.equal((await getBytes(TILE))?.length,8);
    assert.equal(asked.length,3);
  }finally{performance.now=real.perf;globalThis.fetch=real.fetch;resetOutage();}
});

test('map: a 5xx or 403 on the TileJSON starts no tile pause: its 30 s retry asks again, and tiles are asked',async()=>{
  const real={perf:performance.now,fetch:globalThis.fetch};let p=2e7,status=500;const asked=[];
  performance.now=()=>p;
  globalThis.fetch=async url=>{asked.push(String(url));return {status,headers:{get:()=>null},
    text:async()=>JSON.stringify({tiles:['https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf']}),arrayBuffer:async()=>new ArrayBuffer(8)};};
  const TILEJSON='https://tiles.openfreemap.org/planet',TILE='https://tiles.openfreemap.org/planet/x/10/271/391.pbf';
  try{
    for(const code of [500,503,403]){
      status=code;assert.equal((await getJson(TILEJSON)).status,code);
      p+=30000;status=200;
      assert.equal((await getJson(TILEJSON)).status,200,`TileJSON asked again 30 s after a ${code}`);
      assert.equal((await getBytes(TILE))?.length,8,`and a tile after a ${code}`);
    }
    assert.equal(asked.length,9);
  }finally{performance.now=real.perf;globalThis.fetch=real.fetch;resetOutage();}
});

test('route cache: after the TV clock steps back an hour, expired rows still go and the 800-lookup cap still holds',()=>{
  const now=T0/1000,L=new Ledger();
  for(let i=0;i<900;i++)L.put('lol:A'+i,{},now+86400,now);
  L.put('lol:B',{},now+86461,now+61);assert.equal(L.rows.size,800,'the cap, a minute on');
  const back=now+61-3600;
  L.put('lol:S',{},back+86400,back);assert.equal(L.rows.size,800,'pruned at the step');
  L.put('x:soon',1,back+30,back+10);for(let i=0;i<700;i++)L.put('lol:C'+i,{},back+86400,back+10);
  L.put('lol:D',{},back+86500,back+100);
  assert.ok(L.rows.size<=800&&!L.rows.has('x:soon'),`a minute after the step: ${L.rows.size} rows, expired row ${L.rows.has('x:soon')?'kept':'gone'}`);
});

test('recently above: sightings are timed on the feed\'s clock, so a TV clock behind or ahead of it neither hides them nor misstates their ages',async()=>{
  for(const off of [0,-30000,-60000,-600000,-86400000,60000,3600000]){
    const r=fresh();resetLog();const models=[],F=T0/1000;
    try{
      r.step(off);r.feeds.fi.ac=[]; // quiet skies: only the saved sightings
      store.set(HISTORY_KEY,[{hex:'a0a0a1',callsign:'UAL1234',registration:'N1234U',aircraft_type:'B738',last_seen:F-30},
        {hex:'a0a0a2',callsign:'DAL5678',registration:'N5678D',aircraft_type:'A321',last_seen:F-300}]);
      const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push(m));
      await r.advance(1000);
      const m=models.filter(x=>x.fresh).at(-1);
      assert.deepEqual(m?.recent.map(a=>`${a.flight} ${fmt.ago(a.last_seen,m.now)}`),['UAL1234 now','DAL5678 5m'],`the TV clock ${off/1000} s off the feed's`);
      s.stop();
    }finally{r.restore();}
  }
});

test('browsing: the photo gate times its second by performance.now(), so the TV clock stepped back an hour doesn\'t hold the photo',async()=>{
  const r=rig();
  try{
    const m={hero:{hex:'a00001',ground:1},planes:[{hex:'a00001',ground:1},{hex:'a00002',ground:2}]};
    const st=step(null,m,25,1,performance.now()),g=new LookupGate();g.update(st.hex,st,performance.now());
    r.step(-3600000);let got=null;g.wait(st.hex).then(v=>{got=v;});
    await r.advance(500);assert.equal(got,null,'not before a second on the card');
    await r.advance(600);assert.equal(got,true,'a second after the press');
  }finally{r.restore();}
});

test('photos: the 1.5 s between lookups is timed by performance.now(), so the TV clock stepped back an hour doesn\'t hold the next one',async()=>{
  const real={now:Date.now,perf:performance.now,fetch:globalThis.fetch,set:globalThis.setTimeout};let d=T0,p=5000;const asked=[],waits=[];
  Date.now=()=>d;performance.now=()=>p;
  globalThis.fetch=async url=>{asked.push(String(url));return {status:404,url,headers:{get:()=>null},text:async()=>''};};
  globalThis.setTimeout=(fn,ms)=>{waits.push(ms);return real.set(fn,Math.min(ms,20));}; // every wait recorded, none really taken
  try{
    await photoFor({hex:'a0b0c1'});assert.equal(asked.length,1);
    d-=3600000;p+=2000;waits.length=0;
    await photoFor({hex:'a0b0c2'});assert.equal(asked.length,2);
    assert.ok(waits.every(ms=>ms<=3000),`no wait beyond the lookup's own 3 s timeout: ${waits}`);
  }finally{Date.now=real.now;performance.now=real.perf;globalThis.fetch=real.fetch;globalThis.setTimeout=real.set;}
});

test('hidden and shown: a poll at most once a second and never while one is out; at once after a minute away',async()=>{
  const r=fresh();
  try{
    const live=r.live();await r.advance(16000);
    // Ten quick flaps (an overlay flickering): no burst of polls.
    const n=r.feed().length;
    for(let i=0;i<10;i++){live.pause();await r.advance(120);live.resume();await r.advance(120);}
    await r.advance(2500);
    const flaps=r.feed().slice(n).map(c=>c.t);
    assert.ok(flaps.length<=2&&gapsOf(flaps).every(g=>g>=1000),`${flaps.length} polls in 5 s, ${gapsOf(flaps)} ms apart`);
    // A slow reply: hidden and shown while it is out, nothing more is sent, and it is shown when it lands.
    await r.advance(10000);r.feeds.fi.ms=3000;const m=r.feed().length;
    await r.advance(10000,()=>r.feed().length>m);
    live.pause();await r.advance(300);live.resume();await r.advance(1500);
    assert.equal(r.feed().length,m+1,'one request out at a time');
    await r.advance(1300);assert.ok(r.updates.at(-1).ok&&r.updates.at(-1).t===r.feed()[m].done,'its reply shown');
    r.feeds.fi.ms=200;
    // Back after a minute: at once.
    await r.advance(10000);live.pause();await r.advance(60000);const k=r.feed().length;live.resume();await r.advance(10);
    assert.equal(r.feed().length,k+1,'back after a minute: polled at once');
    live.stop();
  }finally{r.restore();}
});

test('outage: the TV clock stepped back 10 min with both feeds still down doesn\'t bring the last picture back as live',async()=>{
  const r=fresh();resetLog();const models=[];
  try{
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push({t:r.t,m}));
    await r.advance(16000);assert.ok(models.at(-1).m.fresh&&models.at(-1).m.planes.length,'live first');
    r.feeds.fi.mode='s500';r.feeds.lol.mode='s503';
    await r.advance(90000);const was=models.at(-1).m;
    assert.ok(!was.fresh&&!was.planes.length,'no live data after a minute down');
    r.step(-600000);const at=r.t;
    await r.advance(120000);
    const back=models.filter(x=>x.t>at&&(x.m.fresh||x.m.planes.length));
    assert.equal(back.length,0,`${back.length} models with planes after the step, the first at +${back[0]?.t-at} ms`);
    r.feeds.fi.mode='ok';await r.advance(400000,()=>models.some(x=>x.t>at&&x.m.fresh));
    assert.ok(models.some(x=>x.t>at&&x.m.fresh&&x.m.planes.length),'live again once a feed is back');
    s.stop();
  }finally{r.restore();}
});

test('route lookups: a pause saved by the build before (value true, not seconds) holds for what is left of it',async()=>{
  const real=performance.now;let p=1000;performance.now=()=>p;resetOutage();
  try{
    const now=Date.now()/1000,asked=[];
    const e=new Enricher(new Ledger({'cooldown:adsblol':{expires:now+800,value:true}}),async url=>{asked.push(url);return {status:404,payload:null};});
    const a={hex:'a00001',callsign:'UAL101',registration:'',latitude:39.06,longitude:-84.65,observed:now,live:true,inside:true,miles:1};
    p+=5000;await e.tick([a],now);assert.equal(asked.length,0,'still paused 5 s on');
    p+=796000;await e.tick([a],now);assert.equal(asked.length,1,'asked once it is over');
  }finally{performance.now=real;}
});

// A standby that performance.now() and the timers don't count (Chromium on Linux) reads here as
// the TV clock put forward while the page's own time stands still.
test('standby: back on screen after an hour the feed polls at once, and a failed poll then doesn\'t show the old picture as live',async()=>{
  const r=fresh();resetLog();const models=[];
  try{
    const s=start({...CVG,timeZone:'America/New_York'},CFG,m=>models.push({t:r.t,m}));
    await r.advance(16000);const n=r.feed().length;
    await r.advance(10000,()=>r.feed().length>n);await r.advance(300);
    s.pause();r.step(3600000);const k=r.feed().length;s.resume();
    await r.advance(1000);assert.equal(r.feed().length,k+1,'polled at once (a second after the last request)');
    s.pause();await r.advance(300);r.step(3600000);r.feeds.fi.mode='offline';r.feeds.lol.mode='offline';const at=r.t;s.resume();
    await r.advance(3000);
    const shown=models.filter(x=>x.t>at);
    assert.ok(shown.length&&shown.every(x=>!x.m.fresh&&!x.m.planes.length),`after the wake: ${shown.map(x=>`+${x.t-at} ms ${x.m.fresh?'live':'stale'} ${x.m.planes.length}`)}`);
    s.stop();
  }finally{r.restore();}
});

test('a feed restarted for the same place carries the planes on, but not \'Recently above\' or the logbook that a fresh start cleared',async()=>{
  const r=fresh();resetLog();const F=T0/1000,P={...CVG,timeZone:'America/New_York'};
  const stops=[];
  try{
    store.set(HISTORY_KEY,[{hex:'a0a0a1',callsign:'UAL1234',registration:'N1234U',aircraft_type:'B738',last_seen:F-30}]);
    const a=[];const s1=start(P,CFG,m=>a.push(m));stops.push(s1);
    await r.advance(1000);
    const good=a.filter(x=>x.fresh).at(-1);
    assert.equal(good?.recent.length,1,'the first feed shows the saved sighting');assert.ok(good.log.today>0,'and logs the planes');
    s1.stop();
    const b=[];const s2=start(P,CFG,m=>b.push(m),undefined,s1);stops.push(s2); // a new map radius: nothing cleared
    assert.equal(b[0]?.planes.length,good.planes.length,'the planes carry on at once');
    assert.equal(b[0].recent.length,1);assert.equal(b[0].log.today,good.log.today);
    s2.stop();
    store.remove(HISTORY_KEY);resetLog(); // Confirm on a guess that replaced a damaged place, or a new Alert zone
    const c=[];const s3=start(P,CFG,m=>c.push(m),undefined,s2);stops.push(s3);
    assert.equal(c[0]?.planes.length,good.planes.length,'the planes still carry on');
    assert.deepEqual(c[0].recent,[],'\'Recently above\' starts afresh');assert.equal(c[0].log.today,0,'so does the logbook');
  }finally{for(const s of stops)s.stop();r.restore();}
});
