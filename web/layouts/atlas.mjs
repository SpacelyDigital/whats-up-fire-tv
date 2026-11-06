// Layout 2, Atlas Light: a light, fully detailed printed city map (landuse, parks, water,
// buildings, every road class with casings, rail, aeroways, place names) with planes
// as bold markers and trails, and a slim side column carrying the most data of any
// layout: hero flight, route and progress, six stats, cargo tonight, today, recent.
// Layout 1, Atlas Dark, is the same code with the DARK palette and atlas-dark.css; layout 3,
// Atlas Satellite, puts satellite imagery under a light road overlay (atlas-satellite.css).
import {svg,el,setText,fmt,placeName,statusText,quietText,planeIcon,byInterest,makeCanvas,paintMap,toView,placesNear,
  airfieldsNear,shortField,cityName,compass,number,TrailBook,placeBox,metric,KM,alertRadius,ppmOf,niceDistance,range,overlap,zonePath,windowView,silhouette,photoFor,qrFor,modelPhoto,fitLine,themedQr,fit,snapped,GRID_PAD_MI,shortAuthor,photoAlt,militaryAlts,psCredit,headingAlts} from '../kit.mjs';
import {PROFILE} from '../profile.mjs';

const DETAIL_MAX=15; // the street map is drawn up to this map radius (mapgen DETAIL_MAX_RANGE)
// ppm 25.5: the map radius fits between home and the bottom edge (264 px), so every plane
// within the radius is on screen (at 54 it showed about half the radius north-south).
const W=700,H=540,VIEW={cx:350,cy:276,ppm:25.5,clip:{x:0,y:0,w:W,h:H}};
const road=(classes,casing,fill,cw,fw)=>[{layer:'roads',from:'detail',classes,stroke:casing,width:cw},{layer:'roads',from:'detail',classes,stroke:fill,width:fw}];
const DETAIL=[
  {layer:'landuse',classes:['residential'],fill:'#ece6da'},
  {layer:'landuse',classes:['commercial','retail'],fill:'#f2e0d8'},
  {layer:'landuse',classes:['industrial','railway','military'],fill:'#e6e0e8'},
  {layer:'landuse',classes:['school','university','college','hospital'],fill:'#f0e8cc'},
  {layer:'landuse',classes:['cemetery'],fill:'#d6e2cc'},
  {layer:'parks',classes:['wood'],fill:'#c6dbb1'},
  {layer:'parks',not:['wood'],fill:'#d2e6c2'},
  {layer:'landuse',classes:['stadium','pitch','playground','zoo','theme_park'],fill:'#cbe3bf'},
  {layer:'aero',classes:['aerodrome','apron'],fill:'#e2dfea'},
  {layer:'water',from:'detail',fill:'#a6cae0',stroke:'#8fb6cf',width:.6},
  {layer:'waterways',classes:['river','canal'],stroke:'#a6cae0',width:2.2},
  {layer:'waterways',classes:['stream'],stroke:'#a6cae0',width:1},
  {layer:'buildings',fill:'#d9cfbf',stroke:'#c3b59f',width:.35},
  {layer:'aero',classes:['taxiway'],stroke:'#bdb7cf',width:1.4},
  {layer:'aero',classes:['runway'],stroke:'#a29bb8',width:4.5,cap:'butt'},
  {layer:'roads',from:'detail',classes:['service'],stroke:'#fffdf8',width:.7},
  ...road(['minor'],'#d3cbbd','#fffdf8',2.1,1.2),
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#8d877d',width:1.1},
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#f6f2ea',width:.6,dash:[4,4],cap:'butt'},
  ...road(['tertiary'],'#c9bfae','#fffaf0',3,2),
  ...road(['secondary'],'#d2ad5c','#fbe4a2',3.6,2.5),
  ...road(['primary','trunk'],'#cd8f42','#f8c574',4.2,3),
  ...road(['motorway'],'#b0612f','#ef9656',5,3.6),
];
// Atlas Dark: charcoal land, muted water, roads in greys (major ones brighter), faint buildings.
const DARK_DETAIL=[
  {layer:'landuse',classes:['residential'],fill:'#1a1d22'},
  {layer:'landuse',classes:['commercial','retail'],fill:'#1e1d22'},
  {layer:'landuse',classes:['industrial','railway','military'],fill:'#1c1d24'},
  {layer:'landuse',classes:['school','university','college','hospital'],fill:'#1f1f1e'},
  {layer:'landuse',classes:['cemetery'],fill:'#192119'},
  {layer:'parks',classes:['wood'],fill:'#16221a'},
  {layer:'parks',not:['wood'],fill:'#18241b'},
  {layer:'landuse',classes:['stadium','pitch','playground','zoo','theme_park'],fill:'#1a251c'},
  {layer:'aero',classes:['aerodrome','apron'],fill:'#1e1f27'},
  {layer:'water',from:'detail',fill:'#0f2230',stroke:'#173244',width:.6},
  {layer:'waterways',classes:['river','canal'],stroke:'#173244',width:2.2},
  {layer:'waterways',classes:['stream'],stroke:'#163040',width:1},
  {layer:'buildings',fill:'#24272d',stroke:'#2c3036',width:.35},
  {layer:'aero',classes:['taxiway'],stroke:'#3a3b46',width:1.4},
  {layer:'aero',classes:['runway'],stroke:'#585a69',width:4.5,cap:'butt'},
  {layer:'roads',from:'detail',classes:['service'],stroke:'#2b2e34',width:.7},
  ...road(['minor'],'#16181c','#33363d',2.1,1.2),
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#44464d',width:1.1},
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#1a1c20',width:.6,dash:[4,4],cap:'butt'},
  ...road(['tertiary'],'#16181c','#41454c',3,2),
  ...road(['secondary'],'#16181c','#53575f',3.6,2.5),
  ...road(['primary','trunk'],'#16181c','#696e78',4.2,3),
  ...road(['motorway'],'#16181c','#868c97',5,3.6),
];
const DARK_BASE=[
  {layer:'water',fill:'#0f2230'},
  {layer:'rivers',stroke:'#173244',width:2.2},
  {layer:'roads',classes:['trunk'],stroke:'#696e78',width:2.8},
  {layer:'roads',classes:['motorway'],stroke:'#868c97',width:3.6},
  {layer:'runways',stroke:'#585a69',width:4},
];
// Atlas Satellite: just the main roads, light and thin, over the imagery.
const SAT_DETAIL=[
  {layer:'roads',from:'detail',classes:['secondary','tertiary'],stroke:'rgba(255,255,255,.28)',width:1},
  {layer:'roads',from:'detail',classes:['primary','trunk'],stroke:'rgba(255,255,255,.45)',width:1.4},
  {layer:'roads',from:'detail',classes:['motorway'],stroke:'rgba(255,214,120,.6)',width:1.8},
];
// Under the imagery: water, for the tiles the imagery service leaves empty (open water far
// from shore comes back transparent, which showed as black blocks over lakes and seas).
const SAT_UNDER=[{layer:'water',fill:'#48546f'},{layer:'water',from:'detail',fill:'#48546f'}]; // ~ the imagery's own lake colour
const SAT_BASE=[
  {layer:'roads',classes:['trunk'],stroke:'rgba(255,255,255,.45)',width:1.4},
  {layer:'roads',classes:['motorway'],stroke:'rgba(255,214,120,.6)',width:1.8},
];
// Imagery: USGS The National Map in the US (USGSImageryOnly, public domain), else EOxCloudless
// 2016 by EOX (CC BY 4.0; Contains modified Copernicus Sentinel data 2016) where the build
// profile allows it (personal). Without imagery (store build outside the US) Atlas Satellite
// draws the dark vector map instead. Only the imagery layer is loaded from EOX: no overlay,
// label or road layer. {z}/{y}/{x} web-mercator tiles.
const SAT_TILES=48;
const USGS='https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const EOX='https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
const BASE=[
  {layer:'water',fill:'#a6cae0'},
  {layer:'rivers',stroke:'#a6cae0',width:2.2},
  {layer:'roads',classes:['trunk'],stroke:'#cd8f42',width:4},{layer:'roads',classes:['trunk'],stroke:'#f8c574',width:2.8},
  {layer:'roads',classes:['motorway'],stroke:'#b0612f',width:5},{layer:'roads',classes:['motorway'],stroke:'#ef9656',width:3.6},
  {layer:'runways',stroke:'#a29bb8',width:4},
];

