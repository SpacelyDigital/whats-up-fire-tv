// node --test tests/  — geometry edge cases: Window view zones across north, distances and
// selection at the antimeridian and near the poles, and the 0.05 degree location snapping
// used for every coordinate that leaves the TV (feed queries, time zone, map tiles).
// Tests marked {todo:'BUG: ...'} expose a real bug (see qa/overnight-2026-11-02/FINDINGS-unit.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {inBearings,inZone,zoneOutline,norm,ABOVE_MI,snapDeg,snapped,GRID_DEG,GRID_PAD_NM,distanceMiles,airspace,IDS,coordinates} from '../web/core.mjs';
import {selection,observations,haversine,feedUrlFor,MAX_NM} from '../web/live.mjs';

const R=Math.PI/180;
// A point `mi` miles from home on compass bearing `deg` (small distances; flat earth is fine).
const at=(home,deg,mi)=>({lat:home.latitude+mi*Math.cos(deg*R)/69,lon:home.longitude+mi*Math.sin(deg*R)/(69.172*Math.cos(home.latitude*R))});
const xy=(deg,mi)=>[mi*Math.sin(deg*R),mi*Math.cos(deg*R)];
const plane=(hex,p,extra={})=>({hex,lat:p.lat,lon:p.lon,alt_baro:20000,seen_pos:1,flight:'TST1',...extra});
const NOW=1793577600; // 2026-11-02T00:00:00Z

// --- Window view zones across north -----------------------------------------------------------
test('window view: 350° to 10° crosses north (a 20° wedge)',()=>{
  for(const b of [350,355,0,359.99,5,10,-10,370,710])assert.ok(inBearings(b,350,10),`${b} is in 350-10`);
  for(const b of [349.9,10.1,180,90,270,-11])assert.ok(!inBearings(b,350,10),`${b} is not in 350-10`);
  const z={kind:'window',from:350,to:10,miles:20};
  assert.ok(inZone(z,...xy(0,15))&&inZone(z,...xy(355,19.9))&&inZone(z,...xy(9,5)));
  assert.ok(!inZone(z,...xy(15,5))&&!inZone(z,...xy(345,5))&&!inZone(z,...xy(0,20.1)));
  // The drawn outline covers exactly the same 20 degrees.
  const ring=zoneOutline(z),edge=ring.slice(1,-1).map(([x,y])=>norm(Math.atan2(x,y)/R));
  assert.ok(Math.abs(edge[0]-350)<1e-6&&Math.abs(edge.at(-1)-10)<1e-6,`outline runs ${edge[0]} -> ${edge.at(-1)}`);
  assert.ok(edge.every(b=>inBearings(b+1e-9,350,10)||inBearings(b-1e-9,350,10)),'every outline point is inside the wedge');
});
test('window view: 0° to 359° is almost all round; only the last degree before north is out',()=>{
  for(const b of [0,1,90,180,270,358.9,359,360,720])assert.ok(inBearings(b,0,359),String(b));
  for(const b of [359.5,-0.5])assert.ok(!inBearings(b,0,359),String(b));
  const z={kind:'window',from:0,to:359,miles:10};
  assert.ok(inZone(z,...xy(180,9))&&!inZone(z,...xy(359.5,9)));
  assert.ok(inZone(z,...xy(359.5,ABOVE_MI*.5)),'overhead still counts');
  const ring=zoneOutline(z);
  assert.ok(ring.length>=90,'a 359° wedge is drawn with many steps');
});
test('window view: 180° to 90° wraps through west and north (270° wide), not 90° to 180°',()=>{
  for(const b of [180,225,270,315,0,45,90])assert.ok(inBearings(b,180,90),String(b));
  for(const b of [91,120,135,179])assert.ok(!inBearings(b,180,90),String(b));
  const z={kind:'window',from:180,to:90,miles:25};
  assert.ok(inZone(z,...xy(270,24))&&!inZone(z,...xy(135,24)));
  const ring=zoneOutline(z),edge=ring.slice(1,-1).map(([x,y])=>norm(Math.atan2(x,y)/R));
  assert.ok(edge.every(b=>!(b>90.001&&b<179.999)),'the outline never enters the 90-180 gap');
});
test('window view: the wedge test agrees with the outline for every whole-degree window',()=>{
  // Sample many windows: a bearing half way along the outline is inside, one in the gap is out.
  for(let from=0;from<360;from+=23)for(let to=0;to<360;to+=29){
    if(from===to)continue;
    const span=norm(to-from),mid=norm(from+span/2),gap=norm(to+(360-span)/2);
    assert.ok(inBearings(mid,from,to),`${from}->${to}: middle ${mid}`);
    if(span<359)assert.ok(!inBearings(gap,from,to),`${from}->${to}: gap ${gap}`);
  }
});
test('window view: a saved window with from = to (zero width) draws and counts the same thing',{todo:'BUG: zoneOutline draws a full circle for from===to while inZone counts only that one bearing (see FINDINGS-unit.md U-08)'},()=>{
  const z={kind:'window',from:90,to:90,miles:10};
  const drawnSpan=norm(z.to-z.from)||360;
  const counted=[0,45,90,135,180,270].filter(b=>inZone(z,...xy(b,5))).length;
  assert.equal(drawnSpan===360,counted===6,'the outline and the count disagree');
});

