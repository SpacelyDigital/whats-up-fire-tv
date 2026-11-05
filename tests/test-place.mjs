// Geocoding parsing, address detection, settings and unit formatting. The network is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPlaces,searchAddress,looksLikeAddress,looksLikePostcode,locateByIp,loadSettings,placeLabel,refineZone} from '../web/place.mjs';
import {useSettings,fmt} from '../web/kit.mjs';

// fetch stub: url pattern -> [status, body]. Unmatched URLs fail like a dropped connection.
function stub(routes){
  const seen=[];
  globalThis.fetch=async url=>{
    seen.push(url);
    for(const [pattern,[status,body]] of routes)if(pattern.test(url))
      return {status,text:async()=>typeof body==='string'?body:JSON.stringify(body)};
    throw new TypeError('network down');
  };
  return seen;
}
const meteo=(...results)=>[/geocoding-api\.open-meteo/,[200,{results}]];
const CHICAGO={name:'Chicago',admin1:'Illinois',country:'United States',country_code:'US',latitude:41.85,longitude:-87.65,timezone:'America/Chicago',elevation:180};

test('city search: Open-Meteo results become places, biggest first, with labels',async()=>{
  stub([meteo(CHICAGO,{name:'Chicago Heights',admin1:'Illinois',country:'United States',country_code:'US',latitude:41.5,longitude:-87.6,timezone:'America/Chicago'})]);
  const found=await searchPlaces('Chicago');
  assert.equal(found.length,2);
  assert.equal(placeLabel(found[0]),'Chicago, IL');
  assert.equal(found[0].timeZone,'America/Chicago');
});
test('city search: no results is [], a failure is null, one letter is []',async()=>{
  stub([[/geocoding-api/,[200,{}]]]);
  assert.deepEqual(await searchPlaces('Xqzzyv'),[]);
  stub([[/geocoding-api/,[503,'']]]);
  assert.equal(await searchPlaces('Chicago'),null);
  stub([]);
  assert.equal(await searchPlaces('Chicago'),null);
  assert.deepEqual(await searchPlaces('C'),[]);
});
test('city search: bad coordinates and unknown time zones are dropped or defaulted',async()=>{
  stub([meteo({name:'Nowhere',latitude:'x',longitude:2},{name:'Odd',latitude:10,longitude:20,timezone:'Mars/Olympus'})]);
  const found=await searchPlaces('somewhere');
  assert.equal(found.length,1);
  assert.equal(found[0].timeZone,'UTC');
});
test('search: a null or malformed entry in a reply is skipped, the other results are still shown',async()=>{
  stub([meteo(null,42,'x',[],CHICAGO)]);
  assert.deepEqual((await searchPlaces('Chicago')).map(placeLabel),['Chicago, IL'],'Open-Meteo');
  stub([[/census/,[200,{result:{addressMatches:[null,'x',{matchedAddress:'801 PLUM ST, CINCINNATI, OH, 45202',addressComponents:{city:'CINCINNATI',state:'OH'},coordinates:{x:-84.67,y:39.06}}]}}]]]);
  assert.deepEqual((await searchAddress('801 Plum St Cincinnati OH',{census:true})).map(p=>p.street),['801 Plum St'],'Census');
  stub([[/nominatim/,[200,[null,7,{lat:'51.5034',lon:'-0.1276',name:'10',address:{house_number:'10',road:'Downing Street',city:'London',country:'United Kingdom',country_code:'gb'}}]]]]);
  assert.deepEqual((await searchAddress('10 Downing Street, Westminster',{nominatim:true})).map(p=>p.street),['10 Downing Street'],'Nominatim');
});
test('address detection: house number then words; ZIPs and cities are not addresses',()=>{
  assert.ok(looksLikeAddress('123 Main St Cincinnati OH'));
  assert.ok(looksLikeAddress('10 Downing Street'));
  for(const q of ['45202','45202-1234','Chicago','SW1A 2AA',''])assert.ok(!looksLikeAddress(q),q);
});
test('address search: Census match first; its time zone is looked up when picked',async()=>{
  const seen=stub([
    [/geocoding\.geo\.census\.gov/,[200,{result:{addressMatches:[{matchedAddress:'801 PLUM ST, CINCINNATI, OH, 45202',
      addressComponents:{city:'CINCINNATI',state:'OH'},coordinates:{x:-84.6694,y:39.0550}}]}}]],
    [/api\.open-meteo\.com\/v1\/forecast/,[200,{timezone:'America/New_York',elevation:150}]],
  ]);
  const [p]=await searchAddress('801 Plum St Cincinnati OH',{census:true,nominatim:true});
  assert.equal(p.street,'801 Plum St');
  assert.equal(placeLabel(p),'Cincinnati, OH');
  assert.equal(p.source,'census');
  assert.ok(!seen.some(u=>/nominatim/.test(u)),'Nominatim not asked when Census matched');
  // Privacy policy: Open-Meteo gets a place's rounded location only when the user picks it.
  assert.ok(!seen.some(u=>/forecast/.test(u)),'no time zone lookup for matches that were only shown');
  assert.ok(p.tzGuess,'a stand-in time zone until picked');
  const picked=await refineZone(p);
  assert.ok(seen.some(u=>/latitude=39\.05&longitude=-84\.65&/.test(u)),'on pick: the snapped 0.05 degree grid point only');
  assert.equal(picked.timeZone,'America/New_York');assert.ok(!picked.tzGuess);
});
test('address search: falls back to Nominatim; both failing is null, no match is []',async()=>{
  stub([
    [/census/,[200,{result:{addressMatches:[]}}]],
    [/nominatim/,[200,[{lat:'51.5034',lon:'-0.1276',name:'10',address:{house_number:'10',road:'Downing Street',city:'London',state:'England',country:'United Kingdom',country_code:'gb'}}]]],
    [/forecast/,[200,{timezone:'Europe/London'}]],
  ]);
  const [p]=await searchAddress('10 Downing Street London',{census:true,nominatim:true});
  assert.equal(p.street,'10 Downing Street');
  assert.equal(placeLabel(p),'London, UK');
  assert.equal((await refineZone(p)).timeZone,'Europe/London','looked up when picked');
  stub([[/census/,[200,{result:{addressMatches:[]}}]],[/nominatim/,[200,[]]]]);
  assert.deepEqual(await searchAddress('1 Nowhere Lane Springfield OH',{census:true,nominatim:true}),[]);
  stub([]);
  assert.equal(await searchAddress('2 Nowhere Lane Springfield OH',{census:true,nominatim:true}),null,'both failing is null (and not cached)');
  // The same search again in this session is answered from the cache (Nominatim policy).
  const again=stub([]);
  assert.equal((await searchAddress('10 Downing Street London',{census:true,nominatim:true}))[0].street,'10 Downing Street');
  assert.equal(again.length,0,'no request for a repeated search');
});
test('address search: a non-U.S. address never reaches Census; store profile never asks Nominatim',async()=>{
  const seen=stub([[/nominatim/,[200,[]]]]);
  await searchAddress('10 Rue de Rivoli Paris',{census:true,nominatim:true});
  assert.ok(!seen.some(u=>/census/.test(u)),'Census not asked');
  const none=stub([]);
  assert.deepEqual(await searchAddress('5 Elm Street Springfield IL',{census:false,nominatim:false}),[]);
  assert.equal(none.length,0,'no request at all');
});
test('IP location: GeoJS reply becomes an unconfirmed guess with its accuracy',async()=>{
  stub([[/geojs/,[200,{city:'Cincinnati',region:'Ohio',country:'United States',country_code:'US',latitude:'39.05',longitude:'-84.65',timezone:'America/New_York',accuracy:20}]]]);
  const p=await locateByIp();
  assert.equal(placeLabel(p),'Cincinnati, OH');
  assert.equal(p.accuracyKm,20);
  stub([]);
  assert.equal(await locateByIp(),null);
});
test('coordinates: null, empty, blank, false or [] are no coordinate (never 0°), saved or from a service',async()=>{
  const CHI={name:'Chicago',admin:'Illinois',country:'United States',countryCode:'US',latitude:41.85,longitude:-87.65,timeZone:'America/Chicago'};
  for(const bad of [null,'',' ',false,[],true,{}])for(const k of ['latitude','longitude']){
    globalThis.localStorage={getItem:()=>JSON.stringify({place:{...CHI,[k]:bad},confirmed:true}),setItem(){},removeItem(){}};
    assert.equal(loadSettings().place,null,`saved ${k} ${JSON.stringify(bad)}`);
  }
  globalThis.localStorage={getItem:()=>JSON.stringify({place:CHI,confirmed:true}),setItem(){},removeItem(){}};
  assert.equal(loadSettings().place.latitude,41.85,'a real one is kept');
  delete globalThis.localStorage;
  stub([meteo(...[null,'',' ',false].map((v,i)=>({...CHICAGO,name:`Bad${i}`,latitude:v})),{...CHICAGO,name:'Badlon',longitude:null},{...CHICAGO,latitude:'41.85',longitude:'-87.65'})]);
  assert.deepEqual((await searchPlaces('Chicago')).map(p=>[p.name,p.latitude,p.longitude]),[['Chicago',41.85,-87.65]],'only the readable one');
  stub([[/geojs/,[200,{city:'Cincinnati',region:'Ohio',country:'United States',country_code:'US',latitude:'',longitude:'-84.6444',timezone:'America/New_York',accuracy:null}]]]);
  assert.equal(await locateByIp(),null,'an IP guess with no latitude is no guess');
  stub([[/geojs/,[200,{city:'Cincinnati',region:'Ohio',country:'United States',country_code:'US',latitude:'39.05',longitude:'-84.65',timezone:'America/New_York',accuracy:null}]]]);
  assert.equal((await locateByIp()).accuracyKm,null,'no accuracy is unknown, not 0 km');
});
test('settings: bad saved values fall back to safe defaults',()=>{
  globalThis.localStorage={getItem:()=>JSON.stringify({radiusMiles:99,distance:'parsecs',altitude:'m',layout:'<script>'}),setItem(){},removeItem(){}};
  const s=loadSettings();
  assert.equal(s.radiusMiles,10);assert.equal(s.distance,'mi');assert.equal(s.altitude,'m');assert.equal(s.layout,'atlas-dark');assert.equal(s.placeNames,'cities');
  delete globalThis.localStorage;
});
test('settings: a saved place that can\'t be read is damaged (the logbook and \'Recently above\' wait for a confirmed place); no place or an unconfirmed guess (saved as null) is not',async()=>{
  const {placeDamaged}=await import('../web/place.mjs');
  const CHI={name:'Chicago',countryCode:'US',latitude:41.85,longitude:-87.65,timeZone:'America/Chicago'};
  const damaged=raw=>{globalThis.localStorage={getItem:()=>raw,setItem(){},removeItem(){}};return placeDamaged();};
  for(const place of [{...CHI,latitude:'abc'},{...CHI,latitude:91},{...CHI,longitude:'x'},'Chicago',{},[41.85,-87.65],true]){
    assert.equal(damaged(JSON.stringify({place,confirmed:true})),true,JSON.stringify(place));
    assert.equal(loadSettings().place,null);
  }
  for(const raw of [JSON.stringify({place:CHI,confirmed:true}),JSON.stringify({place:null,mapMiles:25}),'{}','[]','"x"','null'])assert.equal(damaged(raw),false,raw);
  delete globalThis.localStorage;
});
test('units: miles/knots/feet and km/km-h/metres, flight levels above 18,000 ft',()=>{
  useSettings({distance:'mi',altitude:'ft'});
  assert.equal(fmt.dist(2.345),'2.3 mi');assert.equal(fmt.speed(400),'400 kt');assert.equal(fmt.alt(35000),'FL350');
  useSettings({distance:'km',altitude:'m'});
  assert.equal(fmt.dist(1),'1.6 km');assert.equal(fmt.speed(100),'185 km/h');assert.match(fmt.alt(10000),/^3,?048 m$/);
  assert.equal(fmt.dist(undefined),'—');
});

