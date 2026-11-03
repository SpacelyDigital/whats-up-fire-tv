// Layout 7, Blueprint: a technical drawing on navy drafting paper. The map is
// linework only (roads by weight, water outlines, runways); aircraft are outline
// silhouettes with drafting callouts on leader lines, the hero gets a dimension line
// from home, and the data lives in a title block and a revision table.
import {svg,el,setText,fmt,placeName,statusText,quietText,shapeFor,byInterest,makeCanvas,paintMap,toView,
  compass,number,placeBox,metric,KM,alertRadius,ppmOf,niceDistance,zoom,zonePath,niceStep,fitLine,photoSlot,showPhotoIn,fit,placeAlts,headingAlts} from '../kit.mjs';

const W=960,H=540,LIMIT=10.4,VIEW={cx:372,cy:292,ppm:24.5}; // the whole map radius fits below home (248 px); the frame keeps its size
// The survey limit: linework stops at a drafted border where the detail map ends.
const CLIPPED={...VIEW,clip:{x:VIEW.cx-LIMIT*VIEW.ppm,y:VIEW.cy-LIMIT*VIEW.ppm,w:2*LIMIT*VIEW.ppm,h:2*LIMIT*VIEW.ppm}};
const PAPER='#0c2d5a';
const DETAIL=[
  {layer:'water',from:'detail',fill:'rgba(140,215,255,.07)',stroke:'rgba(140,215,255,.75)',width:.9},
  {layer:'waterways',classes:['river','canal'],stroke:'rgba(140,215,255,.65)',width:.9},
  {layer:'aero',classes:['runway'],stroke:'rgba(255,255,255,.8)',width:4,cap:'butt'},
  {layer:'aero',classes:['runway'],stroke:PAPER,width:2,cap:'butt'},
  {layer:'roads',from:'detail',classes:['minor','service'],stroke:'rgba(225,240,255,.13)',width:.5},
  {layer:'roads',from:'detail',classes:['rail'],stroke:'rgba(225,240,255,.4)',width:.7,dash:[6,2,1,2],cap:'butt'},
  {layer:'roads',from:'detail',classes:['tertiary'],stroke:'rgba(225,240,255,.3)',width:.7},
  {layer:'roads',from:'detail',classes:['secondary'],stroke:'rgba(225,240,255,.45)',width:.9},
  {layer:'roads',from:'detail',classes:['primary','trunk'],stroke:'rgba(240,248,255,.7)',width:1.2},
  {layer:'roads',from:'detail',classes:['motorway'],stroke:'rgba(255,255,255,.9)',width:3.2},
  {layer:'roads',from:'detail',classes:['motorway'],stroke:PAPER,width:1.4},
];
const BASE=[
  {layer:'water',fill:'rgba(140,215,255,.07)',stroke:'rgba(140,215,255,.75)',width:.9},
  {layer:'rivers',stroke:'rgba(140,215,255,.65)',width:.9},
  {layer:'roads',classes:['trunk'],stroke:'rgba(240,248,255,.7)',width:1.2},
  {layer:'roads',classes:['motorway'],stroke:'rgba(255,255,255,.9)',width:3.2},{layer:'roads',classes:['motorway'],stroke:PAPER,width:1.4},
  {layer:'runways',stroke:'rgba(255,255,255,.8)',width:3,cap:'butt'},
];
// Areas the callouts keep out of: header, revision table, title block.
const KEEP=[{x:0,y:0,w:400,h:84},{x:690,y:0,w:270,h:150},{x:600,y:318,w:360,h:222},{x:0,y:500,w:340,h:40}];

let root,demo,$={},maps={},ringBoxes=[];

