'use strict';
(()=>{
const __modules=window.__whatsupModules;
const {zoneOutline}=__modules["core.mjs"];
const {svg,el,setText,overlap,fmt,metric,KM,placeName,alertRadius,statusText,quietText,planeIcon,byInterest,
  makeCanvas,paintMap,airportsNear,placesNear,offset,compass,zoom,range,niceDistance,zonePath,windowView,alertZone,photoSlot,showPhotoIn,fit,placeAlts,militaryAlts,fitLine,headingAlts}=__modules["kit.mjs"];
// Layout 10, Sectional: a cream VFR sectional chart around home. Towns in chart
// yellow, water in chart blue, airspace-style rings around nearby airports, a VOR-style
// compass rose on home, a lat/long graticule, and the data in chart-legend boxes.


const W=680,H=540,CX=345,CY=282,PPM0=25.5,ROSE=118; // the whole map radius fits below home (258 px)
let PPM=PPM0; // at the current map radius (set before each draw)
const setScale=()=>{PPM=PPM0*zoom();};
const NM=1.15078;
const BLUE='#2a63ad',MAG='#a3237f',INK='#2a2622';
const MAP=[
  {layer:'water',fill:'#b8d5e8'},
  {layer:'rivers',stroke:'#4a83bf',width:1.6},
  {layer:'roads',from:'base',stroke:'#6b5b52',width:1.4},
  {layer:'parks',classes:['wood','park','golf_course'],fill:'rgba(132,160,92,.22)'},
  {layer:'landuse',classes:['residential','commercial','retail','industrial'],fill:'rgba(246,214,72,.62)'},
  {layer:'water',from:'detail',fill:'#b8d5e8'},
  {layer:'waterways',classes:['river','canal'],stroke:'#4a83bf',width:1.4},
  {layer:'waterways',classes:['stream'],stroke:'#6f9fcf',width:.7},
  {layer:'roads',from:'detail',classes:['primary','secondary'],stroke:'rgba(107,91,82,.75)',width:.9},
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#2a2622',width:1,dash:[1,0]},
  {layer:'roads',from:'detail',classes:['motorway','trunk'],stroke:'#6b5b52',width:1.8},
  {layer:'runways',stroke:'#2a2622',width:2.6,cap:'butt'},
];
const P=(x,y)=>({x:CX+x*PPM,y:CY-y*PPM});

let root,ctx,demo=false,$={},maps={};

function ui(){
  root.innerHTML=`
    <div class="chart"></div>
    <aside class="legend">
      <section class="box title"><div class="city"></div><div class="sub"><span class="clock"></span><span class="date"></span><span class="status"></span></div></section>
      <section class="box traffic">
        <header><span class="tl">Selected traffic</span><span class="tr hero-st"></span></header>
        <div class="notam" hidden></div>
        <div class="tbody">
          <div class="fl-row"><b class="fl"></b><span class="op"></span></div>
          <div class="rt"></div>
          <dl class="grid">
            <dt>ALT</dt><dd class="alt"></dd><dt>GS</dt><dd class="gs"></dd>
            <dt>DIST</dt><dd class="dist"></dd><dt>LOOK</dt><dd class="look"></dd>
            <dt>CPA</dt><dd class="cpa"></dd><dt>TYPE</dt><dd class="type"></dd>
          </dl>
        </div>
        <div class="none" hidden><b>NO TRAFFIC</b><span class="quiet"></span></div>
      </section>
      <section class="box tonight">
        <header><span class="tl">Tonight &amp; today</span></header>
        <div class="tn"><div><b class="cargo"></b><span>cargo</span></div><div><b class="mil"></b><span>military</span></div><div><b class="seen"></b><span>aircraft today</span></div></div>
        <div class="cargo-by"></div><div class="mil-by"></div>
      </section>
      <section class="box key">
        <header><span class="tl">Legend</span></header>
        <div class="keys">
          <div><svg viewBox="0 0 30 18"><path d="M15 2C16 2 16.4 5 16.4 7L16.4 8 27 12 27 14 16.4 11 16 15 19 17 11 17 14 15 13.6 11 3 14 3 12 13.6 8 13.6 7C13.6 5 14 2 15 2Z" fill="#1d2f5e"/></svg>Aircraft</div>
          <div><svg class="key-zone" viewBox="0 0 30 18"></svg>Alert zone</div>
          <div><svg viewBox="0 0 30 18"><path d="M2 9a13 13 0 0 1 26 0" fill="none" stroke="#2a63ad" stroke-width="3"/></svg>Major airport</div>
          <div><svg viewBox="0 0 30 18"><path d="M2 9a13 13 0 0 1 26 0" fill="none" stroke="#2a63ad" stroke-width="2.4" stroke-dasharray="5 3"/></svg>Airport</div>
          <div><svg viewBox="0 0 30 18"><path d="M11 3.8L19 3.8 23 9 19 14.2 11 14.2 7 9Z" fill="#fff" stroke="#2a63ad" stroke-width="2"/></svg>Home</div>
          <div><svg viewBox="0 0 30 18"><rect x="3" y="4" width="24" height="10" fill="rgba(246,214,72,.8)"/></svg>Built-up area</div>
        </div>
      </section>
      <section class="box photo" hidden><header><span class="tl">Aircraft</span></header></section>
    </aside>`;
  // The aircraft photo takes the legend's place while it shows (the column has room for one).
  $.key=root.querySelector('.box.key');$.photo=root.querySelector('.box.photo');$.photo.append($.pic=photoSlot());
  const chart=root.querySelector('.chart');
  $.canvas=makeCanvas(W,H,'chart-map');
  $.svg=svg('svg',{class:'chart-svg',viewBox:`0 0 ${W} ${H}`,'aria-hidden':'true'});
  for(const id of ['grat','air','rose','places','trails','planes','tags','scale'])$.svg.append($[id]=svg('g'));
  chart.append($.canvas,$.svg);
  for(const c of ['city','clock','date','status','hero-st','notam','tbody','fl','op','rt','alt','gs','dist','look','cpa','type','none','quiet','cargo','seen','cargo-by','mil','mil-by'])
    $[c]=root.querySelector('.'+c);
  fit([...root.querySelectorAll('.grid dd')],$.city,$['hero-st']);
}

let boxes=[];
function drawMap(){
  setScale();
  paintMap($.canvas,maps,{cx:CX,cy:CY,ppm:PPM0,clip:{x:0,y:0,w:W,h:H}},MAP);
  const home=ctx.place();boxes=[];
  // Graticule every 5 minutes of arc, with chart-margin labels.
  const g=[];
  const lat0=home?.latitude,lon0=home?.longitude;
  if(home){
    // Graticule every 5' at 10 mi, coarser as the map widens (whole minutes or degrees).
    const cos=Math.cos(lat0*Math.PI/180),step=([5,10,15,30,60,120,300].find(m=>m*69/60*PPM>=70)||300)/60,span=Math.max(.2,range()/69*1.6);
    const fmtDeg=(v,pos,neg)=>{const a=Math.abs(v),d=Math.floor(a+1e-9),m=Math.round((a-d)*60);return `${d}°${String(m).padStart(2,'0')}′${v>=0?pos:neg}`;};
    for(let la=Math.ceil((lat0-span)/step)*step;la<lat0+span;la+=step){
      const y=CY-(la-lat0)*69*PPM;if(y<8||y>H-8)continue;
      g.push(svg('line',{class:'grat',x1:0,y1:y,x2:W,y2:y}));if(y<H-60&&y>24)g.push(svg('text',{class:'grat-t',x:6,y:y-4},fmtDeg(la,'N','S'))); // labels whole on the map
    }
    for(let lo=Math.ceil((lon0-span*1.5)/step)*step;lo<lon0+span*1.5;lo+=step){
      const x=CX+(lo-lon0)*69.172*cos*PPM;if(x<8||x>W-8)continue;
      g.push(svg('line',{class:'grat',x1:x,y1:0,x2:x,y2:H}));if(x<W-70)g.push(svg('text',{class:'grat-t',x:x+4,y:H-8},fmtDeg(lo,'E','W')));
    }
  }
  $.grat.replaceChildren(...g);
  // Airspace-style rings: the first big airport like Class B (blue, 5 and 10 NM),
  // others like Class D (blue dashed, 4 NM); small fields magenta dashed (3 NM).
  const a=[],lab=[];
  let classB=false;
  for(const ap of airportsNear(maps,16,6)){
    const p=P(ap.x,ap.y),big=ap.kind==='international'&&!classB;
    if(big)classB=true;
    const towered=big||ap.kind==='public'||ap.kind==='regional'||ap.kind==='military'||!!ap.iata;
    const col=towered?BLUE:MAG;
    if(big)for(const nm of [5,10])a.push(svg('circle',{class:'cls-b',cx:p.x,cy:p.y,r:nm*NM*PPM}));
    else a.push(svg('circle',{class:towered?'cls-d':'cls-e',cx:p.x,cy:p.y,r:(towered?4:3)*NM*PPM}));
    a.push(svg('circle',{class:'apt',cx:p.x,cy:p.y,r:big?17:12,stroke:col}));
    const name=(ap.name||ap.code).toUpperCase().replace(/\bINTERNATIONAL\b/,'INTL').replace(/\bAIRPORT\b/,'').replace(/\s+/g,' ').trim();
    // Long names shorten by words (Cincinnati/Northern Kentucky -> Cincinnati/N. Kentucky), never "…".
    let t1=name;
    for(const [a,b] of [[/\bNORTHERN\b/,'N.'],[/\bSOUTHERN\b/,'S.'],[/\bREGIONAL\b/,'RGNL'],[/\bMUNICIPAL\b/,'MUNI'],[/\bCOUNTY\b/,'CO.']])if(t1.length>26)t1=t1.replace(a,b);
    if(t1.length>26)t1=t1.split(/[\/ ]/)[0];
    const code=`(${ap.iata||ap.icao||ap.code})`;
    const w=Math.max(t1.length*6.6,code.length*8)+4,box={x:p.x+18,y:p.y-4,w,h:30};
    if(p.x>-20&&p.x<W+20&&p.y>-20&&p.y<H+20&&!boxes.some(b=>overlap(b,box))&&box.x+w<W-4&&box.y>4&&box.y+box.h<H-4){
      boxes.push(box);
      lab.push(svg('text',{class:'apt-n',x:box.x,y:box.y+11,fill:col},t1),svg('text',{class:'apt-c',x:box.x,y:box.y+26,fill:col},code));
    }
  }
  $.air.replaceChildren(...a,...lab);
  // Towns.
  const pl=[];
  for(const t of placesNear(maps,12,{max:14})){
    const p=P(t.x,t.y),big=t.c==='city',name=t.name.toUpperCase(),w=name.length*(big?9:7)+4,h=big?16:13;
    const box={x:p.x-w/2,y:p.y-h+3,w,h};
    if(box.x<4||box.x+w>W-4||box.y<4||box.y+h>H-24||Math.hypot(p.x-CX,p.y-CY)<ROSE+10||boxes.some(b=>overlap(b,box)))continue;
    boxes.push(box);pl.push(svg('text',{class:`town${big?' big':''}`,x:p.x,y:p.y,'text-anchor':'middle'},name));
  }
  $.places.replaceChildren(...pl);
  drawRose();
}

function drawRose(){
  const n=[];
  n.push(svg('circle',{class:'rose',cx:CX,cy:CY,r:ROSE}));
  for(let d=0;d<360;d+=5){
    const a=d*Math.PI/180,len=d%30===0?14:d%10===0?9:5;
    n.push(svg('line',{class:'rose-t',x1:CX+Math.sin(a)*ROSE,y1:CY-Math.cos(a)*ROSE,x2:CX+Math.sin(a)*(ROSE-len),y2:CY-Math.cos(a)*(ROSE-len)}));
    if(d%30===0&&d)n.push(svg('text',{class:'rose-n',x:CX+Math.sin(a)*(ROSE-24),y:CY-Math.cos(a)*(ROSE-24)+5,'text-anchor':'middle',
      transform:`rotate(${d} ${CX+Math.sin(a)*(ROSE-24)} ${CY-Math.cos(a)*(ROSE-24)})`},String(d/10).padStart(2,'0')));
  }
  n.push(svg('path',{class:'rose-arrow',d:`M${CX} ${CY-ROSE-16}l7 16h-14z`}),svg('text',{class:'rose-north',x:CX,y:CY-ROSE-20,'text-anchor':'middle'},'N'));
  n.push(svg('path',{class:'alert',d:zonePath(P)}));
  // VOR-style hexagon on home.
  const hex=[...Array(6)].map((_,i)=>{const a=(i*60+30)*Math.PI/180;return `${(CX+Math.cos(a)*9).toFixed(1)} ${(CY+Math.sin(a)*9).toFixed(1)}`;}).join('L');
  n.push(svg('path',{class:'hex',d:`M${hex}Z`}),svg('circle',{class:'hex-dot',cx:CX,cy:CY,r:2.2}));
  if(!windowView()&&CY+alertRadius()*PPM-5<H-40)n.push(svg('text',{class:'alert-t',x:CX,y:CY+alertRadius()*PPM-5,'text-anchor':'middle'},`ALERT ${fmt.dist(alertRadius(),0).toUpperCase()}`));
  $.rose.replaceChildren(...n);
  // Legend: the zone as it is drawn, a ring (All around) or the window's wedge.
  // Legend: the zone's own outline (ring or wedge), scaled to fit the 30x18 key.
  const k=root.querySelector('.key-zone'),pts=zoneOutline(alertZone());
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),kx0=Math.min(...xs),kx1=Math.max(...xs),ky0=Math.min(...ys),ky1=Math.max(...ys);
  const f=Math.min(24/(kx1-kx0||1),14/(ky1-ky0||1)),ox=15-(kx0+kx1)/2*f,oy=9+(ky0+ky1)/2*f;
  if(k)k.replaceChildren(svg('path',{d:'M'+pts.map(([x,y])=>`${(ox+x*f).toFixed(1)} ${(oy-y*f).toFixed(1)}`).join('L')+'Z',
    fill:'rgba(163,35,127,.12)',stroke:'#a3237f','stroke-width':1.6,'stroke-dasharray':'2 2.4'}));
  // Scale bar: 0-5 miles (or 0-8 km).
  const km=metric(),bar=niceDistance({ppm:PPM0},120),len=5,px=bar.px,x0=18,y0=H-34,s=[];
  s.push(svg('rect',{class:'scale-bg',x:x0-8,y:y0-18,width:px+48,height:30}));
  for(let i=0;i<len;i++)s.push(svg('rect',{class:i%2?'sc-w':'sc-b',x:x0+i*px/len,y:y0,width:px/len,height:5}));
  s.push(svg('text',{class:'sc-t',x:x0,y:y0-5},'0'),svg('text',{class:'sc-t',x:x0+px,y:y0-5,'text-anchor':'middle'},String(+bar.value.toPrecision(3))),
    svg('text',{class:'sc-t',x:x0+px+10,y:y0+6},km?'KM':'MI'));
  $.scale.replaceChildren(...s);
}

function render(m){
  const {now,hero}=m;
  setText($.city,'',placeAlts().map(s=>s.toUpperCase()));setText($.clock,fmt.clock(now));
  setText($.date,fmt.date(now,{weekday:'short',day:'numeric',month:'short'}).toUpperCase());
  setText($.status,statusText(m,demo).toUpperCase());$.status.classList.toggle('off',!demo&&!m.fresh&&!m.connecting);
  root.classList.toggle('emergency',!!hero?.emergency);

  const visible=m.planes.filter(a=>Math.abs(P(a.x,a.y).x-W/2)<W/2+10&&Math.abs(P(a.x,a.y).y-H/2)<H/2+10);
  const tagged=byInterest({...m,planes:visible}).slice(0,7),tb=[...boxes],planes=[],tags=[],trails=[];
  for(const a of visible){
    const p=P(a.x,a.y),isHero=a===hero;
    const pts=a.trend.trail.map(s=>{const o=offset(s.lat,s.lon);const q=P(o.x,o.y);return `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;});
    if(pts.length>1)trails.push(svg('path',{class:'trail',d:`M${pts.join('L')}`}));
    if(isHero)planes.push(svg('circle',{class:'hero-ring',cx:p.x,cy:p.y,r:17}));
    planes.push(planeIcon(a,p,isHero?26:20,`ac${isHero?' hero':''}${a.inside?' inside':''}${a.military?' mil':''}`));
  }
  for(const a of tagged){
    const p=P(a.x,a.y),isHero=a===hero;
    const l1=a.flight,l2=`${fmt.altUnit()==='m'?fmt.altNum(a.altitude_ft):fmt.hundreds(a.altitude_ft)} · ${a.aircraft_type||''}`;
    const w=Math.max(l1.length*8.6,l2.length*7)+6,h=30;
    const b=[[16,-h-4],[16,6],[-w-16,-h-4],[-w-16,6]].map(([dx,dy])=>({x:p.x+dx,y:p.y+dy,w,h}))
      .find(b=>b.x>2&&b.x+w<W-2&&b.y>2&&b.y+h<H-40&&!tb.some(o=>overlap(o,b)));
    if(!b)continue;tb.push(b);
    tags.push(svg('text',{class:`tag${isHero?' hero':''}`,x:b.x,y:b.y+13},l1),svg('text',{class:`tag2${isHero?' hero':''}`,x:b.x,y:b.y+27},l2));
  }
  $.trails.replaceChildren(...trails);$.planes.replaceChildren(...planes);$.tags.replaceChildren(...tags);

  $.tbody.hidden=!hero;$.none.hidden=!!hero;
  $.notam.hidden=!hero?.emergency;
  if(!hero){setText($.quiet,quietText(m,demo));setText($['hero-st'],'');}
  else{
    setText($['hero-st'],'',headingAlts(hero,hero.status).map(s=>s.toUpperCase()));
    if(hero.emergency)setText($.notam,`NOTAM · ${hero.squawk} ${hero.emergency}`);
    setText($.fl,hero.flight);setText($.op,hero.operator||(hero.registration?'Private':''));
    const r=hero.route;
    setText($.rt,r?`${r.origin} ${r.from?.city||''} → ${r.destination} ${r.to?.city||''}`.replace(/\s+/g,' '):'Route not reported');
    setText($.alt,fmt.alt(hero.altitude_ft));setText($.gs,fmt.speed(hero.speed_kt));
    setText($.dist,fmt.dist(hero.ground));
    setText($.look,`${compass(hero.bearing)} ${Math.max(0,Math.round(hero.elevation))}°`);
    const c=hero.cpa;setText($.cpa,!c?'—':c.receding?'moving away':`${fmt.mmss(c.seconds)} · ${fmt.dist(c.miles)}`);
    setText($.type,hero.aircraft_type||'—');
  }
  showPhotoIn($.pic,hero,()=>{$.photo.hidden=$.pic.hidden;$.key.hidden=!$.pic.hidden;});
  const L=m.log;
  setText($.cargo,String(L.cargoTonight));setText($.seen,fmt.int(L.today));setText($.mil,String(L.militaryToday||0));
  $['mil-by']._alts=(L.militaryTypes||[]).length?militaryAlts(L).map(t=>`Military: ${t}`):['No military today'];$['mil-by'].textContent=$['mil-by']._alts[0];fitLine($['mil-by']);
  setText($['cargo-by'],L.cargoBy.length?L.cargoBy.slice(0,4).map(([b,n])=>`${n} ${b}`).join(' · '):L.night?'No cargo yet tonight':'Cargo counts 6 pm – 6 am');
}


window.__whatsupLayout("sectional",{
  name:'Sectional',map:'detail',
  mount(r,c){root=r;ctx=c;demo=c.demo;$={};ui();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){drawRose();},
  unmount(){root=null;$={};maps={};},
});
})();
