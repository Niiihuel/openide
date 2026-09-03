#!/usr/bin/env bash

set -e

VERSION_FILE="${OPENIDE_VERSION_FILE:-./openide-version.json}"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Error: no existe ${VERSION_FILE}" >&2
  return 1 2>/dev/null || exit 1
fi

jq -e '(.schemaVersion | type == "number" and . == 3) and (.updater.schemaVersion | type == "number" and . == 2) and (.updater.minimumUpdaterVersion | type == "number" and . >= 1 and floor == .)' "${VERSION_FILE}" >/dev/null || {
  echo "Error: tipos del schema de versión/updater inválidos." >&2
  return 1 2>/dev/null || exit 1
}
OPENIDE_VERSION=$(jq -er '.version' "${VERSION_FILE}")
OPENIDE_CHANNEL=$(jq -er '.channel' "${VERSION_FILE}")
OPENIDE_VERSION_SCHEMA=$(jq -er '.schemaVersion' "${VERSION_FILE}")
OPENIDE_UPDATER_SCHEMA=$(jq -er '.updater.schemaVersion' "${VERSION_FILE}")
OPENIDE_MINIMUM_UPDATER_VERSION=$(jq -er '.updater.minimumUpdaterVersion' "${VERSION_FILE}")
CODE_OSS_VERSION=$(jq -er '.codeOss.version' "${VERSION_FILE}")
CODE_OSS_COMMIT=$(jq -er '.codeOss.commit' "${VERSION_FILE}")

RELEASE_VERSION="${RELEASE_VERSION:-${OPENIDE_VERSION}}"
VSCODE_QUALITY="${VSCODE_QUALITY:-${OPENIDE_CHANNEL}}"
MS_TAG="${CODE_OSS_VERSION}"
MS_COMMIT="${CODE_OSS_COMMIT}"

if [[ ! "${CODE_OSS_COMMIT}" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Error: commit Code OSS inválido." >&2
  return 1 2>/dev/null || exit 1
fi

if [[ "${OPENIDE_VERSION_SCHEMA}" != "3" || "${OPENIDE_UPDATER_SCHEMA}" != "2" || ! "${OPENIDE_MINIMUM_UPDATER_VERSION}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: schema de versión/updater OpenIDE inválido." >&2
  return 1 2>/dev/null || exit 1
fi
if [[ "${OPENIDE_CHANNEL}" != "stable" && "${OPENIDE_CHANNEL}" != "insider" ]]; then
  echo "Error: canal OpenIDE inválido: ${OPENIDE_CHANNEL}" >&2
  return 1 2>/dev/null || exit 1
fi
if [[ ! "${RELEASE_VERSION}" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-insider\.[0-9]{8}\.[1-9][0-9]*)?$ ]]; then
  echo "Error: versión OpenIDE inválida: ${RELEASE_VERSION}" >&2
  return 1 2>/dev/null || exit 1
fi
if [[ "${OPENIDE_CHANNEL}" == "stable" && ( "${OPENIDE_VERSION}" == *-* || "${RELEASE_VERSION}" == *-* ) ]] || [[ "${OPENIDE_CHANNEL}" == "insider" && ( "${OPENIDE_VERSION}" != *-insider.* || "${RELEASE_VERSION}" != *-insider.* ) ]]; then
  echo "Error: versión ${RELEASE_VERSION} incompatible con canal ${OPENIDE_CHANNEL}." >&2
  return 1 2>/dev/null || exit 1
fi

if [[ ! "${OPENIDE_VERSION}" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-insider\.[0-9]{8}\.[1-9][0-9]*)?$ || ! "${CODE_OSS_VERSION}" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "Error: versión declarada OpenIDE/Code OSS inválida." >&2
  return 1 2>/dev/null || exit 1
fi
if [[ "${VSCODE_QUALITY}" != "${OPENIDE_CHANNEL}" ]]; then
  echo "Error: VSCODE_QUALITY (${VSCODE_QUALITY}) debe coincidir con channel (${OPENIDE_CHANNEL})." >&2
  return 1 2>/dev/null || exit 1
fi
# OpenIDE versions its product independently of the Code OSS release it is built on. The two
# numbers answer different questions and are deliberately NOT tied together:
#
#   OPENIDE_VERSION   what this product calls itself. Installers, tarballs, the update feed and
#                     the About dialog. Bumped when OpenIDE ships something.
#   CODE_OSS_VERSION  which VS Code extension API this build implements. It is what lands in
#                     `vscode/package.json`, which is what `productService.version` resolves to,
#                     which is what every `engines.vscode` range is checked against.
#
# Renaming the second to match the first would tell Open VSX that a 1.0.0 editor cannot run an
# extension requiring ^1.121.0 -- i.e. it would silently cost us the extension ecosystem.
CODE_OSS_PACKAGE_VERSION="${CODE_OSS_VERSION}"

if [[ -z "${BUILD_SOURCEVERSION:-}" ]]; then
  SOURCE_ID="${RELEASE_VERSION}:${MS_COMMIT}"
  if type -t sha1sum &>/dev/null; then
    BUILD_SOURCEVERSION=$(printf '%s' "${SOURCE_ID}" | sha1sum | cut -d' ' -f1)
  else
    BUILD_SOURCEVERSION=$(printf '%s' "${SOURCE_ID}" | shasum | cut -d' ' -f1)
  fi
fi
if [[ ! "${BUILD_SOURCEVERSION}" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Error: BUILD_SOURCEVERSION inválido." >&2
  return 1 2>/dev/null || exit 1
fi

echo "OPENIDE_VERSION=\"${OPENIDE_VERSION}\""
echo "CODE_OSS_VERSION=\"${CODE_OSS_VERSION}\""
echo "CODE_OSS_PACKAGE_VERSION=\"${CODE_OSS_PACKAGE_VERSION}\""
echo "BUILD_SOURCEVERSION=\"${BUILD_SOURCEVERSION}\""

if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "OPENIDE_VERSION=${OPENIDE_VERSION}" >> "${GITHUB_ENV}"
  echo "CODE_OSS_VERSION=${CODE_OSS_VERSION}" >> "${GITHUB_ENV}"
  echo "CODE_OSS_PACKAGE_VERSION=${CODE_OSS_PACKAGE_VERSION}" >> "${GITHUB_ENV}"
  echo "BUILD_SOURCEVERSION=${BUILD_SOURCEVERSION}" >> "${GITHUB_ENV}"
fi

export OPENIDE_VERSION OPENIDE_CHANNEL OPENIDE_VERSION_SCHEMA OPENIDE_UPDATER_SCHEMA OPENIDE_MINIMUM_UPDATER_VERSION CODE_OSS_VERSION CODE_OSS_COMMIT CODE_OSS_PACKAGE_VERSION
export RELEASE_VERSION VSCODE_QUALITY MS_TAG MS_COMMIT BUILD_SOURCEVERSION
