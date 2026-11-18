#!/bin/sh
# Builds the Google TV page variants the rig serves, as the Android app's Gradle build makes them.
# Usage: sh tests/googletv-rig/build.sh [repo] [outdir]
#   repo:   a What's Up checkout (default: this one)
#   outdir: where the variants go (default: tests/googletv-rig/pages)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=${1:-$HERE/../..}
OUT=${2:-$HERE/pages}
mkdir -p "$OUT"
b(){ name=$1; shift; rm -rf "$OUT/$name"; env -u WHATSUP_PROFILE -u WHATSUP_RELEASE -u WHATSUP_HIDE -u WHATSUP_LICENSES WHATSUP_PLATFORM=android WHATSUP_OUT="$OUT/$name" "$@" node "$REPO/scripts/build-web.mjs" >/dev/null; echo "$name: $(ls "$OUT/$name" | wc -l) entries"; }
b personal     WHATSUP_PROFILE=personal WHATSUP_RELEASE=1                  # = the personal APK (release build type)
b store        WHATSUP_PROFILE=store    WHATSUP_RELEASE=1                  # = the Google Play build
b store-hidden WHATSUP_PROFILE=store    WHATSUP_RELEASE=1 WHATSUP_HIDE=tips,awake  # the store build with both switches
b personal-dev WHATSUP_PROFILE=personal WHATSUP_RELEASE=0                  # URL hooks on (?demo=1&scene=..., ?screen=...)
b store-dev    WHATSUP_PROFILE=store    WHATSUP_RELEASE=0
(cd "$REPO" && git rev-parse --short HEAD > "$OUT/REV" && git status --porcelain | grep -q . && echo "(working tree has changes)" >> "$OUT/REV" || true)
echo "built from $(cat "$OUT/REV")"
