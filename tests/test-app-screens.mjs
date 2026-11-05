// node --test tests/  — app.mjs screen logic on its own: each function is cut from the source and
// run in a vm, with stubs for the page around it (the DOM, the feed, the other screens).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const APP=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
// A top-level function or line of app.mjs as written (a function ends at the first "}" in column 0).
const fn=name=>{const m=new RegExp(`^(async )?function ${name}\\(.*?\\n\\}`,'ms').exec(APP);assert.ok(m,`function ${name} in app.mjs`);return m[0];};
const line=start=>{const m=new RegExp(`^${start}.*$`,'m').exec(APP);assert.ok(m,`${start} in app.mjs`);return m[0];};
// A context with those functions; setText(id,v) lands in `texts`.
function page(code,globals={}){
  const texts={},ctx=vm.createContext({texts,setText:(id,v)=>{texts[id]=String(v??'');},console:{error(){}},...globals});
  vm.runInContext(code.join('\n'),ctx);
  return ctx;
}

test('search entry: at most 40 characters, Space included; Space never leads or doubles',()=>{
  const p=page([line('let entry='),fn('typeKey')],{clearTimeout(){},setTimeout(){},runSearch(){}});
  const type=(...keys)=>{for(const k of keys)p.typeKey(k);return vm.runInContext('entry',p);};
  const W40='W'.repeat(40);
  assert.equal(type(...Array(45).fill('W')),W40);
  assert.equal(type('space'),W40,'Space at the cap is ignored');
  assert.equal(type('X'),W40);
  assert.equal(p.texts['entry-text'],W40,'as shown');
  assert.equal(type('del','space','space'),W40.slice(1)+' ','below the cap Space works, once');
  assert.equal(type('clear','space','A','space','space','B'),'A B');
});

test('welcome card: the lookup\'s accuracy reads as whole miles or km, at least 1; none, zero, negative or absurd says nothing',()=>{
  const p=page([fn('showWelcome')],{settings:{distance:'mi'},placeLabel:pl=>pl.name,open(){}});
  const claim=(accuracyKm,unit='mi')=>{p.settings.distance=unit;p.showWelcome({name:'Chicago',accuracyKm});
    const note=p.texts['welcome-note'];assert.match(note,/^A first guess from your internet connection(?: \(the lookup claims within \d+ (?:mi|km)\))?\. Internet locations/,note);
    return /within (\d+ (?:mi|km))/.exec(note)?.[1]??null;};
  for(const [acc,mi,km] of [[.4,'1 mi','1 km'],[5,'3 mi','5 km'],[20.6,'13 mi','21 km'],[1000,'621 mi','1000 km'],[1e-9,'1 mi','1 km']]){
    assert.equal(claim(acc),mi,`${acc} km in miles`);assert.equal(claim(acc,'km'),km,`${acc} km`);
  }
  for(const acc of [null,undefined,0,-1,-5,NaN,Infinity,-Infinity,1e21,5000])for(const unit of ['mi','km'])assert.equal(claim(acc,unit),null,`${acc} (${unit})`);
});

test('choosing a place: a move of a few hundred metres across the date line keeps today\'s logbook and \'Recently above\', and the map is drawn where it was built',async()=>{
  const {dLon}=await import('../web/core.mjs'),{mapShift}=await import('../web/kit.mjs');
  const calls=[];
  const p=page([fn('choosePlace')],{dLon,settings:{},saveSettings(){},useSettings(){},closeAll(){},mapsChanged(){},refreshLayout(){},refineZone:async()=>null,
    applyPlace:(pl,o)=>{calls.push(o?.fresh?'fresh':'apply');},restartFeed:()=>{calls.push('feed');}});
  const move=(from,[latitude,longitude])=>{calls.length=0;p.settings={place:from&&{latitude:from[0],longitude:from[1]}};p.choosePlace({latitude,longitude});return calls.join();};
  // An Adjust position save: endAdjust brings the longitude back within ±180.
  for(const [from,to] of [[[0,180],[0,-179.99955]],[[0,179.999],[0,-179.99381]],[[0,-179.999],[0,179.99381]],[[-16.8,179.999],[-16.8,-179.996]],[[41.85003,-87.65005],[41.85003,-87.6404]]])
    assert.equal(move(from,to),'apply',`${from} -> ${to}: same home, moved`);
  assert.equal(move([0,180],[0,-180]),'feed','the same point');
  for(const [from,to] of [[[0,179.99],[0,-179.95]],[[0,-179.99],[0,179.9]],[[41.85,-87.65],[41.9,-87.65]]])assert.equal(move(from,to),'fresh',`${from} -> ${to}: a new home`);
  assert.equal(move(null,[0,180]),'fresh','the first place');
  // A map built at 180 drawn for -179.99955 (50 m east): 0.03 mi to the west, not round the world.
  const [x,y]=mapShift({latitude:0,longitude:180},{latitude:0,longitude:-179.99955});
  assert.ok(Math.abs(x+.0311)<.001&&y===0,`shift ${x},${y}`);
  assert.deepEqual(mapShift({latitude:0,longitude:-179.99955},{latitude:0,longitude:180}).map(v=>Math.round(v*1000)),[31,0],'and the other way');
  const [cx]=mapShift({latitude:41.85,longitude:-87.65},{latitude:41.85,longitude:-87.64});
  assert.ok(Math.abs(cx+.515)<.001,`away from the date line as before: ${cx}`);
});

