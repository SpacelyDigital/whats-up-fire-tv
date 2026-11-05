// Layout 5, Glass: a near-black street map (roads by class, water, parks, faint
// buildings) under see-through glass cards: time and place, the hero flight with
// route and four instrument tiles, the nearest aircraft in range, and today's tallies.
import {svg,el,setText,fmt,placeName,statusText,quietText,planeIcon,byInterest,makeCanvas,paintMap,toView,placesNear,
  compass,placeBox,alertRadius,ppmOf,range,zonePath,photoSlot,showPhotoIn,fit,fitLine,placeAlts,militaryAlts,headingAlts} from '../kit.mjs';

const W=960,H=540,VIEW={cx:318,cy:284,ppm:25}; // the whole map radius fits below home (256 px)
const DETAIL=[
  {layer:'landuse',classes:['residential'],fill:'#090d13'},
  {layer:'landuse',not:['residential'],fill:'#0b1018'},
  {layer:'parks',fill:'#0a1812'},
  {layer:'aero',classes:['aerodrome','apron'],fill:'#0e1622'},
  {layer:'water',from:'detail',fill:'#0a2338',stroke:'#16456c',width:.8},
  {layer:'waterways',stroke:'#123a5c',width:1.4},
  {layer:'buildings',fill:'#151f2b',stroke:'#1c2836',width:.3},
  {layer:'roads',from:'detail',classes:['service','minor'],stroke:'#1b2533',width:.8},
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#2a2f3d',width:.9,dash:[3,3],cap:'butt'},
  {layer:'roads',from:'detail',classes:['tertiary'],stroke:'#1f2b3c',width:1},
  {layer:'roads',from:'detail',classes:['secondary'],stroke:'#243549',width:1.3},
  {layer:'roads',from:'detail',classes:['primary','trunk'],stroke:'#2b4562',width:1.7},
  {layer:'roads',from:'detail',classes:['motorway'],stroke:'#3f6994',width:2.1,glow:3,glowColor:'rgba(90,170,255,.3)'},
  {layer:'aero',classes:['runway'],stroke:'#4b6a8c',width:4,cap:'butt'},
];
const BASE=[
  {layer:'water',fill:'#0a2338',stroke:'#16456c',width:.8},
  {layer:'rivers',stroke:'#123a5c',width:1.4},
  {layer:'roads',classes:['trunk'],stroke:'#3a5675',width:2},
  {layer:'roads',classes:['motorway'],stroke:'#3f6994',width:2.1,glow:3,glowColor:'rgba(90,170,255,.3)'},
  {layer:'runways',stroke:'#4b6a8c',width:4,cap:'butt'},
];

let root,demo,$={},maps={},placeBoxes=[];
const card=(cls,html)=>{const c=el('section',`gl-card ${cls}`);c.innerHTML=html;return c;};

