#!/usr/bin/env bash
# shellcheck disable=SC1091

set -ex

. version.sh
. build-targets.sh

if [[ "${SHOULD_BUILD}" == "yes" ]]; then
  echo "MS_COMMIT=\"${MS_COMMIT}\""
  cd vscode || { echo "'vscode' dir not found"; exit 1; }

  # Two versions go into the tree here, and they are not the same number.
  #
  # `vscode/package.json` carries the CODE OSS API version. `product.json` has no top-level
  # `version`, so `platform/product/common/product.ts` falls back to `_VSCODE_PACKAGE_JSON.version`
  # for `productService.version` -- and that value is what every `engines.vscode` range in every
  # extension is validated against (`extensionValidator.isEngineValid`). Writing OpenIDE's own
  # version here would make the editor claim an API level it does not implement, and Open VSX
  # would stop serving it anything.
  #
  # `product.json.openideVersion` carries the PRODUCT version. That is what the About dialog
  # shows, what names the installers and tarballs, and what the update feed compares.
  #
  # Both are derived from openide-version.json; neither is maintained by hand in these files.
  # Only the top-level `version` key is rewritten: a `sed` over the whole file would also hit the
  # versions of every dependency.
  node -e '
    const fs = require("fs");
    const [apiVersion, productVersion] = process.argv.slice(1);

    const pkgRaw = fs.readFileSync("package.json", "utf8");
    const pkgNext = pkgRaw.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1"${apiVersion}"`);
    if (pkgNext !== pkgRaw) { fs.writeFileSync("package.json", pkgNext); }

    const product = JSON.parse(fs.readFileSync("product.json", "utf8"));
    product.openideVersion = productVersion;
    fs.writeFileSync("product.json", JSON.stringify(product, null, 2) + "\n");

    console.log(`[build] package.json version = ${JSON.parse(pkgNext).version} (Code OSS API)`);
    console.log(`[build] product.json openideVersion = ${product.openideVersion} (OpenIDE)`);
  ' "${CODE_OSS_PACKAGE_VERSION}" "${RELEASE_VERSION}"

  . ../node-heap.sh
  export VSCODE_PUBLISH_COUNTER=1

  # OpenIDE mantiene un árbol fuente completo. En CI (o en un checkout nuevo)
  # instalamos dependencias, pero nunca reseteamos ni reconstruimos el source.
  if [[ "${CI_BUILD}" != "no" || ! -d node_modules ]]; then
    export ELECTRON_SKIP_BINARY_DOWNLOAD=1
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    node build/npm/preinstall.ts
    npm ci
  fi

  npm run gulp vscode-min-prepack

  if [[ "${OS_NAME}" == "osx" ]]; then
    # remove win32 node modules
    rm -f .build/extensions/ms-vscode.js-debug/src/win32-app-container-tokens.*.node

    # generate Group Policy definitions
    npm run copy-policy-dto --prefix build
    node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc darwin

    npm run gulp "vscode-darwin-${VSCODE_ARCH}-min-packing"

    find "../VSCode-darwin-${VSCODE_ARCH}" -print0 | xargs -0 touch -c

    . ../build_cli.sh

    VSCODE_PLATFORM="darwin"
  elif [[ "${OS_NAME}" == "windows" ]]; then
    # in CI, packaging will be done by a different job
    if [[ "${CI_BUILD}" == "no" ]]; then
      . ../build/windows/rtf/make.sh

      # generate Group Policy definitions
      npm run copy-policy-dto --prefix build
      node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc win32

      npm run gulp "vscode-win32-${VSCODE_ARCH}-min-packing"

      . ../build_cli.sh
    fi

    VSCODE_PLATFORM="win32"
  else # linux
    # remove win32 node modules
    rm -f .build/extensions/ms-vscode.js-debug/src/win32-app-container-tokens.*.node

    # in CI, packaging will be done by a different job
    if [[ "${CI_BUILD}" == "no" ]]; then
      # generate Group Policy definitions
      npm run copy-policy-dto --prefix build
      node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc linux

      npm run gulp "vscode-linux-${VSCODE_ARCH}-min-packing"

      find "../VSCode-linux-${VSCODE_ARCH}" -print0 | xargs -0 touch -c

      . ../build_cli.sh
    fi

    VSCODE_PLATFORM="linux"
  fi

  node ../dev/audit-bootstrap-imports.mjs out-vscode-min

  if [[ "${SHOULD_BUILD_REH}" != "no" ]]; then
    npm run gulp minify-vscode-reh
    npm run gulp "vscode-reh-${VSCODE_PLATFORM}-${VSCODE_ARCH}-min-ci"
  fi

  if [[ "${SHOULD_BUILD_REH_WEB}" != "no" ]]; then
    npm run gulp minify-vscode-reh-web
    npm run gulp "vscode-reh-web-${VSCODE_PLATFORM}-${VSCODE_ARCH}-min-ci"
  fi

  cd ..
fi
