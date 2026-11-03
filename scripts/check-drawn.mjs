// node scripts/check-drawn.mjs [layout ...]  (needs the dev server: node scripts/dev-server.mjs assets 8767)
// Regression check for "planes missing from the map": serves a captured real adsb.fi reply
// (tests/fixtures/chicago-feed.json, Chicago, 28 Oct 2026) through the app's fetch bridge,
// with its clock moved to now, and checks that every layout, in both alert-zone modes and
// at two map radii, draws a plane mark inside its map for every one of the snapshot's
// airborne aircraft within the map radius, each one by its hex (data-hex on the marks).
// Exit code 1 if any is missing.
import {spawn} from 'node:child_process';import {readFileSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';

const BASE=process.env.CHECK_URL||'http://localhost:8767/index.html';
const HOME={latitude:41.85003,longitude:-87.65005}; // ?q=Chicago (Open-Meteo's first result)
const feed=JSON.parse(readFileSync(new URL('../tests/fixtures/chicago-feed.json',import.meta.url),'utf8'));
// Each layout's plane marks, and where its map is (a CSS selector for a box, a rect, or a circle).
const LAYOUTS={
  'atlas-dark':{marks:'.at-plane:not(.at-edge)',area:{x:0,y:0,w:700,h:540}},
  atlas:{marks:'.at-plane:not(.at-edge)',area:{x:0,y:0,w:700,h:540}},
  'atlas-satellite':{marks:'.at-plane:not(.at-edge)',area:{x:0,y:0,w:700,h:540}},
  swiss:{marks:'.marks .plane',area:'.mapbox'},
  synthwave:{marks:'.jet',area:{x:0,y:0,w:960,h:540}},
  sectional:{marks:'g.ac',area:{x:0,y:0,w:680,h:540}},
  cockpit:{marks:'g.tcas',area:{cx:300,cy:292,r:232}},
  radar:{marks:'g.blip',area:{cx:270,cy:270,r:256}},
  glass:{marks:'g.gl-plane',area:{x:0,y:0,w:640,h:540}},
  departures:{marks:'circle.dot',area:'.inset'},
  blueprint:{marks:'g.bp-plane',area:{x:0,y:0,w:960,h:540}},
  'night-sky':{marks:'g.star',area:{x:0,y:0,w:960,h:540}},
};
const miles=a=>{const c=Math.cos(HOME.latitude*Math.PI/180);return Math.hypot((a.lon-HOME.longitude)*c*69.172,(a.lat-HOME.latitude)*69);};
const expected=r=>feed.ac.filter(a=>typeof a.alt_baro==='number'&&miles(a)<=r*.98).map(a=>a.hex.toLowerCase()); // 2%: flat-earth vs the app's distance at the rim

async function page(){
  const port=9400+Math.floor(Math.random()*500);
  const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new',`--remote-debugging-port=${port}`,
    '--user-data-dir='+mkdtempSync(tmpdir()+'/drawn'),'--window-size=960,540','about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<40&&!tabs;i++){await new Promise(r=>setTimeout(r,250));try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
  // Feed requests get the snapshot (clock moved to now); everything else goes to the real bridge.
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const FEED=${JSON.stringify(feed)};let v;
    Object.defineProperty(window,'ReactNativeWebView',{configurable:true,get:()=>v,set:b=>{const pm=b.postMessage.bind(b);
      b.postMessage=d=>{const r=JSON.parse(d);(window.__urls=window.__urls||[]).push(r.url);if(/opendata\\.adsb\\.fi/.test(r.url||''))return setTimeout(()=>window.__whatsupReply(r.id,200,JSON.stringify({...FEED,now:Date.now()})),30);pm(d);};v=b;}});})();`});
  return {send,close(){ws.close();chrome.kill();}};
}

const only=process.argv.slice(2),fails=[];
for(const [layout,{marks,area}] of Object.entries(LAYOUTS)){
  if(only.length&&!only.includes(layout))continue;
  for(const map of [15,50])for(const zone of ['circle','window']){
    const p=await page();
    const url=`${BASE}?q=Chicago&layout=${layout}&map=${map}${zone==='window'?'&window=90-180-25':''}`;
    await p.send('Page.navigate',{url});await new Promise(r=>setTimeout(r,9000));
    // Stage pixels (k: the stage's scale on screen; the store build draws it at 90%).
    const js=`(()=>{const st=document.getElementById('stage').getBoundingClientRect(),k=st.width/960,A=${JSON.stringify(area)};
      const box=typeof A==='string'?(r=>({x:(r.x-st.x)/k,y:(r.y-st.y)/k,w:r.width/k,h:r.height/k}))(document.querySelector('#stage '+A).getBoundingClientRect()):A;
      const inside=(x,y)=>box.r?Math.hypot(x-box.cx,y-box.cy)<=box.r:x>=box.x&&x<=box.x+box.w&&y>=box.y&&y<=box.y+box.h;
      return [...document.querySelectorAll('#stage .layout ${marks}')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&inside((r.x+r.width/2-st.x)/k,(r.y+r.height/2-st.y)/k);}).map(e=>e.dataset.hex);})()`;
    const drawn=(await p.send('Runtime.evaluate',{expression:js,returnByValue:true})).result?.value;
    if(process.env.CHECK_DEBUG)console.log('  drawn:',(drawn||[]).join(' '),'\n  urls:',(await p.send('Runtime.evaluate',{expression:'JSON.stringify(window.__urls)',returnByValue:true})).result?.value);
    p.close();
    const want=expected(map),shown=new Set(drawn||[]),missing=want.filter(h=>!shown.has(h)),ok=!missing.length;
    console.log(`${ok?'ok  ':'FAIL'} ${layout.padEnd(16)} ${String(map).padStart(2)} mi ${zone.padEnd(6)} feed ${want.length} airborne within the radius, map draws ${want.length-missing.length} of them${missing.length?` (missing ${missing.join(' ')})`:''}`);
    if(!ok)fails.push(layout);
  }
}
process.exit(fails.length?1:0);
