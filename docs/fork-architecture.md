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
directly. It is comfortable to develop in, and it is what makes 74,000 lines of
our own code manageable. The cost is that you lose the automatic warning: nothing
tells you what you touched.

OpenIDE uses the **vendored** model. There is no `patches/` folder, and
`get_repo.sh` clones nothing — it expects `vscode/` to already be there. We pay
that cost back with the tooling in the "Updating" section.

## How the tree divides

Measured over `vscode/src`:

| | files | what it is |
|---|---|---|
| OpenIDE's own code | 458 | `contrib/openideAgent`, `contrib/openideSettings`, `platform/openideBrowser`, etc. |
| Modified upstream files | 511 | integrations: chat in the auxiliary bar, the updater, the branding |
| The rest of Code OSS | ~6,600 | untouched |

You are **6%** of the tree. That number matters: you did not rewrite VS Code, you
extended it. As long as it stays low, updating remains viable.

There are also 4,200 upstream files **deleted**, of which 4,103 are
`extensions/copilot` — the Copilot extension that ships with Code OSS and is
redundant here, because the agent is our own.

## Where new code goes

The rule: **everything of ours lives in folders prefixed `openide`**, so that a
`git grep openide` answers "what did we add".

```
vscode/src/vs/
  workbench/contrib/openideAgent/     the agent, chat, Project Map, styles
    common/                            pure logic, no DOM  → testable
    browser/                           widgets and UI services
    test/                              tests that run in Chromium
  workbench/contrib/openideSettings/  our own Settings screen
  platform/openideBrowser/            native browser automation
    common/                            shared contract
    electron-main/                     the main process (Playwright)
```

The `common/` vs `browser/` split is not decorative: `common/` cannot import DOM
or services, so it can be tested without starting a browser. When something can
be expressed as a pure function, it goes there.

**Touching an upstream file is a decision, not an accident.** Each of those 511
files is extra work at every update. Before editing one, ask whether the change
could live in an `openide*` folder and hook in through a registry (a
`registerSingleton`, a `registerAction2`, a view contribution). It almost always
can.

## Updating Code OSS

The anchor is `openide-version.json`:

```json
"codeOss": { "version": "1.121.0", "commit": "987c9597..." }
```

That commit is **which upstream version this tree came from**. Without it there
would be no way to compute the delta.

`dev/sync-codeoss.sh` does the work:

1. Reads the current commit from `openide-version.json`.
2. Fetches the target commit from `microsoft/vscode`.
3. Computes the upstream delta: `git diff <current> <target>`.
4. Applies it with `git apply --3way --directory=vscode`.

The `--3way` is the important part: it performs a three-way merge, so it
**preserves your changes** and leaves an explicit conflict wherever it cannot
decide. It is what `git merge` does, but against a tree that shares no history
with yours.

It runs on its own every Monday (`.github/workflows/sync-codeoss.yml`) and opens
a PR. The workflow also compiles, so a green PR means the merge did not break the
build — not that the functionality still works.

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

**The pre-commit hook** (husky) runs VS Code's *hygiene* over what you are about
to commit. It requires **tabs** for indentation and forbids trailing whitespace.
If a commit is rejected with hundreds of "Bad whitespace indentation", this is
why: fix the indentation, do not reach for `--no-verify`.

**The audits** (`dev/audit-*.mjs`) are invariants that each cost a debugging
session once, written so they do not happen again:

- `audit-surface-tokens.mjs` — that `--oi-*` tokens are declared where the theme
  publishes its variables. They were once declared only on `:root`, and every
  native surface ran for months on the fallbacks without anyone noticing.
- `audit-branding.mjs` — that no VSCodium or Microsoft branding leaks into what
  gets distributed.
- `audit-comment-language.mjs` — language consistency in comments.
- `audit-version-consistency.mjs` — that the two versions and the update signing
  key agree across `openide-version.json`, `package.json` and both `product.json`.

**CI** (`.github/workflows/ci-openide.yml`) runs the audits, compiles, and runs
the tests: the signed updater contract, the agent in Node and the agent in
Chromium.

## The update channel

OpenIDE updates itself, and that is attack surface: if someone can convince the
IDE to download a binary, they run code on your machine. That is why the manifest
is Ed25519-signed (`updater.publicKey` in `openide-version.json`) and
`openideUpdateManifest.ts` additionally validates:

- that the URL is HTTPS, with no username or password;
- that the host is on the allowlist;
- that the **path** belongs to this repository (a regex against
  `/Niiihuel/openide/...`);
- the size and the `sha256` of the artifact.

If you move the repository to another account, that regex has to be updated or
the updater rejects every legitimate release. It fails closed, which is the right
direction, but silently.

## Checking without waiting for CI

```bash
# Typecheck the tree (native TypeScript 7)
cd vscode && node node_modules/@typescript/native/bin/tsc \
  --project ./src/tsconfig.json --noEmit --skipLibCheck

# Transpile to out/ (tests run against out/, not src/)
npx tsx build/next/index.ts transpile

# Agent tests in Chromium
node test/unit/browser/index.js --browser chromium --grep Openide

# Launch the IDE and take screenshots
node dev/visual-check.mjs --open=usage
```

On NixOS all of that goes inside `./result-fhs/bin/openide-build -c "..."`.

See [BUILD.md](../BUILD.md) for the full build and packaging.
