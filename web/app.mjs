// The page. Owns the data (feed model, settings, maps) and the shared
// screens (Settings, location, Adjust position, layout picker); the chosen layout
// (web/layouts/<id>.mjs, loaded on demand, only one at a time) draws the dashboard.
// Remote: arrows move, Select chooses, Back closes, Select on the dashboard opens Settings;
// on the dashboard Up/Down change the map radius and Left/Right step through the planes.
import {CONFIG} from './config.js';
import {PROFILE} from './profile.mjs';
import {chimeGate,dLon} from './core.mjs';
import {HISTORY_KEY,MAX_NM,store,setRouteFocus} from './live.mjs';
import {start,demo,query,compass,resetLog,setLogRadius,flushLog,retryIn} from './model.mjs';
import {MAP_RADII,VIEW_MILES,alertFor,loadSettings,saveSettings,placeDamaged,locateByIp,searchPlaces,searchAddress,looksLikeAddress,looksLikeUSAddress,looksLikePostcode,placeLabel,refineZone} from './place.mjs';
import {buildMap,savedMap,saveMap,buildDetail,savedDetail,saveDetail,decodeDetail,detailSpec,detailFits,dropOldMaps,STALE} from './mapgen.mjs';
import {svg,useSettings,fmt,makeCanvas,paintMap,fitLine,themedQr,fit as fitText,quietText,swapText,pruneFitted,overflows} from './kit.mjs';
import {setPhotoGate} from './photos.mjs';
import {step as stepBrowse,apply as applyBrowse,held,LookupGate,IDLE_MS} from './browse.mjs';

const $=id=>document.getElementById(id);
const setText=(id,v)=>{const el=$(id);v=v??'';if(el&&el.textContent!==String(v))el.textContent=v;};
const stage=$('stage');
// The store build draws the stage at PROFILE.stageScale of the screen, centred, so no text
// reaches the outer 5% of any edge (overscan); the personal build fills the screen.
const fit=()=>{const s=Math.min(innerWidth/960,innerHeight/540)*PROFILE.stageScale;stage.style.transform=`translate(-50%,-50%) scale(${s})`;};
addEventListener('resize',fit);fit();
// The margin around an inset stage shows the layout's own background (its --edge colour where
// that background is a gradient; Adjust position's own background while it is open), shaded
// like the stage while screens with a shade are open over it. Checked after every draw (Swiss
// turns red for an emergency); body is only written when the colour changes.
const clear=c=>!c||c==='transparent'||/^rgba\(.*,\s*0\)$/.test(c);
let edgePainted='';
function paintEdge(){
  if(!(PROFILE.stageScale<1))return;
  const cs=getComputedStyle(stage),own=cs.getPropertyValue('--edge').trim(),bg=getComputedStyle($('layout')).backgroundColor;
  const edge=stage.classList.contains('adjusting')?cs.backgroundColor:own||(clear(bg)?cs.backgroundColor:bg);
  const shades=[...stage.querySelectorAll(':scope > .overlay:not([hidden])')].map(o=>getComputedStyle(o)).filter(c=>c.display!=='none').map(c=>c.backgroundColor).filter(c=>!clear(c));
  const v=[...shades.map(c=>`linear-gradient(${c},${c})`),edge].join(',');
  if(v!==edgePainted)document.body.style.background=edgePainted=v;
}

// --- Bridge to the Vega app: it handles the remote's Back button and asks us first.
const native=window.ReactNativeWebView;
const tellApp=msg=>{try{native?.postMessage(JSON.stringify(msg));}catch{/* desktop */}};
// Keep screen awake: the app plays a silent, invisible loop so the screensaver stays away.
const tellAwake=()=>tellApp({type:'awake',on:settings.keepAwake===true});

// Rarest/Farthest follow the map radius (Settings > Map radius, Up/Down).
setLogRadius(()=>settings.mapMiles||CONFIG.rangeMiles);
let settings=loadSettings(),feed=null,lastModel=null,placeToken=0,onScreen=true;
useSettings(settings);
const mapMiles=()=>settings.mapMiles||CONFIG.rangeMiles;
// The feed follows the map radius: adsb.fi (or adsb.lol) is asked for ~1.5x the radius (wide layouts
// show that far sideways), at most its 250 NM, and polled less often over big areas. One started while
// the app is hidden (a restart timer that fires after Home) starts paused.
const feedConfig=()=>{
  const r=mapMiles();
  const win=settings.alertZone==='window',view=alertFor(settings.viewMiles,r),reach=Math.max(r*1.5,win?view+3:0);
  return {...CONFIG,radiusMiles:alertFor(settings.radiusMiles,r),rangeMiles:r,
    zone:win?{kind:'window',from:settings.viewFrom,to:settings.viewTo,miles:view}:{kind:'circle',radius:alertFor(settings.radiusMiles,r)},
    searchNm:Math.min(MAX_NM,Math.max(CONFIG.searchNm,Math.ceil(reach/1.15078))),
    pollSeconds:Math.max(PROFILE.minPollSeconds||0,r<=25?CONFIG.pollSeconds:r<=100?10:15),paused:!onScreen};
};
const maps={base:null,detail:null};

// --- Credits: always in Settings; on the dashboard one line that fades out ~5 s after
// the app opens, the layout changes or a new location's map is drawn. It is always shown for
// the full 5 s with nothing over it: while a screen is open it waits, and a screen opened
// over it puts it back in the queue (syncApp).
let creditTimer=0,creditDue=false,credited=PROFILE.feed,sourceFlashAt=-Infinity;
const MAP_CREDIT='Map © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';
// The positions' source as shown: adsb.fi, or adsb.lol while it stands in (live.mjs). A change
// of source shows the line again (render), at most once every 10 minutes: a flaky adsb.fi
// switching back and forth mustn't keep covering the stats and photo credits (E14).
const feedSource=()=>lastModel?.source||PROFILE.feed,SOURCE_FLASH_MS=600000;
function flashCredits(){
  if(pick||layer||adj){creditDue=true;return;} // shown when the screen closes
  creditDue=false;credited=feedSource();
  // adsb.lol standing in gives both the aircraft and the routes: one item, one spelling.
  const data=credited===PROFILE.backup?[PROFILE.backupCreditFlash]:[`${PROFILE.creditFlash} · Routes ADSB.lol`,PROFILE.creditFlash];
  const c=$('credit-flash'),a=$('credit-a'),b=$('credit-b'),sat=active?.id==='atlas-satellite',us=['US','PR'].includes(settings.place?.countryCode);
  // Positions, routes and map credits on the first line (shorter wordings keep both map
  // credits); the satellite credit, exact, on a second line of its own. About has them all.
  const EOX='EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)';
  c.classList.add('on');
  a._alts=[...data.map(d=>`${d} · ${MAP_CREDIT}`),`${data.at(-1)} · © OpenMapTiles © OpenStreetMap contributors`];
  a.textContent=a._alts[0];fitLine(a);
  // US imagery: the credit the USGS imagery service asks for, word for word.
  const img=sat&&(us?'Imagery: USDA, USGS The National Map':PROFILE.eox?`Imagery: ${EOX}`:'');
  b._alts=img?[img,...(us?[]:[EOX])]:[''];
  b.textContent=b._alts[0];if(img)fitLine(b);
  clearTimeout(creditTimer);creditTimer=setTimeout(()=>c.classList.remove('on'),5000);
}

// --- Layouts. Order is the Settings order; the first is the default.
const LAYOUTS=[['atlas-dark','Atlas Dark'],['atlas','Atlas Light'],['atlas-satellite','Atlas Satellite'],
  ['radar','Radar'],['glass','Glass'],['departures','Departures'],['blueprint','Blueprint'],['swiss','Swiss'],['synthwave','Synthwave'],['sectional','Sectional'],['cockpit','Cockpit'],['night-sky','Night Sky']];
const layoutName=id=>(LAYOUTS.find(([k])=>k===id)||LAYOUTS[0])[1];
const validLayout=id=>LAYOUTS.some(([k])=>k===id)?id:LAYOUTS[0][0];
// A variant reuses another layout's code, with stylesheets layered on top in order
// (each also becomes an L-<id> class on the stage); ctx.layout() tells the code which.
const VARIANTS={'atlas-dark':['atlas','atlas-dark'],'atlas-satellite':['atlas','atlas-dark','atlas-satellite']};
const sheetsOf=id=>VARIANTS[id]||[id];
const codeOf=id=>sheetsOf(id)[0];
const bundled=!!window.__whatsupModules;
const registry={};
window.__whatsupLayout=(id,mod)=>{registry[id]=mod;};
function addCss(id,done){
  if(document.querySelector(`link[data-layout="${id}"]`))return done();
  const end=()=>{css._ended=true;done();},css=Object.assign(document.createElement('link'),{rel:'stylesheet',href:`layouts/${id}.css`,onload:end,onerror:end});
  css.dataset.layout=id;document.head.append(css);
}
function loadLayout(id){
  const code=codeOf(id);
  return new Promise((resolve,reject)=>{
    // The code as it landed: an abandoned preview's may be let go (unloadExcept) before its stylesheets end.
    const sheets=sheetsOf(id);let waiting=sheets.length+1,mod=registry[code];
    const done=()=>{if(--waiting)return;mod?resolve(mod):reject(new Error(`layout ${id} failed to load`));};
    for(const sheet of sheets)addCss(sheet,done);
    if(mod)done();
    else if(bundled){
      const s=Object.assign(document.createElement('script'),{src:`layouts/${code}.js`});
      s.onload=s.onerror=()=>{s.remove();mod=registry[code];done();};document.head.append(s);
    }else import(`./layouts/${code}.mjs`).then(m=>{mod=registry[code]=m.default;done();},e=>{console.error(e);done();});
  });
}
// Keep only the active layout's code and stylesheets (and those of the switch in flight) so only it
// costs memory. A stylesheet still loading stays until it ends (removed, it never would), and goes then.
function unloadExcept(id){
  const keep=new Set([...sheetsOf(id),...sheetsOf(wanted)]);
  for(const k of Object.keys(registry))if(!keep.has(k))delete registry[k];
  for(const l of document.querySelectorAll('link[data-layout]'))if(!keep.has(l.dataset.layout)&&l._ended)l.remove();
}

