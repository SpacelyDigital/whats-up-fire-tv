// node --test tests/  — live.mjs against cases ported from upstream
// tests/test_office_aircraft_routes.py (route selection) plus the standalone parts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialRoute,observations,selection,mergeHistory,provider,Ledger,Enricher} from '../web/live.mjs';

const NOW=Date.parse('2026-09-24T20:00:00Z')/1000;
const AIRLINE={hex:'112233',callsign:'UAL2202',registration:'N123UA',latitude:45.78,longitude:-111.15,observed:NOW,inside:true,live:true};
const CHAIN={callsign:'UAL2202',plausible:true,_airports:[
  {iata:'BZN',lat:45.7775,lon:-111.153},{iata:'ORD',lat:41.9786,lon:-87.9048},{iata:'IAD',lat:38.9445,lon:-77.455803}]};
const AA2939={callsign:'AAL2939',_airports:[{iata:'DFW',lat:32.896801,lon:-97.038002},
  {iata:'FCA',lat:48.310501,lon:-114.255997},{iata:'DFW',lat:32.896801,lon:-97.038002}]};
const PASSING={...AIRLINE,callsign:'AAL2939',latitude:45.68,longitude:-111.04,speed_kt:450};
const ASA420={callsign:'ASA420',_airports:[{iata:'SEA',lat:47.449001,lon:-122.308998},{iata:'MCO',lat:28.429399,lon:-81.308998}]};
const FDX90={callsign:'FDX90',_airports:[{iata:'PVG',lat:31.1434,lon:121.805},{iata:'MEM',lat:35.0424,lon:-89.9767}]};
const DAL1205={callsign:'DAL1205',_airports:[{iata:'PBI',lat:26.6832,lon:-80.0956},{iata:'BOS',lat:42.3643,lon:-71.0052}]};
const SLC={iata:'SLC',lat:40.788399,lon:-111.977997},BZN={iata:'BZN',lat:45.7775,lon:-111.153};
const SKW3676={callsign:'SKW3676',_airports:[SLC,BZN,SLC]};
const NEAR_BZN={...AIRLINE,callsign:'SKW3676',registration:'N288SY',latitude:45.60,longitude:-111.10,heading:340,speed_kt:200,altitude_ft:9000};
const leg=r=>r&&[r.origin,r.destination];

test('airline adjacent leg and local plausibility',()=>{
  assert.deepEqual(leg(commercialRoute(CHAIN,AIRLINE)),['BZN','ORD']);
  assert.equal(commercialRoute(CHAIN,{...AIRLINE,latitude:10,longitude:10}),null);
  assert.equal(commercialRoute(CHAIN,{...AIRLINE,latitude:41.9786,longitude:-87.9048}),null);
  assert.equal(commercialRoute(CHAIN,{...AIRLINE,callsign:'UAL9999'}),null);
  assert.equal(commercialRoute({callsign:'UAL2202',_airports:[{}]},AIRLINE),null);
  const wrong={callsign:'AAL2939',_airports:[{iata:'FLL',lat:26.072599,lon:-80.152702},{iata:'DCA',lat:38.8521,lon:-77.037697}]};
  assert.equal(commercialRoute(wrong,{...PASSING,heading:130}),null);
});

test('same-callsign round trip uses ground track',()=>{
  assert.deepEqual(leg(commercialRoute(AA2939,{...PASSING,heading:130})),['FCA','DFW']);
  assert.deepEqual(leg(commercialRoute(AA2939,{...PASSING,heading:310})),['DFW','FCA']);
  for(const heading of [null,-1,361,NaN,true])assert.equal(commercialRoute(AA2939,{...PASSING,heading}),null);
  assert.equal(commercialRoute(AA2939,{...PASSING,heading:130,speed_kt:80}),null);
  assert.equal(commercialRoute(AA2939,{...PASSING,heading:130,latitude:48.31,longitude:-114.256}),null);
  assert.equal(commercialRoute({...AA2939,_airports:AA2939._airports.slice(0,2)},{...PASSING,heading:130}),null);
  const repeated={...AA2939,_airports:[...AA2939._airports,...AA2939._airports.slice(1)]};
  assert.deepEqual(leg(commercialRoute(repeated,{...PASSING,heading:130})),['FCA','DFW']);
});

