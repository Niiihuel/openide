---
title: Other resources
description: The reh and reh-web archives, the CLI archive and where to ask questions.
---

## What are `reh` and `reh-web` archives?

Each release publishes, next to the desktop builds, a few server-side archives:

- **Remote Host (`reh`)** is the server component for remote SSH and WSL workflows. It runs on the "remote" computer and makes it accessible from OpenIDE. The archive is named `openide-reh-<platform>-<arch>-<version>.tar.gz`.
- **Web Host (`reh-web`)** is the server component behind the `openide serve-web` command. It runs locally and makes OpenIDE accessible from a browser. The archive is named `openide-reh-web-<platform>-<arch>-<version>.tar.gz`.
- **CLI (`cli`)** contains the standalone `openide` command-line tool used for tunnels and headless operations: `openide-cli-<platform>-<arch>-<version>.tar.gz`.

The compatible remote extensions are listed in [Extensions compatibility](/docs/extensions-compatibility/#remote-development).

## Where to ask

- [GitHub Discussions](https://github.com/Niiihuel/openide/discussions) for questions, ideas and show-and-tell.
- [Issues](https://github.com/Niiihuel/openide/issues) for bugs, after checking [Troubleshooting](/docs/troubleshooting/).
- [Releases](https://github.com/Niiihuel/openide/releases) for downloads and release notes.

## Related projects

OpenIDE builds on the work of upstream projects:

- [Microsoft VS Code](https://github.com/microsoft/vscode), the editor base.
- [VSCodium](https://github.com/VSCodium/vscodium), the reference for freely-licensed builds without the proprietary configuration of Microsoft's official binaries. OpenIDE began as a fork of VSCodium's build tooling and still owes much of its packaging and privacy defaults to that project.
- [Open VSX](https://open-vsx.org/), the vendor-neutral extension registry used by default.

The binaries produced by this repository are built from open sources with the product configuration defined by OpenIDE. The repository keeps the MIT license inherited from the base project.
