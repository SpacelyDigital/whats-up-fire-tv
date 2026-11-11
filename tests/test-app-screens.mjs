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
  const p=page([fn('showWelcome')],{settings:{distance:'mi'},placeLabel:pl=>pl.name,open(){},$:()=>({}),fitLine(){}});
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
  let damaged=false;
  const p=page([fn('choosePlace')],{dLon,settings:{},saveSettings(){},useSettings(){},closeAll(){},mapsChanged(){},refreshLayout(){},refineZone:async()=>null,
    placeDamaged:()=>damaged,applyPlace:(pl,o)=>{calls.push(o?.fresh?'fresh':'apply');},restartFeed:()=>{calls.push('feed');}});
  const move=(from,[latitude,longitude])=>{calls.length=0;p.settings={place:from&&{latitude:from[0],longitude:from[1]}};p.choosePlace({latitude,longitude});return calls.join();};
  // An Adjust position save: endAdjust brings the longitude back within ±180.
  for(const [from,to] of [[[0,180],[0,-179.99955]],[[0,179.999],[0,-179.99381]],[[0,-179.999],[0,179.99381]],[[-16.8,179.999],[-16.8,-179.996]],[[41.85003,-87.65005],[41.85003,-87.6404]]])
    assert.equal(move(from,to),'apply',`${from} -> ${to}: same home, moved`);
  assert.equal(move([0,180],[0,-180]),'feed','the same point');
  for(const [from,to] of [[[0,179.99],[0,-179.95]],[[0,-179.99],[0,179.9]],[[41.85,-87.65],[41.9,-87.65]]])assert.equal(move(from,to),'fresh',`${from} -> ${to}: a new home`);
  assert.equal(move(null,[0,180]),'fresh','the first place');
  // The saved place couldn't be read (the feed runs on the IP guess with what it logged): a place chosen through Change
  // starts afresh however close to the guess, as Confirm on the guess does.
  damaged=true;
  assert.equal(move([41.85003,-87.65005],[41.85003,-87.6404]),'fresh','1 mi from the guess, a damaged saved place');
  assert.equal(move([41.85003,-87.65005],[41.85003,-87.65005]),'fresh','the guess itself');
  damaged=false;
  // A map built at 180 drawn for -179.99955 (50 m east): 0.03 mi to the west, not round the world.
  const [x,y]=mapShift({latitude:0,longitude:180},{latitude:0,longitude:-179.99955});
  assert.ok(Math.abs(x+.0311)<.001&&y===0,`shift ${x},${y}`);
  assert.deepEqual(mapShift({latitude:0,longitude:-179.99955},{latitude:0,longitude:180}).map(v=>Math.round(v*1000)),[31,0],'and the other way');
  const [cx]=mapShift({latitude:41.85,longitude:-87.65},{latitude:41.85,longitude:-87.64});
  assert.ok(Math.abs(cx+.515)<.001,`away from the date line as before: ${cx}`);
});

test('applying a place: maps built at the date line are kept for a home 50 m across it (no tiles fetched again); a new home gets its own',async()=>{
  const {dLon}=await import('../web/core.mjs');
  const built=[],ctx={dLon,placeToken:0,chime:null,feed:null,maps:{},store:{remove(){}},HISTORY_KEY:'h',resetLog(){},mapMiles:()=>10,detailFits:()=>true,detailSpec:()=>({}),
    savedMap:()=>null,mapsChanged(){},active:null,ensureDetail(){},detailToken:0,detailBusy:false,detailTries:0,detailRetry:0,clearTimeout(){},start:()=>({stop(){}}),feedConfig(){},render(){},
    demo:false,buildMap:async place=>{built.push(place);return {latitude:place.latitude,longitude:place.longitude,range:10};},saveMap(){},flashCredits(){},STALE:'stale',detailNote:()=>''};
  const p=page([fn('applyPlace')],ctx);
  const apply=async([lat,lon],[latitude,longitude])=>{
    const base={latitude:lat,longitude:lon,range:10},detail={latitude:lat,longitude:lon};p.maps={base,detail};p.feed=null;built.length=0;
    await p.applyPlace({latitude,longitude});
    return p.maps.base===base&&p.maps.detail===detail&&!built.length?'kept':'rebuilt';
  };
  for(const [from,to] of [[[0,180],[0,-179.99955]],[[0,-180],[0,179.99955]],[[-16.8,179.999],[-16.8,-179.996]],[[41.85,-87.65],[41.85,-87.645]]])
    assert.equal(await apply(from,to),'kept',`map at ${from}, home at ${to}`);
  for(const [from,to] of [[[0,179.99],[0,-179.98]],[[41.85,-87.65],[41.877,-87.65]],[[0,180],[0,0]]])
    assert.equal(await apply(from,to),'rebuilt',`map at ${from}, home at ${to}`);
});

