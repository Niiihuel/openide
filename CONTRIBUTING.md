# Contributing to OpenIDE

Thanks for taking the time to contribute!

- [Code of Conduct](#code-of-conduct)
- [Use of AI](#use-of-ai)
- [Reporting bugs](#reporting-bugs)
- [How the repository is laid out](#how-the-repository-is-laid-out)
- [Setting up](#setting-up)
- [Making a change](#making-a-change)
- [Validating your change](#validating-your-change)
- [Opening a pull request](#opening-a-pull-request)

## Code of Conduct

This project and everyone participating in it is governed by the
[OpenIDE Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are
expected to uphold this code.

## Use of AI

We welcome use of AI tools to help draft discussions, issues, or code, but
please follow these rules:

- Use AI tools responsibly and disclose their use.
- Ensure all content passes a human review for authenticity and quality.
- Be concise. Do not write verbose discussions, issues or pull requests.

Discussions, issues or pull requests that consist solely of unvetted AI output
may be closed at the maintainer's discretion.

## Reporting bugs

Before opening an issue, check the [existing issues][issues] and the
[troubleshooting page](./docs/troubleshooting.md) — you may find that you don't
need to file one.

When you do file a bug, fill out the [bug report template][new-issue] and
include as many details as you can. The information it asks for is what makes a
bug reproducible.

## How the repository is laid out

**OpenIDE keeps its full source tree in `vscode/`. That folder is the source of
truth: you edit it directly, and no build command ever resets, replaces, or
regenerates it.**

This matters because OpenIDE started as a fork of VSCodium, which customizes
VS Code by applying a stack of `.patch` files at build time. OpenIDE does not
do that anymore. There is no `patches/` directory, no patch script, and no
"regenerate the patch after editing" step. If you find documentation or tooling
that still describes a patch workflow, it is stale — please report it.

OpenIDE carries two version numbers, declared together in `openide-version.json`:

| | Where it lives | What it is for |
| --- | --- | --- |
| **Product version** | `product.json.openideVersion` | What OpenIDE calls itself: installer names, update feed, About dialog. Currently `1.0.0`. |
| **VS Code API version** | `vscode/package.json.version` | The extension API this build implements. Every `engines.vscode` range is validated against it, so it tracks Code OSS. Currently `1.121.0`. |

Neither is edited by hand in those files — `build.sh` derives both from
`openide-version.json`, and `dev/audit-version-consistency.mjs` fails the build
if the committed tree drifts. Putting the product version in `package.json`
would make the editor claim an API level it does not implement, and the
extension gallery would stop serving it anything built for current VS Code.

Code that belongs to OpenIDE rather than to upstream VS Code lives in:

| Path | What it holds |
| --- | --- |
| `vscode/src/vs/workbench/contrib/openideAgent/` | The agent engine, chat UI, providers, tools, subagents, MCP, skills and codebase memory |
| `vscode/src/vs/workbench/contrib/openideSettings/` | The OpenIDE settings surfaces |
| `vscode/src/vs/workbench/contrib/openideUpdate/` | Update UI |
| `vscode/src/vs/platform/openideAgentHost/` | Agent host running in the main process |
| `vscode/src/vs/platform/openideBrowser/` | Browser automation service |
| `vscode/src/vs/platform/update/openide*` | Signed update manifest, verifier and AppImage updater |

Everything else under `vscode/` is upstream VS Code source. Prefer keeping your
changes inside the OpenIDE-owned paths above; touching upstream files is
sometimes necessary, but each such change is one more thing to reconcile when
Code OSS is updated, so keep them small and obvious.

## Setting up

Node is pinned in [`.nvmrc`](.nvmrc). You also need `git`, `jq`, `python3` and
`rustup`, plus the platform build dependencies listed in
[the build guide](./BUILD.md).

```sh
git clone https://github.com/Niiihuel/openide.git
cd openide/vscode
npm ci
```

On NixOS, use the FHS sandbox instead of installing dependencies globally — see
[BUILD.md](./BUILD.md).

## Making a change

Compile the TypeScript and launch a development instance:

```sh
cd vscode
npm run compile
./scripts/code.sh
```

For an incremental loop, run `npm run watch` in a second terminal and restart
`./scripts/code.sh` when you need a fresh window.

The development instance keeps its own profile in `~/.config/code-oss-dev`, so
it will not disturb an installed copy of OpenIDE.

### Layering rules

The source is split into `common/`, `browser/`, `node/` and `electron-*/`
layers, and the split is enforced:

- `common/` must not import from any other layer. Keep pure logic here — it is
  also the easiest layer to unit test.
- `browser/` may import `common/`, and may use DOM APIs.
- `node/` and `electron-*/` may import `common/`, and may use Node APIs.

Run `npm run valid-layers-check` to verify. A layering violation will fail CI.

New logic that can be expressed without DOM or Node access belongs in `common/`
with a test next to it in `test/common/`.

### Language

Code, comments and documentation are written in English.

Parts of the codebase still carry Spanish comments from before that rule
existed. They are being translated, and
[`dev/comment-language-allowlist.json`](dev/comment-language-allowlist.json)
tracks what is left, per file. It works as a ratchet: a file may never exceed
its recorded budget, so the debt can only shrink.

```sh
node dev/audit-comment-language.mjs                 # check (CI runs this)
node dev/audit-comment-language.mjs --list <path>   # show what is pending in a file
node dev/audit-comment-language.mjs --update        # after translating, lower the budgets
```

If you touch a file that still has pending lines, translating them as you go is
welcome — just run `--update` so the allowlist reflects the new total.

## Validating your change

Run what CI runs, in this order. From the repository root:

```sh
# 1. Reliability gates — invariants that must hold before a release
node dev/check-reliability-gates.mjs
node --test dev/reliability-gates.test.mjs

# 2. Branding audit — catches upstream branding leaking into the product
node dev/audit-branding.mjs

# 3. Comment language — code and comments are written in English
node dev/audit-comment-language.mjs
```

Then from `vscode/`:

```sh
# 4. Compile
npm run compile

# 5. Unit tests that run in Node
./node_modules/.bin/mocha --ui tdd --timeout 10000 --exit \
  out/vs/platform/openideAgentHost/test/common/openideAgentHost.test.js \
  'out/vs/workbench/contrib/openideAgent/test/common/*.test.js'

# 6. Unit tests that need a DOM
npm run test-browser-no-install -- \
  --runGlob 'vs/workbench/contrib/openideAgent/test/browser/*.test.js' \
  --browser chromium
```

If your change affects the UI, also verify it in a real product window —
compiling is not evidence that a surface renders correctly.

If your change touches an invariant covered by
[`dev/reliability-gates.json`](dev/reliability-gates.json) — updates, chat
rollback, subagent permissions and similar — read
[docs/reliability.md](./docs/reliability.md) first. Those gates have explicit
promotion and demotion rules, and weakening one is a reviewable decision, not a
side effect.

A full product build is only needed when you are changing packaging or the
build itself; see [BUILD.md](./BUILD.md).

## Opening a pull request

- Keep the pull request focused on one change. Unrelated cleanups belong in
  their own commit or pull request.
- Explain *why* the change is needed, not only what it does. The diff already
  says what it does.
- State how you verified it — which of the checks above you ran, and whether
  you exercised the change in a real window.
- If you changed behaviour that a user can observe, update the relevant page
  under [`docs/`](./docs/).

[issues]: https://github.com/Niiihuel/openide/issues
[new-issue]: https://github.com/Niiihuel/openide/issues/new?labels=bug&template=bug_report.md
