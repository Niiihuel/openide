#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2129

### Windows
# to run with Bash: "C:\Program Files\Git\bin\bash.exe" ./dev/build.sh
###

export APP_NAME="OpenIDE"
export ASSETS_REPOSITORY="Niihuel/openide"
export BINARY_NAME="openide"
export CI_BUILD="no"
export GH_REPO_PATH="Niihuel/openide"
export ORG_NAME="Nihuel Prieto Rellan"
export SHOULD_BUILD="yes"
export SKIP_ASSETS="yes"
export SKIP_BUILD="no"
export VSCODE_QUALITY="stable"
export VSCODE_SKIP_NODE_VERSION_CHECK="yes"

while getopts ":iop" opt; do
  case "$opt" in
    i)
      export ASSETS_REPOSITORY="Niihuel/openide"
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

case "${OSTYPE}" in
  darwin*)
    export OS_NAME="osx"
    ;;
  msys* | cygwin*)
    export OS_NAME="windows"
    ;;
  *)
    export OS_NAME="linux"
    ;;
esac

UNAME_ARCH=$( uname -m )

if [[ "${UNAME_ARCH}" == "aarch64" || "${UNAME_ARCH}" == "arm64" ]]; then
  export VSCODE_ARCH="arm64"
elif [[ "${UNAME_ARCH}" == "ppc64le" ]]; then
  export VSCODE_ARCH="ppc64le"
elif [[ "${UNAME_ARCH}" == "riscv64" ]]; then
  export VSCODE_ARCH="riscv64"
elif [[ "${UNAME_ARCH}" == "loongarch64" ]]; then
  export VSCODE_ARCH="loong64"
elif [[ "${UNAME_ARCH}" == "s390x" ]]; then
  export VSCODE_ARCH="s390x"
else
  export VSCODE_ARCH="x64"
fi

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
