import {spawn} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';
const [file,script,P,outdir]=process.argv.slice(2);
const lines=readFileSync(file,'utf8').split('\n').map(l=>l.trim()).filter(Boolean);
let i=0;const run=()=>{if(i>=lines.length)return Promise.resolve();const args=lines[i++].split(/\s+/);
  return new Promise(res=>{let out='';const p=spawn('node',[script,...args],{stdio:['ignore','pipe','ignore']});p.stdout.on('data',d=>out+=d);
    const k=setTimeout(()=>p.kill('SIGKILL'),720000);
    p.on('close',()=>{clearTimeout(k);writeFileSync(`${outdir}/${args.join('-')}.json`,out.trim().split('\n').pop()||'');res();});}).then(run);};
await Promise.all(Array.from({length:Number(P)},run));console.log('ALLDONE');
