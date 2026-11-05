// node --test tests/  — on-screen text: unit formatting edge cases (fmt), and the pure helpers
// that build the shorter wordings fitLine falls back to (airlineAlts, militaryAlts, psCredit,
// shortAuthor, placeAlts, shortField), checked with the longest real names the app holds.
// The app promises: no "…" ever, and photo credits always keep the photographer and the site.
// Tests marked {todo:'BUG: ...'} expose a real bug (see qa/overnight-2026-11-02/FINDINGS-unit.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fmt,useSettings,airlineAlts,militaryAlts,psCredit,shortAuthor,placeAlts,shortField,photoAlt,boardCity,boardOperator} from '../web/kit.mjs';
import {shortType,typeName} from '../web/model.mjs';
import {MODELS,MILITARY_MODELS} from '../web/models.mjs';
import {AIRCRAFT_TYPES} from '../web/aircraft-types.mjs';
import {loadSettings} from '../web/place.mjs';

const ELLIPSIS=/…|\.\.\./;
const BAD=[NaN,undefined,null,Infinity,-Infinity,'12',{},[]];
const mi=()=>useSettings({distance:'mi',altitude:'ft'}),km=()=>useSettings({distance:'km',altitude:'m'});

// --- fmt ----------------------------------------------------------------------------------------
test('fmt.int: rounding, thousands, huge values, and a dash for anything not a number',()=>{
  mi();
  assert.equal(fmt.int(0),'0');assert.equal(fmt.int(0.49),'0');assert.equal(fmt.int(0.5),'1');assert.equal(fmt.int(999.5),'1,000');
  assert.equal(fmt.int(-1),'-1');assert.equal(fmt.int(-1500.4),'-1,500');
  assert.equal(fmt.int(1e9),'1,000,000,000');assert.equal(fmt.int(123456789.6),'123,456,790');
  for(const v of BAD)assert.equal(fmt.int(v),'—',String(v));
});
test('fmt.int: a small negative never shows as "-0"',()=>{
  assert.equal(fmt.int(-0.4),'0');
  km();assert.equal(fmt.alt(-1),'0 m','an airfield 1 ft below sea level');assert.equal(fmt.altNum(-1),'0');mi();
});
test('fmt.dist / fmt.far: miles and km, zero, rounding boundaries, decimals, huge, missing',()=>{
  mi();
  assert.equal(fmt.dist(0),'0.0 mi');assert.equal(fmt.dist(0.04),'0.0 mi');assert.equal(fmt.dist(0.06),'0.1 mi');
  assert.equal(fmt.dist(9.96),'10.0 mi');assert.equal(fmt.dist(2.5,0),'3 mi');assert.equal(fmt.dist(1,2),'1.00 mi');
  assert.equal(fmt.dist(12000.04),'12000.0 mi');
  assert.equal(fmt.far(0),'0 mi');assert.equal(fmt.far(4207),'4,207 mi');assert.equal(fmt.far(9876.5),'9,877 mi');assert.equal(fmt.far(12450.2),'12,450 mi');
  km();
  assert.equal(fmt.dist(0),'0.0 km');assert.equal(fmt.dist(1),'1.6 km');assert.equal(fmt.dist(0.03),'0.0 km');assert.equal(fmt.dist(0.04),'0.1 km');
  assert.equal(fmt.far(4207),'6,771 km');assert.equal(fmt.far(12450),'20,036 km');
  for(const v of BAD){assert.equal(fmt.dist(v),'—',String(v));assert.equal(fmt.far(v),'—',String(v));}
  mi();
});
test('fmt.alt: feet, flight levels from 18,000 ft, metres; zero, below sea level, very high, missing',()=>{
  mi();
  assert.equal(fmt.alt(0),'0 ft');assert.equal(fmt.alt(-1500),'-1,500 ft');assert.equal(fmt.alt(17999),'17,999 ft');
  assert.equal(fmt.alt(18000),'FL180');assert.equal(fmt.alt(18049),'FL180');assert.equal(fmt.alt(18050),'FL181');
  assert.equal(fmt.alt(60000),'FL600');assert.equal(fmt.alt(99999),'FL1000');
  assert.equal(fmt.altNum(35000),'35,000');assert.equal(fmt.altUnit(),'ft');
  km();
  assert.equal(fmt.alt(0),'0 m');assert.equal(fmt.alt(35000),'10,668 m');assert.equal(fmt.alt(18000),'5,486 m','no flight levels in metres');
  assert.equal(fmt.alt(-1500),'-457 m');assert.equal(fmt.altNum(1000),'305');assert.equal(fmt.altUnit(),'m');
  for(const v of BAD){assert.equal(fmt.alt(v),'—',String(v));assert.equal(fmt.altNum(v),'—',String(v));}
  mi();
});
test('fmt.speed, fmt.vs, fmt.hundreds: zero, boundaries, symmetry, missing',()=>{
  mi();
  assert.equal(fmt.speed(0),'0 kt');assert.equal(fmt.speed(1500),'1,500 kt');assert.equal(fmt.speedNum(451.5),'452');assert.equal(fmt.speedUnit(),'kt');
  km();assert.equal(fmt.speed(0),'0 km/h');assert.equal(fmt.speed(451),'835 km/h');assert.equal(fmt.speedUnit(),'km/h');assert.equal(fmt.distUnit(),'km');mi();
  for(const v of BAD){assert.equal(fmt.speed(v),'—');assert.equal(fmt.speedNum(v),'—');assert.equal(fmt.vs(v),'—');}
  assert.equal(fmt.vs(0),'level');assert.equal(fmt.vs(99),'level');assert.equal(fmt.vs(-99),'level');
  assert.equal(fmt.vs(100),'↑100');assert.equal(fmt.vs(-100),'↓100');
  for(const r of [64,128,640,1216,2496,6400])assert.equal(fmt.vs(r).slice(1),fmt.vs(-r).slice(1),`±${r} fpm read the same`);
  assert.equal(fmt.vs(1216),'↑1,200');assert.equal(fmt.vs(-6400),'↓6,400');
  km();assert.equal(fmt.vs(1000),'↑5.1 m/s');assert.equal(fmt.vs(-1000),'↓5.1 m/s');assert.equal(fmt.vs(50),'level');mi();
  assert.equal(fmt.hundreds(0),'000');assert.equal(fmt.hundreds(-500),'000','never negative');assert.equal(fmt.hundreds(4549),'045');
  assert.equal(fmt.hundreds(4550),'046');assert.equal(fmt.hundreds(45000),'450');assert.equal(fmt.hundreds(150000),'1500');
  for(const v of [undefined,null,NaN,0])assert.equal(fmt.hundreds(v),'000',String(v));
});
test('fmt.mmss and fmt.ago: zero, boundaries, long waits, clock in the future',()=>{
  assert.equal(fmt.mmss(0),'0:00');assert.equal(fmt.mmss(59.9),'0:59');assert.equal(fmt.mmss(60),'1:00');assert.equal(fmt.mmss(61.5),'1:01');
  assert.equal(fmt.mmss(3600),'60:00');
  const now=1793577600000;
  assert.equal(fmt.ago(now/1000,now),'now');assert.equal(fmt.ago(now/1000-59,now),'now');assert.equal(fmt.ago(now/1000-60,now),'1m');
  assert.equal(fmt.ago(now/1000-3599,now),'59m');assert.equal(fmt.ago(now/1000-3600,now),'1h');assert.equal(fmt.ago(now/1000+300,now),'now','a stamp ahead of the TV clock');
});
test('fmt: no output is ever an ellipsis',()=>{
  for(const set of [mi,km]){set();
    for(const v of [0,-0.4,0.05,1,17999,18000,1e7,NaN,undefined])
      for(const f of ['int','dist','far','alt','altNum','speed','speedNum','vs','hundreds'])assert.ok(!ELLIPSIS.test(fmt[f](v)),`${f}(${v})`);
  }
  mi();
});

