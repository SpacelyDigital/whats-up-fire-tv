// node --test tests/  — bundled model photos: every type resolves to its file, every credit
// is complete and matches the notices and the credits page, and the KC-46 photo is only
// ever shown for a military B762.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {MODELS,MILITARY_MODELS,modelPhoto} from '../web/models.mjs';

const dir=new URL('../web/models/',import.meta.url);
const LICENSES=['CC BY 2.0','CC BY 2.5','CC BY 3.0','CC BY 3.0 pl','CC BY 4.0','CC0','Public domain'];

test('model photos: all 226 types resolve via modelPhoto to an existing web/models/<key>.jpg',()=>{
  const keys=Object.keys(MODELS);
  assert.equal(keys.length,226);
  for(const k of keys){
    for(const code of [k,k.toLowerCase(),` ${k}`.trim()]){
      const m=modelPhoto({aircraft_type:code});
      assert.ok(m,`${code} resolves`);assert.equal(m.src,`models/${k}.jpg`);assert.equal(m.model,MODELS[k].model);
    }
    const f=new URL(`${k}.jpg`,dir);
    assert.ok(existsSync(f),`${k}.jpg exists`);
    const b=readFileSync(f);
    assert.ok(b.length>2000&&b[0]===0xff&&b[1]===0xd8,`${k}.jpg is a real JPEG (${b.length} bytes)`);
  }
});
test('model photos: no stray files, and every file is resized (under 400 KB)',()=>{
  const files=readdirSync(dir).filter(f=>!f.startsWith('.'));
  const used=new Set([...Object.keys(MODELS),...Object.values(MILITARY_MODELS).map(m=>m.file)].map(k=>`${k}.jpg`));
  assert.deepEqual(files.filter(f=>!used.has(f)),[],'every bundled file is referenced');
  assert.equal(files.length,227);
  for(const f of files)assert.ok(statSync(new URL(f,dir)).size<400000,`${f} is resized`);
});
test('model photos: all 226 credits have an author and a known, non-ShareAlike license',()=>{
  for(const [k,m] of Object.entries({...MODELS,...MILITARY_MODELS})){
    assert.equal(typeof m.author,'string',k);assert.ok(m.author.trim().length>=2&&m.author===m.author.trim(),`${k} author`);
    assert.ok(LICENSES.includes(m.license),`${k}: ${m.license}`);
    assert.ok(m.model&&m.model.trim()===m.model,`${k} model name`);
    assert.ok(!/…|\.\.\./.test(m.author+m.model),`${k}: no ellipsis in a credit`);
  }
});
test('model photos: every credit is in THIRD_PARTY_NOTICES.md (with its Commons source) and on the credits page',()=>{
  const notices=readFileSync(new URL('../THIRD_PARTY_NOTICES.md',import.meta.url),'utf8');
  const credits=readFileSync(new URL('../web/licenses.txt',import.meta.url),'utf8');
  const rows={};
  for(const line of notices.split('\n')){
    const m=/^\| (\w+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| (https:\/\/commons\.wikimedia\.org\/wiki\/File:\S+) \|/.exec(line);
    if(m)rows[m[1]]={model:m[2].trim(),license:m[4].trim()};
  }
  const all={...MODELS,...Object.fromEntries(Object.values(MILITARY_MODELS).map(m=>[m.file,m]))};
  for(const [k,m] of Object.entries(all)){
    assert.ok(rows[k],`${k} has a notices row`);
    assert.equal(rows[k].license,m.license,`${k}: notices and app agree on the license`);
    assert.ok(credits.includes(`${m.model}: ${m.author}. ${m.license}`),`${k}: on the credits page`);
  }
});
test('model photos: the KC-46 photo only for a military B762; military flags never hide a civil photo',()=>{
  assert.deepEqual(Object.keys(MILITARY_MODELS),['B762']);
  const kc=modelPhoto({aircraft_type:'b762',military:true});
  assert.equal(kc.src,'models/KC46.jpg');assert.equal(kc.model,'Boeing KC-46 Pegasus');assert.match(kc.author,/U\.S\. Air Force/);
  for(const military of [false,undefined,null,0,''])assert.equal(modelPhoto({aircraft_type:'B762',military}),null,`B762 military=${military}`);
  assert.ok(!('B762' in MODELS),'no civil 767-200 photo to fall back to');
  // Any other type: a military flag changes nothing.
  for(const k of Object.keys(MODELS))assert.deepEqual(modelPhoto({aircraft_type:k,military:true}),modelPhoto({aircraft_type:k}),k);
  assert.ok(!Object.values(modelPhoto({aircraft_type:'B763',military:true})).some(v=>/KC-?46/.test(v)));
});
test('model photos: odd input never throws and never picks a photo',()=>{
  for(const a of [null,undefined,{},{aircraft_type:''},{aircraft_type:null},{aircraft_type:'ZZZZ'},{aircraft_type:'KC46'},{aircraft_type:'__proto__'},{aircraft_type:'constructor'},{aircraft_type:'toString'},{aircraft_type:42}])
    assert.equal(modelPhoto(a),null,JSON.stringify(a));
});
