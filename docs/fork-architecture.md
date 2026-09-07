# How the fork is put together

OpenIDE is a fork of Code OSS (VS Code without Microsoft's branding or
telemetry). This document explains **where everything lives and why**, because
the structure of a VS Code fork does not look like a normal project: most of the
tree is not yours, and being able to tell your code from upstream's is what makes
updating possible at all.

## The two models, and which one we use

A VS Code fork is maintained in one of two ways:

**By patches** (the VSCodium model). The repository does NOT contain VS Code's
code: it contains a `patches/` folder and a script that clones the source at
build time. The advantage is that a patch which stops applying *tells you*
exactly where upstream changed. The drawback is that working this way is
uncomfortable: you cannot just open the project and edit it, and every change is
a patch you have to regenerate.

**Vendored** (ours). The complete Code OSS tree lives in `vscode/` and is edited
directly. It is comfortable to develop in, and it is what makes a hundred
thousand lines of our own code manageable. The cost is that you lose the
automatic warning: nothing tells you what you touched.

OpenIDE uses the **vendored** model. There is no `patches/` folder, and
`get_repo.sh` clones nothing — it expects `vscode/` to already be there. The
only leftover of the patch era is a guarded `apply_patch` helper in `utils.sh`
that the Linux packaging scripts would call if `patches/linux/` existed; it
does not, and nothing depends on it. We pay the vendoring cost back with the
tooling in the "Updating" section.

## How the tree divides

The committed baseline reviewed on 5 September 2026 is fork commit
`72c2545ea9750d0f9630813a140157842410ecaa` against Code OSS
`a44adf7f53e00964ab890f9f8758a334f1fc15bc`:

| Difference in the full `vscode/` tree | Files |
|---|---:|
| Added | 719 |
| Modified upstream paths | 559 |
| Deleted upstream paths | 4,154 |
| Added paths without `openide` in their name | 18 |

Of the deletions, 4,129 are in `extensions/copilot`. These counts come from
committed Git objects, excluding local edits. Counting `openide*` paths alone
misses modified upstream files and additions with other names. File counts
identify maintenance work; a low percentage does not prove update safety.

`dev/audit-fork-delta.mjs` compares two explicitly named revisions without
requiring shared Git history. It counts paths without rename heuristics and
includes blob/type changes, executable modes, subsystem totals and exceptions.
The same objects and exception manifest produce identical JSON in a fresh
checkout. Worktree dirtiness is written separately. The tool never fetches or
silently substitutes an empty tree when the upstream base is unavailable.

```bash
# Acquire the exact base into an explicit object store (once).
git init --bare /tmp/openide-codeoss-objects.git
git --git-dir=/tmp/openide-codeoss-objects.git fetch --depth=1 \
  https://github.com/microsoft/vscode.git \
  "$(node -p "require('./openide-version.json').codeOss.commit")"
node dev/audit-fork-delta.mjs \
  --upstream-git-dir /tmp/openide-codeoss-objects.git \
  --base "$(node -p "require('./openide-version.json').codeOss.commit")" \
  --fork-revision HEAD --output .build/fork-inventory
```

`dev/codeoss-preserved-paths.json` explicitly records removals and important
upstream edits with an owner, rationale and validation. An undeclared deletion
fails the audit and blocks synchronization. The legacy import's three omitted
fixture/distribution resources are named individually and require review when
upstream changes them; they are not hidden by a wildcard or an automatic
"missing means intentional" rule. New exceptions require code review.

## Where new code goes

Prefer `openide` prefixes for new product components. The inventory remains the
authoritative account of additions and modifications, including integration
points whose upstream names must stay stable.

