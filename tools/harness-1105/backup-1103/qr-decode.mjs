// node qr-decode.mjs: opens Settings > Privacy on the build at PORT (demo data) and decodes the QR
// on the page with Chrome's own BarcodeDetector.
import {mkdtempSync} from 'node:fs';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const PORT=process.env.PORT||8816;
const place={name:'Hebron',admin:'Kentucky',country:'United States',countryCode:'US',latitude:39.05,longitude:-84.67,timeZone:'America/New_York'};
const port=9900+Math.floor(Math.random()*90);
const chrome=spawn(process.env.CHECK_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--use-mock-keychain','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,'--user-data-dir='+mkdtempSync(tmpdir()+'/qrd'),'--window-size=960,540','about:blank'],{stdio:'ignore'});
let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const w=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){w.get(m.id)(m.result);w.delete(m.id);}};
await new Promise(r=>ws.onopen=r);const send=(m,p={})=>new Promise(r=>{w.set(++id,r);ws.send(JSON.stringify({id,method:m,params:p}));});
const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.value;
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:2,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-11-03'}));localStorage.setItem('whatsup.settings.v1',JSON.stringify({place:${JSON.stringify(place)},confirmed:true,layout:'atlas-dark',mapMiles:15}))`});
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html?demo=1&layout=atlas-dark&screen=settings`});await sleep(9000);
await ev(`document.getElementById('set-privacy').click()`);await sleep(1500);
const out=await ev(`(async()=>{const r=[];for(const id of ['privacy-qr']){const img=document.getElementById(id);try{await img.decode?.();const c=await new BarcodeDetector({formats:['qr_code']}).detect(img);r.push([id,c.map(x=>x.rawValue)]);}catch(e){r.push([id,'error '+e.message]);}}
  const d=document.getElementById('privacy-doc').textContent;return {qr:r,top:(d.match(/Version \\d+ · Effective [A-Z][a-z]+ \\d+, \\d{4} · Last updated [A-Z][a-z]+ \\d+, \\d{4}/)||[''])[0],open:!document.getElementById('privacy').hidden};})()`);
console.log(JSON.stringify(out));ws.close();chrome.kill();process.exit(0);
