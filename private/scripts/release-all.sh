#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

exec "$ROOT_DIR/private/scripts/hybrid-release/publish-hybrid.sh" "$@"
