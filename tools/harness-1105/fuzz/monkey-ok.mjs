// Monkey test (busy-cog weighted, see COG below): node monkey-ok.mjs <seed> <presses>  (monkey-browse: Left/Right weighted up for plane browsing,
// with fast Left/Right bursts, and a check that the browse read-out stays sane)
// Drives the real page (dev server :8767) with random remote presses and checks invariants.
// Everything but map tiles/imagery is answered locally (feed snapshots, geocoder, routes,
// photos), including hostile and malformed data. Prints one JSON line per session.
import {spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';
const [seed=1,presses=300]=process.argv.slice(2);
let s=(Number(seed)*7919)%233280;const rnd=()=>((s=(s*9301+49297)%233280)/233280);
const pick=a=>a[Math.floor(rnd()*a.length)];
const LAYOUTS=['atlas-dark','atlas','atlas-satellite','swiss','synthwave','sectional','cockpit','radar','glass','departures','blueprint','night-sky'];
const LOCS=[['Chicago',41.88,-87.63,'US','America/Chicago','Illinois'],['Rural Montana',47.5,-108.5,'US','America/Denver','Montana'],
  ['Mid-Pacific',0.5,-140,'','Pacific/Kiritimati',''],['North Pole',89.9,10,'','UTC',''],['South Pole',-89.9,0,'AQ','Antarctica/McMurdo',''],
  ['Suva',-17.7,179.99,'FJ','Pacific/Fiji','Central'],['Date line W',-17.7,-179.99,'FJ','Pacific/Fiji',''],['Beijing',39.9,116.4,'CN','Asia/Shanghai','Beijing'],
  ['Null Island',0,0,'','UTC',''],['London',51.5,-0.12,'GB','Europe/London','England'],['Tokyo',35.68,139.7,'JP','Asia/Tokyo','Tokyo'],
  ['Sydney',-33.86,151.2,'AU','Australia/Sydney','New South Wales'],['Reykjavík',64.1,-21.9,'IS','Atlantic/Reykjavik',''],
  ['Anchorage',61.2,-149.9,'US','America/Anchorage','Alaska'],['Honolulu',21.3,-157.8,'US','Pacific/Honolulu','Hawaii'],['Kathmandu',27.7,85.3,'NP','Asia/Kathmandu','']];
const KEYS=[['ArrowUp',38],['ArrowDown',40],['ArrowLeft',37],['ArrowRight',39],['ArrowRight',39],['ArrowLeft',37],['ArrowRight',39],['ArrowLeft',37],['Enter',13],['Enter',13],['Enter',13],
  ['Escape',27],['MediaPlayPause',179],['a',65],['7',55],[' ',32],['Backspace',8]];
const cfg={layout:pick(LAYOUTS),loc:pick(LOCS),metric:rnd()<.3,win:rnd()<.4?pick(['90-180-25','350-20-15','0-359-50','180-90-5']):'',
  map:pick([2,5,10,15,25,50,250]),feed:pick(['demo','demo','demo','many','many','one','empty','empty','garbage','garbage'])};
const profile=mkdtempSync(tmpdir()+'/monkey'); // Chrome picks its debugging port (DevToolsActivePort)
const chrome=spawn(process.env.CHECK_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--use-mock-keychain','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
  '--user-data-dir='+profile,'--window-size=960,540','about:blank'],{stdio:'ignore'});