test('applying a place: a saved base map put on screen (a fresh one, or an older one shown while a new one is built) is stamped the newest (touchMap), so storage filling up never evicts the map on screen; one kept in memory or built is not stamped here (saveMap stamps the one built)',async()=>{
  const {dLon}=await import('../web/core.mjs');
  const place={latitude:41.85,longitude:-87.65},base={...place,range:10},stamped=[],built=[];let saved={};
  const p=page([fn('applyPlace')],{dLon,placeToken:0,chime:null,feed:null,maps:{},store:{remove(){}},HISTORY_KEY:'h',resetLog(){},mapMiles:()=>10,detailFits:()=>true,detailSpec:()=>({}),
    savedMap:(pl,range,{stale=false}={})=>saved[stale?'stale':'fresh']??null,touchMap:r=>stamped.push(r),mapsChanged(){},active:null,ensureDetail(){},detailToken:0,detailBusy:false,detailTries:0,detailRetry:0,
    clearTimeout(){},start:()=>({stop(){}}),feedConfig(){},render(){},demo:false,buildMap:async()=>{built.push(1);return {...base};},saveMap(){},flashCredits(){},STALE:'stale',detailNote:()=>''});
  const apply=async(s,inMemory=null)=>{saved=s;stamped.length=built.length=0;p.maps={base:inMemory};p.feed=null;await p.applyPlace(place);return `${stamped.join()||'-'} ${built.length?'built':'not built'}`;};
  assert.equal(await apply({fresh:base,stale:base}),'10 not built','a fresh saved map: trusted and stamped');
  assert.equal(await apply({stale:{...base,built:0}}),'10 built','an older saved map shown while a new one is built: stamped');
  assert.equal(await apply({}),'- built','nothing saved: nothing to stamp');
  assert.equal(await apply({fresh:base,stale:base},base),'- not built','the map already in memory: nothing to stamp');
  assert.equal(await apply({},{...base,range:5}),'- built','a map of another radius in memory shows meanwhile: not stamped for this radius');
});
test('the street map\'s note stays while it is drawn: the base map landing first or a base-map layout in between doesn\'t clear it; a failure says so only on a street-map layout; the base map\'s note wins',async()=>{
  const {dLon}=await import('../web/core.mjs');
  const builds=[],bases=[],settle=()=>new Promise(r=>setImmediate(r)),place={latitude:41.85,longitude:-87.65};
  const MODS={blueprint:{map:'detail'},swiss:{},radar:{}};for(const m of Object.values(MODS))Object.assign(m,{mount(){},setMap(){}});
  const p=page([line('let active=null'),line('let detailToken=0'),line('const detailNote='),fn('useLayout'),fn('ensureDetail'),fn('applyPlace')],{dLon,registry:{},codeOf:id=>id,
    settings:{place:null},maps:{},mapMiles:()=>10,detailSpec:()=>({key:'r10'}),detailFits:()=>true,hasDetail:()=>false,savedDetail:()=>null,decodeDetail:m=>m,saveDetail(){},mapsChanged(){},STALE:'stale',
    buildDetail:()=>new Promise((res,rej)=>builds.push({res,rej})),buildMap:()=>new Promise((res,rej)=>bases.push({res,rej})),savedMap:()=>null,saveMap(){},
    placeToken:0,chime:null,feed:null,store:{remove(){}},HISTORY_KEY:'h',resetLog(){},start:()=>({stop(){}}),feedConfig(){},render(){},demo:false,flashCredits(){},
    clearTimeout(){},setTimeout(){},requestAnimationFrame(){},validLayout:id=>id,unloadExcept(){},busyNow:false,loadLayout:async id=>MODS[id],sheetsOf:id=>[id],
    stage:{classList:{add(){},remove(){}},dataset:{}},root:{replaceChildren(){}},pruneFitted(){},ctx:{},lastModel:null,adj:null,paintEdge(){},refitScreens(){}});
  p.$=id=>({classList:{add(){},remove(){}},get textContent(){return p.texts[id]??'';}});
  const note=()=>p.texts['layout-note']??'',layout=async id=>{await p.useLayout(id);await settle();};
  await layout('blueprint');p.settings.place=place;p.applyPlace(place);await settle();
  assert.equal(note(),'Drawing the street map');
  bases.shift().res({latitude:place.latitude,longitude:place.longitude,range:10});await settle();
  assert.equal(note(),'Drawing the street map','the base map landed first: the street map is still being drawn');
  await layout('swiss');assert.equal(note(),'','not on a layout without a street map');
  await layout('blueprint');assert.equal(note(),'Drawing the street map','back on Blueprint while it is still drawn');
  await layout('radar');builds.shift().rej(new Error('map tile unavailable'));await settle();
  assert.equal(note(),'','a failure seen from Radar writes nothing there');
  await layout('blueprint');assert.equal(note(),'Drawing the street map','tried again on Blueprint');
  builds.shift().rej(new Error('map tile unavailable'));await settle();
  assert.equal(note(),'Street map unavailable, trying again soon');
  p.maps.base=null;p.applyPlace(place);await settle();bases.shift().rej(new Error('tilejson 500'));await settle();
  assert.equal(note(),'Map unavailable','both failing: the base map\'s note wins');
  builds.shift().rej(new Error('map tile unavailable'));await settle();
  assert.equal(note(),'Map unavailable');
});
test('Adjust position from a search result, then Back: the confirm card over the screens that were under it; with no saved place, over a search screen at least',()=>{
  const seen=[];
  const p=page([fn('endAdjust')],{adj:null,adjSay:0,clearTimeout(){},settings:{},lastModel:null,stage:{classList:{remove(){}}},$:()=>({replaceChildren(){}}),syncApp(){},showSettings(){},
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
async function adjustPage(globals,more=[]){
  const {dLon}=await import('../web/core.mjs');
  const region=/^let adj=null;$[\s\S]*?^async function startAdjust\([\s\S]*?\n\}/m.exec(APP)?.[0];assert.ok(region,'startAdjust in app.mjs');
  return page([line('const ADJ_RANGE='),line('const ADJ_MAX_M='),region,line('let adjSay='),fn('nudge'),...more],{dLon,performance:{now:()=>0},layers:[],layer:null,focused:null,closeAll(){},makeCanvas:()=>({}),
    $:()=>({replaceChildren(){},focus(){}}),stage:{classList:{add(){}}},drawAdjust(){},syncApp(){},setTimeout:()=>0,clearTimeout(){},...globals});
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

test('a map that can\'t be built for want of the network (no TileJSON, a portal, a tile not fetched) is logged as a warning, by the base map, the street map and Adjust position; any other failure stays an error',async()=>{
  const {buildMap}=await import('../web/mapgen.mjs');
  const TJ={status:200,payload:{tiles:['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf']}};
  const MVT={VectorTile:class{constructor(){throw new TypeError('bad tile');}},Pbf:class{}};
  const fail=(json,bytes)=>buildMap({latitude:39.05,longitude:-84.41},10,{net:{getJson:async()=>json,getBytes:async()=>bytes},MVT}).then(()=>assert.fail('built'),e=>e);
  const cases=[['tilejson connection_error',await fail({status:'connection_error',payload:null}),'warn'],['tilejson invalid',await fail({status:'invalid',payload:null}),'warn'],
    ['tilejson 503',await fail({status:503,payload:null}),'warn'],['map tile unavailable',await fail(TJ,null),'warn'],['bad tile',await fail(TJ,new Uint8Array(1)),'error']];
  const run=async(make,e)=>{const logs=[];const console={warn:(...a)=>logs.push(['warn',...a]),error:(...a)=>logs.push(['error',...a])};
    await make(console,e);await new Promise(r=>setTimeout(r,10));return logs;};
  const place={latitude:39.05,longitude:-84.41};
  const base=(console,e)=>{page([fn('applyPlace')],{console,dLon:()=>0,placeToken:0,chime:null,feed:null,maps:{},mapMiles:()=>10,detailFits:()=>true,detailSpec:()=>({}),savedMap:()=>null,
    mapsChanged(){},active:null,ensureDetail(){},detailToken:0,detailBusy:false,detailTries:0,detailRetry:0,clearTimeout(){},setTimeout(){},start:()=>({stop(){}}),feedConfig(){},render(){},demo:false,buildMap:async()=>{throw e;},STALE:'stale'}).applyPlace(place);};
  const detail=(console,e)=>page([line('const detailNote='),fn('ensureDetail')],{console,settings:{place},maps:{},mapMiles:()=>10,detailSpec:()=>({}),savedDetail:()=>null,detailToken:0,detailBusy:false,detailTries:0,detailRetry:0,detailLater:null,
    baseNote:'',active:null,clearTimeout(){},setTimeout(){},buildDetail:async()=>{throw e;},STALE:'stale'}).ensureDetail();
  const adjust=async(console,e)=>(await adjustPage({console,buildMap:async()=>{throw e;}})).startAdjust(place);
  for(const [what,make] of [['map',base],['detail map',detail],['adjust map',adjust]])for(const [msg,e,level] of cases){
    assert.equal(e.message,msg);
    assert.deepEqual(await run(make,e),[[level,what,msg]],`${what}: ${msg}`);
  }
});

// localStorage as the page sees it: the app's keys are own properties (Object.keys lists them).
const shelf=(items={})=>Object.assign(Object.create({getItem(k){return Object.hasOwn(this,k)?this[k]:null;},removeItem(k){delete this[k];}}),items);
test('Privacy offers Erase all data whenever anything of the app\'s is stored, also when the saved consent is of an older version, damaged or missing; a fresh TV hides it',()=>{
  const els={};const $=id=>els[id]??={hidden:null};
  const p=page([line('const CONSENT_KEY='),line('function hasConsent\\('),line('const anyStored='),fn('openPrivacy')],{$,renderDoc(){},scrollDoc(){},window:{},PRIVACY_URL:'',themedQr(){},open(){},localStorage:null});
  const offered=items=>{if(items)p.localStorage=shelf(items);else Object.defineProperty(p,'localStorage',{get(){throw new Error('SecurityError');}});
    p.openPrivacy();return !els['privacy-erase'].hidden;};
  const SET=JSON.stringify({mapMiles:25});
  assert.equal(offered({'whatsup.consent':'{"v":3,"at":"2026-11-05"}'}),true,'agreed');
  for(const [tag,items] of [['Version 1',{'whatsup.consent':'{"v":1}','whatsup.settings.v1':SET}],['damaged',{'whatsup.consent':'{"v":','whatsup.history.v1':'[]'}],
    ['missing',{'whatsup.settings.v1':SET,'whatsup.logbook.v1':'{}'}],['a newer version',{'whatsup.consent':'{"v":9}'}]])assert.equal(offered(items),true,`consent ${tag}, data stored`);
  assert.equal(offered({}),false,'a fresh TV');
  assert.equal(offered({'other.app':'1'}),false,'another app\'s keys only');
  assert.equal(offered(null),false,'storage refused');
});

test('After Erase all data the fresh consent screen ignores OK until a key is released on it or 0.8 s has passed; the next launch takes OK at once',()=>{
  const session=new Map(),sessionStorage={getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k)};
  let now=1000,agreed=0;
  // One page load: the consent lines, askConsent and select cut from app.mjs; agree() counts.
  const load=(globals={})=>{
    const keyup=[];
    return Object.assign(page([line('let consentDone=null'),line('const ERASED_KEY='),line("addEventListener\\('keyup'"),fn('askConsent'),fn('select'),fn('eraseAll')],
      {performance:{now:()=>now},sessionStorage,$:()=>({}),PROFILE:{consent:'Agree?'},open(){},agree:()=>{agreed++;},addEventListener:(type,f)=>{if(type==='keyup')keyup.push(f);},...globals}),{keyup});
  };
  const ok=p=>{const was=agreed;p.select({id:'consent-ok',dataset:{}});return agreed>was;};
  // Erase: everything of the app's goes, the marker is set before the reload.
  const ls=shelf({'whatsup.consent':'{"v":3}','whatsup.settings.v1':'{}','other.app':'1'}),at={};
  const before=load({feed:null,store:{seal(){}},placeToken:0,detailToken:0,detailRetry:0,clearTimeout(){},localStorage:ls,indexedDB:{deleteDatabase(){}},
    location:{reload(){at.marker=sessionStorage.getItem('whatsup.erased');at.keys=Object.keys(ls);}}});
  before.eraseAll();
  assert.deepEqual(at,{marker:'1',keys:['other.app']},'at the reload');
  // The reload: OK is ignored for 0.8 s, or until a key is released.
  let p=load();p.askConsent();
  assert.equal(session.has('whatsup.erased'),false,'the marker is read once');
  now+=100;assert.equal(ok(p),false,'OK 0.1 s after the reload');
  now+=600;assert.equal(ok(p),false,'0.7 s');
  now+=150;assert.equal(ok(p),true,'0.85 s');
  sessionStorage.setItem('whatsup.erased','1');p=load();p.askConsent();
  now+=50;assert.equal(ok(p),false);
  for(const f of p.keyup)f();assert.equal(ok(p),true,'after a key is released');
  // Any other launch: OK at once.
  p=load();p.askConsent();assert.equal(ok(p),true,'no Erase before it');
});

test('launch: a saved place that can\'t be read keeps \'Recently above\' and the logbook on the IP guess; no saved place starts them afresh; the guess is not confirmed',async()=>{
  const GUESS={name:'Chicago',latitude:41.878,longitude:-87.63,source:'ip'},CHI={name:'Chicago',latitude:41.85,longitude:-87.65};
  const run=async({place=null,damaged=false,found=GUESS}={})=>{
    const seen=[];
    const p=page([line('const NO_NET='),fn('boot'),fn('findHome')],{dropOldMaps(){},buildKeys(){},fitText(){},$:()=>({}),tellAwake(){},query:{get:()=>null},VIEW_MILES:[25],MAP_RADII:[10],validLayout:id=>id,useSettings(){},
      hasConsent:()=>true,useLayout(){},refineZone:async()=>null,placeDamaged:()=>damaged,locating:false,locateByIp:async()=>({place:found,offline:false}),setTimeout(){},layer:null,
      settings:{place,confirmed:true,layout:'radar'},showWelcome:pl=>seen.push(['welcome',pl.name]),openLocate:()=>seen.push(['search']),
      applyPlace:(pl,o)=>seen.push(['apply',pl.latitude,o?.fresh??false])});
    await p.boot();
    return {seen,confirmed:p.settings.confirmed};
  };
  assert.deepEqual(await run({damaged:true}),{seen:[['apply',41.878,false],['welcome','Chicago']],confirmed:false},'damaged: kept');
  assert.deepEqual(await run(),{seen:[['apply',41.878,true],['welcome','Chicago']],confirmed:false},'none saved: afresh');
  assert.deepEqual((await run({place:CHI})).seen,[['apply',41.85,false]],'a saved place: kept, no lookup');
  assert.deepEqual((await run({damaged:true,found:null})).seen,[['search']],'the lookup failed: the search screen');
});

test('welcome card: Confirm on the guess that stood in for a saved place that can\'t be read (findHome kept its logbook and \'Recently above\' on the guess) starts both afresh for the confirmed place, which may be another city; a first run\'s guess keeps what the session has logged for it, with no feed restart',async()=>{
  const {loadSettings,saveSettings,placeDamaged}=await import('../web/place.mjs'),{store,HISTORY_KEY}=await import('../web/live.mjs'),{resetLog}=await import('../web/model.mjs'),{dLon}=await import('../web/core.mjs');
  const SET='whatsup.settings.v1',LOG_KEY='whatsup.logbook.v1',CHI={name:'Chicago',countryCode:'US',latitude:41.85,longitude:-87.65,timeZone:'America/Chicago'},DEN={name:'Denver',latitude:39.739,longitude:-104.985,timeZone:'America/Denver',source:'ip'};
  const LOG={day:'2026-11-06',pk:1,seen:['a10101'],planes:{},typesAll:{B738:12}},HIST=[{hex:'a10101',last_seen:1}];
  const saved={};globalThis.localStorage={getItem:k=>saved[k]??null,setItem:(k,v)=>{saved[k]=String(v);},removeItem:k=>{delete saved[k];}};
  const stored=()=>{const j=k=>saved[k]?JSON.parse(saved[k]):null,s=j(SET)||{};return {log:j(LOG_KEY)?.typesAll?.B738??null,hist:j(HISTORY_KEY)?.map(r=>r.hex)??null,place:s.place?.name??null,confirmed:!!s.confirmed,damaged:placeDamaged()};};
  const run=async seed=>{
    for(const k of [SET,LOG_KEY,HISTORY_KEY])store.remove(k);for(const [k,v] of Object.entries(seed))saved[k]=JSON.stringify(v);
    const feeds=[],settings=loadSettings();
    const p=page([line('const NO_NET='),fn('boot'),fn('findHome'),fn('applyPlace'),fn('select')],{dropOldMaps(){},buildKeys(){},fitText(){},$:()=>({}),tellAwake(){},query:{get:()=>null},VIEW_MILES:[25],MAP_RADII:[10],validLayout:id=>id,useSettings(){},
      hasConsent:()=>true,useLayout(){},refineZone:async()=>null,placeDamaged,locating:false,locateByIp:async()=>({place:DEN,offline:false}),setTimeout(){},layer:null,settings,showWelcome(){},openLocate(){},close(){},saveSettings,
      dLon,placeToken:0,chime:null,feed:null,maps:{},store,HISTORY_KEY,resetLog,mapMiles:()=>10,detailFits:()=>true,detailSpec:()=>({}),savedMap:pl=>({latitude:pl.latitude,longitude:pl.longitude,range:10}),touchMap(){},mapsChanged(){},active:null,
      ensureDetail(){},detailToken:0,detailBusy:false,detailTries:0,detailRetry:0,clearTimeout(){},start:pl=>{feeds.push(pl.name);return {stop(){}};},feedConfig:()=>({}),render(){},demo:false,buildMap:async()=>{throw new Error('not built');},saveMap(){},flashCredits(){},STALE:'stale',detailNote:()=>''});
    await p.boot();
    return {confirm:()=>p.select({id:'welcome-ok',dataset:{}}),feeds};
  };
  try{
    // A saved place that can't be read: its logbook and 'Recently above' stay on the guess (as before), and go with Confirm.
    let t=await run({[SET]:{place:{...CHI,latitude:'abc'},confirmed:true,layout:'radar'},[LOG_KEY]:LOG,[HISTORY_KEY]:HIST});
    assert.deepEqual([stored(),t.feeds],[{log:12,hist:['a10101'],place:'Chicago',confirmed:true,damaged:true},['Denver']],'the guess: kept');
    t.confirm();
    assert.deepEqual([stored(),t.feeds],[{log:null,hist:null,place:'Denver',confirmed:true,damaged:false},['Denver','Denver']],'Confirm: afresh, the feed started again');
    // A first run (nothing saved): afresh at launch; what the session then logs on the guess stays through Confirm.
    t=await run({});
    assert.deepEqual([stored(),t.feeds],[{log:null,hist:null,place:null,confirmed:false,damaged:false},['Denver']],'a first run: afresh at launch');
    saved[LOG_KEY]=JSON.stringify(LOG);saved[HISTORY_KEY]=JSON.stringify(HIST); // the session's own logging on the guess
    t.confirm();
    assert.deepEqual([stored(),t.feeds],[{log:12,hist:['a10101'],place:'Denver',confirmed:true,damaged:false},['Denver']],'Confirm: kept, no restart');
  }finally{for(const k of [SET,LOG_KEY,HISTORY_KEY])store.remove(k);delete globalThis.localStorage;}
});

test('launch: the saved maps an older build left and this one never reads are dropped first, with a saved place or without',async()=>{
  for(const place of [{name:'Chicago',latitude:41.85,longitude:-87.65},null]){
    const seen=[];
    const p=page([fn('boot')],{dropOldMaps:()=>seen.push('drop'),buildKeys(){},fitText(){},$:()=>({}),tellAwake(){},query:{get:()=>null},VIEW_MILES:[25],MAP_RADII:[10],validLayout:id=>id,
      useSettings(){},hasConsent:()=>true,useLayout:()=>seen.push('layout'),refineZone:async()=>null,settings:{place,confirmed:true,layout:'radar'},applyPlace:()=>seen.push('apply'),findHome:()=>seen.push('find')});
    await p.boot();
    assert.deepEqual(seen,['drop','layout',place?'apply':'find'],place?'a saved place':'none');
  }
});

test('launch: a saved place with a null, empty, blank or false coordinate can\'t be read either, so \'Recently above\' and the logbook wait for a confirmed place (home is never put at 0°)',async()=>{
  const {loadSettings,saveSettings,placeDamaged}=await import('../web/place.mjs');
  const CHI={name:'Chicago',countryCode:'US',latitude:41.85,longitude:-87.65,timeZone:'America/Chicago'},GUESS={name:'Chicago',latitude:41.878,longitude:-87.63,source:'ip'};
  const saved={};globalThis.localStorage={getItem:k=>saved[k]??null,setItem:(k,v)=>{saved[k]=String(v);},removeItem:k=>{delete saved[k];}};
  try{
    for(const [k,v] of [['latitude',null],['longitude',null],['latitude',''],['longitude',' '],['latitude',false],['longitude',[]]]){
      const place={...CHI,[k]:v},tag=`${k} ${JSON.stringify(v)}`;saved['whatsup.settings.v1']=JSON.stringify({place,confirmed:true,layout:'radar'});
      const seen=[],settings=loadSettings();
      assert.equal(settings.place,null,`${tag}: no place`);assert.equal(placeDamaged(),true,`${tag}: damaged`);
      const p=page([fn('boot'),fn('findHome')],{dropOldMaps(){},buildKeys(){},fitText(){},$:()=>({}),tellAwake(){},query:{get:()=>null},VIEW_MILES:[25],MAP_RADII:[10],validLayout:id=>id,useSettings(){},
        hasConsent:()=>true,useLayout(){},refineZone:async()=>null,placeDamaged,locating:false,locateByIp:async()=>({place:GUESS,offline:false}),setTimeout(){},layer:null,settings,
        showWelcome:pl=>seen.push(['welcome',pl.name]),openLocate:()=>seen.push(['search']),applyPlace:(pl,o)=>seen.push(['apply',pl.latitude,o?.fresh??false])});
      await p.boot();
      assert.deepEqual(seen,[['apply',41.878,false],['welcome','Chicago']],`${tag}: kept on the IP guess`);
      saveSettings(p.settings);assert.deepEqual(JSON.parse(saved['whatsup.settings.v1']).place,place,`${tag}: still saved for the next launch`);
    }
  }finally{delete globalThis.localStorage;}
});

test('an outage: with no model for minutes the dashboard is drawn again at each minute through the feed\'s tick (its clock, date and tallies move on) and the outage line counts down each second; neither while hidden, both at once when shown again',async()=>{
  const {quietText}=await import('../web/kit.mjs');
  let t=Date.parse('2026-11-06T05:59:35Z'),ticks=0;const timers=new Set(),drawn=[],swaps=[];
  // The feed's tick() (model.mjs) runs the model again: the time, the day's tallies and the countdown move on together.
  const feed={resume(){},pause(){},tick(){ticks++;p.render({...p.lastModel,now:t});}};
  const p=page([line('let clockTimer='),fn('keepTime'),line('let waitTimer='),fn('countDown'),fn('render'),line('window.__whatsupActive=')],{window:{},onScreen:true,lastModel:null,searchTimer:null,Date:{now:()=>t},
    setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.add(h);return h;},clearTimeout:h=>{timers.delete(h);},
    setInterval:(fn,ms)=>{const h={fn,at:t+ms,every:ms};timers.add(h);return h;},clearInterval:h=>{timers.delete(h);},
    draw:m=>drawn.push(m.now),listen(){},credited:'',sourceFlashAt:0,SOURCE_FLASH_MS:0,flashCredits(){},performance:{now:()=>0},
    quietText,retryIn:at=>at?Math.max(0,Math.round((at-t)/1000)):0,swapText:(root,was,now)=>{if(was!==now)swaps.push(now);},root:{},
    feed,flushLog(){}});
  const run=ms=>{const end=t+ms;for(let h;(h=[...timers].sort((a,b)=>a.at-b.at)[0])&&h.at<=end;){t=h.at;if(h.every)h.at+=h.every;else timers.delete(h);h.fn();}t=end;};
  const at=(ms)=>new Date(ms).toISOString().slice(11,19),counting=()=>[...timers].filter(h=>h.every).length,said=()=>swaps.at(-1);
  const retryAt=t+300000; // the next poll 5 min away
  p.render({live:true,fresh:false,now:t,retryAt,retryIn:300,source:''}); // 23:59:35 Chicago: "No live data right now. Reconnecting in 5 min."
  assert.deepEqual(drawn.map(at),['05:59:35'],'drawn once as it came');assert.equal(counting(),1,'the line counts down');
  run(25100);assert.deepEqual(drawn.map(at),['05:59:35','06:00:00'],'again just after the minute');
  assert.equal(ticks,1,'the model asked of the feed again, not a copy with the new time');assert.equal(timers.size,2,'the minute timer and the countdown');
  assert.equal(vm.runInContext('lastModel.now',p),drawn.at(-1),'the model kept is the one drawn (a layout switch draws that time)');
  run(60000);assert.equal(drawn.length,3,'and each minute after');assert.equal(at(drawn.at(-1)),'06:01:00');
  assert.equal(said(),'No live data right now. Reconnecting in 4 min.','the line counted on (its text swapped, no draw)');
  p.window.__whatsupActive(false);assert.equal(counting(),0,'hidden: the countdown stops with the minute timer');assert.equal(timers.size,0);
  const hid=swaps.length;run(150000);assert.equal(drawn.length,3,'not while hidden');assert.equal(swaps.length,hid,'nor is the line rewritten');
  p.window.__whatsupActive(true);assert.equal(drawn.length,4,'at once back on screen');assert.equal(at(drawn.at(-1)),'06:03:30');
  assert.equal(said(),'No live data right now. Reconnecting in 65 s.','the line reads the time left at once');assert.equal(counting(),1,'and counts on');
  p.window.__whatsupActive(true);assert.equal(drawn.length,4,'not twice in a minute');assert.equal(counting(),1,'one countdown');
  run(30000);assert.equal(at(drawn.at(-1)),'06:04:00');assert.equal(said(),'No live data right now. Reconnecting in 35 s.');
  run(31000);assert.equal(said(),'No live data right now. Reconnecting.','under 5 s the line settles');assert.equal(counting(),0,'and the countdown ends');
  p.render({live:true,fresh:true,now:t,source:''});run(300000);assert.equal(drawn.length,6,'a fresh model: no minute draws (polls draw it)');assert.equal(timers.size,0);
  p.render({live:false,fresh:true,now:t,source:''});run(120000);assert.equal(drawn.length,7,'nor in the demo');
  assert.equal(ticks,4,'every minute draw came through the feed');
});

test('screen reader: closing the last screen reads the plane now on the card at once (an emergency begun behind Settings too); closing onto another screen, or the next poll, reads nothing more',()=>{
  const writes=[],sr={set textContent(v){writes.push(v);},get textContent(){return writes.at(-1)??'';}};
  const screen=id=>({id,hidden:false,style:{}});
  const p=page([line('let spoken='),fn('announce'),fn('draw'),fn('close')],{layer:null,layers:[],adj:null,lastModel:null,detailLater:null,settings:{place:{}},active:{mod:{render(){}}},
    shown:m=>m,paintEdge(){},root:{querySelectorAll:()=>[]},fitLine(){},$:id=>id==='sr-live'?sr:null,fmt:{dist:d=>`${d} mi`},
    endPick(){},showSettings(){},refitSettings(){},setFocus(){},focusables:()=>[],syncApp(){}});
  const model=hero=>{p.lastModel={hero};p.draw(p.lastModel);};
  const JIA={hex:'a1b2c3',status:'Approaching',flight:'JIA5646',type:'Bombardier CRJ900',ground:32.2},
    DAL={hex:'c0ffee',status:'Emergency',emergency:'EMERGENCY',flight:'DAL911',type:'Airbus A321',ground:4.1};
  model(JIA);assert.equal(sr.textContent,'Approaching, JIA5646, Bombardier CRJ900, 32.2 mi');
  p.layer=screen('settings');model(DAL);
  assert.equal(writes.length,1,'nothing read over a screen');
  p.layers.push(p.layer);p.layer=screen('about');p.close();
  assert.equal(p.layer.id,'settings');assert.equal(writes.length,1,'closing onto Settings reads nothing');
  p.close();
  assert.equal(p.layer,null);assert.equal(sr.textContent,'Emergency, DAL911, Airbus A321, 4.1 mi','read on closing, not at the next poll');
  model(DAL);assert.equal(writes.length,2,'the next poll reads nothing more');
  p.layer=screen('settings');p.lastModel=null;p.close();assert.equal(writes.length,2,'no model yet: nothing to read');
});

test('Settings: a Map radius step kept with OK, then another row\'s edit cancelled with Back before the step\'s 700 ms apply: the place is applied once for the new radius (its base map is built), not only the feed restarted; a cancelled step, or a step already applied, as before; a cancelled step followed inside 0.7 s by another row\'s cancelled edit, or by an Alert radius step, still gets its one apply',()=>{
  let t=0;const timers=new Set(),calls=[];
  const settings={mapMiles:10,placeNames:'cities',radiusMiles:5,alertZone:'circle',place:{latitude:41.85,longitude:-87.65}};
  const p=page([line('let zoneTimer='),line('let editing='),line('let editSnap='),line('let mapTimer='),line('const RADII='),fn('select'),fn('adjustSetting'),fn('stepMap'),fn('editKey'),fn('stopEdit'),fn('cancelEdit')],
    {settings,MAP_RADII:[2,5,10,15,25,50],mapMiles:()=>settings.mapMiles,fmt:{dist:v=>`${v} mi`},alertFor:r=>r,maps:{detail:null},detailFits:()=>true,detailSpec:()=>({}),layer:{id:'settings'},
    saveSettings(){},useSettings(){},showSettings(){},tellAwake(){},busy(){},mapsChanged(){},refreshLayout(){},editHint(){},toast(){},store:{remove(){}},HISTORY_KEY:'h',
    applyPlace:()=>calls.push('apply'),restartFeed:()=>calls.push('feed'),
    setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.add(h);return h;},clearTimeout:h=>{timers.delete(h);}});
  const run=ms=>{const end=t+ms;for(let h;(h=[...timers].sort((a,b)=>a.at-b.at)[0])&&h.at<=end;){timers.delete(h);t=h.at;h.fn();}t=end;};
  const row=id=>({id,dataset:{edit:'',adjust:''},classList:{add(){},remove(){}},getAttribute:()=>id,querySelector:()=>null}),MAP=row('set-map'),PLACES=row('set-places'),RADIUS=row('set-radius');
  const key=k=>p.editKey({key:k,preventDefault(){}}),done=()=>{run(3000);const c=calls.join();calls.length=0;return c;};
  // Map radius OK, Right (10 -> 15), OK, Down, OK (Place names), Right, Back: five presses in 0.5 s.
  p.select(MAP);key('ArrowRight');run(100);key('Enter');run(100);p.select(PLACES);run(100);key('ArrowRight');run(100);key('Escape');
  assert.equal(done(),'apply','the kept step\'s apply: once, for 15 mi');
  assert.equal(settings.mapMiles,15);assert.equal(settings.placeNames,'cities','the cancelled edit put back');
  // Map radius OK, Right (15 -> 25), Back 0.3 s later: applied once, for the 15 mi put back.
  p.select(MAP);key('ArrowRight');run(300);key('Escape');
  assert.equal(done(),'apply');assert.equal(settings.mapMiles,15);
  // A step kept and applied (0.7 s passed), then Place names edited and cancelled: the feed restarts, no second apply.
  p.select(MAP);key('ArrowRight');key('Enter');run(1000);p.select(PLACES);key('ArrowRight');run(100);key('Escape');
  assert.equal(done(),'apply,feed');assert.equal(settings.mapMiles,25);
  // No map step at all: a cancelled edit restarts the feed only.
  p.select(PLACES);key('ArrowRight');run(100);key('Escape');
  assert.equal(done(),'feed');assert.equal(settings.placeNames,'cities');
  // (A) Map radius OK, Right (25 -> 50), Back, Down, OK (Place names), Right, Back, all inside 0.7 s: the cancelled step's
  // apply (for the 25 mi put back: its street map was dropped for 50) survives the other row's cancel, once.
  p.select(MAP);key('ArrowRight');run(100);key('Escape');run(100);p.select(PLACES);run(100);key('ArrowRight');run(100);key('Escape');
  assert.equal(done(),'apply','(A) the cancelled step\'s apply, once');assert.equal(settings.mapMiles,25);assert.equal(settings.placeNames,'cities');
  // (G) Map radius OK, Right, Back, Down, OK (Alert radius), Right: the step's apply at 0.7 s, then the alert radius' feed restart.
  p.select(MAP);key('ArrowRight');run(100);key('Escape');run(100);p.select(RADIUS);run(100);key('ArrowRight');
  assert.equal(done(),'apply,feed','(G) the cancelled step\'s apply, then the feed for the alert radius');assert.equal(settings.mapMiles,25);assert.equal(settings.radiusMiles,6);
});

test('media keys are the system\'s (Fire TV test 4.6): Play/Pause, Fast Forward and Rewind do nothing and are never prevented, on the dashboard, in Settings, in the picker or behind the busy cog; a held Menu or OK acts once; a held Back or letter still repeats',()=>{
  const region=/^const DIRS=[\s\S]*?^\}\);$/m.exec(APP)?.[0];assert.ok(region,'the keydown handler in app.mjs');
  let handler,prevented=0;const seen=[];
  const p=page([region],{document:{addEventListener:(t,f)=>{if(t==='keydown')handler=f;}},busyNow:false,layer:null,adj:null,editing:null,heldOk:null,
    openSettings:()=>{seen.push('open');p.layer={id:'settings'};},back:()=>{seen.push('back');p.layer=null;},typeKey:k=>seen.push(k),
    $:()=>({}),move(){},select(){},stepMap(){},stepPlanes(){},stepPick:()=>seen.push('pick'),endPick:()=>seen.push('endPick'),close:()=>seen.push('close')});
  const hold=(key,keyCode,n=12)=>{seen.length=0;prevented=0;for(let i=0;i<=n;i++)handler({key,keyCode,repeat:i>0,preventDefault(){prevented++;}});return seen.join();};
  const MEDIA=[['MediaPlayPause',179],['Unidentified',179],['MediaFastForward',228],['MediaRewind',227],['MediaTrackNext',176],['MediaStop',178]];
  for(const where of [null,{id:'settings'},{id:'picker'}])for(const [key,code] of MEDIA){
    p.layer=where;const label=`${key} (${code}) ${where?.id||'on the dashboard'}`;
    assert.equal(hold(key,code,3),'',`${label}: does nothing`);assert.equal(prevented,0,`${label}: left to the system`);
  }
  p.layer=null;p.busyNow=true;assert.equal(hold('MediaPlayPause',179,3),'');assert.equal(prevented,0,'behind the busy cog too');p.busyNow=false;
  p.layer=null;
  for(const [key,code] of [['ContextMenu',93],['Menu',82],['Unidentified',82],['Enter',13]]){p.layer=null;assert.equal(hold(key,code),'open',`${key} (${code}) held`);}
  p.layer={id:'settings'};assert.equal(hold('Escape',27,3),'back,back,back,back','a held Back repeats as before');
  p.layer={id:'locate'};assert.equal(hold('r',82,3),'R,R,R,R','a held R on the search screen types R each repeat');
});

