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

test('the street map\'s note stays while it is drawn: the base map landing first or a base-map layout in between doesn\'t clear it; a failure says so only on a street-map layout; the base map\'s note wins',async()=>{
  const {dLon}=await import('../web/core.mjs');
  const builds=[],bases=[],settle=()=>new Promise(r=>setImmediate(r)),place={latitude:41.85,longitude:-87.65};
  const MODS={blueprint:{map:'detail'},swiss:{},radar:{}};for(const m of Object.values(MODS))Object.assign(m,{mount(){},setMap(){}});
  const p=page([line('let active=null'),line('let detailToken=0'),line('const detailNote='),fn('useLayout'),fn('ensureDetail'),fn('applyPlace')],{dLon,
    settings:{place:null},maps:{},mapMiles:()=>10,detailSpec:()=>({key:'r10'}),detailFits:()=>true,savedDetail:()=>null,decodeDetail:m=>m,saveDetail(){},mapsChanged(){},STALE:'stale',
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
  const detail=(console,e)=>page([fn('ensureDetail')],{console,settings:{place},maps:{},mapMiles:()=>10,detailSpec:()=>({}),savedDetail:()=>null,detailToken:0,detailBusy:false,detailTries:0,detailRetry:0,
    baseNote:'',clearTimeout(){},setTimeout(){},buildDetail:async()=>{throw e;},STALE:'stale'}).ensureDetail();
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
  const p=page([line('const CONSENT_KEY='),line('function hasConsent\\('),line('const anyStored='),fn('openPrivacy')],{$,renderDoc(){},window:{},PRIVACY_URL:'',themedQr(){},open(){},localStorage:null});
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
    const p=page([fn('boot')],{buildKeys(){},fitText(){},$:()=>({}),tellAwake(){},query:{get:()=>null},VIEW_MILES:[25],MAP_RADII:[10],validLayout:id=>id,useSettings(){},
      hasConsent:()=>true,useLayout(){},refineZone:async()=>null,placeDamaged:()=>damaged,locating:false,locateByIp:async()=>found,setTimeout(){},layer:null,
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

test('launch: a saved place with a null, empty, blank or false coordinate can\'t be read either, so \'Recently above\' and the logbook wait for a confirmed place (home is never put at 0°)',async()=>{
  const {loadSettings,saveSettings,placeDamaged}=await import('../web/place.mjs');
  const CHI={name:'Chicago',countryCode:'US',latitude:41.85,longitude:-87.65,timeZone:'America/Chicago'},GUESS={name:'Chicago',latitude:41.878,longitude:-87.63,source:'ip'};
  const saved={};globalThis.localStorage={getItem:k=>saved[k]??null,setItem:(k,v)=>{saved[k]=String(v);},removeItem:k=>{delete saved[k];}};
  try{
    for(const [k,v] of [['latitude',null],['longitude',null],['latitude',''],['longitude',' '],['latitude',false],['longitude',[]]]){
      const place={...CHI,[k]:v},tag=`${k} ${JSON.stringify(v)}`;saved['whatsup.settings.v1']=JSON.stringify({place,confirmed:true,layout:'radar'});
      const seen=[],settings=loadSettings();
      assert.equal(settings.place,null,`${tag}: no place`);assert.equal(placeDamaged(),true,`${tag}: damaged`);
      const p=page([fn('boot')],{buildKeys(){},fitText(){},$:()=>({}),tellAwake(){},query:{get:()=>null},VIEW_MILES:[25],MAP_RADII:[10],validLayout:id=>id,useSettings(){},
        hasConsent:()=>true,useLayout(){},refineZone:async()=>null,placeDamaged,locating:false,locateByIp:async()=>GUESS,setTimeout(){},layer:null,settings,
        showWelcome:pl=>seen.push(['welcome',pl.name]),openLocate:()=>seen.push(['search']),applyPlace:(pl,o)=>seen.push(['apply',pl.latitude,o?.fresh??false])});
      await p.boot();
      assert.deepEqual(seen,[['apply',41.878,false],['welcome','Chicago']],`${tag}: kept on the IP guess`);
      saveSettings(p.settings);assert.deepEqual(JSON.parse(saved['whatsup.settings.v1']).place,place,`${tag}: still saved for the next launch`);
    }
  }finally{delete globalThis.localStorage;}
});

test('an outage: with no model for minutes the dashboard is drawn again at each minute through the feed\'s tick (its clock, date and tallies move on), not while hidden, and at once when shown again',()=>{
  let t=Date.parse('2026-11-06T05:59:35Z'),ticks=0;const timers=new Set(),drawn=[];
  // The feed's tick() (model.mjs) runs the model again: the time, the day's tallies and the countdown move on together.
  const feed={resume(){},pause(){},tick(){ticks++;p.render({...p.lastModel,now:t});}};
  const p=page([line('let clockTimer='),fn('keepTime'),fn('render'),line('window.__whatsupActive=')],{window:{},onScreen:true,lastModel:null,Date:{now:()=>t},
    setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.add(h);return h;},clearTimeout:h=>{timers.delete(h);},
    draw:m=>drawn.push(m.now),listen(){},countDown(){},credited:'',sourceFlashAt:0,SOURCE_FLASH_MS:0,flashCredits(){},performance:{now:()=>0},
    feed,flushLog(){}});
  const run=ms=>{const end=t+ms;for(let h;(h=[...timers].sort((a,b)=>a.at-b.at)[0])&&h.at<=end;){timers.delete(h);t=h.at;h.fn();}t=end;};
  const at=(ms)=>new Date(ms).toISOString().slice(11,19);
  p.render({live:true,fresh:false,now:t,source:''}); // 23:59:35 Chicago: "No live data", the next poll 5 min away
  assert.deepEqual(drawn.map(at),['05:59:35'],'drawn once as it came');
  run(25100);assert.deepEqual(drawn.map(at),['05:59:35','06:00:00'],'again just after the minute');
  assert.equal(ticks,1,'the model asked of the feed again, not a copy with the new time');assert.equal(timers.size,1,'one timer');
  assert.equal(vm.runInContext('lastModel.now',p),drawn.at(-1),'the model kept is the one drawn (a layout switch draws that time)');
  run(60000);assert.equal(drawn.length,3,'and each minute after');assert.equal(at(drawn.at(-1)),'06:01:00');
  p.window.__whatsupActive(false);run(150000);assert.equal(drawn.length,3,'not while hidden');assert.equal(timers.size,0);
  p.window.__whatsupActive(true);assert.equal(drawn.length,4,'at once back on screen');assert.equal(at(drawn.at(-1)),'06:03:30');
  p.window.__whatsupActive(true);assert.equal(drawn.length,4,'not twice in a minute');
  run(30000);assert.equal(at(drawn.at(-1)),'06:04:00');
  p.render({live:true,fresh:true,now:t,source:''});run(300000);assert.equal(drawn.length,6,'a fresh model: no minute draws (polls draw it)');assert.equal(timers.size,0);
  p.render({live:false,fresh:true,now:t,source:''});run(120000);assert.equal(drawn.length,7,'nor in the demo');
  assert.equal(ticks,4,'every minute draw came through the feed');
});

test('screen reader: closing the last screen reads the plane now on the card at once (an emergency begun behind Settings too); closing onto another screen, or the next poll, reads nothing more',()=>{
  const writes=[],sr={set textContent(v){writes.push(v);},get textContent(){return writes.at(-1)??'';}};
  const screen=id=>({id,hidden:false,style:{}});
  const p=page([line('let spoken='),fn('announce'),fn('draw'),fn('close')],{layer:null,layers:[],adj:null,lastModel:null,settings:{place:{}},active:{mod:{render(){}}},
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

test('Settings: a Map radius step kept with OK, then another row\'s edit cancelled with Back before the step\'s 700 ms apply: the place is applied once for the new radius (its base map is built), not only the feed restarted; a cancelled step, or a step already applied, as before',()=>{
  let t=0;const timers=new Set(),calls=[];
  const settings={mapMiles:10,placeNames:'cities',radiusMiles:5,alertZone:'circle',place:{latitude:41.85,longitude:-87.65}};
  const p=page([line('let zoneTimer='),line('let editing='),line('let editSnap='),line('let mapTimer='),fn('select'),fn('adjustSetting'),fn('stepMap'),fn('editKey'),fn('stopEdit'),fn('cancelEdit')],
    {settings,MAP_RADII:[2,5,10,15,25,50],mapMiles:()=>settings.mapMiles,fmt:{dist:v=>`${v} mi`},alertFor:r=>r,maps:{detail:null},detailFits:()=>true,detailSpec:()=>({}),layer:{id:'settings'},
    saveSettings(){},useSettings(){},showSettings(){},tellAwake(){},busy(){},mapsChanged(){},refreshLayout(){},editHint(){},toast(){},store:{remove(){}},HISTORY_KEY:'h',
    applyPlace:()=>calls.push('apply'),restartFeed:()=>calls.push('feed'),
    setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.add(h);return h;},clearTimeout:h=>{timers.delete(h);}});
  const run=ms=>{const end=t+ms;for(let h;(h=[...timers].sort((a,b)=>a.at-b.at)[0])&&h.at<=end;){timers.delete(h);t=h.at;h.fn();}t=end;};
  const row=id=>({id,dataset:{edit:'',adjust:''},classList:{add(){},remove(){}}}),MAP=row('set-map'),PLACES=row('set-places');
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
});

test('a held Play/Pause or Menu key acts once, as a held OK does: its repeats are ignored, so Settings no longer opens and closes over and over; a held Back or letter still repeats',()=>{
  const region=/^const DIRS=[\s\S]*?^\}\);$/m.exec(APP)?.[0];assert.ok(region,'the keydown handler in app.mjs');
  let handler;const seen=[];
  const p=page([region],{document:{addEventListener:(t,f)=>{if(t==='keydown')handler=f;}},busyNow:false,layer:null,adj:null,editing:null,heldOk:null,
    openSettings:()=>{seen.push('open');p.layer={id:'settings'};},back:()=>{seen.push('back');p.layer=null;},typeKey:k=>seen.push(k),
    $:()=>({}),move(){},select(){},stepMap(){},stepPlanes(){}});
  const hold=(key,keyCode,n=12)=>{seen.length=0;for(let i=0;i<=n;i++)handler({key,keyCode,repeat:i>0,preventDefault(){}});return seen.join();};
  assert.equal(hold('MediaPlayPause',179),'open','held on the dashboard: Settings opens once');
  assert.equal(hold('MediaPlayPause',179),'back','held in Settings: it closes once');
  assert.equal(hold('Unidentified',179),'open','Play/Pause by its key code');
  p.layer=null;
  for(const [key,code] of [['ContextMenu',93],['Menu',82],['Unidentified',82],['Enter',13]]){p.layer=null;assert.equal(hold(key,code),'open',`${key} (${code}) held`);}
  p.layer={id:'settings'};assert.equal(hold('Escape',27,3),'back,back,back,back','a held Back repeats as before');
  p.layer={id:'locate'};assert.equal(hold('r',82,3),'R,R,R,R','a held R on the search screen types R each repeat');
});
