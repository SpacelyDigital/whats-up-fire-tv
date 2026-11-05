// node soak-server2.mjs <assetsDir> <port> <log.jsonl>: the dev server (scripts/dev-server.mjs) for a
// soak against the real services, logging every adsb.fi and api.adsb.lol answer (host field): time, status, latency,
// Retry-After and any rate-limit headers, aircraft count. Requests carry the store build's
// User-Agent. Test only: it forwards just what the page asks, on the app's allow-list.
import {createServer} from 'node:http';
import {readFile,appendFile} from 'node:fs/promises';
import {join,extname,normalize} from 'node:path';

const [root,portArg,LOG]=process.argv.slice(2);const port=Number(portArg)||8818;
const UA='WhatsUp-FireTV/1.0 (Spacely Digital; spacelydigital@gmail.com)';
const ALLOWED=[
  /^https:\/\/opendata\.adsb\.fi\/api\/v3\/lat\/-?\d{1,2}\.\d{2}\/lon\/-?\d{1,3}\.\d{2}\/dist\/\d{1,3}$/,
  /^https:\/\/api\.adsb\.lol\/v2\/lat\/-?\d{1,2}\.\d{2}\/lon\/-?\d{1,3}\.\d{2}\/dist\/\d{1,3}$/,
  /^https:\/\/vrs-standing-data\.adsb\.lol\/routes\/[A-Z0-9-]{2}\/[A-Z0-9-]{2,10}\.json$/,
  /^https:\/\/get\.geojs\.io\/v1\/ip\/geo\.json$/,
  /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=[^&#]{1,200}&count=\d{1,2}&language=en&format=json$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet$/,
  /^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress\?address=[^&#]{1,300}&benchmark=Public_AR_Current&format=json$/,
  /^https:\/\/nominatim\.openstreetmap\.org\/search\?q=[^&#]{1,300}&format=jsonv2&limit=5&addressdetails=1$/,
  /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=-?\d{1,2}\.\d{2}&longitude=-?\d{1,3}\.\d{2}&timezone=auto&forecast_days=1$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet\/[\w.-]+\/\d{1,2}\/\d{1,6}\/\d{1,6}\.pbf$/,
  /^https:\/\/api\.planespotters\.net\/pub\/photos\/(hex\/[0-9a-f]{6}|reg\/[A-Z0-9-]{2,10})$/,
];
const TYPES={'.woff2':'font/woff2','.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.json':'application/json','.jpg':'image/jpeg','.mp4':'video/mp4'};
const SHIM=`window.ReactNativeWebView={postMessage(data){const r=JSON.parse(data);
fetch('/proxy?url='+encodeURIComponent(r.url)+(r.binary?'&binary=1':'')).then(x=>x.json()).then(x=>window.__whatsupReply(r.id,x.status,x.text),()=>window.__whatsupReply(r.id,'connection_error',''));}};`;
let n=0;const T0=Date.now();
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/proxy'){
    const target=url.searchParams.get('url')||'';let status='blocked',text='',entry=null;
    if(ALLOWED.some(p=>p.test(target))){
      const lol=/^https:\/\/(api\.adsb\.lol|opendata\.adsb\.fi)\//.test(target),host=(/^https:\/\/([^/]+)/.exec(target)||[])[1],t=Date.now();
      try{
        const r=await fetch(target,{headers:{'User-Agent':UA,Accept:url.searchParams.get('binary')?'*/*':'application/json'},signal:AbortSignal.timeout(4480)});
        status=r.status;text=r.status!==200?(r.headers.get('retry-after')||''):url.searchParams.get('binary')?Buffer.from(await r.arrayBuffer()).toString('base64'):await r.text();
        if(lol){
          const h={};for(const [k,v] of r.headers)if(/retry|rate|limit|quota|cf-ray|server|x-envoy/i.test(k))h[k]=v;
          let ac=null;try{ac=status===200?JSON.parse(text).ac?.length??null:null;}catch{ac='not JSON';}
          entry={n:++n,host,at:new Date(t).toISOString(),s:Math.round((t-T0)/100)/10,status,ms:Date.now()-t,ac,headers:h,dist:(/dist\/(\d+)/.exec(target)||[])[1]};
        }
      }catch(e){status='connection_error';if(lol)entry={n:++n,host,at:new Date(t).toISOString(),s:Math.round((t-T0)/100)/10,status,ms:Date.now()-t,error:String(e.name||e)};}
      if(entry)await appendFile(LOG,JSON.stringify(entry)+'\n');
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status,text}));return;
  }
  if(url.pathname==='/bridge-shim.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(SHIM);return;}
  const path=normalize(url.pathname==='/'?'/index.html':url.pathname);
  try{
    let body=await readFile(join(root,path));
    if(path==='/index.html')body=body.toString().replace('<head>','<head>\n  <script src="bridge-shim.js"></script>');
    res.writeHead(200,{'content-type':TYPES[extname(path)]||'application/octet-stream','cache-control':'no-store'});res.end(body);
  }catch{res.writeHead(404);res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}/ serving ${root}, logging adsb.lol to ${LOG}`));