let active=null,layoutToken=0,wanted=null;
const root=$('layout');
const ctx={settings:()=>settings,place:()=>settings.place,layout:()=>active?.id,demo};
async function useLayout(id){
  id=validLayout(id);wanted=id;
  // Already showing it: still cancel any switch in flight (Back in the picker while a
  // preview loads must not let that preview land after the revert), and drop what it loaded.
  if(active?.id===id){++layoutToken;unloadExcept(id);if(!busyNow)$('busy').classList.remove('on');return;}
  const token=++layoutToken;
  $('busy').classList.add('on'); // a layout switch can take a moment on the stick
  const done=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{if(token===layoutToken&&!busyNow)$('busy').classList.remove('on');}));
  let mod;
  try{mod=await loadLayout(id);}catch(e){console.error(e.message);if(token===layoutToken&&!active&&id!==LAYOUTS[0][0])useLayout(LAYOUTS[0][0]);}
  if(token!==layoutToken)return unloadExcept(active?.id); // overtaken: what it loaded goes, unless the newer switch needs it
  if(!mod)return;
  const old=active;
  if(old){
    try{old.mod.unmount?.();}catch(e){console.error('unmount',e);}
    stage.classList.remove(...sheetsOf(old.id).map(s=>`L-${s}`));
  }
  unloadExcept(id);
  root.replaceChildren();pruneFitted();root.className='layout';
  stage.classList.add(...sheetsOf(id).map(s=>`L-${s}`));stage.dataset.layout=id;
  active={id,mod};
  if(mod.map!=='detail')maps.detail=null; // free it; it reloads from storage when needed
  try{
    mod.mount(root,ctx);
    mod.setMap?.({...maps});
    if(lastModel&&!adj)mod.render(shown(lastModel));
  }catch(e){console.error(`layout ${id}`,e);}
  paintEdge();
  if(mod.map==='detail'){ensureDetail();const n=detailNote();if(n)setText('layout-note',n);} // a street map still being drawn says so again
  else if(/street map|map detail/i.test($('layout-note').textContent))setText('layout-note',''); // not this layout's
  refitScreens(); // screens open over the switch now have this layout's fonts
  flashCredits();done();
}
function draw(m){
  if(!active||adj)return;
  m=shown(m);
  try{active.mod.render(m);}catch(e){console.error(`render ${active.id}`,e);}
  paintEdge();
  // A photo credit is fitted when its photo loads; when the card's other lines take room from
  // it later, it is fitted again here (fuzz seed 7008: cut by 3 px).
  for(const c of root.querySelectorAll('.ph-cap'))if(c.scrollWidth>c.clientWidth+1)fitLine(c);
  announce(m);
}
function mapsChanged(){
  try{active?.mod.setMap?.({...maps});}catch(e){console.error('setMap',e);}
}

// --- Detail map (streets, landuse, buildings) for the layouts that draw it.
// A build stops as soon as it's no longer wanted (another radius or place: detailToken);
// a failed one is tried again after 30 s, 60 s... up to 5 min, and an older saved map for
// this place and radius is shown meanwhile. Its notes give way to the base map's (baseNote).
let detailToken=0,detailBusy=false,detailTries=0,detailRetry=null,baseNote='';
// The street map's note while it is drawn, on the layouts that draw it.
const detailNote=()=>baseNote||(detailBusy&&active?.mod.map==='detail'?(mapMiles()<=15?'Drawing the street map':'Filling in map detail'):'');
async function ensureDetail(){
  const place=settings.place;
  if(!place||maps.detail&&!maps.detail.stale||detailBusy)return;
  const spec=detailSpec(mapMiles()),saved=savedDetail(place,spec);
  if(saved){maps.detail=decodeDetail(saved);detailTries=0;return mapsChanged();}
  if(!maps.detail){const old=savedDetail(place,spec,{stale:true});if(old){maps.detail={...decodeDetail(old),stale:true};mapsChanged();}}
  const token=++detailToken;detailBusy=true;clearTimeout(detailRetry);
  setText('layout-note',detailNote());
  try{
    const built=await buildDetail(place,{...spec,alive:()=>token===detailToken&&settings.place===place});
    if(token!==detailToken||settings.place!==place)return;
    saveDetail(built);detailTries=0;
    if(active?.mod.map==='detail'){maps.detail=decodeDetail(built);mapsChanged();}
    setText('layout-note',baseNote);
  }catch(e){
    if(e?.message===STALE)return;
    (e?.net?console.warn:console.error)('detail map',e?.message||e);
    if(token!==detailToken)return;
    if(active?.mod.map==='detail')setText('layout-note',baseNote||'Street map unavailable, trying again soon');
    const wait=Math.min(300000,30000*2**detailTries++);
    detailRetry=setTimeout(()=>{if(token===detailToken){setText('layout-note',baseNote);detailBusy=false;if(active?.mod.map==='detail')ensureDetail();}},wait);
  }finally{if(token===detailToken)detailBusy=false;}
}

// --- Place, map and feed
// Chime when the alert zone goes from empty to occupied (Settings > Chime); the app plays it.
// Its quiet minute is timed by performance.now(): a TV clock step can't stretch it.
const CHIME_VOLUME={low:.25,med:.55,high:1};
let chime=null;
function listen(m){
  const r=chimeGate(chime,m.planes.filter(a=>a.inside).length,performance.now(),m.live&&m.fresh);chime=r.state;
  if(r.ring&&settings.chime!=='off')tellApp({type:'chime',volume:CHIME_VOLUME[settings.chime]});
}
// Screen readers: one polite announcement when the plane on the card changes (or Left/Right
// browsing, or an emergency, starts or ends on it).
let spoken='';
function announce(m){
  if(layer||adj){spoken=null;return;} // not over a screen; the nearest plane is read again after
  const h=m.hero,key=h?h.hex+(h.emergency?'!':'')+(h.browse?'+':''):'';
  if(key===spoken)return;spoken=key;
  $('sr-live').textContent=h?[h.status,h.flight,h.type||h.aircraft_type,fmt.dist(h.ground)].filter(Boolean).join(', '):'';
}
// The outage line counts down between polls: once a second only its text is rewritten (the layout
// isn't drawn again), until it reads "Reconnecting." or the next model comes.
let waitTimer=0;
function countDown(){
  clearInterval(waitTimer);
  if(!lastModel.live||lastModel.fresh||!lastModel.retryAt||lastModel.retryIn<5)return;
  waitTimer=setInterval(()=>{
    const was=quietText(lastModel,false);lastModel={...lastModel,retryIn:retryIn(lastModel.retryAt)};
    swapText(root,was,quietText(lastModel,false));
    if(lastModel.retryIn<5)clearInterval(waitTimer);
  },1000);
}
// During an outage a model comes only with a poll, minutes apart: at each minute the feed runs its model
// again (model.mjs tick: the clock, the date, the day's tallies and the countdown move on together, drawn
// through render), not while hidden, and at once back on screen.
let clockTimer=0;
function keepTime(){
  clearTimeout(clockTimer);
  if(!onScreen||!lastModel?.live||lastModel.fresh)return;
  const t=Date.now();
  clockTimer=setTimeout(keepTime,60050-t%60000);
  if(Math.floor(lastModel.now/60000)!==Math.floor(t/60000))feed?.tick?.();
}
function render(m){
  lastModel=m;listen(m);draw(m);countDown();keepTime();
  if(m.source&&m.source!==credited&&performance.now()-sourceFlashAt>=SOURCE_FLASH_MS){sourceFlashAt=performance.now();flashCredits();}
}

