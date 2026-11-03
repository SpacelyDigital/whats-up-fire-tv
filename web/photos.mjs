// Aircraft pictures for the hero card, best first:
// 1. a photo of that exact aircraft from Planespotters.net (by hex, else registration),
// 2. a bundled photo of the model (assets/models/, from Wikimedia Commons, models.mjs),
// 3. the drawn silhouette (silhouettes.mjs).
// Planespotters' API terms: credit the photographer next to the photo ("Photo © name /
// Planespotters.net"; no photographer, no photo); link back with an on-screen QR code
// carrying the API's link URL unchanged (no clickable surface on a TV); show the thumbnail
// whole; fetch the image straight from their URL on this device, keep it only while shown,
// never store it; JSON cached at most 24 h; identify with a User-Agent (the app bridge
// sends one, no Origin or Referer is set). Lookups: only for the aircraft on screen (one picked
// with Left/Right once it has stayed on the card about a second, browse.mjs), at most
// one every 1.5 s; "no photo" kept 24 h, failures 5 min; a 429 waits out Retry-After, a 403
// stops lookups for 6 h (kept across restarts). Store profile: no lookups at all.
import {getJson,store} from './live.mjs';
import {modelPhoto} from './models.mjs';
import {PROFILE} from './profile.mjs';
export {modelPhoto};

export const PHOTO_URL=(kind,id)=>`https://api.planespotters.net/pub/photos/${kind}/${id}`;
const IMG=/^https:\/\/(cdn\.planespotters\.net|[a-z0-9-]+\.plnspttrs\.net)\/[^\s"'<>]+\.(jpe?g|png|webp)$/i;
const LINK=/^https:\/\/www\.planespotters\.net\/photo\/[^\s"'<>]{1,200}$/; // length-capped: it becomes a QR code
const cache=new Map(),DAY=86400000,PAUSE_KEY='whatsup.photos.pause',GAP_MS=1500;

// A photo record {src,width,height,link,photographer} from an API reply, or null.
export function parsePhoto(payload){
  const p=Array.isArray(payload?.photos)?payload.photos[0]:null;
  const t=p?.thumbnail_large?.src?p.thumbnail_large:p?.thumbnail;
  if(!t||!IMG.test(String(t.src))||!LINK.test(String(p.link)))return null;
  const photographer=typeof p.photographer==='string'?p.photographer.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,'').trim().slice(0,60):'';
  if(!photographer)return null; // the credit is required: no name, no photo
  return {src:t.src,width:Number(t.size?.width)||0,height:Number(t.size?.height)||0,link:p.link,photographer};
}

// One lookup at a time, GAP_MS apart; null while paused.
let chain=Promise.resolve(),last=0;
const pausedUntil=()=>Math.max(Number(store.get(PAUSE_KEY)?.until)||0,0);
function lookup(url){
  const run=chain.then(async()=>{
    if(Date.now()<pausedUntil())return {status:'paused'};
    const wait=last+GAP_MS-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
    last=Date.now();
    const r=await getJson(url,3000);
    if(r.status===403)store.set(PAUSE_KEY,{until:Date.now()+6*3600000});
    if(r.status===429)store.set(PAUSE_KEY,{until:Date.now()+1000*Math.max(60,Math.min(3600,Number(r.retryAfter)||60))});
    return r;
  });
  chain=run.catch(()=>{});
  return run;
}

// While Left/Right browse the planes, the app's gate holds a lookup (and a cached photo's
// image) until the plane has stayed on the card, and answers false for one passed over:
// nothing is sent or cached for it.
let gate=()=>Promise.resolve(true);
export const setPhotoGate=fn=>{gate=fn;};

// Resolves the photo for an aircraft, or null (none, paused, failure, passed over, or slower than 3 s).
export function photoFor(a){
  if(!PROFILE.photos)return Promise.resolve(null);
  const hex=String(a?.hex||'').toLowerCase();
  if(!/^[0-9a-f]{6}$/.test(hex))return Promise.resolve(null);
  return gate(hex).then(ok=>ok?lookupPhoto(a,hex):null);
}
function lookupPhoto(a,hex){
  const hit=cache.get(hex);
  if(hit&&Date.now()<hit.until)return hit.promise;
  const reg=String(a.registration||'').toUpperCase().replace(/[^A-Z0-9-]/g,'');
  const entry={until:Date.now()+DAY};
  entry.promise=(async()=>{
    let {status,payload}=await lookup(PHOTO_URL('hex',hex));
    let photo=status===200?parsePhoto(payload):null;
    if(!photo&&status===200&&reg.length>=2){({status,payload}=await lookup(PHOTO_URL('reg',reg)));photo=status===200?parsePhoto(payload):null;}
    if(status!==200&&status!==404)entry.until=Date.now()+300000; // a failure is asked again in 5 min
    return photo;
  })().catch(()=>{entry.until=0;return null;});
  cache.set(hex,entry);
  if(cache.size>300)cache.delete(cache.keys().next().value);
  return entry.promise;
}

// QR code (PNG data URL) for a photo's link, drawn by the bundled encoder (qr.js) in the
// theme's colours: the darker of {ink, panel} for the modules, the lighter for the
// background (scanners want dark-on-light), with a 2-module light quiet zone (enough for phone scanners against a plain panel; more
// would only shrink the modules); see qrColours.
const rgb=c=>{const m=/^#([0-9a-f]{6})$/i.exec(c.trim())||null,r=/rgba?\(([^)]+)\)/.exec(c);
  if(m)return [0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16));
  if(r){const [a,b,d,al=1]=r[1].split(',').map(Number);return [a*al,b*al,d*al];}return null;};
const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
export function qrColours(ink,bg){
  const a=rgb(ink||''),b=rgb(bg||'');
  if(!a||!b)return {dark:'#000',light:'#fff'};
  let [dk,lt]=lum(a)<lum(b)?[a,b]:[b,a];
  // Keep the hues but push them apart (dark toward black, light toward white) until the
  // contrast is near print-like (14:1; black on white is 21:1), which phone cameras need at
  // a distance and through blur.
  for(let t=0;t<=1&&(lum(lt)+.05)/(lum(dk)+.05)<14;t+=.05){
    dk=(lum(a)<lum(b)?a:b).map(v=>v*(1-t));lt=(lum(a)<lum(b)?b:a).map(v=>v+(255-v)*t);
  }
  return {dark:`rgb(${dk.map(Math.round)})`,light:`rgb(${lt.map(Math.round)})`};
}
export function qrFor(link,{dark='#000',light='#fff'}={}){
  const QR=globalThis.window?.WhatsUpQR;if(!QR)return '';
  try{
    const q=QR(0,'L');q.addData(link);q.make(); // L: fewest modules, so each is biggest on screen (a TV shows no damage to correct)
    const n=q.getModuleCount(),k=4,pad=2,c=document.createElement('canvas');c.width=c.height=(n+2*pad)*k;
    const g=c.getContext('2d');g.fillStyle=light;g.fillRect(0,0,c.width,c.height);g.fillStyle=dark;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(q.isDark(y,x))g.fillRect((x+pad)*k,(y+pad)*k,k,k);
    return c.toDataURL('image/png');
  }catch{return '';}
}
