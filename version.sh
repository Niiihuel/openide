#!/usr/bin/env bash

set -e

VERSION_FILE="${OPENIDE_VERSION_FILE:-./openide-version.json}"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Error: no existe ${VERSION_FILE}" >&2
  return 1 2>/dev/null || exit 1
fi

jq -e '(.schemaVersion | type == "number" and . == 2) and (.updater.schemaVersion | type == "number" and . == 2) and (.updater.minimumUpdaterVersion | type == "number" and . >= 1 and floor == .)' "${VERSION_FILE}" >/dev/null || {
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

if [[ "${OPENIDE_VERSION_SCHEMA}" != "2" || "${OPENIDE_UPDATER_SCHEMA}" != "2" || ! "${OPENIDE_MINIMUM_UPDATER_VERSION}" =~ ^[1-9][0-9]*$ ]]; then
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
OPENIDE_API_LINE=$(cut -d. -f1,2 <<<"${RELEASE_VERSION}")
CODE_OSS_API_LINE=$(cut -d. -f1,2 <<<"${CODE_OSS_VERSION}")
if [[ "${OPENIDE_API_LINE}" != "${CODE_OSS_API_LINE}" ]]; then
  echo "Error: OpenIDE ${OPENIDE_VERSION} no coincide con la línea de API Code OSS ${CODE_OSS_VERSION}" >&2
  return 1 2>/dev/null || exit 1
fi

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
echo "BUILD_SOURCEVERSION=\"${BUILD_SOURCEVERSION}\""

if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "OPENIDE_VERSION=${OPENIDE_VERSION}" >> "${GITHUB_ENV}"
  echo "CODE_OSS_VERSION=${CODE_OSS_VERSION}" >> "${GITHUB_ENV}"
  echo "BUILD_SOURCEVERSION=${BUILD_SOURCEVERSION}" >> "${GITHUB_ENV}"
fi

export OPENIDE_VERSION OPENIDE_CHANNEL OPENIDE_VERSION_SCHEMA OPENIDE_UPDATER_SCHEMA OPENIDE_MINIMUM_UPDATER_VERSION CODE_OSS_VERSION CODE_OSS_COMMIT
export RELEASE_VERSION VSCODE_QUALITY MS_TAG MS_COMMIT BUILD_SOURCEVERSION