// --- Left/Right on the dashboard step through the planes on the map, closest first; the chosen
// one takes the card (browse.mjs has the rules). Back, the plane leaving the map, a minute
// without Left or Right, or an emergency give the card back to the hero. Timed by performance.now(),
// which a TV clock step doesn't move (browse.mjs's LookupGate too).
let browse=null,browseTimer=0,browseFrame=0;
const gate=new LookupGate(),redraw=()=>{if(lastModel)draw(lastModel);};
// Its photo and route are looked up once it has stayed on the card about a second.
setPhotoGate(hex=>gate.wait(hex));
setRouteFocus(()=>held(browse,performance.now())?browse.hex:'');
// The model as drawn: while browsing, the chosen plane is the hero. The lookup gate learns which
// plane the card is about to show (a layout asks for its photo while drawing).
function shown(m){
  if(browse){
    const r=applyBrowse(browse,m,mapMiles(),performance.now());
    if(!r.state){browse=null;clearTimeout(browseTimer);queueMicrotask(syncApp);}
    m=r.m;
  }
  gate.update(m.hero?.hex||'',browse,performance.now());
  return m;
}
function stepPlanes(dir){
  const next=stepBrowse(browse,lastModel,mapMiles(),dir,performance.now());
  if(!next)return; // nothing on the map, or an emergency has the card
  const was=browse;browse=next;
  clearTimeout(browseTimer);browseTimer=setTimeout(redraw,IDLE_MS+50);
  if(!was)syncApp(); // Back now ends browsing instead of leaving the app
  cancelAnimationFrame(browseFrame);browseFrame=requestAnimationFrame(redraw); // a held key: one draw a frame
}
function endBrowse(){if(!browse)return;browse=null;clearTimeout(browseTimer);syncApp();redraw();}
// Restart only the aircraft feed (alert zone or alert radius changed): the maps stay as
// they are. Re-reading and re-decoding the saved maps blocked the stick for seconds.
// A restarted feed (here or in applyPlace) goes on from the old one's last picture (model.mjs).
function restartFeed(){
  if(!settings.place)return;
  const was=feed;feed?.stop();feed=null;chime=null;
  feed=start(settings.place,feedConfig(),render,maps.base?.airports,was);
}
async function applyPlace(place,{fresh=false}={}){
  const token=++placeToken,was=feed;chime=null;baseNote=''; // a new feed starts quiet; the map's note is this build's
  feed?.stop();feed=null;
  if(fresh){store.remove(HISTORY_KEY);resetLog();}
  const range=mapMiles();
  // Keep maps already in memory when they still fit this place and radius.
  const same=m=>m&&Math.abs(m.latitude-place.latitude)<.01&&Math.abs(dLon(m.longitude,place.longitude))<.01;
  const keepBase=same(maps.base)&&maps.base.range===range,keepDetail=same(maps.detail)&&detailFits(maps.detail,detailSpec(range));
  // No saved map for this radius yet: an older one, or the map already on screen (another
  // radius, same place: it's in miles, so it still draws), shows while the new one is built.
  if(!keepBase)maps.base=savedMap(place,range)||(()=>{const old=savedMap(place,range,{stale:true})||(same(maps.base)?maps.base:null);return old&&{...old,stale:true};})();
  if(!keepDetail){maps.detail=null;detailToken++;detailBusy=false;clearTimeout(detailRetry);detailTries=0;}
  if(!keepBase||!keepDetail)mapsChanged();
  if(active?.mod.map==='detail'&&!keepDetail)ensureDetail();
  const startFeed=()=>{if(token===placeToken&&!feed)feed=start(place,feedConfig(),render,maps.base?.airports,was);};
  if(!demo)startFeed();
  if(maps.base&&!maps.base.stale){startFeed();return;}
  if(maps.base)startFeed(); // an older saved map shows while a new one is built
  for(let attempt=0;token===placeToken;attempt++){
    try{
      const m=await buildMap(place,range,{alive:()=>token===placeToken});
      if(token!==placeToken)return;
      maps.base=m;saveMap(m);mapsChanged();baseNote='';setText('layout-note',detailNote());flashCredits();
      break;
    }catch(e){
      if(e?.message===STALE||token!==placeToken)return;
      (e?.net?console.warn:console.error)('map',e?.message||e);
      baseNote=attempt?'Map unavailable, retrying':'Map unavailable';setText('layout-note',baseNote);
      if(demo)startFeed();
      await new Promise(r=>setTimeout(r,Math.min(300000,30000*(attempt+1))));
    }
  }
  startFeed();
}

// A search result: show what matched before using it.
function confirmPlace(place){
  pending=place;
  // A picked address: its time zone now (only the picked one's rounded location goes out).
  if(place.tzGuess)refineZone(place).then(p=>{if(p&&pending===place)pending=p;}).catch(()=>{});
  setText('confirm-label','Use this location?');
  setText('confirm-main',place.street||placeLabel(place));
  setText('confirm-sub',place.street?placeLabel(place):[place.admin,place.country].filter(Boolean).join(', '));
  setText('confirm-note',place.source==='census'?'Matched by the US Census geocoder.':place.source==='nominatim'?'Matched by OpenStreetMap Nominatim.':
    'Centre of the area that matched. Use Adjust position to move the dot onto your home.');
  open('confirm','confirm-ok');
}
let pending=null;

// A new home more than 2 mi away starts today's logbook and 'Recently above' afresh;
// a closer one (Adjust position, a nearby address) keeps them, restarts the feed for the
// new point (and its time zone) and redraws the map around it.
// The saved place with its looked-up time zone: saved, the feed restarted, and a street map
// being drawn for the old object (it stops as stale) started again.
function adoptRefined(p){
  settings={...settings,place:p};saveSettings(settings);useSettings(settings);restartFeed();refreshLayout();
  if(detailBusy){detailToken++;detailBusy=false;ensureDetail();}
}
function choosePlace(place){
  // Chosen before its time zone came back: look it up once more for the saved place.
  if(place.tzGuess)refineZone(place).then(p=>{if(p&&settings.place===place)adoptRefined(p);}).catch(()=>{});
  const old=settings.place,cos=Math.cos(place.latitude*Math.PI/180);
  const miles=old?Math.hypot(dLon(place.longitude,old.longitude)*69.172*cos,(place.latitude-old.latitude)*69):Infinity; // the short way round, across the date line too
  settings={...settings,place,confirmed:true};saveSettings(settings);useSettings(settings);
  closeAll();
  if(miles>2)return applyPlace(place,{fresh:true});
  if(miles>.01)applyPlace(place);else restartFeed();
  mapsChanged();refreshLayout();
}
function refreshLayout(){try{active?.mod.refresh?.();}catch(e){console.error(e);}if(lastModel)draw(lastModel);}

// --- Focus and remote navigation
function labelRow(el){
  const name=el.querySelector?.(':scope > span'),value=el.querySelector?.(':scope > b');
  if(name&&el.classList.contains('row'))el.setAttribute('aria-label',[name.textContent,value?.textContent].filter(Boolean).join(', '));
}
// While a screen is open the dashboard behind it is hidden from screen readers.
const hideBehind=()=>{$('layout').setAttribute('aria-hidden',layer||adj?'true':'false');};
let layer=null,focused=null;
const layers=[];
// The .focus class draws the highlight; DOM focus (without scrolling) lets a screen reader
// (VoiceView) read the control. Settings rows read "name, value".
function setFocus(el){focused?.classList.remove('focus');const was=focused;focused=el||null;focused?.classList.add('focus');
  if(focused){labelRow(focused);try{focused.focus({preventScroll:true});}catch{/* not focusable */}}
  if(layer?.id==='settings'){fitValue(was);fitValue(focused);}}