function ui(){
  $.canvas=makeCanvas(W,H,'bp-canvas');
  $.svg=svg('svg',{class:'bp-svg',viewBox:`0 0 ${W} ${H}`});
  for(const k of ['construct','dims','planes','callouts'])$.svg.append($[k]=svg('g',{class:`bp-${k}`}));
  root.append(el('div','bp-grid'),$.canvas,$.svg);
  root.insertAdjacentHTML('beforeend',`
    <header class="bp-head"><div class="bp-k">Plan view · airspace over</div><div class="bp-city"></div><div class="bp-time"><b class="bp-clock"></b><span class="bp-date"></span><span class="bp-status"></span></div></header>
    <div class="bp-side">
      <div class="bp-rev"><div class="bp-rev-h"><span>Rev</span><span>Above</span><span>Ago</span></div><div class="bp-rev-b"></div></div>
      <div class="bp-fig" hidden><div class="bp-fig-h">Fig. 1 · Aircraft</div></div>
    </div>
    <div class="bp-stamp" hidden><b class="bp-stamp-a"></b><span class="bp-stamp-b"></span></div>
    <div class="bp-block">
      <div class="bp-cell bp-obj"><i>Object</i><b class="bp-fl"></b><span class="bp-op"></span></div>
      <div class="bp-cell bp-typ"><i>Type</i><b class="bp-type"></b></div>
      <div class="bp-cell"><i>Route</i><b class="bp-route"></b></div>
      <div class="bp-cell"><i>Altitude</i><b class="bp-alt"></b></div>
      <div class="bp-cell"><i>Ground speed</i><b class="bp-spd"></b></div>
      <div class="bp-cell"><i>Heading</i><b class="bp-hdg"></b></div>
      <div class="bp-cell"><i>Closest pass</i><b class="bp-cpa"></b></div>
      <div class="bp-cell"><i>Climb</i><b class="bp-vs"></b></div>
      <div class="bp-cell bp-note" hidden></div>
    </div>
    <div class="bp-scale"></div>`);
  for(const c of ['city','clock','date','status','rev-b','stamp','stamp-a','stamp-b','fl','op','type','route','alt','spd','hdg','cpa','vs','note','scale'])
    $[c]=root.querySelector('.bp-'+c);
  $.obj=root.querySelector('.bp-obj i');fit($.city,$.obj);
  $.cells=[...root.querySelectorAll('.bp-block .bp-cell:not(.bp-note):not(.bp-foot)')];
  $.side=root.querySelector('.bp-side');$.fig=root.querySelector('.bp-fig');$.fig.append($.pic=photoSlot());
}

function construction(){
  const h=toView(VIEW,0,0),n=[],c=CLIPPED.clip;ringBoxes=[];
  n.push(svg('rect',{class:'bp-limit',x:c.x,y:c.y,width:c.w,height:c.h}),
    svg('text',{class:'bp-limitt',x:c.x+c.w-8,y:c.y+16,'text-anchor':'end'},`LIMIT OF DETAIL ±${fmt.dist(LIMIT/zoom(),LIMIT/zoom()<20?1:0).toUpperCase()}`));
  ringBoxes.push({x:c.x+c.w-190,y:c.y+2,w:190,h:20});
  // Three rings at a round step (2 mi / 3 km at the 10-mile view), rescaled with the map radius.
  // The outer ring (and its N and ticks) must stay inside the drawing frame.
  const unit=metric()?1/KM:1,ppm=ppmOf(VIEW),maxR=Math.min(c.w,c.h)/2-34;
  let step=niceStep(maxR/3/(ppm*unit));
  while(3*step*unit*ppm>maxR){const p=10**Math.floor(Math.log10(step)),m=step/p;step=(m>5?5:m>2?2:m>1?1:.5)*p;}
  n.push(svg('line',{class:'bp-center',x1:h.x,y1:0,x2:h.x,y2:H}),svg('line',{class:'bp-center',x1:0,y1:h.y,x2:W,y2:h.y}));
  for(let i=1;i<=3;i++){
    const r=i*step*unit*ppm;
    n.push(svg('circle',{class:'bp-ring',cx:h.x,cy:h.y,r}));
    const a=-Math.PI/4,tx=h.x+Math.cos(a)*r,ty=h.y+Math.sin(a)*r;
    n.push(svg('text',{class:'bp-ringt',x:tx+4,y:ty-4},`R ${+(i*step).toPrecision(3)} ${metric()?'KM':'MI'}`));ringBoxes.push({x:tx,y:ty-18,w:50,h:18});
  }
  // The alert zone (a wedge can be long) is clipped to the drawing frame.
  const clip=svg('clipPath',{id:'bp-frame'});clip.append(svg('rect',{x:c.x,y:c.y,width:c.w,height:c.h}));
  n.push(clip,svg('path',{class:'bp-alert',d:zonePath((x,y)=>toView(VIEW,x,y)),'clip-path':'url(#bp-frame)'}));
  n.push(svg('circle',{class:'bp-datum',cx:h.x,cy:h.y,r:7}),svg('line',{class:'bp-datumx',x1:h.x-11,y1:h.y,x2:h.x+11,y2:h.y}),
    svg('line',{class:'bp-datumx',x1:h.x,y1:h.y-11,x2:h.x,y2:h.y+11}),svg('text',{class:'bp-datumt',x:h.x+10,y:h.y+20},'DATUM · HOME'));
  // Compass rose ticks on the outer ring.
  const R=3*step*unit*ppm;
  for(let d=0;d<360;d+=10){
    const a=d*Math.PI/180,l=d%90?5:12;
    n.push(svg('line',{class:'bp-tick',x1:h.x+Math.sin(a)*R,y1:h.y-Math.cos(a)*R,x2:h.x+Math.sin(a)*(R+l),y2:h.y-Math.cos(a)*(R+l)}));
  }
  n.push(svg('text',{class:'bp-north',x:h.x,y:h.y-R-16,'text-anchor':'middle'},'N'));
  $.construct.replaceChildren(...n);
  const bar=niceDistance(VIEW,40),px=bar.px;
  $.scale.innerHTML=`<i style="width:${(px*2).toFixed(0)}px"><em></em><em></em></i><span>0</span><span style="left:${px.toFixed(0)}px">${+bar.value.toPrecision(3)}</span><span style="left:${(px*2).toFixed(0)}px">${+(bar.value*2).toPrecision(3)} ${metric()?'KM':'MI'}</span>`;
}

