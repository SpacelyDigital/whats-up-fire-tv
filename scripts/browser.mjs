// The headless browser the checks drive: Google Chrome, or another Chromium-based browser named in
// CHECK_BROWSER (e.g. CHECK_BROWSER="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser").
// The browser picks its own DevTools port and writes it to DevToolsActivePort in the profile, so
// checks run side by side never drive each other's pages. A mock keychain keeps it out of the
// login keychain.
import {spawn} from 'node:child_process';import {readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';
export const BROWSER=process.env.CHECK_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export async function launch(profile,args,port=0){
  try{rmSync(join(profile,'DevToolsActivePort'));}catch{}
  const chrome=spawn(BROWSER,['--headless=new',`--remote-debugging-port=${port}`,'--use-mock-keychain','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,...args],{stdio:'ignore'});
  for(let i=0;i<120&&!port;i++){await new Promise(r=>setTimeout(r,250));try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])||0;}catch{}}
  return {chrome,port};
}
