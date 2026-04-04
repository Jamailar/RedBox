#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR/desktop"

echo "[mac] Build macOS installer on local machine"
export PATH="/Users/Jam/.nvm/versions/node/v22.22.2/bin:$PATH"
MODE="${REDBOX_MAC_MODE:-signed}"

if [[ "${REDBOX_MAC_NOSIGN:-0}" == "1" ]]; then
  echo "[mac] Using unsigned macOS build mode"
  pnpm run build:mac:nosign -- --publish never
elif [[ "$MODE" == "full" ]]; then
  echo "[mac] Using full macOS release mode (signed + notarized)"
  "$SCRIPT_DIR/notarize-mac-artifacts.sh" --check-only
  pnpm run build:mac:signed -- --publish never
  "$SCRIPT_DIR/notarize-mac-artifacts.sh"
else
  echo "[mac] Using signed macOS build mode"
  pnpm run build:mac:signed -- --publish never
fi

echo "[mac] macOS artifacts ready in desktop/release"
