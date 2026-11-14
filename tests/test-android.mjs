// node --test tests/  — the Google TV app (android/) checked against the Fire TV app and the page:
// the same allow-list and messages, the picture hosts the page's Content-Security-Policy names, the
// page as built for Android, its privacy policy edition and its credits. The Kotlin side has its
// own tests (android/: ./gradlew test).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,mkdtempSync,existsSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {googleTvPolicy,LEFTOVERS,POLICY_URL,PUBLISHED,VERSION,versionLine} from '../scripts/build-privacy-googletv.mjs';
import {PRIVACY_URLS,profileFor} from '../web/profile.mjs';

const repo=new URL('..',import.meta.url).pathname;
const read=p=>readFileSync(join(repo,p),'utf8');
const kotlin=f=>read(`android/app/src/main/java/com/spacelydigital/whatsup/${f}`);
const ENV=['WHATSUP_PROFILE','WHATSUP_RELEASE','WHATSUP_OUT','WHATSUP_LICENSES','WHATSUP_PLATFORM','WHATSUP_HIDE'];
const env=o=>{const e={...process.env,...o};for(const k of ENV)if(!(k in o))delete e[k];return e;};
// scripts/build-web.mjs into a fresh folder; returns the folder.
const build=(o={})=>{const out=mkdtempSync(join(tmpdir(),'page-'));execFileSync(process.execPath,[join(repo,'scripts/build-web.mjs')],{env:env({WHATSUP_OUT:out,...o}),stdio:'ignore'});return out;};

test('allow-list: the Google TV app fetches exactly what the Fire TV app fetches, the same patterns in the same order',()=>{
  const fire=[.../const ALLOWED = \[([\s\S]*?)\n\];/.exec(read('src/App.tsx'))[1].matchAll(/^\s*\/(\^.*\$)\/,$/gm)].map(m=>new RegExp(m[1]));
  const google=[.../val PATTERNS = listOf\(([\s\S]*?)\n {4}\)/.exec(kotlin('Net.kt'))[1].matchAll(/^\s*"""(.*)""",$/gm)].map(m=>new RegExp(m[1]));
  assert.equal(fire.length,11);
  assert.deepEqual(google.map(r=>r.source),fire.map(r=>r.source));
  // The patterns use only what reads the same in JavaScript and Java: no lookarounds, flags, \p, or a bare $ mid-pattern.
  for(const r of google)assert.doesNotMatch(r.source.slice(0,-1),/\(\?|\\p|\\[bBsS]|\$/,r.source);
});

test('bridge: the Google TV app answers every message the page sends, with the calls the page listens for',()=>{
  const page=read('web/app.mjs')+read('web/live.mjs'),bridge=kotlin('Bridge.kt'),js=kotlin('Bridge.kt').split('object Js')[1];
  const sent=new Set([...page.matchAll(/type:'(\w+)'/g)].map(m=>m[1]));
  assert.deepEqual([...sent].sort(),['awake','chime','get','ui']);
  for(const t of sent)assert.match(bridge,new RegExp(`"${t}" ->`),t);
  for(const f of ['__whatsupReply','__whatsupBack','__whatsupActive']){
    assert.match(page,new RegExp(`window\\.${f}=`),`the page sets ${f}`);
    assert.ok(js.includes(`window.${f}&&window.${f}(`),`the app calls ${f}`);
  }
  // The same answers as the Fire TV app.
  for(const w of ['blocked','oversize','connection_error']){assert.ok(read('src/App.tsx').includes(`'${w}'`),w);assert.ok(kotlin('Net.kt').includes(`"${w}"`),w);}
  assert.match(kotlin('Net.kt'),/MAX_BYTES = 2 \* 1024 \* 1024/);
  assert.match(read('src/App.tsx'),/MAX_BYTES = 2 \* 1024 \* 1024/);
  // The page finds the app's channel under the name the app gives it.
  assert.match(kotlin('MainActivity.kt'),/addWebMessageListener\(view, "WhatsUpHost"/);
  assert.match(read('web/live.mjs'),/window\.ReactNativeWebView\|\|window\.WhatsUpHost/);
});

test('pictures: the web view loads by itself only the hosts the page\'s img-src names; everything else goes through the allow-list',()=>{
  const csp=/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read('web/index.html'))[1];
  const img=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('img-src ')).split(/\s+/).slice(1).filter(s=>s.startsWith('https://')).map(s=>s.slice(8));
  const hosts=JSON.parse(`[${/val PICTURE_HOSTS = listOf\(([^)]*)\)/.exec(kotlin('PageFiles.kt'))[1]}]`);
  assert.deepEqual(hosts,img);
});

