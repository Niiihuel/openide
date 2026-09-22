# OpenIDE Plugin Registry

This directory contains a dependency-free reference registry and publisher CLI
for remote OpenIDE plugin distribution. It complements repository and personal
marketplaces; it is not an adapter for OpenAI's public plugin directory.

The registry implements a supply-chain boundary instead of treating a mutable
Git checkout as an installed plugin:

- publishers authenticate control-plane requests with Ed25519 keys;
- every release binds publisher, plugin, SemVer, artifact SHA-256 and size in a
  detached Ed25519 signature;
- a `(plugin, version)` can be created once and never overwritten;
- releases move through `draft -> staged -> published`;
- rollback moves the public channel pointer to a previously published immutable
  release; it never edits or rebuilds that release;
- request timestamps and persisted nonces reject replayed publish operations;
- artifacts reject traversal, symlinks, special files, duplicate paths and
  oversized packages before they enter the registry;
- state changes and release-directory publication use atomic renames and a
  single-writer filesystem lock.

## Local quick start

Use Node 24 or the version in the repository `.nvmrc`.

```bash
node dev/plugin-registry/cli.mjs keygen \
  --private .secrets/acme-plugin.pem \
  --public .secrets/acme-plugin.pub

export OPENIDE_PLUGIN_REGISTRY_ADMIN_TOKEN='replace-with-at-least-24-random-characters'

node dev/plugin-registry/cli.mjs serve \
  --root .registry-data \
  --name internal \
  --host 127.0.0.1 \
  --port 8787
```

In another shell, using the same admin token only for initial publisher
registration:

```bash
node dev/plugin-registry/cli.mjs register \
  --registry http://127.0.0.1:8787 \
  --publisher acme \
  --display-name 'Acme Engineering' \
  --issuer 'https://github.com/' \
  --subject 'github-account-id' \
  --public-key .secrets/acme-plugin.pub

node dev/plugin-registry/cli.mjs upload \
  --registry http://127.0.0.1:8787 \
  --publisher acme \
  --plugin ./plugins/code-review \
  --private-key .secrets/acme-plugin.pem \
  --stage \
  --promote
```

`--version` is optional when root `plugin.json` declares a SemVer `version`.
The root manifest and `skills/*/SKILL.md` remain the portable plugin contract.
Installing the result does not create or modify `AGENTS.md`; OpenIDE loads
project/user agent instructions through their normal precedence independently
of plugin installation.

Add the resulting catalog URL to `chat.plugins.marketplaces`:

```json
[
  "http://127.0.0.1:8787/v1/marketplace.json"
]
```

Plain HTTP is accepted by the client and CLI only for loopback development.

## Promotion and rollback

Upload without promotion leaves a draft that is not downloadable. Staging marks
the signed release as ready for promotion, but it remains absent from both the
public catalog and anonymous artifact downloads. Promotion changes the public
channel pointer and makes those exact immutable bytes available.

```bash
node dev/plugin-registry/cli.mjs stage \
  --registry https://plugins.example.com \
  --publisher acme --plugin code-review --version 1.4.0 \
  --private-key .secrets/acme-plugin.pem

node dev/plugin-registry/cli.mjs promote \
  --registry https://plugins.example.com \
  --publisher acme --plugin code-review --version 1.4.0 \
  --private-key .secrets/acme-plugin.pem

node dev/plugin-registry/cli.mjs rollback \
  --registry https://plugins.example.com \
  --publisher acme --plugin code-review --version 1.3.2 \
  --private-key .secrets/acme-plugin.pem
```

A bad non-current release can be removed from download eligibility with `yank`.
The current version must first be replaced by a promotion or rollback.

## HTTP contract

Public, read-only endpoints:

- `GET /healthz`
- `GET /v1/marketplace.json`
- `GET /v1/publishers/:publisher/plugins/:plugin`
- `GET /v1/publishers/:publisher/plugins/:plugin/versions/:version/artifact`

