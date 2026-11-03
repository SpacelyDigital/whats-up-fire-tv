// node --test tests/  — Left/Right plane browsing (web/browse.mjs): the order, wrapping round,
// following a plane by its hex as planes move, every way back to automatic, and the one-second
// hold before a plane's photo or route is looked up (photos.mjs gate, live.mjs route order).
import test from 'node:test';
import assert from 'node:assert/strict';
import {browseOrder,step,apply,held,LookupGate,IDLE_MS,HOLD_MS} from '../web/browse.mjs';
import {photoFor,setPhotoGate} from '../web/photos.mjs';
import {Ledger,Enricher,setRouteFocus} from '../web/live.mjs';

const P=(hex,ground,more={})=>({hex,ground,flight:hex.toUpperCase(),...more});
const sky=(planes,hero=planes[0])=>({planes,hero,now:0});
const S=(hex,since=0,last=since)=>({hex,since,last});

test('order: closest first, only the planes the map draws (within the map radius)',()=>{
  const ps=[P('cc0003',3),P('aa0001',1),P('ee0005',12),P('bb0002',2),P('dd0004',9.9)];
  assert.deepEqual(browseOrder(ps,10).map(a=>a.hex),['aa0001','bb0002','cc0003','dd0004']);
  assert.deepEqual(browseOrder(ps,2).map(a=>a.hex),['aa0001','bb0002']);
  assert.deepEqual(browseOrder([P('bb0002',1),P('aa0001',1)],10).map(a=>a.hex),['aa0001','bb0002'],'equal distances: by hex');
  assert.deepEqual(browseOrder([],10),[]);
});

test('the first press starts from the hero; Right goes out, Left comes in, both wrap round',()=>{
  const ps=[P('aa0001',1),P('bb0002',2),P('cc0003',3),P('dd0004',4)],m=sky(ps,ps[1]);
  assert.equal(step(null,m,10,1,5).hex,'cc0003','Right from the hero (2nd): the 3rd');
  assert.equal(step(null,m,10,-1,5).hex,'aa0001','Left from the hero: the 1st');
  assert.equal(step(S('dd0004'),m,10,1,5).hex,'aa0001','Right from the last: the first');
  assert.equal(step(S('aa0001'),m,10,-1,5).hex,'dd0004','Left from the first: the last');
  // Right four times from the hero visits every plane once and comes back to it.
  let s=null;const seen=[];
  for(let i=0;i<4;i++){s=step(s,m,10,1,i);seen.push(s.hex);}
  assert.deepEqual(seen,['cc0003','dd0004','aa0001','bb0002']);
  // Holding the key: each repeat is a press; the hold clock restarts only on a new plane.
  const a=step(null,m,10,1,100);assert.deepEqual(a,{hex:'cc0003',since:100,last:100});
  const one=sky([P('aa0001',1)]);
  const b=step(S('aa0001',100),one,10,1,300);assert.deepEqual(b,{hex:'aa0001',since:100,last:300},'one plane: it stays chosen');
});

test('no hero: Right starts at the closest, Left at the farthest; nothing on the map: no browsing',()=>{
  const ps=[P('aa0001',1),P('bb0002',2),P('cc0003',3)],m=sky(ps,null);
  assert.equal(step(null,m,10,1,0).hex,'aa0001');
  assert.equal(step(null,m,10,-1,0).hex,'cc0003');
  assert.equal(step(null,sky([P('aa0001',40)],null),10,1,0),null,'beyond the map radius only');
  assert.equal(step(null,sky([],null),10,1,0),null);
  assert.equal(step(null,null,10,1,0),null);
});

test('the choice follows the hex as planes move; its number in the list is worked out again',()=>{
  const m1=sky([P('aa0001',1),P('bb0002',2),P('cc0003',3)]);
  let r=apply(S('cc0003'),m1,10,1000);
  assert.deepEqual(r.m.hero.browse,{index:3,count:3});assert.equal(r.m.hero.status,'Plane 3 of 3');
  assert.equal(r.m.hero.hex,'cc0003');
  assert.ok(r.m.planes.includes(r.m.hero),'the card plane is the one in planes (a layout marks it with a===hero)');
  assert.equal(m1.planes[2].status,undefined,'the model itself is not changed');assert.equal(m1.hero.hex,'aa0001');
  // It flies in to 0.5 mi while a new plane appears: now 1 of 4.
  const m2=sky([P('dd0004',0.8),P('aa0001',1),P('bb0002',2),P('cc0003',0.5)]);
  r=apply(S('cc0003'),m2,10,2000);
  assert.deepEqual(r.m.hero.browse,{index:1,count:4});assert.equal(r.m.hero.status,'Plane 1 of 4');
  // The next press steps from where it is now.
  assert.equal(step(S('cc0003'),m2,10,1,2500).hex,'dd0004');
});

