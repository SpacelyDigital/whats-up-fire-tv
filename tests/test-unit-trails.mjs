// node --test tests/  — contrails (kit.mjs TrailBook, layouts/night-sky.mjs): the tracks kept and drawn are every
// plane present plus the 60 most recently departed, the rest forgotten (a hub sky turning over leaves hundreds of
// departed tracks in the 8 minutes a trail fades; before, every one was remembered and drawn, each with a fresh
// gradient and two fresh paths per render, so the render grew 4x in 3 minutes); a drawn track keeps its gradient
// (the tone's stops shared) and its two paths from one render to the next, the fade in the stroke's opacity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {TrailBook,useSettings} from '../web/kit.mjs';

const T0=1700000000000,plane=(i,dx=0)=>({hex:`a${String(i).padStart(5,'0')}`,flight:`TST${i}`,x:(i%10)-5+dx,y:Math.floor(i/10)-5,altitude_ft:10000,ground:1,bearing:0,inside:false,cargo:i===95||i===55});
// 100 planes at t0; every 5 s ten more leave (0-9 first), so at t0+40 s 20 are present and 80 departed in 8 waves.
const wave=k=>Array.from({length:100-10*k},(_,j)=>plane(j+10*k,.1*k));

test('TrailBook.prune: keeps every plane present plus the 60 most recently departed (by last fix) and forgets the rest; returns them in the order first seen; keep 0 is the present planes alone',()=>{
  const book=new TrailBook(8*60000,4000);
  for(let k=0;k<=8;k++)book.update(wave(k),T0+5000*k);
  assert.equal(book.map.size,100,'all 100 remembered');
  assert.equal(book.prune(wave(0),60).length,100,'all present: all kept');
  const kept=book.prune(wave(8),60);
  assert.deepEqual(kept.map(([hex])=>hex),Array.from({length:80},(_,i)=>plane(i+20).hex),'planes 20-99: the 20 present and the 60 departed since t0+10 s');
  assert.ok(kept.every(([hex,pts])=>book.map.get(hex)===pts),'the book\'s own point lists');
  assert.equal(book.map.size,80,'planes 0-19 forgotten');
  assert.deepEqual(book.prune([],60).map(([hex])=>hex),Array.from({length:60},(_,i)=>plane(i+40).hex),'nothing present: the 60 newest departed (the 20 just present among them)');
  assert.deepEqual(book.prune(wave(8),0).map(([hex])=>hex),wave(8).map(a=>a.hex),'keep 0: the present only');
  assert.equal(book.map.size,20);
});

// A page just big enough for the layout: nodes with attributes, children and classes, a canvas whose context takes any call.
class N{
  constructor(tag){this.tag=tag;this.attrs={};this.kids=[];this.parent=null;this.style={};this.text='';this.q=new Map();}
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  get className(){return this.attrs.class||'';} set className(v){this.attrs.class=String(v);}
  get classList(){const c=new Set(this.className.split(/\s+/).filter(Boolean)),w=()=>{this.attrs.class=[...c].join(' ');};
    return {contains:k=>c.has(k),add:k=>{c.add(k);w();},remove:k=>{c.delete(k);w();},toggle:(k,on)=>{((on===undefined?!c.has(k):on)?c.add(k):c.delete(k));w();}};}
  append(...n){for(const k of n){k.remove();k.parent=this;this.kids.push(k);}}
  prepend(...n){for(const k of [...n].reverse()){k.remove();k.parent=this;this.kids.unshift(k);}}
  before(...n){const p=this.parent,i=p.kids.indexOf(this);for(const k of n){k.remove();k.parent=p;}p.kids.splice(i,0,...n);}
  remove(){const p=this.parent;if(p){const i=p.kids.indexOf(this);if(i>=0)p.kids.splice(i,1);this.parent=null;}}
  replaceChildren(...n){for(const k of this.kids)k.parent=null;this.kids=[];this.append(...n);}
  get lastChild(){return this.kids[this.kids.length-1];}
  get isConnected(){return true;} get scrollWidth(){return 0;} get clientWidth(){return 0;} getClientRects(){return [];}
  get textContent(){return this.text;} set textContent(v){this.text=String(v);}
  set innerHTML(h){this.kids=[];}
  querySelector(sel){if(!this.q.has(sel)){const n=new N('div');n.parent=this;if(sel==='.quiet-note')n.append(new N('div'),new N('div'));this.q.set(sel,n);}return this.q.get(sel);}
  querySelectorAll(){return [];}
  getContext(){return new Proxy({},{get:(t,k)=>k in t?t[k]:typeof k==='symbol'?undefined:()=>{}, set:(t,k,v)=>{t[k]=v;return true;}});}
}
const find=(n,f,out=[])=>{if(f(n))out.push(n);for(const k of n.kids)find(k,f,out);return out;};