test('a search typed and then left within 0.8 s (Back, a result picked, Home) is never sent to the geocoder; one left alone is',async()=>{
  const timers=new Map();let nextId=0;const asked=[];
  const el=()=>({replaceChildren(){},querySelector:()=>el(),append(){},textContent:'',dataset:{},style:{}});
  const p=page([line('let entry='),line('const stopSearch='),line('const SEARCH_LIMIT_MS='),fn('typeKey'),fn('runSearch'),fn('close'),line('function closeAll\\('),line('window.__whatsupActive=')],
    {setTimeout:(f,ms)=>{timers.set(++nextId,{f,ms});return nextId;},clearTimeout:id=>timers.delete(id),$:id=>id==='ip-retry'?null:el(),document:{createElement:el},fitLine(){},keepFocus(){},setFocus(){},
      focusables:()=>[],syncApp(){},showSettings(){},refitSettings(){},endPick(){},looksLikeAddress:()=>false,looksLikeUSAddress:()=>false,looksLikePostcode:()=>false,
      PROFILE:{},placeLabel:()=>'',searchPlaces:async q=>{asked.push(q);return [];},searchAddress:async()=>[],lastQuery:'',settings:{place:{}},layer:null,layers:[],
      window:{},feed:null,flushLog(){},countDown(){},keepTime(){},onScreen:true});
  const screen=id=>({id,hidden:false,style:{},contains:()=>false});
  const typed=async(leave,stack=['settings','locate'])=>{
    timers.clear();asked.length=0;vm.runInContext('entry=""',p);p.layers=stack.slice(0,-1).map(screen);p.layer=screen(stack.at(-1));
    for(const c of 'OMA')p.typeKey(c);
    leave?.();
    for(const [id,t] of [...timers])if(t.ms<=800&&timers.delete(id))t.f();
    await new Promise(r=>setImmediate(r));
    return asked.join();
  };
  assert.equal(await typed(),'OMA','left alone: searched after the pause');
  assert.equal(await typed(()=>p.close()),'','Back to Settings');
  assert.equal(await typed(()=>p.closeAll()),'','a result picked (every screen closes)');
  assert.equal(await typed(()=>p.window.__whatsupActive(false)),'','the app sent to the background');
  assert.equal(await typed(()=>{p.layers.push(p.layer);p.layer=screen('confirm');}),'','the timer fires under another screen');
});