const usPlace=p=>p?.countryCode==='US'||p?.countryCode==='PR';
const imagery=()=>sat&&(usPlace(ctx?.place?.())||PROFILE.eox);
let root,demo,ctx,dark=false,sat=false,satToken=0,satKey='',$={},maps={},trails=new TrailBook(360000,4000),staticBoxes=[];

function ui(){
  const map=el('div','at-map'),side=el('aside','at-side');
  $.canvas=makeCanvas(W,H,'at-canvas');
  if(sat){$.sat=makeCanvas(W,H,'at-canvas at-sat');satKey='';}
  $.labels=svg('svg',{class:'at-svg',viewBox:`0 0 ${W} ${H}`});
  $.over=svg('svg',{class:'at-svg',viewBox:`0 0 ${W} ${H}`});
  for(const k of ['ring','trails','marks','tags'])$.over.append($[k]=svg('g',{class:`at-${k}`}));
  $.scale=el('div','at-scale');$.note=el('div','at-note');
  const north=el('div','at-north');north.innerHTML='<b>N</b><i></i>';
  map.append(...(sat?[$.sat]:[]),$.canvas,$.labels,$.over,north,$.scale,$.note);
  side.innerHTML=`
    <div class="at-top"><header><div class="at-city"></div><div class="at-time"><b class="at-clock"></b><span class="at-status"></span></div></header>
    <div class="at-date"></div></div>
    <section class="at-hero">
      <div class="at-alert" hidden></div>
      <div class="at-kicker"></div>
      <div class="at-flight"><b class="at-fl"></b><div class="at-op"></div></div>
      <div class="at-route"></div>
      <div class="at-prog"><span class="at-bar"><i></i></span><span class="at-progt"></span></div>
      <dl class="at-stats">
        <div><dt>Altitude</dt><dd class="at-alt"></dd></div><div><dt>Speed</dt><dd class="at-spd"></dd></div>
        <div><dt>Climb</dt><dd class="at-vs"></dd></div><div><dt>Heading</dt><dd class="at-hdg"></dd></div>
        <div><dt>Look</dt><dd class="at-look"></dd></div><div><dt>Closest</dt><dd class="at-cpa"></dd></div>
      </dl>
      <div class="at-id"><div class="at-type"><span class="at-typet"></span></div><div class="at-reg"></div>
        <div class="at-pic" hidden><img class="at-img" alt=""><img class="at-qr" alt=""></div><div class="at-credit"></div></div>
    </section>
    <section class="at-quiet" hidden></section>
    <section class="at-books">
      <div class="at-counts"><b class="at-cargo-n"></b><div class="at-ct"><h4>Cargo</h4><div class="at-cargo-by"></div></div>
        <b class="at-mil-n"></b><div class="at-ct"><h4>Military</h4><div class="at-mil-by"></div></div></div>
      <dl class="at-log"></dl>
    </section>
    <section class="at-recent"><h4 class="at-rech">Recently above</h4><div class="at-rec"></div></section>`;
  for(const c of ['city','clock','status','date','hero','alert','kicker','fl','op','route','prog','bar','progt','alt','spd','vs','hdg','look','cpa',
    'type','typet','reg','pic','img','qr','credit','quiet','cargo-n','cargo-by','mil-n','mil-by','log','rec'])$[c]=side.querySelector('.at-'+c);
  $.credit._whole=true; // attribution: wraps rather than losing words
  $.alert._firm=true; // the emergency notice: "7600 · RADIO FAILURE" rather than smaller type
  $.barFill=$.bar.firstChild;fit($.city,$.kicker,$.alert);
  root.append(map,side);
}

