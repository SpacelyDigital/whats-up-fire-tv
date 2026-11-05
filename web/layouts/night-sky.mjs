// Layout 12, Night Sky: no streets. A black sky, the aircraft as stars dragging soft
// contrails that fade over several minutes, the coastline and rivers barely there,
// and small serif labels.
import {el,svg,setText,fmt,metric,placeName,statusText,quietText,byInterest,makeCanvas,paintMap,toView,
  TrailBook,placeBox,number,ppmOf,alertRadius,range,zonePath,fit,placeAlts,headingAlts} from '../kit.mjs';

const W=960,H=540,TRAIL_AGE=8*60000;
const VIEW={cx:480,cy:300,ppm:24};
const MAP=[
  {layer:'water',fill:'rgba(120,150,205,.075)'},
  {layer:'rivers',stroke:'rgba(150,175,215,.14)',width:1},
];
const city=s=>String(s||'').split(/[\/(,]/)[0].replace(/\s+(International|Regional|Municipal|Airport|Intl)\b.*$/i,'').trim();

let root,demo=false,$={},maps={},trails=null,radius=3,ctx=null;

// A fixed field of faint stars for this place (same every night).
function rng(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function paint(){
  paintMap($.canvas,maps,VIEW,MAP);
  const g=$.canvas.getContext('2d'),p=ctx?.place();
  const rand=rng(Math.round((p?.latitude||0)*1000)^Math.round((p?.longitude||0)*1000));
  for(let i=0;i<300;i++){
    const x=rand()*W,y=rand()*H,r=rand()**3*1.3+.25,a=.12+rand()*.5;
    g.fillStyle=`rgba(${215+rand()*40|0},${225+rand()*30|0},255,${a.toFixed(2)})`;
    g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();
  }
}

function ui(){
  root.innerHTML=`
    <div class="twinkles"></div>
    <header class="top">
      <div class="over"><div class="pre">the sky over</div><div class="city"></div></div>
      <div class="time"><div class="clock"></div><div class="date"></div></div>
    </header>
    <div class="quiet-note" hidden><div class="big">A quiet sky.</div><div class="small"></div></div>
    <footer class="foot"><div></div><div class="count"></div></footer>`;
  for(const c of ['twinkles','city','clock','date','quiet-note','count'])$[c]=root.querySelector('.'+c);
  $.canvas=makeCanvas(W,H,'sky');root.prepend($.canvas);
  $.svg=svg('svg',{class:'stars',viewBox:`0 0 ${W} ${H}`,'aria-hidden':'true'});
  const defs=svg('defs');
  for(const [id,c] of [['ns-halo','#dfeaff'],['ns-halo-warm','#ffd9a0'],['ns-halo-mil','#cfe6a0'],['ns-halo-red','#ff5a4a']]){
    const r=svg('radialGradient',{id});
    r.append(svg('stop',{offset:'0','stop-color':c,'stop-opacity':.55}),svg('stop',{offset:'.35','stop-color':c,'stop-opacity':.16}),svg('stop',{offset:'1','stop-color':c,'stop-opacity':0}));
    defs.append(r);
  }
  $.grads=svg('g');defs.append($.grads);
  $.svg.append(defs);
  for(const k of ['home','trails','planes','labels'])$.svg.append($[k]=svg('g',{class:k}));
  $['quiet-note'].before($.svg);
  // A few stars that twinkle (CSS only).
  const rand=rng(7);
  for(let i=0;i<16;i++){const s=el('i');s.style.cssText=`left:${(rand()*W)|0}px;top:${(rand()*H)|0}px;animation-delay:${(rand()*6).toFixed(1)}s;animation-duration:${(4+rand()*5).toFixed(1)}s`;$.twinkles.append(s);}
  drawHome();
}
function drawHome(){
  const {cx,cy}=VIEW,ppm=ppmOf(VIEW);
  $.home.replaceChildren(svg('path',{class:'ring',d:zonePath((x,y)=>({x:cx+x*ppm,y:cy-y*ppm}))}),svg('circle',{class:'me',cx,cy,r:3.2}));
}

// Trails are in miles from home: a new home starts them afresh (they stayed up to 8 min).
let trailHome='';
function render(m){
  const p=ctx?.place(),key=p?`${p.latitude},${p.longitude}`:'';
  if(key!==trailHome){trailHome=key;trails.clear();}
  const {now,hero}=m;
  fit($.city,$.count);setText($.city,placeName(),placeAlts());
  setText($.clock,fmt.clock(now));
  setText($.date,`${fmt.date(now,{weekday:'long',day:'numeric',month:'long'})} · ${statusText(m,demo).toLowerCase()}`);
  trails.update(m.planes,now);
  root.classList.toggle('emergency',!!hero?.emergency);

  // Contrails: every remembered track, alive or not, fading with age.
  const live=new Map(m.planes.map(a=>[a.hex,a]));
  const paths=[],grads=[];let gi=0;
  for(const [hex,pts] of trails.map){
    const a=live.get(hex),list=pts.map(p=>toView(VIEW,p.x,p.y));
    if(a)list.push(toView(VIEW,a.x,a.y));
    if(list.length<2)continue;
    const fade=a?1:Math.max(0,1-(now-pts[pts.length-1].t)/TRAIL_AGE);
    const head=list[list.length-1],tail=list[0],id=`ns-g${gi++}`;
    const grad=svg('linearGradient',{id,gradientUnits:'userSpaceOnUse',x1:tail.x.toFixed(1),y1:tail.y.toFixed(1),x2:head.x.toFixed(1),y2:head.y.toFixed(1)});
    const tone=a?.emergency?'#ff6b5c':a?.military?'#d6ebab':a?.cargo?'#ffe0b0':'#dbe8ff';
    grad.append(svg('stop',{offset:'0','stop-color':tone,'stop-opacity':0}),svg('stop',{offset:'1','stop-color':tone,'stop-opacity':(.6*fade).toFixed(2)}));
    grads.push(grad);
    const d=`M${list.map(p=>`${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}`;
    paths.push(svg('path',{class:'glow',d,stroke:`url(#${id})`}),svg('path',{class:'core',d,stroke:`url(#${id})`}));
  }
  $.grads.replaceChildren(...grads);$.trails.replaceChildren(...paths);

  // Stars: low aircraft burn brighter.
  const stars=[],labels=[],boxes=[{x:0,y:0,w:W,h:96},{x:0,y:H-50,w:W,h:50},{x:VIEW.cx-8,y:VIEW.cy-8,w:16,h:16}];
  const order=byInterest(m);
  for(const a of order.slice().reverse()){
    const p=toView(VIEW,a.x,a.y);
    if(p.x<-20||p.y<-20||p.x>W+20||p.y>H+20)continue;
    const low=number(a.altitude_ft)?Math.max(0,Math.min(1,1-a.altitude_ft/40000)):.5,isHero=a===hero;
    const halo=a.emergency?'ns-halo-red':a.military?'ns-halo-mil':a.cargo?'ns-halo-warm':'ns-halo';
    const g=svg('g',{class:`star${isHero?' hero':''}${a.emergency?' sos':''}`,'data-hex':a.hex,transform:`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`});
    g.append(svg('circle',{class:'halo',r:(isHero?26:12+low*8).toFixed(1),fill:`url(#${halo})`}),
      svg('circle',{class:'dot',r:(isHero?3.2:1.6+low*1.2).toFixed(1)}));
    stars.push(g);
  }
  for(const a of order.slice(0,8)){
    const p=toView(VIEW,a.x,a.y),isHero=a===hero;
    if(p.x<0||p.y<0||p.x>W||p.y>H)continue;
    if(isHero){
      const r=a.route;
      const l1=a.emergency?`${a.flight} · ${a.squawk?`squawk ${a.squawk} · `:''}${a.emergency.toLowerCase()}`:a.flight;
      const l2=[r?`${city(r.from?.city)||r.origin} to ${city(r.to?.city)||r.destination}`:a.operator||a.type||'',fmt.alt(a.altitude_ft)].filter(Boolean).join(', ');
      const w=Math.max(l1.length*9.5,l2.length*7.4)+8,h=40;
      // Near an edge none of the spots may fit: keep it clear of the header and footer.
      const b=placeBox(boxes,p,w,h,[[22,-h-6],[-w-22,-h-6],[22,10],[-w-22,10]],{x:6,y:96,w:W-12,h:H-146})||
        {x:Math.max(6,Math.min(W-w-6,p.x+(p.x>W/2?-w-22:22))),y:Math.max(100,Math.min(H-54-h,p.y-h-6)),w,h};
      const left=b.x<p.x,t=svg('text',{class:'hero-label',x:b.x+(left?w:0),y:b.y+17,'text-anchor':left?'end':'start'});
      t.append(svg('tspan',{class:'l1'},l1),svg('tspan',{class:'l2',x:b.x+(left?w:0),dy:20},l2));
      labels.push(svg('line',{class:'tick',x1:p.x+(left?-7:7),y1:p.y+(b.y<p.y?-7:7),x2:left?b.x+w+4:b.x-4,y2:b.y<p.y?b.y+h-6:b.y+8}),t);
    }else{
      const w=a.flight.length*7+6,h=14;
      const b=placeBox(boxes,p,w,h,[[9,-17],[-w-9,-17],[9,4],[-w-9,4]],{x:6,y:0,w:W-12,h:H});
      if(b)labels.push(svg('text',{class:'label',x:b.x+(b.x<p.x?w:0),y:b.y+11,'text-anchor':b.x<p.x?'end':'start'},a.flight));
    }
  }
  $.planes.replaceChildren(...stars);$.labels.replaceChildren(...labels);

  $['quiet-note'].hidden=!!hero;
  if(!hero)setText($['quiet-note'].lastChild,(demo||m.fresh)&&!m.noCoverage?`Nothing within ${fmt.dist(range(),0)} right now.`:quietText(m,demo));
  // Everything drawn counts (the sky reaches a little past the map radius at the sides).
  const n=m.planes.filter(a=>{const p=toView(VIEW,a.x,a.y);return p.x>=0&&p.y>=0&&p.x<=W&&p.y<=H;}).length;
  // Browsing (Left/Right): the chosen plane's number in the list, and where it is.
  const seen=`${fmt.int(m.log.today)} seen today`,head=headingAlts(hero,'');
  setText($.count,'',hero?.browse?[...head.map(h=>`${h} · ${seen}`),...head]:[`${n?`${n} aircraft in this sky`:'no aircraft in this sky'} · ${seen}`]);
}

export default {
  name:'Night Sky',map:'base',
  mount(r,c){root=r;ctx=c;demo=c.demo;$={};trails=new TrailBook(TRAIL_AGE,4000);radius=alertRadius();ui();paint();},
  setMap(m){maps=m;paint();},
  render,
  refresh(){radius=alertRadius();drawHome();},
  unmount(){trails?.clear();trails=null;root=null;$={};maps={};ctx=null;},
};