test('long legs allow detours but not stale routes',()=>{
  const cruise={...AIRLINE,speed_kt:450,altitude_ft:36000};
  assert.deepEqual(leg(commercialRoute(ASA420,{...cruise,callsign:'ASA420',latitude:45.68,longitude:-111.04,heading:115})),['SEA','MCO']);
  assert.deepEqual(leg(commercialRoute(FDX90,{...cruise,callsign:'FDX90',latitude:46.65,longitude:-112.67,heading:108})),['PVG','MEM']);
  assert.equal(commercialRoute(DAL1205,{...cruise,callsign:'DAL1205',latitude:45.68,longitude:-111.04,heading:80}),null);
});

test('round trip near the shared airport uses climb or descent, then the previous leg',()=>{
  for(const [rate,expected] of [[-900,['SLC','BZN']],[700,['BZN','SLC']],[2500,['BZN','SLC']]])
    assert.deepEqual(leg(commercialRoute(SKW3676,{...NEAR_BZN,vertical_rate:rate})),expected);
  const level={...NEAR_BZN,vertical_rate:0};
  assert.equal(commercialRoute(SKW3676,level),null);
  assert.equal(commercialRoute(SKW3676,{...NEAR_BZN,vertical_rate:null}),null);
  assert.deepEqual(leg(commercialRoute(SKW3676,level,['SLC','BZN'])),['SLC','BZN']);
  assert.equal(commercialRoute(SKW3676,level,['BZN','DEN']),null);
  const inbound={callsign:'SKW3676',_airports:[SLC,BZN]};
  assert.equal(commercialRoute(inbound,{...NEAR_BZN,vertical_rate:2500}),null);
  assert.equal(commercialRoute(inbound,{...NEAR_BZN,vertical_rate:-800}).origin,'SLC');
  assert.equal(commercialRoute(inbound,NEAR_BZN).origin,'SLC');
  assert.equal(commercialRoute(inbound,{...NEAR_BZN,altitude_ft:37000,vertical_rate:0}),null);
  assert.equal(commercialRoute(inbound,{...NEAR_BZN,altitude_ft:12000}).destination,'BZN');
});

test('observations: vertical rate, freshness boundary and recent history',()=>{
  const home={latitude:45.78,longitude:-111.15};
  const base={hex:'112233',flight:'UAL2202',lat:45.78,lon:-111.15,seen_pos:1,alt_baro:10000};
  for(const [extra,expected] of [[{baro_rate:-640},-640],[{geom_rate:320},320],[{baro_rate:null,geom_rate:-64},-64],[{},null],[{baro_rate:'fast'},null]])
    assert.equal(observations([{...base,...extra}],NOW,home,5,[],NOW)[0].vertical_rate,expected);
  const raw=[{hex:'112233',flight:'UAL2202 ',r:'N123UA',lat:45.78,lon:-111.15,seen_pos:1,alt_baro:10000,track:130,gs:450}];
  const history=[{hex:'aabbcc',callsign:'N207BC',registration:'N207BC',last_seen:NOW-3420}];
  const rows=observations(raw,NOW,home,5,history,NOW);
  assert.equal(rows.length,2);assert.ok(rows[0].inside);
  assert.deepEqual([rows[0].heading,rows[0].speed_kt,rows[0].callsign],[130,450,'UAL2202']);
  assert.deepEqual(observations(raw,NOW-30,home,5,history,NOW),[]);
  assert.equal(observations([{...raw[0],alt_baro:'ground'}],NOW,home,5,[],NOW).length,0);
  assert.equal(provider({callsign:'UAL2202'}),'adsblol');
  assert.equal(provider({callsign:'N207BC',registration:'N207BC'}),'flightaware');
});

test('selection keeps fresh in-boundary aircraft; history keeps the last 20 distinct',()=>{
  const home={latitude:39.05,longitude:-84.66},now=1800000000;
  const ac=[{hex:'abc123',flight:'UAL1  ',r:'N1',t:'B738',lat:39.06,lon:-84.65,alt_baro:3000,seen_pos:1,gs:200,track:90},
    {hex:'abc124',lat:39.35,lon:-84.65,alt_baro:3000,seen_pos:1},{hex:'abc125',lat:39.05,lon:-84.66,alt_baro:'ground',seen_pos:1}];
  const s=selection(ac,now-1,home,3,now);
  assert.deepEqual(s.inside.map(a=>a.hex),['abc123']);
  assert.equal(s.current.callsign,'UAL1');assert.ok(s.feed_fresh);
  assert.equal(selection(ac,now-16,home,3,now).inside.length,0);
  let h=[];
  for(let i=0;i<25;i++)h=mergeHistory(h,[{...s.inside[0],hex:'a'+String(i).padStart(5,'0'),position_timestamp:now+i}]);
  h=mergeHistory(h,[{...s.inside[0],hex:'a00024',position_timestamp:now+30}]);
  assert.equal(h.length,20);assert.equal(h[0].hex,'a00024');assert.equal(new Set(h.map(a=>a.hex)).size,20);
});

