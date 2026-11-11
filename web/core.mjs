// Pure functions shared by the display, live.mjs and the regression tests.
// The page reads HA-shaped `states`; standalone, live.mjs builds them in the page.
export const IDS = Object.freeze({
  current:'sensor.office_aircraft_current', feed:'sensor.office_aircraft_feed',
  candidate:'sensor.office_aircraft_candidate', routes:'sensor.office_aircraft_routes',
  home:'zone.home', radius:'input_number.office_aircraft_radius',
});
export const number = v => typeof v === 'number' && Number.isFinite(v);
export const coordinates = (lat,lon) => number(lat) && number(lon) && Math.abs(lat)<=85 && Math.abs(lon)<=180;

export function localClock(now,timeZone) {
  if (timeZone) try {
    return {
      time:new Date(now).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone}),
      date:new Date(now).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone}).toUpperCase(),
    };
  } catch { /* Wait for a usable home timezone; never silently use the TV's. */ }
  return {time:'—',date:'LOCAL AIRSPACE'};
}

export function observation(states, now, connected) {
  const current = states[IDS.current];
  const stamp = Number(states[IDS.feed]?.state);
  const age = now / 1000 - stamp;
  const fresh = connected && stamp>0 && age>=-5 && age<=15 && current?.attributes?.feed_fresh === true;
  const a = current?.attributes?.aircraft;
  const posAge = now/1000 - a?.position_timestamp;
  const valid = fresh && a && current.state === a.hex && /^[a-f0-9]{6}$/i.test(a.hex) &&
    coordinates(a.latitude,a.longitude) && number(a.altitude_ft) &&
    number(a.distance_mi) && a.distance_mi>=0 && number(posAge) && posAge>=0 && posAge<=20;
  return {fresh, aircraft:valid ? a : null, age:posAge};
}

export function project(lat,lon,zoom) {
  const scale = 256 * 2**zoom;
  const sin = Math.sin(Math.max(-85,Math.min(85,lat))*Math.PI/180);
  return {x:(lon+180)/360*scale,y:(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale};
}

export function mapGeometry(home,radius,width,height) {
  const metersPerPixel = ((radius+2)*2*1609.344)/(Math.min(width,height)*.78);
  const zoom = Math.max(3,Math.min(15,Math.floor(Math.log2(156543.03392*Math.cos(home.latitude*Math.PI/180)/metersPerPixel))));
  const center = project(home.latitude,home.longitude,zoom);
  const mpp = 156543.03392*Math.cos(home.latitude*Math.PI/180)/2**zoom;
  return {zoom,left:center.x-width/2,top:center.y-height/2,cx:width/2,cy:height/2,
    radiusPx:radius*1609.344/mpp,outerPx:(radius+2)*1609.344/mpp};
}

const clean = v => typeof v==='string' ? v.replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g,'').trim().slice(0,24) : '';
export const flightLabel = a => clean(a.callsign)||clean(a.registration)||clean(a.hex).toUpperCase();
// A type designator (2-4 of A-Z, 0-9), in capitals; ZZZZ ("none assigned") or anything else is no type.
export const designator = v => {const t=clean(v).toUpperCase();return /^[A-Z0-9]{2,4}$/.test(t)&&t!=='ZZZZ'?t:'';};
// Airline callsigns read as published flight numbers ("UAL0696" -> "UA 696");
// registrations, charter and military callsigns stay as broadcast.
export function flightNumber(callsign,designators) {
  const call=clean(callsign).toUpperCase(),match=/^([A-Z]{3})0*([1-9][0-9]{0,3})$/.exec(call);
  return match&&designators[match[1]]?`${designators[match[1]]} ${match[2]}`:call;
}
// Designator to display name; unknown codes stay visible and ZZZZ means "no designator".
export const typeName = (code,types) => {
  const value=clean(code).toUpperCase();
  return value==='ZZZZ' ? '' : types[value]||value;
};
// Map icon shape and size: the designator's icon, else the ADS-B emitter category.
const WAKE_SIZE={L:.86,LM:.93,M:1,H:1.22,J:1.36};
const CATEGORY_ICONS={A1:'single.L',A2:'jet.L',A3:'airliner.M',A4:'airliner.M',A5:'widebody.H',A6:'fighter.M',
  A7:'helicopter.L',B1:'glider.L',B2:'balloon.L',B4:'single.L',B6:'helicopter.L'};