test('Settings > Fine-tune: Back (cancel) and OK (save) both return to Settings with Fine-tune focused; opened with no screen open, both end on the dashboard',async()=>{
  const seen=[],place={latitude:41.85,longitude:-87.65};
  const p=await adjustPage({buildMap:async()=>({}),layer:null,focused:null,lastModel:null,settings:{place},stage:{classList:{add(){},remove(){}}},
    closeAll:()=>{seen.push('closeAll');p.layer=null;p.focused=null;},showSettings:()=>seen.push('values'),open:(id,first)=>seen.push(`${id}:${first}`),
    choosePlace:pl=>seen.push(`saved ${pl.latitude}`),openLocate(){},confirmPlace(){}},[fn('endAdjust')]);
  const run=async(from,save)=>{seen.length=0;p.layer=from&&{id:from};p.focused=from&&{id:'set-adjust'};await p.startAdjust(place);p.endAdjust(save);return seen.join();};
  assert.equal(await run('settings',false),'closeAll,values,settings:set-adjust','Back');
  assert.equal(await run('settings',true),'closeAll,saved 41.85,values,settings:set-adjust','OK');
  assert.equal(await run(null,false),'closeAll','Back, opened over the dashboard');
  assert.equal(await run(null,true),'closeAll,saved 41.85','OK, opened over the dashboard');
});