// Settings values never end in "...": try each wording (b._alts, longest first), shrinking
// to 13 px; if the focused row's hint is what doesn't fit, drop the hint on that row.
function fitValue(row){
  const b=row?.querySelector?.('b');if(!b||!row.closest('#settings')||!b.clientWidth)return;
  const alts=b._alts||[b.textContent],fits=()=>!overflows(b);
  const attempt=()=>{for(const t of alts){b.textContent=t;b.style.fontSize='';let size=parseFloat(getComputedStyle(b).fontSize);
    while(!fits()&&size>13){size-=.5;b.style.fontSize=`${size}px`;}if(fits())return true;}return false;};
  row.classList.remove('nohint');b.classList.remove('wrap');
  if(!attempt()&&row.classList.contains('focus')){row.classList.add('nohint');attempt();}
  // Still too wide at the smallest size (a very long name, one unbroken word): it wraps onto
  // more lines rather than being cut.
  if(!fits())b.classList.add('wrap');
}
// Focus must always be on something visible in the top screen.
function keepFocus(fallback){
  if(!layer||(focused&&layer.contains(focused)&&focused.offsetParent))return;
  setFocus((fallback&&layer.contains(fallback)?fallback:null)||focusables()[0]);
}
const focusables=()=>layer?[...layer.querySelectorAll('[data-focus]')].filter(el=>el.offsetParent):[];
function open(id,first){
  if(layer){layer._last=focused;layers.push(layer);}
  layer=$(id);layer.hidden=false;
  if(id==='settings')refitSettings();
  // Stack order follows opening order, not page order: a later screen must cover an earlier one.
  layer.style.zIndex=String(10+layers.length);setFocus(first?$(first):focusables()[0]);syncApp();
}
function close(){
  if(!layer)return;
  if(layer.id==='locate'&&!settings.place)return; // nothing to go back to
  if(layer.id==='consent')return; // Back on it leaves the app (syncApp tells the app not to catch Back)
  if(layer.id==='picker')endPick(false);
  if(layer.id==='locate')stopSearch();
  layer.hidden=true;layer.style.zIndex='';layer=layers.pop()||null;
  if(layer){
    if(layer.id==='settings'){showSettings();refitSettings();} // the layout (and its font) may have changed
    {const last=layer._last;setFocus(last&&layer.contains(last)&&last.offsetParent?last:focusables()[0]);}
  }else{setFocus(null);if(lastModel)draw(lastModel);} // back on the dashboard: the card's plane is read now, not at the next poll
  syncApp();
}
// Settings values and the tip lines fit their rows in the active layout's font; again when
// a font arrives (a layout picked meanwhile brings its own).
function refitSettings(){
  const refit=()=>{if(layer?.id!=='settings')return;for(const r of layer.querySelectorAll('.row'))fitValue(r);showTipJar();};
  refit();document.fonts?.ready.then(refit);setTimeout(refit,700);
}
// Text fitted on a screen that stays open while the layout changes, or while its font arrives,
// is fitted again: Settings rows (also under the search screen), the search screen's source
// line, and the card's photo credit. Without this they stayed cut (fuzz seeds 7008, 7059).
function refitScreens(){
  if(!$('settings').hidden){for(const r of $('settings').querySelectorAll('.row'))fitValue(r);showTipJar();}
  if(!$('locate').hidden)fitLine($('search-src'));
  for(const c of root.querySelectorAll('.ph-cap'))if(c.scrollWidth>c.clientWidth+1)fitLine(c);
}
// A layout's font arriving changes text widths: fit the settings and the dashboard again.
document.fonts?.addEventListener?.('loadingdone',()=>{if(layer?.id==='settings')refitSettings();refitScreens();if(lastModel)draw(lastModel);});
function closeAll(){while(layer){if(layer.id==='picker')endPick(false);if(layer.id==='locate')stopSearch();layer.hidden=true;layer.style.zIndex='';layer=layers.pop()||null;}setFocus(null);syncApp();}
// The app swallows Back only while a screen is open (and there's somewhere to go).
function syncApp(){
  const c=$('credit-flash');
  if(layer||adj||pick){if(c.classList.contains('on')){c.classList.remove('on');clearTimeout(creditTimer);creditDue=true;}}
  else if(creditDue)flashCredits();
  hideBehind();paintEdge();tellApp({type:'ui',overlay:!!adj||(layer?!((layer.id==='locate'&&!settings.place||layer.id==='consent')&&!layers.length):!!browse)});}

function move(dir){
  const items=focusables();
  if(!focused||!items.includes(focused))return setFocus(items[0]);
  const a=focused.getBoundingClientRect(),ax=a.left+a.width/2,ay=a.top+a.height/2;
  let best=null,score=Infinity;
  // Left/Right moves between columns: a centred bottom button (Done) is only for Down.
  const sideways=dir==='left'||dir==='right';
  for(const el of items){
    if(el===focused||sideways&&el.classList.contains('done'))continue;
    const b=el.getBoundingClientRect(),bx=b.left+b.width/2,by=b.top+b.height/2,dx=bx-ax,dy=by-ay;
    const main={left:-dx,right:dx,up:-dy,down:dy}[dir],side=dir==='left'||dir==='right'?Math.abs(dy):Math.abs(dx);
    if(main<=4)continue;
    // One in line with it (the same row, or column) comes first, the nearest edge first: by centres alone the
    // wide keys (Clear, Search) went to a key a row up rather than the one beside them.
    const inLine=sideways?b.top<a.bottom&&b.bottom>a.top:b.left<a.right&&b.right>a.left;
    const s=inLine?Math.max(0,{left:a.left-b.right,right:b.left-a.right,up:a.top-b.bottom,down:b.top-a.bottom}[dir])+side/100:1e6+main+side*2.5;
    if(s<score){score=s;best=el;}
  }
  if(best)setFocus(best);
}

// Settings
const RADII=[1,2,3,4,5,6,7,8,9,10];
// Settings > the tip jar: a QR for Ko-fi in the active layout's colours (drawn on the device
// by the bundled encoder, redrawn when the layout changes).
const KOFI='https://ko-fi.com/spacelydigital';
let kofiFor='';
function showTipJar(){
  const cs=getComputedStyle(stage),key=cs.getPropertyValue('--ui-ink')+cs.getPropertyValue('--ui-bg');
  if(kofiFor!==key){const qr=themedQr(KOFI);if(qr){kofiFor=key;$('kofi-qr').src=qr;}}
  // One line each: shorter wordings for the narrow monospace layouts (Cockpit, Radar).
  const alts={'kofi-a':['Enjoying it? Tip the developer','Enjoying it? Tip the dev'],'kofi-b':['Optional. The app stays free either way.','Optional. Free either way.']};
  for(const id of ['kofi-a','kofi-b']){const e=$(id);e._alts=alts[id];fitLine(e);}
}
function showSettings(){
  const i=LAYOUTS.findIndex(([k])=>k===settings.layout);
  setText('set-layout-v',`${i+1}. ${layoutName(settings.layout)}`);
  const pl=settings.place,locV=$('set-location-v');
  locV._alts=pl?[[pl.street,placeLabel(pl)].filter(Boolean).join(', '),pl.street||placeLabel(pl),placeLabel(pl)].filter(Boolean):['Not set'];
  setText('set-location-v',locV._alts[0]);
  const alert=alertFor(settings.radiusMiles,mapMiles());
  setText('set-radius-v',alert<settings.radiusMiles?`${fmt.dist(alert,0)} (the map radius)`:fmt.dist(settings.radiusMiles,0));
  setText('set-map-v',fmt.dist(mapMiles(),0));
  setText('set-distance-v',settings.distance==='km'?'Kilometers':'Miles');
  setText('set-altitude-v',settings.altitude==='m'?'Meters':'Feet');
  setText('set-awake-v',settings.keepAwake?'On':'Off');
  setText('set-places-v',{off:'Off',cities:'Cities',hoods:'Neighborhoods',both:'Cities & neighborhoods'}[settings.placeNames]);
  setText('set-chime-v',{off:'Off',low:'On · quiet',med:'On · medium',high:'On · loud'}[settings.chime]);
  const win=settings.alertZone==='window',bearing=d=>`${compass(d)} ${d}°`;
  setText('set-zone-v',win?'Window view':'All around');
  setText('set-from-v',bearing(settings.viewFrom));setText('set-to-v',bearing(settings.viewTo));
  const view=alertFor(settings.viewMiles,mapMiles());
  setText('set-view-v',view<settings.viewMiles?`${fmt.dist(view,0)} (the map radius)`:fmt.dist(settings.viewMiles,0));
  for(const r of document.querySelectorAll('#settings .win'))r.hidden=!win;
  $('set-radius').hidden=win;
  // Spoken labels follow the values; a changed value on the focused row is read out.
  for(const r of document.querySelectorAll('#settings .row')){
    fitValue(r);const before=r.getAttribute('aria-label');labelRow(r);
    if(r===focused&&before&&before!==r.getAttribute('aria-label'))$('sr-live').textContent=r.querySelector(':scope > b')?.textContent||'';
  }
}
function adjustSetting(el,dir){
  if(el.id==='set-layout')return startPick(dir);
  if(el.id==='set-radius')settings.radiusMiles=RADII[Math.max(0,Math.min(RADII.length-1,RADII.indexOf(settings.radiusMiles)+dir))];
  else if(el.id==='set-map')return stepMap(dir);
  else if(el.id==='set-distance')settings.distance=settings.distance==='km'?'mi':'km';
  else if(el.id==='set-altitude')settings.altitude=settings.altitude==='m'?'ft':'m';
  else if(el.id==='set-zone'){settings.alertZone=settings.alertZone==='window'?'circle':'window';return zoneChanged();} // the list is cleared when the change is kept (stopEdit)
  else if(el.id==='set-from'||el.id==='set-to'){
    const k=el.id==='set-from'?'viewFrom':'viewTo',other=settings[k==='viewFrom'?'viewTo':'viewFrom'];
    let v=((settings[k]+dir)%360+360)%360;
    if(v===other)v=((v+Math.sign(dir))%360+360)%360; // from = to would be a zero-width window
    settings[k]=v;return zoneChanged();
  }
  else if(el.id==='set-view'){settings.viewMiles=VIEW_MILES[Math.max(0,Math.min(VIEW_MILES.length-1,VIEW_MILES.indexOf(settings.viewMiles)+dir))];return zoneChanged();}
  else if(el.id==='set-places'){
    const steps=['off','cities','hoods','both'],i=steps.indexOf(settings.placeNames);
    settings.placeNames=steps[(i+dir+steps.length)%steps.length];saveSettings(settings);useSettings(settings);showSettings();
    return busy(mapsChanged); // layouts set place labels when the map is (re)drawn
  }
  else if(el.id==='set-chime'){
    const steps=['off','low','med','high'],i=steps.indexOf(settings.chime);
    settings.chime=steps[Math.max(0,Math.min(steps.length-1,i+dir))];saveSettings(settings);showSettings();
    if(settings.chime!=='off')tellApp({type:'chime',volume:CHIME_VOLUME[settings.chime]}); // a preview
    return;
  }
  else if(el.id==='set-awake'){settings.keepAwake=!settings.keepAwake;saveSettings(settings);showSettings();return tellAwake();}
  else return;
  saveSettings(settings);useSettings(settings);showSettings();
  if(el.id==='set-radius'&&settings.place){busy(refreshLayout);clearTimeout(zoneTimer);zoneTimer=setTimeout(restartFeed,900);} // the feed's alert radius
  else busy(refreshLayout);
}

