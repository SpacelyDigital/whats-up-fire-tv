// Left/Right on the dashboard step through the planes on the map; the chosen one takes the main
// card, shown the way the hero is (app.mjs reads the keys and draws; the rules live here, where
// tests/test-browse.mjs drives them with a clock):
//  - Order: distance from home, closest first, among the planes within the map radius (the ones
//    the map draws). It is worked out again on every update and the choice follows the
//    aircraft's hex, so its number changes as planes move.
//  - The first press starts from the plane on the card (the hero): Right the next one out, Left
//    the one before, wrapping round at either end.
//  - Back to automatic on Back (app.mjs), when the chosen plane leaves the map, after IDLE_MS
//    without Left or Right, and while an emergency squawk has the card.
//  - A plane's photo and route are looked up only once it has stayed chosen HOLD_MS, so
//    stepping quickly through the list sends nothing for the planes passed over.
export const IDLE_MS=60000,HOLD_MS=1000;

// The planes the map draws, closest first.
export const browseOrder=(planes,miles)=>planes.filter(a=>a.ground<=miles)
  .sort((a,b)=>a.ground-b.ground||(a.hex<b.hex?-1:a.hex>b.hex?1:0));

// One press (dir 1 = Right, -1 = Left). state: {hex, since, last} while browsing (the chosen
// plane, when it was chosen, the last press), null for automatic. Returns the new state, or
// null when there is nothing to step through (or an emergency has the card).
export function step(state,m,miles,dir,now){
  if(!m||m.hero?.emergency)return null;
  const list=browseOrder(m.planes,miles);if(!list.length)return null;
  const at=list.findIndex(a=>a.hex===(state?.hex??m.hero?.hex));
  const hex=list[at<0?(dir>0?0:list.length-1):(at+dir+list.length)%list.length].hex;
  return {hex,since:hex===state?.hex?state.since:now,last:now};
}

// The model as the card shows it. While browsing, a copy of the chosen plane takes the hero's
// place, carrying its place in the list ({index, count}) and the status "Plane 3 of 9"; the
// copy also replaces it in planes, so a layout's `a===hero` marks it on the map. Returns
// {state, m}; state is null once browsing has ended.
export function apply(state,m,miles,now){
  if(!state||!m)return {state:null,m};
  if(m.hero?.emergency||now-state.last>=IDLE_MS)return {state:null,m};
  const list=browseOrder(m.planes,miles),i=list.findIndex(a=>a.hex===state.hex);
  if(i<0)return {state:null,m}; // it left the map
  const a=list[i],hero={...a,status:`Plane ${i+1} of ${list.length}`,browse:{index:i+1,count:list.length}};
  return {state,m:{...m,hero,planes:m.planes.map(p=>p===a?hero:p)}};
}

// Chosen long enough for its photo and route to be looked up.
export const held=(state,now)=>!!state&&now-state.since>=HOLD_MS;

// The photo lookup for the plane on the card waits on wait(hex): true at once outside
// browsing, true once a browsed plane has been on the card HOLD_MS, false as soon as another
// plane takes the card. app.mjs calls update() with the plane about to be drawn on the card,
// before every draw (a layout asks for the photo while it draws).
export class LookupGate{
  constructor(){this.waiting=[];this.card='';this.state=null;this.timer=0;}
  wait(hex){
    if(!this.state)return Promise.resolve(true);
    return new Promise(resolve=>{this.waiting.push({hex,resolve});this.update(this.card,this.state,Date.now());});
  }
  update(card,state,now){
    this.card=card;this.state=state;clearTimeout(this.timer);
    const ready=!state||held(state,now);
    this.waiting=this.waiting.filter(({hex,resolve})=>{
      if(hex!==card){resolve(false);return false;}
      if(ready){resolve(true);return false;}
      return true;
    });
    if(this.waiting.length)this.timer=setTimeout(()=>this.update(this.card,this.state,Date.now()),Math.max(0,state.since+HOLD_MS-now)+10);
  }
}
