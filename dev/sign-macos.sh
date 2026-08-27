#!/usr/bin/env bash
set -euo pipefail
: "${APPLE_DEVELOPER_ID:?Missing APPLE_DEVELOPER_ID}"
: "${APPLE_TEAM_ID:?Missing APPLE_TEAM_ID}"
: "${APPLE_NOTARY_PROFILE:?Missing APPLE_NOTARY_PROFILE}"
APP=${OPENIDE_MACOS_APP:-VSCode-darwin-*/OpenIDE.app}
codesign --force --deep --options runtime --timestamp --sign "$APPLE_DEVELOPER_ID" $APP
codesign --verify --deep --strict $APP
xcrun notarytool submit $APP --keychain-profile "$APPLE_NOTARY_PROFILE" --wait
xcrun stapler staple $APP
spctl --assess --type execute --verbose $APP