// Satellite tiles for the current view at about one tile pixel per screen pixel (at most
// ~40 tiles), drawn as they arrive onto their own canvas; the images are dropped once drawn.
function drawSatellite(){
  const place=ctx?.place?.();if(!sat||!$.sat||!place)return;
  if(!imagery()){const g=$.sat.getContext('2d');g.save();g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,$.sat.width,$.sat.height);g.restore();satKey='';satToken++;return;}
  const c=$.sat,k=c._k||1,g=c.getContext('2d');
  const us=usPlace(place),ppm=ppmOf(VIEW),cos=Math.cos(place.latitude*Math.PI/180);
  // Nothing changed that moves the imagery (place, scale, the water drawn under it): keep
  // what is drawn instead of downloading every tile again on each redraw.
  const key=[place.latitude,place.longitude,ppm,k,maps.base?.built,maps.detail?.built].join();
  if(key===satKey)return;
  satKey=key;
  const token=++satToken;
  paintMap(c,maps,VIEW,SAT_UNDER);g.setTransform(k,0,0,k,0,0);
  const metresPerPx=1609.344/ppm/k;
  // The tile set is chosen around the snapped grid point (core.mjs), widened to still cover
  // the view around the true home, so imagery requests only reveal the grid cell. At most
  // z14 (z13 outside the US) and SAT_TILES tiles: a wide map takes a coarser zoom rather
  // than going blank.
  const sc=snapped(place),pad=GRID_PAD_MI;
  const halfW=(W/2/ppm+pad)/(69.172*cos),halfH=(H/2/ppm+pad)/69;
  let z=Math.max(3,Math.min(us?14:13,Math.round(Math.log2(156543.03*cos/metresPerPx)))),n,tx,ty,x0,x1,y0,y1;
  for(;;z--){
    n=2**z;tx=lon=>(lon+180)/360*n;ty=lat=>{const s=Math.sin(lat*Math.PI/180);return (.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n;};
    x0=Math.floor(tx(sc.longitude-halfW));x1=Math.floor(tx(sc.longitude+halfW));
    y0=Math.floor(ty(sc.latitude+halfH));y1=Math.floor(ty(sc.latitude-halfH));
    if((x1-x0+1)*(y1-y0+1)<=SAT_TILES||z<=3)break;
  }
  const lonOf=x=>x/n*360-180,latOf=y=>Math.atan(Math.sinh(Math.PI-2*Math.PI*y/n))*180/Math.PI;
  // Screen point of a lat/lon (same equirectangular miles as the vector maps, from the true home).
  const px=(lat,lon)=>({x:VIEW.cx+(lon-place.longitude)*69.172*cos*ppm,y:VIEW.cy-(lat-place.latitude)*69*ppm});
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
    const img=new Image();
    img.onload=()=>{
      if(token!==satToken||!$.sat)return;
      const a=px(latOf(y),lonOf(x)),b=px(latOf(y+1),lonOf(x+1));
      g.drawImage(img,a.x,a.y,b.x-a.x+.5,b.y-a.y+.5);img.src='';
    };
    img.src=(us?USGS:EOX).replace('{z}',z).replace('{y}',y).replace('{x}',x);
  }
}

