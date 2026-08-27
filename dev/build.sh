#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2129

### Windows
# to run with Bash: "C:\Program Files\Git\bin\bash.exe" ./dev/build.sh
###

export APP_NAME="OpenIDE"
export ASSETS_REPOSITORY="Niiihuel/openide"
export BINARY_NAME="openide"
export CI_BUILD="no"
export GH_REPO_PATH="Niiihuel/openide"
export ORG_NAME="Nihuel Prieto Rellan"
export SHOULD_BUILD="yes"
export SKIP_ASSETS="yes"
export SKIP_BUILD="no"
# Same reasoning as OS_NAME/VSCODE_ARCH below: a caller that named the channel meant it. Forcing
# "stable" over a job that asked for "insider" would not even build the wrong thing — `version.sh`
# refuses a quality that disagrees with the channel in `openide-version.json` — but it would fail
# well after the checkout, blaming the version file for something this line did.
export VSCODE_QUALITY="${VSCODE_QUALITY:-stable}"
export VSCODE_SKIP_NODE_VERSION_CHECK="yes"

while getopts ":iop" opt; do
  case "$opt" in
    i)
      export ASSETS_REPOSITORY="Niiihuel/openide"
      export BINARY_NAME="openide-insiders"
      export VSCODE_QUALITY="insider"
      ;;
    o)
      export SKIP_BUILD="yes"
      ;;
    p)
      export SKIP_ASSETS="no"
      ;;
    *)
      ;;
  esac
done

# The host answers "what machine am I ON", which is not the same question as "what am I building
# FOR". A caller that already named the target knows something the host cannot, so detection only
# fills a gap the caller left rather than overwriting what it said.
#
# The Windows arm64 runner is what proved this matters. Git for Windows ships an x64 bash, so
# `uname -m` reports `x86_64` on an ARM machine. The job asked for arm64, this block silently
# answered x64, and the build produced `VSCode-win32-x64` — which the packaging step, a separate
# process that read the job's own arm64, then looked for under `VSCode-win32-arm64` and did not
# find. The build "succeeded" for eleven minutes before anything noticed.
if [[ -z "${OS_NAME:-}" ]]; then
  case "${OSTYPE}" in
    darwin*)
      OS_NAME="osx"
      ;;
    msys* | cygwin*)
      OS_NAME="windows"
      ;;
    *)
      OS_NAME="linux"
      ;;
  esac
fi
export OS_NAME

if [[ -z "${VSCODE_ARCH:-}" ]]; then
  UNAME_ARCH=$( uname -m )

  if [[ "${UNAME_ARCH}" == "aarch64" || "${UNAME_ARCH}" == "arm64" ]]; then
    VSCODE_ARCH="arm64"
  elif [[ "${UNAME_ARCH}" == "ppc64le" ]]; then
    VSCODE_ARCH="ppc64le"
  elif [[ "${UNAME_ARCH}" == "riscv64" ]]; then
    VSCODE_ARCH="riscv64"
  elif [[ "${UNAME_ARCH}" == "loongarch64" ]]; then
    VSCODE_ARCH="loong64"
  elif [[ "${UNAME_ARCH}" == "s390x" ]]; then
    VSCODE_ARCH="s390x"
  else
    VSCODE_ARCH="x64"
  fi
fi
export VSCODE_ARCH

export NODE_OPTIONS="--max-old-space-size=8192"

echo "OS_NAME=\"${OS_NAME}\""
echo "SKIP_BUILD=\"${SKIP_BUILD}\""
echo "SKIP_ASSETS=\"${SKIP_ASSETS}\""
echo "VSCODE_ARCH=\"${VSCODE_ARCH}\""
echo "VSCODE_QUALITY=\"${VSCODE_QUALITY}\""

. version.sh

echo "MS_TAG=\"${MS_TAG}\""
echo "MS_COMMIT=\"${MS_COMMIT}\""
echo "RELEASE_VERSION=\"${RELEASE_VERSION}\""
echo "BUILD_SOURCEVERSION=\"${BUILD_SOURCEVERSION}\""

if [[ "${SKIP_BUILD}" == "no" ]]; then
  if [[ -f "./include_${OS_NAME}.gypi" ]]; then
    echo "Installing custom ~/.gyp/include.gypi"

    mkdir -p ~/.gyp

    if [[ -f "${HOME}/.gyp/include.gypi" ]]; then
      mv ~/.gyp/include.gypi ~/.gyp/include.gypi.pre-openide
    else
      echo "{}" > ~/.gyp/include.gypi.pre-openide
    fi

    cp ./build/osx/include.gypi ~/.gyp/include.gypi
  fi

  . build.sh

  if [[ -f "./include_${OS_NAME}.gypi" ]]; then
    mv ~/.gyp/include.gypi.pre-openide ~/.gyp/include.gypi
  fi
fi

if [[ "${SKIP_ASSETS}" == "no" ]]; then
  if [[ "${OS_NAME}" == "windows" ]]; then
    rm -rf build/windows/msi/releasedir
  fi

  if [[ "${OS_NAME}" == "osx" && -f "dev/osx/codesign.env" ]]; then
    . dev/osx/macos-codesign.env

    echo "CERTIFICATE_OSX_APPLE_ID: ${CERTIFICATE_OSX_APPLE_ID}"
  fi

  . prepare_assets.sh
fi