```
vscode/src/vs/
  workbench/contrib/openideAgent/     the agent, chat, tools, providers, Project Map, styles
    common/                            pure logic, no DOM  → testable in Node
    browser/                           widgets, UI services, tool implementations
    node/                              the diagram MCP server, repository-contract tests
    test/{common,browser,node}/        tests, by layer
  workbench/contrib/openideSettings/  our own Settings screen
  workbench/contrib/openideDialogs/   modal dialogs
  workbench/contrib/openideUpdate/    update UI, signed manifest, AppImage updater
  platform/openideAgentHost/          agent host and IDE/MCP bridge (main process)
  platform/openideBrowser/            native browser automation
    common/                            shared contract
    electron-main/                     the main process (Playwright)
  code/common/openideCodebase*.ts     codebase graph model and authored notes
```

The `common/` vs `browser/` split is not decorative: `common/` cannot import DOM
or services, so it can be tested without starting a browser. When something can
be expressed as a pure function, it goes there.

**Touching an upstream file is a decision, not an accident.** Each modified
upstream file is extra work at every update. Before editing one, ask whether the
change could live in an `openide*` folder and hook in through a registry (a
`registerSingleton`, a `registerAction2`, a view contribution). It almost always
can. The pull request template asks you to say why when it cannot.

Keep OpenIDE contributor documentation at the repository root and under
`docs/`. Upstream documents inside `vscode/` should generally remain unchanged;
the inventory also exposes existing exceptions such as `.github/copilot-instructions.md`.

## Updating Code OSS

The anchor is `openide-version.json`:

```json
"codeOss": { "version": "1.136.1", "commit": "a44adf7f..." }
```

That commit is **which upstream version this tree came from**. Without it there
would be no way to compute the delta.

`dev/sync-codeoss.sh --prepare <ref>` stages the integration for review:

1. Refuses staged, unstaged or untracked changes in managed paths (`vscode/`,
   `openide-version.json`, `.nvmrc`), preserving unrelated local work.
2. Fetches the exact base and target from the configured `codeoss` remote.
3. Audits the committed fork against its base, refusing undeclared removals.
4. Computes the **upstream-to-upstream** delta, excluding only explicit removal
   entries, and applies it with `git apply --3way --index --directory=vscode`.
5. Keeps conflicts and the pending integration state. Stage resolved files and
   run `--continue --prepare` if dependencies still need installing.
6. Normalizes API lockfile metadata and `.nvmrc`, and audits the staged tree
   against the target. The report labels the staged snapshot separately from
   its originating fork commit.

Install dependencies with the updated Node version, then run
`dev/sync-codeoss.sh --continue`. It runs the source layer checker, client
TypeScript check, fresh transpilation and agent/host/repository contract tests.
Only after those checks pass does it advance `codeOss.version` and
`codeOss.commit`. A failed check leaves the previous base intact and retains
logs for a retry. Calling the script with just a target runs preparation and
validation together using already installed dependencies.

The three-way apply preserves local fork changes where Git can merge them and
leaves conflicts where it cannot. The conflict count is **not** the fork's
modification count: synchronization compares old and new upstream, while the
inventory compares upstream and the fork. Upstream renames are applied as
path deletions/additions; no similarity threshold changes the baseline counts.

The scheduled workflow retains `fork-delta.json`, the readable subsystem table,
worktree status, incoming patch, conflict state and validation logs as artifacts,
including failed integrations. It opens a PR only after validation. It explicitly dispatches the
full CI workflow on the pushed branch for browser, Electron and product smoke
checks: a PR created with `GITHUB_TOKEN` does not trigger them automatically. Review the
inventory and incoming patch for additional upstream subsystem tests and update
`dev/nodejs.nix` hashes if Node changed. Passing the fixed integration checks
does not establish every upstream subsystem or third-party CLI's behavior.

The last major integration is documented in [codeoss-1.136.1.md](./codeoss-1.136.1.md).

After an update, `codeOss.version` moves — the API version this build
implements, which `build.sh` writes into `vscode/package.json`. The product
version (`version`) **does not move because of that**: they are two independent
numbers.

`version` is what OpenIDE calls itself (installers, update feed, the About
dialog). `codeOss.version` is what extension `engines.vscode` ranges are
validated against. Writing the first where the second belongs would make an
OpenIDE 1.0.0 declare that it implements the 1.0.0 API, and Open VSX would stop
serving it any modern extension. `dev/audit-version-consistency.mjs` exists so
that cannot happen without CI stopping it.

