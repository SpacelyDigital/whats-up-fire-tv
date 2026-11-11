// node --test tests/  — the release guard (scripts/check-package.mjs) on packages built from web/.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const repo=new URL('..',import.meta.url).pathname,tmp=mkdtempSync(join(tmpdir(),'guard-test-')),forbid=join(tmp,'forbid.txt');
writeFileSync(forbid,'# stand-in list\nzz-not-present-zz\n');
const env=(o={})=>{const e={...process.env,WHATSUP_FORBID:forbid,...o};for(const k of ['WHATSUP_PROFILE','WHATSUP_RELEASE','WHATSUP_OUT','WHATSUP_LICENSES'])if(!(k in o))delete e[k];return e;};
// Built as build-web.mjs builds assets/, packed as a .vpkg holds them (manifest.toml + assets/); edit(dir) changes files first.
function pack(name,{profile='personal',release=false,edit}={}){
  const d=join(tmp,name.replace(/\.vpkg$/,''));
  execFileSync(process.execPath,[join(repo,'scripts/build-web.mjs')],{env:env({WHATSUP_OUT:join(d,'assets'),WHATSUP_PROFILE:profile,...release?{WHATSUP_RELEASE:'1'}:{}}),stdio:'ignore'});
  cpSync(join(repo,'manifest.toml'),join(d,'manifest.toml'));edit?.(d);
  const f=join(tmp,name);execFileSync('tar',['cf',f,'-C',d,'manifest.toml','assets']);return f;
}
const guard=(f,o)=>{const r=spawnSync(process.execPath,[join(repo,'scripts/check-package.mjs'),f],{env:env(o),encoding:'utf8'});return {code:r.status,out:r.stdout+r.stderr};};

test('release guard: the store release package passes',()=>{
  const r=guard(pack('whatsup_armv7-store.vpkg',{profile:'store',release:true}),{WHATSUP_PROFILE:'store'});
  assert.equal(r.code,0,r.out);
});

test('app icon (manifest @image/whatsup_icon.png): the store build ships the 512x512 square the Vega manifest asks for, the personal build the 320x180 home-row tile; both opaque RGB',()=>{
  const ihdr=f=>{const b=readFileSync(f);return {w:b.readUInt32BE(16),h:b.readUInt32BE(20),colour:b[25]};}; // PNG IHDR; colour type 2 = RGB
  for(const [profile,w,h] of [['store',512,512],['personal',320,180]]){
    const f=pack(`icon-${profile}.vpkg`,{profile,release:profile==='store'}),d=join(tmp,`icon-${profile}`);
    assert.deepEqual(ihdr(join(d,'assets/image/whatsup_icon.png')),{w,h,colour:2},`${profile}: ${w}x${h}`);
    assert.match(execFileSync('tar',['tf',f],{encoding:'utf8'}),/^assets\/image\/whatsup_icon\.png$/m,`${profile}: packed`);
  }
});

test('release guard: a store package without the release flag (URL hooks live) fails',()=>{
  const f=pack('dev-store.vpkg',{profile:'store'});
  for(const o of [{},{WHATSUP_PROFILE:'store'}]){const r=guard(f,o);assert.equal(r.code,1,r.out);assert.match(r.out,/not a release build/);}
});

test('release guard: the personal build in a package meant for the store fails (placeholder policy)',()=>{
  const f=pack('mixup-store.vpkg',{release:true}),g=pack('mixup.vpkg',{release:true});
  for(const r of [guard(f),guard(g,{WHATSUP_PROFILE:'store'})]){
    assert.equal(r.code,1,r.out);assert.match(r.out,/personal build/);assert.match(r.out,/placeholder/);
  }
});

test('release guard: a store release whose policy is not the final text fails',()=>{
  const placeholder=readFileSync(join(repo,'web/privacy.txt'),'utf8');
  const f=pack('txt-store.vpkg',{profile:'store',release:true,edit:d=>writeFileSync(join(d,'assets/privacy.txt'),placeholder)});
  const r=guard(f,{WHATSUP_PROFILE:'store'});assert.equal(r.code,1,r.out);assert.match(r.out,/privacy\.txt is not web\/privacy-store\.txt/);
  const g=pack('js-store.vpkg',{profile:'store',release:true,edit:d=>{const p=join(d,'assets/whatsup.js');writeFileSync(p,readFileSync(p,'utf8').replace('Version 3','Version 0'));}});
  const s=guard(g,{WHATSUP_PROFILE:'store'});assert.equal(s.code,1,s.out);assert.match(s.out,/policy the page shows/);
});

test('release guard: personal packages still pass, warned about what keeps them out of the store',()=>{
  const dev=guard(pack('personal-dev.vpkg'));
  assert.equal(dev.code,0,dev.out);assert.match(dev.out,/warning.*URL hooks/);assert.match(dev.out,/warning.*placeholder/);
  const rel=guard(pack('personal-rel.vpkg',{release:true}));
  assert.equal(rel.code,0,rel.out);assert.doesNotMatch(rel.out,/URL hooks/);
});

test('release guard: a stylesheet naming the app fails (comments too)',()=>{
  const f=pack('css-store.vpkg',{profile:'store',release:true,edit:d=>{const p=join(d,'assets/layouts/swiss.css');writeFileSync(p,`/* What's Up */\n${readFileSync(p,'utf8')}`);}});
  const r=guard(f,{WHATSUP_PROFILE:'store'});assert.equal(r.code,1,r.out);assert.match(r.out,/assets\/layouts\/swiss\.css: shows/);
});
