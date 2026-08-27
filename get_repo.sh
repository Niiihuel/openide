#!/usr/bin/env bash
# Compatibilidad temporal para los workflows de release: resuelve la metadata
# de versión, pero no descarga ni reconstruye el código fuente.

set -e

if [[ ! -f vscode/package.json ]]; then
  echo "Error: falta el árbol fuente canónico en ./vscode" >&2
  exit 1
fi

. version.sh

echo "MS_TAG=\"${MS_TAG}\""
echo "MS_COMMIT=\"${MS_COMMIT}\""
echo "RELEASE_VERSION=\"${RELEASE_VERSION}\""

if [[ "${GITHUB_ENV}" ]]; then
  echo "MS_TAG=${MS_TAG}" >> "${GITHUB_ENV}"
  echo "MS_COMMIT=${MS_COMMIT}" >> "${GITHUB_ENV}"
  echo "RELEASE_VERSION=${RELEASE_VERSION}" >> "${GITHUB_ENV}"
fi

export MS_TAG
export MS_COMMIT
export RELEASE_VERSION