// Alert zone changes redraw at once; the feed (which marks planes inside the zone and may
// need to reach further for Window distance) restarts after a short pause.
let zoneTimer=0;
function zoneChanged(){
  saveSettings(settings);useSettings(settings);showSettings();
  // Redraw once the presses stop (the dashboard is behind Settings anyway).
  clearTimeout(zoneDraw);zoneDraw=setTimeout(()=>busy(()=>{
    try{active?.mod.refreshZone?active.mod.refreshZone():active?.mod.refresh?.();}catch(e){console.error(e);}
    if(lastModel)draw(lastModel);
  }),350);
  clearTimeout(zoneTimer);zoneTimer=setTimeout(restartFeed,900);
}
let zoneDraw=0;
// Slow work (map repaints, layout switches): a cog in the theme accent shows if it takes
// more than ~250 ms, and remote presses are dropped until it's done so mashing can't stack it.
let busyNow=false;
// Keys are ignored while the cog shows. It clears after the next paint, or after 1.5 s at
// the latest: animation frames pause on a hidden or starved page (fuzz seed 281).
let busyToken=0;
// Except one OK: pressed while the cog shows, it is kept and acted on when the cog clears, if the
// screen, the focused row and the edit are as they were (Back forgets it; more OKs aren't kept, so
// mashing still can't stack). Dropped, on a slow stick a change then OK at a normal pace left the
// row in edit mode, and the next Down changed the value instead of moving down.
let heldOk=null;
function busy(fn){
  const token=++busyToken;busyNow=true;$('busy').classList.add('on');
  const done=()=>{if(token!==busyToken)return;busyNow=false;$('busy').classList.remove('on');
    const h=heldOk;heldOk=null;
    if(h&&h.layer===layer&&h.focused===focused&&h.editing===editing&&h.adj===adj)document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));};
  setTimeout(()=>{try{fn();}finally{requestAnimationFrame(()=>requestAnimationFrame(done));setTimeout(done,1500);}},20);
}
// Window bearings: OK on the row to edit, then Left/Right 1°, Up/Down 10°, OK or Back to finish.
let editing=null;
function editKey(e){
  const k=e.key,dir={ArrowLeft:-1,ArrowRight:1,ArrowDown:-10,ArrowUp:10}[k];
  e.preventDefault();
  // Up/Down: 10 at a time on bearings; on Map radius Up zooms in as on the dashboard;
  // otherwise the same as Right/Left.
  if(dir)return adjustSetting(editing,editing.dataset.big!==undefined?dir:editing.id==='set-map'&&Math.abs(dir)===10?-Math.sign(dir):Math.sign(dir));
  if(k==='Enter'||k===' ')return stopEdit(true);
  if(['Escape','GoBack','BrowserBack','Back'].includes(k)||e.keyCode===4)return cancelEdit();
}
// commit: the edit is kept. A kept change of Alert zone starts 'Recently above' afresh (the
// old list was for the other zone shape); a cancelled or no-net-change edit keeps it.
function stopEdit(commit=false){
  const before=editSnap;editing?.classList.remove('editing');editHint(null,editing);editing=null;editSnap=null;
  if(commit&&before&&before.alertZone!==settings.alertZone){store.remove(HISTORY_KEY);clearTimeout(zoneTimer);restartFeed();}
}
// While a row is being edited its keys hint shows on the Settings title line, so the value
// keeps the row's full width (in the narrow monospace layouts the hint left it no room).
function editHint(row,was){
  const card=$('settings').querySelector('.card');card.classList.toggle('editing',!!row);card.classList.toggle('big',row?.dataset.big!==undefined);
  fitValue(row||was);
}
// Back while editing puts the value back as it was when OK was pressed, applied once: a Map radius
// step's own pending apply (the step undone, or one kept with OK moments before) is folded into it.
let editSnap=null;
function cancelEdit(){
  const before=editSnap;stopEdit();
  if(!before)return;
  const {place,...now}=settings,changed=Object.keys(before).filter(k=>before[k]!==now[k]);
  if(!changed.length)return;
  const mapStep=before.mapMiles!==settings.mapMiles||!!mapTimer;
  Object.assign(settings,before);saveSettings(settings);useSettings(settings);showSettings();tellAwake();
  busy(()=>{mapsChanged();refreshLayout();});
  clearTimeout(mapTimer);mapTimer=0;clearTimeout(zoneTimer);zoneTimer=setTimeout(mapStep?()=>applyPlace(settings.place):restartFeed,700);
}

// Map radius: Settings > Map radius, or Up/Down on the dashboard. The view redraws at
// once (the current map, rescaled); the map for the new radius and the wider or
// narrower feed follow after a short pause, so stepping through sizes is cheap.
let mapTimer=0,toastTimer=0;
function stepMap(dir){
  const i=MAP_RADII.indexOf(mapMiles()),next=MAP_RADII[Math.max(0,Math.min(MAP_RADII.length-1,(i<0?2:i)+dir))];
  if(next===mapMiles())return toast(`Map radius ${fmt.dist(next,0)} (${dir<0?'closest':'widest'})`);
  settings.mapMiles=next;saveSettings(settings);useSettings(settings);
  if(layer?.id==='settings')showSettings();
  toast(`Map radius ${fmt.dist(next,0)}${alertFor(settings.radiusMiles,next)<settings.radiusMiles?` · alert zone ${fmt.dist(next,0)}`:''}`);
  if(maps.detail&&!detailFits(maps.detail,detailSpec(next)))maps.detail=null;
  busy(()=>{mapsChanged();refreshLayout();});
  clearTimeout(mapTimer);
  mapTimer=setTimeout(()=>{mapTimer=0;if(settings.place)applyPlace(settings.place);},700);
}
function toast(text){
  const t=$('toast');t.textContent=text;t.classList.add('on');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('on'),1800);
}

// Layout picker: the dashboard behind the bar is the real layout, switched live.
let pick=null;
function startPick(dir){
  pick={index:Math.max(0,LAYOUTS.findIndex(([k])=>k===settings.layout))};
  stage.classList.add('picking');
  open('picker');setFocus(null);
  if(dir)stepPick(dir);else showPick();
}
function showPick(){
  setText('pick-count',`Layout ${pick.index+1} of ${LAYOUTS.length}`);
  setText('pick-name',LAYOUTS[pick.index][1]);
}
function stepPick(dir){
  pick.index=(pick.index+dir+LAYOUTS.length)%LAYOUTS.length;showPick();
  const btn=$(dir<0?'pick-prev':'pick-next');btn.classList.add('focus');setTimeout(()=>btn.classList.remove('focus'),180);
  useLayout(LAYOUTS[pick.index][0]);
}
// keep: save the previewed layout; else go back to the saved one.
function endPick(keep){
  if(!pick)return;
  const id=LAYOUTS[pick.index][0];pick=null;stage.classList.remove('picking');
  if(keep){settings.layout=id;saveSettings(settings);useLayout(id);}
  else useLayout(settings.layout);
}