Mutation endpoints:

- `POST /v1/publishers` — admin bearer token;
- `PUT /v1/publishers/:publisher/plugins/:plugin/versions/:version` — publisher-signed upload;
- `POST /v1/publishers/:publisher/plugins/:plugin/versions/:version/stage`;
- `POST /v1/publishers/:publisher/plugins/:plugin/versions/:version/publish`;
- `POST /v1/publishers/:publisher/plugins/:plugin/versions/:version/yank`;
- `POST /v1/publishers/:publisher/plugins/:plugin/channels/stable/rollback`.

Publisher requests sign a canonical authorization containing the action,
resource, exact body SHA-256, publisher, key id, timestamp and nonce. The upload
also carries a durable release signature that clients verify independently.

The artifact is canonical JSON with sorted file entries and base64 contents.
Each entry includes its own size, mode and SHA-256. The current limits are 1,000
files, 8 MiB per file and 32 MiB of decoded content.

The v1 portable artifact profile accepts regular `0644` files only because the
cross-platform IDE file abstraction cannot safely materialize an executable bit.
Hook and skill scripts must be invoked through an explicit interpreter (for
example, `python3 script.py` or `bash script.sh`) instead of direct execution.

The public catalog has a content-derived ETag and only changes after a mutation
that affects publisher identity or the stable channel. Clients may revalidate
with `If-None-Match`. Artifact URLs are immutable once published, while staged,
draft and yanked releases return `404` to anonymous readers.

## Security boundary

The admin token only bootstraps publisher identities. It cannot sign a release.
The publisher private key signs both the immutable release and each control
request; the registry binds the publisher id to an external `issuer`/`subject`
principal and persists request nonces to reject replay. Installation clients
must verify the advertised publisher key fingerprint, detached release
signature, exact artifact byte hash, every file hash and every extraction path.
The configured HTTPS registry origin (and any enterprise allowlist governing it)
remains the root of trust: a valid release signature protects immutable bytes,
but does not by itself make an untrusted registry service trustworthy.

This reference service does not provide publisher discovery, account recovery,
an online key-revocation workflow, malware scanning, transparency logs,
moderation or multi-tenant authorization. Deployments exposed to untrusted
publishers need those controls outside this minimal registry before accepting
submissions.

## Production deployment

- Put the Node server behind an HTTPS reverse proxy and pass its stable external
  base URL through `--public-url`. The server refuses to infer a non-loopback
  origin from an untrusted `Host` header.
- Keep `OPENIDE_PLUGIN_REGISTRY_ADMIN_TOKEN` in a secret manager. It is needed
  only to register or rotate publisher public keys; routine releases use the
  publisher private key.
- Store the registry root on a persistent local filesystem and run one writer.
  The lock rejects concurrent registry processes instead of risking a split
  brain. Horizontal scaling requires a transactional shared store and is outside
  this reference backend.
- Back up the entire root, including `registry-state.json` and `plugins/`.
  Release directories are immutable, while the state file contains channel
  pointers, lifecycle state, audit history and replay nonces.
- Keep publisher private keys outside both plugin directories and registry
  storage. Restrict them to publisher CI, ideally through a KMS/HSM signing
  integration. `keygen` writes private keys with mode `0600`.
- Register a new public key before key rotation. Historical keys must remain
  registered so existing release signatures stay verifiable.
- Apply authentication, request-rate and network policy at the reverse proxy in
  addition to the registry's signature checks.

If a deployment is interrupted during a write, restart the service: startup
reconciles complete immutable release directories and ignores quarantined
temporary or invalid entries. Restore `registry-state.json` and `publishers/`
together from one snapshot; never copy only the channel state. To recover from
a bad release, publish a corrected version or run `rollback` to a previously
published version. Releases are never overwritten in place.

Run the backend tests with:

```bash
node --test dev/plugin-registry/registry.test.mjs
```