test('back to automatic: it leaves the map, a minute without Left or Right, an emergency, or Back',()=>{
  const m=sky([P('aa0001',1),P('bb0002',2),P('cc0003',3)]);
  const s=S('cc0003',0,1000);
  assert.equal(apply(s,m,10,1000+IDLE_MS-1).state,s,'59.999 s after the last press: still browsing');
  assert.equal(apply(s,m,10,1000+IDLE_MS).state,null,'60 s: automatic');
  assert.equal(apply(s,m,2.5,1500).state,null,'outside a smaller map radius');
  assert.equal(apply(s,sky([P('aa0001',1),P('cc0003',10.2)]),10,1500).state,null,'flew past the map edge');
  assert.equal(apply(s,sky([P('aa0001',1)]),10,1500).state,null,'gone from the feed');
  const sos=sky([P('aa0001',1),P('cc0003',3)],P('ee0005',5,{emergency:'EMERGENCY'}));
  const r=apply(s,sos,10,1500);assert.equal(r.state,null);assert.equal(r.m,sos,'the emergency keeps the card');
  assert.equal(step(null,sos,10,1,1500),null,'Left/Right do nothing while an emergency has the card');
  // Back: app.mjs drops the state; with none, the model is drawn as it is.
  assert.equal(apply(null,m,10,1500).m,m);
});

test('a plane is held after a second on the card: held() and the photo gate',async()=>{
  assert.equal(HOLD_MS,1000);
  assert.equal(held(S('aa0001',5000),5999),false);assert.equal(held(S('aa0001',5000),6000),true);assert.equal(held(null,9e9),false);
  const g=new LookupGate();
  // Automatic (no browsing): at once.
  g.update('aa0001',null,0);assert.equal(await g.wait('aa0001'),true);
  // Browsing: only once held; passed over: never.
  const now=Date.now();
  g.update('bb0002',S('bb0002',now),now);
  const kept=g.wait('bb0002');let done=false;kept.then(()=>{done=true;});
  await new Promise(r=>setTimeout(r,300));assert.equal(done,false,'not before a second');
  assert.equal(await kept,true,'after a second on the card');
  const t=Date.now();g.update('cc0003',S('cc0003',t),t);
  const passed=g.wait('cc0003');g.update('dd0004',S('dd0004',t+200),t+200);
  assert.equal(await passed,false,'passed over within the second');
  const back=g.wait('dd0004');g.update('dd0004',null,t+300);
  assert.equal(await back,true,'Back to automatic with that plane on the card: at once');
  g.update('',null,0);
});

test('photos: nothing is sent for a plane passed over; a held plane is looked up once',async()=>{
  const real=globalThis.fetch,calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return new Response('',{status:404});};
  try{
    setPhotoGate(()=>Promise.resolve(false));
    assert.equal(await photoFor({hex:'a1b2c3',registration:'N1'}),null);
    assert.equal(calls.length,0,'passed over: no request');
    setPhotoGate(()=>Promise.resolve(true));
    assert.equal(await photoFor({hex:'a1b2c3',registration:'N1'}),null);
    assert.deepEqual(calls,['https://api.planespotters.net/pub/photos/hex/a1b2c3'],'held: one lookup, not spoiled by the pass');
    await photoFor({hex:'a1b2c3'});assert.equal(calls.length,1,'cached for a day');
  }finally{globalThis.fetch=real;setPhotoGate(()=>Promise.resolve(true));}
});

test('routes: the held plane is asked for next; otherwise inside the zone, then nearest',async()=>{
  const base={registration:'',latitude:45.78,longitude:-111.15,observed:1000,live:true};
  const a={...base,hex:'112233',callsign:'UAL2202',inside:true,miles:1},b={...base,hex:'445566',callsign:'DAL9',inside:false,miles:30};
  const run=async focus=>{const calls=[];setRouteFocus(()=>focus);
    await new Enricher(new Ledger(),async url=>{calls.push(url);return {status:404,payload:null};}).tick([a,b],1000);return calls;};
  try{
    assert.deepEqual(await run(''),['https://vrs-standing-data.adsb.lol/routes/UA/UAL2202.json']);
    assert.deepEqual(await run('445566'),['https://vrs-standing-data.adsb.lol/routes/DA/DAL9.json']);
  }finally{setRouteFocus(()=>'');}
});