// Location entry: an on-screen keyboard for the remote, plus results to pick.
const KEYS=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ,-1234567890'.split(''),['Space','space w2'],['Delete','del w2'],['Clear','clear w3'],['Search','search w4']];
let entry='',searchTimer=null,searchSeq=0;
// Closed, the search screen sends nothing more: not the typing it was waiting on, nor the answer to one out.
const stopSearch=()=>{clearTimeout(searchTimer);searchSeq++;};
function buildKeys(){
  $('keys').replaceChildren(...KEYS.map(k=>{
    const [label,cls]=Array.isArray(k)?k:[k,''];
    const b=document.createElement('button');b.textContent=label;b.dataset.focus='';b.dataset.key=Array.isArray(k)?cls.split(' ')[0]:k;
    if(cls)b.className=cls.split(' ').slice(1).join(' ');return b;
  }));
}
function typeKey(key){
  if(key==='space')entry+=entry&&!entry.endsWith(' ')&&entry.length<40?' ':'';
  else if(key==='del')entry=entry.slice(0,-1);
  else if(key==='clear')entry='';
  else if(key==='search')return runSearch(true);
  else if(entry.length<40)entry+=key;
  setText('entry-text',entry);
  // Search as you type: after 800 ms of no typing, and only from 3 characters (P3-7).
  clearTimeout(searchTimer);if(entry.trim().length>=3)searchTimer=setTimeout(runSearch,800);
}
// ZIP/city searches run as you type; street addresses only on Search (one geocoder
// request per search, as Nominatim's usage policy asks). Every search ends in results,
// "no match", or an error with Retry; focus never falls off the screen.
const SEARCH_LIMIT_MS=25000;
async function runSearch(explicit=false){
  if(!explicit&&layer?.id!=='locate')return; // typed, then another screen came over it
  clearTimeout(searchTimer);
  const q=entry.trim(),seq=++searchSeq,box=$('results'),searchKey=$('keys').querySelector('[data-key="search"]');
  const show=(...nodes)=>{box.replaceChildren(...nodes);$('results-src').textContent='';fitLine($('search-src'));keepFocus(searchKey);};
  const msg=(text,cls='msg')=>Object.assign(document.createElement('div'),{className:cls,textContent:text});
  const retry=()=>{const b=document.createElement('button');b.dataset.focus='';b.id='search-retry';b.className='retry';b.textContent='Try again';return b;};
  if(q.length<2){
    if(explicit)show(msg('Type a ZIP or postal code, a city, or a street address first.'));else show();
    return;
  }
  const address=looksLikeAddress(q);
  if(address&&!explicit)return show(msg('Street address: press Search when done.'));
  // Street addresses go to the U.S. Census geocoder only when they look like a U.S. address,
  // and to OpenStreetMap only where the profile allows; never to Open-Meteo.
  const us=address&&looksLikeUSAddress(q);
  if(address&&!us&&!PROFILE.nominatim)return show(msg('For a U.S. street address, add the state or ZIP code. Elsewhere, search for the town or postal code.'));
  show(msg(`Searching for “${q}”`,'msg busy'));
  const work=(async()=>{
    let found=address?await searchAddress(q,{census:us,nominatim:PROFILE.nominatim}):await searchPlaces(q);
    // Postcodes Open-Meteo doesn't know (e.g. UK "SW1A 2AA"): OpenStreetMap once, if allowed.
    if(!address&&explicit&&found&&!found.length&&PROFILE.nominatim&&looksLikePostcode(q))found=await searchAddress(q,{nominatim:true});
    return found;
  })().catch(e=>{console.error('search',e?.message||e);return null;});
  const found=await Promise.race([work,new Promise(r=>setTimeout(()=>r('timeout'),SEARCH_LIMIT_MS))]);
  if(seq!==searchSeq||layer?.id!=='locate'&&!layers.some(l=>l.id==='locate'))return;
  lastQuery=q;
  if(found==='timeout'||!found){
    show(msg(found?'The search is taking too long.':'Search is unavailable. Check the connection.'),retry());
    if(explicit&&layer?.id==='locate')setFocus($('search-retry'));
    return;
  }
  if(!found.length)return show(msg(`No places match “${q}”. Check the spelling, or try a ZIP or postal code.`));
  show(...found.slice(0,4).map(p=>{ // four fit beside the keyboard with the source lines
    const b=document.createElement('button');b.dataset.focus='';
    b.append(Object.assign(document.createElement('span'),{textContent:p.street||placeLabel(p)}),Object.assign(document.createElement('small'),{textContent:p.street?placeLabel(p):[p.admin,p.country].filter(Boolean).join(', ')}));
    b._place=p;return b;
  }));
  for(const t of box.querySelectorAll('button span,button small'))fitLine(t); // one line each, never "…"
  // GeoNames (CC BY 4.0) asks for its credit where its places are shown.
  $('results-src').textContent=found.some(p=>p.source==='search')?'Places: GeoNames via open-meteo.com':'';
  // After Search, go to the first match; while typing, stay on the keyboard.
  if(explicit&&layer?.id==='locate')setFocus(box.firstElementChild);
}
let lastQuery='';
function openLocate(help){
  searchSeq++;clearTimeout(searchTimer); // a search from an earlier visit must not fill this one
  $('results-src').textContent='';
  entry='';setText('entry-text','');$('results').replaceChildren();
  setText('entry-help',help||'Type a ZIP or postal code, a city, or your street address, then Search.');
  open('locate');
  {const src=$('search-src');src._alts=PROFILE.searchAlts;src.textContent=src._alts[0];fitLine(src);}
}

function select(el){
  if(!el)return;
  if(el.dataset.edit!==undefined){editing=el;el.classList.add('editing');editHint(el);const {place,...rest}=settings;editSnap=rest;return;}
  if(el._place)return confirmPlace(el._place);
  if(el.dataset.key)return typeKey(el.dataset.key);
  switch(el.id){
    case 'welcome-ok':settings.confirmed=true;saveSettings(settings);return close();
    case 'welcome-change':return openLocate();
    case 'set-layout':return startPick(0);
    case 'set-location':return openLocate();
    case 'set-adjust':return startAdjust(settings.place);
    case 'confirm-ok':return choosePlace(pending);
    case 'confirm-adjust':return startAdjust(pending,{from:'confirm'});
    case 'confirm-again':return close();
    case 'set-done':return close();
    case 'set-about':return openAbout();
    case 'set-privacy':return openPrivacy();
    case 'consent-ok':if(performance.now()<consentArm)return;return agree();
    case 'consent-policy':return openPrivacy();
    case 'privacy-back':return close();
    case 'privacy-erase':return open('erase','erase-cancel');
    case 'erase-cancel':return close();
    case 'erase-ok':return eraseAll();
    case 'about-back':return close();
    case 'pick-prev':return stepPick(-1);
    case 'pick-next':return stepPick(1);
    case 'ip-retry':return findHome();
    case 'search-retry':entry=lastQuery||entry;setText('entry-text',entry);setFocus($('keys').querySelector('[data-key="search"]'));return runSearch(true);
    default:if(el.dataset.adjust!==undefined)adjustSetting(el,1);
  }
}

let lastBack=-Infinity;
function back(){
  // The app and the page may both report one press: de-duplicate first, so one Back while
  // editing only cancels the edit (it also closed Settings). On the monotonic clock: a TV clock
  // set back must not swallow every Back until it catches up.
  const now=performance.now();if(now-lastBack<350)return;lastBack=now;
  if(editing)return cancelEdit();
  if(adj)return endAdjust();
  if(!layer&&browse)return endBrowse();
  close();
}
window.__whatsupBack=back;