// --- Shorter wordings --------------------------------------------------------------------------
// Every alternative list: non-empty strings, longest (the full value) first, no repeats, no "…",
// nothing ending in a dangling comma, dash or slash.
function wellFormed(alts,what){
  assert.ok(Array.isArray(alts)&&alts.length>=1,`${what}: at least one wording`);
  assert.equal(new Set(alts).size,alts.length,`${what}: no repeats`);
  for(let i=0;i<alts.length;i++){
    const a=alts[i];
    assert.equal(typeof a,'string');assert.ok(a.trim().length>0,`${what}: empty wording`);
    assert.equal(a,a.trim(),`${what}: "${a}" has outer spaces`);
    assert.ok(!ELLIPSIS.test(a),`${what}: "${a}" has an ellipsis`);
    assert.ok(!/[,·:;\/–-]$/.test(a),`${what}: "${a}" ends in punctuation`);
    if(i)assert.ok(a.length<=alts[i-1].length,`${what}: "${a}" is not shorter than "${alts[i-1]}"`);
  }
}
// The operator table in model.mjs (not exported): read it the way build-credits reads models.mjs.
const OPERATORS=new Function('return '+/const OPERATORS=(\{[\s\S]*?\});/.exec(readFileSync(new URL('../web/model.mjs',import.meta.url),'utf8'))[1])();
const OWNERS=['AEROTRANSPORTES MAS DE CARGA SA DE CV','INTERNATIONAL BUSINESS AVIATION SERVICES LLC','LUFTHANSA CARGO AG',
  'Atlas Air Worldwide Holdings, Inc.','Amazon Air','PRIVATE','Private','Aerovías de México S.A. de C.V.','Qatar Airways Cargo','Cathay Pacific Airways Ltd'];

