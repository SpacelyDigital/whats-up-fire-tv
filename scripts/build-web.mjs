// Bundles web/ into assets/ for the Vega WebView, which loads the page from
// file:///pkg/assets/. ES modules do not load from file:// URLs, so the modules
// are joined into one classic script. No dependencies: each module becomes a
// function scope, and imports resolve to the exports of earlier modules.
// Layouts (web/layouts/<id>.mjs + .css) become separate scripts the page loads
// only when that layout is chosen: assets/layouts/<id>.js registers itself with
// window.__whatsupLayout(...) and reads shared modules from window.__whatsupModules.
import {readFileSync,writeFileSync,mkdirSync,rmSync,cpSync,readdirSync} from 'node:fs';
import {dirname,join,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const web=join(root,'web'),out=process.env.WHATSUP_OUT||join(root,'assets'); // WHATSUP_OUT: build elsewhere (checks)
// Dependency order.
const MODULES=['config.js','profile.mjs','core.mjs','silhouettes.mjs','routes.mjs','aircraft-types.mjs','live.mjs','models.mjs','photos.mjs','place.mjs','mapgen.mjs','model.mjs','kit.mjs','browse.mjs','app.mjs'];

// Rewrites `import {a,b} from './x.mjs'` (paths relative to `dir` inside web/) and
// `export const|function ...`. Returns the body plus the import lines and exported names.
function transform(file,src,dir){
  const imports=[];
  src=src.replace(/^import\s*\{([^}]*)\}\s*from\s*'(\.{1,2}\/[^'?]+)(?:\?[^']*)?';?\s*$/gm,(_,names,from)=>{
    const name=posix.normalize(posix.join(dir,from));
    if(!MODULES.includes(name))throw new Error(`${file}: unknown import ${from}`);
    imports.push(`const {${names.trim().replace(/\s+as\s+/g,':')}}=__modules[${JSON.stringify(name)}];`);return '';
  });
  if(/^\s*import\b/m.test(src))throw new Error(`${file}: unsupported import`);
  const exported=[];
  src=src.replace(/^export\s+((?:async\s+)?(?:const|let|function|class))\s+([A-Za-z_$][\w$]*)/gm,(_,kind,name)=>{
    exported.push(name);return `${kind} ${name}`;
  });
  // Re-exports of imported names: export {a,b};
  src=src.replace(/^export\s*\{([^}]*)\};?\s*$/gm,(_,names)=>{exported.push(...names.split(',').map(n=>n.trim()).filter(Boolean));return '';});
  return {src,imports,exported};
}

const parts=MODULES.map(file=>{
  const {src,imports,exported}=transform(file,readFileSync(join(web,file),'utf8'),'.');
  if(/^\s*export\b/m.test(src))throw new Error(`${file}: unsupported export`);
  return `// ---- ${file}\n__modules[${JSON.stringify(file)}]=(()=>{\n${imports.join('\n')}\n${src}\nreturn {${exported.join(',')}};\n})();`;
});

rmSync(out,{recursive:true,force:true});
mkdirSync(join(out,'layouts'),{recursive:true});
// Texts shown in the app (Settings > Privacy, About & credits), bundled into the script:
// the page is loaded from file:// and does not fetch its own files. Also copied as .txt.
const DOCS={privacy:'privacy.txt',licenses:'licenses.txt'},docs={};
for(const [k,f] of Object.entries(DOCS))try{docs[k]=readFileSync(k==='licenses'&&process.env.WHATSUP_LICENSES||join(web,f),'utf8');}catch{docs[k]='';}
// WHATSUP_RELEASE=1 (npm run build:release): the developer URL hooks (?demo, ?q, ?screen...) are off.
const release=process.env.WHATSUP_RELEASE==='1';
// WHATSUP_PROFILE: personal (default) or store (web/profile.mjs).
const profileId=process.env.WHATSUP_PROFILE||'personal';
if(!['personal','store'].includes(profileId))throw new Error(`unknown WHATSUP_PROFILE ${profileId}`);
const {profileFor}=await import('../web/profile.mjs');
// Privacy: the store build shows the final policy (web/privacy-store.txt, kept byte for byte);
// the personal build its short text with this profile's services.
if(profileId==='store')docs.privacy=readFileSync(join(web,'privacy-store.txt'),'utf8');
else docs.privacy=docs.privacy.replace('{{SERVICES}}',profileFor(profileId).consent);

writeFileSync(join(out,'whatsup.js'),`'use strict';\nwindow.__whatsupProfile=${JSON.stringify(profileId)};\n${release?'window.__whatsupRelease=true;\n':''}window.__whatsupDocs=${JSON.stringify(docs)};\n(()=>{\nconst __modules={};\nwindow.__whatsupModules=__modules;\n${parts.join('\n')}\n})();\n`);

// Layouts: `export default {...}` must be the module's last statement.
const layouts=readdirSync(join(web,'layouts')).filter(f=>f.endsWith('.mjs'));
let layoutBytes=0;
for(const file of layouts){
  const id=file.replace(/\.mjs$/,'');
  const {src,imports,exported}=transform(`layouts/${file}`,readFileSync(join(web,'layouts',file),'utf8'),'layouts');
  if(exported.length)throw new Error(`layouts/${file}: only export default`);
  const [body,value,...rest]=src.split(/^export default\s+/m);
  if(value===undefined||rest.length)throw new Error(`layouts/${file}: needs one export default`);
  const js=`'use strict';\n(()=>{\nconst __modules=window.__whatsupModules;\n${imports.join('\n')}\n${body}\nwindow.__whatsupLayout(${JSON.stringify(id)},${value.trim().replace(/;$/,'')});\n})();\n`;
  writeFileSync(join(out,'layouts',`${id}.js`),js);
  layoutBytes+=js.length;
}

// Every layout stylesheet, including variants that reuse another layout's code (atlas-dark.css).
for(const file of readdirSync(join(web,'layouts')).filter(f=>f.endsWith('.css')))cpSync(join(web,'layouts',file),join(out,'layouts',file));
let html=readFileSync(join(web,'index.html'),'utf8')
  .replace('<script type="module" src="app.mjs"></script>','<script src="whatsup.js" defer></script>');
// A build whose profile turns a service off can't reach it (Content-Security-Policy).
{
  const P=profileFor(profileId);
  if(!P.eox)html=html.replace(' https://tiles.maps.eox.at','');
  if(!P.photos)html=html.replace(' https://cdn.planespotters.net https://*.plnspttrs.net','');
}
if(!html.includes('whatsup.js'))throw new Error('index.html: script tag not found');
writeFileSync(join(out,'index.html'),html);
// media/keep-awake.mp4: the silent loop the app plays to hold off the screensaver (Settings > Keep screen awake).
for(const item of ['whatsup.css','mvt.js','qr.js','fonts','media','models'])cpSync(join(web,item),join(out,item),{recursive:true});
for(const [k,f] of Object.entries(DOCS))if(docs[k])writeFileSync(join(out,f),docs[k]);
// App icon for manifest.toml (@image/whatsup_icon.png): the 1280x720 launcher tile (icon/src/tile.svg).
mkdirSync(join(out,'image'),{recursive:true});cpSync(join(root,'icon','whatsup_icon.png'),join(out,'image','whatsup_icon.png'));
console.log(`assets/ written, ${profileId} profile${release?' (release: no URL hooks)':''} (${MODULES.length} modules, ${layouts.length} layout scripts, ${Math.round(layoutBytes/1024)} KB layout code)`);
