'use strict';
(()=>{
const __modules=window.__whatsupModules;
const {svg,el,setText,overlap,fmt,placeName,alertRadius,statusText,quietText,byInterest,paintMap,airportsNear,
  number,BASE_RANGE,range,zoom,zonePath,photoSlot,showPhotoIn,fit,placeAlts,headingAlts}=__modules["kit.mjs"];
// Layout 9, Synthwave: a neon sunset. The map is a glowing grid floor tilted with a
// CSS 3D transform (looking north from behind home); planes are glowing chevrons in a
// flat overlay, placed with the same perspective maths and lifted by altitude, so
// their labels stay upright and readable. Map: water, rivers, motorways, runways.

// Floor: a W x H canvas (1 px per CSS px: a soft neon floor needs no more), home at its
// centre, rotated about its centre by TILT under a perspective of PERSP px seen from VP.
const W=1400,H=640,PPM=30,TILT=60,PERSP=600,VP={x:480,y:232},HOME_Y=380;
const LEFT=480-W/2,TOP=HOME_Y-H/2;
const MAP=[
  {layer:'water',fill:'rgba(0,229,255,.16)',stroke:'rgba(0,229,255,.75)',width:1.6,glow:8},
  {layer:'rivers',stroke:'rgba(0,229,255,.8)',width:2,glow:8},
  {layer:'roads',classes:['trunk'],stroke:'rgba(255,60,200,.7)',width:1.6,glow:8},
  {layer:'roads',classes:['motorway'],stroke:'#ff3cc8',width:2.4,glow:12},
  {layer:'runways',stroke:'#ffe45c',width:3,glow:10,cap:'butt'},
];

// Floor point (miles east/north of home) -> screen point, and its depth scale.
const COS=Math.cos(TILT*Math.PI/180),SIN=Math.sin(TILT*Math.PI/180);
function project(x,y){
  const k=PPM*zoom(),Y=-y*k,X=x*k; // floor-local, relative to the rotation origin (home); the grid stays 1 per PPM px
  const yy=Y*COS,z=Y*SIN,s=PERSP/(PERSP-z);
  const ox=LEFT+W/2+X,oy=TOP+H/2+yy;
  return {x:VP.x+(ox-VP.x)*s,y:VP.y+(oy-VP.y)*s,s};
}

let root,demo=false,$={},maps={};

function floorCanvas(){
  const c=el('canvas','floor-map');c.width=W;c.height=H;c.style.width=`${W}px`;c.style.height=`${H}px`;c._k=1;return c;
}

function ui(){
  root.innerHTML=`
    <div class="sky"><div class="stars"></div><div class="sun"></div></div>
    <div class="world"><div class="floor"></div></div>
    <div class="haze"></div>
    <div class="hdr"><div class="city"></div><div class="clock"></div><div class="date"></div></div>
    <div class="hcard">
      <div class="h-label"></div>
      <div class="h-fl"></div>
      <div class="h-rt"></div>
      <div class="h-row"><span><i>ALT</i><b class="h-alt"></b></span><span><i>SPD</i><b class="h-spd"></b></span><span><i>CPA</i><b class="h-cpa"></b></span></div>
      <div class="h-type"></div>
    </div>
    <div class="mayday" hidden><div class="m1">MAYDAY</div><div class="m2"></div></div>
    <div class="quiet" hidden><div class="q1">QUIET SKIES</div><div class="q2"></div></div>
    <div class="strip">
      <span><i>CARGO</i><b class="s-cargo"></b></span>
      <span><i>MILITARY</i><b class="s-mil"></b></span>
      <span><i>SEEN TODAY</i><b class="s-seen"></b></span>
      <span><i>HIGHEST</i><b class="s-high"></b></span>
      <span><i>LAST ABOVE</i><b class="s-last"></b></span>
      <span class="s-status"></span>
    </div>`;
  const floor=root.querySelector('.floor');
  Object.assign(floor.style,{left:`${LEFT}px`,top:`${TOP}px`,width:`${W}px`,height:`${H}px`});
  root.querySelector('.world').style.perspectiveOrigin=`${VP.x}px ${VP.y}px`;
  $.canvas=floorCanvas();floor.append($.canvas);
  $.svg=svg('svg',{class:'fly',viewBox:'0 0 960 540','aria-hidden':'true'});
  for(const id of ['marks','stalks','jets','tags'])$.svg.append($[id]=svg('g'));
  root.querySelector('.world').after($.svg);
  for(const c of ['city','clock','date','hcard','h-label','h-fl','h-rt','h-alt','h-spd','h-cpa','h-type','mayday','m2','quiet','q2',
    's-cargo','s-mil','s-seen','s-high','s-last','s-status'])$[c]=root.querySelector('.'+c);
  $.hcard.append($.pic=photoSlot());
  fit($.city,$['h-label']);
}

function drawMap(){
  paintMap($.canvas,maps,{cx:W/2,cy:H/2,ppm:PPM},MAP);
  // Grid under the map: a line every mile, brighter every 5.
  const g=$.canvas.getContext('2d');
  g.save();g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='destination-over';
  for(const major of [true,false]){
    g.beginPath();
    for(let i=-Math.ceil(W/2/PPM);i<=W/2/PPM;i++){if((i%5===0)!==major)continue;const x=W/2+i*PPM;g.moveTo(x,0);g.lineTo(x,H);}
    for(let i=-Math.ceil(H/2/PPM);i<=H/2/PPM;i++){if((i%5===0)!==major)continue;const y=H/2+i*PPM;g.moveTo(0,y);g.lineTo(W,y);}
    g.strokeStyle=major?'rgba(255,79,216,.75)':'rgba(176,64,255,.42)';g.lineWidth=major?2:1.2;
    g.shadowColor='#ff4fd8';g.shadowBlur=major?6:0;g.stroke();
  }
  g.restore();
  // Ground marks drawn flat in the overlay: home, alert ring, airports.
  const m=[],ring=[];
  m.push(svg('path',{class:'alert',d:zonePath(project)}));
  const h=project(0,0);
  m.push(svg('path',{class:'home',d:`M${h.x} ${h.y-9}L${h.x+12} ${h.y}L${h.x} ${h.y+9}L${h.x-12} ${h.y}Z`}),
    svg('text',{class:'home-t',x:h.x,y:h.y+26,'text-anchor':'middle'},'HOME'));
  for(const a of airportsNear(maps,BASE_RANGE+1,4)){
    const p=project(a.x,a.y);if(p.y<VP.y+6||p.y>530||p.x<10||p.x>950)continue;
    m.push(svg('text',{class:'apt',x:p.x,y:p.y-8,'text-anchor':'middle'},a.iata||a.code));
  }
  $.marks.replaceChildren(...m);
}

const CHEV='M0 -13L10 9L0 3L-10 9Z';
function render(m){
  const {now,hero}=m;
  setText($.city,'',placeAlts());setText($.clock,fmt.clock(now));
  setText($.date,fmt.date(now,{weekday:'long',day:'numeric',month:'long'}));
  setText($['s-status'],statusText(m,demo));$['s-status'].classList.toggle('off',!demo&&!m.fresh&&!m.connecting);
  root.classList.toggle('emergency',!!hero?.emergency);

  const stalks=[],jets=[],tags=[],boxes=[{x:0,y:0,w:960,h:VP.y-14},{x:0,y:470,w:600,h:70}];
  const tagged=new Set(byInterest(m).slice(0,6));
  const order=[...m.planes].sort((a,b)=>(b===hero)-(a===hero)||b.y-a.y); // hero, then far (north) first
  for(const a of order){
    if(a.ground>range()*1.2)continue;
    const g=project(a.x,a.y);
    let off=false,gx=g.x,gy=g.y;
    if(gy>522||gx<14||gx>946){off=true;gx=Math.max(24,Math.min(936,gx));gy=Math.min(gy,522);}
    const isHero=a===hero,cls=`${isHero?'hero':''}${a.inside?' inside':''}${a.cargo?' cargo':''}${a.military?' mil':''}${off?' off':''}`;
    const lift=off?0:Math.min(70,(a.altitude_ft||0)/40000*70)*Math.min(1.25,g.s);
    const px=gx,py=gy-lift;
    if(!off){
      stalks.push(svg('line',{class:`stalk ${cls}`,x1:gx,y1:gy,x2:px,y2:py}),svg('ellipse',{class:`shadow ${cls}`,cx:gx,cy:gy,rx:7*g.s,ry:2.2*g.s}));
    }
    // Screen heading: where the floor point a little ahead projects to.
    let rot=0;
    if(number(a.heading)){
      const h=a.heading*Math.PI/180,q=project(a.x+Math.sin(h)*.4,a.y+Math.cos(h)*.4);
      rot=Math.atan2(q.x-g.x,-(q.y-g.y))*180/Math.PI;
    }
    const size=off?.8:Math.max(.75,Math.min(1.35,.6+g.s*.45))*(isHero?1.35:1);
    jets.push(svg('path',{class:`jet ${cls}`,'data-hex':a.hex,d:CHEV,transform:`translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${size.toFixed(2)})`}));
    if(tagged.has(a)){
      const alt=fmt.altUnit()==='m'?fmt.alt(a.altitude_ft):fmt.hundreds(a.altitude_ft);
      const l2=off?`↓ ${fmt.dist(a.ground,0)} S`:alt,w=Math.max(a.flight.length*11,l2.length*9)+4,h=32;
      const spot=[[16,-16],[-16-w,-16],[16,-40],[-16-w,-40],[16,10],[-16-w,10]].map(([dx,dy])=>({x:px+dx,y:py+dy,w,h}))
        .find(b=>b.x>4&&b.x+w<956&&b.y+h<536&&!boxes.some(o=>overlap(o,b)));
      if(spot||isHero){
        const b=spot||{x:px+16,y:py-16,w,h};boxes.push(b);
        tags.push(svg('text',{class:`tag ${cls}`,x:b.x,y:b.y+13},a.flight),svg('text',{class:`tag2 ${cls}`,x:b.x,y:b.y+28},l2));
      }
    }
  }
  $.stalks.replaceChildren(...stalks);$.jets.replaceChildren(...jets);$.tags.replaceChildren(...tags);

  $.hcard.hidden=!hero;$.quiet.hidden=!!hero;$.mayday.hidden=!hero?.emergency;
  showPhotoIn($.pic,hero);
  if(!hero)setText($.q2,quietText(m,demo));
  else{
    setText($['h-label'],'',headingAlts(hero,`${hero.status} · ${fmt.dist(hero.ground)}`));
    setText($['h-fl'],hero.flight);$['h-fl'].classList.toggle('long',hero.flight.length>8);
    setText($['h-rt'],hero.route?`${hero.route.from?.city||hero.route.origin} → ${hero.route.to?.city||hero.route.destination}`:(hero.operator||'Route not reported'));
    setText($['h-alt'],fmt.alt(hero.altitude_ft));setText($['h-spd'],fmt.speed(hero.speed_kt));
    const c=hero.cpa;setText($['h-cpa'],!c?'—':c.receding?'leaving':fmt.mmss(c.seconds));
    setText($['h-type'],[hero.operator,hero.type||hero.aircraft_type].filter(Boolean).join(' · '));
    if(hero.emergency)setText($.m2,`${hero.flight} · SQUAWK ${hero.squawk} · ${hero.emergency}`);
  }
  const L=m.log;
  setText($['s-cargo'],String(L.cargoTonight));setText($['s-mil'],String(L.militaryToday||0));setText($['s-seen'],fmt.int(L.today));
  setText($['s-high'],L.highest?fmt.alt(L.highest.value):'—');
  const r=m.recent[0];setText($['s-last'],r?`${r.flight} ${fmt.ago(r.last_seen,now)}`:'—');
}


window.__whatsupLayout("synthwave",{
  name:'Synthwave',map:'base',
  mount(r,c){root=r;demo=c.demo;$={};ui();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){drawMap();},
  unmount(){root=null;$={};maps={};},
});
})();