function drawMap(){
  drawSatellite();
  paintMap($.canvas,maps,VIEW,imagery()?(maps.detail?SAT_DETAIL:SAT_BASE):maps.detail?(dark?DARK_DETAIL:DETAIL):(dark?DARK_BASE:BASE));
  setText($.note,maps.detail?'':maps.base?'Drawing detail':'Drawing the map');
  // Labels, set once per map with a halo like print. Up to 15 mi: no place names, just the
  // airports with an official code (IATA/ICAO/FAA), each a ring marker (never a plane
  // shape: planes are the aircraft) with "CODE Name". Wider: those airports, then cities.
  // Any map label under a flight tag is hidden while the tag is there (see render).
  const home=toView(VIEW,0,0),nodes=[];staticBoxes=[{x:home.x-10,y:home.y-12,w:66,h:24},{x:8,y:H-54,w:170,h:30}]; // home, scale bar
  const bounds={x:6,y:6,w:W-12,h:H-40},wide=range()>DETAIL_MAX;
  const field=a=>{
    const p=toView(VIEW,a.x,a.y);
    if(p.x<8||p.x>W-8||p.y<8||p.y>H-34)return;
    const name=shortField(a.name),major=a.kind==='international'||a.kind==='regional'||a.kind==='public';
    const w=(a.code?a.code.length*8.6+8:0)+name.length*6.6+16,h=17;
    const b=placeBox(staticBoxes,p,w,h,[[10,-h/2],[-w-10,-h/2],[-w/2,9],[-w/2,-h-9]],bounds);
    if(!b&&wide)return;
    staticBoxes.push({x:p.x-7,y:p.y-7,w:14,h:14});
    const g=svg('g',{class:'at-fieldg'});
    g.append(svg('circle',{class:`at-fieldm${major?' major':''}`,cx:p.x,cy:p.y,r:major?5.5:4.5}));
    if(b){
      const t=svg('text',{class:'at-field',x:b.x+2,y:b.y+13});
      t.append(svg('tspan',{class:'at-fieldc'},`${a.code} `),svg('tspan',{},name));g.append(t);
    }
    g._box=b?{x:Math.min(b.x,p.x-7),y:Math.min(b.y,p.y-7),w:Math.max(b.x+w,p.x+7)-Math.min(b.x,p.x-7),h:Math.max(b.y+h,p.y+7)-Math.min(b.y,p.y-7)}:{x:p.x-7,y:p.y-7,w:14,h:14};
    nodes.push(g);
  };
  // Coded airports claim their space first, then place names (Settings > Place names). Uncoded fields
  // (farm strips, ultralight parks) aren't shown.
  airfieldsNear(maps,7).filter(a=>a.code).forEach(field);
  for(const pl of placesNear(maps,7,{max:60})){ // Settings > Place names
    const p=toView(VIEW,pl.x,pl.y),big=pl.c==='city',name=big?pl.name.toUpperCase():pl.name;
    const size=big?15:12.5,w=name.length*size*(big?.66:.52)+6,h=size+4;
    if(staticBoxes.length>44)break;
    const b=placeBox(staticBoxes,p,w,h,[[-w/2,-h/2]],bounds);if(!b)continue;
    const t=svg('text',{class:`at-place ${big?'big':''}`,x:b.x+w/2,y:b.y+h-4,'text-anchor':'middle'},name);
    t._box=b;nodes.push(t);
  }
  $.labels.replaceChildren(...nodes);scaleBar();
}
// Scale bar: a round distance about 60 px long at the current map radius, in the chosen unit.
function scaleBar(){
  const bar=niceDistance(VIEW,60);
  $.scale.innerHTML=`<i style="width:${bar.px.toFixed(0)}px"></i><span>${bar.label}</span>`;
}


