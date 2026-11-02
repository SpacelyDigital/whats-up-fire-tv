// node --test tests/  — What's Up: place labels, cargo brands, map building from a real tile.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync as __rd} from 'node:fs';
globalThis.__fs={readdirSync:__rd};
import {placeLabel} from '../web/place.mjs';
import {cargoBrand,cargoCounts} from '../web/model.mjs';

test('place labels read like "City, ST" in the US and Canada, else the country',()=>{
  assert.equal(placeLabel({name:'Cincinnati',admin:'Ohio',countryCode:'US',country:'United States'}),'Cincinnati, OH');
  assert.equal(placeLabel({name:'Toronto',admin:'Ontario',countryCode:'CA',country:'Canada'}),'Toronto, ON');
  assert.equal(placeLabel({name:'London',admin:'England',countryCode:'GB',country:'United Kingdom'}),'London, UK');
  assert.equal(placeLabel({name:'Lyon',admin:'Auvergne-Rhône-Alpes',countryCode:'FR',country:'France'}),'Lyon, France');
  assert.equal(placeLabel({name:'Kuala Lumpur',countryCode:'MY',country:'Malaysia'}),'Kuala Lumpur, Malaysia');
});

test('cargo brands come from callsign prefixes worldwide, Amazon from the owner',()=>{
  assert.equal(cargoBrand('FDX1234',''),'FedEx');
  assert.equal(cargoBrand('UPS2925',''),'UPS');
  assert.equal(cargoBrand('BCS714',''),'DHL');
  assert.equal(cargoBrand('DHK283',''),'DHL');
  assert.equal(cargoBrand('CLX795',''),'Cargolux');
  assert.equal(cargoBrand('CJT487',''),'Cargojet');
  assert.equal(cargoBrand('ATN3417','AMAZON.COM SERVICES LLC'),'Amazon');
  assert.equal(cargoBrand('ATN3417',''),'ATI');
  assert.equal(cargoBrand('UAL2631','UNITED AIRLINES INC'),'');
  assert.deepEqual(cargoCounts({a:'UPS',b:'FedEx',c:'UPS'}),[['UPS',2],['FedEx',1]]);
});

test('map: rings survive simplification and the layers we draw are kept',async()=>{
  // A real OpenFreeMap z10 tile (Cincinnati, CVG) saved as a fixture, served to buildMap.
  const tile=readFileSync(new URL('./fixtures/cincinnati-10-271-391.pbf',import.meta.url));
  const {VectorTile}=await import('../vendor/node_modules/@mapbox/vector-tile/index.js');
  const {default:Pbf}=await import('../vendor/node_modules/pbf/index.js');
  const {buildMap}=await import('../web/mapgen.mjs');
  const net={getJson:async()=>({status:200,payload:{tiles:['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf']}}),
    getBytes:async url=>url.endsWith('/10/271/391.pbf')?new Uint8Array(tile):new Uint8Array(0)}; // other tiles: empty
  const m=await buildMap({latitude:39.10,longitude:-84.41},10,{net,MVT:{VectorTile,Pbf}});
  assert.ok(m.water.length>0&&m.water.every(r=>r.length>=4),'water rings');
  assert.ok(m.runways.length>0,'runways');
  assert.ok(m.roads.some(r=>r.major),'motorways');
  assert.ok(m.airports.some(a=>a.iata==='CVG')&&m.airports.some(a=>a.iata==='LUK'),'airports from the tile');
  assert.equal(m.airports[0].iata,'CVG');
  // Shorelines: the tile's own edges are not drawn as shore (they made a grid over lakes).
  const cos=Math.cos(39.10*Math.PI/180),lon=x=>x/1024*360-180,lat=y=>Math.atan(Math.sinh(Math.PI-2*Math.PI*y/1024))*180/Math.PI;
  const xs=[271,272].map(t=>(lon(t)+84.41)*69.172*cos),ys=[391,392].map(t=>(lat(t)-39.10)*69.0);
  // a segment on or past one tile edge (the clip strip the tile carries beyond its border)
  const onEdge=([ax,ay],[bx,by])=>ax<=xs[0]+.01&&bx<=xs[0]+.01||ax>=xs[1]-.01&&bx>=xs[1]-.01||ay>=ys[0]-.01&&by>=ys[0]-.01||ay<=ys[1]+.01&&by<=ys[1]+.01;
  assert.ok(m.shore.length>0,'shore lines');
  assert.ok(m.shore.every(l=>l.every((p,i)=>!i||!onEdge(l[i-1],p))),'no shore segment along a tile edge');
  assert.ok(m.water.some(r=>r.some((p,i)=>i&&onEdge(r[i-1],p))),'(the water rings themselves do)');
});

