// Layout 11, Cockpit: a Boeing-style navigation display in centred map mode, north up.
// Home is own-ship; traffic uses TCAS symbols with relative-altitude tags; a magenta
// line runs to the selected (hero) aircraft. Speed and altitude tapes read out the
// hero like a primary flight display. Map: airports and runways only.
import {svg,el,setText,fmt,metric,KM,placeName,alertRadius,statusText,quietText,byInterest,
  makeCanvas,paintMap,airportsNear,compass,number,BASE_RANGE,range,zoom,zonePath,photoSlot,showPhotoIn,fit,fitLine,placeAlts,airlineAlts,headingAlts} from '../kit.mjs';

const CX=300,CY=292,R=226,PPM0=R/BASE_RANGE;
let PPM=PPM0,RANGE=BASE_RANGE; // at the current map radius (set before each draw)
const setScale=()=>{RANGE=range();PPM=PPM0*zoom();};
const MAP=[{layer:'runways',stroke:'#f2f2f2',width:2.2,cap:'butt'}];
const P=(x,y)=>({x:CX+x*PPM,y:CY-y*PPM});
const deg=d=>String(Math.round(((d%360)+360)%360)).padStart(3,'0');

let root,ctx,$={},maps={},demo=false;

function ui(){
  root.innerHTML=`
    <div class="nd">
      <div class="nd-tl"><div><span class="k">GS</span><b class="gs"></b></div><div class="tas"><span class="k">ALT</span><b class="nd-alt"></b></div></div>
      <div class="nd-trk"><div class="trk-box"><span class="k">TRK</span><b class="trk"></b><span class="k mag">TRUE</span></div><div class="ann">NORTH UP</div></div>
      <div class="nd-tr"><b class="wpt"></b><div class="wpt-d"></div><div class="wpt-t"></div></div>
      <div class="warn" hidden><div class="warn-a">WARNING</div><div class="warn-b"></div></div>
      <div class="nd-bl"><div class="tfc"></div><div class="status"></div></div>
      <div class="nd-br"><div class="range-k">RANGE</div><div class="range-v"></div></div>
    </div>
    <div class="side">
      <div class="head"><div class="city"></div><div class="clock"></div></div>
      <div class="pfd">
        <svg class="tape spd-tape" viewBox="0 0 74 236"></svg>
        <div class="pfd-mid">
          <div class="k sel">SELECTED TRAFFIC</div>
          <b class="fl"></b>
          <div class="op"></div>
          <div class="rt"></div>
          <div class="vs-row"><span class="k">V/S</span><b class="vs"></b></div>
          <div class="type"></div>
          <div class="nodata" hidden><b>NO TFC</b><span class="quiet"></span></div>
        </div>
        <svg class="tape alt-tape" viewBox="0 0 84 236"></svg>
      </div>
      <div class="fields">
        <div><span class="k">GS</span><b class="f-gs"></b></div>
        <div><span class="k">TRK</span><b class="f-trk"></b></div>
        <div><span class="k">ALT</span><b class="f-alt"></b></div>
        <div><span class="k">DIST</span><b class="f-dist mag"></b></div>
        <div><span class="k">BRG</span><b class="f-brg"></b></div>
        <div><span class="k">CPA</span><b class="f-cpa"></b></div>
      </div>
      <div class="recent"></div>
      <div class="log">
        <div><span class="k">TODAY</span><b class="l-seen"></b></div>
        <div><span class="k">CARGO</span><b class="l-cargo"></b></div>
        <div><span class="k">MIL</span><b class="l-mil"></b></div>
        <div><span class="k">HIGH</span><b class="l-high"></b></div>
      </div>
    </div>`;
  const nd=root.querySelector('.nd');
  $.canvas=makeCanvas(600,540,'nd-map');
  $.svg=svg('svg',{class:'nd-svg',viewBox:'0 0 600 540','aria-hidden':'true'});
  for(const id of ['rose','apts','line','traffic','own'])$.svg.append($[id]=svg('g'));
  nd.prepend($.canvas,$.svg);
  for(const c of ['gs','nd-alt','trk','wpt','wpt-d','wpt-t','warn','warn-b','tfc','status','range-v','city','clock','spd-tape','alt-tape',
    'fl','op','rt','vs','type','nodata','quiet','pfd-mid','f-gs','f-trk','f-alt','f-dist','f-brg','f-cpa','l-seen','l-cargo','l-mil','l-high','recent'])$[c]=root.querySelector('.'+c);
  root.querySelector('.side').append($.pic=photoSlot());$.sel=root.querySelector('.sel');
  fit($.city,$.sel,$.fl,$.op,$.rt,$.type,$['f-gs'],$['f-trk'],$['f-alt'],$['f-dist'],$['f-brg'],$['f-cpa']);
}

