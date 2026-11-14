// Makes the Google TV edition of the store privacy policy, web/privacy-store-googletv.txt, from
// the Fire TV one, web/privacy-store.txt, so the two can't drift apart: the same data and the same
// services, with Google Play and Android in place of the Amazon Appstore and Fire TV.
//   node scripts/build-privacy-googletv.mjs          writes the file
//   node scripts/build-privacy-googletv.mjs --check  fails if the file is out of date
// Each change below must match exactly once, so an edit to the Fire TV text that touches one of
// them stops this script instead of slipping through. The dates stay "[date]" until the page is
// published; the store package check refuses a policy that still has them.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const SOURCE=new URL('../web/privacy-store.txt',import.meta.url);
export const TARGET=new URL('../web/privacy-store-googletv.txt',import.meta.url);
export const VERSION=5;
export const POLICY_URL='https://spacelydigital.github.io/Whats-Up/privacy/google-tv/';

export const CHANGES=[
  [/^Version \d+ · Effective [^·\n]+ · Last updated [^\n]+$/m,`Version ${VERSION} · Effective [date] · Last updated [date]`],
  ['This is a free Fire TV app that shows the aircraft over your home.',
   'This is a free app for Google TV and other Android TV devices that shows the aircraft over your home.'],
  ['The app never asks Fire TV for your location, and never uses a microphone, camera or contacts.',
   'The app never asks your TV for your location (it has no permission to), and never uses a microphone, camera or contacts.'],
  ["All of this is kept in the app's private storage on your Fire TV. None of it is sent to us.",
   "All of this is kept in the app's private storage on your TV, and the app keeps it out of Android's backups. None of it is sent to us."],
  [/^## Amazon\n\n[^\n]+$/m,
   '## Google\n\nYou get this app from Google Play and run it on a Google TV or Android TV device. Google handles downloads and updates under the Google Privacy Policy: https://policies.google.com/privacy, and your TV\'s maker handles the device itself under its own policy. Google may give us statistics, such as install counts, and technical reports, such as crash reports. As far as we know these don\'t include your name or location, and we use them only to fix and improve the app.'],
  ['On Fire TV: Settings › Applications › Manage Installed Applications, then pick this app and choose Uninstall.',
   'On Google TV: Settings › Apps › See all apps, then pick this app and choose Uninstall.'],
  ['and Amazon as described above.','and Google as described above.'],
  ['This policy: https://spacelydigital.github.io/Whats-Up/privacy/\n',`This policy: ${POLICY_URL}\n`],
];
// Words that must not be left over from the Fire TV text.
export const LEFTOVERS=/Fire TV|Fire OS|Amazon|Appstore|\bVega\b/i;

export function googleTvPolicy(fireTv){
  let out=fireTv;
  for(const [find,put] of CHANGES){
    const hits=typeof find==='string'?out.split(find).length-1:(out.match(new RegExp(find.source,find.flags+'g'))||[]).length;
    if(hits!==1)throw new Error(`privacy-store.txt: expected 1 match, found ${hits}: ${String(find).slice(0,80)}`);
    out=out.replace(find,()=>put);
  }
  const left=LEFTOVERS.exec(out);
  if(left)throw new Error(`Google TV policy still mentions "${left[0]}": ${out.slice(Math.max(0,left.index-60),left.index+60)}`);
  return out;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const want=googleTvPolicy(readFileSync(SOURCE,'utf8'));
  if(process.argv.includes('--check')){
    let have='';try{have=readFileSync(TARGET,'utf8');}catch{}
    if(have!==want){console.error('web/privacy-store-googletv.txt is out of date: run node scripts/build-privacy-googletv.mjs');process.exit(1);}
    console.log('web/privacy-store-googletv.txt is up to date');
  }else{
    writeFileSync(TARGET,want);
    console.log(`wrote web/privacy-store-googletv.txt (Version ${VERSION}, ${want.length} characters)`);
  }
}