## The guardrails

Three layers, fastest to slowest:

**Hygiene** (`npm run precommit` in `vscode/`) runs VS Code's own check over
the staged files: **tabs** for indentation, no trailing whitespace, licence
headers. A husky-generated hook in `.git/hooks/pre-commit` runs it in the
maintainer's clone; the hook is not versioned, so a fresh clone runs the
command by hand. If a commit is rejected with hundreds of "Bad whitespace
indentation", this is why: fix the indentation, do not reach for `--no-verify`.

**The audits** (`dev/audit-*.mjs`) are invariants that each cost a debugging
session once, written so they do not happen again:

- `audit-fork-delta.mjs` — deterministic fork divergence and explicit deletion policy.
- `audit-version-consistency.mjs` — that the two versions and the update signing
  key agree across `openide-version.json`, `package.json` and both `product.json`.
- `audit-branding.mjs` — that no VSCodium or Microsoft branding leaks into what
  gets distributed, including the packaging scripts that name installers.
- `audit-surface-tokens.mjs` — that `--oi-*` tokens are declared where the theme
  publishes its variables, and that radii, hairlines and shadows come from the
  one scale. See [theming-surfaces.md](./theming-surfaces.md).
- `audit-comment-language.mjs` and `audit-prompt-language.mjs` — comments and
  model prompts are in English; both are ratchets with a per-file allowlist.
- `audit-fork-localize.mjs` — OpenIDE surfaces use the bilingual string tables,
  not upstream's `localize()`.
- `audit-production-regex.mjs` — no regex literal that the production minifier
  cannot handle (an upstream Unicode literal once broke packaged startup).
- `audit-bootstrap-imports.mjs` — the three bootstrap entry points import
  nothing outside the bundle (run by `build.sh` on the minified output).
- `audit-script-permissions.mjs` — every shell script is executable.

**CI** (`.github/workflows/ci-openide.yml`) runs the audits, the tooling tests
(`reliability-gates`, `verify-release-feed`, `codeoss-sync`), compiles, and
runs the tests by layer: the signed updater contract, the binary request
transport, the agent in Node, the repository contracts, the agent in Chromium,
the integrated browser and the updater in Electron, and finally a smoke test of
the real product. `cargo check` covers the Rust CLI. The full sequence, as
commands, is in [CONTRIBUTING.md](../CONTRIBUTING.md#validating-your-change).

## The update channel

OpenIDE updates itself, and that is attack surface: if someone can convince the
IDE to download a binary, they run code on your machine. That is why the manifest
is Ed25519-signed (`updater.publicKey` in `openide-version.json`) and
`openideUpdateManifest.ts` additionally validates:

- that the URL is HTTPS, with no username or password;
- that the host is one of `github.com`, `objects.githubusercontent.com` and
  `raw.githubusercontent.com`;
- that the **path** belongs to this repository (`/Niiihuel/openide/releases/`
  or `/blob/` on github.com, `/Niiihuel/openide/updates/` on raw);
- the size and the `sha256` of the artifact.

If you move the repository to another account, those regexes have to be
updated or the updater rejects every legitimate release. It fails closed, which
is the right direction, but silently. The release process that produces and
promotes the feed is in [updates.md](./updates.md).

## Checking without waiting for CI

```bash
# Typecheck the tree (native TypeScript)
cd vscode && npm run typecheck-client

# Transpile to out/ (tests run against out/, not src/)
npm run gulp copy-codicons && npm run transpile-client

# Agent tests in Chromium
npm run test-browser-no-install -- --browser chromium \
  --runGlob 'vs/workbench/contrib/openideAgent/test/browser/*.test.js'

# Launch the IDE and take screenshots of a surface
node ../dev/visual-check.mjs --open=usage
```

On NixOS all of that goes inside `./result-fhs/bin/openide-build -c "..."`.

See [BUILD.md](../BUILD.md) for the full build and packaging.
