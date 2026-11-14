// node scripts/check-package.mjs <package.vpkg|app.apk|app.aab>
// Release guard: the package holds only the files the app is made of, and none of them
// carries personal data or names that must not ship. Exit code 1 on any problem. Fire TV
// packages (.vpkg) carry the page in assets/; the Google TV app (android/, an .apk, or the
// .aab bundle for Google Play) in assets/www/ or base/assets/www/.
//  - Every file must match ALLOWED (a stray file in assets/ is packed as is).
//  - Forbidden strings come from a local file OUTSIDE the repo (never committed), one per
//    line: the home address and coordinates in several formats, people's names, the
//    macOS user name. Default ~/.spacely-release-forbid; WHATSUP_FORBID overrides.
//  - Always forbidden: /Users/ paths, "bureau" (other than the (U.S.) Census Bureau), "obscura",
//    "overhead" (other than the credited MIT project URL), and "What's Up" in text the app
//    shows (code comments are not shown, but are kept out too).
//  - A package meant for the store (WHATSUP_PROFILE=store, as release.sh is run for it; a
//    -store.vpkg name; or a page built with the store profile) must be the store profile's
//    release build: window.__whatsupRelease set (no URL hooks) and the final policy (the
//    store policy file of the page's platform) both shown and as privacy.txt. Any other
//    package is personal:
//    the same gaps are only warned about, so the TV's own builds still pass.
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync,mkdtempSync,existsSync} from 'node:fs';
import {join,relative,basename} from 'node:path';
import {tmpdir,homedir} from 'node:os';

const pkg=process.argv[2];
if(!pkg)throw new Error('usage: check-package.mjs <package.vpkg|app.apk|app.aab>');
const kind=(/\.(apk|aab)$/i.exec(pkg)?.[1]||'vpkg').toLowerCase();
const dir=mkdtempSync(join(tmpdir(),'pkgcheck-'));
if(kind==='vpkg')execFileSync('tar',['xf',pkg,'-C',dir]);else execFileSync('unzip',['-q',pkg,'-d',dir]);
// Where the page is: the Fire TV package's assets/, the Google TV app's assets/www/.
const page={vpkg:'assets/',apk:'assets/www/',aab:'base/assets/www/'}[kind];
const files=[];
const walk=d=>{for(const f of readdirSync(d)){const p=join(d,f);statSync(p).isDirectory()?walk(p):files.push(relative(dir,p));}};
walk(dir);

const ALLOWED=[/^manifest\.toml$/,/^meta-info\/.+$/,/^bundle\/index\.(hermes\.)?bundle$/,/^bundle\/assets\/app\.json$/,
  /^lib\/(armv7|aarch64|x86_64)\/libKeepAwake\.so$/,
  /^assets\/(index\.html|whatsup\.js|whatsup\.css|mvt\.js|qr\.js|privacy\.txt|licenses\.txt|asset-index\.bin|kepler-sdk-version)$/,
  /^assets\/raw\/keplerscript-app-config\.json$/,/^assets\/layouts\/[a-z-]+\.(js|css)$/,
  /^assets\/fonts\/[A-Za-z0-9-]+\.(woff2|ttf|txt)$/,/^assets\/models\/[A-Z0-9]+\.jpg$/,/^assets\/media\/[a-z0-9-]+\.(mp4|wav|mp3|ogg)$/,
  /^assets\/image\/whatsup_icon\.png$/];
// Google TV: the page (no silent video, no Vega icon) and what Android builds around it.
const PAGE=[/^(index\.html|whatsup\.js|whatsup\.css|mvt\.js|qr\.js|privacy\.txt|licenses\.txt)$/,/^layouts\/[a-z-]+\.(js|css)$/,
  /^fonts\/[A-Za-z0-9-]+\.(woff2|ttf|txt)$/,/^models\/[A-Z0-9]+\.jpg$/,/^media\/[a-z0-9-]+\.(wav|mp3|ogg)$/];
const SIGNATURE=/^META-INF\/(MANIFEST\.MF|[\w.-]+\.(SF|RSA|EC|DSA))$/;
const SHELL={
  apk:[/^AndroidManifest\.xml$/,/^classes\d*\.dex$/,/^resources\.arsc$/,/^res\/[\w.-]+(\/[\w.-]+)?$/,SIGNATURE,
    /^META-INF\/com\/android\/build\/gradle\/app-metadata\.properties$/,/^assets\/dexopt\/baseline\.profm?$/],
  aab:[/^BundleConfig\.pb$/,/^base\/manifest\/AndroidManifest\.xml$/,/^base\/dex\/classes\d*\.dex$/,/^base\/(resources|assets|native)\.pb$/,
    /^base\/res\/[\w.-]+\/[\w.-]+$/,/^base\/root\/META-INF\/com\/android\/build\/gradle\/app-metadata\.properties$/,/^base\/assets\/dexopt\/baseline\.profm?$/,
    /^BUNDLE-METADATA\/com\.android\.tools(\.build\.(libraries\/dependencies\.pb|obfuscation\/proguard\.map|profiles\/baseline\.profm?|gradle\/app-metadata\.properties)|\/r8\.json)$/,SIGNATURE],
};
const expected=f=>kind==='vpkg'?ALLOWED.some(r=>r.test(f)):f.startsWith(page)?PAGE.some(r=>r.test(f.slice(page.length))):SHELL[kind].some(r=>r.test(f));
const problems=[];
for(const f of files)if(!expected(f))problems.push(`unexpected file: ${f}`);

