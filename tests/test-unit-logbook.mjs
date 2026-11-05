// node --test tests/  — the daily logbook: Seen, cargo tonight and military today counted once
// per aircraft, the caps, the ordering, "none yet", and the midnight reset in the home time
// zone across daylight-saving changes (US clocks went back 1 Nov 2026 02:00 and forward
// 8 Mar 2026 02:00; London, Sydney and Chatham too).
// Tests marked {todo:'BUG: ...'} expose a real bug (see qa/overnight-2026-11-02/FINDINGS-unit.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {updateLog,logSummary,militaryTypes,cargoBrand,cargoCounts,start,resetLog} from '../web/model.mjs';
import {militaryAlts} from '../web/kit.mjs';

// The logbook's day and "tonight" follow the home's time zone, set by start(): start a feed
// for a public place (Hebron KY, by CVG) with the network down and stop it at once.
const CFG={radiusMiles:3,pollSeconds:5,searchNm:15};
function home(timeZone,latitude=39.05,longitude=-84.67){
  const real=globalThis.fetch;globalThis.fetch=async()=>{throw new TypeError('offline');};
  start({latitude,longitude,timeZone},CFG,()=>{}).stop();
  globalThis.fetch=real;
}
const local=(t,timeZone)=>new Date(t).toLocaleString('en-CA',{timeZone,hourCycle:'h23'});
const dayOf=(t,timeZone)=>new Date(t).toLocaleDateString('en-CA',{timeZone});
const P=(hex,o={})=>({hex,aircraft_type:'B738',distance_mi:5,flight:hex.toUpperCase(),altitude_ft:10000,speed_kt:300,...o});
const MIN=60000,HOUR=60*MIN;

