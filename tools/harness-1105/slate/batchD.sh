#!/bin/sh
# Slate D: the fault matrix (83 cases, 6 at a time) and the host audits (two adsb.fi outages; control with adsb.fi up), store build.
R=~/whats-up/scratch/regress-1103n; S="$(date '+%Y-%m-%d %H:%M:%S')"; B=~/whats-up/scratch/backup-1103
(cd $B && PORT=8825 node runall.mjs cases.txt case.mjs ${MATRIX_P:-6} $R/matrix > $R/matrix.log 2>&1)
(cd $R/audit/outage && PORT=8825 LOG=$PWD/typical-log.json SHOTS=$PWD perl -e 'alarm 1200; exec @ARGV' node $B/s08-backup.mjs > s08.txt 2> s08-steps.txt) &
(cd $R/audit/control && PORT=8825 SHOTS=$PWD perl -e 'alarm 1200; exec @ARGV' node $B/s08-typical.mjs > s08.txt 2> s08-steps.txt) &
wait
~/whats-up/scratch/backup-1103/cleanup-profiles.sh "$S"; echo BATCH_D_DONE
