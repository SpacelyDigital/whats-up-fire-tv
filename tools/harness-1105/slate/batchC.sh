#!/bin/sh
# Slate C: 300-session fuzz (monkey-backup: Left/Right weighted, bursts, adsb.fi down one minute in three) on the store build, and the fast-cycling audit.
R=~/whats-up/scratch/regress-1103n; S="$(date '+%Y-%m-%d %H:%M:%S')"
(cd ~/whats-up/scratch/browse-audit && PORT=8825 perl -e 'alarm 300; exec @ARGV' node audit.mjs > $R/audit/browse-audit.json 2>&1) &
seq ${FUZZ_FROM:-8001} ${FUZZ_TO:-8300} | OUT=$R/fuzz PORT=8825 xargs -P ${FUZZ_P:-8} -n 1 ~/whats-up/scratch/pubstage/tools/fuzz/run-backup.sh
wait
~/whats-up/scratch/backup-1103/cleanup-profiles.sh "$S"; echo BATCH_C_DONE