test('airlineAlts: every operator name and long owner names give well-formed, shrinking wordings',()=>{
  const names=[...new Set([...Object.values(OPERATORS),...OWNERS])];
  assert.ok(names.length>100);
  for(const n of names){
    const alts=airlineAlts(n);
    wellFormed(alts,n);assert.equal(alts[0],n,'the full name first');
    assert.ok(alts.every(a=>n.toLowerCase().includes(a.toLowerCase().split(' ')[0])),`${n}: wordings come from the name`);
  }
  // (Owner names are never shown; they only check the suffix rules on long inputs.)
  assert.deepEqual(airlineAlts('Atlas Air Worldwide Holdings, Inc.'),['Atlas Air Worldwide Holdings, Inc.','Atlas Air Worldwide Holdings','Atlas']);
  assert.deepEqual(airlineAlts('LUFTHANSA CARGO AG'),['LUFTHANSA CARGO AG','LUFTHANSA CARGO','LUFTHANSA']);
  assert.deepEqual(airlineAlts(''),[]);assert.deepEqual(airlineAlts(undefined),[]);assert.deepEqual(airlineAlts(null),[]);
  // Upper-case layouts (cockpit) map them: still well formed.
  for(const n of Object.values(OPERATORS))wellFormed(airlineAlts(n).map(s=>s.toUpperCase()),n);
});
test('airlineAlts: the shortest wording still names the operator (not "Air", "El", "US", "China")',{todo:'BUG: the last wording is the first word, which for many operators is a generic fragment: Air Canada/Air France/Air India -> "Air", El Al -> "El", US Air Force -> "US", China Eastern/Southern -> "China", Sun Country -> "Sun" (FINDINGS-unit.md U-05)'},()=>{
  const GENERIC=new Set(['Air','Aer','El','US','Sun','Sky','West','Western','China','Mountain']);
  const bad=[...new Set(Object.values(OPERATORS))].filter(n=>GENERIC.has(airlineAlts(n).at(-1))).map(n=>`${n} -> ${airlineAlts(n).at(-1)}`);
  assert.deepEqual(bad,[]);
});
test('boardCity / boardOperator: a Departures cell (11 flaps) shows the whole name or a code, never a first word or a cut',()=>{
  for(const [c,code,want] of [['San Francisco','SFO','SFO'],['Fort Lauderdale','FLL','FLL'],['Colorado Springs','COS','COS'],['Salt Lake City','SLC','SLC'],
    ['Indianapolis','IND','IND'],['Philadelphia','PHL','PHL'],['Frankfurt am Main','FRA','FRA'],['Dallas-Fort Worth','DFW','DFW'],['Jacksonville','JAX','JAX'],
    ['San Jose del Cabo','SJD','SJD'],['Chicago','ORD','CHICAGO'],['Kansas City','MCI','KANSAS CITY'],['  New York ','JFK','NEW YORK'],['','KDEN','KDEN'],[undefined,'BOS','BOS']])
    assert.equal(boardCity(c,code,11),want,String(c));
  for(const [o,call,want] of [['Air New Zealand','ANZ5','ANZ'],['Air Hong Kong','AHK8402','AHK'],['British Airways','BAW296','BRITISH'],['Lufthansa Cargo','GEC8401','LUFTHANSA'],
    ['Air China Cargo','CAO1043','AIR CHINA'],['US Air Force','RCH481','RCH'],['China Eastern','CES581','CES'],['Air Canada Rouge','ROU1720','ROU'],['AirBridgeCargo','ABW123','ABW'],
    ['United','UAL77','UNITED'],['Amazon Air','ATN3121','AMAZON AIR']])
    assert.equal(boardOperator(o,call,11),want,o);
  // Every operator the app names: whole, its short name, or the callsign's code; never a lone first word cut from it.
  for(const [code,o] of Object.entries(OPERATORS)){
    const s=boardOperator(o,`${code}123`,11),first=o.split(/\s+/)[0].toUpperCase();
    assert.ok(s.length<=11&&s.length>=2,`${o} -> "${s}"`);
    assert.ok(s===code||airlineAlts(o).map(x=>x.toUpperCase()).includes(s),`${o} -> "${s}"`);
    if(s===first&&/\s/.test(o))assert.ok(airlineAlts(o,false).map(x=>x.toUpperCase()).includes(s),`${o} -> "${s}": a first word, not its short name`);
  }
});
test('militaryAlts: count first, most seen first, at most four types, shorter by dropping types, "none yet"',()=>{
  // The longest short names among the military types the app knows.
  const mil=Object.keys(AIRCRAFT_TYPES).map(c=>shortType(c)).filter(s=>/^[A-Z]{1,3}-\d/.test(s)).sort((a,b)=>b.length-a.length).slice(0,6);
  assert.ok(mil.length===6&&mil[0].length>=6,mil.join(','));
  const L={militaryTypes:mil.map((k,i)=>[k,99-i*7])};
  const alts=militaryAlts(L);
  wellFormed(alts,'military');
  assert.equal(alts.length,4);assert.equal(alts[0].split(' · ').length,4);assert.equal(alts.at(-1),`99 ${mil[0]}`);
  for(const a of alts)assert.ok(a.split(' · ').every(p=>/^\d+ \S/.test(p)),`count first: ${a}`);
  assert.deepEqual(militaryAlts({militaryTypes:[['C-17',1]]}),['1 C-17']);
  assert.deepEqual(militaryAlts({militaryTypes:[['C-17',2],['KC-135',1]]}),['2 C-17 · 1 KC-135','2 C-17']);
  for(const L of [{militaryTypes:[]},{},null,undefined])assert.deepEqual(militaryAlts(L),['none yet']);
});
test('shortType and typeName: every type code gives a non-empty name with no ellipsis; long names stay whole',()=>{
  for(const [code,name] of Object.entries(AIRCRAFT_TYPES)){
    assert.ok(name&&!ELLIPSIS.test(name),code);
    assert.equal(typeName(code),name);assert.equal(typeName(code.toLowerCase()),name);
    const s=shortType(code);assert.ok(s&&!ELLIPSIS.test(s),`${code} short`);
  }
  assert.equal(typeName('A9'),'Rockwell A-9 Quail Commander');assert.equal(shortType('A9'),'A9','no number-led first word: the code');
  assert.equal(shortType('B21'),'B21');assert.equal(shortType('K35R'),'KC-135');assert.equal(shortType(''),'');assert.equal(typeName(''),'');
});

