#!/usr/bin/env bash
# Compatibility entry point for the release workflows: resolves the version
# metadata but neither downloads nor rebuilds the source tree.

set -e

if [[ ! -f vscode/package.json ]]; then
  echo "Error: the canonical source tree is missing at ./vscode" >&2
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