// --- Map radius
import {MAP_RADII,alertFor} from '../web/place.mjs';
import {niceStep,niceDistance,zoom,range} from '../web/kit.mjs';
import {zoomFor,savedMap,saveMap,savedDetail,saveDetail,decodeDetail,detailSpec} from '../web/mapgen.mjs';
test('map radius: saved value must be a step, default 10; alert ring never wider than the map',()=>{
  for(const [saved,want] of [[50,50],[7,10],['250',250],[undefined,10]]){
    globalThis.localStorage={getItem:()=>JSON.stringify({mapMiles:saved}),setItem(){},removeItem(){}};
    assert.equal(loadSettings().mapMiles,want);
  }
  delete globalThis.localStorage;
  assert.deepEqual(MAP_RADII,[2,5,10,15,25,50,100,150,250]);
  assert.equal(alertFor(3,2),2);assert.equal(alertFor(3,250),3);assert.equal(alertFor(10,5),5);
});
test('map radius: view zoom, round ring/scale steps, tile zoom per radius',()=>{
  useSettings({mapMiles:250,distance:'mi'});
  assert.equal(range(),250);assert.equal(zoom(),.04);
  assert.equal(niceStep(25),20);assert.equal(niceStep(1),1);assert.equal(niceStep(.16),.2);assert.equal(niceStep(3.3),5);
  const bar=niceDistance({ppm:54},60);
  assert.equal(bar.label,'50 miles');assert.ok(bar.px>40&&bar.px<120,String(bar.px));
  useSettings({mapMiles:2,distance:'km'});
  assert.equal(niceDistance({ppm:54},60).label,'0.5 km');
  assert.deepEqual([2,10,15,25,50,100,150,250].map(zoomFor),[10,10,10,9,8,7,6,6]);
});
test('map radius: one saved map per radius, the current and the one before kept',()=>{
  const data=new Map();
  globalThis.localStorage={getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
  const home={latitude:39.05,longitude:-84.65},layers={water:[],shore:[],rivers:[],roads:[],runways:[],airports:[],airfields:[],shields:[],places:[]};
  for(const range of [10,50,250,2])saveMap({v:4,latitude:39.05,longitude:-84.65,range,built:Date.now(),...layers});
  for(const r of [10,50])assert.equal(savedMap(home,r),null,'older radii dropped');
  for(const r of [250,2])assert.equal(savedMap(home,r)?.range,r);
  // Past 30 days: not used as is, but available as a stand-in while a new one is built.
  saveMap({v:4,latitude:39.05,longitude:-84.65,range:2,built:Date.now()-31*86400000,...layers});
  assert.equal(savedMap(home,2),null);
  assert.equal(savedMap(home,2,{stale:true})?.range,2);
  assert.equal(savedMap({latitude:40,longitude:-84.65},2),null,'another place');
  delete globalThis.localStorage;
});
test('saved maps: a base map with a damaged layer (not a list, a null or malformed feature) is dropped, so it is built again',()=>{
  const data=new Map();
  globalThis.localStorage={getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
  const home={latitude:41.85,longitude:-87.65};
  const base={v:4,...home,range:10,zoom:10,built:Date.now()-60000,water:[[[-3,-3],[3,-3],[3,3],[-3,-3]]],shore:[[[0,0],[1,1]]],rivers:[],
    roads:[{c:'motorway',major:true,p:[[-9,0],[9,0]]}],runways:[],airports:[{code:'ORD',iata:'ORD',icao:'KORD',name:'O\'Hare',kind:'international',x:-13,y:9}],
    airfields:[{name:'Lansing',code:'',iata:'',kind:'',x:5,y:-20}],shields:[{ref:'90',x:0,y:1}],places:[{name:'Chicago',c:'city',rank:1,x:0,y:0}]};
  saveMap(base);
  assert.equal(savedMap(home,10)?.range,10,'an intact map is used');
  for(const [what,patch] of [['airports as an object',{airports:{ORD:1}}],['places as text',{places:'Chicago'}],['a null road',{roads:[null,...base.roads]}],
    ['shields as an object',{shields:{}}],['no water layer',{water:undefined}],['a road with no line',{roads:[{c:'motorway',p:5}]}],['a null point',{rivers:[[[0,0],null]]}],
    ['a place with no name',{places:[{c:'city',x:0,y:0}]}],['an airport off the map',{airports:[{code:'ORD',x:'west',y:9}]}]]){
    saveMap({...base,...patch});
    assert.equal(savedMap(home,10),null,what);
    assert.equal(savedMap(home,10,{stale:true}),null,`${what}: not shown while a new one is built either`);
    assert.equal(data.get('whatsup.map.v2'),undefined,`${what}: discarded`);
  }
  delete globalThis.localStorage;
});
test('saved maps: a street map with a damaged layer (missing, not a list, a feature with no line) is dropped, so it is built again',()=>{
  const data=new Map();
  globalThis.localStorage={getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
  const home={latitude:41.85,longitude:-87.65};
  for(const mi of [2,10,25]){
    const spec=detailSpec(mi),key=spec.key==='street'?'whatsup.detail.v1':spec.key==='r10'?'whatsup.detail.v1.r10':'whatsup.detail.v1.wide';
    const detail={v:4,...home,range:spec.range,zoom:spec.zoom,key:spec.key,per:1000,buildingRange:spec.buildings,inner:spec.inner,built:Date.now()-60000,
      water:[{r:'0,0,100,0,0,100,-100,0'}],shore:[],waterways:[{c:'river',p:'0,0,5,5'}],roads:[{c:'minor',p:'0,0,10,0'}],landuse:[],parks:[],aero:[],buildings:[],places:[{name:'Loop',c:'quarter',rank:1,x:0,y:0}]};
    saveDetail(detail);
    assert.ok(decodeDetail(savedDetail(home,spec)).roads[0].p instanceof Int16Array,`${mi} mi: an intact one is used`);
    for(const [what,patch] of [['no roads',{roads:undefined}],['a road with a number for its line',{roads:[{c:'minor',p:5}]}],['water as an object',{water:{}}],
      ['a null building',{buildings:[null]}],['places as text',{places:'Loop'}],['a place with no name',{places:[{c:'city',x:0,y:0}]}]]){
      saveDetail({...detail,...patch});
      assert.equal(savedDetail(home,spec),null,`${mi} mi: ${what}`);
      assert.equal(savedDetail(home,spec,{stale:true}),null,`${mi} mi: ${what}: not shown while a new one is built either`);
      assert.equal(data.get(key),undefined,`${mi} mi: ${what}: discarded`);
    }
  }
  delete globalThis.localStorage;
});
test('keep screen awake: off unless turned on (a saved ON is kept)',()=>{
  for(const [saved,want] of [[undefined,false],[true,true],[false,false],['no',false]]){
    globalThis.localStorage={getItem:()=>JSON.stringify({keepAwake:saved}),setItem(){},removeItem(){}};
    assert.equal(loadSettings().keepAwake,want);
  }
  delete globalThis.localStorage;
});

// --- Alert zone: Window view
import {inBearings,inZone,zoneOutline,ABOVE_MI} from '../web/core.mjs';
test('window view: bearings in range, including ranges that cross north',()=>{
  assert.ok(inBearings(74,74,175)&&inBearings(175,74,175)&&inBearings(120,74,175));
  assert.ok(!inBearings(73,74,175)&&!inBearings(176,74,175)&&!inBearings(300,74,175));
  assert.ok(inBearings(350,300,40)&&inBearings(0,300,40)&&inBearings(40,300,40)&&inBearings(-10,300,40)&&inBearings(370,300,40));
  assert.ok(!inBearings(41,300,40)&&!inBearings(299,300,40)&&!inBearings(180,300,40));
});
test('window view: wedge reach, overhead always counts, circle unchanged',()=>{
  const z={kind:'window',from:74,to:175,miles:25};
  const at=(deg,mi)=>[mi*Math.sin(deg*Math.PI/180),mi*Math.cos(deg*Math.PI/180)];
  assert.ok(inZone(z,...at(120,24)));
  assert.ok(!inZone(z,...at(120,26)),'beyond the distance');
  assert.ok(!inZone(z,...at(270,5)),'behind the window');
  assert.ok(inZone(z,...at(270,ABOVE_MI*.9)),'right above counts from any side');
  const c={kind:'circle',radius:3};
  assert.ok(inZone(c,...at(270,2.9))&&!inZone(c,...at(90,3.1)));
  const ring=zoneOutline(z);
  assert.deepEqual(ring[0],[0,0]);assert.deepEqual(ring.at(-1),[0,0]);
  assert.ok(Math.abs(Math.hypot(...ring[1])-25)<1e-9);
});
test('window view settings: defaults and saved values',()=>{
  globalThis.localStorage={getItem:()=>JSON.stringify({alertZone:'window',viewFrom:434,viewTo:-185,viewMiles:33}),setItem(){},removeItem(){}};
  const s=loadSettings();
  assert.equal(s.alertZone,'window');assert.equal(s.viewFrom,74);assert.equal(s.viewTo,175);assert.equal(s.viewMiles,25);
  delete globalThis.localStorage;
});

test('Census gets only text that looks like a U.S. address', async () => {
  const {looksLikeUSAddress}=await import('../web/place.mjs');
  for(const q of ['123 Main St, Cincinnati, OH','123 MAIN ST CINCINNATI OH','1600 Pennsylvania Ave NW Washington DC 20500','12 Calle Luna San Juan Puerto Rico',
    '400 Marine Dr, Tamuning, GU 96913','5 Elm Street Springfield, IL','77 Oak Rd 45202'])assert.ok(looksLikeUSAddress(q),q);
  for(const q of ['10 Downing Street London','123 Main St','221B Baker Street','45202','Cincinnati','8 Rue de Rivoli Paris','12 Queen St W Toronto ON'])assert.ok(!looksLikeUSAddress(q),q);
});
test('Census: a state name counts only at the end or after a comma, and a state code that is also a country code (DE, IN, CO, ME...) only after a comma or with a ZIP',async()=>{
  const {looksLikeUSAddress}=await import('../web/place.mjs');
  for(const q of ['4 Elm Street, Springfield, IL','22 Market St Wilmington DE 19801','9 Meridian St Indianapolis, IN','1 Main St Springfield Illinois','1 Peachtree St Atlanta Georgia',
    '1 Main St, Springfield, Illinois, USA','350 Fifth Ave, New York','350 Fifth Ave New York NY','2 Main St Tulsa OK'])assert.ok(looksLikeUSAddress(q),q);
  for(const q of ['22 BAKER ST LONDON DE','5 UNTER DEN LINDEN BERLIN DE','10 KING ST SYDNEY ME','7 PLAZA MAYOR MADRID CO','9 VIA ROMA MILANO IN','12 MG ROAD BANGALORE IN',
    '800 W GEORGIA ST VANCOUVER BC','10 STATION RD VIRGINIA WATER','10 Station Rd, Virginia Water, Surrey','5 WASHINGTON ST LONDON','45 FLORIDA BUENOS AIRES',
    '3 COLORADO ST MADRID','1 INDIANA AVE KINGSTON'])assert.ok(!looksLikeUSAddress(q),q);
  const seen=stub([[/nominatim/,[200,[]]]]);
  await searchAddress('22 Baker St London DE',{census:true,nominatim:true});
  assert.ok(!seen.some(u=>/census/.test(u))&&seen.some(u=>/nominatim/.test(u)),'to Nominatim, not the Census Bureau');
});

test('place search: "Rosemont, Illinois" and "Rosemont IL" search the name, then match the state',async()=>{
  const reply={results:[{name:'Rosemont',admin1:'Illinois',country:'United States',country_code:'US',latitude:41.995,longitude:-87.884,timezone:'America/Chicago'},
    {name:'Rosemont',admin1:'Pennsylvania',country:'United States',country_code:'US',latitude:40.03,longitude:-75.33,timezone:'America/New_York'}]};
  for(const q of ['Rosemont, Illinois','ROSEMONT IL','Rosemont Illinois']){
    const seen=stub([[/name=Rosemont&/i,[200,reply]],[/search\?name=/,[200,{}]]]);
    const found=await searchPlaces(q);
    assert.deepEqual(found.map(p=>placeLabel(p)),['Rosemont, IL'],q);assert.equal(seen.length,2,q);
  }
});
test('place search: a city and a three-letter country code ("TORONTO CAN", "LONDON GBR") match like the two-letter code or the name',async()=>{
  const at=(name,admin1,country,country_code)=>({name,admin1,country,country_code,latitude:10,longitude:10,timezone:'UTC'});
  const LONDON=[at('London','England','United Kingdom','GB'),at('London','Ontario','Canada','CA'),at('London','Ohio','United States','US')];
  for(const [q,results,want] of [['TORONTO CAN',[at('Toronto','Ontario','Canada','CA')],['Toronto, ON']],['PARIS FRA',[at('Paris','Île-de-France','France','FR'),at('Paris','Texas','United States','US')],['Paris, France']],
    ['LONDON GBR',LONDON,['London, UK']],['London, CAN',LONDON,['London, ON']],['SYDNEY AUS',[at('Sydney','New South Wales','Australia','AU'),at('Sydney','Nova Scotia','Canada','CA')],['Sydney, Australia']],
    ['TOKYO JPN',[at('Tokyo','Tokyo','Japan','JP')],['Tokyo, Japan']],['CAPE TOWN RSA',[at('Cape Town','Western Cape','South Africa','ZA')],['Cape Town, South Africa']],
    ['CAPE TOWN ZAF',[at('Cape Town','Western Cape','South Africa','ZA')],['Cape Town, South Africa']],['BERLIN DEU',[at('Berlin','Land Berlin','Germany','DE')],['Berlin, Germany']]]){
    const name=q.replace(/,?\s+\S+$/,'');
    stub([[new RegExp(`name=${encodeURIComponent(name)}&`,'i'),[200,{results}]],[/search\?name=/,[200,{}]]]);
    assert.deepEqual((await searchPlaces(q)).map(placeLabel),want,q);
  }
});

test('window view: no saved window shows the example ENE 74° to S 175°, 25 mi; a saved one is kept',()=>{
  globalThis.localStorage={getItem:()=>JSON.stringify({alertZone:'circle'}),setItem(){},removeItem(){}};
  let s=loadSettings();
  assert.equal(s.viewFrom,74);assert.equal(s.viewTo,175);assert.equal(s.viewMiles,25);
  globalThis.localStorage={getItem:()=>JSON.stringify({alertZone:'window',viewFrom:300,viewTo:40,viewMiles:10}),setItem(){},removeItem(){}};
  s=loadSettings();
  assert.equal(s.viewFrom,300);assert.equal(s.viewTo,40);assert.equal(s.viewMiles,10);
  delete globalThis.localStorage;
});

test('address search privacy: a failed Census search never falls through to Nominatim; only postcode-like text does',async()=>{
  const seen=stub([[/census/,[500,'']],[/nominatim/,[200,[]]]]);
  assert.equal(await searchAddress('3087 Terminal Dr Hebron KY 41048',{census:true,nominatim:true}),null,'Search is unavailable, Try again');
  assert.ok(!seen.some(u=>/nominatim/.test(u)),'the U.S. address was not sent to Nominatim');
  const off=stub([[/nominatim/,[200,[]]]]);
  assert.equal(await searchAddress('4 Elm Street, Springfield, IL',{census:true,nominatim:true}),null,'Census unreachable: null, still no Nominatim');
  assert.ok(!off.some(u=>/nominatim/.test(u)));
  for(const t of ['SW1A 2AA','M5V 3L9','75008','10115'])assert.ok(looksLikePostcode(t),t);
  for(const t of ['CHICAGOO','St Johns','Springfield'])assert.ok(!looksLikePostcode(t),t);
});
test('search text from the break-it list: empty, long, right-to-left, markup or script, emoji, a ZIP and an address at CVG',async()=>{
  const {looksLikeUSAddress}=await import('../web/place.mjs');
  let seen=stub([meteo()]);
  for(const q of ['','   ','​​'])assert.deepEqual(await searchPlaces(q),[],JSON.stringify(q));
  assert.equal(seen.length,0,'nothing is asked for empty text');
  const name=u=>decodeURIComponent(new URL(u).searchParams.get('name'));
  seen=stub([meteo()]);await searchPlaces('Hebron '.repeat(40));
  // No match: one more try without the last word (as for "Rosemont IL"), no more.
  assert.ok(seen.length>=1&&seen.length<=2&&seen.every(u=>name(u).length<=60),`long text is cut to 60 characters: ${seen.map(u=>name(u).length)}`);
  for(const q of ['القاهرة','<script>alert(1)</script>','"Hebron" & <b>KY</b>','✈ Hebron ✈']){
    seen=stub([meteo()]);assert.deepEqual(await searchPlaces(q),[],q);
    assert.equal(name(seen[0]),q,`${q}: sent as typed, encoded`);assert.ok(seen.length<=2&&seen.every(u=>!/[<>"\s]/.test(u.split('?')[1])),`${q}: nothing raw in the URL`);
  }
  // A ZIP is a postcode, not an address; CVG's own street address is a U.S. address (Census).
  assert.ok(looksLikePostcode('41048')&&!looksLikeAddress('41048'));
  assert.ok(looksLikeUSAddress('3087 Terminal Dr, Hebron, KY 41048'));
  seen=stub([meteo({name:'Hebron',admin1:'Kentucky',country:'United States',country_code:'US',latitude:39.07,longitude:-84.7,timezone:'America/New_York'})]);
  assert.equal(placeLabel((await searchPlaces('41048'))[0]),'Hebron, KY');assert.equal(name(seen[0]),'41048');
});
