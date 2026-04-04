#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
RELEASE_DIR="$ROOT_DIR/desktop/release"
APP_VERSION="$(node -p "require('$ROOT_DIR/desktop/package.json').version")"
TEAM_ID="${APPLE_TEAM_ID:-N9KF8X5S99}"
IDENTITY="${REDBOX_MAC_IDENTITY:-Developer ID Application: Hunan Xizi Culture Co., Ltd. (N9KF8X5S99)}"
CHECK_ONLY=0

log() {
  echo "[mac-notarize] $*"
}

die() {
  echo "[mac-notarize] ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

build_auth_args() {
  if [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
    if [[ -n "${APPLE_KEYCHAIN:-}" ]]; then
      AUTH_ARGS=(--keychain "$APPLE_KEYCHAIN" --keychain-profile "$APPLE_KEYCHAIN_PROFILE")
    else
      AUTH_ARGS=(--keychain-profile "$APPLE_KEYCHAIN_PROFILE")
    fi
    return 0
  fi

  if [[ -n "${APPLE_ID:-}" || -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
    [[ -n "${APPLE_ID:-}" ]] || die "APPLE_ID is required when using Apple ID notarization"
    [[ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]] || die "APPLE_APP_SPECIFIC_PASSWORD is required when using Apple ID notarization"
    AUTH_ARGS=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$TEAM_ID")
    return 0
  fi

  if [[ -n "${APPLE_API_KEY:-}" || -n "${APPLE_API_KEY_ID:-}" || -n "${APPLE_API_ISSUER:-}" ]]; then
    [[ -n "${APPLE_API_KEY:-}" ]] || die "APPLE_API_KEY is required when using App Store Connect API key notarization"
    [[ -n "${APPLE_API_KEY_ID:-}" ]] || die "APPLE_API_KEY_ID is required when using App Store Connect API key notarization"
    [[ -n "${APPLE_API_ISSUER:-}" ]] || die "APPLE_API_ISSUER is required when using App Store Connect API key notarization"
    [[ -f "${APPLE_API_KEY}" ]] || die "APPLE_API_KEY must point to an existing .p8 key file"
    AUTH_ARGS=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
    return 0
  fi

  die "No notarization credentials found. Set APPLE_KEYCHAIN_PROFILE, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER."
}

validate_keychain_profile() {
  if [[ -z "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
    return 0
  fi

  local profile_args=()
  if [[ -n "${APPLE_KEYCHAIN:-}" ]]; then
    profile_args+=(--keychain "$APPLE_KEYCHAIN")
  fi
  profile_args+=(--keychain-profile "$APPLE_KEYCHAIN_PROFILE")

  if ! xcrun notarytool history "${profile_args[@]}" --team-id "$TEAM_ID" >/dev/null 2>&1; then
    die "APPLE_KEYCHAIN_PROFILE=$APPLE_KEYCHAIN_PROFILE is not usable. Run: xcrun notarytool store-credentials <profile> --apple-id <id> --team-id $TEAM_ID --password <app-specific-password>"
  fi
}

sign_dmg_container() {
  local artifact="$1"
  log "Sign DMG container: $(basename "$artifact")"
  codesign --force --sign "$IDENTITY" --timestamp "$artifact"
}

submit_and_wait() {
  local artifact="$1"
  log "Submit for notarization: $(basename "$artifact")"

  local output
  if ! output="$(xcrun notarytool submit "$artifact" "${AUTH_ARGS[@]}" --wait --output-format json 2>&1)"; then
    echo "$output" >&2
    die "notarytool submit failed for $(basename "$artifact")"
  fi

  if ! echo "$output" | rg -q '"status"[[:space:]]*:[[:space:]]*"Accepted"'; then
    echo "$output" >&2
    die "Notarization was not accepted for $(basename "$artifact")"
  fi
}

staple_and_verify() {
  local artifact="$1"
  log "Staple notarization ticket: $(basename "$artifact")"
  xcrun stapler staple -v "$artifact"

  log "Validate staple: $(basename "$artifact")"
  xcrun stapler validate -v "$artifact"

  log "Validate Gatekeeper: $(basename "$artifact")"
  spctl -a -vv "$artifact"
}

main() {
  if [[ "${1:-}" == "--check-only" ]]; then
    CHECK_ONLY=1
  fi

  require_command xcrun
  require_command rg

  build_auth_args
  validate_keychain_profile

  if [[ "$CHECK_ONLY" == "1" ]]; then
    log "Notarization credentials look usable."
    return 0
  fi

  require_command codesign
  require_command spctl

  local artifacts=(
    "$RELEASE_DIR/RedBox-${APP_VERSION}-x64.dmg"
    "$RELEASE_DIR/RedBox-${APP_VERSION}-arm64.dmg"
  )

  for artifact in "${artifacts[@]}"; do
    [[ -f "$artifact" ]] || die "Missing artifact: $artifact"
    sign_dmg_container "$artifact"
    submit_and_wait "$artifact"
    staple_and_verify "$artifact"
  done

  log "All DMG artifacts are signed, notarized, stapled, and verified."
}

main "$@"