// --- Counting --------------------------------------------------------------------------------
test('Seen: once per aircraft per day, local area only (15 NM = 17.3 mi, the edge included)',()=>{
  home('America/New_York');
  const t=Date.UTC(2026,9,20,16);
  let log=updateLog(null,[P('a00001'),P('a00002',{distance_mi:17.3}),P('a00003',{distance_mi:17.31}),P('a00004',{distance_mi:200})],t);
  log=updateLog(log,[P('a00001',{distance_mi:1}),P('a00002')],t+MIN);
  const s=logSummary(log);
  assert.equal(s.today,2,'a00001 and a00002, each once');
  assert.ok(log.planes.xa00003&&log.planes.xa00004,'farther planes still feed Rarest/Farthest');
  assert.equal(log.planes.xa00001.d,1,'closest approach kept');
  assert.equal(log.typesAll.B738,4,'all-time tally: once per aircraft per day, any distance');
  log=updateLog(log,[P('a00005',{altitude_ft:41000,speed_kt:560,flight:'UAE2'}),P('a00006',{altitude_ft:45000,speed_kt:600,distance_mi:30})],t+2*MIN);
  assert.deepEqual(logSummary(log).highest,{name:'UAE2',value:41000},'Highest is local only');
  assert.deepEqual(logSummary(log).fastest,{name:'UAE2',value:560});
});
test('Seen: the caps (3000 seen, 4000 planes, 600 types) keep the newest and the most counted',()=>{
  home('UTC');
  const t=Date.UTC(2026,9,20,12);
  let log=updateLog(null,[],t);
  const batch=[];for(let i=0;i<3100;i++)batch.push(P((0xb00000+i).toString(16),{aircraft_type:'T'+(i%700).toString(36).toUpperCase().padStart(3,'0')}));
  log=updateLog(log,batch,t);
  assert.equal(log.seen.length,3000);assert.equal(log.seen[0],(0xb00000+100).toString(16),'the oldest went first');
  assert.ok(Object.keys(log.typesAll).length<=600);
  log=updateLog(log,[P('b00000')],t+MIN);
  assert.equal(log.seen.length,3000,'an evicted plane comes back as new but the cap holds');
});
test('cargo tonight: 6 pm to 6 am local, once per aircraft, local area only, by brand most first',()=>{
  home('America/New_York');
  const eve=Date.UTC(2026,9,20,22,30); // 18:30 EDT
  const C=(hex,brand,o)=>P(hex,{cargo:brand,...o});
  let log=updateLog(null,[C('c00001','UPS'),C('c00002','FedEx'),C('c00003','UPS'),C('c00004','DHL',{distance_mi:40})],eve-HOUR); // 17:30: not yet
  assert.equal(logSummary(log).cargoTonight,0);assert.equal(logSummary(log).night,false);
  log=updateLog(log,[C('c00001','UPS'),C('c00002','FedEx'),C('c00003','UPS'),C('c00004','DHL',{distance_mi:40})],eve);
  log=updateLog(log,[C('c00001','UPS'),C('c00005','Amazon'),C('c00006','DHL'),C('c00007','ABX')],eve+2*HOUR);
  let s=logSummary(log);
  assert.equal(s.night,true);assert.equal(s.cargoTonight,6,'c00001 once, the far DHL not at all');
  assert.deepEqual(s.cargoBy,[['UPS',2],['ABX',1],['Amazon',1],['DHL',1],['FedEx',1]],'count first, then A-Z');
  // Past midnight the same night goes on (the day's other counts start again).
  log=updateLog(log,[C('c00008','UPS')],Date.UTC(2026,9,21,7)); // 03:00 EDT
  s=logSummary(log);
  assert.equal(s.today,1,'Seen started again at midnight');assert.equal(s.cargoTonight,7,'cargo kept through midnight');
  // 6 am: over; the next evening starts from none.
  log=updateLog(log,[C('c00009','UPS')],Date.UTC(2026,9,21,10,1)); // 06:01 EDT
  s=logSummary(log);assert.equal(s.night,false);assert.equal(s.cargoTonight,0);assert.deepEqual(s.cargoBy,[]);
  log=updateLog(log,[C('c00001','UPS')],Date.UTC(2026,9,21,22,5)); // 18:05 EDT next day
  assert.equal(logSummary(log).cargoTonight,1,'a plane from last night counts again tonight');
});
test('cargo brands: callsign prefix (case-insensitive), Amazon by owner first, feeders as their brand',()=>{
  assert.equal(cargoBrand('fdx12',''),'FedEx');assert.equal(cargoBrand('MTN8101',''),'FedEx','FedEx feeder');
  assert.equal(cargoBrand('FDX',''),'','a prefix needs a flight number');assert.equal(cargoBrand('FDXA12',''),'');
  assert.equal(cargoBrand('UPS100','Amazon.com Services LLC'),'Amazon','the owner decides Amazon');
  assert.equal(cargoBrand('SCX9301','PRIME AIR LLC'),'Amazon');
  assert.equal(cargoBrand('N123AB','FEDERAL EXPRESS CORP'),'FedEx');assert.equal(cargoBrand('N123AB','UNITED PARCEL SERVICE CO'),'UPS');
  assert.equal(cargoBrand('N123AB','DHL AIR LTD'),'DHL');assert.equal(cargoBrand('N123AB','ADHLX LLC'),'');
  assert.equal(cargoBrand(null,null),'');assert.equal(cargoBrand(undefined,undefined),'');
  assert.deepEqual(cargoCounts(null),[]);assert.deepEqual(cargoCounts({}),[]);
  assert.deepEqual(cargoCounts({a:'DHL',b:'Atlas',c:'DHL',d:'ABX',e:'Atlas'}),[['Atlas',2],['DHL',2],['ABX',1]]);
});
test('military today: once per aircraft per day, local only, by short type, most first, capped at 500',()=>{
  home('America/Chicago',41.98,-87.9);
  const t=Date.UTC(2026,9,20,18),M=(hex,type,o)=>P(hex,{aircraft_type:type,military:true,...o});
  let log=updateLog(null,[M('ae0001','C17'),M('ae0002','K35R'),M('ae0003','K35R'),M('ae0004','H60'),M('ae0005','C130'),M('ae0006',''),M('ae0007','C17',{distance_mi:18})],t);
  log=updateLog(log,[M('ae0001','C17'),M('ae0002','K35R')],t+HOUR);
  const s=logSummary(log);
  assert.equal(s.militaryToday,6);
  assert.deepEqual(s.militaryTypes,[['KC-135',2],['C-130',1],['C-17',1],['UH-60',1],['Unknown',1]].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
  const alts=militaryAlts(s);
  assert.equal(alts[0].split(' · ').length,4,'at most four types');assert.ok(alts[0].startsWith('2 KC-135'));
  assert.equal(alts.at(-1),'2 KC-135','fewest words last');
  assert.deepEqual(militaryAlts(logSummary(null)),['none yet']);assert.deepEqual(militaryAlts(undefined),['none yet']);
  assert.equal(logSummary(updateLog(null,[P('a10001')],t)).militaryToday,0,'a civil plane is not counted');
  const many=[];for(let i=0;i<520;i++)many.push(M((0xae1000+i).toString(16),'C17'));
  log=updateLog(log,many,t+2*HOUR);
  assert.equal(logSummary(log).militaryToday,500);assert.ok(!('ae0001' in log.mil),'the oldest dropped');
  assert.deepEqual(militaryTypes({}),[]);assert.deepEqual(militaryTypes(undefined),[]);
});
test('logbook: a missing log summarises as nothing yet (no NaN, no null counts)',()=>{
  const s=logSummary(null);
  assert.deepEqual([s.today,s.cargoTonight,s.militaryToday,s.night,s.rarest,s.farthest],[0,0,0,false,null,null]);
  assert.deepEqual([s.cargoBy,s.militaryTypes],[[],[]]);
});

// --- Midnight in the home time zone ----------------------------------------------------------
// Sweep a time range every `step` ms, feeding the same plane each time, and record every reset.
function sweep(timeZone,from,to,step=5*MIN){
  home(timeZone);
  let log=null;const resets=[];
  for(let t=from;t<=to;t+=step){
    const before=log?.day;log=updateLog(log,[P('a0aaaa')],t);
    if(before!==undefined&&log.day!==before)resets.push({t,day:log.day,local:local(t,timeZone)});
    assert.equal(log.day,dayOf(t,timeZone),`day at ${new Date(t).toISOString()}`);
    assert.equal(logSummary(log).today,1,'the one plane counted once, every day');
  }
  return resets;
}
const H=(...a)=>Date.UTC(...a);
for(const [name,tz,from,to,midnights] of [
  ['New York, clocks back 1 Nov 2026',      'America/New_York',H(2026,9,31,12),H(2026,10,3,12),[H(2026,10,1,4),H(2026,10,2,5),H(2026,10,3,5)]],
  ['New York, clocks forward 8 Mar 2026',   'America/New_York',H(2026,2,7,12),H(2026,2,10,12),[H(2026,2,8,5),H(2026,2,9,4),H(2026,2,10,4)]],
  ['Chicago, clocks back 1 Nov 2026',       'America/Chicago', H(2026,9,31,12),H(2026,10,2,12),[H(2026,10,1,5),H(2026,10,2,6)]],
  ['London, clocks back 25 Oct 2026',       'Europe/London',   H(2026,9,24,12),H(2026,9,26,12),[H(2026,9,24,23),H(2026,9,26,0)]],
  ['Sydney, clocks forward 4 Oct 2026',     'Australia/Sydney',H(2026,9,2,12),H(2026,9,4,20),[H(2026,9,2,14),H(2026,9,3,14),H(2026,9,4,13)]],
  ['Chatham (+12:45/+13:45), back 5 Apr 2026','Pacific/Chatham',H(2026,3,3,0),H(2026,3,6,0),[H(2026,3,3,10,15),H(2026,3,4,10,15),H(2026,3,5,11,15)]],
  ['Tokyo, no daylight saving',             'Asia/Tokyo',      H(2026,10,1,0),H(2026,10,3,0),[H(2026,10,1,15),H(2026,10,2,15)]],
]){
  test(`midnight reset: ${name}: exactly once a night, at local midnight, never at the clock change`,()=>{
    const resets=sweep(tz,from,to);
    assert.deepEqual(resets.map(r=>r.t),midnights,resets.map(r=>r.local).join(', '));
    for(const r of resets)assert.match(r.local,/, 00:00:00$/,`reset at local midnight (${r.local})`);
  });
}
test('midnight reset: one-minute steps through the repeated hour (01:00-02:00 twice on 1 Nov 2026, New York)',()=>{
  home('America/New_York');
  let log=updateLog(null,[P('a0aaaa')],H(2026,10,1,4,30)); // 00:30 EDT
  const day=log.day;
  for(let t=H(2026,10,1,5);t<=H(2026,10,1,7,30);t+=MIN){ // 01:00 EDT .. 02:30 EST
    log=updateLog(log,[P('a0bbbb')],t);
    assert.equal(log.day,day,local(t,'America/New_York'));
  }
  assert.equal(logSummary(log).today,2,'the plane seen in both 01:30s counts once');
  assert.equal(log.typesAll.B738,2);
});
test('midnight reset: no fresh data across midnight, then the next fresh poll starts a new day (none missed)',()=>{
  home('America/New_York');
  let log=updateLog(null,[P('a0aaaa'),P('a0bbbb')],H(2026,10,1,3)); // 23:00 EDT 31 Oct
  log=updateLog(log,[P('a0aaaa')],H(2026,10,3,15)); // two days later, after an outage
  assert.equal(log.day,'2026-11-03');assert.equal(logSummary(log).today,1);
  assert.equal(log.typesAll.B738,3,'all-time tallies survive the reset');
});
test('midnight reset: a home moved to another time zone follows the new zone at once',()=>{
  home('America/New_York');
  let log=updateLog(null,[P('a0aaaa')],H(2026,10,2,4)); // 23:00 EST 1 Nov in New York
  assert.equal(log.day,'2026-11-01');
  home('Asia/Tokyo');log=updateLog(log,[P('a0aaaa')],H(2026,10,2,4,5)); // 13:05 2 Nov in Tokyo
  assert.equal(log.day,'2026-11-02');assert.equal(logSummary(log).today,1);
});

// Cargo "tonight" (18:00-06:00) over the daylight-saving nights: one plane seen at 18:05 must
// stay counted until 06:00, whatever the clocks do in between.
function cargoNight(tz,eveningUtc,morningUtc){
  home(tz);
  let log=updateLog(null,[P('c0aaaa',{cargo:'UPS'})],eveningUtc+5*MIN);
  const lost=[];
  for(let t=eveningUtc+10*MIN;t<morningUtc;t+=5*MIN){
    log=updateLog(log,[],t);
    if(logSummary(log).cargoTonight!==1)lost.push(local(t,tz));
  }
  log=updateLog(log,[],morningUtc+MIN);
  return {lost,after:logSummary(log).cargoTonight};
}
// adsb.lol (the backup feed) sends no owner, so an Amazon flight it reports is told by its
// callsign's operator (ATN: ATI); once adsb.fi names the owner it must count as Amazon.
test('cargo tonight: an Amazon flight first logged from adsb.lol (no owner) counts as Amazon once the owner is known',()=>{
  home('America/New_York');
  const t=H(2026,10,3,2); // 21:00 EST
  let log=updateLog(null,[P('a8f0a3',{flight:'ATN3417',cargo:'ATI'})],t);
  log=updateLog(log,[P('a8f0a3',{flight:'ATN3417',cargo:'Amazon'})],t+MIN);
  assert.deepEqual(log.cargo.seen,{a8f0a3:'Amazon'});
  // adsb.lol standing in again doesn't turn it back, and it counts once.
  log=updateLog(log,[P('a8f0a3',{flight:'ATN3417',cargo:'ATI'})],t+2*MIN);
  assert.deepEqual(log.cargo.seen,{a8f0a3:'Amazon'});
  assert.equal(logSummary(log).cargoTonight,1);
});
test('cargo tonight: kept all night over the fall-back night (31 Oct to 1 Nov 2026, New York)',()=>{
  const r=cargoNight('America/New_York',H(2026,9,31,22),H(2026,10,1,11)); // 18:00 EDT .. 06:00 EST
  assert.deepEqual(r.lost,[]);assert.equal(r.after,0,'over at 6 am');
});
test('cargo tonight: kept all night after the fall-back day (1 to 2 Nov 2026, New York)',()=>{
  const r=cargoNight('America/New_York',H(2026,10,1,23),H(2026,10,2,11)); // 18:00 EST .. 06:00 EST
  assert.deepEqual(r.lost,[]);assert.equal(r.after,0);
});
test('cargo tonight: kept all night over the spring-forward night (7 to 8 Mar 2026, New York)',()=>{
  const r=cargoNight('America/New_York',H(2026,2,7,23),H(2026,2,8,10)); // 18:00 EST .. 06:00 EDT
  assert.deepEqual(r.lost,[]);assert.equal(r.after,0);
});
test('cargo tonight: kept all night after the spring-forward day (8 to 9 Mar 2026, New York)',()=>{
  const r=cargoNight('America/New_York',H(2026,2,8,22),H(2026,2,9,10)); // 18:00 EDT .. 06:00 EDT
  assert.deepEqual(r.lost,[]);assert.equal(r.after,0);
});
test('cargo tonight: kept all night after the spring-forward day in London and Sydney too',()=>{
  assert.deepEqual(cargoNight('Europe/London',H(2026,2,29,17),H(2026,2,30,5)).lost,[]);
  assert.deepEqual(cargoNight('Australia/Sydney',H(2026,9,4,7),H(2026,9,4,19)).lost,[]);
});

// --- The live source: what the dashboard is shown around midnight ----------------------------
// Runs the real live source once with a mocked feed and a mocked TV clock; resolves the models.
async function liveOnce({tvMs,feedMs,ac,ok=true}){
  const realNow=Date.now,realFetch=globalThis.fetch,models=[];
  Date.now=()=>tvMs;
  globalThis.fetch=async url=>{
    if(!ok)throw new TypeError('offline');
    return {status:200,headers:{get:()=>null},url,text:async()=>JSON.stringify({now:feedMs,ac})};
  };
  try{
    let s;
    await new Promise(resolve=>{
      s=start({latitude:39.05,longitude:-84.67,timeZone:'America/New_York'},CFG,m=>{models.push(m);if(!ok||m.fresh)resolve();});
    });
    await new Promise(r=>setTimeout(r,5));s.stop();
  }finally{Date.now=realNow;globalThis.fetch=realFetch;}
  return models;
}
const near=hex=>({hex,lat:39.06,lon:-84.67,alt_baro:3000,seen_pos:0.5,flight:'TST1',gs:200,track:90});
test('live: after midnight with no fresh feed yet, yesterday\'s tallies are not shown as today\'s',async()=>{
  resetLog();
  const eve=H(2026,10,3,4,50); // 23:50 EST 2 Nov
  let m=await liveOnce({tvMs:eve,feedMs:eve,ac:[near('a0c001'),near('a0c002')]});
  assert.equal(m.at(-1).log.today,2);
  m=await liveOnce({tvMs:eve+20*MIN,feedMs:0,ac:[],ok:false}); // 00:10 EST, no feed
  assert.equal(m[0].log.today,0,'nothing from yesterday');
  m=await liveOnce({tvMs:eve+21*MIN,feedMs:eve+21*MIN,ac:[near('a0c001')]});
  assert.equal(m.at(-1).log.today,1,'a new day: the same plane counts again, once');
  resetLog();
});
test('live: the logbook day follows the feed\'s clock when the TV\'s clock is off',async()=>{
  resetLog();
  const eve=H(2026,10,3,4,30); // 23:30 EST 2 Nov
  await liveOnce({tvMs:eve,feedMs:eve,ac:[near('a0c001')]});
  const real=H(2026,10,3,5,20); // 00:20 EST 3 Nov; the TV says 23:40
  const m=await liveOnce({tvMs:real-40*MIN,feedMs:real,ac:[near('a0c002')]});
  resetLog();
  assert.equal(m.at(-1).log.today,1,'3 Nov: only the plane seen after midnight');
});
test('saneLog: a damaged saved logbook is repaired or dropped, never stops the dashboard',async()=>{
  const {saneLog,updateLog,logSummary,resetLog}=await import('../web/model.mjs');
  const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
  const bad=[null,'x',42,[],{},{day:7},{day,seen:['a1b2c3'],typesToday:['B738']},{day,seen:[],typesToday:[],cargo:{night:null,seen:{}}},
    {day,seen:'abc',typesAll:null,cargo:'x',mil:[],planes:[1,2],highest:{name:5},fastest:'fast'},{day,seen:[null,3,'abc123'],planes:{x:null,y:{t:'B738',d:2}},cargo:{night:7,seen:[]}}];
  const plane={hex:'a0c001',callsign:'UPS123',registration:'N1',aircraft_type:'B763',altitude_ft:5000,speed_kt:250,distance_mi:3,latitude:39,longitude:-84.6};
  for(const b of bad){
    const log=saneLog(b);
    assert.doesNotThrow(()=>logSummary(log),JSON.stringify(b));
    let next;assert.doesNotThrow(()=>{next=updateLog(log,[plane],Date.now());},JSON.stringify(b));
    assert.doesNotThrow(()=>logSummary(next),JSON.stringify(b));
    assert.ok(next&&Array.isArray(next.seen));
  }
  assert.equal(saneLog('x'),null);
  const odd=saneLog({day,seen:[],planes:{xa:{t:'B738',d:'far'},xb:{t:'A320',d:2}},typesAll:{B738:'2',A320:3},cargo:{night:null,seen:{}},mil:{}});
  assert.deepEqual(Object.keys(odd.planes),['xb'],'a plane with a non-numeric distance is dropped');
  assert.deepEqual(odd.typesAll,{A320:3},'a non-numeric type count is dropped');
  const ok={day,pk:1,seen:['a1'],planes:{xa1:{t:'B738',d:1}},highest:{name:'A',value:3},fastest:null,typesToday:['B738'],typesAll:{B738:2},cargo:{night:null,seen:{}},mil:{}};
  assert.deepEqual(saneLog(ok),ok,'a good logbook is kept as is');
  resetLog();
});
test('live: with the TV clock 10 min off the feed, the logbook is not written on every poll (save timer on the TV clock)',async()=>{
  const {store}=await import('../web/live.mjs');
  resetLog();
  const real=store.set;let writes=0;
  store.set=function(k,...a){if(k==='whatsup.logbook.v1')writes++;return real.call(this,k,...a);};
  try{
    const t=H(2026,10,3,15,0),MIN2=60000;
    await liveOnce({tvMs:t,feedMs:t+10*MIN2,ac:[near('a0c001')]});
    const after1=writes;
    await liveOnce({tvMs:t+5000,feedMs:t+10*MIN2+5000,ac:[near('a0c002')]});
    await liveOnce({tvMs:t+10000,feedMs:t+10*MIN2+10000,ac:[near('a0c003')]});
    assert.equal(writes,after1,'no extra write within 5 minutes of TV time');
  }finally{store.set=real;resetLog();}
});
test('saneLog: a type in the military tally that isn\'t text (damaged storage) is dropped, and the feed still starts',async()=>{
  const {saneLog}=await import('../web/model.mjs');
  const {store}=await import('../web/live.mjs');
  const eve=H(2026,10,3,4,50),day='2026-11-02'; // 23:50 EST 2 Nov
  for(const v of [5,{},[],null,true]){
    const log=saneLog({day,pk:1,seen:[],planes:{},typesToday:[],typesAll:{},cargo:{night:null,seen:{}},mil:{abc123:v,ae0001:'C17'}});
    assert.deepEqual(log.mil,{ae0001:'C17'},JSON.stringify(v));
    assert.deepEqual(logSummary(log).militaryTypes,[['C-17',1]]);
  }
  resetLog();store.set('whatsup.logbook.v1',{day,pk:1,seen:[],planes:{},typesToday:[],typesAll:{},cargo:{night:null,seen:{}},mil:{abc123:5}});
  try{
    const m=await liveOnce({tvMs:eve,feedMs:eve,ac:[near('a0c001')]});
    assert.ok(m.at(-1).fresh&&m.at(-1).planes.length===1,'planes shown');
    assert.equal(m.at(-1).log.militaryToday,0);
  }finally{resetLog();}
});
test('saneLog: damaged values in a saved logbook are dropped, so its stats never read "Rare 7" or "[object Object]"',async()=>{
  const {saneLog}=await import('../web/model.mjs');
  home('America/New_York');
  const night='2026-11-02',t=H(2026,10,3,2); // 21:00 EST 2 Nov
  const log=saneLog({day:'2026-11-02',pk:1,seen:[],typesToday:[],highest:null,fastest:null,mil:{},
    planes:{xa10101:{d:1,t:7,f:'UAL202'},xa20202:{d:0.5,t:{},f:'DAL5'},xa30303:{d:2,t:'B738',f:{}},xa40404:{d:3,t:'A320',f:'DAL7',o:{code:'ATL',city:{},mi:606}},
      xa50505:{d:4,t:'A321',f:'AAL9',o:{code:'ORD',city:'Chicago',mi:'far'}},xa60606:{d:5,t:'B739',f:'UAL3',o:{code:'DEN',city:'Denver',mi:1000}},xa70707:{d:6,t:'E75L'}},
    typesAll:{B739:2,E75L:1,A320:-1,A321:1.5,B738:Infinity},cargo:{night,seen:{abc123:{},def456:9,ghi789:'Amazon',jkl012:null}}});
  assert.deepEqual(Object.keys(log.planes),['xa60606','xa70707']);
  assert.deepEqual(log.typesAll,{B739:2,E75L:1},'counts are whole numbers, none below 0');
  assert.deepEqual(log.cargo.seen,{ghi789:'Amazon'});
  const s=logSummary(log);
  assert.deepEqual(s.cargoBy,[['Amazon',1]]);
  assert.equal(typeof s.rarest.name,'string');assert.equal(s.rarest.code,'E75L');
  assert.deepEqual(s.farthest,{name:'UAL3',value:1000,from:'Denver',code:'DEN'});
  assert.doesNotThrow(()=>updateLog(log,[P('a80808',{cargo:'UPS'})],t));
});