const forbidFile=process.env.WHATSUP_FORBID||join(homedir(),'.spacely-release-forbid');
if(!existsSync(forbidFile))problems.push(`no forbidden-strings file at ${forbidFile} (home address, coordinates, names; one per line)`);
const local=existsSync(forbidFile)?readFileSync(forbidFile,'utf8').split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')):[];
const ALWAYS=[/\/Users\//,/bureau/i,/obscura/i,/overhead(?!(\.(js|mjs)|\/))/i];
let n=0;
for(const f of files){
  const buf=readFileSync(join(dir,f));
  if(/\.(jpg|png|webp|woff2|mp4|wav|mp3|ogg|bin|prof|profm)$/.test(f))continue; // media: no text to check
  const text=buf.toString('latin1');
  for(const s of local)if(text.toLowerCase().includes(s.toLowerCase())){problems.push(`${f}: contains a forbidden string (#${local.indexOf(s)+1} in ${forbidFile})`);n++;}
  for(const r of ALWAYS){
    const t=text.replace(/github\.com\/alexlmiller\/overhead/g,'').replace(/(U\.S\. )?Census Bureau/g,'');
    const m=r.exec(t);if(m)problems.push(`${f}: "${t.slice(Math.max(0,m.index-30),m.index+40).replace(/[^\x20-\x7e]/g,'.')}"`);
  }
}
// "What's Up" may only be the page title (not shown on a TV) and the store-facing manifest
// (on Google TV, the app's name in its Android resources).
for(const f of files.filter(f=>f.startsWith(page)&&/\.(html|js|css|txt)$/.test(f))){
  const t=readFileSync(join(dir,f),'utf8').replace(/<title>[^<]*<\/title>/,'');
  const m=/What['’]s Up/.exec(t);if(m)problems.push(`${f}: shows "${t.slice(Math.max(0,m.index-40),m.index+20)}"`);
}
const mainJs=files.includes(page+'whatsup.js')?readFileSync(join(dir,page+'whatsup.js'),'utf8'):'';
const profile=(/window\.__whatsupProfile="(\w+)"/.exec(mainJs)||[])[1]||'unknown',release=/^window\.__whatsupRelease=true;$/m.test(mainJs);
// The page must be the one built for this app: Fire TV's in a .vpkg, Google TV's (WHATSUP_PLATFORM=android) in an .apk or .aab.
const platform=/^window\.__whatsupPlatform="android";$/m.test(mainJs)?'android':'vega';
if((kind==='vpkg')!==(platform==='vega'))problems.push(`the page is the ${platform==='vega'?'Fire TV':'Google TV'} build, in a ${kind} package`);
const policy=files.includes(page+'privacy.txt')?readFileSync(join(dir,page+'privacy.txt'),'utf8'):'';
let shown=null;try{shown=JSON.parse(mainJs.split('\n').find(l=>l.startsWith('window.__whatsupDocs=')).slice(21,-1)).privacy;}catch{/* none */}
const placeholder=t=>/placeholder/i.test(t||'')?' (the placeholder)':'';
if(process.env.WHATSUP_PROFILE==='store'||/-store(-[\w-]+)?\.(vpkg|apk|aab)$/.test(basename(pkg))||profile==='store'){
  if(profile!=='store')problems.push(`store package: the page is the ${profile} build (placeholder policy, full-screen stage)`);
  if(!release)problems.push('store package: not a release build (no window.__whatsupRelease: the ?demo, ?q, ?screen... URL hooks are live)');
  // The final policy, byte for byte, where the app shows it and as privacy.txt; its placeholders
  // ([date], [month year], [web address]) never ship: any "[" fails.
  const name=platform==='android'?'privacy-store-googletv.txt':'privacy-store.txt';
  const final=readFileSync(new URL(`../web/${name}`,import.meta.url),'utf8');
  if(!policy)problems.push(`store package: no ${page}privacy.txt`);
  else if(policy!==final)problems.push(`store package: ${page}privacy.txt is not web/${name}${placeholder(policy)}`);
  if(shown!==final)problems.push(`store package: the policy the page shows (whatsup.js) is not web/${name}${placeholder(shown)}`);
  const at=policy.indexOf('[');if(at>=0)problems.push(`store package: privacy.txt still has a placeholder: "${policy.slice(at,at+20)}"`);
}else{
  if(!release)console.warn('package check warning: personal package, not a release build: the URL hooks are live');
  if(placeholder(shown||policy))console.warn('package check warning: personal package: its privacy text is the placeholder (not for the store)');
}
if(problems.length){console.error(`package check FAILED (${problems.length}):\n  `+problems.slice(0,40).join('\n  '));process.exit(1);}
console.log(`package check passed: ${files.length} files, all expected; ${local.length} forbidden strings and the fixed rules absent`);
