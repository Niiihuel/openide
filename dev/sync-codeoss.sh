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

# The real Code OSS delta is merged onto our versioned source. --3way keeps OpenIDE's
# customizations and leaves explicit conflicts to review.
git diff --binary "${CURRENT_COMMIT}" "${TARGET_COMMIT}" -- . >"${PATCH_FILE}"
if ! git apply --3way --index --directory=vscode "${PATCH_FILE}"; then
  echo "La actualización de Code OSS produjo conflictos. Resolvelos en vscode/ y continuá la integración." >&2
  exit 2
fi

# A Code OSS sync moves the API version, never the product version. `vscode/package.json` is what
# `productService.version` resolves to, and that is what every extension's `engines.vscode` range
# is validated against -- so it has to say what upstream says. OpenIDE's own version lives in
# `openide-version.json.version` and is bumped when OpenIDE ships, which is a separate decision
# from which Code OSS this is built on.
tmp=$(mktemp)
jq --arg version "${TARGET_VERSION}" '.version = $version' vscode/package.json >"${tmp}"
mv "${tmp}" vscode/package.json
tmp=$(mktemp)
jq --arg version "${TARGET_VERSION}" '.version = $version | .packages[""].version = $version' vscode/package-lock.json >"${tmp}"
mv "${tmp}" vscode/package-lock.json
tmp=$(mktemp)
jq --arg version "${TARGET_VERSION}" --arg commit "${TARGET_COMMIT}" \
  '.codeOss.version = $version | .codeOss.commit = $commit' openide-version.json >"${tmp}"
mv "${tmp}" openide-version.json

git add vscode openide-version.json
echo "Code OSS ${TARGET_VERSION} (${TARGET_COMMIT:0:12}) integrado. Revisá el diff y ejecutá npm run compile."
