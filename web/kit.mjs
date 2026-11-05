// Shared toolkit for layouts (web/layouts/<id>.mjs + <id>.css). The app owns the
// data (feed model, settings, maps); a layout only draws it. Each layout module ends
// with `export default {...}`:
//   name   'Glass'                      shown in Settings
//   map    'base' | 'detail'            detail = streets, landuse, buildings (built on demand)
//   mount(root,ctx)                     build DOM into root (the 960x540 stage)
//   setMap(maps)                        {base,detail}; either may be null until built
//   render(m)                           every model tick (1 s demo, 5 s live)
//   refresh()                           units or alert radius changed
//   refreshZone()                       optional: alert zone changed (default: refresh)
//   unmount()                           stop timers; the app empties root afterwards
// ctx: {settings(), place(), demo, needs(kind)}. The model m: {now, live, fresh,
// connecting, planes[], hero, recent[], log}. Planes carry hex, flight, callsign,
// registration, aircraft_type, type (name), operator, cargo (brand), latitude,
// longitude, altitude_ft, speed_kt, heading, vertical (fpm), squawk, emergency,
// route {origin,destination,from,to}, progress {flown,left,share}, x/y (miles east/
// north of home), ground (miles), bearing, elevation (deg up), cpa {seconds,miles,
// receding}, inside (within the alert radius), trend {alt,speed,trail[]}, year;
// hero also has status ('Above you now', 'Approaching', 'Nearest', 'Emergency'); while Left/Right
// browse the planes the hero is the chosen plane, with status 'Plane 3 of 9' and browse
// {index, count} (headingAlts words the card's heading).
import {PROFILE} from './profile.mjs';
import {number,zoneOutline,snapped,GRID_PAD_MI,dLon} from './core.mjs';
export {snapped,GRID_PAD_MI};
import {SILHOUETTES,silhouetteFamily} from './silhouettes.mjs';
import {photoFor,qrFor,qrColours,modelPhoto} from './photos.mjs';
export {photoFor,qrFor,modelPhoto};
// QR in the active layout's colours (--ui-ink / --ui-bg on the stage).
export function themedQr(link){
  const st=document.getElementById('stage'),cs=st&&getComputedStyle(st);
  return qrFor(link,qrColours(cs?.getPropertyValue('--ui-ink'),cs?.getPropertyValue('--ui-bg')));
}
// The aircraft picture block shared by the non-Atlas layouts: photo of this aircraft
// (Planespotters, credit + QR, per their terms) -> bundled model photo -> nothing (the
// layout keeps its own text). Styled per layout via .ph / .ph-img / .ph-qr / .ph-cap.
// A model photo's author, shortened for a tight caption: an agency credit keeps the
// agency ("U.S. Air Force photo"), a person becomes "J. Herzog".
// A Planespotters credit, longest first; every wording keeps the photographer and the site.
export const psCredit=name=>[...new Set([`Photo © ${name} / Planespotters.net`,`© ${name} / Planespotters.net`,
  `© ${shortAuthor(name)} / Planespotters.net`,`© ${shortAuthor(name)} / Planespotters`])];
// Only a person's name becomes "J. Herzog" (Hans-Jürgen Weber "H. Weber", Anne-Marie McDonald
// "A. McDonald"); usernames, studios and agencies ("BWard 1997", "Curimedia Photography",
// "Armada Argentina") stay as credited.
const ORG=/\b(Armada|Envoy|Photography|Aviat(?:ion|or)|Museum|Archives?|Navy|Army|Force|Ministry|Ministerstwo|Marina|Secretar[ií]a|Agency|Department)\b/i;
const personName=a=>{const w=a.split(/\s+/);return w.length>=2&&w.length<=3&&w.every(x=>/^(?:Mc|Mac|De|Di|La|Le)?\p{Lu}(?:\p{Ll}+|['’]\p{Lu}?\p{Ll}+)(?:['’-]\p{Lu}?\p{Ll}+)*$|^\p{Lu}\.$|^(van|von|de|da|di|der|den|le|la|du)$/u.test(x))&&!ORG.test(a);};
export const shortAuthor=a=>/^Author unknown$/.test(a)?a:/ photo( by |$)/.test(a)?a.replace(/ by .*$/,''):
  personName(a.replace(/,.*$/,''))?a.replace(/,.*$/,'').replace(/^(\S)\S*\s+(?=\S)/,'$1. '):a;
