#!/usr/bin/env bash
# Records WHICH asset of this build the update feed should point at.
#
# A build produces several files (the REH tarball, the CLI tarball, checksums), but only ONE of
# them is what the updater downloads and installs. `generate-update-manifest.sh` needs to be told
# which, and until now nothing told it: the release job asserted
# `release-assets/manifest-inputs.json` existed and no script ever wrote it, so a release would
# build all six platforms, publish the draft, and then die at the last step with the update feed
# never generated.
#
# Each build job writes its own fragment next to its assets; the publish job merges them with
# `jq -s`. Per-job fragments and not one shared file because the six builds run in parallel on
# different machines and never see each other's output.
#
#   dev/write-manifest-input.sh <platform> <arch> <target>
set -euo pipefail

[[ $# -eq 3 ]] || { echo "Usage: $0 <platform> <arch> <target>" >&2; exit 1; }
PLATFORM=$1 ARCH=$2 TARGET=$3
. ./version.sh

# The installable of each target, as its `build/<os>/prepare_assets.sh` names it. A glob rather
# than a literal because the AppImage carries the tool's own version in the name.
case "${PLATFORM}:${TARGET}" in
	linux:appimage) PATTERN="assets/*.AppImage" ;;
	darwin:archive) PATTERN="assets/${APP_NAME}-darwin-${ARCH}-${RELEASE_VERSION}.zip" ;;
	win32:user)     PATTERN="assets/${APP_NAME}UserSetup-${ARCH}-${RELEASE_VERSION}.exe" ;;
	*) echo "No installable is defined for ${PLATFORM}/${TARGET}." >&2; exit 1 ;;
esac

# shellcheck disable=SC2206 -- the glob is what selects the asset.
MATCHES=(${PATTERN})
if [[ ${#MATCHES[@]} -ne 1 || ! -f "${MATCHES[0]}" ]]; then
	# Loud on purpose: a silent miss here means a release whose feed points nowhere, and that is
	# only discovered by a user whose IDE refuses to update.
	echo "Expected exactly one asset matching '${PATTERN}', found ${#MATCHES[@]}:" >&2
	ls -1 assets >&2 || true
	exit 1
fi

ASSET=$(basename "${MATCHES[0]}")
OUT="assets/manifest-input-${PLATFORM}-${ARCH}-${TARGET}.json"
jq -n --arg asset "${ASSET}" --arg platform "${PLATFORM}" --arg arch "${ARCH}" --arg target "${TARGET}" \
	'{asset:$asset,platform:$platform,arch:$arch,target:$target}' >"${OUT}"
echo "Update feed will point at ${ASSET} for ${PLATFORM}/${ARCH}/${TARGET}."
