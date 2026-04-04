#!/usr/bin/env bash
set -euo pipefail

TEAM_ID="${APPLE_TEAM_ID:-N9KF8X5S99}"
DEFAULT_APPLE_ID="$(defaults read MobileMeAccounts Accounts 2>/dev/null | awk -F'= ' '/AccountID = / {gsub(/;|"/, "", $2); print $2; exit}')"
PROFILE_NAME="${APPLE_KEYCHAIN_PROFILE:-REDBOX}"
APPLE_ID_VALUE="${APPLE_ID:-$DEFAULT_APPLE_ID}"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "[notary-setup] ERROR: xcrun not found" >&2
  exit 1
fi

if [[ -z "${APPLE_ID_VALUE:-}" ]]; then
  read -r -p "Apple ID: " APPLE_ID_VALUE
fi

if [[ -z "${APPLE_ID_VALUE:-}" ]]; then
  echo "[notary-setup] ERROR: Apple ID is required" >&2
  exit 1
fi

echo "[notary-setup] Store notarytool credentials"
echo "[notary-setup] Apple ID: $APPLE_ID_VALUE"
echo "[notary-setup] Team ID:  $TEAM_ID"
echo "[notary-setup] Profile:  $PROFILE_NAME"

if [[ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  xcrun notarytool store-credentials "$PROFILE_NAME" \
    --apple-id "$APPLE_ID_VALUE" \
    --team-id "$TEAM_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD"
else
  xcrun notarytool store-credentials "$PROFILE_NAME" \
    --apple-id "$APPLE_ID_VALUE" \
    --team-id "$TEAM_ID"
fi

echo
echo "[notary-setup] Done. Export this before full mac release:"
echo "export APPLE_KEYCHAIN_PROFILE=$PROFILE_NAME"