test('selection: Window view wedges across north pick the right planes',()=>{
  const home={latitude:41.98,longitude:-87.9}; // O'Hare
  const ac=[plane('a00350',at(home,350,8)),plane('a00005',at(home,5,8)),plane('a00180',at(home,180,8)),
    plane('a00090',at(home,90,8)),plane('a00270',at(home,270,8)),plane('a00359',at(home,359.6,8)),plane('a00ovh',at(home,135,.4),{hex:'a0000f'})];
  const pick=z=>selection(ac,NOW-1,home,z,NOW).inside.map(a=>a.hex).sort(),S=a=>a.sort();
  assert.deepEqual(pick({kind:'window',from:350,to:10,miles:20}),S(['a0000f','a00005','a00350','a00359']));
  assert.deepEqual(pick({kind:'window',from:0,to:359,miles:20}),S(['a0000f','a00005','a00090','a00180','a00270','a00350']));
  assert.deepEqual(pick({kind:'window',from:180,to:90,miles:20}),S(['a0000f','a00005','a00090','a00180','a00270','a00350','a00359']));
  assert.deepEqual(pick({kind:'window',from:350,to:10,miles:5}),['a0000f'],'beyond the reach only the overhead plane');
  // observations() (route lookups) uses the same zone.
  const obs=observations(ac,NOW-1,home,{kind:'window',from:350,to:10,miles:20},[],NOW).filter(a=>a.inside).map(a=>a.hex).sort();
  assert.deepEqual(obs,S(['a0000f','a00005','a00350','a00359']));
});

// --- Antimeridian ------------------------------------------------------------------------------
test('haversine: across the antimeridian 179.99 vs -179.99 is the short way round',()=>{
  const d=haversine(0,179.99,0,-179.99);
  assert.ok(Math.abs(d-1.382)<.01,`${d} mi`);
  assert.ok(Math.abs(haversine(-16.5,179.995,-16.5,-179.995)-haversine(-16.5,0,-16.5,.01))<1e-6,'same as anywhere else');
  assert.ok(Math.abs(haversine(51,-180,51,180))<1e-9,'-180 and 180 are the same meridian');
});
test('model offset: a plane across the date line is a mile east, not 15,000 miles west',async()=>{
  const {start,offset}=await import('../web/model.mjs');
  globalThis.fetch=async()=>{throw new TypeError('offline');};
  start({latitude:-16.5,longitude:179.99,timeZone:'Pacific/Fiji'},{radiusMiles:3,pollSeconds:5,searchNm:15},()=>{}).stop();
  const o=offset(-16.5,-179.99);
  assert.ok(o.x>1&&o.x<1.5&&Math.abs(o.y)<1e-9,JSON.stringify(o));
  start({latitude:-16.5,longitude:-179.99,timeZone:'Pacific/Fiji'},{radiusMiles:3,pollSeconds:5,searchNm:15},()=>{}).stop();
  assert.ok(offset(-16.5,179.99).x<-1&&offset(-16.5,179.99).x>-1.5);
  delete globalThis.fetch;
});
test('selection: a plane just across the antimeridian is inside the circle',()=>{
  const home={latitude:-16.5,longitude:179.99}; // Taveuni, Fiji
  const s=selection([plane('abc001',{lat:-16.5,lon:-179.99})],NOW-1,home,3,NOW);
  assert.deepEqual(s.inside.map(a=>a.hex),['abc001']);
  assert.ok(Math.abs(s.current.distance_mi-1.33)<.05,String(s.current?.distance_mi));
  // Window view east: the plane is due east.
  const w=observations([plane('abc001',{lat:-16.5,lon:-179.9})],NOW-1,home,{kind:'window',from:45,to:135,miles:20},[],NOW);
  assert.ok(w[0].inside,'due east is inside an east window');
});
test('airspace: distance across the antimeridian is the short way round',()=>{
  assert.ok(distanceMiles({latitude:0,longitude:179.99},{latitude:0,longitude:-179.99})<2);
  const now=NOW*1000,states={[IDS.feed]:{state:String(NOW),attributes:{ac:[plane('abc001',{lat:-16.5,lon:-179.99})]}},
    [IDS.home]:{attributes:{latitude:-16.5,longitude:179.99}},[IDS.radius]:{state:'3'}};
  const {all}=airspace(states,now,true);
  assert.ok(all[0].distance_mi<2&&all[0].inside,String(all[0].distance_mi));
});
test('selection away from the antimeridian: the flat-earth distance matches haversine within 0.5%',()=>{
  for(const home of [{latitude:39.05,longitude:-84.67},{latitude:-33.87,longitude:151.21},{latitude:61.17,longitude:-150},{latitude:21.32,longitude:-157.92},{latitude:84.65,longitude:10}]){
    for(const deg of [0,45,90,135,180,225,270,315]){
      const p=at(home,deg,10),s=selection([plane('abc123',p)],NOW-1,home,50,NOW);
      const h=haversine(home.latitude,home.longitude,p.lat,p.lon);
      assert.ok(Math.abs(s.current.distance_mi-h)/h<.005,`${home.latitude},${deg}: ${s.current.distance_mi} vs ${h}`);
    }
  }
});

