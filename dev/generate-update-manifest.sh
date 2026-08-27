#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 || $# -gt 5 ]]; then
  echo "Uso: $0 <plataforma> <arquitectura> <asset> <directorio-salida> [target]" >&2; exit 1
fi
PLATFORM=$1 ARCH=$2 ASSET=$3 OUTPUT=$4 TARGET=${5:-}
. ./version.sh
case "${PLATFORM}" in linux) TARGET=${TARGET:-appimage};; darwin) TARGET=${TARGET:-archive};; win32) TARGET=${TARGET:-archive};; *) echo "Plataforma inválida" >&2; exit 1;; esac
[[ -f "${ASSET}" ]] || { echo "Falta asset ${ASSET}" >&2; exit 1; }
[[ -n "${OPENIDE_UPDATE_PRIVATE_KEY:-}" ]] || { echo "Falta OPENIDE_UPDATE_PRIVATE_KEY (PEM Ed25519)." >&2; exit 1; }
KEY_ID=$(jq -er '.updater.keyId' openide-version.json)
ASSET_NAME=$(basename "${ASSET}") REPOSITORY=${GITHUB_REPOSITORY:-Niihuel/openide}
TAG="v${RELEASE_VERSION}"
URL="https://github.com/${REPOSITORY}/releases/download/${TAG}/${ASSET_NAME}"
SIZE=$(stat -c %s "${ASSET}" 2>/dev/null || stat -f %z "${ASSET}")
SHA256=$(sha256sum "${ASSET}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${ASSET}" | awk '{print $1}')
PUBLISHED_AT=${OPENIDE_PUBLISHED_AT:-$(date -u +%Y-%m-%dT%H:%M:%S.000Z)}
DEST="${OUTPUT}/${VSCODE_QUALITY}/${PLATFORM}/${ARCH}/${TARGET}"; mkdir -p "${DEST}"
MANIFEST="${DEST}/latest.json"; SIGNATURE="${MANIFEST}.minisig"
jq -n --arg channel "${VSCODE_QUALITY}" --arg platform "${PLATFORM}" --arg architecture "${ARCH}" --arg target "${TARGET}" \
  --arg productVersion "${RELEASE_VERSION}" --arg buildVersion "${BUILD_SOURCEVERSION}" --arg codeOssVersion "${CODE_OSS_VERSION}" --arg publishedAt "${PUBLISHED_AT}" \
  --arg url "${URL}" --arg sha256 "${SHA256}" --arg notes "https://github.com/${REPOSITORY}/releases/tag/${TAG}" \
  --argjson size "${SIZE}" --argjson minimumUpdaterVersion "${OPENIDE_MINIMUM_UPDATER_VERSION}" \
  '{schemaVersion:2,product:"openide",channel:$channel,platform:$platform,architecture:$architecture,target:$target,productVersion:$productVersion,buildVersion:$buildVersion,codeOssVersion:$codeOssVersion,publishedAt:$publishedAt,minimumUpdaterVersion:$minimumUpdaterVersion,artifact:{url:$url,size:$size,sha256:$sha256},releaseNotesUrl:$notes,rollout:{percentage:100,seed:($productVersion+"-"+$channel)}}' >"${MANIFEST}"
node - "${OPENIDE_UPDATE_PRIVATE_KEY}" "${MANIFEST}" "${KEY_ID}" "${SIGNATURE}" <<'NODE'
const fs=require('fs'), crypto=require('crypto'); const [keyPath,file,keyId,out]=process.argv.slice(2);
const signature=crypto.sign(null,fs.readFileSync(file),fs.readFileSync(keyPath)).toString('base64');
fs.writeFileSync(out,JSON.stringify({keyId,algorithm:'ed25519',signature})+'\n',{mode:0o600});
NODE
printf '%s\n' "${MANIFEST}"