// Photo credits.
const PS_NAMES=['John Robert Murdoch','Wolfgang Mendorf','Pierre-Alain Petit','José Carlos Fernández Gutiérrez','Kryštof Kříž',
  'Stefan "Spotter" Müller','Jun','Author unknown','Bartłomiej Wojciechowski-Grzybowski Jr Aviation Photos ','A'.repeat(60)].map(s=>s.trim());
test('psCredit: every wording keeps the photographer and Planespotters, longest first, never "…"',()=>{
  for(const n of PS_NAMES){
    const alts=psCredit(n);
    wellFormed(alts,n);
    assert.equal(alts[0],`Photo © ${n} / Planespotters.net`);
    const short=shortAuthor(n);
    for(const a of alts){
      assert.match(a,/ \/ Planespotters(\.net)?$/,`${a}: the site`);
      assert.ok(a.includes(n)||a.includes(short),`${a}: the photographer`);
      assert.ok(/^(Photo )?© \S/.test(a),`${a}: the © mark`);
    }
    // The surname (last word) survives every wording.
    const last=n.split(/\s+/).at(-1);
    assert.ok(alts.every(a=>a.includes(last)),`${n}: "${last}" in every wording`);
  }
});
test('shortAuthor: person names become an initial and the surname; agency photos keep the agency',()=>{
  assert.equal(shortAuthor('Julian Herzog'),'J. Herzog');assert.equal(shortAuthor('Alf van Beem'),'A. van Beem');
  assert.equal(shortAuthor('D. Miller'),'D. Miller');assert.equal(shortAuthor('Kuba Bożanowski'),'K. Bożanowski');
  assert.equal(shortAuthor('4300streetcar'),'4300streetcar','one word stays');
  assert.equal(shortAuthor('Author unknown'),'Author unknown');
  assert.equal(shortAuthor('U.S. Air Force photo by Airman 1st Class Cody Dowell'),'U.S. Air Force photo');
  assert.equal(shortAuthor('U.S. Navy photo'),'U.S. Navy photo');
  for(const m of [...Object.values(MODELS),...Object.values(MILITARY_MODELS)]){
    const s=shortAuthor(m.author);
    assert.ok(s&&s.length<=m.author.length&&!ELLIPSIS.test(s),m.author);
    if(!/ photo( by |$)/.test(m.author))assert.ok(s.endsWith(m.author.split(/\s+/).at(-1)),`${m.author} -> ${s}: the last word kept`);
  }
});
test('shortAuthor: a CC BY credit that is a username or an organisation is not turned into a wrong "initial + word"',()=>{
  const nonPersons=['BWard 1997','Curimedia Photography','N.C (Wikimedia Commons)','Armada Argentina','Kansai explorer','happy days photos and art',
    "Armchair Aviator's",'Jeroen Stroes Aviation Photography','Sudan Envoy','Ministerstwo Spraw Wewnętrznych i Administracji'];
  const inModels=new Set(Object.values(MODELS).map(m=>m.author));
  for(const a of nonPersons)assert.ok(inModels.has(a),`${a} is a real credit`);
  assert.deepEqual(nonPersons.filter(a=>shortAuthor(a)!==a).map(a=>`${a} -> ${shortAuthor(a)}`),[]);
});
test('model photo credits: the shortest wording the layouts use still names the author and the license',()=>{
  // atlas.mjs / kit.mjs showPhotoIn: ..., `${shortAuthor(author)} · ${license}`.
  for(const [k,m] of Object.entries({...MODELS,...MILITARY_MODELS})){
    const last=`${shortAuthor(m.author)} · ${m.license}`;
    assert.ok(!ELLIPSIS.test(last),k);assert.ok(last.endsWith(` · ${m.license}`),k);
    assert.ok(shortAuthor(m.author).length>=2,`${k}: "${last}"`);
  }
});