export function photoSlot(cls=''){
  const s=el('div',`ph ${cls}`);s.hidden=true;
  s.append(s._img=el('img','ph-img'),s._qr=el('img','ph-qr'),s._cap=el('div','ph-cap'));
  s._cap._whole=true; // attribution: wraps rather than losing words
  s._img.alt='';s._qr.alt='';return s;
}
// Alt text for an aircraft's photo, for screen readers: "Photo of a Boeing 737-800".
export const photoAlt=a=>{const t=a?.type||a?.aircraft_type||'aircraft';return `Photo of ${/^[aeiou]/i.test(t)?'an':'a'} ${t}`;};
// Show the picture for aircraft `a` in slot `s`; `relayout()` runs when it appears or goes.
export function showPhotoIn(s,a,relayout=()=>{}){
  const hex=a?.hex||'';
  if(s._hex===hex)return;
  s._hex=hex;s.hidden=true;s.classList.remove('model');s._img.removeAttribute('src');s._qr.removeAttribute('src');relayout();
  if(!hex)return;
  photoFor(a).then(p=>{
    if(s._hex!==hex||!s.isConnected)return;
    const qr=p&&themedQr(p.link);
    // A Planespotters image that fails to load: the bundled model photo instead (or none).
    s._img.onerror=()=>{if(s._hex!==hex||s.classList.contains('model'))return;const m=modelPhoto(a);
      if(!m){s.hidden=true;relayout();return;}
      s.classList.add('model');s._qr.removeAttribute('src');s._img.src=m.src;s._img.alt=`Typical ${m.model}`;
      s._cap._alts=[`Typical ${m.model} · ${m.author} · ${m.license}`,`${m.author} · ${m.license}`,`${shortAuthor(m.author)} · ${m.license}`];fitLine(s._cap);};
    if(p&&qr){s._img.src=p.src;s._qr.src=qr;s._img.alt=photoAlt(a);s._qr.alt='QR code for this photo on Planespotters.net';s._cap._alts=psCredit(p.photographer);}
    else{
      const m=modelPhoto(a);if(!m)return;
      const short=shortAuthor(m.author);
      s.classList.add('model');s._img.src=m.src;s._img.alt=`Typical ${m.model}`;s._qr.alt='';
      s._cap._alts=[`Typical ${m.model} · ${m.author} · ${m.license}`,`Model photo · ${m.author} · ${m.license}`,`${m.author} · ${m.license}`,`${short} · ${m.license}`];
    }
    s._cap.textContent=s._cap._alts[0];s.hidden=false;
    const fit=()=>{if(s._hex===hex&&s.isConnected){fitLine(s._cap);relayout();}}; // not after a layout switch (seed 211)
    s._img.onload=fit; // the photo's width decides the room left for the credit
    requestAnimationFrame(fit);
  });
}
import {MAP_ATTRIBUTION} from './mapgen.mjs';
import {placeLabel} from './place.mjs';
import {tz,compass,offset} from './model.mjs';

export {number,compass,offset,placeLabel,MAP_ATTRIBUTION};
export const DATA_ATTRIBUTION=`${PROFILE.feed==='adsb.fi'?'Aircraft: adsb.fi':'Positions: adsb.lol (ODbL)'} · Routes: ADSB.lol`;
// Map radius in miles (Settings > Map radius). Layouts are drawn for a 10-mile view
// (BASE_RANGE); paintMap and toView scale every view by zoom() = 10 / map radius, so
// fixed pixel sizes in a layout stay put while distances shrink or grow.
export const BASE_RANGE=10;
export const range=()=>S.mapMiles||BASE_RANGE;
export const zoom=()=>BASE_RANGE/range();

