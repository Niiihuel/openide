# OpenIDE updates

OpenIDE publishes artifacts to GitHub Releases and v2 manifests to the `updates`
branch. Every manifest is Ed25519-signed and binds together the platform,
architecture, channel, target, version, size and SHA-256 of the artifact.

## Integrity

The client carries an immutable public key. Before offering an update it
verifies the exact bytes of the manifest, its schema, the channel and target, the
anti-rollback policy and the rollout. Before installing it verifies the size and
SHA-256 of the artifact.

That chain — the Ed25519 signature over the manifest plus the artifact hash — is
what decides whether an update installs. Operating-system signing (Authenticode
on Windows, Developer ID on macOS) is a separate layer: it protects whoever
**downloads** the installer from a browser, not the updater. Windows installers
are currently published **unsigned**, because an Authenticode certificate has to
be bought from a CA. Auto-update works either way, but SmartScreen warns anyone
downloading the installer by hand.

## What updates itself

| Installation | In the feed | Behaviour |
|---|---|---|
| Linux x64 AppImage at `~/.local/bin/OpenIDE.AppImage` | Yes | Downloaded, verified and swapped in place; see below. |
| Linux x64 `.deb`, `.rpm`, `.tar.gz` | — | The Linux updater only replaces an AppImage. Install the next release with the package manager. |
| Linux arm64 (any format) | No | No AppImage is built for arm64 (`build/linux/prepare_assets.sh`), so nothing is advertised: an update that cannot install is worse than none. |
| Windows x64 and arm64 user installer | Yes | Downloaded, verified and installed by the user-setup updater. |
| Windows system installer, zip, MSI | — | Updated by running the next installer. |
| Development build (`scripts/code.sh`) | — | Updates are disabled on purpose. |
| Nix store derivation | — | Never modified automatically; rebuild the derivation. |

## AppImage and NixOS

The supported mutable installation lives at `~/.local/bin/OpenIDE.AppImage`.
Replacement goes through `.pending`. The updater verifies the size and SHA-256 of
that final copy before replacing the executable, keeps `.previous`, and records a
pending startup in `.update.json`. A second install is refused until the new
workbench confirms its running version and installed hash, then removes the
journal and rollback copy.

The updater and generated launcher coordinate with Linux `flock` (util-linux).
The `.update.lock` file deliberately stays on disk; the kernel releases ownership
when the holder exits, including after SIGKILL. Do not delete a live lock file.
The NixOS installer resolves `flock` and exports its path to the IDE. Regenerate
the launcher with `bash dev/install-appimage.sh` when upgrading from older builds.

If the first launch fails, the wrapper restores the previous version on the next
launch. Recovery prepares a separate hard link (or copy) and atomically renames it
over the current executable; an interrupted recovery leaves a launchable current
path and a recoverable previous copy. Concurrent CLI invocations do not count as
another failed startup. Restart after an update goes through the installed
launcher or AppImage, never the extracted executable of the old version.

### Manual upgrade from the published 1.1.0 / 1.2.0 AppImages

Those published Linux builds pass a VSBuffer wrapper to `Buffer.from` and fail
when downloading an update. The source fix uses `chunk.buffer`; it cannot repair
an already installed binary through the broken download path. These users need
one manual upgrade **after a release containing the fix has been published**.

1. Download that release's AppImage and matching signed manifest/signature. Verify
   them against the trusted release key with
   `bash dev/verify-update-manifest.sh <manifest.json> <trusted-public-key.pem> <AppImage>`.
2. Close all OpenIDE instances. In a checkout matching the downloaded release,
   put the verified AppImage in `assets/` and make it executable.
3. Run `bash dev/install-appimage.sh`. It atomically replaces the installation,
   clears obsolete update markers, and regenerates the launcher with the shared
   lock and recovery protocol. Start OpenIDE normally.

### Regression checks

After transpiling the sources, run the existing manifest/signature tests and
`dev/test-updater-main.mjs` with Electron. The main-process suite includes real
filesystem tests of corrupted Windows caches, replacement failures, pending
installs, and altered copy bytes. `node dev/test-appimage-recovery.mjs` exercises
SIGKILL and the generated launcher. `xvfb-run -a node dev/test-updater-restart.mjs`
uses an ephemeral signing key, a local HTTP fixture transport, and a synthetic
executable to exercise the production Linux update service through a real
Electron relaunch and a new ready window's health acknowledgement. It does not
publish a release or replace a user's installation. Native Windows installer
execution and the final release artifact still need their platform smoke tests.

