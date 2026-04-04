#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT_DIR/desktop"

echo "[mac] Build macOS installer on local machine"
export PATH="/Users/Jam/.nvm/versions/node/v22.22.2/bin:$PATH"
pnpm run prepare:private-runtime
pnpm run prepare:plugin-runtime
pnpm run prepare:ffmpeg
pnpm run clean
pnpm exec tsc
pnpm exec vite build
pnpm run sync:prompt-library
pnpm exec electron-builder --mac --x64 --arm64 --publish never

echo "[mac] macOS artifacts ready in desktop/release"
