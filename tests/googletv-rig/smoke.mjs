// node tests/googletv-rig/smoke.mjs: the rig's self-test, and a worked example of using it (about a minute).
import {launch,sleep} from './rig.mjs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const OUT=join(dirname(fileURLToPath(import.meta.url)),'out','smoke');
const say=(...a)=>console.log(...a);
let bad=0;const expect=(ok,what)=>{say((ok?'  ok   ':'  FAIL ')+what);if(!ok)bad++;};

// 1. First run: no consent, no place.
{
  const app=await launch({variant:'personal',consent:false,place:null,out:OUT});
  let s=await app.screen();
  expect(s.top==='consent','first run opens on the consent screen ('+s.top+')');
  expect(app.overlay===false,'consent: Back belongs to the system (overlay false)');
  expect(app.requests().length===0,'nothing fetched before consent ('+app.requests().length+')');
  await app.shot('1-consent');
  // Agree: focus starts on Agree? press OK and see.
  await app.key('Enter');await sleep(2500);
  s=await app.screen();
  say('   after OK:',s.top,'|',s.focused,'|',s.text.slice(0,120));
  expect(app.requests('geojs').length===1,'the IP guess asked once ('+app.requests('geojs').length+')');
  await app.shot('1-after-agree');
  if(s.top==='welcome'){await app.key('ArrowLeft');await app.key('Enter');await sleep(2500);s=await app.screen();say('   after OK on welcome:',s.top,'|',s.focused);}
  expect(!s.top,'first run ends on the dashboard ('+s.top+')');
  await sleep(2000);
  expect(app.requests('feed').length>=1,'the feed asked ('+app.requests('feed').length+')');
  await app.shot('1-dashboard');
  const p=await app.check();expect(p.length===0,'invariants: '+(p.join('; ')||'none broken'));
  await app.close();
}
// 2. A set-up TV: dashboard, Menu, Back, Back (exit), return, crash, Home/return.
{
  const app=await launch({variant:'personal',out:OUT});
  await sleep(2500);
  let s=await app.screen();
  expect(!s.top,'seeded: dashboard ('+s.top+')');
  expect(app.requests('feed').length>=1&&app.requests('tiles').length>0,`feed ${app.requests('feed').length}, tiles ${app.requests('tiles').length}, tilejson ${app.requests('tilejson').length}`);
  await app.shot('2-dashboard');
  await app.menu();await sleep(400);s=await app.screen();
  expect(s.top==='settings'&&app.overlay===true,'Menu opens Settings and the app passes Back to the page ('+s.top+', '+app.overlay+')');
  await app.shot('2-settings');
  await sleep(400);let r=await app.back();await sleep(500);s=await app.screen();
  expect(r==='page'&&!s.top&&app.overlay===false,'Back closes Settings ('+r+', '+s.top+', '+app.overlay+')');
  await sleep(400);r=await app.back();
  expect(r==='exit'&&!app.resumed,'Back on the dashboard leaves the app ('+r+')');
  const before=app.requests().length;await sleep(4000);
  expect(app.requests().length===before,'nothing sent while off screen');
  await app.returnToApp();await sleep(2500);
  expect(app.requests('feed').some(e=>e.t>app.t()-3),'polling resumes on return');
  await app.crash();await sleep(2500);s=await app.screen();
  expect(app.page&&!s.top&&app.losses.length===1,'after the page process ends, the web view comes back on the dashboard');
  const p=await app.check({allowExits:true});expect(p.length===0,'invariants: '+(p.join('; ')||'none broken'));
  say('   log entries:',app.log.length,' bridge gets:',app.requests().filter(e=>e.kind==='get').length,' direct:',app.requests().filter(e=>e.kind==='direct').length);
  app.saveLog('2-log');
  await app.close();
}
// 3. Faults: feed offline, backup answers; then everything offline.
{
  const app=await launch({variant:'store',out:OUT,faults:{feed:'offline'}});
  await sleep(20000);
  expect(app.requests('backup').length>=1,'feed offline: the backup asked ('+app.requests('backup').length+')');
  await app.shot('3-backup');
  app.setFault('all','offline');await sleep(5000);await app.shot('3-all-offline');
  const s=await app.screen();say('   all offline:',s.notes.join(' / '),'|',s.text.slice(0,160));
  const p=await app.check();expect(p.length===0,'invariants: '+(p.join('; ')||'none broken'));
  await app.close();
}
say(bad?`${bad} FAILED`:'smoke: all ok');process.exit(bad?1:0);