test('on-screen keyboard: Left/Right go to the key beside it on the same row and Up/Down to the row above or below, the wide keys too (Right on Clear is Search, Up on Search is Space); Settings moves as before',()=>{
  // Stage px as laid out (7 columns of 50 px, 5 px apart, rows 36 px tall, 41 px apart), results to the right.
  const box=(id,x,y,w,h,cls='')=>({id,classList:{contains:c=>c===cls},getBoundingClientRect:()=>({left:x,top:y,width:w,height:h,right:x+w,bottom:y+h})});
  const rows=['ABCDEFG','HIJKLMN','OPQRSTU','VWXYZ,-','1234567','890'];
  const keys=[...rows.flatMap((r,i)=>[...r].map((k,c)=>box(k,61+55*c,190+41*i,50,36))),
    box('space',226,395,105,36),box('del',336,395,105,36),box('clear',61,436,160,36),box('search',226,436,215,36),
    box('result0',463,190,370,46),box('result1',463,242,370,46),box('result2',463,294,370,46)];
  const run=items=>{const p=page([fn('move')],{focusables:()=>items,focused:null,setFocus:el=>{p.focused=el;}});
    return (from,dir)=>{p.focused=items.find(e=>e.id===from);p.move(dir);return p.focused.id;};};
  const go=run(keys);
  assert.equal(go('clear','right'),'search');assert.equal(go('search','left'),'clear');
  assert.equal(go('search','up'),'space');assert.equal(go('clear','up'),'9');
  for(const k of ['space','del'])assert.equal(go(k,'down'),'search',k);
  assert.equal(go('0','down'),'clear');assert.equal(go('8','down'),'clear');
  assert.equal(go('space','left'),'0');assert.equal(go('0','right'),'space');assert.equal(go('space','right'),'del');assert.equal(go('del','left'),'space');
  for(const r of rows)for(let c=0;c+1<r.length;c++){assert.equal(go(r[c],'right'),r[c+1]);assert.equal(go(r[c+1],'left'),r[c]);}
  for(let i=0;i+1<rows.length;i++)for(let c=0;c<rows[i+1].length;c++){assert.equal(go(rows[i][c],'down'),rows[i+1][c]);assert.equal(go(rows[i+1][c],'up'),rows[i][c]);}
  assert.equal(go('G','right'),'result0');assert.equal(go('result0','left'),'G');assert.equal(go('result1','left'),'N');
  assert.equal(go('result0','down'),'result1');assert.equal(go('result2','up'),'result1');
  // Settings: two columns of rows (the left one shorter) and Done centred below.
  const col=(x,ids)=>ids.map((id,i)=>box(id,x,80+33*i,400,30));
  const set=[...col(48,['set-location','set-adjust','set-zone','set-radius']),...col(470,['set-layout','set-map','set-places','set-distance','set-altitude','set-awake','set-chime','set-about','set-privacy']),
    box('set-done',370,390,220,30,'done')];
  const s=run(set);
  assert.equal(s('set-adjust','right'),'set-map');assert.equal(s('set-map','left'),'set-adjust');
  assert.equal(s('set-radius','down'),'set-done');assert.equal(s('set-privacy','down'),'set-done');assert.equal(s('set-done','up'),'set-privacy');
  assert.equal(s('set-altitude','left'),'set-radius','no row beside it: the nearest, as before');
  assert.equal(s('set-zone','up'),'set-adjust');assert.equal(s('set-chime','down'),'set-about');
});

test('welcome card: one line says how to reach Settings later, fitted to one line once the card is shown',()=>{
  const hint={},seen=[];
  const p=page([fn('showWelcome')],{settings:{distance:'mi'},placeLabel:pl=>pl.name,$:id=>id==='welcome-hint'?hint:{},open:id=>seen.push(`open ${id}`),fitLine:e=>seen.push(e===hint?`fit ${e._alts[0]}`:'fit')});
  p.showWelcome({name:'Chicago',accuracyKm:5});
  assert.deepEqual(seen,['open welcome','fit On the main screen, press Select for Settings.']);
  assert.ok(hint._alts.every(t=>/[Mm]ain screen/.test(t)&&/Select/.test(t)&&/Settings/.test(t)&&!/…|\.\.\./.test(t)),hint._alts.join(' | '));
});

test('first run with no network (nothing answered the IP lookup): the search screen says so and offers Try again under its help line (outside the results a search replaces), which asks again; a lookup that answered without a place keeps its wording',async()=>{
  const NO_NET='No internet connection. Check the TV’s network settings, then choose Try again. You can also type a ZIP or city now.';
  const NO_PLACE='We couldn’t find your location automatically. Type a ZIP or postal code, or a city name.',GUESS={name:'Chicago',latitude:41.878,longitude:-87.63,source:'ip'};
  const fresh=()=>{
    const seen=[],asks=[];let focus=null;
    const node=(props={})=>({...props,dataset:{},parent:null,get isConnected(){return !!this.parent;},
      remove(){if(this.parent){this.parent.kids.splice(this.parent.kids.indexOf(this),1);this.parent=null;}},
      before(x){const k=this.parent.kids;x.parent=this.parent;k.splice(k.indexOf(this),0,x);},after(x){const k=this.parent.kids;x.parent=this.parent;k.splice(k.indexOf(this)+1,0,x);}});
    const list=()=>{const l={kids:[],append(...xs){for(const x of xs){x.parent=l;l.kids.push(x);}},replaceChildren(...xs){for(const k of l.kids)k.parent=null;l.kids=[];l.append(...xs);}};return l;};
    // The card: the help line and what follows it (the IP lookup's Try again, 'Finding your location'); the results box apart.
    const card=list(),help=node({id:'entry-help'}),results=list();card.append(help);
    const p=page([line('const NO_NET='),fn('findHome')],{settings:{place:null,layout:'radar'},layer:null,locating:false,placeDamaged:()=>false,useSettings(){},setTimeout(){},close(){},
      $:id=>id==='results'?results:id==='entry-help'?help:id==='ip-retry'?card.kids.find(k=>k.id==='ip-retry')||null:node(),document:{createElement:tag=>node({tag})},
      locateByIp:()=>new Promise(r=>asks.push(r)),openLocate:help=>{seen.push(['search',help]);p.layer={id:'locate'};p.texts['entry-help']=help;results.replaceChildren();},
      setFocus:el=>{focus=el;},keepFocus:()=>{focus='first key';},closeAll:()=>{seen.push(['closeAll']);p.layer=null;},showWelcome:pl=>seen.push(['welcome',pl.name]),
      applyPlace:(pl,o)=>seen.push(['apply',pl.latitude,o?.fresh??false])});
    // What is on the screen: under the help line, then in the results box.
    const shown=()=>[...card.kids.filter(k=>k!==help),...results.kids].map(k=>k.textContent),underHelp=()=>card.kids.slice(1).map(k=>k.id||k.textContent);
    // The lookup in flight answers `reply`; a search answering meanwhile fills the results and takes the IP lookup's Try again away (runSearch).
    const answer=async(run,reply)=>{asks.shift()(reply);await run;};
    const searched=text=>{results.replaceChildren(node({textContent:text}));card.kids.find(k=>k.id==='ip-retry')?.remove();};
    return {p,seen,asks,shown,underHelp,answer,searched,results,node,focus:()=>focus};
  };
  // Launch, offline: the search screen says so, Try again focused.
  let t=fresh();await t.answer(t.p.findHome(),{place:null,offline:true});
  assert.deepEqual(t.seen,[['search',NO_NET]]);assert.deepEqual(t.shown(),['Try again']);assert.equal(t.focus()?.id,'ip-retry');
  assert.deepEqual(t.underHelp(),['ip-retry'],'under the help line, not in the results box');
  // Try again: 'Finding your location' while it asks (a second OK asks nothing more); offline again: as it was.
  let run=t.p.findHome();assert.deepEqual(t.shown(),['Finding your location','Try again']);
  await t.p.findHome();assert.equal(t.asks.length,1,'one lookup at a time');
  await t.answer(run,{place:null,offline:true});
  assert.deepEqual(t.shown(),['Try again']);assert.equal(t.focus()?.id,'ip-retry');assert.equal(t.p.texts['entry-help'],NO_NET);
  // Try again, now answered without a place: the usual wording, no Try again.
  await t.answer(t.p.findHome(),{place:null,offline:false});
  assert.deepEqual(t.shown(),[]);assert.equal(t.p.texts['entry-help'],NO_PLACE);assert.equal(t.focus(),'first key');
  // Try again finds the place: the welcome card, over the dashboard (not over the search screen).
  t=fresh();await t.answer(t.p.findHome(),{place:null,offline:true});t.seen.length=0;
  await t.answer(t.p.findHome(),{place:GUESS,offline:false});
  assert.deepEqual(t.seen,[['apply',41.878,true],['closeAll'],['welcome','Chicago']]);assert.equal(t.p.settings.place,GUESS);assert.equal(t.p.settings.confirmed,false);
  // A search answered meanwhile (the results replaced Try again): the late guess is dropped.
  t=fresh();await t.answer(t.p.findHome(),{place:null,offline:true});t.seen.length=0;
  run=t.p.findHome();t.searched('Denver, CO');await t.answer(run,{place:GUESS,offline:false});
  assert.deepEqual(t.seen,[]);assert.deepEqual(t.shown(),['Denver, CO']);assert.equal(t.p.settings.place,null);
  // Launch, GeoJS answered without a place: the usual wording, no Try again.
  t=fresh();await t.answer(t.p.findHome(),{place:null,offline:false});
  assert.deepEqual(t.seen,[['search',NO_PLACE]]);assert.deepEqual(t.shown(),[]);
});

test('search screen, first run offline: Search with fewer than 2 characters typed leaves the IP lookup\'s Try again under the help line that names it (outside the results it replaces); a search that answers (a place found, or the geocoder failing with the search\'s own Try again) takes the button and that help line away together, so after a failed search, Clear and an empty Search never leave the message alone under a line still saying to choose Try again',async()=>{
  const el=(props={})=>({className:'',...props,dataset:{},kids:[],parent:null,querySelectorAll:()=>[],
    append(...xs){for(const x of xs){x.remove?.();x.parent=this;this.kids.push(x);}},replaceChildren(...xs){for(const k of this.kids)k.parent=null;this.kids=[];this.append(...xs);},
    remove(){if(this.parent){this.parent.kids.splice(this.parent.kids.indexOf(this),1);this.parent=null;}}});
  const NO_NET='No internet connection. Check the TV’s network settings, then choose Try again. You can also type a ZIP or city now.';
  const NO_PLACE='We couldn’t find your location automatically. Type a ZIP or postal code, or a city name.';
  const results=el({id:'results'}),card=el(),help=el({id:'entry-help'}),ip=el({id:'ip-retry',className:'retry',textContent:'Try again'});
  const offline=()=>{card.replaceChildren(help,ip);results.replaceChildren();p.texts['entry-help']=NO_NET;}; // a first run, the lookup refused: findHome's screen
  let geocoder=async()=>[{name:'Denver',admin:'Colorado',country:'United States',source:'search'}];
  const p=page([line('let entry='),line('const SEARCH_LIMIT_MS='),line('let lastQuery='),line('const NO_NET='),fn('runSearch')],{layer:{id:'locate'},layers:[],clearTimeout(){},setTimeout:()=>0,fitLine(){},keepFocus(){},setFocus(){},
    $:id=>id==='results'?results:id==='ip-retry'?(ip.parent?ip:null):id==='keys'?{querySelector:()=>({})}:el({id}),
    document:{createElement:tag=>el({tag})},looksLikeAddress:()=>false,looksLikeUSAddress:()=>false,looksLikePostcode:()=>false,PROFILE:{nominatim:false},
    searchPlaces:q=>geocoder(q),searchAddress:async()=>[],placeLabel:pl=>pl.name});
  // The screen after a search: the results box, the Try again buttons (the IP lookup's under the help line, the search's own in the
  // results) and the help line, in agreement: it never names a Try again that is off screen, and the IP lookup's goes with the no-network line.
  const screen=()=>{const buttons=[...card.kids,...results.kids].filter(k=>k.className==='retry').map(k=>k.id),help=p.texts['entry-help'];
    assert.ok(!/Try again/.test(help)||buttons.length,`the help line (${help}) names a Try again that is on screen (${buttons})`);
    assert.equal(buttons.includes('ip-retry'),help===NO_NET,`the IP lookup's Try again goes with the no-network help line (${help}; ${buttons})`);
    return {results:results.kids.map(k=>k.id||k.textContent||k.tag),buttons,help};};
  const search=async typed=>{vm.runInContext(`entry=${JSON.stringify(typed)}`,p);await p.runSearch(true);return screen();};
  const FIRST='Type a ZIP or postal code, a city, or a street address first.',FAILED='Search is unavailable. Check the connection.';
  offline();
  assert.deepEqual(await search(''),{results:[FIRST],buttons:['ip-retry'],help:NO_NET},'nothing typed');
  assert.deepEqual(await search('D'),{results:[FIRST],buttons:['ip-retry'],help:NO_NET},'one character');
  assert.deepEqual(card.kids,[help,ip],'the IP lookup\'s Try again stays under the help line');
  // A real search that fails: the search's own Try again, the IP lookup's gone with the help line that named it; then Clear and Search with nothing typed.
  geocoder=async()=>null;
  assert.deepEqual(await search('DE'),{results:[FAILED,'search-retry'],buttons:['search-retry'],help:NO_PLACE},'a search that fails');
  assert.deepEqual(await search(''),{results:[FIRST],buttons:[],help:NO_PLACE},'Clear, then Search with nothing typed');
  // A search that answers: its results alone, the IP lookup's Try again and its help line gone.
  offline();geocoder=async()=>[{name:'Denver',admin:'Colorado',country:'United States',source:'search'}];
  assert.deepEqual(await search('DENVER'),{results:['button'],buttons:[],help:NO_PLACE},'a search that answers');
  assert.equal(results.kids[0]._place?.name,'Denver');
  assert.deepEqual(await search(''),{results:[FIRST],buttons:[],help:NO_PLACE},'later: the message alone');
});