test('enricher: one request per 5 s, hits and 404s cached 24 h, routes kept 6 h',async t=>{
  const ledger=new Ledger(),calls=[];
  const payload={callsign:'UAL2202',number:'2202',_airports:[{iata:'BZN',lat:45.7775,lon:-111.153,name:'x'},{iata:'ORD',lat:41.9786,lon:-87.9048}]};
  const enricher=new Enricher(ledger,async url=>{calls.push(url);return url.includes('UAL2202')?{status:200,payload}:{status:404,payload:null};});
  // The 5 s pace runs on performance.now(): here it follows the ticks' clock.
  const real=performance.now,tick=(ac,now)=>{performance.now=()=>now*1000;return enricher.tick(ac,now);};
  t.after(()=>{performance.now=real;});
  const a={...AIRLINE,observed:1000},b={...a,hex:'445566',callsign:'DAL9'};
  const routes=await tick([a,b],1000);
  assert.deepEqual(calls,['https://vrs-standing-data.adsb.lol/routes/UA/UAL2202.json']);
  assert.equal(routes.length,2);assert.ok(routes.some(r=>r.historical));
  await tick([a,b],1003);assert.equal(calls.length,1);
  await tick([a,b],1006);assert.equal(calls.length,2);assert.match(calls[1],/routes\/DA\/DAL9\.json$/);
  await tick([b],1006+86399);assert.equal(calls.length,2); // the 404, a day later
  await tick([b],1006+86401);assert.equal(calls.length,3);
  await tick([a],1000+86399);assert.equal(calls.length,3);
  await tick([a],1000+86413);assert.equal(calls.length,4);
  const restored=new Ledger(JSON.parse(JSON.stringify(ledger)));
  assert.equal(restored.get('lol:UAL2202',1000+86413).name,undefined);
  assert.ok(restored.routes(1000+86413+6*3600-1).length>=1);
  assert.equal(restored.routes(1000+86413+6*3600+1).length,0);
});
test('selection: in Window view only planes inside the wedge (or overhead) count as inside',()=>{
  const now=1700000000,home={latitude:39.05,longitude:-84.65};
  const at=(deg,mi)=>({hex:'abc'+String(deg).padStart(3,'0'),lat:home.latitude+mi*Math.cos(deg*Math.PI/180)/69,
    lon:home.longitude+mi*Math.sin(deg*Math.PI/180)/(69.172*Math.cos(home.latitude*Math.PI/180)),alt_baro:20000,seen_pos:1,flight:'T'});
  const ac=[at(120,20),at(270,5),at(200,.5)];
  const z={kind:'window',from:74,to:175,miles:25};
  assert.deepEqual(selection(ac,now-1,home,z,now).inside.map(a=>a.hex).sort(),['abc120','abc200']);
  assert.deepEqual(selection(ac,now-1,home,3,now).inside.map(a=>a.hex),['abc200']);
});
test('route: far from both airports, a leg pointing well away from the track is rejected',()=>{
  const lol={callsign:'CSB107',_airports:[{iata:'HRL',lat:26.2285,lon:-97.6544},{iata:'CVG',lat:39.0488,lon:-84.6678}]};
  // Over Arkansas on a DFW -> CVG line, ~400 mi from CVG, heading ~55 deg: HRL -> CVG points ~40 deg.
  const onLine={callsign:'CSB107',latitude:35.0,longitude:-91.3,heading:55,speed_kt:450,vertical_rate:0,altitude_ft:35000,observed:1700000000};
  assert.ok(commercialRoute(lol,onLine),'a modest difference still passes');
  assert.equal(commercialRoute(lol,{...onLine,heading:110}),null,'55 deg off the leg, 400 mi out: rejected');
});
test('route: a multi-leg flight counts only the leg it is flying (MUC-LHR-DFW over Cincinnati = LHR->DFW)',()=>{
  const lol={callsign:'BAW1',_airports:[{iata:'MUC',lat:48.354,lon:11.786},{iata:'LHR',lat:51.47,lon:-0.454},{iata:'DFW',lat:32.897,lon:-97.038}]};
  const a={callsign:'BAW1',latitude:39.05,longitude:-84.65,heading:245,speed_kt:480,vertical_rate:0,altitude_ft:36000,observed:1700000000};
  const r=commercialRoute(lol,a);
  assert.equal(r.origin,'LHR');assert.equal(r.destination,'DFW');assert.equal(r.from.lat,51.47);
});
