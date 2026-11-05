import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const OUT=process.argv[2],PORT=process.env.PORT||8794;
const place={name:'Hebron',admin:'Kentucky',country:'United States',countryCode:'US',latitude:39.05,longitude:-84.67,timeZone:'America/New_York'};
const L=(process.env.ONLY||'atlas,atlas-dark,atlas-satellite,radar,glass,departures,blueprint,swiss,synthwave,sectional,cockpit,night-sky').split(',');
for(const layout of L){
  const profile=mkdtempSync(tmpdir()+'/p0');
  const chrome=spawn(process.env.CHECK_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--use-mock-keychain','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=960,540','about:blank'],{stdio:'ignore'});
  let port=0;for(let i=0;i<80&&!port;i++){await sleep(250);try{port=Number(readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0])||0;}catch{}}
  let tabs;for(let i=0;i<40&&!tabs;i++){try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{await sleep(250);}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const w=new Map();const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){w.get(m.id)(m.result);w.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.exception?.description?.slice(0,120));};
  await new Promise(r=>ws.onopen=r);const send=(m,p={})=>new Promise(r=>{w.set(++id,r);ws.send(JSON.stringify({id,method:m,params:p}));});
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:Number(process.env.DSF)||2,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-11-02'}));localStorage.setItem('whatsup.settings.v1',JSON.stringify({place:${JSON.stringify(place)},confirmed:true,layout:'${layout}',mapMiles:15}))`});
  await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html?demo=1&layout=${layout}&map=15&screen=settings`});await sleep(12000);
  await send('Runtime.evaluate',{expression:`document.getElementById('set-privacy').click()`});await sleep(1200);
  const r=await send('Runtime.evaluate',{expression:`(()=>{const ov=document.getElementById('privacy'),st=document.getElementById('stage').getBoundingClientRect(),bad=[];
    if(ov.hidden)return {bad:['PRIVACY NOT OPEN']};
    const card=ov.querySelector('.card').getBoundingClientRect();
    const box=document.getElementById('privacy-qr-box'),qr=document.getElementById('privacy-qr'),q=qr.getBoundingClientRect();
    if(box.hidden||!q.width)bad.push('QR HIDDEN');
    const inside=(r,b)=>r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1;
    if(!inside(q,card))bad.push('QR OUTSIDE CARD');
    for(const e of ov.querySelectorAll('.title,figcaption,button,.doc-hint')){const cs=getComputedStyle(e);if(cs.display==='none'||e.closest('[hidden]'))continue;const b=e.getBoundingClientRect();
      if(!inside(b,card))bad.push('OUTSIDE CARD '+(e.id||e.className||e.tagName));if(e.scrollWidth>e.clientWidth+1)bad.push('CLIP '+(e.id||e.textContent.slice(0,20)));if(/…/.test(e.textContent))bad.push('ELLIPSIS');}
    if(!inside(card,st))bad.push('CARD OFF SCREEN');
    const er=document.getElementById('privacy-erase');if(er.hidden||!er.getBoundingClientRect().width)bad.push('ERASE HIDDEN');
    const doc=document.getElementById('privacy-doc').getBoundingClientRect();if(doc.right>q.left+1)bad.push('DOC OVERLAPS QR');
    const cap=box.querySelector('figcaption'),cc=getComputedStyle(cap),qc=getComputedStyle(ov.querySelector('.card'));
    const dt=document.getElementById('privacy-doc').textContent;const want=${JSON.stringify(process.env.EXPECT_LINE||'')},top=(dt.match(/Version \\d+ · Effective [A-Z][a-z]+ \\d+, \\d{4} · Last updated [A-Z][a-z]+ \\d+, \\d{4}/)||[''])[0];if(!want||top!==want)bad.push('POLICY TOP LINE: '+top);return {top,lolSection:dt.includes('adsb.lol (flight routes, and backup aircraft positions)')&&dt.includes('Backup position requests only while adsb.fi is down'),bad,qr:Math.round(q.width)+'x'+Math.round(q.height),cap:cap.textContent,capColor:cc.color,cardBg:qc.backgroundColor,src:(qr.getAttribute('src')||'').slice(0,30),focus:document.activeElement?.id||document.querySelector('.focus')?.id}})()`,returnByValue:true});
  const v=r.result.value;console.log((v.bad.length||errs.length?'FLAG':'ok  ')+' '+layout.padEnd(16),JSON.stringify(v),errs[0]||'');
  if(OUT){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${OUT}/privacy-${layout}.png`,Buffer.from(s.data,'base64'));}
  ws.close();chrome.kill();await new Promise(r=>{chrome.once('exit',r);setTimeout(r,3000);});try{rmSync(profile,{recursive:true,force:true});}catch{}
}