function ui(){
  $.canvas=makeCanvas(W,H,'gl-canvas');
  $.labels=svg('svg',{class:'gl-svg',viewBox:`0 0 ${W} ${H}`});
  $.over=svg('svg',{class:'gl-svg',viewBox:`0 0 ${W} ${H}`});
  for(const k of ['ring','planes','tags'])$.over.append($[k]=svg('g'));
  const top=card('gl-top',`<div class="gl-clock"></div><div class="gl-where"><span class="gl-city"></span><span class="gl-status"></span></div><div class="gl-date"></div>`);
  const col=el('div','gl-col');
  $.alert=card('gl-alert','');$.alert.hidden=true;
  const hero=card('gl-hero',`
    <div class="gl-kicker"></div>
    <div class="gl-flight"></div>
    <div class="gl-sub"></div>
    <div class="gl-route"><div><b class="gl-o"></b><span class="gl-oc"></span></div><i class="gl-line"><em></em></i><div class="r"><b class="gl-d"></b><span class="gl-dc"></span></div></div>
    <div class="gl-tiles">
      <div><span>Altitude</span><b class="gl-alt"></b></div><div><span>Speed</span><b class="gl-spd"></b></div>
      <div><span>Look up</span><b class="gl-look"></b></div><div><span>Closest</span><b class="gl-cpa"></b></div>
    </div>`);
  const quiet=card('gl-quiet','<div class="gl-kicker">Sky</div><div class="gl-quiet-t"></div>');quiet.hidden=true;
  const near=card('gl-near','<div class="gl-kicker">In range</div><div class="gl-list"></div>');
  const tally=el('div','gl-tally');
  tally.append(card('gl-mini','<span>Today</span><b class="gl-seen"></b><i class="gl-seen-by">aircraft</i>'),card('gl-mini cargo','<span>Cargo</span><b class="gl-cargo"></b><i class="gl-cargo-by"></i>'),
    card('gl-mini mil','<span>Military</span><b class="gl-mil"></b><i class="gl-mil-by"></i>'));
  col.append($.alert,hero,quiet,near,tally);
  // Aircraft photo: its own glass card, bottom left, only while there is a picture.
  $.photo=card('gl-photo','');$.photo.hidden=true;$.photo.append($.pic=photoSlot());
  root.append($.canvas,el('div','gl-vignette'),$.labels,$.over,top,col,$.photo);
  Object.assign($,{hero,quiet,near});
  for(const c of ['clock','city','status','date','kicker','flight','sub','o','oc','d','dc','line','alt','spd','look','cpa','quiet-t','list','seen','seen-by','mil','mil-by','cargo','cargo-by'])
    $[c]=root.querySelector('.gl-'+c);
  $.lineFill=$.line.firstChild;
  fit($.city,$.kicker,$.flight,$.alt,$.spd,$.look,$.cpa);
}

function drawMap(){
  paintMap($.canvas,maps,VIEW,maps.detail?DETAIL:BASE);
  const home=toView(VIEW,0,0);placeBoxes=[{x:home.x-16,y:home.y-16,w:32,h:32}];
  const nodes=[],bounds={x:20,y:110,w:580,h:400};
  for(const p of placesNear(maps,9,{max:40})){
    if(placeBoxes.length>=15)break;
    const q=toView(VIEW,p.x,p.y),t=p.name.toUpperCase(),w=t.length*6.4+4,h=12;
    const b=placeBox(placeBoxes,q,w,h,[[-w/2,-h/2]],bounds);if(!b)continue;
    nodes.push(svg('text',{class:'gl-place',x:b.x+w/2,y:b.y+10,'text-anchor':'middle'},t));
  }
  $.labels.replaceChildren(...nodes);
}