let port=0;for(let i=0;i<80&&!port;i++){await new Promise(r=>setTimeout(r,250));try{port=Number(readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0])||0;}catch{}}
let tabs;for(let i=0;i<40&&!tabs;i++){try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{await new Promise(r=>setTimeout(r,250));}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}
  if(m.method==='Runtime.exceptionThrown')errors.push('exception: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text).split('\n').slice(0,3).join(' | '));
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push('console.error: '+m.params.args.map(a=>a.value??a.description).join(' ').slice(0,200));};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
await send('Runtime.enable');await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
const [lname,lat,lon,cc,tz,admin]=cfg.loc;
await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{let v;
  const EVIL='<img src=x onerror="window.__pwned=1"><script>window.__pwned=2<\\/script>\\u202eRTL\\u200b😀&amp;&lt;b&gt;';
  const LOC=${JSON.stringify({name:lname,latitude:lat,longitude:lon,country_code:cc,country:cc||'',admin1:admin,timezone:tz})};
  const meteo=JSON.stringify({results:[LOC,{name:'Springfield'+EVIL,latitude:39.8,longitude:-89.6,country_code:'US',country:'United States',admin1:'Illinois',timezone:'America/Chicago'},
    {name:'x'.repeat(400),latitude:999,longitude:-999},{name:null,latitude:'NaN'}]});
  const MODE=${JSON.stringify(cfg.feed)};
  let seed=${Number(seed)};const r=()=>((seed=(seed*9301+49297)%233280)/233280);
  function feed(u){
    const m=/lat\\/(-?[\\d.]+)\\/lon\\/(-?[\\d.]+)\\/dist\\/(\\d+)/.exec(u)||[0,0,0,50];const la=+m[1],lo=+m[2],nm=+m[3];
    const now=Date.now();
    const plane=(i,o={})=>({hex:(0xa00000+i).toString(16),flight:'TST'+i+' ',r:'N'+i,t:['B738','A320','C172','B77W','R44'][i%5],
      lat:la+(r()-.5)*nm/30,lon:lo+(r()-.5)*nm/30/Math.max(.05,Math.cos(la*Math.PI/180)),alt_baro:Math.round(r()*40000),gs:r()*500,track:r()*360,
      baro_rate:(r()-.5)*4000,seen_pos:r()*3,seen:0,category:'A3',...o});
    let ac=[];
    if(MODE==='one')ac=[plane(1,{lat:la+.02,lon:lo+.02})];
    if(MODE==='many')ac=Array.from({length:500},(_,i)=>plane(i));
    if(MODE==='garbage'){
      ac=Array.from({length:60},(_,i)=>plane(i));
      const bad=[{hex:'zzzzzz'},{hex:'',lat:la,lon:lo,alt_baro:1000,seen_pos:0},{hex:'abcdef',lat:'x',lon:lo,alt_baro:1000,seen_pos:0},
        {hex:'abcde0',lat:la,lon:lo,alt_baro:'ground',seen_pos:0},{hex:'abcde1',lat:la,lon:lo,alt_baro:-1200,gs:-5,track:9999,seen_pos:0},
        {hex:'abcde2',lat:la,lon:lo,alt_baro:1e9,gs:1e9,seen_pos:0,flight:EVIL,r:EVIL,t:EVIL,ownOp:EVIL},
        {hex:'abcde3',lat:NaN,lon:Infinity,alt_baro:null,seen_pos:-4},{hex:'abcde4',lat:la+.01,lon:lo,alt_baro:5000,seen_pos:0,flight:'x'.repeat(300),squawk:'7700',emergency:'general'},
        {hex:'abcde4',lat:la+.011,lon:lo,alt_baro:5100,seen_pos:0,flight:'DUPE'},{hex:'abcde5',lat:la,lon:lo,alt_baro:3000,seen_pos:9999},
        null,7,'str',[],{}];
      ac.push(...bad);
    }
    return JSON.stringify(MODE==='garbage'&&r()<.2?{now:'soon',ac:'nope'}:{now,ac,msg:'No error',total:ac.length});
  }
  const photo=JSON.stringify({photos:[{thumbnail_large:{src:'https://t.plnspttrs.net/12345/abc_280.jpg',size:{width:420,height:280}},
    link:MODE==='garbage'?'javascript:alert(1)':'https://www.planespotters.net/photo/123/test',photographer:MODE==='garbage'?EVIL:'Test Photographer'}]});
  const route=JSON.stringify({_airport_codes_iata:'AAA-BBB',airport_codes:'KAAA-KBBB',_airports:[{iata:'AAA',location:EVIL,name:EVIL,lat:LOC.latitude,lon:LOC.longitude},{iata:'BBB',location:'B'+EVIL,name:'B',lat:LOC.latitude+1,lon:LOC.longitude+1}]});
  Object.defineProperty(window,'ReactNativeWebView',{configurable:true,get:()=>v,set:b=>{const pm=b.postMessage.bind(b);
    b.postMessage=d=>{const q=JSON.parse(d);const u=q.url||'';const reply=(st,t,ms=40)=>setTimeout(()=>window.__whatsupReply(q.id,st,t),ms);
      // adsb.fi down one minute in three (live feeds): the app moves to adsb.lol and back.
      if(/opendata\\.adsb\\.fi/.test(u))return MODE==='demo'?pm(d):Math.floor(Date.now()/60000)%3===1?reply(r()<.5?'connection_error':503,'',r()<.3?4480:60):reply(r()<.05?503:200,feed(u));
      if(/api\\.adsb\\.lol\\/v2/.test(u))return MODE==='demo'?pm(d):reply(r()<.04?503:r()<.02?429:200,feed(u));
      if(/open-meteo\\.com\\/v1\\/search/.test(u))return reply(200,meteo);
      if(/census\\.gov|nominatim/.test(u))return reply(r()<.5?200:503,'{"result":{"addressMatches":[]}}',80);
      if(/geojs/.test(u))return reply(200,JSON.stringify({city:LOC.name,region:LOC.admin1,country:LOC.country,country_code:LOC.country_code,latitude:String(LOC.latitude),longitude:String(LOC.longitude),timezone:LOC.timezone,accuracy:5}));
      if(/api\\.open-meteo\\.com\\/v1\\/forecast/.test(u))return reply(200,JSON.stringify({timezone:LOC.timezone,utc_offset_seconds:0}));
      if(/planespotters/.test(u))return reply(200,photo);
      if(/vrs-standing-data\\.adsb\\.lol/.test(u))return reply(MODE==='garbage'&&r()<.3?429:200,route);
      pm(d);};v=b;}});})();`});
const url=`http://localhost:${process.env.PORT||8771}/index.html?${cfg.feed==='demo'?'demo=1&':''}q=Monkey&layout=${cfg.layout}&map=${cfg.map}${cfg.metric?'&units=metric':''}${cfg.win?'&window='+cfg.win:''}`;
await send('Page.navigate',{url});await new Promise(r=>setTimeout(r,6000));
const CHECK=`(()=>{const st=document.getElementById('stage'),S=st.getBoundingClientRect(),bad=[];
  const layouts=st.querySelectorAll('.layout').length;if(layouts!==1)bad.push('layouts='+layouts);
  const open=[...document.querySelectorAll('.overlay')].filter(o=>!o.hidden&&getComputedStyle(o).display!=='none');
  const focus=document.querySelector('.focus');
  if(open.length&&!focus&&!st.classList.contains('picking'))bad.push('overlay open, nothing focused: '+open.map(o=>o.id));
  if(focus&&(focus.offsetParent===null||focus.closest('[hidden]')))bad.push('focus on hidden element '+(focus.id||focus.className));
  if(document.getElementById('busy')?.classList.contains('on'))bad.push('busy cog still on');
  // An edit left behind: a row (or the card) in edit mode while Settings is closed, or the card in
  // edit mode with no row being edited (the kept OK must end the edit it was pressed for).
  {const set=document.getElementById('settings'),row=set?.querySelector('.row.editing'),card=set?.querySelector('.card.editing');
   if(set?.hidden&&(row||card))bad.push('EDIT-LEFT-OPEN '+(row?.id||'card'));if(!set?.hidden&&card&&!row)bad.push('EDIT-CARD-WITHOUT-ROW');}
  if(window.__pwned)bad.push('XSS executed '+window.__pwned);
  if(document.querySelector('#stage img[src^="javascript"],#stage a[href^="javascript"]'))bad.push('javascript: URL in DOM');
  for(const e of st.querySelectorAll('*')){
    if(e.children.length||!(e.textContent||'').trim()||e.closest('.sr-only'))continue;
    const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden'||e.closest('[hidden]'))continue;
    const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;
    const t=e.textContent;
    if(/undefined|NaN|Infinity|\\[object|\\bnull\\b/.test(t))bad.push('BADTEXT '+t.slice(0,60));
    if(/<img|<script|onerror/.test(t)&&!e.closest('#results,#entry-text'))bad.push('RAW-MARKUP-TEXT '+(e.id||e.className?.baseVal||e.className)+': '+t.slice(0,40));
    if(e.scrollWidth>e.clientWidth+2&&cs.overflow!=='visible'&&cs.whiteSpace==='nowrap'&&!e.closest('#entry-text'))bad.push('CLIP '+(e.id||e.className)+': '+t.slice(0,40));
    if(/\\u2026/.test(t)&&!/(Connecting|Drawing|Filling|Finding|Searching|Loading|retrying)/i.test(t))bad.push('ELLIPSIS '+t.slice(0,40));
    if(r.right>S.right+2||r.bottom>S.bottom+2||r.left<S.left-2||r.top<S.top-2)bad.push('OFFSTAGE '+(e.id||e.className?.baseVal||e.className)+': '+t.slice(0,30));
  }
  const sr=document.getElementById('sr-live')?.textContent||'',b=/^Plane (\\d+) of (\\d+)/.exec(sr);
  if(b&&(+b[1]<1||+b[1]>+b[2]))bad.push('BROWSE-COUNT '+sr.slice(0,40));
  const heap=Math.round(performance.memory.usedJSHeapSize/1e6);
  return JSON.stringify({bad:[...new Set(bad)].slice(0,8),heap,top:open.map(o=>o.id).join('>')});})()`;