function drawRose(){
  const n=[];
  n.push(svg('circle',{class:'rose',cx:CX,cy:CY,r:R}));
  n.push(svg('circle',{class:'half',cx:CX,cy:CY,r:R/2}));
  for(let d=0;d<360;d+=5){
    const a=d*Math.PI/180,big=d%10===0,r1=R-(big?12:6);
    n.push(svg('line',{class:'tick',x1:CX+Math.sin(a)*r1,y1:CY-Math.cos(a)*r1,x2:CX+Math.sin(a)*R,y2:CY-Math.cos(a)*R}));
    if(d%30===0){
      const rl=R-26;
      n.push(svg('text',{class:`rose-n${d%90?'':' big'}`,x:CX+Math.sin(a)*rl,y:CY-Math.cos(a)*rl+6,'text-anchor':'middle'},String(d/10)));
    }
  }
  // Lubber triangle at north (the display is north up).
  n.push(svg('path',{class:'lubber',d:`M${CX} ${CY-R-2}l-9 -14h18z`}));
  // Alert radius as a dashed cyan circle.
  setScale();
  n.push(svg('path',{class:'alert-r',d:zonePath(P)}));
  const r=metric()?RANGE*KM:RANGE;
  n.push(svg('text',{class:'range-n',x:CX-R*.707-6,y:CY-R*.707+2,'text-anchor':'end'},String(Math.round(r))));
  n.push(svg('text',{class:'range-n',x:CX-R*.354-6,y:CY-R*.354+2,'text-anchor':'end'},String(r/2>=10?Math.round(r/2):+(r/2).toPrecision(2))));
  $.rose.replaceChildren(...n);
  // Own ship (home).
  $.own.replaceChildren(svg('path',{class:'own',d:`M${CX} ${CY-13}L${CX+8} ${CY+9}L${CX} ${CY+4}L${CX-8} ${CY+9}Z`}),
    svg('text',{class:'own-t',x:CX,y:CY+26,'text-anchor':'middle'},'HOME'));
  setText($['range-v'],`${Math.round(r)} ${fmt.distUnit().toUpperCase()}`);
}

function drawMap(){
  setScale();
  paintMap($.canvas,maps,{cx:CX,cy:CY,ppm:PPM0,clip:{r:R}},MAP);
  const n=[];
  for(const a of airportsNear(maps,BASE_RANGE+.6,5)){
    const d=Math.hypot(a.x,a.y),k=d>RANGE*.91?RANGE*.91/d:1,p=P(a.x*k,a.y*k),code=a.icao||a.code;
    n.push(svg('circle',{class:'apt',cx:p.x,cy:p.y,r:7}),svg('text',{class:'apt-t',x:p.x+11,y:p.y+16},code));
  }
  $.apts.replaceChildren(...n);
}

// Relative altitude in hundreds (ft or m) above home, TCAS style: +34, -02.
function relAlt(a){
  const home=(ctx.place()?.elevationM||0)*3.2808,d=(a.altitude_ft||0)-home;
  const v=fmt.altUnit()==='m'?Math.round(d*.3048/100):Math.round(d/100);
  return `${v<0?'-':'+'}${String(Math.abs(v)).padStart(2,'0')}`;
}

