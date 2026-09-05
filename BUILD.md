# Building OpenIDE

OpenIDE keeps its full source tree in `vscode/`. **That folder is the source of
truth**: you edit it directly, and no build command resets, replaces, or
regenerates it from patches.

OpenIDE carries two version numbers, declared together in `openide-version.json`:

| | Where it lives | What it is for |
| --- | --- | --- |
| **Product version** | `product.json.openideVersion` | What OpenIDE calls itself: installer names, update feed, About dialog. Currently `1.1.0`. |
| **VS Code API version** | `vscode/package.json.version` | The extension API this build implements. Every `engines.vscode` range is validated against it, so it tracks Code OSS. Currently `1.136.1`. |

Neither is edited by hand in those files — `build.sh` derives both from
`openide-version.json`, and `dev/audit-version-consistency.mjs` fails the build
if the committed tree drifts. Putting the product version in `package.json`
would make the editor claim an API level it does not implement, and the
extension gallery would stop serving it anything built for current VS Code.

- [Dependencies](#dependencies)
- [Quick iteration](#quick-iteration)
- [Full product build](#full-product-build)
- [Building on NixOS](#building-on-nixos)
- [Packaging](#packaging)
- [Maintenance rules](#maintenance-rules)

## Dependencies

Common to every platform:

- node — see [`.nvmrc`](.nvmrc) for the exact version
- git
- jq
- python3 3.11
- rustup

### Linux

`gcc`, `g++`, `make`, `pkg-config`, `libx11-dev`, `libxkbfile-dev`,
`libsecret-1-dev`, `libkrb5-dev`, `fakeroot`, `rpm`, `rpmbuild`, `dpkg`,
`imagemagick` (for AppImage), `snapcraft` (for Snap).

### macOS

Only the common dependencies above.

### Windows

The build scripts are written in Bash, so run them inside **Git Bash** (bundled
with [Git for Windows](https://gitforwindows.org/)) or **WSL2**. Git Bash is
recommended because the scripts rely on POSIX utilities (`sed`, `grep`, `find`)
that ship with it; if you use WSL2, follow the Linux dependencies instead.

```cmd
winget install --id Git.Git -e
winget install --id jqlang.jq -e
winget install --id 7zip.7zip -e
winget install --id Python.Python.3.11 -e
winget install --id Rustlang.Rustup -e
```

For Node, use [nvm-windows](https://github.com/coreybutler/nvm-windows) with the
version from [`.nvmrc`](.nvmrc), or download from
[nodejs.org](https://nodejs.org/) with **"Automatically install the necessary
tools"** enabled so native addons can compile. Restart your shell after
installing rustup so `cargo` is on the `PATH`.

Packaging `.msi` installers additionally needs
[WiX Toolset v3](https://wixtoolset.org/releases/), with `candle.exe` and
`light.exe` on the `PATH`.

Verify everything is discoverable from Git Bash:

```bash
node --version    # should match .nvmrc
npm --version
jq --version
python3 --version # should be 3.11.x
cargo --version
7z i 2>&1 | head -1
git --version
```

Development uses **Node 24.18.0**. Electron **42.10.0** embeds Node **24.18.1**;
these are separate runtimes. On NixOS, `dev/nodejs.nix` pins the development
binary and its checksum independently of the nixpkgs Node release.

## Quick iteration

This is the loop you want for day-to-day work — it compiles TypeScript and
launches a development instance without producing a packaged product:

```sh
cd vscode
npm ci          # first checkout only
npm run typecheck-client
npm run gulp copy-codicons
npm run transpile-client
npm run gulp compile-extensions compile-extension-media
npm run electron
VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh
```

Run `npm run watch` in a second terminal for incremental rebuilds.

The development instance stores its profile in `~/.config/code-oss-dev`, so it
will not disturb an installed copy of OpenIDE. Pass
`--remote-debugging-port=9333` if you want to inspect it over CDP.

For the checks to run before opening a pull request, see
[CONTRIBUTING.md](CONTRIBUTING.md#validating-your-change).

## Full product build

```sh
. dev/build.sh
```

The Linux result lands in `VSCode-linux-x64/`. The first build of a fresh
checkout runs `npm ci`; later builds reuse `vscode/node_modules`.

On Windows:

```sh
"C:\Program Files\Git\bin\bash.exe" ./dev/build.sh    # Git Bash, recommended
powershell -ExecutionPolicy ByPass -File .\dev\build.ps1
```

### Flags

`dev/build.sh` accepts:

- `-i` — build the Insiders channel
- `-o` — skip the build step
- `-p` — generate the packages, assets and installers

If GitHub rate-limits extension downloads, pass a token:

```sh
GITHUB_TOKEN=$(gh auth token) . dev/build.sh
```

`dev/build.sh` is meant for development. Releases are produced by
[`.github/workflows/release-openide.yml`](.github/workflows/release-openide.yml),
which is the reference for how a real build is assembled.

## Building on NixOS

Create the FHS sandbox once (and whenever `dev/openide-fhs.nix` changes):

```sh
nix-build dev/openide-fhs.nix -o result-fhs
```

Then run any of the commands above inside it:

```sh
./result-fhs/bin/openide-build -c 'cd vscode && npm run typecheck-client && npm run gulp copy-codicons && npm run transpile-client && npm run gulp compile-extensions compile-extension-media && npm run electron'
./result-fhs/bin/openide-build -c 'cd vscode && VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh'
./result-fhs/bin/openide-build -c '. dev/build.sh'
```

To run the built product:

```sh
./result-fhs/bin/openide-build -c \
  './VSCode-linux-x64/openide --user-data-dir ~/.config/OpenIDE'
```

`shell.nix` gives you an interactive shell in the same environment.

## Packaging

### Snap

```sh
cd ./stores/snapcraft/stable    # or ./stores/snapcraft/insider
snapcraft --use-lxd
review-tools.snap-review --allow-classic openide*.snap
```

### AppImage

See [`dev/build-appimage.sh`](dev/build-appimage.sh) and
[`dev/install-appimage.sh`](dev/install-appimage.sh).

### Icons

`icons/build_icons.sh` needs `imagemagick`, `librsvg`, and `png2icns`
(`npm install png2icns -g`).

## Maintenance rules

- OpenIDE features live directly under `vscode/src/`. See the
  [source layout table](CONTRIBUTING.md#how-the-repository-is-laid-out) for
  which paths are OpenIDE's.
- Product resources and configuration live inside `vscode/`.
- No patches are added to make a feature compile.
- A change is validated with a typecheck/compile and, if it affects the UI, in a
  real product window.
- Code OSS updates are integrated as reviewable source changes, never by wiping
  the local tree during a build.
- Packaging scripts decide installer names, icons and update feeds, so inherited
  branding there reaches users directly. `node dev/audit-branding.mjs` scans both
  the shipped product and the scripts that produce it; keep it green.