// Place names and airfields.
test('placeAlts: the longest real place names give "Name, Region" then the name, never "…"',()=>{
  const places=[{name:'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch',admin:'Wales',countryCode:'GB',country:'United Kingdom'},
    {name:'Rancho Santa Margarita',admin:'California',countryCode:'US',country:'United States'},
    {name:'Saint-Rémy-en-Bouzemont-Saint-Genest-et-Isson',admin:'Grand Est',countryCode:'FR',country:'France'},
    {name:'Hebron',admin:'Kentucky',countryCode:'US',country:'United States'},
    {name:'Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu',admin:"Hawke's Bay",countryCode:'NZ',country:'New Zealand'},
    {name:'Rosemont',admin:'Illinois',countryCode:'US',country:'United States'}];
  for(const raw of places){
    // Through loadSettings, as the app does (a saved name is capped at 60 characters).
    globalThis.localStorage={getItem:()=>JSON.stringify({place:{...raw,latitude:10,longitude:10,timeZone:'UTC'},confirmed:true}),setItem(){},removeItem(){}};
    const place=loadSettings().place;delete globalThis.localStorage;
    useSettings({distance:'mi',altitude:'ft',place});
    const alts=placeAlts();wellFormed(alts,place.name);
    assert.equal(alts.at(-1),place.name);
  }
  useSettings({distance:'mi',altitude:'ft',place:{name:'Hebron',admin:'Kentucky',countryCode:'US',country:'United States'}});
  assert.deepEqual(placeAlts(),['Hebron, KY','Hebron']);
  useSettings({distance:'mi',altitude:'ft',place:null});assert.deepEqual(placeAlts(),[]);
  mi();
});
test('shortField: long airport names lose the "International Airport" part, never everything',()=>{
  assert.equal(shortField('Cincinnati/Northern Kentucky International Airport'),'Cincinnati/Northern Kentucky');
  assert.equal(shortField("Chicago O'Hare International Airport"),"Chicago O'Hare");
  assert.equal(shortField('Butler County Regional Airport - Hogan Field'),'Butler County');
  assert.equal(shortField('Airport'),'Airport','nothing left: the name stays');
  assert.equal(shortField('Lunken Field'),'Lunken Field');
});
test('photoAlt: screen-reader text for the photo',()=>{
  assert.equal(photoAlt({type:'Boeing 737-800'}),'Photo of a Boeing 737-800');
  assert.equal(photoAlt({type:'Airbus A320'}),'Photo of an Airbus A320');
  assert.equal(photoAlt({aircraft_type:'E75L'}),'Photo of an E75L');
  assert.equal(photoAlt(null),'Photo of an aircraft');
});