const NS='http://www.w3.org/2000/svg';
export const svg=(tag,attrs={},text)=>{
  const el=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs))if(v!==undefined&&v!==null)el.setAttribute(k,v);
  if(text!==undefined)el.textContent=text;return el;
};
export const el=(tag,cls,text)=>{
  const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;
};
export const setText=(e,v,alts)=>{
  v=v??'';if(!e)return;
  // Fitted again when the wording changes, or when its room shrank (a neighbour, e.g. the clock, filled in).
  if(e._fit){const all=alts?.length?alts:[String(v)],key=all.join('\u0001');if(e._key!==key||e.scrollWidth>e.clientWidth+1){e._key=key;e._alts=all;fitLine(e);}return;}
  if(!v&&alts?.length)v=alts[0]; // not a fitted slot: the first wording
  if(e.textContent!==String(v))e.textContent=v;
};
// Marks one-line text slots: setText then fits them (fitLine: the first wording in `alts`
// that fits, shrunk if need be), so a long name never runs out of its box or ends in "…".
const fitted=new Set();
export const fit=(...es)=>{for(const e of es.flat())if(e){e._fit=true;fitted.add(e);}};
// The old layout's slots go with it (a switch among the Atlas layouts loads no font: no 'loadingdone').
export const pruneFitted=()=>{for(const e of fitted)if(!e.isConnected)fitted.delete(e);};
// Web fonts arrive after the first fit (wider than the fallback): fit them all again then.
globalThis.document?.fonts?.addEventListener?.('loadingdone',()=>{
  for(const e of fitted){if(!e.isConnected){fitted.delete(e);continue;}if(e._alts)fitLine(e);}
});
// Shorter wordings for common long values, longest first.
export const placeAlts=()=>[...new Set([placeName(),cityName()].filter(Boolean))];
export const airlineAlts=(name,cut=true)=>{
  const s=String(name||''),corp=s.replace(/[\s,]+(S\.?A\.?( de C\.?V\.?)?|LLC|Inc\.?|Co\.?|Corp\.?|AG|GmbH|Ltd\.?|plc|SpA|NV|BV)$/i,'').trim();
  const short=corp.replace(/\s+(Air ?Lines|Airlines|Airways|Aviation|International|Express|Cargo|Services|Transportes?|Aerotransportes)\b/gi,'').trim();
  return [...new Set([s,corp,short,cut&&short.split(/\s+/)[0]].filter(Boolean))];
};
// A Departures cell of n flaps: a city too long for it gives its airport code (SFO, never "SAN" or
// "INDIANAPOLI"); an operator its short name, else the callsign's airline code (ANZ, not "AIR NEW").
export const boardCity=(name,code,n)=>{const s=String(name||'').toUpperCase().trim();return s&&s.length<=n?s:String(code||'').toUpperCase();};
export const boardOperator=(name,call,n)=>airlineAlts(name,false).map(s=>s.toUpperCase()).find(s=>s.length<=n)||String(call||'').slice(0,3).toUpperCase();
export const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
// First spot (dx,dy offsets from p) where a w x h box fits inside bounds without hitting boxes.
export function placeBox(boxes,p,w,h,spots,bounds){
  for(const [dx,dy] of spots){
    const b={x:p.x+dx,y:p.y+dy,w,h};
    if(bounds&&(b.x<bounds.x||b.y<bounds.y||b.x+w>bounds.x+bounds.w||b.y+h>bounds.y+bounds.h))continue;
    if(!boxes.some(o=>overlap(o,b))){boxes.push(b);return b;}
  }
  return null;
}

