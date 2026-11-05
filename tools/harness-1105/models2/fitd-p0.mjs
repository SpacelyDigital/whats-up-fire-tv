import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const OUT=process.argv[2],scene=process.argv[3]||'',PORT=process.env.PORT||8792;
const place={name:'Hebron',admin:'Kentucky',country:'United States',countryCode:'US',latitude:39.05,longitude:-84.67,timeZone:'America/New_York'};
const L=(process.env.ONLY||'atlas,atlas-dark,atlas-satellite,radar,glass,departures,blueprint,swiss,synthwave,sectional,cockpit,night-sky').split(',');
for(const layout of L){
  const profile=mkdtempSync(tmpdir()+'/p0');
  const chrome=spawn(process.env.CHECK_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--use-mock-keychain','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=960,540','about:blank'],{stdio:'ignore'});
  let port=0;for(let i=0;i<80&&!port;i++){await sleep(250);try{port=Number(readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0])||0;}catch{}}
  let tabs;for(let i=0;i<40&&!tabs;i++){try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{await sleep(250);}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const w=new Map();const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){w.get(m.id)(m.result);w.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.exception?.description?.slice(0,120));if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errs.push(m.params.args.map(a=>a.value||a.description).join(' ').slice(0,160));};
  await new Promise(r=>ws.onopen=r);const send=(m,p={})=>new Promise(r=>{w.set(++id,r);ws.send(JSON.stringify({id,method:m,params:p}));});
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');if(process.env.BLOCK)await send('Network.setBlockedURLs',{urls:['*planespotters*','*plnspttrs*']});
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:Number(process.env.DSF)||2,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-10-29'}));localStorage.setItem('whatsup.settings.v1',JSON.stringify({place:${JSON.stringify(place)},confirmed:true,layout:'${layout}',mapMiles:15,placeNames:'cities'}))`});
  await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html?demo=1&layout=${layout}&map=15${scene?'&scene='+scene:''}${process.env.HERO?'&herotype='+process.env.HERO:''}`});await sleep(14000);
  const r=await send('Runtime.evaluate',{expression:`(()=>{const st=document.getElementById('stage').getBoundingClientRect(),root=document.getElementById('layout');
    const bad=[];for(const e of root.querySelectorAll('*')){if(e.children.length||!(e.textContent||'').trim()||e.closest('svg'))continue;const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden'||e.closest('[hidden]'))continue;const r=e.getBoundingClientRect();if(!r.width)continue;
      if(e.scrollWidth>e.clientWidth+1&&cs.overflow!=='visible')bad.push('CLIP '+(e.className||e.tagName)+': '+e.textContent.slice(0,40));
      if(r.right>st.right+2||r.bottom>st.bottom+2||r.left<st.left-2||r.top<st.top-2)bad.push('OFF '+(e.className||e.tagName)+': '+e.textContent.slice(0,30));
      if(/…/.test(e.textContent))bad.push('ELLIPSIS '+e.textContent.slice(0,40));
      if(/\\/\\s*$/.test(e.textContent.trim()))bad.push('TRAILING-SLASH '+e.textContent.slice(0,50));}
    // Text cut by any clipping box: the text's own extent must stay inside the content box of
    // every element from itself up to the screen whose overflow isn't visible.
    for(const e of root.querySelectorAll('*')){if(e.children.length||!(e.textContent||'').trim()||e.closest('svg'))continue;const cs=getComputedStyle(e);
      if(cs.display==='none'||cs.visibility==='hidden'||e.closest('[hidden]'))continue;
      const rg=document.createRange();rg.selectNodeContents(e);const t=rg.getBoundingClientRect();if(t.width<1)continue;
      for(let a=e;a&&a!==document.body;a=a.parentElement){const as=getComputedStyle(a);if(as.overflowX==='visible'&&as.overflowY==='visible')continue;
        const b=a.getBoundingClientRect(),pl=parseFloat(as.paddingLeft)+parseFloat(as.borderLeftWidth),pr=parseFloat(as.paddingRight)+parseFloat(as.borderRightWidth),pt=parseFloat(as.paddingTop)+parseFloat(as.borderTopWidth),pb=parseFloat(as.paddingBottom)+parseFloat(as.borderBottomWidth);
        // Sideways: strict. Up/down: a text box with line-height 1 is taller than its line, so
        // allow 30% of the font size (the glyphs' ink stays inside).
        const fs=parseFloat(cs.fontSize),v=fs*.3;
        const dir=t.right>b.right-pr+1?'right by '+Math.round(t.right-(b.right-pr)):t.left<b.left+pl-1?'left':t.bottom>b.bottom-pb+v?'bottom by '+Math.round(t.bottom-(b.bottom-pb)):t.top<b.top+pt-v?'top':'';
        if(dir){bad.push('CUT-BY '+(a===e?'itself':a.className||a.tagName)+' ('+dir+'): '+e.textContent.slice(0,40));break;}}}
    // Every visible element (photos and QR codes included) sits fully inside the 960x540 screen.
    for(const e of root.querySelectorAll('*')){if(e.closest('svg')&&e.tagName!=='svg')continue;const cs=getComputedStyle(e);
      if(cs.display==='none'||cs.visibility==='hidden'||e.closest('[hidden]')||+cs.opacity===0)continue;const r=e.getBoundingClientRect();if(r.width<1||r.height<1)continue;
      // Background graphics drawn past the edge on purpose and clipped by the screen: Radar's sweep, Synthwave's floor.
      if(e.closest('.L-radar .sweep,.L-synthwave .floor'))continue;
      if(r.right>st.right+1||r.bottom>st.bottom+1||r.left<st.left-1||r.top<st.top-1)bad.push('OUTSIDE '+e.tagName+'.'+(typeof e.className==='string'?e.className:'')+' '+Math.round(r.left-st.left)+','+Math.round(r.top-st.top)+' '+Math.round(r.width)+'x'+Math.round(r.height));}
    // A Planespotters photo's credit must keep the photographer and the site.
    for(const c of root.querySelectorAll('.ph-cap,.at-credit')){const box=c.closest('.ph,.at-id');const img=box&&box.querySelector('img[src*="plnspttrs"],img[src*="planespotters"]');
      if(img&&getComputedStyle(c).display!=='none'&&!/Planespotters/.test(c.textContent))bad.push('CREDIT-CUT '+c.textContent.slice(0,50));
      if(c.scrollWidth>c.clientWidth+1||c.scrollHeight>c.clientHeight+1)bad.push('CREDIT-CLIP '+c.textContent.slice(0,50));}
    const txt=root.innerText;const m=txt.match(/(Military|MILITARY|military|MIL)[^\\n]{0,40}/g)||[];
    const mi=[...root.querySelectorAll('img')].find(i=>(i.getAttribute('src')||'').includes('models/')&&i.offsetWidth);const cap=mi&&(mi.closest('.ph,.at-id,.ck-photo,[class*=pic],[class*=photo]')||document).querySelector('.ph-cap,.at-credit,[class*=cap],[class*=credit]');
    return {model:mi?mi.getAttribute('src')+' '+mi.offsetWidth+'x'+mi.offsetHeight:'none',cap:cap?cap.textContent:'',bad,mil:root.querySelectorAll('.mil').length,milText:[...new Set(m)].slice(0,4),cargoLabel:/Cargo tonight|CARGO TONIGHT|cargo tonight/.test(txt)}})()`,returnByValue:true});
  const v=r.result.value;console.log((v.bad.length||errs.length?'FLAG':'ok  ')+' '+layout.padEnd(16),'mil-marked',v.mil,'| text',JSON.stringify(v.milText),'|',v.model,'|',JSON.stringify(v.cap),v.bad.length?'| '+v.bad.slice(0,4).join(' ; '):'',errs.length?'| ERR '+errs[0]:'');
  if(OUT){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${OUT}/${layout}${scene?'-'+scene:''}${process.env.HERO?'-'+process.env.HERO:''}.png`,Buffer.from(s.data,'base64'));}
  ws.close();chrome.kill();await new Promise(r=>{chrome.once('exit',r);setTimeout(r,3000);});try{rmSync(profile,{recursive:true,force:true});}catch{}
}