test('page for Google TV: the same page and code, its own policy edition, without the files only Fire TV uses',()=>{
  const vega=build({WHATSUP_PROFILE:'store',WHATSUP_RELEASE:'1'}),google=build({WHATSUP_PROFILE:'store',WHATSUP_RELEASE:'1',WHATSUP_PLATFORM:'android'});
  const js=d=>readFileSync(join(d,'whatsup.js'),'utf8'),file=(d,f)=>readFileSync(join(d,f),'utf8');
  assert.match(js(google),/^window\.__whatsupPlatform="android";$/m);
  assert.doesNotMatch(js(vega),/^window\.__whatsupPlatform=/m);
  const code=s=>s.split('\n').filter(l=>!/^window\.__whatsup(Platform|Docs)=/.test(l)).join('\n');
  assert.equal(code(js(google)),code(js(vega)),'one page');
  assert.equal(file(google,'index.html'),file(vega,'index.html'));
  assert.equal(file(google,'privacy.txt'),read('web/privacy-store-googletv.txt'));
  assert.equal(file(vega,'privacy.txt'),read('web/privacy-store.txt'));
  assert.ok(existsSync(join(vega,'media/keep-awake.mp4'))&&!existsSync(join(google,'media/keep-awake.mp4')),'the silent loop is Fire TV\'s');
  assert.ok(existsSync(join(vega,'image/whatsup_icon.png'))&&!existsSync(join(google,'image')),'the Vega manifest\'s icon is Fire TV\'s');
  assert.ok(existsSync(join(google,'media/chime.mp3')),'the chime (android/ Chime.kt plays www/media/chime.mp3)');
  assert.match(kotlin('Chime.kt'),/"www\/media\/chime\.mp3"/);
  // The page's own store setting follows the platform: the policy's address, and the consent version.
  assert.equal(PRIVACY_URLS.android,POLICY_URL);
  assert.equal(profileFor('store','android').privacyUrl,POLICY_URL);
  assert.equal(profileFor('store','vega').privacyUrl,PRIVACY_URLS.vega);
  assert.equal(profileFor('personal','android').privacyUrl,profileFor('personal','vega').privacyUrl);
});

test('store build switches: the Ko-fi tip and Keep screen awake can be left out, in the HTML only; nothing else changes',()=>{
  const html=o=>readFileSync(join(build({WHATSUP_PLATFORM:'android',...o}),'index.html'),'utf8');
  const plain=html(),hid=html({WHATSUP_HIDE:'tips,awake'});
  assert.match(hid,/<div class="tip-jar" aria-hidden="true" hidden>/);
  assert.match(hid,/<button class="row" id="set-awake" hidden /);
  assert.equal(hid.replace('aria-hidden="true" hidden>','aria-hidden="true">').replace('id="set-awake" hidden ','id="set-awake" '),plain);
  assert.equal(html({WHATSUP_HIDE:'tips'}).includes('id="set-awake" hidden'),false);
  assert.match(read('web/whatsup.css'),/^\[hidden\]\{display:none!important\}/m);
  for(const [k,v] of [['WHATSUP_PLATFORM','tizen'],['WHATSUP_HIDE','ads']]){
    const r=spawnSync(process.execPath,[join(repo,'scripts/build-web.mjs')],{env:env({WHATSUP_OUT:mkdtempSync(join(tmpdir(),'bad-')),[k]:v}),encoding:'utf8'});
    assert.notEqual(r.status,0,`${k}=${v}`);
  }
});

