#!/bin/sh
# Slate B: settings-edit, drawn, picker-race, adjust-hold, browse (both builds); safe-area, model-photo fit, Privacy screen + QR (store); consent and backup credit line (both).
R=~/overhead-tv/scratch/regress-1103n; S="$(date '+%Y-%m-%d %H:%M:%S')"; cd ~/overhead-tv/whatsup-fixes
G1="atlas-dark atlas atlas-satellite"; G2="radar glass departures"; G3="blueprint swiss synthwave"; G4="sectional cockpit night-sky"
t(){ perl -e 'alarm 1500; exec @ARGV' "$@"; }
for b in store:8825 personal:8823; do n=${b%%:*}; u=http://127.0.0.1:${b#*:}/index.html
  i=0; for g in "$G1" "$G2" "$G3" "$G4"; do i=$((i+1))
    CHECK_URL=$u CHECK_DSF=2 t node scripts/check-settings-edit.mjs $g > $R/checks/settings-$n-1080-$i.txt 2>&1 &
    CHECK_URL=$u CHECK_DSF=1.3333 t node scripts/check-settings-edit.mjs $g > $R/checks/settings-$n-720-$i.txt 2>&1 &
  done; wait
  CHECK_URL=$u t node scripts/check-drawn.mjs $G1 $G2 > $R/checks/drawn-$n-1.txt 2>&1 &
  CHECK_URL=$u t node scripts/check-drawn.mjs $G3 $G4 > $R/checks/drawn-$n-2.txt 2>&1 &
  CHECK_URL=$u t node scripts/check-picker-race.mjs > $R/checks/picker-$n.txt 2>&1 &
  CHECK_URL=$u t node scripts/check-adjust-hold.mjs > $R/checks/adjust-$n.txt 2>&1 &
  i=0; for g in "$G1" "$G2" "$G3" "$G4"; do i=$((i+1)); CHECK_URL=$u t node scripts/check-browse.mjs $g > $R/checks/browse-$n-$i.txt 2>&1 & done
  wait
done
u=http://127.0.0.1:8825/index.html
i=0; for g in "$G1" "$G2" "$G3" "$G4"; do i=$((i+1)); CHECK_URL=$u t node scripts/check-safe-area.mjs $g > $R/checks/safe-store-$i.txt 2>&1 & done
cd ~/overhead-tv/scratch/models2
for h in C177 P28B R44; do for d in 2:1080 1.3333:720; do PORT=8825 DSF=${d%%:*} HERO=$h t node fitd2-p0.mjs '' > $R/fit/model-$h-${d#*:}.txt 2>&1 & done; done
for d in 2:1080 1.3333:720; do PORT=8825 DSF=${d%%:*} t node priv-p0.mjs '' > $R/fit/privacy-qr-store-${d#*:}.txt 2>&1 & done
wait
cd ~/overhead-tv/scratch/backup-1103
for b in store:8825 personal:8823; do n=${b%%:*}; for d in 2 1.3333; do
  PORT=${b#*:} BUILD=$n t node consent-fit.mjs $d > $R/checks/consent-$n-$d.jsonl 2>&1 &
  PORT=${b#*:} BUILD=$n t node credit-fit.mjs $d > $R/checks/credit-$n-$d.jsonl 2>&1 &
done; done; wait
PORT=8825 t node qr-decode.mjs > $R/checks/qr-decode.txt 2>&1
~/overhead-tv/scratch/backup-1103/cleanup-profiles.sh "$S"; echo BATCH_B_DONE
