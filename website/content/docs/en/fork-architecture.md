---
title: Fork architecture
description: Where everything lives and why, how upstream Code OSS updates land, and the guardrails that keep the fork maintainable.
---

OpenIDE is a fork of Code OSS (VS Code without Microsoft's branding and telemetry). This page explains **where each thing lives and why**, because the structure of a VS Code fork does not look like a normal project: most of the tree is not yours, and knowing what is yours and what is upstream's is what makes updating possible.

## The two models, and which one we use

A VS Code fork is maintained in one of two ways.

**With patches** (the VSCodium model). The repository does NOT contain the VS Code code: it contains a `patches/` folder and a script that clones the source at build time. The advantage is that a patch that stops applying *tells you* exactly where upstream changed. The disadvantage is that working this way is uncomfortable: you cannot open the project and edit it, every change is a patch that has to be regenerated.

**Vendored** (ours). The complete Code OSS tree lives in `vscode/` and is edited directly. It is comfortable for development and is what allows having 74,000 lines of our own without losing your mind. The cost is that you lose the automatic warning: nothing tells you what you touched.

OpenIDE uses the **vendored** model. There is no `patches/` folder, and `get_repo.sh` clones nothing; it expects `vscode/` to already be there. That cost is compensated by the tooling in the *Updating* section.

## How the tree is split

Measured over `vscode/src`:

| | Files | What it is |
| --- | --- | --- |
| OpenIDE's own code | 458 | `contrib/openideAgent`, `contrib/openideSettings`, `platform/openideBrowser`, etc. |
| Modified upstream files | 511 | Integrations: the chat in the auxiliary bar, the updater, the branding |
| Rest of Code OSS | ~6,600 | Untouched |

OpenIDE is **6%** of the tree. That number matters: VS Code was not rewritten, it was extended. As long as it stays low, updating remains viable.

There are also 4,200 upstream files **deleted**, of which 4,103 are `extensions/copilot`, the Copilot extension that ships with Code OSS and is redundant here because the agent is native.

## Where new code goes

The rule: **everything of our own lives in folders prefixed `openide`**, so a `git grep openide` answers "what did we add".

```text
vscode/src/vs/
  workbench/contrib/openideAgent/     the agent, the chat, Project Map, styles
    common/                            pure logic, no DOM  → testable
    browser/                           widgets and UI services
    test/                              tests that run in Chromium
  workbench/contrib/openideSettings/  the OpenIDE settings screen
  platform/openideBrowser/            native browser automation
    common/                            shared contract
    electron-main/                     the main process (Playwright)
```

The `common/` vs `browser/` split is not decorative: `common/` cannot import the DOM or services, so it is tested without launching a browser. When something can be expressed as a pure function, it goes there.

**Touching an upstream file is a decision, not an accident.** Each of those 511 files is extra work on every update. Before editing one, ask whether the change can live in an `openide*` folder and hook in through a registry (a `registerSingleton`, a `registerAction2`, a view contribution). It almost always can.

## Updating Code OSS

The anchor is `openide-version.json`:

```json
"codeOss": { "version": "1.121.0", "commit": "987c9597..." }
```

That commit is **which upstream version this tree came from**. Without it there would be no way to compute the delta.

`dev/sync-codeoss.sh` does the work:

1. Reads the current commit from `openide-version.json`.
2. Fetches the target commit from `microsoft/vscode`.
3. Computes the upstream delta: `git diff <current> <target>`.
4. Applies it with `git apply --3way --directory=vscode`.

`--3way` is the important part: it performs a three-way merge, so it **keeps your changes** and, where it cannot decide, leaves an explicit conflict for you to resolve by hand. It is what `git merge` does, but against a tree that shares no history with yours.

It runs on its own every Monday (`.github/workflows/sync-codeoss.yml`) and opens a PR. The workflow also compiles, so a green PR means the merge did not break compilation, not that the functionality still works.

After an update, `version` becomes `<major>.<minor>.0` of Code OSS and the third number is the OpenIDE revision: `1.121.1` is revision 1 on top of the Code OSS 1.121 API.

## The guardrails

Three layers, from fastest to slowest.

**The pre-commit hook** (husky) runs VS Code's *hygiene* over what you are about to commit. It requires **tabs** for indentation and forbids trailing whitespace. If a commit is rejected with hundreds of "Bad whitespace indentation", this is it: fix the indentation, do not use `--no-verify`.

**The audits** (`dev/audit-*.mjs`) are invariants that each cost a debugging session, written so they never happen again:

- `audit-surface-tokens.mjs`: the `--oi-*` tokens are declared where the theme publishes its variables. They were once declared only on `:root` and every native surface ran for months on the fallbacks without anyone noticing. See [Surfaces and themes](/docs/theming-surfaces/).
- `audit-branding.mjs`: no VSCodium or Microsoft branding leaks into what is distributed.
- `audit-comment-language.mjs`: language consistency in comments.

**CI** (`.github/workflows/ci-openide.yml`) runs the audits, compiles and executes the tests: signed updater contract, agent in Node and agent in Chromium.

## The update channel

OpenIDE updates itself, and that is attack surface: if someone can convince the IDE to download a binary, they run code on your machine. That is why the manifest is signed with Ed25519 (`updater.publicKey` in `openide-version.json`) and `openideUpdateManifest.ts` additionally validates:

- that the URL is HTTPS, without user or password;
- that the host is on the allowlist;
- that the **path** belongs to this repository (a regex against `/Niiihuel/openide/...`);
- the size and `sha256` of the artifact.

If the repository moves to another account that regex has to be updated, or the updater rejects every legitimate release. It fails closed, which is the right direction, but silently. See [Updates](/docs/updates/).

## Verifying without waiting for CI

```bash
# Typecheck the tree (native TypeScript 7)
cd vscode && node node_modules/@typescript/native/bin/tsc \
  --project ./src/tsconfig.json --noEmit --skipLibCheck

# Transpile to out/ (tests run on out/, not on src/)
npx tsx build/next/index.ts transpile

# Agent tests in Chromium
node test/unit/browser/index.js --browser chromium --grep Openide

# Launch the IDE and take screenshots
node dev/visual-check.mjs --open=usage
```

On NixOS all of that goes inside `./result-fhs/bin/openide-build -c "..."`. See [Building OpenIDE](/docs/building/) for the full build and packaging.
