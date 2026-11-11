'use strict';
(()=>{
const __modules=window.__whatsupModules;
const {el,svg,setText,fmt,metric,KM,placeName,statusText,quietText,byInterest,makeCanvas,paintMap,toView,number,BASE_RANGE,range,ppmOf,alertRadius,zonePath,fitLine,photoSlot,showPhotoIn,fit:fitText,placeAlts,headingAlts}=__modules["kit.mjs"];
// Layout 6, Departures: an amber split-flap board. Rows are the aircraft in range
// now (hero first) and then those recently above; only the characters that change
// flip. A small dark map inset shows where they are.

// Columns: [key, label, width in characters, align]
const COLS=[['flight','Flight',7],['dest','Destination',11],['type','Type',4],['alt','Alt',5,'r'],['dist','Dist',4,'r'],['remark','Remarks',10]];
const ROWS=8;
const INSET={w:236,h:118};
const MAP=[
  {layer:'water',fill:'rgba(255,176,32,.13)'},
  {layer:'rivers',stroke:'rgba(255,176,32,.32)',width:1},
  {layer:'roads',classes:['motorway','trunk'],stroke:'rgba(255,176,32,.22)',width:.8},
  {layer:'runways',stroke:'rgba(255,176,32,.55)',width:1.4},
];

let root,demo=false,$={},maps={},flip=0,view=null;

// A row of flap cells; set() changes text and flips only the cells that differ.
function flapRow(n,cls){
  const row=el('div',cls),cells=[];
  for(let i=0;i<n;i++){const c=el('span','c');c.textContent=' ';row.append(c);cells.push(c);}
  row._cells=cells;return row;
}
function setFlaps(row,text){
  const cells=row._cells;text=text.toUpperCase().padEnd(cells.length).slice(0,cells.length);
  flip^=1;
  for(let i=0;i<cells.length;i++){
    const c=cells[i],ch=text[i];
    if(c.textContent===ch)continue;
    c.textContent=ch;
    c.style.animationDelay=`${i*18}ms`;
    c.classList.remove(flip?'fa':'fb');c.classList.add(flip?'fb':'fa');
  }
}
// A board cell: too long, it keeps whole words (FRANKFURT AM MAIN -> FRANKFURT), as boards do.
const words=(s,n)=>{if(s.length<=n)return s;let o='';for(const w of s.split(/\s+/)){const t=o?`${o} ${w}`:w;if(t.length>n)break;o=t;}return o||s.slice(0,n);};
const fit=(s,n,right)=>{s=words(String(s??'').toUpperCase().trim(),n);return right?s.padStart(n):s.padEnd(n);};

function ui(){
  root.innerHTML=`
    <header class="top">
      <div class="where"><div class="kicker">Above</div><div class="city"></div></div>
      <div class="banner" hidden></div>
      <div class="clockbox"><div class="kicker status"></div></div>
    </header>
    <div class="cols"></div>
    <div class="board"></div>
    <footer class="foot">
      <div class="ticker"><div class="hero-line"></div><div class="sub-line"></div></div>
      <div class="ph-wrap"></div>
      <div class="inset"><svg class="dots" viewBox="0 0 ${INSET.w} ${INSET.h}"></svg><div class="inset-label"></div></div>
    </footer>`;
  for(const c of ['city','banner','clockbox','status','cols','board','hero-line','sub-line','inset','dots','inset-label'])$[c]=root.querySelector('.'+c);
  root.querySelector('.ph-wrap').append($.pic=photoSlot());
  fitText($.city,$.banner);
  $.clock=flapRow(8,'clock flaps');$.clockbox.prepend($.clock);
  for(const [,label,w,align] of COLS){
    const h=el('span',align==='r'?'r':'',label);h.style.width=`${w*20-2}px`;$.cols.append(h);
  }
  $.rows=[];
  for(let i=0;i<ROWS;i++){
    const row=el('div','brow');row._parts=COLS.map(([,,w])=>{const g=flapRow(w,'flaps');row.append(g);return g;});
    $.board.append(row);$.rows.push(row);
  }
  $.canvas=makeCanvas(INSET.w,INSET.h,'inset-map');$.inset.prepend($.canvas);
  view={cx:INSET.w/2,cy:INSET.h/2,ppm:INSET.h/2/BASE_RANGE*.96,clip:{x:0,y:0,w:INSET.w,h:INSET.h}};
  setText($['inset-label'],`${fmt.dist(range(),0)} radius`);
}

function drawMap(){paintMap($.canvas,maps,view,MAP);}

function remark(a){
  if(a.emergency)return `SQUAWK${a.squawk||''}`;
  if(a.inside)return 'ABOVE';
  if(a.cpa&&!a.cpa.receding&&a.cpa.seconds<600&&a.cpa.miles<alertRadius()+1)return `DUE ${Math.max(1,Math.round(a.cpa.seconds/60))} MIN`;
  if(number(a.vertical)&&a.vertical>500)return 'CLIMBING';
  if(number(a.vertical)&&a.vertical<-500)return 'DESCENDING';
  return a.cpa?.receding?'LEAVING':'IN RANGE';
}
// "Cincinnati/Northern Kentucky International" -> "Cincinnati"
const city=s=>String(s||'').split(/[\/(,]/)[0].replace(/\s+(International|Regional|Municipal|Airport|Intl)\b.*$/i,'').trim();
// No route: the operator, MILITARY for a military aircraft ("US AIR" read like US Airways), or PRIVATE.
const dest=a=>a.route?city(a.route.to?.city)||a.route.destination:a.military?'MILITARY':a.operator?a.operator:'PRIVATE';
const altText=ft=>!number(ft)?'':fmt.altUnit()==='m'?String(Math.round(ft*.3048)):String(Math.round(ft/10)*10);
// Four flaps: one decimal under 100, whole numbers above ("123." was the old cut).
const distText=mi=>{if(!number(mi))return '';const d=metric()?mi*KM:mi;return d<99.95?d.toFixed(1):String(Math.min(9999,Math.round(d)));};

// The two ticker lines stay on one line: the first of `alts` that fits, shrunk if need be.
const ticker=(e,alts)=>{e._alts=alts;fitLine(e);};

function render(m){
  const {now,hero}=m;
  setText($.city,placeName(),placeAlts());
  setFlaps($.clock,fmt.clock(now).replace(/\s/g,' ').padStart(8));
  setText($.status,statusText(m,demo));
  const emergency=hero?.emergency;
  root.classList.toggle('emergency',!!emergency);
  $.banner.hidden=!emergency;
  if(emergency)setText($.banner,'',[`${hero.squawk||''} ${emergency} · ${hero.flight}`,`${hero.squawk||''} · ${hero.flight}`]);

  const live=byInterest(m).filter(a=>a.ground<=range()*1.1).slice(0,ROWS);
  const lines=live.map(a=>({a,cells:[a.flight,dest(a),a.aircraft_type||'',altText(a.altitude_ft),distText(a.ground),remark(a)],cls:a===hero?'hero':a.inside?'in':''}));
  for(const r of m.recent){
    if(lines.length>=ROWS)break;
    if(lines.some(l=>l.a.flight===r.flight))continue;
    const ago=Math.max(1,Math.round((now/1000-r.last_seen)/60));
    lines.push({a:r,cells:[r.flight,r.route?city(r.route.to?.city)||r.route.destination:'',r.aircraft_type||'','','',ago<60?`${ago} MIN AGO`:'DEPARTED'],cls:'past'});
  }
  if(!live.length&&lines.length<ROWS)lines.splice(0,0,{cells:['','QUIET SKIES','','','','NO TRAFFIC'],cls:'quiet'});
  $.rows.forEach((row,i)=>{
    const l=lines[i];
    row.className=`brow ${l?l.cls||'live':'empty'}`;
    row._parts.forEach((g,j)=>setFlaps(g,l?fit(l.cells[j],COLS[j][2],COLS[j][3]==='r'):''));
  });

  if(hero){
    const r=hero.route,from=city(r?.from?.city)||r?.origin,to=city(r?.to?.city)||r?.destination;
    const rt=r?` · ${from} → ${to}`:'',op=hero.operator?` · ${hero.operator}`:'';
    // Browsing (Left/Right): every wording keeps the plane's number in the list.
    const head=headingAlts(hero,hero.status),last=head[head.length-1];
    ticker($['hero-line'],hero.browse?[...head.map(h=>`${h}: ${hero.flight}${op}${rt}`),`${last}: ${hero.flight}${rt}`,`${last}: ${hero.flight}`]:
      [`${hero.status}: ${hero.flight}${op}${rt}`,`${hero.flight}${op}${rt}`,`${hero.flight}${rt}`]);
    const c=hero.cpa,parts=[hero.type||hero.aircraft_type,fmt.alt(hero.altitude_ft),fmt.speed(hero.speed_kt),
      c&&!c.receding?`closest in ${fmt.mmss(c.seconds)} at ${fmt.dist(c.miles)}`:'',`cargo ${m.log.cargoTonight}`,`military ${m.log.militaryToday||0}`].filter(Boolean);
    ticker($['sub-line'],parts.map((_,i)=>parts.slice(0,parts.length-i).join(' · ')));
  }else{
    const q=quietText(m,demo);
    ticker($['hero-line'],[q,q.split('. ')[0]]);
    ticker($['sub-line'],[`Seen today ${fmt.int(m.log.today)} · cargo ${m.log.cargoTonight} · military ${m.log.militaryToday||0}`,`Seen today ${fmt.int(m.log.today)} · cargo ${m.log.cargoTonight}`]);
  }
  showPhotoIn($.pic,hero,()=>{fitLine($['hero-line']);fitLine($['sub-line']);});
  // Inset: home and plane dots.
  const dots=[svg('circle',{class:'home',cx:view.cx,cy:view.cy,r:2.6}),svg('path',{class:'ring',d:zonePath((x,y)=>toView(view,x,y))})];
  for(const a of m.planes){
    const p=toView(view,a.x,a.y);
    if(p.x<0||p.y<0||p.x>INSET.w||p.y>INSET.h)continue;
    dots.push(svg('circle',{class:`dot${a===hero?' hero':''}${a.military?' mil':''}`,'data-hex':a.hex,cx:p.x.toFixed(1),cy:p.y.toFixed(1),r:a===hero?3.4:2.2}));
  }
  $.dots.replaceChildren(...dots);
}
let ctx=null;


window.__whatsupLayout("departures",{
  name:'Departures',map:'base',
  mount(r,c){root=r;ctx=c;demo=c.demo;$={};ui();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){setText($['inset-label'],`${fmt.dist(range(),0)} radius`);for(const row of $.rows)for(const g of row._parts)setFlaps(g,'');},
  unmount(){root=null;$={};maps={};ctx=null;},
});
})();