function tape(node,value,{step,label,span,w,right}){
  const n=[],H=236,mid=H/2,pp=H/span;
  n.push(svg('rect',{class:'tape-bg',x:0,y:0,width:w,height:H}));
  if(number(value)){
    const lo=Math.floor((value-span/2)/step)*step;
    for(let v=lo;v<=value+span/2;v+=step){
      if(v<0)continue;
      const y=mid-(v-value)*pp,major=Math.round(v/label)*label===v;
      const x1=right?0:w-(major?14:8),x2=right?(major?14:8):w;
      n.push(svg('line',{class:'tape-tick',x1,y1:y,x2,y2:y}));
      if(major&&y>12&&y<H-8&&Math.abs(y-mid)>22)n.push(svg('text',{class:'tape-n',x:right?17:w-17,y:y+5,'text-anchor':right?'start':'end'},String(v)));
    }
    n.push(svg('path',{class:'readout',d:right?`M4 ${mid}l10 -16h${w-16}v32h-${w-16}z`:`M${w-4} ${mid}l-10 -16h-${w-16}v32h${w-16}z`}));
    n.push(svg('text',{class:'readout-n',x:right?w-6:8,y:mid+8,'text-anchor':right?'end':'start'},String(Math.round(value))));
  }else{
    n.push(svg('rect',{class:'flag',x:w/2-24,y:mid-14,width:48,height:28}),svg('text',{class:'flag-t',x:w/2,y:mid+7,'text-anchor':'middle'},right?'ALT':'SPD'));
  }
  node.replaceChildren(...n);
}

