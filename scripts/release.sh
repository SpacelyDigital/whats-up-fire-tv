#!/bin/sh
# Release build from a neutral folder, then the package guard.
#   sh scripts/release.sh            -> build/armv7-release/whatsup_armv7.vpkg (checked)
# Why a copy: Hermes records the bundle's input path and native builds embed source
# paths, and the developer's home folder carries their macOS user name. Building from
# /tmp keeps every path in the package neutral. Dependencies are linked, not copied.
set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)
DEPS=${WHATSUP_DEPS:-$SRC}          # a checkout whose node_modules are installed
OUT=/tmp/spacely-build/app
export KEPLER_SDK_PATH=${KEPLER_SDK_PATH:-$HOME/vega/sdk/vega-sdk/main/0.24.12112}
export PATH="$KEPLER_SDK_PATH/bin:$PATH"

rm -rf /tmp/spacely-build && mkdir -p "$OUT"
rsync -a --exclude .git --exclude node_modules --exclude build --exclude assets \
  --exclude 'native/keep-awake/build' --exclude 'native/keep-awake/dist' "$SRC/" "$OUT/"

# Dependencies: the installed checkout's node_modules (Metro needs one real tree). The
# app's native module resolves through it to that checkout's native/keep-awake, so the
# module is built here (neutral paths, prefix maps) and its build output copied there.
ln -s "$(readlink -f "$DEPS/node_modules")" "$OUT/node_modules"
ln -s "$(readlink -f "$DEPS/native/keep-awake/node_modules")" "$OUT/native/keep-awake/node_modules"
mkdir -p "$OUT/vendor" && ln -sfn "$(readlink -f "$DEPS/vendor/node_modules")" "$OUT/vendor/node_modules"

(cd "$OUT/native/keep-awake" && npm run build >/tmp/spacely-build/native.log 2>&1) || { tail -20 /tmp/spacely-build/native.log; exit 1; }
NATIVE=$(readlink -f "$DEPS/node_modules/@whatsup/keep-awake")
rm -rf "$NATIVE/build" "$NATIVE/dist" && cp -R "$OUT/native/keep-awake/build" "$OUT/native/keep-awake/dist" "$NATIVE/"

# The store build is the public release: version 1.0.0, build 1 (higher than any build
# installed during development, which were all 0.1.0 build 0). The personal build keeps 0.1.0.
STORE_VERSION=1.0.0 STORE_BUILD=1
if [ "${WHATSUP_PROFILE:-personal}" = store ]; then
  sed -i '' "s/^version = \".*\"/version = \"$STORE_VERSION\"/" "$OUT/manifest.toml"
  # The User-Agent names the app and its version (the privacy policy says so): 1.0 here.
  sed -i '' "s#WhatsUp-FireTV/0\.1 #WhatsUp-FireTV/${STORE_VERSION%.*} #" "$OUT/src/App.tsx"
  grep -q "WhatsUp-FireTV/${STORE_VERSION%.*} " "$OUT/src/App.tsx" || { echo "release: User-Agent version not set" >&2; exit 1; }
  VERSION_ARGS="--build-version $STORE_VERSION --build-number $STORE_BUILD"
else VERSION_ARGS=""; fi
(cd "$OUT" && npm run build:release -- $VERSION_ARGS >/tmp/spacely-build/app.log 2>&1) || { tail -20 /tmp/spacely-build/app.log; exit 1; }

# WHATSUP_PROFILE=store: the store package goes to build/store/ (never over the TV's build).
if [ "${WHATSUP_PROFILE:-personal}" = store ]; then DEST="$SRC/build/store"; NAME=whatsup_armv7-store.vpkg; else DEST="$SRC/build/armv7-release"; NAME=whatsup_armv7.vpkg; fi
mkdir -p "$DEST"
cp "$OUT/build/armv7-release/whatsup_armv7.vpkg" "$DEST/$NAME"
node "$SRC/scripts/check-package.mjs" "$DEST/$NAME"
