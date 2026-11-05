// node soak2h.mjs <port> <hours> <out.jsonl>: a long soak of the store build at CVG (39.05, -84.65),
// 10 mi map, real services (through soak-server2), with adsb.fi blocked in this browser for the
// first 20 minutes of every hour. Every minute: JS heap after GC, DOM size, live timers, the
// screen (planes, "No live data"…), the credit line, and requests per host since the last
// sample. Feed answers and timings are in the server's log.
import {mkdtempSync,readFileSync,appendFileSync,rmSync} from 'node:fs';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';import {join} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const [PORT,HOURS,OUT]=[Number(process.argv[2])||8828,Number(process.argv[3])||2,process.argv[4]||'soak2h.jsonl'];
const place={name:'Hebron',admin:'Kentucky',country:'United States',countryCode:'US',latitude:39.05,longitude:-84.65,timeZone:'America/New_York'};
const profile=mkdtempSync(tmpdir()+'/soak');
const chrome=spawn(process.env.CHECK_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--use-mock-keychain','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=960,540','--no-first-run','--disable-background-networking','about:blank'],{stdio:'ignore'});
let port=0;for(let i=0;i<80&&!port;i++){await sleep(250);try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])||0;}catch{}}
let tabs;for(let i=0;i<60&&!tabs;i++){try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{await sleep(250);}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const w=new Map(),errors=[];
const T0=Date.now(),min=()=>Math.round((Date.now()-T0)/600)/100;
const send=(m,p={})=>new Promise(r=>{w.set(++id,r);ws.send(JSON.stringify({id,method:m,params:p}));});
ws.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.id&&w.has(m.id)){w.get(m.id)(m.result);w.delete(m.id);return;}
  if(m.method==='Runtime.exceptionThrown')errors.push(min()+' exception: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text).slice(0,160));
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(min()+' console.error: '+m.params.args.map(a=>a.value??a.description).join(' ').slice(0,160));
};
await new Promise(r=>ws.onopen=r);
const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true})).result?.value;
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('HeapProfiler.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
// Live timers (setTimeout/setInterval not yet fired or cleared) and requests per host, counted in the page.
await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-11-03'}));localStorage.setItem('whatsup.settings.v1',JSON.stringify({place:${JSON.stringify(place)},confirmed:true,layout:'atlas-dark',mapMiles:10,radiusMiles:3,placeNames:'cities'}));}
(()=>{window.__req={};const st=window.setTimeout,ct=window.clearTimeout,si=window.setInterval,ci=window.clearInterval,live=new Set(),livei=new Set();
 window.setTimeout=(f,ms,...a)=>{const h=st(()=>{live.delete(h);typeof f==='function'&&f(...a)},ms);live.add(h);return h};window.clearTimeout=h=>{live.delete(h);ct(h)};
 window.setInterval=(f,ms,...a)=>{const h=si(f,ms,...a);livei.add(h);return h};window.clearInterval=h=>{livei.delete(h);ci(h)};
 window.__liveTimers=()=>({timeouts:live.size,intervals:livei.size});
 const of=window.fetch;window.fetch=(u,o)=>{try{const m=/proxy\\?url=([^&]+)/.exec(String(u));if(m){const h=new URL(decodeURIComponent(m[1])).host;window.__req[h]=(window.__req[h]||0)+1;}}catch{}return of(u,o);};})();`});
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html`});
// adsb.fi is blocked for 20 minutes of each hour, from BLOCK_FROM_MIN (default 0: the first 20).
const BLOCK_FROM=Number(process.env.BLOCK_FROM_MIN)||0,blockedAt=into=>into>=BLOCK_FROM*60000&&into<(BLOCK_FROM+20)*60000;
let blocked=null,prev={};
const setBlock=async on=>{if(on===blocked)return;blocked=on;await send('Network.setBlockedURLs',{urls:on?['*opendata.adsb.fi*']:[]});
  appendFileSync(OUT,JSON.stringify({t:min(),event:on?'adsb.fi blocked':'adsb.fi unblocked',at:new Date().toISOString()})+'\n');};
const end=T0+HOURS*3600000;let next=T0;
while(Date.now()<end){
  const into=(Date.now()-T0)%3600000;await setBlock(blockedAt(into));
  // Sample once a minute (screen every 5 s in between, so short states are seen).
  const tally={planes:0,noLive:0,connecting:0,quiet:0,other:0};let credit='';
  for(let i=0;i<12;i++){
    const s=await ev(`(()=>{const t=document.getElementById('layout')?.innerText||'',c=document.getElementById('credit-flash');
      return {marks:new Set([...document.querySelectorAll('#layout [data-hex]')].map(g=>g.getAttribute('data-hex'))).size,
        status:(t.match(/(No live data[^\\n]*|Connecting[^\\n]*|Quiet skies[^\\n]*|No signal)/)||[''])[0],
        credit:c&&c.classList.contains('on')?document.getElementById('credit-a').textContent.replace(/ · Map.*/,''):''}})()`).catch(()=>null);
    if(s){const k=/^No live data/.test(s.status)?'noLive':/^Connecting/.test(s.status)?'connecting':/^Quiet skies/.test(s.status)?'quiet':s.marks?'planes':'other';tally[k]++;if(s.credit)credit=s.credit;}
    next+=5000;await sleep(Math.max(0,next-Date.now()));
    if(blockedAt((Date.now()-T0)%3600000)!==blocked)await setBlock(blockedAt((Date.now()-T0)%3600000));
  }
  await send('HeapProfiler.collectGarbage');
  const m=await ev(`({heap:performance.memory.usedJSHeapSize,dom:document.getElementsByTagName('*').length,timers:window.__liveTimers(),req:window.__req,ls:JSON.stringify(localStorage).length})`).catch(()=>null);
  if(!m)continue;
  const d=Object.fromEntries(Object.entries(m.req).map(([h,n])=>[h,n-(prev[h]||0)]).filter(([,n])=>n));prev=m.req;
  appendFileSync(OUT,JSON.stringify({t:min(),blocked,heapMB:+(m.heap/1e6).toFixed(1),dom:m.dom,timers:m.timers,lsKB:Math.round(m.ls/1024),screen5s:tally,credit,req:d,errors:errors.length})+'\n');
}
appendFileSync(OUT,JSON.stringify({event:'end',errors:errors.slice(0,20)})+'\n');
ws.close();chrome.kill();await new Promise(r=>{chrome.once('exit',r);setTimeout(r,3000);});try{rmSync(profile,{recursive:true,force:true});}catch{}process.exit(0);