test('screen reader: the plane on the card is read again, with its distance, as it enters the alert zone and as it leaves; Approaching and Nearest trading places on it, a zone change while browsing, or a poll with nothing new are not',()=>{
  const writes=[],sr={set textContent(v){writes.push(v);},get textContent(){return writes.at(-1)??'';}};
  const p=page([line('let spoken='),fn('announce')],{layer:null,adj:null,$:id=>id==='sr-live'?sr:null,fmt:{dist:d=>`${d.toFixed(1)} mi`},quietText:()=>'',demo:false});
  const TST=(status,ground,inside=false)=>({hex:'ab2001',status,flight:'TST101',type:'Boeing 737-800',ground,inside});
  const say=(...heroes)=>{for(const hero of heroes)p.announce({hero});return writes.slice();};
  assert.deepEqual(say(TST('Approaching',6),TST('Approaching',5.2)),['Approaching, TST101, Boeing 737-800, 6.0 mi'],'read when it takes the card, not at every poll');
  assert.deepEqual(say(TST('Above you now',1,true)).slice(1),['Above you now, TST101, Boeing 737-800, 1.0 mi'],'entering the alert zone');
  say(TST('Above you now',.4,true),TST('In your window',.9,true));assert.equal(writes.length,2,'once per entry, not per poll');
  assert.deepEqual(say(TST('Nearest',5)).slice(2),['Nearest, TST101, Boeing 737-800, 5.0 mi'],'leaving it');
  say(TST('Approaching',4.8),TST('Nearest',4.9),TST('Approaching',4.7));assert.equal(writes.length,3,'Approaching and Nearest trading places are not read');
  const browse={index:1,count:3};
  assert.deepEqual(say({...TST('Plane 1 of 3',2.5),browse}).slice(3),['Plane 1 of 3, TST101, Boeing 737-800, 2.5 mi'],'Left/Right: the chosen plane');
  say({...TST('Plane 1 of 3',1.2,true),browse},{...TST('Plane 1 of 3',3.1),browse});assert.equal(writes.length,4,'while browsing the zone edge is not read');
  assert.deepEqual(say(TST('Nearest',3.3)).slice(4),['Nearest, TST101, Boeing 737-800, 3.3 mi'],'Back: the card is automatic again');
  // An emergency owns the card: read once, not again as it crosses the alert-zone edge either way.
  const EMG=(ground,inside=false)=>({hex:'c0ffee',status:'Emergency',emergency:'EMERGENCY',flight:'DAL911',type:'Airbus A321',ground,inside});
  assert.deepEqual(say(EMG(6),EMG(1,true),EMG(.5,true),EMG(5)).slice(5),['Emergency, DAL911, Airbus A321, 6.0 mi'],'an emergency across the zone edge: one line');
});

test('screen reader: with no plane on the card the sky\'s state is read once as it changes (connecting, quiet skies, no coverage, an outage without its countdown), a plane again when one comes; the map\'s notes are live too',async()=>{
  const {quietText}=await import('../web/kit.mjs');
  const writes=[],sr={set textContent(v){writes.push(v);},get textContent(){return writes.at(-1)??'';}};
  const live=(demo=false)=>page([line('let spoken='),fn('announce')],{layer:null,adj:null,$:id=>id==='sr-live'?sr:null,fmt:{dist:d=>`${d} mi`},quietText,demo});
  const p=live(),sky=m=>{p.announce({live:true,planes:[],hero:null,...m});return writes.slice();};
  const ENY={hex:'a1b2c3',status:'Nearest',flight:'ENY4198',type:'Embraer 170',ground:8.2};
  assert.deepEqual(sky({fresh:false,connecting:true}),['Connecting to the live feed']);
  sky({fresh:false,connecting:true});assert.equal(writes.length,1,'not again at the next check');
  sky({fresh:true,hero:ENY});assert.equal(sr.textContent,'Nearest, ENY4198, Embraer 170, 8.2 mi');
  sky({fresh:true});assert.equal(sr.textContent,'Quiet skies. Nothing within range right now.');
  sky({fresh:false,retryIn:25,retryAt:1});assert.equal(sr.textContent,'No live data right now. Reconnecting.','an outage, without the seconds');
  for(const s of [24,23,4,0])sky({fresh:false,retryIn:s,retryAt:1});assert.equal(writes.length,4,'the countdown is not read');
  sky({fresh:true,hero:ENY});assert.deepEqual(writes.slice(4),['Nearest, ENY4198, Embraer 170, 8.2 mi'],'live again: the plane on the card');
  sky({fresh:true,noCoverage:true});assert.equal(sr.textContent,'No receiver coverage here. The aircraft feed has no receivers near this location.');
  sky({fresh:true,noCoverage:true});sky({fresh:true,noCoverage:true,planes:[]});assert.equal(writes.length,6);
  assert.deepEqual(sky({fresh:false,retryIn:120,retryAt:1}).slice(6),['No live data right now. Reconnecting.'],'minutes away: the same sentence');
  writes.length=0;live(true).announce({live:false,fresh:true,planes:[],hero:null});assert.deepEqual(writes,['Quiet skies. Nothing within range right now.'],'the demo\'s empty sky');
  // 'Finding your location', 'Map unavailable', 'Drawing the street map': the note is a live region (written only on a change)...
  assert.match(readFileSync(new URL('../web/index.html',import.meta.url),'utf8'),/<div class="layout-note" id="layout-note" aria-live="polite"><\/div>/);
  // ...hidden with the dashboard while a screen is open: a street map drawn behind Settings or a picker preview isn't read over them.
  const attrs={},hb=page([line('const hideBehind=')],{$:id=>({setAttribute:(k,v)=>{attrs[id]=v;}}),layer:null,adj:null}),hide=()=>vm.runInContext('hideBehind()',hb);
  hide();assert.deepEqual(attrs,{layout:'false','layout-note':'false'},'the dashboard');
  hb.layer={id:'picker'};hide();assert.deepEqual(attrs,{layout:'true','layout-note':'true'},'behind a screen');
  hb.layer=null;hb.adj={};hide();assert.equal(attrs['layout-note'],'true','behind Adjust position');
  hb.adj=null;hide();assert.deepEqual(attrs,{layout:'false','layout-note':'false'},'restored on closing');
});

test('screen reader: OK on a Settings value row says "Editing <row>, <value>", OK again "Saved <value>", Back "Cancelled" (the value it puts back is not read over it); the layout picker focuses the layout\'s count and name, not the Previous arrow, and reads the name again at each opening',()=>{
  let value='3 mi';
  const row={id:'set-radius',dataset:{edit:'',focus:''},classList:{add(){},remove(){},contains:()=>false},getAttribute:k=>k==='aria-label'?`Alert radius, ${value}`:null,querySelector:()=>({textContent:value})};
  const opened=[];
  const p=page([line('let editing='),line('let editSnap='),line('let pick='),fn('select'),fn('stopEdit'),fn('cancelEdit'),fn('startPick'),fn('endPick')],{settings:{radiusMiles:3,layout:'radar',place:{}},editHint(){},store:{remove(){}},HISTORY_KEY:'h',
    clearTimeout(){},setTimeout(){},zoneTimer:0,mapTimer:0,restartFeed(){},saveSettings(){},useSettings(){},showSettings(){},tellAwake(){},busy(){},mapsChanged(){},refreshLayout(){},applyPlace(){},
    LAYOUTS:[['radar','Radar'],['glass','Glass']],stage:{classList:{add(){},remove(){}}},open:(id,first)=>opened.push([id,first]),setFocus(){},stepPick(){},showPick(){},useLayout(){}});
  const said=()=>p.texts['sr-live'];
  p.select(row);assert.equal(said(),'Editing Alert radius, 3 mi');
  value='4 mi';p.settings.radiusMiles=4;p.stopEdit(true);assert.equal(said(),'Saved 4 mi');
  p.select(row);p.cancelEdit();assert.equal(said(),'Cancelled','nothing changed');
  p.select(row);p.settings.radiusMiles=5;value='5 mi';p.cancelEdit();assert.equal(said(),'Cancelled');assert.equal(p.settings.radiusMiles,4,'the value is back');
  p.startPick(0);assert.deepEqual(opened,[['picker','pick-body']],'DOM focus on the count and name');
  p.endPick(false);assert.equal(p.texts['pick-name'],'','cleared on closing: the next opening reads the name again');
  assert.match(readFileSync(new URL('../web/index.html',import.meta.url),'utf8'),/<div class="pick-body" id="pick-body" tabindex="-1" role="group" aria-labelledby="pick-count">/);
  // Stepping a value in edit mode reads the new value; the restore on Back is not read ('Cancelled' is).
  const els={},$=id=>els[id]??={};let label='Alert radius, 3 mi',next=label;
  const srow={getAttribute:()=>label,querySelector:()=>({textContent:label.split(', ')[1]})};
  const s=page([fn('showSettings')],{LAYOUTS:[['radar','Radar']],layoutName:()=>'Radar',settings:{layout:'radar',place:null,radiusMiles:3,viewFrom:0,viewTo:90,viewMiles:25,placeNames:'off',chime:'off'},
    placeLabel:()=>'',alertFor:r=>r,mapMiles:()=>10,fmt:{dist:v=>`${v} mi`},compass:()=>'N',VIEW_MILES:[25],$,document:{querySelectorAll:sel=>sel==='#settings .row'?[srow]:[]},fitValue(){},labelRow(){label=next;},focused:srow,editing:null});
  next='Alert radius, 4 mi';s.editing=srow;s.showSettings();assert.equal(els['sr-live'].textContent,'4 mi','Right in edit mode');
  els['sr-live'].textContent='Cancelled';next='Alert radius, 3 mi';s.editing=null;s.showSettings();assert.equal(els['sr-live'].textContent,'Cancelled','the restore after Back');
});

