#!/usr/bin/env bash
# Which components this (OS_NAME, VSCODE_ARCH) build produces.
#
# Four scripts consult these flags — `build.sh` to decide what to compile, `prepare_assets.sh` to
# decide what to package, and the per-platform `package*.sh` to decide what to publish — and in CI
# each runs as its own process. So a flag set inside one of them is invisible to the other three.
#
# One was. `build.sh` turned the remote extension host off for Windows on anything but x64, and
# `prepare_assets.sh`, starting fresh with the variable unset, read the default and tried to tar a
# `vscode-reh-win32-arm64` directory that had never been built. The decision and its consumers were
# in different processes, so the only place the rule can live is one both of them source.
#
# Sourced, not executed: the point is the exported variables.

SHOULD_BUILD_REH="${SHOULD_BUILD_REH:-yes}"
SHOULD_BUILD_REH_WEB="${SHOULD_BUILD_REH_WEB:-yes}"
SHOULD_BUILD_CLI="${SHOULD_BUILD_CLI:-yes}"

# The server is published for Windows x64 only. Upstream's `gulpfile.reh.ts` does list a
# win32/arm64 target, so this is a choice about what OpenIDE ships rather than a missing task —
# inherited from VSCodium, and left in place because nothing here has ever validated that server.
# Revisit it by flipping this off and letting a release build prove it, not by assuming.
if [[ "${OS_NAME}" == "windows" && "${VSCODE_ARCH}" != "x64" ]]; then
  SHOULD_BUILD_REH="no"
  SHOULD_BUILD_REH_WEB="no"
fi

export SHOULD_BUILD_REH SHOULD_BUILD_REH_WEB SHOULD_BUILD_CLI