export function iconIndex(groups) {
  const index=new Map();
  for(const [icon,codes] of Object.entries(groups))for(const code of codes.split(' '))index.set(code,icon);
  return index;
}
export function aircraftIcon(a,index) {
  const icon=index.get(clean(a.aircraft_type).toUpperCase())||CATEGORY_ICONS[clean(a.category).toUpperCase()]||'airliner.M';
  const [shape,wake]=icon.split('.');
  return {shape,size:WAKE_SIZE[wake]||1};
}
// Operator logo from an airline-style callsign (three letters, then a digit).
export function airlineLogo(a,logos) {
  const call=clean(a.callsign).toUpperCase(),code=call.slice(0,3);
  return /^[A-Z]{3}[0-9]/.test(call)&&logos.has(code)?code:'';
}
// Longitude difference the short way round (across the date line too), in degrees.
export const dLon=(lon,home)=>((lon-home+540)%360)-180;
export function distanceMiles(home,a) {
  const r=Math.PI/180;
  const x=dLon(a.longitude,home.longitude)*r*Math.cos((home.latitude+a.latitude)/2*r);
  const y=(a.latitude-home.latitude)*r;
  return Math.hypot(x,y)*3958.7613;
}

// Map context comes from the existing 15-NM feed, never from the alert selector.
export function airspace(states,now,connected) {
  const stamp=Number(states[IDS.feed]?.state),age=now/1000-stamp;
  const home=states[IDS.home]?.attributes;
  const radius=Math.max(1,Math.min(10,Number(states[IDS.radius]?.state)||3));
  const fresh=connected&&stamp>0&&age>=-5&&age<=15&&!!home&&coordinates(home.latitude,home.longitude);
  const raw=states[IDS.feed]?.attributes?.ac;
  const byHex=new Map();
  for(const a of fresh&&Array.isArray(raw)?raw:[]) {
    if(!a||typeof a.hex!=='string'||!(/^[a-f0-9]{6}$/i.test(a.hex))||
      !coordinates(a.lat,a.lon)||!number(a.alt_baro)||a.alt_baro>60000||a.alt_baro<-1500||!number(a.seen_pos)||a.seen_pos<0||
      age+a.seen_pos<0||age+a.seen_pos>20)continue;
    const record={hex:a.hex.toLowerCase(),callsign:clean(a.flight).slice(0,10),registration:clean(a.r).slice(0,12), // real ones are 8 and ~10
      aircraft_type:designator(a.t),category:clean(a.category),latitude:a.lat,longitude:a.lon,altitude_ft:a.alt_baro,
      // Impossible readings are no reading.
      speed_kt:number(a.gs)&&a.gs>=0&&a.gs<=1500?a.gs:null,heading:number(a.track)?((a.track%360)+360)%360:null,
      position_timestamp:stamp-a.seen_pos};
    record.distance_mi=distanceMiles(home,record);
    record.inside=record.distance_mi<=radius;
    if(!byHex.has(record.hex)||byHex.get(record.hex).position_timestamp<record.position_timestamp)byHex.set(record.hex,record);
  }
  const all=[...byHex.values()].sort((a,b)=>a.distance_mi-b.distance_mi||a.hex.localeCompare(b.hex));
  return {fresh,radius,all,inside:all.filter(a=>a.inside)};
}

export function recentSightings(states,inside,now) {
  const raw=states[IDS.candidate]?.attributes?.history;
  const current=new Set(inside.map(a=>a.hex));
  const unique=new Map();
  for(const a of Array.isArray(raw)?raw:[]) {
    if(!a||typeof a.hex!=='string'||!(/^[a-f0-9]{6}$/i.test(a.hex))||current.has(a.hex.toLowerCase())||
      !number(a.last_seen)||a.last_seen<=0||a.last_seen>now/1000+5)continue;
    const h=a.hex.toLowerCase();
    if(!unique.has(h)||unique.get(h).last_seen<a.last_seen)unique.set(h,{...a,hex:h,
      callsign:clean(a.callsign),registration:clean(a.registration),aircraft_type:designator(a.aircraft_type)});
  }
  return [...unique.values()].sort((a,b)=>b.last_seen-a.last_seen||a.hex.localeCompare(b.hex)).slice(0,5);
}

