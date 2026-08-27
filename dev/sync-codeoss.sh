#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${ROOT}"

CURRENT_COMMIT=$(jq -er '.codeOss.commit' openide-version.json)
TARGET_REF="${1:-}"

if [[ -z "${TARGET_REF}" ]]; then
  UPDATE_INFO=$(curl --silent --show-error --fail \
    'https://update.code.visualstudio.com/api/update/darwin/stable/0000000000000000000000000000000000000000')
  TARGET_REF=$(jq -er '.version' <<<"${UPDATE_INFO}")
fi

if ! git remote get-url codeoss >/dev/null 2>&1; then
  git remote add codeoss https://github.com/microsoft/vscode.git
fi

git fetch --no-tags codeoss "${CURRENT_COMMIT}" "${TARGET_REF}"
TARGET_COMMIT=$(git rev-parse FETCH_HEAD)
TARGET_VERSION=$(git show "${TARGET_COMMIT}:package.json" | jq -er '.version')

if [[ "${TARGET_COMMIT}" == "${CURRENT_COMMIT}" ]]; then
  echo "OpenIDE ya está basado en Code OSS ${TARGET_VERSION} (${TARGET_COMMIT:0:12})."
  exit 0
fi

PATCH_FILE=$(mktemp)
trap 'rm -f "${PATCH_FILE}"' EXIT

# Se integra el delta real de Code OSS sobre nuestra fuente versionada. --3way
# conserva las customizaciones de OpenIDE y deja conflictos explícitos para revisión.
git diff --binary "${CURRENT_COMMIT}" "${TARGET_COMMIT}" -- . >"${PATCH_FILE}"
if ! git apply --3way --index --directory=vscode "${PATCH_FILE}"; then
  echo "La actualización de Code OSS produjo conflictos. Resolvelos en vscode/ y continuá la integración." >&2
  exit 2
fi

CODE_OSS_MAJOR_MINOR=${TARGET_VERSION%.*}
OPENIDE_VERSION="${CODE_OSS_MAJOR_MINOR}.0"
tmp=$(mktemp)
jq --arg version "${OPENIDE_VERSION}" '.version = $version' vscode/package.json >"${tmp}"
mv "${tmp}" vscode/package.json
tmp=$(mktemp)
jq --arg version "${OPENIDE_VERSION}" '.version = $version | .packages[""].version = $version' vscode/package-lock.json >"${tmp}"
mv "${tmp}" vscode/package-lock.json
tmp=$(mktemp)
jq --arg version "${TARGET_VERSION}" --arg commit "${TARGET_COMMIT}" \
  '.codeOss.version = $version | .codeOss.commit = $commit' openide-version.json >"${tmp}"
mv "${tmp}" openide-version.json

git add vscode openide-version.json
echo "Code OSS ${TARGET_VERSION} (${TARGET_COMMIT:0:12}) integrado. Revisá el diff y ejecutá npm run compile."
