---
title: Updates
description: How OpenIDE checks for updates, verifies them and applies them, and what the release secrets are.
---

OpenIDE publishes artifacts on GitHub Releases and version 2 manifests on the `updates` branch of the repository. Each manifest is signed with Ed25519 and binds platform, architecture, channel, target, version, size and the SHA-256 of the artifact.

## Integrity

The client embeds an immutable public key. Before offering an update it verifies the exact bytes of the manifest, its schema, channel and target, the anti-rollback policy and the rollout. Before installing it verifies the size and SHA-256 of the artifact.

That chain, the Ed25519 signature of the manifest plus the hash of the artifact, is what decides whether an update is installed. The operating system signature (Authenticode on Windows, Developer ID on macOS) is a different layer: it protects whoever **downloads** the installer from a browser, not the updater. Today the Windows installers are published **unsigned**, because an Authenticode certificate has to be bought from a CA. Auto-update works the same, but SmartScreen warns when the installer is downloaded by hand.

The manifest validator also checks that the download URL is HTTPS without credentials, that the host is on the allowlist and that the path belongs to this repository. If the repository moves to another account the regex has to be updated, otherwise the updater rejects every legitimate release. It fails closed, which is the right direction, but silently.

## AppImage and NixOS

The supported mutable installation lives in `~/.local/bin/OpenIDE.AppImage`. Replacement uses a `.pending` file, keeps `.previous` and writes a health marker. If the first launch fails, the wrapper restores the previous version once. A derivation under `/nix/store` is never modified automatically.

On Linux the updater only replaces an AppImage. Package installs (`.deb`, `.rpm`) are updated by your package manager.

## Channels

- `stable`: versions `X.Y.Z`, promoted manually after every artifact has been verified.
- `insider`: versions `X.Y.Z-insider.YYYYMMDD.N`, published on a separate feed.

## Controlling update checks

The relevant settings are the usual VS Code ones. `update.mode` set to `manual` or `none` stops automatic checks; `update.enableWindowsBackgroundUpdates` set to `false` disables background updates on Windows. See [Telemetry](/docs/telemetry/) for the complete list of settings that contact the network.

## Release secrets

CI fails closed if `OPENIDE_UPDATE_PRIVATE_KEY` is missing: without that key there is no signed manifest and no update is possible. Windows signing is optional and is only refused when half configured (a certificate without a password, or the reverse), because that combination produces unsigned installers that look configured. These secrets are never stored in the repository or in build artifacts.

### `OPENIDE_UPDATE_PRIVATE_KEY`

This is the Ed25519 private key, as PKCS#8 PEM, that signs the manifests. Its public half is pinned in `openide-version.json` (`updater.publicKey`) and travels inside every published client: **they are a pair**. Changing one without the other makes every installed client reject updates with an invalid signature, and that failure is invisible from CI: releases publish fine and only an already installed IDE notices.

If you already have the key, confirm it is the right one before loading it:

```bash
node dev/update-signing-key.mjs check path/to/openide-update.pem
```

If you do not, generate a new pair. The command writes the private key to the file (mode 600, never printed) and shows only the public one:

```bash
node dev/update-signing-key.mjs new ~/openide-update.pem
```

Then, and **before publishing a release signed with it**, put the printed public key in `updater.publicKey` of `openide-version.json` and commit that change. Only then paste the content of the `.pem`, including the `BEGIN` and `END` lines, into the `OPENIDE_UPDATE_PRIVATE_KEY` repository secret.

Keep the `.pem` outside the repository and backed up: it is the only thing that allows publishing an update that existing clients accept. If it is lost, the public key has to change and everyone who already has OpenIDE installed must reinstall by hand. `.gitignore` ignores `*.pem`, `*.p12`, `*.pfx` and `*.key` so a slip does not publish it; a committed key is not erased by the next commit, it stays in the history and has to be rotated.
