// Desktop test server: node scripts/dev-server.mjs [assets|web] [port]
// Serves the page and emulates the Vega app's fetch bridge (src/App.tsx):
// window.ReactNativeWebView.postMessage -> /proxy -> window.__whatsupReply.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname,normalize,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..',process.argv[2]||'assets');
const port=Number(process.argv[3])||8767;
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
const TYPES={'.woff2':'font/woff2','.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.json':'application/json','.jpg':'image/jpeg','.gif':'image/gif','.mp4':'video/mp4'};
const SHIM=`window.ReactNativeWebView={postMessage(data){const r=JSON.parse(data);
fetch('/proxy?url='+encodeURIComponent(r.url)+(r.binary?'&binary=1':'')).then(x=>x.json()).then(x=>window.__whatsupReply(r.id,x.status,x.text),()=>window.__whatsupReply(r.id,'connection_error',''));}};`;

createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/proxy'){
    const target=url.searchParams.get('url')||'';
    let status='blocked',text='';
    if(ALLOWED.some(p=>p.test(target)))try{
      const r=await fetch(target,{headers:{'User-Agent':'WhatsUp-FireTV/0.1 (Spacely Digital, dev server; spacelydigital@gmail.com)'},signal:AbortSignal.timeout(8000)});
      status=r.status;text=r.status!==200?'':url.searchParams.get('binary')?Buffer.from(await r.arrayBuffer()).toString('base64'):await r.text();
    }catch{status='connection_error';}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status,text}));return;
  }
  if(url.pathname==='/bridge-shim.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(SHIM);return;}
  const path=normalize(url.pathname==='/'?'/index.html':url.pathname);
  try{
    let body=await readFile(join(root,path));
    if(path==='/index.html'&&url.searchParams.get('bridge')!=='0')
      body=body.toString().replace('<head>','<head>\n  <script src="bridge-shim.js"></script>');
    res.writeHead(200,{'content-type':TYPES[extname(path)]||'application/octet-stream','cache-control':'no-store'});res.end(body);
  }catch{res.writeHead(404);res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}/ serving ${root}`));