const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.value;
const key=async(k,code,repeat=false)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k.length===1?'Key'+k.toUpperCase():k,windowsVirtualKeyCode:code,autoRepeat:repeat&&type==='keyDown'});};
const nap=ms=>new Promise(r=>setTimeout(r,ms));
const log=[],findings=new Map();let heap0=0,heapMax=0,heapEnd=0;
const note=(b,ctx)=>{const k=b.replace(/\d+/g,'#');if(!findings.has(k))findings.set(k,`${b}  [${ctx}]`);};
for(let i=0;i<presses;i++){
  const roll=rnd();
  if(roll<.06){for(let j=0;j<12;j++){const [k2,c2]=pick(KEYS);await key(k2,c2);}log.push('MASH');}
  // Around the busy cog (3cdd18d keeps one OK pressed during it): a change that sets the cog off
  // (in Settings: OK then Right on the focused row; on the dashboard: zoom), then OK, Back, the
  // arrows or Play/Pause 20-450 ms later, inside the cog or just after it.
  else if(roll>=.10&&roll<.40){
    if(await ev(`!document.getElementById('settings').hidden`)){await key('Enter',13);await nap(60);await key('ArrowRight',39);}
    else{const [k2,c2]=pick([['ArrowUp',38],['ArrowDown',40]]);await key(k2,c2);}
    for(let j=0,n=1+Math.floor(rnd()*3);j<n;j++){await nap(pick([20,60,150,300,450]));const [k2,c2]=pick([['Enter',13],['Enter',13],['Escape',27],['ArrowDown',40],['ArrowUp',38],['ArrowLeft',37],['ArrowRight',39],['MediaPlayPause',179]]);await key(k2,c2);}
    log.push('COG');}
  else if(roll<.09){const n=8+Math.floor(rnd()*13),[k2,c2]=pick([['ArrowLeft',37],['ArrowRight',39]]);for(let j=0;j<n;j++)await key(k2,c2);log.push('BROWSE-BURST-'+k2);}
  else if(roll<.1){const [k2,c2]=pick(KEYS.slice(0,4));for(let j=0;j<15;j++)await key(k2,c2,true);log.push('HOLD-'+k2);}
  else{const [k,c]=pick(KEYS);await key(k,c);log.push(k);}
  await new Promise(r=>setTimeout(r,rnd()<.1?1200:rnd()<.5?30:120));
  if(i%50===49||i===presses-1){
    await new Promise(r=>setTimeout(r,1200));
    const r=JSON.parse(await ev(CHECK)||'{}');
    if(!heap0)heap0=r.heap;heapMax=Math.max(heapMax,r.heap);heapEnd=r.heap;
    for(const b of r.bad||[])note(b,`after ${log.slice(-8).join(',')} | screen ${r.top||'dashboard'} | press ${i}`);
  }
}
// Settings always reachable and closable, and settings persist across a reload.
// Back x8, 400 ms apart: the page drops a second Back within 350 ms (the app and the page may both
// report one press), so closer presses would count as fewer. Screens close first, then browsing ends.
const openBefore=await ev(`[...document.querySelectorAll('.overlay')].filter(o=>!o.hidden).map(o=>o.id).join('>')+(document.getElementById('picker').hidden?'':' picker')+' | '+(document.getElementById('sr-live').textContent||'').slice(0,20)`);
for(let j=0;j<8;j++){await key('Escape',27);await new Promise(r=>setTimeout(r,400));}
await new Promise(r=>setTimeout(r,1200));
const topAfterBack=await ev(`[...document.querySelectorAll('.overlay')].filter(o=>!o.hidden).map(o=>o.id).join('>')`);
if(topAfterBack&&!/welcome/.test(topAfterBack))note('Back x8 does not return to the dashboard: '+topAfterBack,'end');
// The read-out isn't refreshed over a screen; after the screens close it is at the next feed update
// (5-15 s), so wait for one before calling browsing stuck.
{let still=true;for(let t=0;t<17&&still;t++){still=/^Plane \d/.test(await ev(`document.getElementById('sr-live').textContent`)||'');if(still)await new Promise(r=>setTimeout(r,1000));}
if(still)note('Back x8 left plane browsing on (before: '+openBefore+')','end');}
await key('MediaPlayPause',179);await new Promise(r=>setTimeout(r,800));
const opened=await ev(`!document.getElementById('settings').hidden`);
if(!opened&&!topAfterBack)note('Play/Pause did not open Settings','end');
await key('Escape',27);await new Promise(r=>setTimeout(r,600));
if(await ev(`!document.getElementById('settings').hidden`))note('Back did not close Settings','end');
const before=await ev(`localStorage.getItem('whatsup.settings.v1')`);
await send('Page.reload');await new Promise(r=>setTimeout(r,5000));
const after=await ev(`localStorage.getItem('whatsup.settings.v1')`);
const strip=j=>{try{const o=JSON.parse(j);delete o.place;return JSON.stringify(o);}catch{return j;}};
if(before&&strip(before)!==strip(after))note('settings changed across reload','reload');
for(const e of errors)note(e,'console');
console.log(JSON.stringify({seed:Number(seed),cfg:{...cfg,loc:lname},heap0,heapMax,heapEnd,findings:[...findings.values()].slice(0,12)}));
ws.close();chrome.kill();await new Promise(r=>{chrome.once('exit',r);setTimeout(r,3000);});try{rmSync(profile,{recursive:true,force:true});}catch{}process.exit(0);