test('Adjust position from a search result, then Back: the confirm card over the screens that were under it; with no saved place, over a search screen at least',()=>{
  const seen=[];
  const p=page([fn('endAdjust')],{adj:null,settings:{},lastModel:null,stage:{classList:{remove(){}}},$:()=>({replaceChildren(){}}),syncApp(){},showSettings(){},
    open:id=>seen.push(id),openLocate:()=>seen.push('search'),confirmPlace:()=>seen.push('confirm')});
  const back=(under,place=null)=>{seen.length=0;p.settings={place};p.adj={from:'confirm',under:under.map(id=>[{id}]),place:{latitude:41.85,longitude:-87.65}};p.endAdjust();return seen.join();};
  assert.equal(back(['locate']),'locate,confirm','first run, lookup failed');
  assert.equal(back(['welcome','locate']),'welcome,locate,confirm','first run, the welcome card');
  assert.equal(back(['settings','locate'],{latitude:1,longitude:2}),'settings,locate,confirm','saved home');
  assert.equal(back([],{latitude:1,longitude:2}),'confirm');
  assert.equal(back([]),'search,confirm','no saved place: Search again has a search screen to return to');
  assert.equal(back(['welcome']),'welcome,search,confirm');
});

// Adjust position from `let adj=null;` to the end of startAdjust, and nudge; drawing is a stub.
async function adjustPage(globals){
  const {dLon}=await import('../web/core.mjs');
  const region=/^let adj=null;$[\s\S]*?^async function startAdjust\([\s\S]*?\n\}/m.exec(APP)?.[0];assert.ok(region,'startAdjust in app.mjs');
  return page([line('const ADJ_RANGE='),line('const ADJ_MAX_M='),region,fn('nudge')],{dLon,performance:{now:()=>0},layers:[],closeAll(){},makeCanvas:()=>({}),
    $:()=>({replaceChildren(){}}),stage:{classList:{add(){}}},drawAdjust(){},syncApp(){},...globals});
}
test('Adjust position: its street map is built once per place (within ~1 km, as the saved maps) and kept for 30 days, so opening it again sends OpenFreeMap nothing',async()=>{
  const builds=[];let fail=false,now=0;
  const p=await adjustPage({performance:{now:()=>now},
    buildMap:async(place,range,o)=>{builds.push({range,...o});await new Promise(r=>setTimeout(r,5));if(fail)throw new Error('map tile unavailable');return {latitude:place.latitude,longitude:place.longitude,n:builds.length};}});
  const back=()=>vm.runInContext('adj=null',p);
  const open=async place=>{back();await p.startAdjust(place);return {map:vm.runInContext('adj',p)?.map,note:p.texts['adjust-note']};};
  const CHI={latitude:41.85003,longitude:-87.65005};
  const first=await open(CHI);
  assert.ok(first.map&&first.note==='',first.note);assert.deepEqual(builds[0],{range:1.5,zoom:13,detail:true});
  for(let i=0;i<2;i++)assert.equal((await open(CHI)).map,first.map);
  assert.equal(builds.length,1,'opened three times, built once');
  assert.equal((await open({...CHI,longitude:-87.6404})).map,first.map,'the home moved 800 m east: the same map');
  assert.equal(builds.length,1);
  const dl=await open({latitude:0,longitude:180});
  assert.equal((await open({latitude:0,longitude:-179.99955})).map,dl.map,'50 m east across the date line: the same map');
  assert.equal(builds.length,2);
  await open(CHI);await open({...CHI,latitude:41.877});
  assert.equal(builds.length,4,'3 km away: a map of its own');
  // Back before it lands, then open again: one build, and the screen gets it.
  const NYC={latitude:40.71,longitude:-74.0};back();const early=p.startAdjust(NYC);
  const late=await open(NYC);await early;
  assert.equal(builds.length,5);assert.equal(late.map?.n,5);
  // A failed build is tried again on the next open; one older than 30 days is built again.
  const DEN={latitude:39.74,longitude:-104.99};fail=true;
  assert.deepEqual(await open(DEN),{map:null,note:'Street map unavailable'});fail=false;
  const den=await open(DEN);assert.equal(builds.length,7);assert.ok(den.map&&den.note==='');
  now+=29*864e5;assert.equal((await open(DEN)).map,den.map);now+=2*864e5;await open(DEN);
  assert.equal(builds.length,8,'after 30 days: built again');
});

test('Adjust position: at the 800 m limit the note says so, also while the street map loads or after it failed; back inside, the map\'s own note returns',async()=>{
  let build;
  const p=await adjustPage({buildMap:()=>new Promise((res,rej)=>{build={res,rej};})});
  const LIMIT='As far as fine-tuning goes. To move farther, change Location.',note=()=>p.texts['adjust-note'];
  const toLimit=()=>{for(let i=0;i<30;i++)p.nudge('right',i>0);};
  for(const [tag,lat,end,after] of [['failed',30,b=>b.rej(new Error('map tile unavailable')),'Street map unavailable'],['loaded',35,b=>b.res({latitude:35,longitude:-90}),'']]){
    vm.runInContext('adj=null',p);const opened=p.startAdjust({latitude:lat,longitude:-90});
    assert.equal(note(),'Loading street map',tag);
    toLimit();assert.equal(note(),LIMIT,`${tag}: at the limit while it loads`);
    p.nudge('left');assert.equal(note(),'Loading street map',`${tag}: back inside while it loads`);
    end(build);await opened;assert.equal(note(),after,tag);
    p.nudge('up');assert.equal(note(),after,`${tag}: inside`);
    toLimit();assert.equal(note(),LIMIT,`${tag}: at the limit`);
    p.nudge('left');assert.equal(note(),after,`${tag}: back inside`);
  }
});