test('map: a tile that fails twice fails the build (no map with a hole); a stale build stops',async()=>{
  const tile=readFileSync(new URL('./fixtures/cincinnati-10-271-391.pbf',import.meta.url));
  const {VectorTile}=await import('../vendor/node_modules/@mapbox/vector-tile/index.js');
  const {default:Pbf}=await import('../vendor/node_modules/pbf/index.js');
  const {buildMap,STALE}=await import('../web/mapgen.mjs');
  let asked=0;
  const net={getJson:async()=>({status:200,payload:{tiles:['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf']}}),
    getBytes:async url=>{asked++;return url.endsWith('/10/271/391.pbf')?null:new Uint8Array(tile);}};
  await assert.rejects(buildMap({latitude:39.10,longitude:-84.41},10,{net,MVT:{VectorTile,Pbf}}),/unavailable/);
  let n=0;
  await assert.rejects(buildMap({latitude:39.10,longitude:-84.41},10,{net:{...net,getBytes:async()=>new Uint8Array(tile)},MVT:{VectorTile,Pbf},alive:()=>++n<3}),new RegExp(STALE));
});
test('map: place names, and the detail map round-trips through its saved form',async()=>{
  const tile=readFileSync(new URL('./fixtures/cincinnati-10-271-391.pbf',import.meta.url));
  const {VectorTile}=await import('../vendor/node_modules/@mapbox/vector-tile/index.js');
  const {default:Pbf}=await import('../vendor/node_modules/pbf/index.js');
  const {buildMap,buildDetail,decodeDetail}=await import('../web/mapgen.mjs');
  const net={getJson:async()=>({status:200,payload:{tiles:['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf']}}),
    getBytes:async url=>url.endsWith('/10/271/391.pbf')?new Uint8Array(tile):new Uint8Array(0)}; // other tiles: empty
  const home={latitude:39.10,longitude:-84.41};
  const m=await buildMap(home,10,{net,MVT:{VectorTile,Pbf}});
  assert.ok(m.places.some(p=>p.name==='Cincinnati'),'town names');
  assert.ok(m.roads.every(r=>r.c),'road classes');
  // Serve the same tile for every detail request: enough to exercise decoding and the encoding.
  const any={...net,getBytes:async()=>new Uint8Array(tile)};
  const saved=await buildDetail(home,{net:any,MVT:{VectorTile,Pbf},range:3,buildings:0});
  assert.equal(typeof saved.roads[0].p,'string');
  const d=decodeDetail(JSON.parse(JSON.stringify(saved)));
  assert.ok(d.roads.length&&d.roads.every(r=>r.p instanceof Int16Array&&r.p.length>=4),'roads decode');
  assert.ok(d.water.every(w=>w.r instanceof Int16Array&&w.r.length>=8),'water rings decode');
  assert.ok(d.roads.every(r=>r.p.every(v=>Math.abs(v)<=32000)),'coordinates (1/1000 mi) fit Int16');
});
test('aircraft silhouettes: family from the type designator, else the category',async()=>{
  const {silhouetteFamily:f,SILHOUETTES}=await import('../web/silhouettes.mjs');
  const want={A320:'narrow',B38M:'narrow',B789:'wide',A359:'wide',B744:'quad',A124:'quad',CRJ9:'regional',E75L:'regional',
    AT76:'turboprop',DH8D:'turboprop',C56X:'bizjet',C172:'single',PA28:'single',EC45:'heli',C130:'military',C17:'military'};
  for(const [t,fam] of Object.entries(want))assert.equal(f({aircraft_type:t}),fam,t);
  assert.equal(f({category:'A7'}),'heli');assert.equal(f({}),'narrow');
  for(const fam of new Set(Object.values(want)))assert.ok(SILHOUETTES[fam]);
});
test('photos: Planespotters reply parsed, URLs kept unchanged, anything off-host rejected',async()=>{
  const {parsePhoto,PHOTO_URL}=await import('../web/photos.mjs');
  const ok={photos:[{thumbnail:{src:'https://t.plnspttrs.net/06912/1987982_fe0fcc4132_t.jpg',size:{width:200,height:133}},
    thumbnail_large:{src:'https://t.plnspttrs.net/06912/1987982_fe0fcc4132_280.jpg',size:{width:420,height:280}},
    link:'https://www.planespotters.net/photo/1987982/n27270?utm_source=api',photographer:'John Robert Murdoch'}]};
  const p=parsePhoto(ok);
  assert.equal(p.src,'https://t.plnspttrs.net/06912/1987982_fe0fcc4132_280.jpg');
  assert.equal(p.link,'https://www.planespotters.net/photo/1987982/n27270?utm_source=api');
  assert.equal(p.photographer,'John Robert Murdoch');
  assert.equal(parsePhoto({photos:[]}),null);
  assert.equal(parsePhoto({photos:[{...ok.photos[0],thumbnail_large:{src:'https://evil.example/x.jpg'},thumbnail:{src:'https://evil.example/y.jpg'}}]}),null);
  assert.equal(parsePhoto({photos:[{...ok.photos[0],link:'javascript:alert(1)'}]}),null);
  assert.equal(PHOTO_URL('hex','a2b150'),'https://api.planespotters.net/pub/photos/hex/a2b150');
});
test('model photos: bundled per ICAO type with author and license, files present',async()=>{
  const {MODELS,modelPhoto}=await import('../web/models.mjs');
  const {existsSync}=await import('node:fs');
  assert.ok(Object.keys(MODELS).length>=90);
  for(const [t,m] of Object.entries(MODELS)){
    assert.ok(m.author&&m.license&&!/SA/i.test(m.license),t);
    assert.ok(existsSync(new URL(`../web/models/${t}.jpg`,import.meta.url)),t);
  }
  assert.equal(modelPhoto({aircraft_type:'b763'}).src,'models/B763.jpg');
  assert.equal(modelPhoto({aircraft_type:'ZZZZ'}),null);
});
test('model photos: every key is a type code the feed sends; KC-46 only for military B762s',async()=>{
  const {MODELS,MILITARY_MODELS,modelPhoto}=await import('../web/models.mjs');
  const {AIRCRAFT_TYPES}=await import('../web/aircraft-types.mjs');
  const {existsSync}=await import('node:fs');
  for(const t of [...Object.keys(MODELS),...Object.keys(MILITARY_MODELS)])assert.ok(t in AIRCRAFT_TYPES,`${t} is not a type code`);
  for(const [t,m] of Object.entries(MILITARY_MODELS)){
    assert.ok(m.author&&m.license&&!/SA/i.test(m.license),t);
    assert.ok(existsSync(new URL(`../web/models/${m.file}.jpg`,import.meta.url)),t);
  }
  assert.equal(modelPhoto({aircraft_type:'P28A'}).src,'models/P28A.jpg');
  assert.equal(modelPhoto({aircraft_type:'H60'}).src,'models/H60.jpg');
  assert.equal(modelPhoto({aircraft_type:'B762',military:true}).src,'models/KC46.jpg');
  assert.equal(modelPhoto({aircraft_type:'B762',military:true}).model,'Boeing KC-46 Pegasus');
  assert.equal(modelPhoto({aircraft_type:'B762'}),null);
});
test('logbook: Rarest and Farthest follow the map radius; Seen stays local',async()=>{
  const {updateLog,logSummary,setLogRadius,pickRarest,pickFarthest}=await import('../web/model.mjs');
  const p=(hex,type,mi,from)=>({hex,aircraft_type:type,distance_mi:mi,flight:hex.toUpperCase(),altitude_ft:30000,speed_kt:400,
    route:from?{origin:from.code,from:{city:from.city,lat:from.lat,lon:from.lon}}:null});
  const now=Date.UTC(2026,9,28,12),day=new Date(now).toLocaleDateString('en-CA',{timeZone:'UTC'});
  let log=updateLog({day,seen:[],highest:null,fastest:null,typesToday:[],typesAll:{A124:5,C172:9,B77W:0},cargo:{night:null,seen:{}}},
    [p('aaa001','C172',5,{code:'LUK',city:'Near',lat:.1,lon:.1}),p('aaa002','B77W',40,{code:'NGO',city:'Tokoname',lat:34.86,lon:136.8})],now);
  log=updateLog(log,[p('aaa002','B77W',30)],now); // closer later: closest approach kept, origin kept
  assert.equal(log.planes.xaaa002.d,30);assert.equal(log.planes.xaaa002.o.code,'NGO');
  assert.equal(pickRarest(log,15).code,'C172');assert.equal(pickRarest(log,50).code,'B77W');
  assert.equal(pickFarthest(log,15).name,'AAA001');assert.equal(pickFarthest(log,30).from,'Tokoname');
  let r=15;setLogRadius(()=>r);const s=logSummary(log);
  assert.equal(s.today,1,'Seen: only the local plane');
  assert.equal(s.rarest.code,'C172');r=50;assert.equal(s.rarest.code,'B77W','the summary follows a zoom at once');
  assert.equal(updateLog({day,seen:[],typesToday:['A388'],typesAll:{A388:1},cargo:{night:null,seen:{}}},[],now).planes['old-A388'].t,'A388','old logs keep today\'s types');
});
test('alert chime: first entry after a quiet minute only; no ring at launch, while occupied, on flicker or stale data',async()=>{
  const {chimeGate}=await import('../web/core.mjs');
  let s=null,r;const step=(n,t,fresh=true)=>{({state:s,ring:r}=chimeGate(s,n,t,fresh));return r;};
  assert.equal(step(1,0),false,'already occupied at launch');
  assert.equal(step(2,5000),false,'still occupied');
  assert.equal(step(0,10000),false);
  assert.equal(step(1,30000),false,'back after 20 s: flicker, no ring');
  assert.equal(step(0,40000),false);
  assert.equal(step(0,90000,false),false,'stale data changes nothing');
  assert.equal(step(1,101000),true,'first plane after 61 s empty');
  assert.equal(step(2,106000),false,'a second plane while one is inside');
  s=null;assert.equal(step(0,0),false);assert.equal(step(1,61000),true,'empty at launch, then a plane a minute later');
});
test('every built layout script and module parses (a syntax error silently keeps the old layout)',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {readdirSync,readFileSync}=await import('node:fs');
  const vm=await import('node:vm');
  execFileSync(process.execPath,[new URL('../scripts/build-web.mjs',import.meta.url).pathname],{env:{...process.env,WHATSUP_OUT:'/tmp/whatsup-check'}});
  for(const f of readdirSync('/tmp/whatsup-check/layouts').filter(f=>f.endsWith('.js')))
    assert.doesNotThrow(()=>new vm.Script(readFileSync(`/tmp/whatsup-check/layouts/${f}`,'utf8'),{filename:f}),f);
  assert.doesNotThrow(()=>new vm.Script(readFileSync('/tmp/whatsup-check/whatsup.js','utf8')));
});
test('every screen sits inside the themed stage (so layouts can style it)',()=>{
  const s=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  const i=s.indexOf('<div class="stage" id="stage">');let depth=0,end=-1;
  for(const m of s.slice(i).matchAll(/<div\b|<\/div>/g)){depth+=m[0]==='<div'?1:-1;if(!depth){end=i+m.index+m[0].length;break;}}
  const outside=s.slice(end);
  for(const id of ['settings','about','locate','confirm','picker','welcome','adjust-panel','toast','credit-flash'])
    assert.ok(!outside.includes(`id="${id}"`),`#${id} is outside the stage`);
});
test('layout stylesheets never style the shared screens by accident (generic class names scoped to .layout)',()=>{
  const dir=new URL('../web/layouts/',import.meta.url),{readdirSync}=require_fs();
  const shared=['keys','title','row','card','results','entry','note','label','buttons','btn','cols','col','msg','caret'];
  for(const f of readdirSync(dir).filter(f=>f.endsWith('.css'))){
    const css=readFileSync(new URL(f,dir),'utf8');
    for(const c of shared){
      const bad=new RegExp(`\\.L-[a-z-]+ \\.${c}(?![\\w-])`).exec(css.replace(/\\.L-[a-z-]+ \\.layout [^,{]*/g,''));
      assert.ok(!bad,`${f}: ".${c}" must be scoped as .L-x .layout .${c}`);
    }
  }
});
function require_fs(){return {readdirSync:(u)=>globalThis.__fs.readdirSync(u)};}

test('feed etiquette: back-off on errors, 429 at least 60 s, other 4xx 5 min, pause and resume',async()=>{
  const {startLive}=await import('../web/live.mjs');
  const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout,waits=[];let next=null;
  globalThis.setTimeout=(fn,ms)=>{if(fn.name==='poll'){waits.push(ms);next=fn;return 1;}return realSet(fn,ms);};
  globalThis.clearTimeout=id=>{if(id!==1)realClear(id);};
  const replies=[];let calls=0;
  globalThis.fetch=async url=>{calls++;const r=replies.shift()||{status:200,body:{now:Date.now(),ac:[]}};
    return {status:r.status,headers:{get:k=>k==='retry-after'?r.retry||null:null},text:async()=>JSON.stringify(r.body||{}),url};};
  const tick=async()=>{const f=next;next=null;await f?.();await new Promise(r=>realSet(r,5));};
  try{
    replies.push({status:503},{status:503},{status:503},{status:429,retry:'120'},{status:404},{status:200,body:{now:Date.now(),ac:[{hex:'abc123'}]}});
    const live=startLive(()=>{}, {latitude:39.05,longitude:-84.67,radiusMiles:3,pollSeconds:5,searchNm:15});
    await new Promise(r=>realSet(r,20));
    for(let i=0;i<5;i++)await tick();
    // 503s: ~5 s, ~10 s, ~20 s (±20% jitter); 429 with Retry-After 120: 120 s; 404: 300 s
    assert.ok(waits[0]>=4000&&waits[0]<=6000,`first back-off ${waits[0]}`);
    assert.ok(waits[1]>=8000&&waits[1]<=12000,`second back-off ${waits[1]}`);
    assert.ok(waits[2]>=16000&&waits[2]<=24000,`third back-off ${waits[2]}`);
    assert.equal(waits[3],120000,'429 honours Retry-After');
    assert.equal(waits[4],300000,'other 4xx waits 5 min');
    live.pause();const before=calls;await tick();
    assert.equal(calls,before,'nothing is polled while paused');
    live.resume();await new Promise(r=>realSet(r,20));
    assert.equal(waits.at(-1),0,'after a good reply, resume polls at once');
    await tick();assert.ok(calls>before);
    replies.push({status:429,retry:'120'});await tick();
    live.pause();live.resume();
    assert.ok(waits.at(-1)>115000,`resume keeps the 429 pause (${waits.at(-1)})`);
    live.stop();
  }finally{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;delete globalThis.fetch;}
});

test('clock skew: a TV clock a minute, or days, off the feed still shows the planes',async()=>{
  const {startLive}=await import('../web/live.mjs');
  for(const off of [-60000,60000,-3*86400000,3*86400000,-25*3600000]){
    globalThis.fetch=async url=>({status:200,headers:{get:()=>null},url,
      text:async()=>JSON.stringify({now:Date.now()+off,ac:[{hex:'abc123',lat:39.05,lon:-84.67,alt_baro:3000,seen_pos:0.5,flight:'TST1'}]})});
    const got=await new Promise(resolve=>{
      const live=startLive((states,ok)=>{if(ok){live?.stop?.();resolve(states);}},{latitude:39.05,longitude:-84.67,radiusMiles:3,pollSeconds:5,searchNm:15});
    });
    assert.ok(Math.abs(got.skew*1000-off)<2000,`skew measured (${got.skew})`);
    assert.equal(got['sensor.aircraft_candidate']?.state??got[Object.keys(got).find(k=>/candidate/.test(k))].state,'abc123',`plane kept with the feed ${off>0?'ahead':'behind'}`);
  }
  delete globalThis.fetch;
});

test('logbook: the 4000-plane cap drops the oldest, all-digit hexes included',async()=>{
  const {updateLog}=await import('../web/model.mjs');
  const now=Date.UTC(2026,9,28,12),day=new Date(now).toLocaleDateString('en-CA',{timeZone:'UTC'});
  let log=updateLog({day,seen:[],highest:null,fastest:null,typesToday:[],typesAll:{},cargo:{night:null,seen:{}}},[{hex:'123456',distance_mi:5,aircraft_type:'B738'}],now);
  for(let i=0;i<4000;i++)log=updateLog(log,[{hex:(0xa00000+i).toString(16),distance_mi:5}],now);
  assert.ok(!log.planes.x123456,'the first plane (all digits) was the one dropped');
  assert.ok(log.planes['xa00f9f'],'the newest kept');
  log=updateLog(log,[{hex:'654321',distance_mi:5,aircraft_type:'B738'}],now);
  assert.equal(log.typesAll.B738,2,'a new plane counts once');
  log=updateLog(log,[{hex:'654321',distance_mi:5,aircraft_type:'B738'}],now);
  assert.equal(log.typesAll.B738,2,'and is not counted again while kept');
});

test('route lookups: text cleaned, codes checked, cached a day, capped', async () => {
  const {Ledger,text}=await import('../web/live.mjs');
  assert.equal(text('Cin‮cy​ \u0007Nor\nthern﻿',80),'Cincy Northern');
  assert.equal(text('x'.repeat(200),60).length,60);
  const L=new Ledger();
  for(let i=0;i<900;i++)L.put('lol:C'+i,{},1000+i,0);
  L.pruned=-100;L.put('x',1,5000,0);
  assert.equal([...L.rows.keys()].filter(k=>k.startsWith('lol:')).length,800);
  assert.equal(L.get('lol:C899',0)!==undefined,true); // the latest-expiring are kept
});

test('map tiles: at most 4 requests at once, and a 429 pauses them all', async () => {
  const {getBytes,tileStats}=await import('../web/live.mjs');
  const real=globalThis.fetch;let now=0,peak=0,calls=0,status=200;
  globalThis.fetch=async()=>{calls++;now++;peak=Math.max(peak,now);await new Promise(r=>setTimeout(r,20));now--;
    return {status,arrayBuffer:async()=>new ArrayBuffer(8)};};
  try{
    const got=await Promise.all(Array.from({length:12},(_,i)=>getBytes('https://tiles.openfreemap.org/planet/x/1/1/'+i+'.pbf')));
    assert.equal(peak,4);assert.ok(got.every(b=>b&&b.length===8));assert.ok(tileStats.peak<=4);
    status=429;assert.equal(await getBytes('https://tiles.openfreemap.org/planet/x/1/1/1.pbf'),null);
    const before=calls;status=200;
    assert.equal(await getBytes('https://tiles.openfreemap.org/planet/x/1/1/2.pbf'),null); // cooling down
    assert.equal(calls,before);
  }finally{globalThis.fetch=real;}
});

test('airspace keeps the heading (a comment once swallowed it)', async () => {
  const {airspace,IDS}=await import('../web/core.mjs');
  const now=1700000000;
  const states={[IDS.feed]:{state:String(now),attributes:{ac:[{hex:'abc123',lat:39.06,lon:-84.65,alt_baro:5000,seen_pos:0,gs:200,track:450}]}},
    [IDS.home]:{attributes:{latitude:39.05,longitude:-84.65}},[IDS.radius]:{state:'3'}};
  const [a]=airspace(states,now*1000,true).all;
  assert.equal(a.heading,90);assert.equal(a.speed_kt,200);
});

test('military: dbFlags bit 1, counted once a day in the local area, by type, count first', async () => {
  const {isMilitary,shortType,updateLog,logSummary}=await import('../web/model.mjs');
  const {militaryAlts}=await import('../web/kit.mjs');
  assert.equal(isMilitary({dbFlags:1}),true);assert.equal(isMilitary({dbFlags:3}),true);
  assert.equal(isMilitary({dbFlags:2}),false);assert.equal(isMilitary({}),false);assert.equal(isMilitary(null),false);
  assert.equal(shortType('C17'),'C-17');assert.equal(shortType('K35R'),'KC-135');
  const now=new Date(2026,9,29,15).getTime();
  const p=(hex,t,mi)=>({hex,aircraft_type:t,military:true,distance_mi:mi,flight:'RCH1',altitude_ft:10000,speed_kt:300});
  let log=updateLog(null,[p('ae0001','C17',3),p('ae0002','C17',5),p('ae0003','K35R',9),p('ae0004','C17',40)],now);
  log=updateLog(log,[p('ae0001','C17',2)],now+60000); // the same aircraft again: once
  let L=logSummary(log);
  assert.equal(L.militaryToday,3);assert.deepEqual(L.militaryTypes,[['C-17',2],['KC-135',1]]);
  assert.deepEqual(militaryAlts(L),['2 C-17 · 1 KC-135','2 C-17']);
  assert.deepEqual(militaryAlts({militaryTypes:[]}),['none yet']);
  log=updateLog(log,[],new Date(2026,9,30,0,5).getTime()); // after midnight: a new day
  assert.equal(logSummary(log).militaryToday,0);
});
test('satellite credit: US imagery is credited as the USGS service asks, on screen and on the credits page',async()=>{
  const {readFileSync}=await import('node:fs');
  const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8'),credits=readFileSync(new URL('../scripts/build-credits.mjs',import.meta.url),'utf8');
  assert.match(app,/'Imagery: USDA, USGS The National Map'/);
  assert.match(credits,/USDA, USGS The National Map/);
  assert.doesNotMatch(app,/'Imagery: USGS'/);
});
test('styles: the busy cog\'s rules target the cog only, so the search screen\'s "Searching for …" message (class "msg busy") stays in its column',async()=>{
  const {readFileSync}=await import('node:fs');
  const css=readFileSync(new URL('../web/whatsup.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/(^|\})\s*\.busy(\{|\s|\.on|\s+svg)/m,'no bare .busy rule');
  assert.match(css,/#busy\{position:absolute/);
});
test('ledger: damaged saved rows are ignored, so the feed still starts',async()=>{
  const {Ledger}=await import('../web/live.mjs');
  for(const saved of [{'route:abc':null,'lol:UAL1':{expires:'never',value:5},'route:ok':{expires:2e9,value:{origin:'CVG'}}},[1,2],'x',null,{'route:x':7}]){
    const l=new Ledger(saved);
    assert.doesNotThrow(()=>l.routes(1e9),JSON.stringify(saved));
    assert.doesNotThrow(()=>l.put('route:new',{origin:'ORD'},2e9,1e9),JSON.stringify(saved));
  }
  assert.deepEqual(new Ledger({'route:abc':null,'route:ok':{expires:2e9,value:{origin:'CVG'}}}).routes(1e9),[{origin:'CVG'}]);
});
test('map cache list: a damaged "recent maps" value counts as none (no rebuild loop)',async()=>{
  const {readFileSync}=await import('node:fs');
  const src=readFileSync(new URL('../web/mapgen.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/store\.get\(RECENT_KEY\)\|\|\[\]/,'every read goes through recentMaps()');
  assert.match(src,/Array\.isArray\(r\)\?r:\[\]/);
});
test('map: when every tile comes back empty (a 200 with nothing), the build fails instead of saving a blank map',async()=>{
  const {buildMap,buildDetail}=await import('../web/mapgen.mjs');
  const {VectorTile}=await import('../vendor/node_modules/@mapbox/vector-tile/index.js');
  const {default:Pbf}=await import('../vendor/node_modules/pbf/index.js');
  const net={getJson:async()=>({status:200,payload:{tiles:['https://tiles.openfreemap.org/planet/20260101_001001_pt/{z}/{x}/{y}.pbf']}}),getBytes:async()=>new Uint8Array(0)};
  await assert.rejects(buildMap({latitude:39.10,longitude:-84.41},10,{net,MVT:{VectorTile,Pbf}}),/map tiles empty/);
  await assert.rejects(buildDetail({latitude:39.10,longitude:-84.41},{net,MVT:{VectorTile,Pbf}}),/map tiles empty/);
});
test('styles: a very long one-word place name wraps on the welcome and confirm cards instead of running off the screen',async()=>{
  const {readFileSync}=await import('node:fs');
  assert.match(readFileSync(new URL('../web/whatsup.css',import.meta.url),'utf8'),/\.big-city\{[^}]*overflow-wrap:anywhere/);
});