function drawMap(){paintMap($.canvas,maps,CLIPPED,maps.detail?DETAIL:BASE);construction();}

// Arrowhead pair for a dimension line from a to b.
function dimension(a,b,label){
  const ang=Math.atan2(b.y-a.y,b.x-a.x),len=Math.hypot(b.x-a.x,b.y-a.y);
  if(len<30)return [];
  const off=14,nx=-Math.sin(ang)*off,ny=Math.cos(ang)*off,A={x:a.x+nx,y:a.y+ny},B={x:b.x+nx,y:b.y+ny};
  const head=(p,dir)=>{const s=7,w=.38;return `M${p.x} ${p.y}L${p.x+Math.cos(ang+dir*Math.PI-w)*s} ${p.y+Math.sin(ang+dir*Math.PI-w)*s}L${p.x+Math.cos(ang+dir*Math.PI+w)*s} ${p.y+Math.sin(ang+dir*Math.PI+w)*s}Z`;};
  let deg=ang*180/Math.PI;if(deg>90)deg-=180;if(deg<-90)deg+=180;
  const mx=(A.x+B.x)/2+nx*.7,my=(A.y+B.y)/2+ny*.7;
  return [svg('line',{class:'bp-ext',x1:a.x,y1:a.y,x2:A.x+nx*.3,y2:A.y+ny*.3}),svg('line',{class:'bp-ext',x1:b.x,y1:b.y,x2:B.x+nx*.3,y2:B.y+ny*.3}),
    svg('line',{class:'bp-dim',x1:A.x,y1:A.y,x2:B.x,y2:B.y}),svg('path',{class:'bp-arrow',d:head(A,0)+head(B,1)}),
    svg('text',{class:'bp-dimt',x:mx,y:my,'text-anchor':'middle',transform:`rotate(${deg.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})`},label)];
}