test(`Google TV policy: made from the Fire TV policy by scripts/build-privacy-googletv.mjs, Version ${VERSION}, with Google Play and Android in place of Amazon and Fire TV`,()=>{
  const fire=read('web/privacy-store.txt'),google=read('web/privacy-store-googletv.txt');
  assert.equal(google,googleTvPolicy(fire),'out of date: run node scripts/build-privacy-googletv.mjs');
  assert.match(google,new RegExp(`^Version ${VERSION} · `,'m'));
  assert.doesNotMatch(google,LEFTOVERS);
  assert.ok(google.includes(`This policy: ${POLICY_URL}\n`));
  assert.match(google,/^## Google$/m);
  // Everything else word for word: the same data, services, rights and contact.
  const a=fire.split('\n'),b=google.split('\n');
  assert.equal(a.length,b.length);
  assert.deepEqual(a.map((l,i)=>l===b[i]?null:i+1).filter(Boolean),[3,5,29,45,171,173,199,269,297]);
  // A change to the Fire TV text where an edition change applies stops the script instead of slipping through.
  assert.throws(()=>googleTvPolicy(fire.replace('On Fire TV: Settings','On a Fire TV: Settings')),/expected 1 match, found 0/);
  // Its only placeholders are the two dates of its top line, which PUBLISHED fills on the day the page goes live.
  assert.equal(google.split('\n')[2],versionLine());
  assert.equal(PUBLISHED===null,google.includes('[date]'));
  const dated=google.replace(versionLine(),versionLine('November 16, 2026'));
  assert.equal(dated.split('\n')[2],`Version ${VERSION} · Effective November 16, 2026 · Last updated November 16, 2026`);
  assert.equal(dated.indexOf('['),-1,'nothing else waits to be filled in');
});

test('About & credits for Google TV: its Android libraries under the Apache license, not the Fire TV app\'s packages',()=>{
  const out=join(mkdtempSync(join(tmpdir(),'credits-')),'licenses.txt');
  execFileSync(process.execPath,[join(repo,'scripts/build-credits.mjs')],{env:env({WHATSUP_PLATFORM:'android',WHATSUP_PROFILE:'store',WHATSUP_LICENSES:out}),stdio:'ignore'});
  const t=readFileSync(out,'utf8');
  const libs=read('android/app/libraries.txt').split('\n').filter(l=>l&&!l.startsWith('#'));
  assert.ok(libs.length>=10);
  for(const l of libs){const [id,lic]=l.split(' '),[g,n,v]=id.split(':');assert.ok(t.includes(`\n${g}:${n} ${v}: ${lic}\n`),l);}
  assert.match(t,/^## Apache-2\.0 license text\n\n\s*Apache License\n\s*Version 2\.0, January 2004/m);
  assert.doesNotMatch(t,/React Native|@amazon-devices/);
  for(const h of ['## About','## Data','## Aircraft model photos','## Software','## Fonts'])assert.ok(`\n${t}`.includes(`\n${h}\n`),h);
});

test('android/ keeps no email address: a contact joins the User-Agent only when the build is given one',()=>{
  const files=[];
  const walk=d=>{for(const f of readdirSync(d)){if(['build','.gradle','.kotlin'].includes(f))continue;const p=join(d,f);statSync(p).isDirectory()?walk(p):files.push(p);}};
  walk(join(repo,'android'));
  assert.ok(files.length>20);
  for(const f of files.filter(f=>!/\.(png|jar)$/.test(f)))assert.doesNotMatch(readFileSync(f,'utf8'),/(?<![\w.+\/-])[\w.+-]+@[\w-]+\.[a-z]{2,}/i,f); // (not a test URL's user@host)
  assert.match(read('android/app/build.gradle.kts'),/"WhatsUp-GoogleTV\/\$version \(Spacely Digital/);
});
