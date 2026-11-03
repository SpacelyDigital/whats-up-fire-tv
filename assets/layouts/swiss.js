'use strict';
(()=>{
const __modules=window.__whatsupModules;
const {svg,setText,fmt,metric,KM,placeName,statusText,quietText,makeCanvas,paintMap,toView,planeIcon,number,BASE_RANGE,range,photoSlot,showPhotoIn,fit,placeAlts,headingAlts}=__modules["kit.mjs"];
// Layout 8, Swiss: an off-white poster. One giant number (how far away the nearest
// aircraft is) dominates; the map is only the river/coastline and a red home dot.

const MAPSIZE=284,MAP=[
  {layer:'water',fill:'#d3cdc0'},
  {layer:'rivers',stroke:'#111',width:1.1},
];
const city=s=>String(s||'').split(/[\/(,]/)[0].replace(/\s+(International|Regional|Municipal|Airport|Intl)\b.*$/i,'').trim();

let root,demo=false,$={},maps={},view=null;

function ui(){
  root.innerHTML=`
    <header class="top"><div class="city"></div><div class="clock"></div></header>
    <div class="rule"></div>
    <div class="kicker"></div>
    <div class="giant"><span class="num"></span><span class="unit"></span></div>
    <div class="what"><div class="flight"></div><div class="route"></div></div>
    <div class="side">
      <div class="mapbox"><svg class="marks" viewBox="0 0 ${MAPSIZE} ${MAPSIZE}"></svg></div>
      <div class="facts"></div>
      <div class="status"></div>
    </div>`;
  for(const c of ['city','clock','kicker','giant','num','unit','flight','route','mapbox','marks','facts','status'])$[c]=root.querySelector('.'+c);
  fit($.city,$.kicker,$.route,$.facts);
  $.side=root.querySelector('.side');$.side.append($.pic=photoSlot());
  $.canvas=makeCanvas(MAPSIZE,MAPSIZE,'map');$.mapbox.prepend($.canvas);
  view={cx:MAPSIZE/2,cy:MAPSIZE/2,ppm:MAPSIZE/2/BASE_RANGE,clip:{x:0,y:0,w:MAPSIZE,h:MAPSIZE}};
}
const drawMap=()=>paintMap($.canvas,maps,view,MAP);

// Size the number so it fills the left of the poster without running into the map.
function giant(text){
  const em=[...text].reduce((s,c)=>s+(c==='.'?.3:c==='—'?.85:c==='1'?.5:.68),0)-.065*text.length;
  $.num.style.fontSize=`${Math.min(330,420/Math.max(em+.195,.8))}px`; // .195em: the gap before the rule (swiss.css)
  setText($.num,text);
}

function render(m){
  const {now,hero}=m;
  setText($.city,placeName(),placeAlts());setText($.clock,fmt.clock(now));
  setText($.status,statusText(m,demo));
  const emergency=!!hero?.emergency;
  root.classList.toggle('emergency',emergency);
  root.classList.toggle('quiet',!hero);
  if(emergency){
    setText($.kicker,`Squawk ${hero.squawk||''} · ${hero.emergency[0]+hero.emergency.slice(1).toLowerCase()}`);
    giant(hero.squawk||'7700');setText($.unit,hero.emergency==='EMERGENCY'?'declared':hero.emergency.toLowerCase());
    setText($.flight,hero.flight);
  }else if(hero){
    const d=metric()?hero.ground*KM:hero.ground;
    setText($.kicker,'',headingAlts(hero,hero.status));
    giant(d<10?d.toFixed(1):String(Math.round(d)));setText($.unit,metric()?'km away':'miles away');
    setText($.flight,hero.flight);
  }else{
    const live=demo||m.fresh;
    setText($.kicker,live?'Above you right now':statusText(m,demo));
    giant(live?'0':'—');setText($.unit,live?`aircraft within ${fmt.dist(range(),0).replace(' ','\u00a0')}`:'');
    setText($.flight,'');
  }
  const r=hero?.route;
  const q=quietText(m,demo);
  setText($.route,'',hero?(r?[`${city(r.from?.city)||r.origin} → ${city(r.to?.city)||r.destination}`,`${r.origin} → ${r.destination}`]:[hero.operator||'']):[q,q.split('. ')[0]]);
  setText($.facts,hero?[fmt.alt(hero.altitude_ft),hero.type||hero.aircraft_type].filter(Boolean).join(' · '):'');

  const marks=[svg('circle',{class:'home',cx:view.cx,cy:view.cy,r:5})];
  for(const a of m.planes){
    const p=toView(view,a.x,a.y);
    if(p.x<4||p.y<4||p.x>MAPSIZE-4||p.y>MAPSIZE-4)continue;
    marks.push(planeIcon(a,p,a===hero?16:9,`plane${a===hero?' hero':''}${a.military?' mil':''}`));
  }
  $.marks.replaceChildren(...marks);
  showPhotoIn($.pic,hero);
}


window.__whatsupLayout("swiss",{
  name:'Swiss',map:'base',
  mount(r,c){root=r;demo=c.demo;$={};ui();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){},
  unmount(){root=null;$={};maps={};},
});
})();
