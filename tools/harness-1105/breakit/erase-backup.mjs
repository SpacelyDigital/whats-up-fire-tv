// node erase-backup.mjs: the store build (PORT, mocked services). adsb.fi down, adsb.lol answering
// with a 403 so its 15-minute pause is saved; then Settings > Privacy > Erase all data. After the
// reload: nothing is asked before Agree; the saved pause is gone; after Agree, adsb.fi is asked
// first, then adsb.lol (no pause carried over) once adsb.fi fails again.
import {open,base,setFault,sleep,state} from '../backup-1103/lib.mjs';
state.faults={};setFault('feed','offline');setFault('backup','s403');
const s=await open({url:base('layout=atlas-dark'),dsf:1}); // no ?q: consent is asked, and asked again after Erase
await sleep(4000);await s.key('Enter'); // Agree; the first place comes from the (mocked) IP lookup
await sleep(4000);await s.ev(`document.getElementById('welcome-ok')?.click()`); // "Is this right?" Confirm
await sleep(30000);
const before=state.log.filter(e=>e.svc==='backup').length;
const savedPause=await s.ev(`(()=>{try{const l=JSON.parse(localStorage.getItem('whatsup.ledger.v1')||'{}');return l['cooldown:adsblol-positions']||null;}catch{return 'unreadable';}})()`);
setFault('backup','ok');
// Settings > Privacy > Erase all data > confirm.
await s.key('MediaPlayPause');await sleep(800);
await s.ev(`document.getElementById('set-privacy').click()`);await sleep(800);
await s.ev(`document.getElementById('privacy-erase').click()`);await sleep(800);
await s.ev(`document.getElementById('erase-ok').click()`);
const tErase=(Date.now()-s.T0)/1000;await sleep(15000);
const afterErase=state.log.filter(e=>e.kind!=='msg'&&e.t>tErase+0.5);
const screen=await s.text();const consentShown=await s.ev(`!document.getElementById('consent').hidden`);
const pauseAfter=await s.ev(`localStorage.getItem('whatsup.ledger.v1')`);
// Agree, then the feeds in order.
await s.key('Enter');const tAgree=(Date.now()-s.T0)/1000;await sleep(4000);await s.ev(`document.getElementById('welcome-ok')?.click()`);await sleep(30000);
const feeds=state.log.filter(e=>(e.svc==='feed'||e.svc==='backup')&&e.t>tAgree).map(e=>`${Math.round((e.t-tAgree)*10)/10}s ${e.svc} ${e.status}`);
console.log(JSON.stringify({backupRequestsBeforeErase:before,savedPauseBeforeErase:!!savedPause,requestsAfterEraseBeforeAgree:afterErase.length,
  screenAfterErase:screen.overlays,consentShown,ledgerAfterErase:pauseAfter,feedsAfterAgree:feeds.slice(0,6),errors:s.errors.slice(0,3)},null,1));
s.close();await sleep(1200);process.exit(0);