function render(m){
  const {now,hero}=m;
  setText($.clock,fmt.clock(now));setText($.city,'',placeAlts());setText($.date,fmt.date(now));
  setText($.status,statusText(m,demo));$.status.classList.toggle('off',!demo&&!m.fresh&&!m.connecting);
  showPhotoIn($.pic,hero,()=>{$.photo.hidden=$.pic.hidden;});
  root.classList.toggle('emergency',!!hero?.emergency);

  const h=toView(VIEW,0,0);
  $.ring.replaceChildren(svg('path',{class:'gl-alertring',d:zonePath((x,y)=>toView(VIEW,x,y))}),
    svg('circle',{class:'gl-pulse',cx:h.x,cy:h.y,r:10}),svg('circle',{class:'gl-home',cx:h.x,cy:h.y,r:4.5}));
  const planes=[],tags=[],boxes=[{x:h.x-8,y:h.y-8,w:16,h:16}],bounds={x:8,y:118,w:610,h:392};
  if(!$.photo.hidden)boxes.push({x:$.photo.offsetLeft-6,y:$.photo.offsetTop-6,w:$.photo.offsetWidth+12,h:$.photo.offsetHeight+12});
  for(const a of byInterest(m)){
    const p=toView(VIEW,a.x,a.y);
    if(p.x<-20||p.x>W+20||p.y<-20||p.y>H+20)continue;
    const isHero=a===hero;
    planes.push(planeIcon(a,p,isHero?26:18,`gl-plane${isHero?' hero':''}${a.inside?'':' far'}${a.military?' mil':''}`));
    if(p.x>624||p.y<110)continue;
    const t=`${a.flight} · ${fmt.alt(a.altitude_ft)}`,w=t.length*6.9+18,hh=22;
    const b=placeBox(boxes,p,w,hh,[[16,-hh-4],[-w-16,-hh-4],[16,6],[-w-16,6]],bounds);if(!b)continue;
    tags.push(svg('rect',{class:`gl-tag${isHero?' hero':''}`,x:b.x,y:b.y,width:w,height:hh,rx:11}),
      svg('text',{class:'gl-tagt',x:b.x+9,y:b.y+15},t));
  }
  $.planes.replaceChildren(...planes);$.tags.replaceChildren(...tags);

  $.hero.hidden=!hero;$.quiet.hidden=!!hero;
  $.alert.hidden=!hero?.emergency;
  if(hero?.emergency)$.alert.replaceChildren(el('b','',hero.squawk?`Squawk ${hero.squawk}`:'Declared'),el('span','',hero.emergency));
  if(!hero)setText($['quiet-t'],quietText(m,demo));
  if(hero){
    setText($.kicker,'',headingAlts(hero,`${hero.status} · ${fmt.dist(hero.ground)} ${compass(hero.bearing)}`));
    setText($.flight,hero.flight);
    setText($.sub,[hero.operator||(!hero.callsign||hero.callsign===hero.registration?'Private':''),hero.type||hero.aircraft_type].filter(Boolean).join(' · ')||'Unknown aircraft');
    const r=hero.route;
    setText($.o,r?.origin||'—');setText($.oc,r?.from?.city||(r?'':'Route'));
    setText($.d,r?.destination||'—');setText($.dc,r?.to?.city||(r?'':'not reported'));
    $.lineFill.style.width=hero.progress?`${Math.round(hero.progress.share*100)}%`:'0';
    setText($.alt,fmt.alt(hero.altitude_ft));setText($.spd,fmt.speed(hero.speed_kt));
    setText($.look,`${Math.max(0,Math.round(hero.elevation))}° ${compass(hero.bearing)}`);
    const c=hero.cpa;setText($.cpa,!c?'—':c.receding?'Passed':fmt.mmss(c.seconds));
  }
  const others=m.planes.filter(a=>a!==hero&&a.ground<=range()).slice(0,hero?.emergency?2:3); // on the map only
  $.list.replaceChildren(...(others.length?others.map(a=>{
    const r=el('div','gl-row');
    const arrow=el('i','gl-arrow','▲');arrow.style.transform=`rotate(${Math.round(a.heading||0)}deg)`;
    r.append(arrow,el('b','',a.flight),el('span','',fmt.alt(a.altitude_ft)),el('em','',fmt.dist(a.ground)));return r;
  }):[el('div','gl-row none',hero?'No other aircraft in range':m.noCoverage?'No receiver coverage here':`Nothing within ${fmt.dist(range(),0)}`)]));
  for(const b of $.list.querySelectorAll('.gl-row b'))fitLine(b);
  // Long names wrap instead of being cut, so drop In range rows until the column fits.
  const col=$.list.closest('.gl-col');
  while(col.scrollHeight>col.clientHeight+1&&$.list.children.length>1)$.list.lastElementChild.remove();
  const L=m.log;
  setText($.seen,fmt.int(L.today));setText($.cargo,L.cargoTonight);
  // The cards' bottom lines fit their card (cargo drops brands, military drops types), then
  // all three take the smallest size so none is bigger than its neighbours.
  const brands=n=>L.cargoBy.slice(0,n).map(([b,n])=>`${n} ${b}`).join(' · '); // count first, like Military
  $['cargo-by']._alts=L.cargoBy.length?[...new Set([brands(2),brands(1)])]:[L.night?'none yet':'from 6 pm'];
  setText($.mil,L.militaryToday||0);$['mil-by']._alts=militaryAlts(L);
  const lines=[$['seen-by'],$['cargo-by'],$['mil-by']];
  for(const e of lines){e.textContent=(e._alts||[e.textContent])[0];fitLine(e);}
  const size=Math.min(...lines.map(e=>parseFloat(getComputedStyle(e).fontSize)));for(const e of lines)e.style.fontSize=`${size}px`;
}

export default {
  name:'Glass',map:'detail',
  mount(r,c){root=r;demo=c.demo;$={};ui();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){drawMap();},
  refreshZone(){}, // the zone is drawn with the aircraft on every tick
  unmount(){root=null;$={};maps={};},
};
