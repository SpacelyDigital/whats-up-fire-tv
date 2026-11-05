// ~10 minutes of typical use from a fresh install; every outgoing request is logged.
import {open,base,state,sleep} from './lib.mjs';
import {writeFileSync} from 'node:fs';
const s=await open({url:base()});const step=[];const mark=l=>{step.push([Math.round((Date.now()-s.T0)/1000),l]);console.error(l);};
const ev=x=>s.ev(x),click=id=>ev(`document.getElementById('${id}')?.click()`),sel=q=>ev(`document.querySelector(${JSON.stringify(q)})?.click()`);
const type=async str=>{for(const c of str){await s.key(c,c===' '?32:c.charCodeAt(0));await sleep(140);}};
const search=async q=>{await type(q);await sleep(300);await sel('[data-key="search"]');await sleep(2500);await sel('#results button');await sleep(800);await click('confirm-ok');await sleep(1500);};
const settings=async()=>{for(let i=0;i<3&&!(await ev(`!document.getElementById('settings').hidden`));i++){await s.key('MediaPlayPause');await sleep(500);}};
const home=async()=>{for(let i=0;i<5;i++){if(await ev(`[...document.querySelectorAll('.overlay')].every(o=>o.hidden)`))return;await s.key('Escape');await sleep(400);}};
await sleep(6000);const preConsent=state.log.filter(e=>e.kind!=='msg').length;mark('consent shown; requests before agreeing: '+preConsent);
await s.key('Enter');await sleep(3000);mark('agreed; welcome');
await click('welcome-change');await sleep(800);await search('CHICAGO');mark('chose Chicago');await sleep(15000);
await s.shot('08-chicago');
await settings();await click('set-layout');await sleep(800);
for(let i=1;i<12;i++){await s.key('ArrowRight');await sleep(16000);mark('layout '+await ev(`document.getElementById('pick-name').textContent`));}
await s.key('Enter');await sleep(1000);await home();
for(let i=0;i<3;i++){await s.key('ArrowUp');await sleep(400);}await sleep(15000);mark('map 2 mi');
for(let i=0;i<8;i++){await s.key('ArrowDown');await sleep(400);}await sleep(25000);mark('map 250 mi');
for(let i=0;i<6;i++){await s.key('ArrowUp');await sleep(400);}await sleep(15000);mark('map back');
await settings();await click('set-about');await sleep(2000);await s.key('Escape');await sleep(500);
await click('set-privacy');await sleep(2000);await s.key('Escape');await sleep(500);mark('about + privacy');
// units and place names
await click('set-distance');await s.key('ArrowRight');await s.key('Enter');await click('set-places');await s.key('ArrowRight');await s.key('Enter');await sleep(1500);mark('units, place names');
await click('set-location');await sleep(800);await search('10 DOWNING ST LONDON');mark('chose a London address');await sleep(8000);
await settings();await click('set-layout');await sleep(800);
while(!/Satellite/.test(await ev(`document.getElementById('pick-name').textContent`))){await s.key('ArrowRight');await sleep(1500);}
await s.key('Enter');await sleep(25000);mark('atlas satellite in London');await s.shot('08-london-sat');
await settings();await click('set-location');await sleep(800);await search('3087 TERMINAL DR HEBRON KY');mark('chose a US address');await sleep(25000);await s.shot('08-hebron-sat');
await settings();await click('set-adjust');await sleep(1500);for(const k of ['ArrowRight','ArrowRight','ArrowUp'])await s.key(k);await sleep(500);await s.key('Enter');await sleep(15000);mark('adjusted position');
await settings();await click('set-zone');await s.key('ArrowRight');await s.key('Enter');await sleep(10000);mark('window view zone');
await settings();await click('set-location');await sleep(500);await type('ROSEMONT IL');await sleep(2500);await sel('#results button');await sleep(800);await click('confirm-ok');await sleep(20000);mark('Rosemont by typing (search as you type)');
await home();await sleep(30000);mark('idle');
// Erase all data: nothing may be requested again until Agree.
await settings();await click('set-privacy');await sleep(800);await click('privacy-erase');await sleep(800);await click('erase-ok');await sleep(1000);
const nErase=state.log.length;const tErase=(Date.now()-s.T0)/1000;await sleep(20000);
const afterErase=state.log.slice(nErase).filter(e=>e.kind!=='msg'&&e.t>tErase+0.5);
mark('erased; requests in 20 s after the reload: '+afterErase.length+' '+afterErase.map(e=>e.svc).join(','));await s.shot('08-after-erase');
mark('screen after erase: '+(await s.text()).overlays.join(','));
writeFileSync('typical-log.json',JSON.stringify({steps:step,log:state.log,errors:s.errors},null,0));
console.log('done',Math.round((Date.now()-s.T0)/1000),'s',state.log.length,'entries; errors',s.errors.slice(0,5));
s.close();process.exit(0);