function render(m){
  const {now,hero}=m;
  setText($.city,'',placeAlts().map(s=>s.toUpperCase()));setText($.clock,fmt.clock(now,{hour:'2-digit',hour12:false}));
  setText($.status,statusText(m,demo).toUpperCase());$.status.classList.toggle('off',!demo&&!m.fresh&&!m.connecting);
  root.classList.toggle('emergency',!!hero?.emergency);

  setScale();
  const visible=m.planes.filter(a=>a.ground<=RANGE);
  const tagged=new Set(byInterest({...m,planes:visible}).slice(0,6));
  const t=[];
  for(const a of visible){
    const p=P(a.x,a.y),isHero=a===hero;
    const kind=a.emergency?'ra':a.inside?'ta':'other';
    const g=svg('g',{class:`tcas ${kind}${isHero?' hero':''}${a.military?' mil':''}`,'data-hex':a.hex,transform:`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`});
    if(kind==='ra')g.append(svg('rect',{x:-8,y:-8,width:16,height:16}));
    else if(kind==='ta')g.append(svg('circle',{r:8}));
    else g.append(svg('path',{d:'M0 -10L8 0L0 10L-8 0Z'}));
    // Track vector, two minutes ahead (miles).
    if(number(a.heading)&&number(a.speed_kt)){
      const len=Math.min(60,a.speed_kt*1.15078/60*PPM*.6),h=a.heading*Math.PI/180;
      g.append(svg('line',{class:'vec',x1:Math.sin(h)*11,y1:-Math.cos(h)*11,x2:Math.sin(h)*(11+len),y2:-Math.cos(h)*(11+len)}));
    }
    const up=a.vertical>300?'↑':a.vertical<-300?'↓':'';
    g.append(svg('text',{class:'rel',x:0,y:-14,'text-anchor':'middle'},relAlt(a)+up));
    if(tagged.has(a))g.append(svg('text',{class:'cs',x:12,y:20},a.flight));
    t.push(g);
  }
  $.traffic.replaceChildren(...t);

  const line=[];
  if(hero&&hero.ground<=RANGE){
    const p=P(hero.x,hero.y);
    line.push(svg('line',{class:'route',x1:CX,y1:CY,x2:p.x,y2:p.y}),
      svg('path',{class:'wpt-star',d:`M${p.x} ${p.y-17}l4 9 9 4-9 4-4 9-4-9-9-4 9-4z`}));
  }
  $.line.replaceChildren(...line);

  setText($.tfc,`TFC ${visible.length}`);
  $.warn.hidden=!hero?.emergency;
  if(hero?.emergency)setText($['warn-b'],`SQUAWK ${hero.squawk} · ${hero.emergency} · ${hero.flight}`);
  $.nodata.hidden=!!hero;
  root.classList.toggle('quiet',!hero);
  if(!hero){
    setText($.quiet,quietText(m,demo));
    for(const k of ['gs','nd-alt','trk','wpt','wpt-d','wpt-t','fl','op','rt','vs','type','f-gs','f-trk','f-alt','f-dist','f-brg','f-cpa'])setText($[k],'---');
    setText($.wpt,'NO TFC');
    tape($['spd-tape'],null,{step:10,label:20,span:120,w:74});
    tape($['alt-tape'],null,{step:100,label:500,span:1000,w:84,right:true});
  }else{
    const spd=!number(hero.speed_kt)?null:metric()?hero.speed_kt*1.852:hero.speed_kt,altv=fmt.altUnit()==='m'?hero.altitude_ft*.3048:hero.altitude_ft;
    tape($['spd-tape'],number(spd)?spd:null,{step:10,label:20,span:120,w:74});
    tape($['alt-tape'],number(altv)?altv:null,fmt.altUnit()==='m'?{step:20,label:100,span:300,w:84,right:true}:{step:100,label:200,span:1000,w:84,right:true});
    setText($.gs,fmt.speedNum(hero.speed_kt));setText($['nd-alt'],fmt.alt(hero.altitude_ft));
    setText($.trk,number(hero.heading)?deg(hero.heading):'---');
    setText($.wpt,hero.flight);
    setText($['wpt-d'],fmt.dist(hero.ground));
    const c=hero.cpa;
    setText($['wpt-t'],!c?'':c.receding?'OUTBOUND':`CPA ${fmt.mmss(c.seconds)}`);
    setText($.sel,'',headingAlts(hero,'SELECTED TRAFFIC').map(s=>s.toUpperCase()));
    setText($.fl,hero.flight);
    setText($.op,'',airlineAlts(hero.operator||(hero.registration?'PRIVATE':'')).map(s=>s.toUpperCase()));
    setText($.rt,hero.route?`${hero.route.origin} ▸ ${hero.route.destination}`:'NO ROUTE');
    setText($.vs,number(hero.vertical)&&Math.abs(hero.vertical)>=100?(fmt.altUnit()==='m'?fmt.vs(hero.vertical):`${hero.vertical>0?'+':'−'}${fmt.int(Math.abs(Math.round(hero.vertical/50)*50))}`):'LEVEL');
    setText($.type,[hero.aircraft_type,hero.registration].filter(Boolean).join(' · '));
    setText($['f-gs'],fmt.speed(hero.speed_kt).toUpperCase());
    setText($['f-trk'],number(hero.heading)?`${deg(hero.heading)}°`:'---');
    setText($['f-alt'],fmt.alt(hero.altitude_ft).toUpperCase());
    setText($['f-dist'],fmt.dist(hero.ground).toUpperCase());
    setText($['f-brg'],`${deg(hero.bearing)}° ${compass(hero.bearing)}`);
    setText($['f-cpa'],!c?'---':c.receding?'OUTBND':`${fmt.mmss(c.seconds)} ${fmt.dist(c.miles).toUpperCase()}`);
  }
  showPhotoIn($.pic,hero,fitSide);
  const rec=m.recent.slice(0,2);
  $.recent.replaceChildren(el('div','k','RECENT ABOVE'),...(rec.length?rec.map(a=>{
    const d=el('div','rec');d.append(el('b','',a.flight),el('span','',a.route?`${a.route.origin}▸${a.route.destination}`:a.aircraft_type||''),el('i','',fmt.ago(a.last_seen,now)));return d;
  }):[el('div','rec none','NONE YET')]));
  for(const s of $.recent.querySelectorAll('.rec span'))fitLine(s);
  $.recent._all=[...$.recent.children];
  const L=m.log;
  setText($['l-seen'],fmt.int(L.today));
  setText($['l-cargo'],String(L.cargoTonight));setText($['l-mil'],String(L.militaryToday||0));
  setText($['l-high'],L.highest?fmt.alt(L.highest.value).toUpperCase():'---');
  fitSide();
}

// The side column ends inside the screen: with a photo up, Recent above shows two rows, then
// one, then none, until the photo, its QR and credit fit (checked again when a photo loads).
function fitSide(){
  const side=$.recent?.closest('.side');if(!side||!$.recent._all)return;
  $.recent.replaceChildren(...$.recent._all);$.recent.hidden=false;
  const over=()=>side.scrollHeight>side.clientHeight+1;
  while(over()&&$.recent.children.length>1)$.recent.lastElementChild.remove();
  if(over())$.recent.hidden=true;
}

export default {
  name:'Cockpit',map:'base',
  mount(r,c){root=r;ctx=c;demo=c.demo;$={};ui();drawRose();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){drawRose();},
  unmount(){root=null;$={};maps={};},
};
