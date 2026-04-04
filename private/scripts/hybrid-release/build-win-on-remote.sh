#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
REMOTE_HOST="${REDBOX_REMOTE_HOST:-jamdebian}"
REMOTE_WORKDIR="${REDBOX_REMOTE_WORKDIR:-/home/jam/build/redconvert-release}"
REMOTE_PREBUILD_CACHE_DIR="${REDBOX_REMOTE_PREBUILD_CACHE_DIR:-/home/jam/.npm/_prebuilds}"
REMOTE_ELECTRON_CACHE_DIR="${REDBOX_REMOTE_ELECTRON_CACHE_DIR:-/home/jam/.cache/electron}"
PREBUILD_URL="https://github.com/WiseLibs/better-sqlite3/releases/download/v12.8.0/better-sqlite3-v12.8.0-electron-v140-win32-x64.tar.gz"
LOCAL_PREBUILD_CACHE="${HOME}/.npm/_prebuilds"
LOCAL_PREBUILD_FILE="$(
  node -e "const crypto=require('crypto'); const path=require('path'); const url=process.argv[1]; const digest=crypto.createHash('sha512').update(url).digest('hex').slice(0,6); process.stdout.write(path.join(process.argv[2], digest + '-' + path.basename(url).replace(/[^a-zA-Z0-9.]+/g,'-')));" \
  "$PREBUILD_URL" \
  "$LOCAL_PREBUILD_CACHE"
)"
LOCAL_ELECTRON_CACHE_FILE="${HOME}/Library/Caches/electron/electron-v39.6.0-win32-x64.zip"

printf "[remote-win] Sync source to %s:%s\n" "$REMOTE_HOST" "$REMOTE_WORKDIR"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_WORKDIR/desktop' '$REMOTE_WORKDIR/Plugin' '$REMOTE_PREBUILD_CACHE_DIR' '$REMOTE_ELECTRON_CACHE_DIR'"
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='dist-electron' \
  --exclude='release' \
  "$ROOT_DIR/desktop/" "$REMOTE_HOST:$REMOTE_WORKDIR/desktop/"
rsync -az --delete \
  "$ROOT_DIR/Plugin/" "$REMOTE_HOST:$REMOTE_WORKDIR/Plugin/"

if [ ! -f "$LOCAL_PREBUILD_FILE" ]; then
  printf "[remote-win] Warm local prebuild cache: %s\n" "$LOCAL_PREBUILD_FILE"
  mkdir -p "$LOCAL_PREBUILD_CACHE"
  curl -L --fail --output "$LOCAL_PREBUILD_FILE" "$PREBUILD_URL"
fi
printf "[remote-win] Sync better-sqlite3 prebuild cache to remote\n"
rsync -az "$LOCAL_PREBUILD_FILE" "$REMOTE_HOST:$REMOTE_PREBUILD_CACHE_DIR/"
if [ -f "$LOCAL_ELECTRON_CACHE_FILE" ]; then
  printf "[remote-win] Sync Electron cache to remote\n"
  rsync -az "$LOCAL_ELECTRON_CACHE_FILE" "$REMOTE_HOST:$REMOTE_ELECTRON_CACHE_DIR/"
fi

printf "[remote-win] Build Windows installer on remote host\n"
ssh "$REMOTE_HOST" "bash -lc '
set -euo pipefail
cd $REMOTE_WORKDIR/desktop
export PATH=\"\$HOME/.nvm/versions/node/v22.22.2/bin:\$PATH\"
pnpm install --frozen-lockfile
pnpm run prepare:private-runtime
pnpm run prepare:plugin-runtime
pnpm run prepare:ffmpeg
pnpm run clean
pnpm exec tsc
pnpm exec vite build
pnpm run sync:prompt-library
export WINEDEBUG=-all
export XDG_RUNTIME_DIR=\"/tmp/runtime-\$USER\"
mkdir -p \"\$XDG_RUNTIME_DIR\"
xvfb-run -a pnpm exec electron-builder --win --x64 --publish never
'"

LOCAL_WIN_DIR="$ROOT_DIR/artifacts/win-remote"
mkdir -p "$LOCAL_WIN_DIR"

printf "[remote-win] Fetch artifacts back to local: %s\n" "$LOCAL_WIN_DIR"
rsync -az \
  --include='*/' \
  --include='*.exe' \
  --include='*.blockmap' \
  --include='latest*.yml' \
  --exclude='*' \
  "$REMOTE_HOST:$REMOTE_WORKDIR/desktop/release/" "$LOCAL_WIN_DIR/"

if ! ls "$LOCAL_WIN_DIR"/*.exe >/dev/null 2>&1; then
  echo "[remote-win] ERROR: no .exe artifacts found in $LOCAL_WIN_DIR"
  exit 1
fi

echo "[remote-win] Windows artifacts ready."
