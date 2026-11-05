// node --test tests/  — web/licenses.txt (About & credits) is what scripts/build-credits.mjs writes, so a
// build never leaves the tree dirty.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const repo=new URL('..',import.meta.url).pathname;

test('credits: web/licenses.txt is what build-credits.mjs writes: no carriage returns (B612 Mono\'s licence file has CRLF line ends), the same package rows, the fonts block byte for byte',()=>{
  const out=join(mkdtempSync(join(tmpdir(),'credits-test-')),'licenses.txt'),env={...process.env,WHATSUP_LICENSES:out};delete env.WHATSUP_PROFILE;
  execFileSync(process.execPath,[join(repo,'scripts/build-credits.mjs')],{env,stdio:'ignore'});
  const built=readFileSync(out,'utf8'),kept=readFileSync(join(repo,'web/licenses.txt'),'utf8');
  assert.doesNotMatch(built,/\r/,'carriage returns in the built text');assert.doesNotMatch(kept,/\r/,'carriage returns in web/licenses.txt');
  // The rows' copyright lines come from the shell's node_modules (present on the Mac): compared without them.
  const rows=t=>t.slice(t.indexOf('## App framework'),t.indexOf('## MIT License')).split('\n').filter(l=>/^\S+ \d+\.\d+[^:]*: /.test(l)).map(l=>l.replace(/\. Copyright.*$/,''));
  assert.deepEqual(rows(built),rows(kept));assert.ok(rows(kept).length>100,`${rows(kept).length} rows`);
  const fonts=t=>t.slice(t.indexOf('## Fonts'));
  assert.equal(fonts(built),fonts(kept),'the fonts block');
  if(existsSync(join(repo,'node_modules')))assert.equal(built,kept,'the whole file, with node_modules present');
});