// The hero's picture block: a Planespotters photo of this exact aircraft, with the
// photographer credit and a QR code to the photo's page beside it (their terms). Only the
// shown image is held; switching aircraft drops it.
let picHex='',photo=null;
function showPhoto(a){
  const hex=a?.hex||'';
  if(hex===picHex)return;
  picHex=hex;photo=null;$.pic.hidden=true;$.img.removeAttribute('src');$.qr.removeAttribute('src');$.pic.classList.remove('model');
  if(!hex)return;
  photoFor(a).then(p=>{
    if(!root||picHex!==hex)return;
    const qr=p&&themedQr(p.link);
    // No photo of this aircraft, or its image fails to load: a typical one of its type,
    // labelled so, if bundled.
    const useModel=()=>{
      const m=modelPhoto(a);if(!m){photo=null;$.pic.hidden=true;return false;}
      photo=m;$.img.src=m.src;$.img.alt=`Typical ${m.model}`;$.qr.removeAttribute('src');$.qr.alt='';$.pic.classList.add('model');
      // CC BY: the author stays in every wording; long names shorten to an initial.
      const short=shortAuthor(m.author);
      $.credit._alts=[`Typical ${m.model} · ${m.author} · ${m.license}`,`Model photo · ${m.author} · ${m.license}`,
        `${m.author} · ${m.license}`,`Model photo · ${short} · ${m.license}`,`${short} · ${m.license}`];
      return true;
    };
    $.img.onerror=()=>{if(picHex!==hex||$.pic.classList.contains('model'))return;if(useModel()){$.credit.textContent=$.credit._alts[0];fitLine($.credit);}};
    if(p&&qr){
      photo=p;$.img.src=p.src;$.qr.src=qr;$.img.alt=photoAlt(a);$.qr.alt='QR code for this photo on Planespotters.net';
      $.credit._alts=psCredit(p.photographer);
    }else if(!useModel())return;
    $.credit.textContent=$.credit._alts[0];
  });
}

