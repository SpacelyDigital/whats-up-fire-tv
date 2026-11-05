#!/bin/sh
# ./run-ok.sh SEED  (PORT: a dev server for the build under test; OUT: results folder). Skips a seed
# that is done or running (two runners can share one range from both ends).
s=$1; d=${OUT:-$(dirname "$0")/out}; mkdir -p "$d"
[ -e "$d/$s.json" ] || [ -e "$d/$s.bad" ] || [ -e "$d/$s.tmp" ] && exit 0
: > "$d/$s.tmp"
PORT=${PORT:-8775} perl -e 'alarm 600; exec @ARGV' node "$(dirname "$0")/monkey-ok.mjs" "$s" 300 2>/dev/null | tail -1 > "$d/$s.tmp"
if python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$d/$s.tmp" 2>/dev/null; then mv "$d/$s.tmp" "$d/$s.json"; else mv "$d/$s.tmp" "$d/$s.bad"; fi