// --- Near the poles ---------------------------------------------------------------------------
test('poles: haversine at 89.9° and over the pole',()=>{
  // 89.9N, 0E to 89.9N, 180E: over the pole, 0.2 degrees of latitude.
  assert.ok(Math.abs(haversine(89.9,0,89.9,180)-0.2*69.09)<.1,String(haversine(89.9,0,89.9,180)));
  assert.ok(Math.abs(haversine(-89.9,-90,-89.9,90)-0.2*69.09)<.1);
  assert.ok(Math.abs(haversine(90,0,90,123))<1e-9,'the pole is one point');
  assert.ok(Number.isFinite(haversine(89.9,179.99,89.9,-179.99)));
});
test('poles: positions past 85° are not used (the feed and the map stop there) and never throw',()=>{
  const home={latitude:84.9,longitude:20};
  const ac=[plane('abc001',{lat:84.95,lon:20}),plane('abc002',{lat:89.9,lon:20}),plane('abc003',{lat:-89.9,lon:0}),plane('abc004',{lat:85,lon:20.5})];
  const s=selection(ac,NOW-1,home,10,NOW);
  assert.deepEqual(s.inside.map(a=>a.hex).sort(),['abc001','abc004']);
  assert.ok(Math.abs(s.current.distance_mi-haversine(84.9,20,84.95,20))<.01);
  // A home past 85° is never fed to the selection: coordinates() refuses it.
  assert.equal(coordinates(89.9,0),false);assert.equal(coordinates(85,0),true);
  assert.doesNotThrow(()=>selection(ac,NOW-1,{latitude:89.9,longitude:0},10,NOW));
  assert.doesNotThrow(()=>observations(ac,NOW-1,{latitude:89.9,longitude:0},10,[],NOW));
  assert.deepEqual(observations(ac,NOW-1,{latitude:89.9,longitude:0},10,[],NOW),[],'observations refuse a polar home');
});
test('poles: a saved place past 85° is dropped (asks for a new location) rather than used',async()=>{
  const {loadSettings}=await import('../web/place.mjs');
  for(const [lat,ok] of [[89.9,false],[-89.9,false],[85,true],[-85,true],[84.99,true]]){
    globalThis.localStorage={getItem:()=>JSON.stringify({place:{name:'Pole',latitude:lat,longitude:0,timeZone:'UTC'},confirmed:true}),setItem(){},removeItem(){}};
    assert.equal(!!loadSettings().place,ok,String(lat));
  }
  delete globalThis.localStorage;
});

