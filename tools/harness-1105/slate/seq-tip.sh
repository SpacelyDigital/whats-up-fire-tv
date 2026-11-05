#!/bin/sh
# One browser at a time (Brave, headless, a fresh temp profile per run), on the tip:
# store build on 8826, personal on 8824. Phase R: reruns of tonight's failures. Phase S: the
# core slate. Each run has a time limit; test profiles are cleaned after each one.
#   sh seq-tip.sh R   |   sh seq-tip.sh S   (results in regress-1103n/tip/)
R=~/overhead-tv/scratch/regress-1103n/tip; mkdir -p $R/checks $R/fit $R/rerun; B=~/overhead-tv/scratch/backup-1103
W=~/overhead-tv/whatsup-fixes; ST=http://127.0.0.1:8830/index.html; PE=http://127.0.0.1:8831/index.html
t(){ lim=$1; shift; perl -e "alarm $lim; exec @ARGV" "$@"; }
clean(){ $B/cleanup-profiles.sh "$S" >/dev/null; }
S="$(date '+%Y-%m-%d %H:%M:%S')"
log(){ echo "$(date -u +%H:%M:%S) $*" >> $R/progress.log; }
case "$1" in
R)
  cd $W
  log "R refit"; CHECK_URL=$ST t 180 node scripts/check-refit.mjs > $R/rerun/refit-store.txt 2>&1; clean
  # The original check (fixed 250 ms gaps; only the launcher changed) and the cog-aware one.
  O=/tmp/scratch/origcheck
  for b in "store:$ST:2" "personal:$PE:1.3333" "personal:$PE:2"; do n=${b%%:*}; rest=${b#*:}; dsf=${rest##*:}; u=${rest%:*}
    log "R settings-edit orig $n $dsf"; CHECK_URL=$u CHECK_DSF=$dsf t 900 node $O/check-settings-edit.mjs atlas-dark atlas glass sectional > $R/rerun/settings-orig-$n-$dsf.txt 2>&1; clean
    log "R settings-edit new $n $dsf"; CHECK_URL=$u CHECK_DSF=$dsf t 900 node scripts/check-settings-edit.mjs atlas-dark atlas glass sectional > $R/rerun/settings-new-$n-$dsf.txt 2>&1; clean; done
  for b in "store:$ST" "personal:$PE"; do n=${b%%:*}; u=${b#*:}
    log "R drawn $n sectional"; CHECK_URL=$u t 600 node scripts/check-drawn.mjs sectional > $R/rerun/drawn-$n-sectional.txt 2>&1; clean; done
  # Deliberate break: Sectional drawing no planes (build/broken-sectional-store on 8829) must still fail.
  log "R drawn broken sectional"; CHECK_URL=http://127.0.0.1:8829/index.html t 600 node scripts/check-drawn.mjs sectional > $R/rerun/drawn-broken-sectional.txt 2>&1; clean
  cd ~/overhead-tv/scratch/models2; log "R model C177 1080"; PORT=8826 DSF=2 HERO=C177 t 900 node fitd2-p0.mjs '' > $R/rerun/model-C177-1080.txt 2>&1; clean
  cd ~/overhead-tv/scratch/breakit; log "R erase-backup"; PORT=8826 t 600 node erase-backup.mjs > $R/rerun/erase-backup.txt 2>&1; clean
  for l in swiss blueprint; do log "R clips $l"; PORT=8826 t 300 node clips.mjs $l > $R/rerun/clips-$l.json 2>&1; clean; done
  log "R done";;
S1)
  # Lane 1: fit checks, 12 layouts x 5 scenes x 2 sizes, both builds.
  cd ~/overhead-tv/scratch/models2
  for b in personal:8831:fitd-p0 store:8830:fitd2-p0; do n=${b%%:*}; p=$(echo $b|cut -d: -f2); h=$(echo $b|cut -d: -f3)
    for dsf in 2:1080 1.3333:720; do d=${dsf%%:*}; px=${dsf#*:}
      for scene in busy long longest emergency quiet; do sc=$scene; [ $scene = busy ] && sc=''
        log "S1 fit $n $px $scene"; PORT=$p DSF=$d t 900 node $h.mjs '' $sc > $R/fit/$n-$px-$scene.txt 2>&1; clean; done; done; done
  log "S1 done";;
S2)
  # Lane 2: settings-edit, drawn, picker-race, adjust-hold, refit, both builds.
  cd $W
  for b in "store:$ST" "personal:$PE"; do n=${b%%:*}; u=${b#*:}
    for dsf in 2 1.3333; do log "S2 settings-edit $n $dsf"; CHECK_URL=$u CHECK_DSF=$dsf t 1500 node scripts/check-settings-edit.mjs > $R/checks/settings-$n-$dsf.txt 2>&1; clean; done
    log "S2 drawn $n"; CHECK_URL=$u t 1800 node scripts/check-drawn.mjs > $R/checks/drawn-$n.txt 2>&1; clean
    log "S2 picker $n"; CHECK_URL=$u t 300 node scripts/check-picker-race.mjs > $R/checks/picker-$n.txt 2>&1; clean
    log "S2 adjust $n"; CHECK_URL=$u t 300 node scripts/check-adjust-hold.mjs > $R/checks/adjust-$n.txt 2>&1; clean
    log "S2 refit $n"; CHECK_URL=$u t 180 node scripts/check-refit.mjs > $R/checks/refit-$n.txt 2>&1; clean
    log "S2 settings-ok $n"; CHECK_URL=$u t 300 node scripts/check-settings-ok.mjs > $R/checks/settings-ok-$n.txt 2>&1; clean
  done
  log "S2 done";;
S3)
  # Lane 3: browse (both), safe-area, model-photo fit, Privacy + QR (store), consent and credit line (both), QR decode.
  cd $W
  for b in "store:$ST" "personal:$PE"; do n=${b%%:*}; u=${b#*:}
    log "S3 browse $n"; CHECK_URL=$u t 1800 node scripts/check-browse.mjs > $R/checks/browse-$n.txt 2>&1; clean; done
  log "S3 safe-area store"; CHECK_URL=$ST t 1800 node scripts/check-safe-area.mjs > $R/checks/safe-store.txt 2>&1; clean
  cd ~/overhead-tv/scratch/models2
  for h in C177 P28B R44; do for d in 2:1080 1.3333:720; do log "S3 model $h ${d#*:}"; PORT=8830 DSF=${d%%:*} HERO=$h t 900 node fitd2-p0.mjs '' > $R/fit/model-$h-${d#*:}.txt 2>&1; clean; done; done
  for d in 2:1080 1.3333:720; do log "S3 privacy ${d#*:}"; PORT=8830 DSF=${d%%:*} t 900 node priv-p0.mjs '' > $R/fit/privacy-qr-store-${d#*:}.txt 2>&1; clean; done
  cd $B
  for b in store:8830 personal:8831; do n=${b%%:*}; for d in 2 1.3333; do
    log "S3 consent $n $d"; PORT=${b#*:} BUILD=$n t 900 node consent-fit.mjs $d > $R/checks/consent-$n-$d.jsonl 2>&1; clean
    log "S3 credit $n $d"; PORT=${b#*:} BUILD=$n t 900 node credit-fit.mjs $d > $R/checks/credit-$n-$d.jsonl 2>&1; clean
  done; done
  log "S3 qr-decode"; PORT=8830 t 300 node qr-decode.mjs > $R/checks/qr-decode.txt 2>&1; clean
  log "S3 done";;
esac