## Channels

- `stable`: `X.Y.Z` versions, promoted by hand once every artifact is verified.
  This is the only channel currently published.
- `insider`: `X.Y.Z-insider.YYYYMMDD.N` versions on a separate feed. The
  version format, the manifest parser and `version.sh` already accept it, but
  the pipeline is not wired: `release-openide-insider.yml` has no schedule and
  cannot run against `master`, whose `openide-version.json` declares `stable`.
  Turning it on needs an insider version line, a `quality` input in the release
  workflow and a matching arm in promotion; the workflow's header lists them.

## Release secrets

CI fails closed when `OPENIDE_UPDATE_PRIVATE_KEY` is missing: without that key
there is no signed manifest and no update is possible. Windows signing is
optional, and only a half-configured state is rejected (a certificate without a
password, or the reverse), because that combination produces unsigned installers
that look configured. These secrets are never stored in the repository or in
build artifacts.

### `OPENIDE_UPDATE_PRIVATE_KEY`

The Ed25519 private key, in PKCS#8 PEM, that signs the manifests. Its public half
is declared in `openide-version.json` (`updater.publicKey`), and from there it has
to reach `product.json` (`openideUpdatePublicKey` and `openideUpdateKeyId`), which
is what the client actually reads in
`abstractUpdateService.readSignedOpenideManifest`: **all three are one pair**.
Changing one without the others makes every installed client reject updates as
improperly signed, and that failure is invisible from CI — releases publish
cleanly and only an already-installed IDE ever notices.

If you already have the key, confirm it is the right one before loading it:

```sh
node dev/update-signing-key.mjs check path/to/openide-update.pem
```

If you do not have it, generate a new pair. The command writes the private half
to the file (mode 600, never printed) and shows only the public half:

```sh
node dev/update-signing-key.mjs new ~/openide-update.pem
```

Then, and **before publishing any release signed with it**, put the public half
it printed into `updater.publicKey` in `openide-version.json`, mirror it into
both `product.json` files (the root one and `vscode/`), and commit that change.
`node dev/audit-version-consistency.mjs` checks that all three agree — it went
red the first time for exactly this reason: manifests were being signed with
`openide-release-2026-08` while clients trusted `openide-release-2026-01`, which
would have rejected every single update. Only then paste the contents of the
`.pem` — including the `BEGIN` and `END` lines — into the repository secret
`OPENIDE_UPDATE_PRIVATE_KEY`.

Keep the `.pem` outside the repository and backed up: it is the only thing that
lets you publish an update existing clients will accept. If it is lost, the
public key has to change and everyone with OpenIDE installed must reinstall by
hand. `.gitignore` ignores `*.pem`, `*.p12`, `*.pfx` and `*.key` so a slip does
not publish it — a committed key is not erased by the next commit, it stays in
history and has to be rotated.

## Stable promotion order

The release workflow builds a draft and retains its signed feed as the
`openide-update-feed` workflow artifact for 30 days. It does not advance the
`updates` branch while the release is private.

Run **Promote OpenIDE Stable** with the release tag after the release build
succeeds. Promotion checks out that tag, finds its successful build, downloads
the feed and release assets, verifies the trusted signature and each installer's
size and SHA-256, and checks that all supported platforms are present. It then
publishes the release, confirms unauthenticated access to the installer URLs,
and finally advances the stable feed. If the final push fails, rerun promotion;
it accepts an already public stable release and repeats verification.

Installed builds check automatically 30 seconds after startup when `update.mode`
is `default` or `start`, and hourly after that in `default`. The title-bar
popover announces a detected version once per window session without taking
keyboard focus; an inactive window defers it until focus returns.
`update.titleBar: false` disables that indicator; the *OpenIDE: Check for
updates / Download / Install / Restart* commands remain available. Development
builds intentionally disable application updates, so use the installed AppImage
or Windows user installer when testing an upgrade from the previous version.

After the first start of a new version, OpenIDE fetches the version's note from
`docs/updates/` and shows it once as a card; a version without a note shows
nothing. The format is described in [updates/README.md](./updates/README.md).