function render(m){
  const {now,hero}=m;
  setText($.city,'',placeAlts().map(s=>s.toUpperCase()));setText($.clock,fmt.clock(now));
  setText($.date,fmt.date(now,{weekday:'short',day:'numeric',month:'short'}).toUpperCase());
  setText($.status,statusText(m,demo).toUpperCase());$.status.classList.toggle('off',!demo&&!m.fresh&&!m.connecting);
  root.classList.toggle('emergency',!!hero?.emergency);

  const planes=[],callouts=[],boxes=[...KEEP,...ringBoxes,...(hero?.emergency?[{x:420,y:14,w:230,h:100}]:[])],bounds={x:6,y:6,w:W-12,h:H-12};
  const home=toView(VIEW,0,0);boxes.push({x:home.x-60,y:home.y-14,w:120,h:40});
  showPhotoIn($.pic,hero,()=>{$.fig.hidden=$.pic.hidden;});
  if(!$.fig.hidden)boxes.push({x:$.side.offsetLeft-6,y:$.side.offsetTop-6,w:$.side.offsetWidth+12,h:$.side.offsetHeight+12});
  const shown=byInterest(m).filter(a=>{const p=toView(VIEW,a.x,a.y);return p.x>-10&&p.x<W+10&&p.y>-10&&p.y<H+10;});
  for(const a of shown){
    const p=toView(VIEW,a.x,a.y),isHero=a===hero;
    const g=svg('g',{class:`bp-plane${isHero?' hero':''}${a.military?' mil':''}`,'data-hex':a.hex,transform:`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${a.heading||0}) scale(${(isHero?32:22)/64})`});
    g.append(svg('path',{d:shapeFor(a)}));planes.push(g);
    // Heading vector: a short construction line ahead of the nose.
    if(number(a.heading)){const r=a.heading*Math.PI/180,l=isHero?34:22;
      planes.push(svg('line',{class:'bp-vec',x1:p.x+Math.sin(r)*(isHero?17:12),y1:p.y-Math.cos(r)*(isHero?17:12),x2:p.x+Math.sin(r)*(isHero?17+l:12+l),y2:p.y-Math.cos(r)*(isHero?17+l:12+l)}));}
    boxes.push({x:p.x-10,y:p.y-10,w:20,h:20});
  }
  for(const a of shown.slice(0,7)){
    const p=toView(VIEW,a.x,a.y),isHero=a===hero;
    const l1=a.flight,l2=[a.aircraft_type,fmt.alt(a.altitude_ft),fmt.speed(a.speed_kt)].filter(Boolean).join(' · ').toUpperCase();
    const w=Math.max(l1.length*(isHero?11:9.4),l2.length*6.9)+8,h=isHero?40:34,rise=isHero?46:34;
    const spots=[[rise,-rise-h],[-rise-w,-rise-h],[rise,rise-h+h],[-rise-w,rise],[rise+30,-rise-h-20],[-rise-w-30,-rise-h-20]];
    const b=placeBox(boxes,p,w,h,spots,bounds);if(!b)continue;
    const right=b.x>p.x,shelfY=b.y+h-(isHero?4:2),elbow={x:right?b.x:b.x+w,y:shelfY};
    callouts.push(svg('circle',{class:'bp-dot',cx:p.x,cy:p.y,r:2.2}),
      svg('polyline',{class:`bp-leader${isHero?' hero':''}`,points:`${p.x},${p.y} ${elbow.x},${elbow.y} ${right?b.x+w:b.x},${shelfY}`}));
    const t=svg('text',{class:`bp-call${isHero?' hero':''}`,x:b.x+4,y:b.y+(isHero?19:16)});
    t.append(svg('tspan',{class:'a'},l1),svg('tspan',{class:'b',x:b.x+4,dy:isHero?15:13},l2));
    callouts.push(t);
  }
  $.planes.replaceChildren(...planes);$.callouts.replaceChildren(...callouts);
  $.dims.replaceChildren(...(hero?dimension(home,toView(VIEW,hero.x,hero.y),fmt.dist(hero.ground).toUpperCase()):[]));

  $.stamp.hidden=!hero?.emergency;
  if(hero?.emergency){setText($['stamp-a'],`SQUAWK ${hero.squawk}`);setText($['stamp-b'],hero.emergency);}
  for(const c of $.cells)c.hidden=!hero;$.note.hidden=!!hero;
  if(!hero)setText($.note,`NOTE 1: ${quietText(m,demo).toUpperCase()}`);
  if(hero){
    setText($.obj,'',headingAlts(hero,'Object'));setText($.fl,hero.flight);setText($.op,(hero.operator||'').toUpperCase());
    $.type._alts=[...new Set([hero.type,hero.aircraft_type,'UNKNOWN'].filter(Boolean).map(s=>s.toUpperCase()))];fitLine($.type);
    setText($.route,hero.route?`${hero.route.origin} → ${hero.route.destination}`:'NOT FILED');
    setText($.alt,fmt.alt(hero.altitude_ft).toUpperCase());setText($.spd,fmt.speed(hero.speed_kt).toUpperCase());
    setText($.hdg,number(hero.heading)?`${String(Math.round(hero.heading)).padStart(3,'0')}° ${compass(hero.heading)}`:'—');
    setText($.vs,fmt.vs(hero.vertical).toUpperCase());
    const c=hero.cpa;setText($.cpa,!c?'—':c.receding?'PASSED':`${fmt.mmss(c.seconds)} · ${fmt.dist(c.miles).toUpperCase()}`);
  }
  const rec=m.recent.slice(0,4);
  $['rev-b'].replaceChildren(...(rec.length?rec.map((a,i)=>{
    const r=el('div','bp-rev-r');r.append(el('span','',String.fromCharCode(65+i)),el('b','',a.flight),el('span','',fmt.ago(a.last_seen,now).toUpperCase()));return r;
  }):[el('div','bp-rev-r none','NO REVISIONS')]));
}

export default {
  name:'Blueprint',map:'detail',
  mount(r,c){root=r;demo=c.demo;$={};ui();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){drawMap();},
  unmount(){root=null;$={};maps={};},
};