test('Night Sky: 100 tracks remembered, 80 drawn (20 present, the 60 newest departed); a track keeps its gradient and two paths across renders (the tone\'s stops shared through href, the fade in stroke-opacity), a dropped track\'s nodes go, a plane back after being dropped starts a new trail',async()=>{
  Object.assign(globalThis,{innerWidth:960,innerHeight:540,devicePixelRatio:1,document:{createElement:t=>new N(t),createElementNS:(ns,t)=>new N(t)}});
  useSettings({mapMiles:10,distance:'mi',altitude:'ft',radiusMiles:3,place:{name:'Chicago',latitude:41.85,longitude:-87.65}});
  const ns=(await import('../web/layouts/night-sky.mjs')).default,root=new N('div');
  ns.mount(root,{demo:false,settings:()=>({}),place:()=>({latitude:41.85,longitude:-87.65}),layout:()=>'night-sky'});
  const model=(planes,now)=>({now,hero:null,planes,log:{today:0},fresh:true,recent:[]});
  const svg=find(root,n=>n.tag==='svg')[0],defs=svg.kids.find(n=>n.tag==='defs'),trails=svg.kids.find(n=>n.attrs.class==='trails');
  const shared=defs.kids.filter(n=>n.tag==='linearGradient'),tracks=defs.kids.find(n=>n.tag==='g');
  assert.equal(shared.length,4,'one gradient definition per tone');
  const cool=shared.find(n=>n.attrs.id==='ns-trail-cool');
  assert.deepEqual(cool.kids.map(k=>[k.attrs.offset,k.attrs['stop-opacity']]),[['0','0'],['1','0.6']],'tail clear, head at .6');
  ns.render(model(wave(0),T0));
  const grads0=[...tracks.kids],paths0=[...trails.kids];
  assert.equal(grads0.length,100);assert.equal(paths0.length,200);
  assert.equal(grads0[95].attrs.href,'#ns-trail-warm','a cargo plane\'s trail takes the warm tone');assert.equal(grads0[55].attrs.href,'#ns-trail-warm');
  for(let k=1;k<=8;k++)ns.render(model(wave(k),T0+5000*k));
  assert.deepEqual(tracks.kids,grads0.slice(20),'the same 80 gradient nodes, planes 20-99, in the order first seen');
  assert.deepEqual(trails.kids,paths0.slice(40),'the same 160 path nodes');
  assert.equal(find(root,n=>n.tag==='linearGradient').length,84,'4 shared and 80 per track');
  assert.equal(find(root,n=>n.tag==='linearGradient').flatMap(n=>n.kids).length,8,'stops only on the shared ones');
  const g20=tracks.kids[0],g99=tracks.kids[79];
  assert.equal(g20.attrs.href,'#ns-trail-cool');assert.equal(g20.attrs.gradientUnits,'userSpaceOnUse');
  assert.equal(tracks.kids[35].attrs.href,'#ns-trail-cool','the cargo plane 55, departed: the plain tone, as before');assert.equal(tracks.kids[75].attrs.href,'#ns-trail-warm','95, present: still warm');
  assert.equal(trails.kids[0].attrs.stroke,`url(#${g20.attrs.id})`);assert.equal(trails.kids[1].attrs.stroke,`url(#${g20.attrs.id})`);
  assert.equal(trails.kids[0].attrs['stroke-opacity'],'0.94','departed 30 s of 8 min ago: faded to .94');
  assert.equal(trails.kids[158].attrs['stroke-opacity'],'1.00','present: full');
  assert.equal(trails.kids[158].attrs.d,trails.kids[159].attrs.d,'glow and core share the line');
  assert.equal((trails.kids[158].attrs.d.match(/L/g)||[]).length,9,'9 fixes and the live position');
  assert.equal(g99.attrs.x2,String((((99%10)-5+.8)*24+480).toFixed(1)),'the head at the live position');
  ns.render(model([...wave(8),plane(0,.9)],T0+45000));
  assert.equal(tracks.kids.length,81);assert.equal(trails.kids.length,162);
  assert.ok(!grads0.includes(tracks.kids[80]),'plane 0, dropped and back: a new gradient');
  assert.equal(tracks.kids[80].attrs.href,'#ns-trail-cool');
  ns.unmount();
});
