#!/bin/sh
# Slate A: unit tests, Jest, fit checks (12 layouts x 5 scenes) at 1080 and 720: personal with fitd-p0, store with the scale-aware fitd2-p0.
R=~/overhead-tv/scratch/regress-1103n; S="$(date '+%Y-%m-%d %H:%M:%S')"; cd ~/overhead-tv/whatsup-fixes
npm run -s test:web > $R/checks/unit.txt 2>&1; npx jest > $R/checks/jest.txt 2>&1
cd ~/overhead-tv/scratch/models2
for b in personal:8823:fitd-p0 store:8825:fitd2-p0; do n=$(echo $b|cut -d: -f1); p=$(echo $b|cut -d: -f2); h=$(echo $b|cut -d: -f3)
  for dsf in 2:1080 1.3333:720; do d=${dsf%%:*}; px=${dsf#*:}
    for scene in busy long longest emergency quiet; do sc=$scene; [ $scene = busy ] && sc=''
      PORT=$p DSF=$d perl -e 'alarm 900; exec @ARGV' node $h.mjs '' $sc > $R/fit/$n-$px-$scene.txt 2>&1 &
    done
  done
  wait
done
~/overhead-tv/scratch/backup-1103/cleanup-profiles.sh "$S"; echo BATCH_A_DONE