test('screen reader: a plane that came before the layout script landed is read as soon as the layout has mounted, not at the next poll; a layout switch with the same plane, or no model yet, reads nothing',async()=>{
  const writes=[],sr={set textContent(v){writes.push(v);},get textContent(){return writes.at(-1)??'';}};
  const MOD={mount(){},setMap(){},render(){}},ENY={hex:'a1b2c3',status:'Nearest',flight:'ENY4198',type:'Embraer 170',ground:8.2};
  const p=page([line('let active=null'),fn('useLayout'),fn('draw'),line('let spoken='),fn('announce')],{lastModel:{hero:ENY},adj:null,layer:null,registry:{},codeOf:id=>id,
    $:id=>id==='sr-live'?sr:{classList:{add(){},remove(){}},textContent:''},fmt:{dist:d=>`${d} mi`},quietText:()=>'',demo:false,
    validLayout:id=>id,unloadExcept(){},busyNow:false,loadLayout:async()=>MOD,sheetsOf:id=>[id],stage:{classList:{add(){},remove(){}},dataset:{}},
    root:{replaceChildren(){},querySelectorAll:()=>[]},pruneFitted(){},ctx:{},maps:{},paintEdge(){},refitScreens(){},flashCredits(){},requestAnimationFrame(){},
    shown:m=>m,fitLine(){},ensureDetail(){},detailNote:()=>''});
  await p.useLayout('radar');
  assert.deepEqual(writes,['Nearest, ENY4198, Embraer 170, 8.2 mi'],'read as the layout mounts');
  await p.useLayout('glass');assert.equal(writes.length,1,'a layout switch with the same plane reads nothing new');
  p.lastModel=null;await p.useLayout('swiss');assert.equal(writes.length,1,'no model yet: nothing to read');
});