// --- 0.05° location snapping ---------------------------------------------------------------------
const two=v=>Number(v).toFixed(2);
test('snapping: negative coordinates go to the nearest 0.05° grid point (Hebron KY, Sydney, Anchorage, Honolulu)',()=>{
  const cases=[[{latitude:39.05,longitude:-84.67},['39.05','-84.65']],[{latitude:-33.87,longitude:151.21},['-33.85','151.20']],
    [{latitude:61.17,longitude:-149.98},['61.15','-150.00']],[{latitude:21.32,longitude:-157.92},['21.30','-157.90']],
    [{latitude:-33.874,longitude:-70.786},['-33.85','-70.80']],[{latitude:-0.01,longitude:-0.01},['0.00','0.00']]];
  for(const [home,[lat,lon]] of cases){const c=snapped(home);assert.deepEqual([two(c.latitude),two(c.longitude)],[lat,lon],JSON.stringify(home));}
});
test('snapping: every snapped point is a grid point within half a cell, never "-0.00", and inside the padded query',()=>{
  let seed=12345;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  const homes=[];
  for(let i=0;i<4000;i++)homes.push({latitude:-85+170*rnd(),longitude:-180+360*rnd()});
  for(const v of [-84.675,-84.625,-0.025,-0.075,-179.975,-179.99,179.99,-12.345,-33.875])homes.push({latitude:Math.max(-85,v/2.2),longitude:v});
  for(const home of homes){
    const c=snapped(home),lat=two(c.latitude),lon=two(c.longitude);
    assert.match(lat,/^-?\d+\.\d[05]$/,`${home.latitude} -> ${lat}`);assert.match(lon,/^-?\d+\.\d[05]$/,`${home.longitude} -> ${lon}`);
    assert.ok(lat!=='-0.00'&&lon!=='-0.00','no negative zero in a URL');
    assert.ok(Math.abs(c.latitude-home.latitude)<=GRID_DEG/2+1e-9,`lat ${home.latitude} -> ${c.latitude}`);
    const dLon=Math.abs(((c.longitude-home.longitude+540)%360)-180);
    assert.ok(dLon<=GRID_DEG/2+1e-9,`lon ${home.longitude} -> ${c.longitude}`);
    assert.ok(c.longitude>=-180&&c.longitude<180,'longitude stays in [-180, 180)');
    const nm=haversine(home.latitude,home.longitude,c.latitude,c.longitude)/1.15078;
    assert.ok(nm<=GRID_PAD_NM,`the pad covers the true home (${nm} NM)`);
  }
});
test('snapping: ties and the date line are stable (a home on a cell edge always gets the same point)',()=>{
  assert.equal(snapDeg(-84.675),snapDeg(-84.675));
  assert.equal(two(snapped({latitude:0,longitude:179.99}).longitude),'-180.00');
  assert.equal(two(snapped({latitude:0,longitude:-179.99}).longitude),'-180.00');
  assert.equal(two(snapped({latitude:0,longitude:180}).longitude),'-180.00');
  assert.equal(snapped({latitude:-89,longitude:0}).latitude,-85,'clamped to the feed and map limit');
});
test('feed query: the snapped point only, the distance widened by the pad, capped at 250 NM, null when malformed',()=>{
  assert.equal(feedUrlFor({latitude:39.05,longitude:-84.67},15),'https://opendata.adsb.fi/api/v3/lat/39.05/lon/-84.65/dist/18');
  const u=feedUrlFor({latitude:-33.8712,longitude:151.2093},15);
  assert.equal(u,'https://opendata.adsb.fi/api/v3/lat/-33.85/lon/151.20/dist/18');
  assert.ok(!/-33\.87|151\.21/.test(u),'the true coordinates never appear');
  assert.match(feedUrlFor({latitude:61.2181,longitude:-149.9003},250),/\/lat\/61\.20\/lon\/-149\.90\/dist\/250$/);
  assert.match(feedUrlFor({latitude:21.3069,longitude:-157.8583},MAX_NM),new RegExp(`/dist/${MAX_NM}$`));
  assert.match(feedUrlFor({latitude:0,longitude:-179.99},5),/\/lat\/0\.00\/lon\/-180\.00\/dist\/8$/);
  for(const [home,nm] of [[{latitude:NaN,longitude:0},15],[{latitude:'x',longitude:0},15],[{latitude:10,longitude:undefined},15],[{latitude:10,longitude:10},NaN],[{latitude:10,longitude:10},-5]])
    assert.equal(feedUrlFor(home,nm),null,JSON.stringify([home,nm]));
});