// --- Adjust position: a close-up street map (OpenFreeMap z13, about 1 mi around) and
// a fixed centre dot; the remote's arrows move the map under it, ~50 m a press,
// faster while held. OK saves, Back cancels. Drawn in the layout's own colours.
const ADJ_RANGE=1,STEP_M=50,ACX=270,ACY=270,AR=250;
// Drawn in the layout's ink colour (--ui-ink) at different strengths.
function adjMap(){
  const ink=getComputedStyle(stage).getPropertyValue('--ui-ink').trim(),m=/^#([0-9a-f]{6})$/i.exec(ink);
  const [r,g,b]=m?[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)):[61,255,116],c=a=>`rgba(${r},${g},${b},${a})`;
  return [{layer:'water',fill:c(.15)},{layer:'rivers',stroke:c(.3),width:1.4},
    {layer:'roads',not:['motorway','trunk','primary','secondary'],stroke:c(.32),width:1},
    {layer:'roads',classes:['motorway','trunk','primary','secondary'],stroke:c(.55),width:2},
    {layer:'runways',stroke:c(.85),width:2.4}];
}
let adj=null;
// Its street map is built once per place (within ~1 km, as the saved maps) and kept while the app runs,
// at most 30 days: opening Adjust position again asks OpenFreeMap for nothing. A failed build is tried again.
let adjBuilt=null;
function adjStreets(place){
  const b=adjBuilt;
  if(b&&performance.now()-b.at<30*864e5&&Math.abs(b.latitude-place.latitude)<.01&&Math.abs(dLon(b.longitude,place.longitude))<.01)return b.map;
  const map=buildMap(place,ADJ_RANGE+.5,{zoom:13,detail:true});
  adjBuilt={latitude:place.latitude,longitude:place.longitude,at:performance.now(),map};
  map.catch(()=>{if(adjBuilt?.map===map)adjBuilt=null;});
  return map;
}
// from: 'confirm' when opened on a search result (Back returns to it, not to an empty
// dashboard on a first run): the screens under it, and their focus, come back too. Opened from
// Settings (Fine-tune), Back and OK both return to Settings, on that row.
async function startAdjust(place,{from=''}={}){
  if(!place)return;
  const under=[...layers.map(l=>[l,l._last]),...(layer&&from!=='confirm'?[[layer,focused]]:[])];
  closeAll();
  // note: the street map's own (loading, unavailable), shown again when the dot comes back inside the limit.
  adj={place,from,under,latitude:place.latitude,longitude:place.longitude,map:null,note:'Loading street map',held:0,canvas:makeCanvas(540,540)};
  $('adjust-map').replaceChildren(adj.canvas);
  stage.classList.add('adjusting');
  drawAdjust();syncApp();
  setText('adjust-note',adj.note);
  try{
    const m=await adjStreets(place);
    if(adj?.place===place){adj.map=m;setText('adjust-note',adj.note='');drawAdjust();}
  }catch(e){(e?.net?console.warn:console.error)('adjust map',e?.message||e);if(adj?.place===place)setText('adjust-note',adj.note='Street map unavailable');}
}
function drawAdjust(){
  const c={latitude:adj.latitude,longitude:adj.longitude},ppm=AR/ADJ_RANGE;
  paintMap(adj.canvas,{base:adj.map||maps.base},{cx:ACX,cy:ACY,ppm,clip:{r:AR},center:c,fixed:true},adjMap());
  const nodes=[svg('circle',{class:'ring edge',cx:ACX,cy:ACY,r:AR})];
  for(const f of [.25,.5,.75])nodes.push(svg('circle',{class:'ring',cx:ACX,cy:ACY,r:AR*f}));
  nodes.push(svg('line',{class:'cross',x1:ACX-26,y1:ACY,x2:ACX+26,y2:ACY}),svg('line',{class:'cross',x1:ACX,y1:ACY-26,x2:ACX,y2:ACY+26}),
    svg('circle',{class:'home-dot',cx:ACX,cy:ACY,r:6}));
  const m100=100/1609.344*ppm;
  nodes.push(svg('line',{class:'scale',x1:500-m100,y1:40,x2:500,y2:40}),svg('text',{class:'label',x:500,y:32,'text-anchor':'end'},'100 m'),
    svg('text',{class:'label',x:528,y:528,'text-anchor':'end'},'Rings 400 m'));
  $('adjust-marks').replaceChildren(...nodes);
  const dy=(adj.latitude-adj.place.latitude)*111320,dx=(adj.longitude-adj.place.longitude)*111320*Math.cos(adj.place.latitude*Math.PI/180);
  const moved=Math.hypot(dx,dy);
  setText('adjust-moved',moved<1?'Not moved yet':`Moved ${moved>=1000?(moved/1000).toFixed(2)+' km':Math.round(moved)+' m'} ${compass((Math.atan2(dx,dy)*180/Math.PI+360)%360)}`);
  setText('adjust-where',adj.place.street||placeLabel(adj.place));
}
// Fine-tuning keeps the whole view on the street map loaded around the place (ADJ_RANGE +
// 0.5 mi, the view shows ADJ_RANGE around the dot): at most ADJ_MAX_M from where it started;
// farther is a job for Location. A held arrow speeds up to 4x.
const ADJ_MAX_M=800;
function nudge(dir,held){
  adj.held=held?adj.held+1:0;
  const step=STEP_M*(held?Math.min(4,1+adj.held/3):1),cos=Math.cos(adj.place.latitude*Math.PI/180);
  const [e,n]={up:[0,1],down:[0,-1],left:[-1,0],right:[1,0]}[dir];
  let dy=(adj.latitude-adj.place.latitude)*111320+n*step,dx=(adj.longitude-adj.place.longitude)*111320*cos+e*step;
  const d=Math.hypot(dx,dy),limit=d>ADJ_MAX_M;
  if(limit){dx*=ADJ_MAX_M/d;dy*=ADJ_MAX_M/d;}
  adj.latitude=adj.place.latitude+dy/111320;adj.longitude=adj.place.longitude+dx/(111320*cos);
  setText('adjust-note',limit?'As far as fine-tuning goes. To move farther, change Location.':adj.note);
  drawAdjust();
}
function endAdjust(save=false){
  const a=adj;adj=null;stage.classList.remove('adjusting');setText('adjust-note','');$('adjust-map').replaceChildren();
  if(save){
    const moved=Math.abs(a.latitude-a.place.latitude)+Math.abs(a.longitude-a.place.longitude)>1e-7;
    // Longitude stays within ±180 (nudging across the date line), or the next launch drops it.
    const longitude=((a.longitude+540)%360)-180;
    choosePlace({...a.place,latitude:Math.max(-85,Math.min(85,a.latitude)),longitude,accuracyKm:moved?.05:a.place.accuracyKm,
      source:moved?'adjusted':a.place.source});
  }else if(a.from==='confirm'){
    for(const [l] of a.under){if(l.id==='settings')showSettings();open(l.id);}
    if(!settings.place&&!a.under.some(([l])=>l.id==='locate'))openLocate(); // a first run: Search again needs a search screen
    confirmPlace(a.place);
    for(const [l,last] of a.under)l._last=last;
  }
  if(a.from!=='confirm')for(const [l,last] of a.under){if(l.id==='settings')showSettings();open(l.id,last?.id);}
  if(lastModel)draw(lastModel);syncApp();
}

const DIRS={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
document.addEventListener('keydown',e=>{
  if(busyNow){
    e.preventDefault();
    if(e.key==='Enter'&&!e.repeat){if(!heldOk)heldOk={layer,focused,editing,adj};}
    else if(['Escape','GoBack','BrowserBack','Back'].includes(e.key)||e.keyCode===4)heldOk=null;
    return;
  }
  const k=e.key,dir=DIRS[k];
  // A held OK, Play/Pause or Menu (82, not the letter R) repeats: it would open and close the picker or
  // Settings, or run through screens.
  if(e.repeat&&(k==='Enter'||k===' '||k==='MediaPlayPause'||e.keyCode===179||k==='ContextMenu'||k==='Menu'||e.keyCode===82&&k.length>1)){e.preventDefault();return;}
  if(['Escape','GoBack','BrowserBack','Back'].includes(k)||e.keyCode===4){e.preventDefault();return back();}
  // Play/Pause toggles Settings: Vega never passes the remote's Menu (≡) key to the page.
  if(k==='MediaPlayPause'||e.keyCode===179){
    e.preventDefault();
    if(!layer&&!adj)openSettings();
    else if(layer?.id==='settings'&&!editing)back();
    return;
  }
  if(adj){
    if(dir){e.preventDefault();return nudge(dir,e.repeat);}
    if(k==='Enter'||k===' '){e.preventDefault();return endAdjust(true);}
    return;
  }
  if(!layer){
    // Up/Down on the dashboard: zoom the map in/out (Settings > Map radius).
    if(dir==='up'||dir==='down'){e.preventDefault();return stepMap(dir==='up'?-1:1);}
    // Left/Right: the next or previous plane on the card (a held key repeats).
    if(dir==='left'||dir==='right'){e.preventDefault();return stepPlanes(dir==='right'?1:-1);}
    if(k==='Enter'||k===' '||k==='ContextMenu'||k==='Menu'||e.keyCode===82){e.preventDefault();openSettings();}
    return;
  }
  if(editing)return editKey(e);
  if(layer.id==='picker'){
    e.preventDefault();
    if(dir==='left'||dir==='up')return stepPick(-1);
    if(dir==='right'||dir==='down')return stepPick(1);
    if(k==='Enter'||k===' '){endPick(true);return close();}
    return;
  }
  if(dir&&(layer.id==='privacy'||layer.id==='about')&&(dir==='up'||dir==='down')){
    e.preventDefault();const d=$(`${layer.id}-doc`);d.scrollTop+=(dir==='down'?1:-1)*d.clientHeight*.6;return;
  }
  if(dir){
    e.preventDefault();
    return move(dir);
  }
  if(k==='Enter'||k===' '&&layer.id!=='locate'){e.preventDefault();return select(focused);}
  if(layer.id==='locate'){
    if(k==='Backspace'){e.preventDefault();return typeKey('del');}
    if(k===' '){e.preventDefault();return typeKey('space');}
    if(/^[a-z0-9,\-'.]$/i.test(k)){e.preventDefault();return typeKey(k.toUpperCase());}
  }
});
// First run: Settings waits while the IP lookup runs, so the welcome card (or the search screen) then opens alone.
let locating=false;
function openSettings(){if(locating)return toast('Still finding your location');showSettings();open('settings');}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&layer?.contains(b)){setFocus(b);select(b);}});

// First launch: the IP guess, said plainly.
function showWelcome(place){
  setText('welcome-city',placeLabel(place));
  // GeoJS gives MaxMind's radius, 1 to 1,000 km: none, zero, negative or absurd is no claim to show.
  const a=Number(place.accuracyKm),acc=a>0&&a<=2000?a:0;
  setText('welcome-note',`A first guess from your internet connection${acc?` (the lookup claims within ${settings.distance==='km'?`${Math.round(acc)||1} km`:`${Math.round(acc*.621)||1} mi`})`:''}. `+
    'Internet locations are often off by 10 miles or more, so enter your ZIP or street address for a sky that matches your window.');
  // Settings (location, privacy and erase, keep screen awake) is one press away on the dashboard: said once, here.
  const hint=$('welcome-hint');hint._alts=['Press Select any time for Settings.','Select ▸ Settings'];
  open('welcome','welcome-change');fitLine(hint);
}