// VoiceView on the shared screens: each dialog's body is its description (read with the first button), the
// policy and credits pages are read as they are scrolled, the search screen and Adjust position speak.
test('screen reader: each dialog\'s body is its description, read with its first button: the consent text, "Is this right?" with the city and the accuracy note, "Use this location?" with the place, region and match note, the Erase warning, how to scroll the policy and the credits; Up/Down on those pages reads the paragraphs scrolled into view, each once',()=>{
  const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  const attrs=id=>Object.fromEntries([...(new RegExp(`<div class="overlay" id="${id}"([^>]*)>`).exec(html)?.[1]||'').matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  assert.equal(attrs('consent')['aria-describedby'],'consent-body');
  // The welcome card's last line (where Select opens Settings) is read with the note, as it is shown.
  assert.deepEqual([attrs('welcome')['aria-labelledby'],attrs('welcome')['aria-describedby']],['welcome-label welcome-city','welcome-note welcome-hint']);
  assert.deepEqual([attrs('confirm')['aria-labelledby'],attrs('confirm')['aria-describedby']],['confirm-label confirm-main','confirm-sub confirm-note']);
  // The questions are drawn in capitals (CSS), which Chromium would put in the name: their aria-label keeps the spoken case.
  assert.match(html,/<div class="label" id="welcome-label" aria-label="Is this right\?">Is this right\?<\/div>/);
  assert.match(html,/<div class="label" id="confirm-label" aria-label="Use this location\?"><\/div>/);
  assert.equal(attrs('erase')['aria-describedby'],'erase-body');assert.match(html,/<p class="note" id="erase-body">Erase your location/);
  for(const id of ['privacy','about']){assert.equal(attrs(id)['aria-describedby'],`${id}-hint`);assert.match(html,new RegExp(`<p class="hint doc-hint" id="${id}-hint">Up and Down scroll`));}
  // The page: on opening and after each Up/Down, the paragraphs whose top is in view are read; the same view again reads nothing.
  const texts={},writes=[],p=page([fn('scrollDoc')],{setText:(id,v)=>{if(texts[id]!==v){texts[id]=v;if(v)writes.push(v);}}}); // writes: what is read (a changed, non-empty text)
  const paras=[['Privacy Policy',30],['Version 3',24],['This is a free app.',72],['The short version',30],['We run no server.',48],['Your home stays on your TV.',48],['They get your location.',96],['Erase deletes everything.',48]];
  let st=0,y=0;const doc={clientHeight:150,get scrollTop(){return st;},set scrollTop(v){st=Math.max(0,Math.min(246,v));},getBoundingClientRect:()=>({top:200,bottom:350}),children:[]};
  for(const [text,h] of paras){const top=y;doc.children.push({textContent:text,getBoundingClientRect:()=>({top:200+top-st,bottom:200+top+h-st})});y+=h;}
  p.scrollDoc(doc);assert.deepEqual(writes,['Privacy Policy Version 3 This is a free app. The short version'],'opened');
  p.scrollDoc(doc,'down');assert.equal(st,90);assert.equal(writes.at(-1),'The short version We run no server. Your home stays on your TV.');
  p.scrollDoc(doc,'down');assert.equal(writes.at(-1),'Your home stays on your TV. They get your location.');
  p.scrollDoc(doc,'down');assert.equal(st,246,'the end');assert.equal(writes.at(-1),'They get your location. Erase deletes everything.');
  p.scrollDoc(doc,'down');assert.equal(writes.length,4,'Down at the end: the same view, nothing read again');
  p.scrollDoc(doc,'up');assert.equal(writes.at(-1),'We run no server. Your home stays on your TV. They get your location.');
  // Back, then the page again: the region still holds the first view (an unchanged text is skipped), so it is emptied first and the view read again.
  doc.scrollTop=0;writes.length=0;p.scrollDoc(doc);p.scrollDoc(doc);
  assert.deepEqual(writes,Array(2).fill('Privacy Policy Version 3 This is a free app. The short version'),'opened twice in a row: the first view is read both times');
});

test('screen reader: the search screen reads its status once as it changes: "Searching for" (on Search only: as you type, just the count), how many places were found, "No places match", the error, the hint for an empty entry; a search that lands under the confirm card reads nothing; the entry is a named text box',async()=>{
  const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  assert.match(html,/<div class="entry" role="textbox" aria-label="[^"]+" aria-describedby="entry-help"><span id="entry-text"><\/span>/);
  const elem=tag=>({tag,className:'',textContent:'',dataset:{},children:[],append(...n){this.children.push(...n);},get firstElementChild(){return this.children[0]??null;}});
  const box=Object.assign(elem('div'),{replaceChildren(...n){this.children=n;},querySelectorAll:()=>[]});
  const els={results:box,'results-src':elem('p'),'search-src':elem('p'),keys:{querySelector:()=>({})},'search-retry':{}};
  const writes=[],places={CHI:[{name:'Chicago, IL',admin:'Illinois',country:'United States'},{name:'Chicago Heights, IL'},{name:'Chicago Ridge, IL'}],DEN:[{name:'Denver, CO'}],QZXWV:[]};
  const p=page([line('let entry='),line('const SEARCH_LIMIT_MS='),fn('runSearch'),line('let lastQuery=')],{setText:(id,v)=>{if(id==='sr-live')writes.push(v);},
    $:id=>els[id],fitLine(){},keepFocus(){},setFocus(){},looksLikeAddress:()=>false,looksLikeUSAddress:()=>false,looksLikePostcode:()=>false,PROFILE:{nominatim:false},
    searchPlaces:async q=>{if(q==='DOWN')throw new Error('503');return places[q];},searchAddress:async()=>[],placeLabel:pl=>pl.name,layer:{id:'locate'},layers:[],
    clearTimeout(){},setTimeout:()=>0,document:{createElement:elem}});
  const search=async(q,explicit=false)=>{writes.length=0;vm.runInContext(`entry=${JSON.stringify(q)}`,p);await p.runSearch(explicit);return writes.slice();};
  assert.deepEqual(await search('CHI'),['3 places found'],'as you type: the count alone (two lines per pause were chatter for a slow typist)');
  assert.deepEqual(await search('DEN',true),['Searching for “DEN”','1 place found']);
  assert.deepEqual(await search('QZXWV',true),['Searching for “QZXWV”','No places match “QZXWV”. Check the spelling, or try a ZIP or postal code.']);
  assert.deepEqual(await search('DOWN',true),['Searching for “DOWN”','Search is unavailable. Check the connection.']);
  assert.deepEqual(await search('X',true),['Type a ZIP or postal code, a city, or a street address first.']);
  const landing=search('CHI');p.layers=[p.layer];p.layer={id:'confirm'}; // the card comes over it before the reply lands
  assert.deepEqual(await landing,[],'landed under the confirm card: drawn, not read');
  assert.equal(box.children.length,3);
  assert.deepEqual(await search('DEN'),[],'typed under the card: not sent, nothing drawn or read');assert.equal(box.children.length,3);
});

test('screen reader: Adjust position puts focus on its panel (named, its instructions the description), reads a move once the presses stop, one line for a held arrow, nothing after Back; its notes are a live region',async()=>{
  const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  assert.match(html,/<div class="adjust-panel" id="adjust-panel" role="dialog" aria-label="Adjust position" aria-describedby="adjust-help" tabindex="-1">/);
  assert.match(html,/<p id="adjust-help">Move the map with the arrows until the dot sits on your home\./);
  assert.match(html,/<div class="adjust-note" id="adjust-note" aria-live="polite"><\/div>/);
  assert.match(readFileSync(new URL('../web/whatsup.css',import.meta.url),'utf8'),/\.adjust-panel:focus[^{]*\{outline:none\}/,'no browser focus ring on the panel');
  const {dLon}=await import('../web/core.mjs');
  const region=/^let adj=null;$[\s\S]*?^async function startAdjust\([\s\S]*?\n\}/m.exec(APP)[0];
  const texts={},writes=[],timers=[],focused=[];
  const p=page([line('const ADJ_RANGE='),line('const ADJ_MAX_M='),region,fn('drawAdjust'),line('let adjSay='),fn('nudge'),fn('endAdjust')],{dLon,performance:{now:()=>0},layers:[],layer:null,focused:null,closeAll(){},makeCanvas:()=>({}),
    $:id=>({replaceChildren(){},focus(){focused.push(id);},get textContent(){return texts[id]??'';}}),stage:{classList:{add(){},remove(){}}},syncApp(){},buildMap:async()=>({}),
    adjMap:()=>[],paintMap(){},maps:{},svg:()=>({}),compass:()=>'E',placeLabel:()=>'',lastModel:null,settings:{},choosePlace(){},
    setText:(id,v)=>{texts[id]=String(v??'');if(id==='sr-live')writes.push(texts[id]);},setTimeout:(f,ms)=>{const h={f,ms};timers.push(h);return h;},clearTimeout:h=>{const i=timers.indexOf(h);if(i>=0)timers.splice(i,1);}});
  const fire=()=>{const t=timers.splice(0);for(const h of t)h.f();return t.length;};
  await p.startAdjust({latitude:41.85,longitude:-87.65});
  assert.deepEqual(focused,['adjust-panel'],'DOM focus on the panel, never on <body>');assert.equal(texts['adjust-moved'],'Not moved yet');
  p.nudge('right');assert.equal(writes.length,0,'not at once: the presses may go on');assert.equal(fire(),1);
  assert.deepEqual(writes,['Moved 50 m E']);
  for(let i=0;i<10;i++)p.nudge('right',i>0);
  assert.equal(timers.length,1,'a held arrow: one line, once it is released');assert.ok(timers[0].ms<=500,`${timers[0].ms} ms`);fire();
  assert.equal(writes.length,2);assert.match(writes[1],/^Moved 800 m E$/);
  p.nudge('up');p.endAdjust();fire();
  assert.equal(writes.length,2,'Back: the pending line is dropped');
});

test('layout picker: a step to a layout whose code is already here (Atlas Dark -> Atlas Light share atlas.js) returns before the mount, which runs in its own task after the cog and the count have painted, as a step that loads a script does; Back in that window reverts cleanly, mounting nothing',async()=>{
  const timers=[],mounted=[],els={},busy={on:false,classList:{add(){busy.on=true;},remove(){busy.on=false;}}};
  const MOD={mount(r,c){mounted.push(c.layout());},setMap(){},unmount(){}};
  const settle=()=>new Promise(r=>setImmediate(r)),tick=()=>{for(const t of timers.splice(0).sort((a,b)=>a.ms-b.ms))t.f();};
  const p=page([line('const VARIANTS='),line('const sheetsOf='),line('const codeOf='),fn('addCss'),fn('loadLayout'),fn('unloadExcept'),line('let active=null'),line('const ctx='),line('const validLayout='),fn('useLayout'),
    line('let pick='),fn('startPick'),fn('showPick'),fn('stepPick'),fn('endPick')],{
    LAYOUTS:[['atlas-dark','Atlas Dark'],['atlas','Atlas Light'],['atlas-satellite','Atlas Satellite'],['radar','Radar']],settings:{layout:'atlas-dark',place:{}},demo:false,saveSettings(){},MOD,
    registry:{atlas:MOD},bundled:true,document:{querySelector:()=>({_ended:true}),querySelectorAll:()=>[]}, // every stylesheet already in the page (loaded): the load lands at once
    $:id=>id==='busy'?busy:els[id]??={classList:{add(){},remove(){}},textContent:''},busyNow:false,requestAnimationFrame:f=>f(),setTimeout:(f,ms)=>timers.push({f,ms}),clearTimeout(){},
    stage:{classList:{add(){},remove(){}},dataset:{layout:'atlas-dark'}},root:{replaceChildren(){},className:''},pruneFitted(){},maps:{},lastModel:null,paintEdge(){},ensureDetail(){},detailNote:()=>'',refitScreens(){},flashCredits(){},open(){},setFocus(){}});
  vm.runInContext("active={id:'atlas-dark',mod:MOD}",p);
  const shown=()=>p.stage.dataset.layout;
  p.startPick(0);p.stepPick(1); // Settings > Layout > OK, Right: the key handler has returned
  await settle();
  assert.deepEqual(mounted,[],'not mounted inside the key\'s task');
  assert.equal(p.texts['pick-count'],'Layout 2 of 4');assert.equal(p.texts['pick-name'],'Atlas Light');assert.ok(busy.on,'the cog is on meanwhile');
  tick();await settle();
  assert.deepEqual(mounted,['atlas'],'mounted in the queued task');assert.equal(shown(),'atlas');assert.ok(!busy.on,'the cog clears after the mount');
  p.endPick(false);await settle(); // Back: the saved layout comes back the same way
  assert.deepEqual(mounted,['atlas'],'the revert waits for its task too');assert.ok(busy.on);
  tick();await settle();
  assert.deepEqual(mounted,['atlas','atlas-dark']);assert.equal(shown(),'atlas-dark');assert.ok(!busy.on);
  p.startPick(0);p.stepPick(1);await settle();p.endPick(false);await settle(); // Right, Back at once: the preview never lands
  tick();await settle();
  assert.deepEqual(mounted,['atlas','atlas-dark'],'Back in the window: the preview mounts nothing');assert.equal(shown(),'atlas-dark');
  assert.ok(!busy.on,'the cog is off');assert.equal(vm.runInContext('pick',p),null);
});

test('Settings > Distance and Altitude: a unit change saves, goes through the layout\'s refresh and a redraw of the model, and decodes or builds no map (the street map in memory is kept as it is)',()=>{
  const calls=[];
  const p=page([line('const RADII='),fn('adjustSetting'),fn('refreshLayout')],{settings:{distance:'mi',altitude:'ft',radiusMiles:3,place:{}},saveSettings(){calls.push('save');},useSettings(){},showSettings(){},
    busy:fn=>{calls.push('busy');fn();},active:{mod:{refresh(){calls.push('refresh');},setMap(){calls.push('setMap');}}},lastModel:{},draw(){calls.push('draw');},
    decodeDetail(){calls.push('decode');},savedDetail(){calls.push('saved');},buildDetail(){calls.push('build');},ensureDetail(){calls.push('ensure');},mapsChanged(){calls.push('maps');},
    startPick(){},stepMap(){},zoneChanged(){},tellApp(){},tellAwake(){},clearTimeout(){},setTimeout(){},zoneTimer:0,restartFeed(){},VIEW_MILES:[25],CHIME_VOLUME:{}});
  p.adjustSetting({id:'set-distance'},1);
  assert.equal(p.settings.distance,'km');assert.deepEqual(calls,['save','busy','refresh','draw']);
  calls.length=0;p.adjustSetting({id:'set-altitude'},1);
  assert.equal(p.settings.altitude,'m');assert.deepEqual(calls,['save','busy','refresh','draw']);
});

test('at launch a saved street map is read, decoded and painted in a task after the first planes are drawn (or after 1.5 s), not in the layout\'s mount; ensureDetail calls meanwhile wait for that task, which reads the map of the place, radius and layout of that moment; a later mount decodes at once',async()=>{
  const timers=[],calls=[],saved={v:5},cur={miles:10};
  const tick=()=>{for(const t of timers.splice(0).sort((a,b)=>a.ms-b.ms))t.f();};
  const p=page([line('let detailToken=0'),line('let active=null'),fn('ensureDetail'),fn('deferDetail'),fn('draw')],{
    settings:{place:{latitude:41.85,longitude:-87.65}},maps:{},mapMiles:()=>cur.miles,detailSpec:mi=>({key:mi>10?'wide':'r10'}),savedDetail:(pl,spec)=>{calls.push(`read ${pl.latitude} ${spec.key}`);return saved;},
    decodeDetail:m=>({...m,decoded:true}),mapsChanged(){calls.push('maps');},
    lastModel:null,adj:null,shown:m=>m,paintEdge(){},root:{querySelectorAll:()=>[]},fitLine(){},announce(){},
    setTimeout:(f,ms)=>timers.push({f,ms}),clearTimeout(){},buildDetail(){throw new Error('no build');},saveDetail(){},STALE:'stale'});
  const detail=()=>vm.runInContext('maps.detail',p),reset=()=>{p.maps={};p.lastModel=null;calls.length=0;timers.length=0;};
  vm.runInContext("active={id:'atlas-dark',mod:{map:'detail',render(){}}}",p);
  p.deferDetail();await p.ensureDetail(); // launch: the layout mounted before any model, then applyPlace
  assert.equal(detail(),undefined,'not read in the mount');assert.deepEqual(calls,[]);assert.deepEqual(timers.map(t=>t.ms),[1500],'one fallback timer');
  p.lastModel={};p.draw({}); // the first planes
  assert.equal(detail(),undefined,'nor in the task that draws them');assert.deepEqual(timers.map(t=>t.ms),[1500,20],'a task of its own after them');
  tick();assert.ok(detail()?.decoded,'read and decoded in that task');assert.deepEqual(calls,['read 41.85 r10','maps'],'once: the fallback then does nothing');
  reset();p.lastModel={};p.deferDetail(); // launch with the model there before the layout: the mount drew it
  assert.equal(detail(),undefined,'not in the mount');assert.deepEqual(timers.map(t=>t.ms),[20],'the task after it');tick();assert.deepEqual(calls,['read 41.85 r10','maps']);
  reset();p.deferDetail();tick(); // launch with no feed: the fallback paints it
  assert.ok(detail()?.decoded);assert.deepEqual(calls,['read 41.85 r10','maps']);
  reset();p.deferDetail();p.settings={place:{latitude:51.5,longitude:-.1}};await p.ensureDetail();tick(); // the place changed meanwhile (applyPlace)
  assert.deepEqual(calls,['read 51.5 r10','maps'],'the new place\'s saved map, once');
  reset();p.deferDetail();cur.miles=25;tick(); // the radius changed meanwhile (stepMap)
  assert.deepEqual(calls,['read 51.5 wide','maps'],'the new radius\'s saved map');
  reset();p.deferDetail();vm.runInContext("active={id:'radar',mod:{}}",p);tick(); // a base-map layout meanwhile
  assert.equal(detail(),undefined,'not this layout\'s');assert.deepEqual(calls,[]);
  vm.runInContext("active={id:'atlas-dark',mod:{map:'detail'}}",p);reset();p.lastModel={};await p.ensureDetail(); // a picker or radius step: a model is there
  assert.ok(detail()?.decoded,'decoded at once');assert.deepEqual(calls,['read 51.5 wide','maps']);
});

test('layout stylesheets: one already in the page but still loading (kept by unloadExcept, picked again) is waited for; a loaded one, or a new one, ends as before',()=>{
  const added=[];let found=null;
  const p=page([fn('addCss')],{document:{querySelector:()=>found,createElement:()=>({dataset:{}}),head:{append:l=>added.push(l)}}});
  const L=()=>{const h={};return {_ended:false,h,addEventListener(t,f,o){(h[t]??=[]).push(f);assert.equal(o?.once,true);}};};
  let n=0;const done=()=>n++;
  found=L();p.addCss('atlas-satellite',done);
  assert.equal(n,0,'not done while the sheet is still loading');assert.equal(added.length,0,'not added twice');
  found._ended=true;found.h.load[0]();assert.equal(n,1,'done when it loads');
  const bad=L();found=bad;p.addCss('atlas-satellite',done);bad.h.error[0]();assert.equal(n,2,'or fails');
  found={_ended:true};p.addCss('atlas',done);assert.equal(n,3,'a loaded sheet: at once');
  found=null;p.addCss('radar',done);assert.equal(added.length,1);assert.equal(added[0].href,'layouts/radar.css');assert.equal(n,3);
  added[0].onload();assert.equal(n,4);assert.equal(added[0]._ended,true);
});

test('screen reader: a plane the card keeps as Above you now just past the zone edge (the slack holds it) is not read again as it steps out and back in',()=>{
  const writes=[],sr={set textContent(v){writes.push(v);},get textContent(){return writes.at(-1)??'';}};
  const p=page([line('let spoken='),fn('announce')],{layer:null,adj:null,$:id=>id==='sr-live'?sr:null,fmt:{dist:d=>`${d.toFixed(1)} mi`},quietText:()=>'',demo:false});
  const H=(ground,inside,held=false)=>({hex:'a1b2c3',status:inside||held?'Above you now':'Nearest',flight:'N123HX',type:'Robinson R44',ground,inside,held});
  for(const h of [H(2.9,true),H(3.1,false,true),H(2.95,true),H(3.05,false,true),H(2.9,true)])p.announce({hero:h});
  assert.deepEqual(writes,['Above you now, N123HX, Robinson R44, 2.9 mi'],'a hover on the edge: one line');
  p.announce({hero:H(3.4,false)});assert.equal(writes.length,2,'read again once it really leaves');assert.match(writes[1],/^Nearest, N123HX/);
});
