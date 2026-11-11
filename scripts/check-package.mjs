// node scripts/check-package.mjs <package.vpkg>
// Release guard: the package holds only the files the app is made of, and none of them
// carries personal data or names that must not ship. Exit code 1 on any problem.
//  - Every file must match ALLOWED (a stray file in assets/ is packed as is).
//  - Forbidden strings come from a local file OUTSIDE the repo (never committed), one per
//    line: the home address and coordinates in several formats, people's names, the
//    macOS user name. Default ~/.spacely-release-forbid; WHATSUP_FORBID overrides.
//  - Always forbidden: /Users/ paths, "bureau" (other than the (U.S.) Census Bureau), "obscura",
//    "overhead" (other than the credited MIT project URL), and "What's Up" in text the app
//    shows (code comments are not shown, but are kept out too).
//  - A package meant for the store (WHATSUP_PROFILE=store, as release.sh is run for it; a
//    -store.vpkg name; or a page built with the store profile) must be the store profile's
//    release build: window.__whatsupRelease set (no URL hooks) and the final policy
//    (web/privacy-store.txt) both shown and as privacy.txt. Any other package is personal:
//    the same gaps are only warned about, so the TV's own builds still pass.
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync,mkdtempSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir,homedir} from 'node:os';

const pkg=process.argv[2];
if(!pkg)throw new Error('usage: check-package.mjs <package.vpkg>');
const dir=mkdtempSync(join(tmpdir(),'pkgcheck-'));
execFileSync('tar',['xf',pkg,'-C',dir]);
const files=[];
const walk=d=>{for(const f of readdirSync(d)){const p=join(d,f);statSync(p).isDirectory()?walk(p):files.push(relative(dir,p));}};
walk(dir);

const ALLOWED=[/^manifest\.toml$/,/^meta-info\/.+$/,/^bundle\/index\.(hermes\.)?bundle$/,/^bundle\/assets\/app\.json$/,
  /^lib\/(armv7|aarch64|x86_64)\/libKeepAwake\.so$/,
  /^assets\/(index\.html|whatsup\.js|whatsup\.css|mvt\.js|qr\.js|privacy\.txt|licenses\.txt|asset-index\.bin|kepler-sdk-version)$/,
  /^assets\/raw\/keplerscript-app-config\.json$/,/^assets\/layouts\/[a-z-]+\.(js|css)$/,
  /^assets\/fonts\/[A-Za-z0-9-]+\.(woff2|ttf|txt)$/,/^assets\/models\/[A-Z0-9]+\.jpg$/,/^assets\/media\/[a-z0-9-]+\.(mp4|wav|mp3|ogg)$/,
  /^assets\/image\/whatsup_icon\.png$/];
const problems=[];
for(const f of files)if(!ALLOWED.some(r=>r.test(f)))problems.push(`unexpected file: ${f}`);

const forbidFile=process.env.WHATSUP_FORBID||join(homedir(),'.spacely-release-forbid');
if(!existsSync(forbidFile))problems.push(`no forbidden-strings file at ${forbidFile} (home address, coordinates, names; one per line)`);
const local=existsSync(forbidFile)?readFileSync(forbidFile,'utf8').split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')):[];
const ALWAYS=[/\/Users\//,/bureau/i,/obscura/i,/overhead(?!(\.(js|mjs)|\/))/i];
let n=0;
for(const f of files){
  const buf=readFileSync(join(dir,f));
  if(/\.(jpg|png|woff2|mp4|wav|mp3|ogg|bin)$/.test(f))continue; // media: no text to check
  const text=buf.toString('latin1');
  for(const s of local)if(text.toLowerCase().includes(s.toLowerCase())){problems.push(`${f}: contains a forbidden string (#${local.indexOf(s)+1} in ${forbidFile})`);n++;}
  for(const r of ALWAYS){
    const t=text.replace(/github\.com\/alexlmiller\/overhead/g,'').replace(/(U\.S\. )?Census Bureau/g,'');
    const m=r.exec(t);if(m)problems.push(`${f}: "${t.slice(Math.max(0,m.index-30),m.index+40).replace(/[^\x20-\x7e]/g,'.')}"`);
  }
}
// "What's Up" may only be the page title (not shown on a TV) and the store-facing manifest.
for(const f of files.filter(f=>/^assets\/.*\.(html|js|css|txt)$/.test(f))){
  const t=readFileSync(join(dir,f),'utf8').replace(/<title>[^<]*<\/title>/,'');
  const m=/What['’]s Up/.exec(t);if(m)problems.push(`${f}: shows "${t.slice(Math.max(0,m.index-40),m.index+20)}"`);
}
const mainJs=files.includes('assets/whatsup.js')?readFileSync(join(dir,'assets/whatsup.js'),'utf8'):'';
const profile=(/window\.__whatsupProfile="(\w+)"/.exec(mainJs)||[])[1]||'unknown',release=/^window\.__whatsupRelease=true;$/m.test(mainJs);
const policy=files.includes('assets/privacy.txt')?readFileSync(join(dir,'assets/privacy.txt'),'utf8'):'';
let shown=null;try{shown=JSON.parse(mainJs.split('\n').find(l=>l.startsWith('window.__whatsupDocs=')).slice(21,-1)).privacy;}catch{/* none */}
const placeholder=t=>/placeholder/i.test(t||'')?' (the placeholder)':'';
if(process.env.WHATSUP_PROFILE==='store'||/-store\.vpkg$/.test(pkg)||profile==='store'){
  if(profile!=='store')problems.push(`store package: the page is the ${profile} build (placeholder policy, full-screen stage)`);
  if(!release)problems.push('store package: not a release build (no window.__whatsupRelease: the ?demo, ?q, ?screen... URL hooks are live)');
  // The final policy, byte for byte, where the app shows it and as privacy.txt; its placeholders
  // ([date], [month year], [web address]) never ship: any "[" fails.
  const final=readFileSync(new URL('../web/privacy-store.txt',import.meta.url),'utf8');
  if(!policy)problems.push('store package: no assets/privacy.txt');
  else if(policy!==final)problems.push(`store package: assets/privacy.txt is not web/privacy-store.txt${placeholder(policy)}`);
  if(shown!==final)problems.push(`store package: the policy the page shows (whatsup.js) is not web/privacy-store.txt${placeholder(shown)}`);
  const at=policy.indexOf('[');if(at>=0)problems.push(`store package: privacy.txt still has a placeholder: "${policy.slice(at,at+20)}"`);
}else{
  if(!release)console.warn('package check warning: personal package, not a release build: the URL hooks are live');
  if(placeholder(shown||policy))console.warn('package check warning: personal package: its privacy text is the placeholder (not for the store)');
}
if(problems.length){console.error(`package check FAILED (${problems.length}):\n  `+problems.slice(0,40).join('\n  '));process.exit(1);}
console.log(`package check passed: ${files.length} files, all expected; ${local.length} forbidden strings and the fixed rules absent`);