// Nearby planes get first choice; use the actual card size and distance to its
// nearest edge. Search all sides so a left/above card is not penalized by width.
export function placeLabels(points,width,height,scale=1) {
  const boxes=[{x:width/2-24*scale,y:height/2-6*scale,w:48*scale,h:30*scale}],
    icons=points.map(p=>({x:p.x-12*scale,y:p.y-12*scale,w:24*scale,h:24*scale}));
  const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*
    Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  return points.map(p=>{
    const w=Math.min((p.labelWidth||128)*scale,width-8*scale),
      h=(p.labelHeight||46)*scale,gap=14*scale;
    let best=null;
    const candidates=[];
    // Fine offsets let cards stack closely; cardinal and corner placements
    // provide space above/below a cluster as well as to either side.
    for(let step=0;step<=14;step++){
      const shift=step*12*scale;
      for(const sign of step?[1,-1]:[1]){
        candidates.push([gap,-h/2+sign*shift],[-w-gap,-h/2+sign*shift],
          [-w/2+sign*shift,-h-gap],[-w/2+sign*shift,gap]);
      }
      for(const side of [1,-1])for(const vertical of [1,-1])
        candidates.push([side>0?gap+shift:-w-gap-shift,vertical>0?gap:-h-gap]);
    }
    for(const [dx,dy] of candidates) {
      const box={x:Math.max(4*scale,Math.min(width-w-4*scale,p.x+dx)),
        y:Math.max(25*scale,Math.min(height-h-24*scale,p.y+dy)),w,h};
      const padded={x:box.x-2*scale,y:box.y-2*scale,w:w+4*scale,h:h+4*scale};
      const collision=[...boxes,...icons].reduce((sum,b)=>sum+overlap(padded,b),0);
      const edgeDistance=Math.hypot(Math.max(box.x-p.x,0,p.x-box.x-w),Math.max(box.y-p.y,0,p.y-box.y-h));
      const centerDistance=Math.hypot(box.x+w/2-p.x,box.y+h/2-p.y);
      const score=collision*100+edgeDistance+centerDistance*.05;
      if(!best||score<best.score)best={...box,score};
    }
    boxes.push(best);
    return {...p,box:best};
  });
}

// Alert zone. 'circle': within `radius` miles all around. 'window': a wedge of compass
// bearings from `from` to `to` degrees (clockwise; 300 -> 40 crosses north), out to `miles`,
// for a view from one window; a plane within ABOVE_MI is counted either way.
export const ABOVE_MI=1;
export const norm=deg=>((deg%360)+360)%360;
export function inBearings(bearing,from,to){
  const b=norm(bearing),f=norm(from),t=norm(to);
  return f<=t?b>=f&&b<=t:b>=f||b<=t;
}
export function inZone(zone,x,y){
  const d=Math.hypot(x,y);
  if(zone?.kind!=='window')return d<=(zone?.radius??3);
  return d<=ABOVE_MI||d<=zone.miles&&inBearings(Math.atan2(x,y)*180/Math.PI,zone.from,zone.to);
}
// The zone's outline as [x,y] miles east/north of home (a closed ring).
export function zoneOutline(zone,steps=64){
  if(zone?.kind!=='window'){const r=zone?.radius??3;return Array.from({length:steps+1},(_,i)=>{const a=i/steps*2*Math.PI;return [r*Math.sin(a),r*Math.cos(a)];});}
  const span=norm(zone.to-zone.from)||360,n=Math.max(4,Math.ceil(span/4)),pts=[[0,0]];
  for(let i=0;i<=n;i++){const a=(zone.from+span*i/n)*Math.PI/180;pts.push([zone.miles*Math.sin(a),zone.miles*Math.cos(a)]);}
  pts.push([0,0]);return pts;
}

// Alert chime: rings when the alert zone goes from empty to occupied, and only after it
// has been empty for `quiet` ms (a plane flickering at the edge or a data gap doesn't
// re-ring). The first reading after launch never rings. Stale data changes nothing.
export function chimeGate(state,count,now,fresh,quiet=60000){
  const s=state||{ready:false,count:0,emptySince:null};
  if(!fresh)return {state:s,ring:false};
  if(!s.ready)return {state:{ready:true,count,emptySince:count?null:now},ring:false};
  let ring=false,emptySince=s.emptySince;
  if(count>0&&s.count===0)ring=emptySince!==null&&now-emptySince>=quiet;
  if(count>0)emptySince=null;else if(s.count>0||emptySince===null)emptySince=now;
  return {state:{ready:true,count,emptySince},ring};
}

// Data minimization: every coordinate that leaves the TV (feed queries, the time-zone
// lookup, the map and satellite tile sets) is the home snapped to a fixed 0.05 degree grid
// (about 3.5 mi north-south), so a request only reveals the grid cell. The home itself
// can be up to half a cell's diagonal from the snapped point, so query areas grow by
// that much and the app filters by true distance on the TV.
export const GRID_DEG=0.05;
export const snapDeg=v=>Math.round(Number(v)/GRID_DEG)*GRID_DEG;
export const snapped=p=>({latitude:Math.max(-85,Math.min(85,snapDeg(p.latitude))),longitude:((snapDeg(p.longitude)+540)%360)-180});
// Half the cell's diagonal, at most (at the equator): sqrt(2)*0.025 deg*60 NM/deg = 2.12 NM.
export const GRID_PAD_NM=2.2;
export const GRID_PAD_MI=GRID_PAD_NM*1.15078;
