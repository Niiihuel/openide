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

## AppImage and NixOS

The supported mutable installation lives at `~/.local/bin/OpenIDE.AppImage`.
Replacement goes through `.pending`, keeps `.previous`, and writes a health
marker. If the first launch fails, the wrapper restores the previous version
exactly once. A derivation under `/nix/store` is never modified automatically.

## Channels

- `stable`: `X.Y.Z` versions, promoted by hand once every artifact is verified.
- `insider`: `X.Y.Z-insider.YYYYMMDD.N` versions, published to a separate feed.

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