// --- Consent, privacy page and erase.
// Consent is stored with the version of the policy agreed to (the "Version N" on top of
// privacy-store.txt). A record from before the current consent text (CONSENT_SINCE) asks
// again (once), and everything else the user set is kept.
// Since Version 2 the text names every service by profile and says where searches go (asked again once).
const CONSENT_KEY='whatsup.consent',CONSENT_VERSION=3,CONSENT_SINCE=2;
// The hosted policy (shown as a QR on the privacy page when set): the store build's only.
const PRIVACY_URL=PROFILE.privacyUrl||'';
function hasConsent(){try{const v=JSON.parse(localStorage.getItem(CONSENT_KEY))?.v;return Number.isInteger(v)&&v>=CONSENT_SINCE&&v<=CONSENT_VERSION;}catch{return false;}}
function giveConsent(){store.set(CONSENT_KEY,{v:CONSENT_VERSION,at:new Date().toISOString().slice(0,10)});} // full storage: maps make room
let consentDone=null,consentArm=0;
// Erase reloads onto this screen with focus on Agree: an OK pressed twice in a hurry must not agree
// unread. After Erase, OK is taken once a key is released here, or after 0.8 s.
const ERASED_KEY='whatsup.erased',erased=(()=>{try{const v=sessionStorage.getItem(ERASED_KEY);sessionStorage.removeItem(ERASED_KEY);return v==='1';}catch{return false;}})();
addEventListener('keyup',()=>{consentArm=0;});
function askConsent(){
  consentArm=erased?performance.now()+800:0;
  $('consent-body').textContent=PROFILE.consent;return new Promise(r=>{consentDone=r;open('consent','consent-ok');});
}
function agree(){giveConsent();closeAll();const r=consentDone;consentDone=null;r?.();}
// The chosen layout's colours for the consent screen, without starting the layout (its
// code may fetch map imagery): only its stylesheets and stage classes.
function themeOnly(id){
  for(const sheet of sheetsOf(id))addCss(sheet,paintEdge);
  stage.classList.add(...sheetsOf(id).map(s=>`L-${s}`));
}
// assets/privacy.txt as plain text: a blank line starts a paragraph, "## " a heading.
function renderDoc(box,text){
  box.replaceChildren(...String(text||'').split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean).map(p=>
    p.startsWith('## ')?Object.assign(document.createElement('h4'),{textContent:p.slice(3)}):
    Object.assign(document.createElement('p'),{textContent:p.replace(/\s*\n\s*/g,' '),className:p.startsWith('• ')?'bullet':''})));
}
// Anything of the app's on this TV: also with a consent of an older version, damaged or missing.
const anyStored=()=>{try{return Object.keys(localStorage).some(k=>k.startsWith('whatsup.'));}catch{return false;}};
function openPrivacy(){
  const doc=$('privacy-doc');renderDoc(doc,window.__whatsupDocs?.privacy||'');doc.scrollTop=0;
  $('privacy-qr-box').hidden=!PRIVACY_URL;if(PRIVACY_URL)$('privacy-qr').src=themedQr(PRIVACY_URL);
  $('privacy-erase').hidden=!hasConsent()&&!anyStored(); // nothing stored, nothing to erase
  open('privacy','privacy-back');
}
// About & credits (assets/licenses.txt), with the QR adsb.fi's terms ask for (a cite and a link).
function openAbout(){
  const doc=$('about-doc');renderDoc(doc,window.__whatsupDocs?.licenses||'');doc.scrollTop=0;
  // adsb.fi's terms ask for a cite and a link (personal profile only; the store build uses adsb.lol).
  const fi=PROFILE.feed==='adsb.fi';$('about-qr').closest('figure').hidden=!fi;if(fi)$('about-qr').src=themedQr('https://adsb.fi');
  open('about','about-back');
}
// Everything the app stored on this TV, then a clean start at the consent screen.
function eraseAll(){
  feed?.stop();feed=null;store.seal();placeToken++;detailToken++;clearTimeout(detailRetry);
  try{for(const k of Object.keys(localStorage))if(k.startsWith('whatsup.'))localStorage.removeItem(k);}catch{/* nothing stored */}
  try{indexedDB?.deleteDatabase?.('whatsup');}catch{/* none */}
  try{sessionStorage.setItem(ERASED_KEY,'1');}catch{/* the consent screen takes OK at once */}
  location.reload();
}

// The app tells the page when it leaves or returns to the screen: polling pauses meanwhile, and a search
// still waiting for the typing to pause is not sent.
window.__whatsupActive=on=>{onScreen=!!on;if(on)feed?.resume?.();else{feed?.pause?.();flushLog();clearTimeout(searchTimer);}keepTime();};
addEventListener('pagehide',()=>flushLog());

// --- Boot
async function boot(){
  dropOldMaps(); // what an older build saved that this one never reads
  buildKeys();
  fitText($('kofi-a'),$('kofi-b'),$('welcome-hint')); // the tip lines (and the welcome card's hint) re-fit when a layout's font arrives (P3-2)
  tellAwake();
  if(query.get('reset')==='1'){saveSettings({});settings=loadSettings();}
  if(query.get('units')==='metric'){settings.distance='km';settings.altitude='m';}
  // Screenshot hook: ?window=90-180-25 sets a Window view zone (from-to-miles) for this launch.
  const w=/^(\d{1,3})-(\d{1,3})-(\d{1,3})$/.exec(query.get('window')||'');
  if(w)Object.assign(settings,{alertZone:'window',viewFrom:+w[1]%360,viewTo:+w[2]%360,viewMiles:VIEW_MILES.includes(+w[3])?+w[3]:25});
  // Screenshot hook: ?map=50 sets the map radius for this launch.
  if(MAP_RADII.includes(Number(query.get('map'))))settings.mapMiles=Number(query.get('map'));
  // Screenshot hook: ?layout=atlas shows that layout for this launch.
  if(query.get('layout'))settings.layout=validLayout(query.get('layout'));
  settings.layout=validLayout(settings.layout);
  useSettings(settings);
  // Nothing is fetched until the user has agreed to the current consent text.
  if(query.get('q'))giveConsent(); // dev/screenshot runs (the release build has no URL hooks)
  if(!hasConsent()){themeOnly(settings.layout);await askConsent();}
  // Dev/screenshot hook: ?q=London picks the first geocoding result.
  const q=query.get('q');
  if(q){const found=await searchPlaces(q);if(found?.[0]){settings.place=found[0];settings.confirmed=true;useSettings(settings);}}
  useLayout(settings.layout);
  if(settings.place){
    applyPlace(settings.place);
    // A time zone that was only a stand-in: look it up again (once per launch).
    refineZone(settings.place).then(p=>{if(p&&settings.place?.latitude===p.latitude&&settings.place?.longitude===p.longitude)adoptRefined(p);});
    if(!settings.confirmed)showWelcome(settings.place);
    // Screenshot hooks: ?screen=settings|picker|welcome|adjust, ?screen=locate&typed=CHICAGO
    const screen=query.get('screen');
    if(screen==='settings'){showSettings();open('settings');}
    if(screen==='picker'){showSettings();open('settings');startPick(0);}
    if(screen==='adjust')startAdjust(settings.place).then(()=>{for(let i=0;i<4;i++)nudge('right');nudge('up');});
    if(screen==='welcome')showWelcome({...settings.place,accuracyKm:5});
    if(screen==='locate'){showSettings();open('settings');openLocate();for(const c of (query.get('typed')||'').toUpperCase())typeKey(c===' '?'space':c);runSearch(true);setFocus($('keys').children[2]);}
    return;
  }
  return findHome();
}
// The IP guess (first launch), or the search screen. When nothing answered the lookup (no connection, a
// timeout, a captive portal's page) it says so and offers Try again, which asks again from there.
const NO_NET='No internet connection. Check the TV’s network settings, then choose Try again. You can also type a ZIP or city now.';
async function findHome(){
  const retry=layer?.id==='locate'?$('ip-retry'):null;
  if(locating)return;
  const damaged=placeDamaged(),wait=retry&&Object.assign(document.createElement('div'),{className:'msg busy',textContent:'Finding your location'});
  if(retry)retry.before(wait);else setText('layout-note','Finding your location');
  locating=true;const {place,offline}=await locateByIp().finally(()=>{locating=false;});
  if(retry)wait.remove();else setText('layout-note','');
  if(retry&&!retry.isConnected||settings.place)return; // a search answered meanwhile, or a place was chosen
  if(!place){
    const help=offline?NO_NET:'We couldn’t find your location automatically. Type a ZIP or postal code, or a city name.';
    if(retry){setText('entry-help',help);if(!offline){retry.remove();keepFocus();}return;}
    openLocate(help);
    if(offline){const b=Object.assign(document.createElement('button'),{id:'ip-retry',className:'retry',textContent:'Try again'});b.dataset.focus='';$('results').append(b);setFocus(b);}
    return;
  }
  // Not saved until the user confirms it (Confirm, or a place chosen through Change). A saved place
  // that can't be read keeps 'Recently above' and the logbook until a confirmed place replaces it.
  settings={...settings,place,confirmed:false};useSettings(settings);
  applyPlace(place,{fresh:!damaged});
  if(retry)closeAll();
  showWelcome(place);
  setTimeout(()=>{if(layer?.id==='welcome')close();},60000);
}
boot();