// --- Units (Settings: distance mi/km, altitude ft/m).
let S={distance:'mi',altitude:'ft'};
export const useSettings=s=>{S=s;};
export const KM=1.609344;
export const metric=()=>S.distance==='km';
export const fmt={
  int:v=>number(v)?(Math.round(v)||0).toLocaleString('en-US'):'—', // ||0: never "-0"
  dist:(mi,d=1)=>!number(mi)?'—':S.distance==='km'?`${(mi*KM).toFixed(d)} km`:`${mi.toFixed(d)} mi`,
  far:mi=>!number(mi)?'—':S.distance==='km'?`${fmt.int(mi*KM)} km`:`${fmt.int(mi)} mi`,
  alt:ft=>!number(ft)?'—':S.altitude==='m'?`${fmt.int(ft*.3048)} m`:ft>=18000?`FL${Math.round(ft/100)}`:`${fmt.int(ft)} ft`,
  altNum:ft=>!number(ft)?'—':S.altitude==='m'?fmt.int(ft*.3048):fmt.int(ft),
  altUnit:()=>S.altitude==='m'?'m':'ft',
  speed:kt=>!number(kt)?'—':S.distance==='km'?`${fmt.int(kt*1.852)} km/h`:`${fmt.int(kt)} kt`,
  speedNum:kt=>!number(kt)?'—':S.distance==='km'?fmt.int(kt*1.852):fmt.int(kt),
  speedUnit:()=>S.distance==='km'?'km/h':'kt',
  distUnit:()=>S.distance==='km'?'km':'mi',
  // Hundreds of feet for tags ("045"), never negative ("0-1" below sea level).
  hundreds:ft=>String(Math.max(0,Math.round((ft||0)/100))).padStart(3,'0'),
  vs:fpm=>!number(fpm)?'—':Math.abs(fpm)<100?'level':S.altitude==='m'?`${fpm>0?'↑':'↓'}${(Math.abs(fpm)*.00508).toFixed(1)} m/s`:
    `${fpm>0?'↑':'↓'}${fmt.int(Math.abs(Math.round(fpm/50)*50))}`,
  mmss:s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`,
  ago:(stamp,now)=>{const m=Math.max(0,Math.floor((now/1000-stamp)/60));return m<1?'now':m<60?`${m}m`:`${Math.floor(m/60)}h`;},
  clock:(now,opts={})=>{try{return new Date(now).toLocaleTimeString(S.place?.countryCode==='US'?'en-US':'en-GB',{hour:'numeric',minute:'2-digit',timeZone:tz(),...opts});}catch{return '';}},
  date:(now,opts={weekday:'long',day:'numeric',month:'long'})=>{try{return new Date(now).toLocaleDateString('en-GB',{timeZone:tz(),...opts});}catch{return '';}},
};
export const placeName=()=>placeLabel(S.place)||'';
export const cityName=()=>S.place?.name||'';
export const alertRadius=()=>Math.min(S.radiusMiles||3,range());
// Settings > Alert zone: the circle (Alert radius) or the Window view wedge. Like the circle,
// the wedge stops at the map's edge, so a plane in the zone is always one you can see.
export const alertZone=()=>S.alertZone==='window'?{kind:'window',from:S.viewFrom,to:S.viewTo,miles:Math.min(S.viewMiles||25,range())}:{kind:'circle',radius:alertRadius()};
export const windowView=()=>S.alertZone==='window';
// SVG path of the alert zone; at(x,y) maps miles east/north of home to screen {x,y}.
export const zonePath=at=>'M'+zoneOutline(alertZone()).map(([x,y])=>{const p=at(x,y);return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;}).join('L')+'Z';
export const routeText=(r,sep=' → ')=>r?`${r.origin}${sep}${r.destination}`:'';
// The card's heading. While Left/Right browse the planes (browse.mjs) it gives the plane's place
// in the list and where it is, "Plane 3 of 9 · 4.2 mi NE", with shorter wordings for a tight
// line that all keep the number; otherwise `line`, the layout's own heading.
export function headingAlts(hero,line){
  const b=hero?.browse;if(!b)return [line];
  const d=fmt.dist(hero.ground),at=`${d} ${compass(hero.bearing)}`;
  return [`Plane ${b.index} of ${b.count} · ${at}`,`${b.index} of ${b.count} · ${at}`,`${b.index}/${b.count} · ${at}`,`${b.index}/${b.count} · ${d}`];
}
export const routeCities=r=>r?[r.from?.city||r.origin,r.to?.city||r.destination]:null;
// "Live" / "Preview" / "Connecting…" / "No signal", and what to say when nothing is near.
export const statusText=(m,demo)=>demo?'Preview':m.connecting?'Connecting':m.fresh?'Live':'No signal';
const fmtWait=s=>s<90?`${s} s`:`${Math.round(s/60)} min`;
export const quietText=(m,demo)=>!demo&&!m.fresh?(m.connecting?'Connecting to the live feed':m.retryIn>=5?`No live data right now. Reconnecting in ${fmtWait(m.retryIn)}.`:'No live data right now. Reconnecting.'):
  m.noCoverage?'No receiver coverage here. The aircraft feed has no receivers near this location.':
  'Quiet skies. Nothing within range right now.';

// --- Aircraft. Top-down silhouettes, nose up, in a 64-unit box.
export const PLANE='M0-29C3-29 4-23 4-17L4-5 26 9 26 13 4 6 3 22 11 28 11 31 0 27-11 31-11 28-3 22-4 6-26 13-26 9-4-5-4-17C-4-23-3-29 0-29Z';
export const HELI='M0-15C4.6-15 5.6-9 5.6-4 5.6 2 3 5 1.2 6L1 20 5.5 20.6 5.5 22.4 1 23 .8 27-.8 27-1 23-5.5 22.4-5.5 20.6-1 20-1.2 6C-3 5-5.6 2-5.6-4-5.6-9-4.6-15 0-15Z';
export const SINGLE='M0-24C2-24 2.6-21 2.6-17L2.6-12 26-11.2 26-6.4 2.6-5.6 1.8 17 8.5 19 8.5 22 0 21.4-8.5 22-8.5 19-1.8 17-2.6-5.6-26-6.4-26-11.2-2.6-12-2.6-17C-2.6-21-2-24 0-24Z';
export const isHeli=a=>/^(EC|AS3|AS5|B4|R44|R22|H[0-9]|S76|A1[0-4]9|B06|B407|B429|H60)/.test(a.aircraft_type||'')||a.category==='A7';
export const isLight=a=>/^(C1[5-8]|C2[01]|PA|SR2|BE[23]|P28|DA4|PC12|C206|C210)/.test(a.aircraft_type||'')||a.category==='A1';
export const shapeFor=a=>isHeli(a)?HELI:isLight(a)?SINGLE:PLANE;
export function planeIcon(a,p,size,cls,shape=shapeFor(a)){
  const g=svg('g',{class:cls,'data-hex':a.hex,transform:`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${a.heading||0}) scale(${size/64})`});
  g.append(svg('path',{d:shape}));return g;
}
// Small side-profile picture of the aircraft family (silhouettes.mjs), coloured by CSS.
export function silhouette(a,cls='sil'){
  const family=silhouetteFamily(a),e=svg('svg',{class:`${cls} ${family}`,viewBox:'0 0 120 40','aria-hidden':'true'});
  e.append(svg('path',{d:SILHOUETTES[family],'fill-rule':'nonzero'}));e.dataset.family=family;return e;
}
// One wording rewritten wherever it shows under `root`, as written or in capitals, a one-line slot
// fitted again; nothing else is drawn. The outage line counts down this way between polls (app.mjs).
export function swapText(root,was,now){
  if(!root||was===now)return;
  const W=was.toUpperCase(),has=s=>String(s).includes(was)||String(s).includes(W),swap=s=>String(s).split(was).join(now).split(W).join(now.toUpperCase());
  for(const e of root.querySelectorAll('*'))if(e._alts?.some(has)){e._alts=e._alts.map(swap);if(e._key)e._key=e._alts.join('\u0001');fitLine(e);}
  const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let t=walk.nextNode();t;t=walk.nextNode())if(!t.parentNode?._alts&&has(t.data))t.data=swap(t.data);
}
// One line, never cut: try each wording (e._alts, longest first) shrinking the type down
// to 11 px; if none fits, the shortest one goes down to 9 px. A notice (e._firm) takes a
// shorter wording before it shrinks.
// Wider than its box: scrollWidth rounds, so the text's own measured width decides too
// (a 1.5 px overrun cut the last digit).
const over=e=>{if(e.scrollWidth>e.clientWidth)return true;const r=document.createRange();r.selectNodeContents(e);
  const cs=getComputedStyle(e),inner=e.getBoundingClientRect().width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-parseFloat(cs.borderLeftWidth)-parseFloat(cs.borderRightWidth);
  return r.getBoundingClientRect().width>inner+.5;};
export function fitLine(e){
  const alts=e._alts||[e.textContent];
  // Not laid out (hidden): show the full wording and fit again at the next setText.
  if(!e.isConnected||!e.getClientRects().length){e.textContent=alts[0];e.style.fontSize='';e._key=null;return;}
  e.style.whiteSpace='';e.style.overflowWrap='';
  for(let i=0;i<alts.length;i++){
    const floor=i===alts.length-1?9:e._firm?Infinity:11;
    e.textContent=alts[i];e.style.fontSize='';
    let size=parseFloat(getComputedStyle(e).fontSize);
    while(over(e)&&size>floor){size-=.5;e.style.fontSize=`${size}px`;}
    if(!over(e))return;
  }
  // Text that must stay whole (a photo credit, e._whole) wraps onto another line instead.
  if(e._whole){e.style.whiteSpace='normal';e.style.overflowWrap='anywhere';return;}
  // Still too long at the smallest size (a 400-character name): drop whole words from the
  // end, never ending in "…" (or a dangling slash), so at least it isn't cut through a word.
  let t=e.textContent;
  while(over(e)&&/\s\S+\s*$/.test(t.trim())){t=t.trim().replace(/\s+\S+$/,'').replace(/[\s,·:;–\/-]+$/,'');e.textContent=t;}
  // One unbroken word longer than the row: it wraps rather than being cut.
  if(over(e)){e.style.whiteSpace='normal';e.style.overflowWrap='anywhere';}
}
// The planes worth labelling first: hero, then those inside the alert ring, then nearest.
export const byInterest=m=>[...new Set([m.hero,...m.planes.filter(a=>a.inside),...m.planes].filter(Boolean))];

// Longer trails than the model keeps (it keeps ~90 s): positions per aircraft for
// `maxAge` ms, at most one sample per `every` ms. Miles east/north of home.
export class TrailBook{
  constructor(maxAge=300000,every=5000){this.maxAge=maxAge;this.every=every;this.map=new Map();}
  update(planes,now){
    for(const a of planes){
      let l=this.map.get(a.hex);if(!l)this.map.set(a.hex,l=[]);
      if(!l.length||now-l[l.length-1].t>=this.every)l.push({x:a.x,y:a.y,t:now});
    }
    for(const [k,l] of this.map){
      while(l.length&&now-l[0].t>this.maxAge)l.shift();
      if(!l.length)this.map.delete(k);
    }
  }
  get(hex){return this.map.get(hex)||[];}
  clear(){this.map.clear();}
}

// --- Map painting on a canvas. The canvas is sized for the screen (the stage is
// scaled), painted once per map/layout, and shared paths keep it fast on the stick.
export const pixelRatio=()=>Math.min(2,Math.max(1,Math.min(innerWidth/960,innerHeight/540)*(devicePixelRatio||1)));
export function makeCanvas(w,h,cls){
  const c=el('canvas',cls),k=pixelRatio();
  c.width=Math.round(w*k);c.height=Math.round(h*k);c.style.width=`${w}px`;c.style.height=`${h}px`;
  c._k=k;c._w=w;c._h=h;return c;
}
// Where each map was built vs. home (they agree within ~1 km): miles to shift by.
export function mapShift(m,home=S.place){
  if(!m||!home)return [0,0];
  const cos=Math.cos(home.latitude*Math.PI/180);
  return [dLon(m.longitude,home.longitude)*69.172*cos,(m.latitude-home.latitude)*69];
}
// view: {cx,cy (home, in canvas CSS px), ppm (px per mile at the 10-mile view), clip?: {r} circle or
//   {x,y,w,h} rect, rotate?: deg (heading up), center?: place, fixed?: true = ignore the map radius}.
// ppmOf(view): the pixels per mile actually drawn.
export const ppmOf=view=>view.fixed?view.ppm:view.ppm*zoom();
// The round number (1, 2 or 5 x 10^n) nearest above ~.75x.
export function niceStep(raw){
  const p=10**Math.floor(Math.log10(raw));
  return [1,2,5,10].map(m=>m*p).find(v=>v>=raw*.75)||10*p;
}
// A round distance (1, 2, 5 x 10^n mi or km) near `target` px long at this view: {px, value, label}.
export function niceDistance(view,target=70){
  const unit=S.distance==='km'?1/KM:1,ppm=ppmOf(view)*unit,value=niceStep(target/ppm);
  const label=`${+value.toPrecision(3)} ${S.distance==='km'?'km':value===1?'mile':'miles'}`;
  return {px:value*ppm,value,label};
}
// spec: [{layer, from?:'base'|'detail', classes?:[...], not?:[...], fill?, stroke?, width?, dash?,
//   alpha?, glow?, glowColor?, cap?, join?, minPx?}] painted in order. Layers: base water, rivers,
//   roads (c), runways; detail water, waterways (c), roads (c), landuse (c), parks (c), aero (c),
//   buildings. A missing map or layer is skipped.
export function paintMap(canvas,maps,view,spec){
  const g=canvas.getContext('2d'),k=canvas._k||1;
  g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,canvas.width,canvas.height);
  g.setTransform(k,0,0,k,0,0);
  g.save();
  if(view.clip){g.beginPath();if(view.clip.r)g.arc(view.cx,view.cy,view.clip.r,0,Math.PI*2);else g.rect(view.clip.x,view.clip.y,view.clip.w,view.clip.h);g.clip();}
  const rot=(view.rotate||0)*Math.PI/180,cr=Math.cos(rot),sr=Math.sin(rot);
  for(const s of spec){
    const from=s.from||(['landuse','parks','aero','buildings','waterways'].includes(s.layer)?'detail':'base');
    const m=maps?.[from];if(!m||!m[s.layer]?.length)continue;
    const [sx,sy]=mapShift(m,view.center),ppm=ppmOf(view),div=m.per||1000; // detail maps: points per mile
    const X=(x,y)=>{x+=sx;y+=sy;return view.cx+(x*cr-y*sr)*ppm;},Y=(x,y)=>{x+=sx;y+=sy;return view.cy-(x*sr+y*cr)*ppm;};
    g.beginPath();
    for(const f of m[s.layer]){
      if(s.classes&&!s.classes.includes(f.c))continue;
      if(s.not&&s.not.includes(f.c))continue;
      const pts=f.p||f.r||f,closed=!!f.r||s.layer==='water'&&from==='base';
      if(ArrayBuffer.isView(pts)){
        for(let i=0;i<pts.length;i+=2){const x=pts[i]/div,y=pts[i+1]/div;i?g.lineTo(X(x,y),Y(x,y)):g.moveTo(X(x,y),Y(x,y));}
      }else{
        for(let i=0;i<pts.length;i++){const [x,y]=pts[i];i?g.lineTo(X(x,y),Y(x,y)):g.moveTo(X(x,y),Y(x,y));}
      }
      if(closed)g.closePath();
    }
    g.globalAlpha=s.alpha??1;
    g.shadowBlur=s.glow?s.glow*k:0;g.shadowColor=s.glowColor||s.stroke||s.fill||'transparent';
    // nonzero: neighbouring tiles' copies of a polygon overlap at the tile edges, and
    // evenodd would cut those strips out as a grid; holes (islands) wind the other way.
    if(s.fill){g.fillStyle=s.fill;g.fill('nonzero');}
    // Water is outlined along its shore only (mapgen's `shore`), not the tile-cut rings.
    if(s.stroke&&s.layer==='water'&&m.shore){
      g.beginPath();
      for(const f of m.shore){
        const pts=f.p||f;
        if(ArrayBuffer.isView(pts))for(let i=0;i<pts.length;i+=2){const x=pts[i]/div,y=pts[i+1]/div;i?g.lineTo(X(x,y),Y(x,y)):g.moveTo(X(x,y),Y(x,y));}
        else for(let i=0;i<pts.length;i++){const [x,y]=pts[i];i?g.lineTo(X(x,y),Y(x,y)):g.moveTo(X(x,y),Y(x,y));}
      }
    }
    // Side streets: thinner as the map zooms out (sized for ~36 px/mi, down to 65%), and on maps whose
    // side streets stop at `inner` miles they fade out over the last mile.
    const minor=s.layer==='roads'&&s.classes?.every(c=>c==='minor'||c==='service');
    let stroke=s.stroke;
    if(minor&&m.inner>0&&stroke){
      const ox=view.cx+(sx*cr-sy*sr)*ppm,oy=view.cy-(sx*sr+sy*cr)*ppm,r=m.inner*ppm;
      const gr=g.createRadialGradient(ox,oy,0,ox,oy,r);gr.addColorStop(0,stroke);gr.addColorStop(Math.max(0,1-1/m.inner),stroke);gr.addColorStop(1,'rgba(0,0,0,0)');
      stroke=gr;
    }
    if(s.stroke){g.strokeStyle=stroke;g.lineWidth=(s.width||1)*(minor?Math.min(1,Math.max(.65,ppm/36)):1);g.setLineDash(s.dash||[]);g.lineCap=s.cap||'round';g.lineJoin=s.join||'round';g.stroke();}
  }
  g.restore();g.globalAlpha=1;g.shadowBlur=0;g.setLineDash([]);
}
// Screen position (CSS px) of a point in miles from home, for the same view.
export const toView=(view,x,y)=>{
  const rot=(view.rotate||0)*Math.PI/180,cr=Math.cos(rot),sr=Math.sin(rot),ppm=ppmOf(view);
  return {x:view.cx+(x*cr-y*sr)*ppm,y:view.cy-(x*sr+y*cr)*ppm};
};
// Map labels near home: [{name,x,y,kind}] in miles, nearest/most important first.
// `within` (and airportsNear's) is in miles at the 10-mile view; it grows with the map radius.
// Settings > Place names: which OpenStreetMap place classes are labelled on every map.
const PLACE_KINDS={off:[],cities:['city','town','village'],hoods:['suburb','quarter','neighbourhood'],
  both:['city','town','village','suburb','quarter','neighbourhood']};
export const placeKinds=()=>PLACE_KINDS[S.placeNames]||PLACE_KINDS.cities;
// Bigger places first (city, town, village, then neighbourhoods), so collisions drop the small ones.
const PLACE_ORDER={city:0,town:1,village:2,suburb:3,quarter:4,neighbourhood:5};
export function placesNear(maps,within,{max=12}={}){
  const range=within/zoom(),kinds=placeKinds();
  const src=maps?.detail?.places?.length?maps.detail:maps?.base;
  if(!src?.places)return [];
  const [sx,sy]=mapShift(src);
  return src.places.filter(p=>kinds.includes(p.c)).map(p=>({...p,x:p.x+sx,y:p.y+sy}))
    .filter(p=>Math.abs(p.x)<range&&Math.abs(p.y)<range)
    .sort((a,b)=>(PLACE_ORDER[a.c]??9)-(PLACE_ORDER[b.c]??9)||(a.rank||20)-(b.rank||20)).slice(0,max);
}
// Every airfield (big airports first, then coded fields, then the rest), with a short name:
// "Butler County Regional Airport" -> "Butler County".
export const shortField=name=>name.replace(/\s*\b(International |Regional |Municipal )?(Airport|Airfield|Airpark|Aerodrome|Ultralight ?port|Flightpark)\b.*$/i,'').trim()||name;
export function airfieldsNear(maps,within,max=60){
  const m=maps?.base,range=within/zoom();if(!m?.airfields)return [];
  const [sx,sy]=mapShift(m);
  return m.airfields.map(a=>({...a,x:a.x+sx,y:a.y+sy})).filter(a=>Math.abs(a.x)<range*1.5&&Math.abs(a.y)<range).slice(0,max);
}
export function airportsNear(maps,within,max=6){
  const m=maps?.base,range=within/zoom();if(!m?.airports)return [];
  const [sx,sy]=mapShift(m);
  return m.airports.map(a=>({...a,x:a.x+sx,y:a.y+sy})).filter(a=>Math.hypot(a.x,a.y)<range).slice(0,max);
}

// Both credits as one element; layouts style `.credits` themselves.
export function credits(cls='credits',{oneLine=false}={}){
  const e=el('div',cls);
  e.append(el('div','credit-data',DATA_ATTRIBUTION),el('div','credit-map',oneLine?`Map ${MAP_ATTRIBUTION}`:MAP_ATTRIBUTION));
  return e;
}

// Military today's sub-line, count first ("2 C-17 · 1 KC-135": "C-17 2" reads like C-172),
// most seen first; shorter wordings drop types. With none: "none yet".
export const militaryAlts=L=>{
  const t=L?.militaryTypes||[];if(!t.length)return ['none yet'];
  const w=n=>t.slice(0,n).map(([k,c])=>`${c} ${k}`).join(' · ');
  return [...new Set([w(4),w(3),w(2),w(1)])];
};