function render(m){
  const {now,hero}=m;
  setText($.clock,fmt.clock(now));
  setText($.date,fmt.date(now));
  // Status only when it matters (Connecting / No signal); Live and Preview go unsaid.
  const status=statusText(m,demo);setText($.status,status==='Live'||status==='Preview'?'':status);
  $.status.classList.toggle('off',!demo&&!m.fresh&&!m.connecting);
  // The place name after the clock and status beside it: fitted to the room they leave.
  setText($.city,'',[cityName()||placeName()]);
  root.classList.toggle('emergency',!!hero?.emergency);
  trails.update(m.planes,now);

  // Alert ring around home.
  const h=toView(VIEW,0,0);
  $.ring.replaceChildren(svg('path',{class:'at-alertring',d:zonePath((x,y)=>toView(VIEW,x,y))}),
    svg('circle',{class:'at-home',cx:h.x,cy:h.y,r:6}),svg('text',{class:'at-homet',x:h.x+10,y:h.y+4},'HOME'));

  // Tags sit on white chips over the place names, so they only avoid each other and home.
  const lines=[],marks=[],tags=[],boxes=[{x:h.x-8,y:h.y-8,w:52,h:16}];
  const bounds={x:4,y:4,w:W-8,h:H-34};
  const ranked=byInterest(m);
  for(const a of ranked){
    const p=toView(VIEW,a.x,a.y);
    if(p.x<-20||p.x>W+20||p.y<-20||p.y>H+20)continue;
    const isHero=a===hero,t=trails.get(a.hex);
    if(t.length>1)lines.push(svg('polyline',{class:`at-trail${isHero?' hero':''}`,points:[...t.map(s=>toView(VIEW,s.x,s.y)),p].map(q=>`${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}));
    if(isHero)marks.push(svg('circle',{class:'at-target',cx:p.x,cy:p.y,r:19}));
    marks.push(planeIcon(a,p,isHero?28:21,`at-plane${isHero?' hero':''}${a.cargo?' cargo':''}${a.military?' mil':''}`));
    if(tags.length>=7*2&&!isHero)continue;
    const text=`${a.flight}  ${fmt.alt(a.altitude_ft)}`,w=text.length*7.1+14,hh=22;
    const b=placeBox(boxes,p,w,hh,[[16,-hh-6],[-w-16,-hh-6],[16,8],[-w-16,8]],bounds);
    if(!b)continue;
    tags.push(svg('rect',{class:`at-tag${isHero?' hero':''}`,x:b.x,y:b.y,width:w,height:hh,rx:3}),
      svg('text',{class:`at-tagt${isHero?' hero':''}`,x:b.x+7,y:b.y+15.5},text));
  }
  // The hero off the drawn map (the map is wider than tall, so a plane inside the map radius
  // can sit past the top or bottom edge): an arrow on the edge points to it, with its tag.
  const hp=hero&&toView(VIEW,hero.x,hero.y);
  if(hp&&(hp.x<12||hp.x>W-12||hp.y<12||hp.y>H-42)){
    const dx=hp.x-h.x,dy=hp.y-h.y,lo=26,edge=(d,from,a,b)=>d>0?(b-from)/d:d<0?(a-from)/d:Infinity;
    const t=Math.min(edge(dx,h.x,lo,W-lo),edge(dy,h.y,lo,H-56)),e={x:h.x+dx*t,y:h.y+dy*t},ang=Math.atan2(dy,dx);
    const pt=(r,da)=>`${(e.x+Math.cos(ang+da)*r).toFixed(1)} ${(e.y+Math.sin(ang+da)*r).toFixed(1)}`;
    const arrow=svg('g',{class:'at-plane hero at-edge'});arrow.append(svg('path',{d:`M${pt(13,0)}L${pt(9,2.4)}L${pt(9,-2.4)}Z`}));marks.push(arrow);
    const text=`${hero.flight}  ${fmt.dist(hero.ground)} ${compass(hero.bearing)}`,w=text.length*7.1+14,hh=22;
    const b=placeBox(boxes,e,w,hh,[[-w/2,-hh-16],[-w/2,16],[16,-hh/2],[-w-16,-hh/2]],bounds);
    if(b)tags.push(svg('rect',{class:'at-tag hero',x:b.x,y:b.y,width:w,height:hh,rx:3}),svg('text',{class:'at-tagt hero',x:b.x+7,y:b.y+15.5},text));
  }
  $.trails.replaceChildren(...lines);$.marks.replaceChildren(...marks);$.tags.replaceChildren(...tags);
  // Map labels give way to flight tags: hidden while a tag covers them.
  const tagBoxes=[...boxes.slice(1),...ranked.slice(0,15).map(a=>{const p=toView(VIEW,a.x,a.y),r=a===hero?20:11;return {x:p.x-r,y:p.y-r,w:2*r,h:2*r};})];
  for(const n of $.labels.children)if(n._box)n.style.visibility=tagBoxes.some(t=>overlap(t,n._box))?'hidden':'';

  $.hero.hidden=!hero;$.quiet.hidden=!!hero;
  if(!hero)setText($.quiet,quietText(m,demo));
  if(hero){
    $.alert.hidden=!hero.emergency;setText($.alert,'',hero.emergency?(hero.squawk?[`Squawk ${hero.squawk} · ${hero.emergency}`,`${hero.squawk} · ${hero.emergency}`]:[hero.emergency]):['']);
    setText($.kicker,'',headingAlts(hero,`${hero.status} · ${fmt.dist(hero.ground)} ${compass(hero.bearing)}`));
    setText($.fl,hero.flight);setText($.op,hero.operator||(!hero.callsign||hero.callsign===hero.registration?'Private':''));
    const r=hero.route;
    setText($.route,r?`${r.from?.city||r.origin} → ${r.to?.city||r.destination}`:'Route not reported');
    $.prog.hidden=!hero.progress;
    if(hero.progress){$.barFill.style.width=`${Math.round(hero.progress.share*100)}%`;
      setText($.progt,`${r.origin} ${fmt.far(hero.progress.flown)} · ${fmt.far(hero.progress.left)} ${r.destination}`);}
    setText($.alt,fmt.alt(hero.altitude_ft));setText($.spd,fmt.speed(hero.speed_kt));
    setText($.vs,fmt.vs(hero.vertical));setText($.hdg,number(hero.heading)?`${String(Math.round(hero.heading)).padStart(3,'0')}° ${compass(hero.heading)}`:'—');
    setText($.look,`${compass(hero.bearing)} ${Math.max(0,Math.round(hero.elevation))}°`);
    const c=hero.cpa;setText($.cpa,!c?'—':c.receding?'passed':`${fmt.mmss(c.seconds)} · ${fmt.dist(c.miles)}`);
    const typeName=hero.type||hero.aircraft_type||'Unknown type',regLine=[hero.registration,hero.year&&`built ${hero.year}`].filter(Boolean);
    // The type shrinks to fit its line; the registration keeps its own line beside the photo
    // and shortens to just the registration when needed.
    $.typet._alts=[typeName];setText($.typet,typeName);
    // A small side-profile picture of the aircraft family beside the type, until (or
    // unless) a real photo of this aircraft arrives.
    const sil=silhouette(hero,'at-sil');
    if($.type.lastElementChild?.dataset?.family!==sil.dataset.family){$.type.querySelector('.at-sil')?.remove();$.type.append(sil);}
    showPhoto(hero);
    $.reg._alts=[regLine.join(' · '),regLine[0]||''];setText($.reg,regLine.join(' · '));
  }
  const L=m.log;
  setText($['cargo-n'],L.cargoTonight);
  const brands=n=>L.cargoBy.slice(0,n).map(([b,c])=>`${c} ${b}`).join(' · '); // count first, like Military
  $['cargo-by']._alts=L.cargoBy.length?[brands(4),brands(3),brands(2)]:[L.night?'none yet':'counted 6 pm – 6 am'];
  setText($['mil-n'],L.militaryToday||0);$['mil-by']._alts=militaryAlts(L);
  const cell=(k,v,cls='',alts)=>{const d=el('div',cls),dd=el('dd','',v);dd._alts=alts;d.append(el('dt','',k),dd);return d;};
  const far=L.farthest,farMi=far&&fmt.far(far.value);
  $.log.replaceChildren(cell('Seen',fmt.int(L.today)),cell('Highest',L.highest?fmt.alt(L.highest.value):'—'),
    cell('Fastest',L.fastest?fmt.speed(L.fastest.value):'—'),cell('Rarest',L.rarest?L.rarest.name:'—','wide',L.rarest&&[L.rarest.name,L.rarest.code]),
    cell('Farthest',far?`${far.name} · ${far.from} · ${farMi}`:'—','wide far',far&&[`${far.name} · ${far.from} · ${farMi}`,`${far.from} · ${farMi}`,`${far.name} · ${far.code||far.from} · ${farMi}`,`${far.code||far.from} · ${farMi}`]));
  setText(root.querySelector('.at-rech'),windowView()?'Through your window':'Recently above');
  const rec=m.recent.slice(0,hero?3:5);
  $.rec.replaceChildren(...(rec.length?rec.map(a=>{
    const d=el('div','at-rr');d.append(el('b','',a.flight),el('span','',[a.route&&`${a.route.origin}–${a.route.destination}`,a.aircraft_type].filter(Boolean).join(' ')),el('i','',fmt.ago(a.last_seen,now)));return d;
  }):[el('div','at-rr none',windowView()?'Nothing through your window yet.':'Nothing inside the alert zone yet.')]));
  // One-line rows (cargo by brand, Rarest, Farthest): the type shrinks until they fit.
  fitAll();
  // Nothing is cut short: long names wrap, and the sections spread down the full
  // column. If a busy hero leaves no room, Recent goes (its space is shared out by
  // the column), then the type tightens, then the photo and the operator line go.
  const side=$.rec.closest('.at-side'),sec=$.rec.parentNode;
  side.classList.remove('tight','tighter');sec.hidden=false;$.op.hidden=false;
  $.pic.hidden=!(hero&&photo&&picHex===hero.hex);side.classList.toggle('photo',!$.pic.hidden);
  const over=()=>side.scrollHeight>side.clientHeight+1;
  if(over())sec.hidden=true;
  if(over())side.classList.add('tight');
  if(over())side.classList.add('tighter');
  // Still no room: the photo gives way (the silhouette stays) rather than a stat row.
  if(over()&&!$.pic.hidden){$.pic.hidden=true;side.classList.remove('photo');}
  if(over())$.op.hidden=true; // e.g. an emergency notice over a two-line route
  fitAll();
}
// One-line rows (cargo and military, the stats, the type and registration beside the photo,
// the photo credit): each shrinks, then shortens, until it fits. Rarest and Farthest then
// share the smaller of their two sizes, so they read as a pair.
function fitAll(){
  for(const e of [$['cargo-by'],$['mil-by'],$.typet,$.reg,...$.log.querySelectorAll('dd'),...root.querySelectorAll('.at-stats dd')])fitLine(e);
  if(!$.pic.hidden)fitLine($.credit);
  for(const pair of [[...$.log.querySelectorAll('.wide dd')],[$['cargo-by'],$['mil-by']]])
    if(pair.length===2){const size=Math.min(...pair.map(e=>parseFloat(getComputedStyle(e).fontSize)));for(const e of pair)e.style.fontSize=`${size}px`;}
}

export default {
  name:'Atlas Light',map:'detail',
  mount(r,c){root=r;ctx=c;demo=c.demo;sat=c.layout?.()==='atlas-satellite';dark=c.layout?.()==='atlas-dark'||sat;$={};trails.clear();ui();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){scaleBar();}, // units: the scale bar; the map itself shows no distance, and the card's come with the model
  refreshZone(){}, // the zone is drawn with the aircraft on every tick
  unmount(){root=null;satToken++;picHex='';photo=null;$={};maps={};trails.clear();},
};
