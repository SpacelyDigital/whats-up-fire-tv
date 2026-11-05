// node --test tests/  — app.mjs screen logic on its own: each function is cut from the source and
// run in a vm, with stubs for the page around it (the DOM, the feed, the other screens).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const APP=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
// A top-level function or line of app.mjs as written (a function ends at the first "}" in column 0).
const fn=name=>{const m=new RegExp(`^(async )?function ${name}\\(.*?\\n\\}`,'ms').exec(APP);assert.ok(m,`function ${name} in app.mjs`);return m[0];};
const line=start=>{const m=new RegExp(`^${start}.*$`,'m').exec(APP);assert.ok(m,`${start} in app.mjs`);return m[0];};
// A context with those functions; setText(id,v) lands in `texts`.
function page(code,globals={}){
  const texts={},ctx=vm.createContext({texts,setText:(id,v)=>{texts[id]=String(v??'');},console:{error(){}},...globals});
  vm.runInContext(code.join('\n'),ctx);
  return ctx;
}

test('search entry: at most 40 characters, Space included; Space never leads or doubles',()=>{
  const p=page([line('let entry='),fn('typeKey')],{clearTimeout(){},setTimeout(){},runSearch(){}});
  const type=(...keys)=>{for(const k of keys)p.typeKey(k);return vm.runInContext('entry',p);};
  const W40='W'.repeat(40);
  assert.equal(type(...Array(45).fill('W')),W40);
  assert.equal(type('space'),W40,'Space at the cap is ignored');
  assert.equal(type('X'),W40);
  assert.equal(p.texts['entry-text'],W40,'as shown');
  assert.equal(type('del','space','space'),W40.slice(1)+' ','below the cap Space works, once');
  assert.equal(type('clear','space','A','space','space','B'),'A B');
});
