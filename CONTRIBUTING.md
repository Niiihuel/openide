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
bug reproducible. Security problems go through
[SECURITY.md](SECURITY.md), not the issue tracker.

## How the repository is laid out

**OpenIDE keeps its full source tree in `vscode/`. That folder is the source of
truth: you edit it directly, and no build command ever resets, replaces, or
regenerates it.**

This matters because OpenIDE started as a fork of VSCodium, which customizes
VS Code by applying a stack of `.patch` files at build time. OpenIDE does not
do that: there is no `patches/` directory and no "regenerate the patch after
editing" step. The only trace left is a guarded `apply_patch` helper in
`utils.sh` that the Linux packaging scripts would call if a `patches/linux/`
directory existed; none does, and no feature depends on it. If you find
documentation that still describes a patch workflow, it is stale — please
report it. [docs/fork-architecture.md](./docs/fork-architecture.md) explains
the model in depth and how upstream updates land.

OpenIDE carries two version numbers, declared together in `openide-version.json`:

| | Where it lives | What it is for |
| --- | --- | --- |
| **Product version** | `product.json.openideVersion` | What OpenIDE calls itself: installer names, update feed, About dialog. Currently `1.3.0`. |
| **VS Code API version** | `vscode/package.json.version` | The extension API this build implements. Every `engines.vscode` range is validated against it, so it tracks Code OSS. Currently `1.136.1`. |

Neither is edited by hand in those files — `build.sh` derives both from
`openide-version.json`, and `dev/audit-version-consistency.mjs` fails the build
if the committed tree drifts. Putting the product version in `package.json`
would make the editor claim an API level it does not implement, and the
extension gallery would stop serving it anything built for current VS Code.

Code that belongs to OpenIDE rather than to upstream VS Code lives in:

| Path | What it holds |
| --- | --- |
| `vscode/src/vs/workbench/contrib/openideAgent/` | The agent engine, chat UI, providers, tools, subagents, MCP, skills, hooks, plans, canvases, diagrams, Project Map and inline completion |
| `vscode/src/vs/workbench/contrib/openideSettings/` | The OpenIDE Settings surfaces |
| `vscode/src/vs/workbench/contrib/openideDialogs/` | Modal dialogs used by the OpenIDE surfaces |
| `vscode/src/vs/workbench/contrib/openideUpdate/` | Update UI, signed manifest handling and the AppImage updater |
| `vscode/src/vs/workbench/contrib/update/browser/updateTitleBarEntry.ts` and `openideUpdateAnnouncement*` | Title-bar update indicator and popover |
| `vscode/src/vs/platform/openideAgentHost/` | Agent host and IDE/MCP bridge running in the main process |
| `vscode/src/vs/platform/openideBrowser/` | Browser automation service (Playwright over the visible preview) |
| `vscode/src/vs/platform/update/**/openide*` | Signed update manifest parser, verifier and AppImage updater tests |
| `vscode/src/vs/code/common/openideCodebase*` | Codebase graph data model and authored notes |
| `vscode/extensions/github-authentication/` | Upstream extension modified to use OpenIDE's own GitHub OAuth app |
| `dev/`, `build/`, the root `*.sh` | Build, packaging, release-feed and audit tooling |

Everything else under `vscode/` is upstream VS Code source, including
`vscode/README.md`, `vscode/CONTRIBUTING.md`, `vscode/SECURITY.md` and
`vscode/AGENTS.md`, which are left verbatim so upstream syncs do not conflict on
them. Prefer keeping your changes inside the OpenIDE-owned paths above; touching
upstream files is sometimes necessary, but each such change is one more thing
to reconcile when Code OSS is updated, so keep them small and obvious.

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
[BUILD.md](./BUILD.md#building-on-nixos).

## Making a change

Compile the TypeScript, build the bundled extensions and launch a development
instance. This is the same loop BUILD.md and CI use:

```sh
cd vscode
npm run typecheck-client
npm run gulp copy-codicons
npm run transpile-client
npm run gulp compile-extensions compile-extension-media
npm run electron                          # downloads Electron the first time
VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh
```

For an incremental loop, run `npm run watch` in a second terminal and restart
`./scripts/code.sh` when you need a fresh window. `npm run compile` is the
upstream all-in-one equivalent of the typecheck and transpile steps.

The development instance keeps its own profile in `~/.config/code-oss-dev`, so
it will not disturb an installed copy of OpenIDE. Development builds never
check for updates.

### Layering rules

The source is split into `common/`, `browser/`, `node/` and `electron-*/`
layers, and the split is enforced:

- `common/` must not import from any other layer. Keep pure logic here — it is
  also the easiest layer to unit test.
- `browser/` may import `common/`, and may use DOM APIs.
- `node/` and `electron-*/` may import `common/`, and may use Node APIs.

Run `npm run valid-layers-check` to verify. Note that the checker currently
reports pre-existing OpenIDE browser-layer imports of `IMainProcessService`;
do not add new violations on top of those.

New logic that can be expressed without DOM or Node access belongs in `common/`
with a test next to it in `test/common/`.

### Language

Code, comments and documentation are written in English. User-facing strings
in OpenIDE's own surfaces are bilingual: add both the `en` and the `es` entry
in `openideStrings.ts` or `openideSettingsStrings.ts`, never a literal in one
language.

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

### Hygiene

Upstream's hygiene check (tabs for indentation, no trailing whitespace, license
headers) runs as `npm run precommit` from `vscode/`. A husky-generated
`pre-commit` hook in `.git/hooks` runs it on commit in the maintainer's clone;
that hook is not versioned, so run the command yourself before pushing if your
clone does not have it. A commit rejected with "Bad whitespace indentation" is
this check: fix the indentation, do not reach for `--no-verify`.

## Validating your change

Run what CI runs. The authoritative list is
[`.github/workflows/ci-openide.yml`](.github/workflows/ci-openide.yml); this
is the same sequence, grouped so you can run the part your change touches.

From the repository root — the audits and the tooling tests, all fast:

```sh
node dev/check-reliability-gates.mjs && node --test dev/reliability-gates.test.mjs
node --test dev/verify-release-feed.test.mjs
node --test dev/codeoss-sync.test.mjs
node dev/audit-version-consistency.mjs
node dev/audit-branding.mjs
node dev/audit-comment-language.mjs
node dev/audit-prompt-language.mjs
node dev/audit-fork-localize.mjs
node dev/audit-surface-tokens.mjs && node --test dev/audit-surface-tokens.test.mjs
node dev/audit-production-regex.mjs
node dev/audit-script-permissions.mjs
```

From `vscode/` — compile, then the test groups:

```sh
# Compile
npm run typecheck-client
npm run gulp copy-codicons && npm run transpile-client
npm run gulp compile-extensions compile-extension-media && npm run electron

# Signed updater contract
./node_modules/.bin/mocha --ui tdd --timeout 10000 --exit \
  out/vs/platform/update/test/common/openideUpdateManifest.test.js \
  out/vs/platform/update/test/node/openideUpdateVerifier.test.js \
  out/vs/platform/update/test/electron-main/openideAppImageUpdater.test.js

# Binary request transport (voice audio travels through it)
node test/unit/node/index.js --runGlob 'vs/platform/request/test/node/*.test.js'

# Agent host and agent common
./node_modules/.bin/mocha --ui tdd --timeout 10000 --exit \
  out/vs/platform/openideAgentHost/test/common/openideAgentHost.test.js \
  'out/vs/workbench/contrib/openideAgent/test/common/*.test.js'

# Repository contracts: every declared setting is read, the Settings search
# index points at live surfaces, layout and CSS agree. They read the whole tree,
# hence the longer timeout.
./node_modules/.bin/mocha --ui tdd --timeout 30000 --exit \
  'out/vs/workbench/contrib/openideAgent/test/node/*.test.js'

# Agent browser tests (Chromium; `npx playwright install --with-deps chromium` once)
npm run test-browser-no-install -- \
  --runGlob 'vs/workbench/contrib/openideAgent/test/browser/*.test.js' \
  --browser chromium

# Electron tests: integrated browser, updater lifecycle, update popover
.build/electron/openide test/unit/electron/index.js --no-sandbox --disable-gpu \
  --runGlob 'vs/workbench/contrib/browserView/test/electron-browser/**/*.test.js'
.build/electron/openide ../dev/test-updater-main.mjs --no-sandbox
.build/electron/openide test/unit/electron/index.js --no-sandbox --disable-gpu \
  --runGlob 'vs/workbench/contrib/update/test/electron-browser/openideUpdateAnnouncement.test.js'
```

From the root, the smoke test that launches the real product with an isolated
profile, opens the chat, preserves a draft and enters Zen mode
(`xvfb-run -a` in front of it on a headless machine):

```sh
node dev/smoke-upgrade.mjs
```

CI also runs `cargo check --locked --bin code` in `vscode/cli`; only do that
locally if you changed the Rust CLI.

If your change affects the UI, also verify it in a real product window —
compiling is not evidence that a surface renders correctly. Colours in
particular need two themes; see
[docs/theming-surfaces.md](./docs/theming-surfaces.md).

If your change touches an invariant covered by
[`dev/reliability-gates.json`](dev/reliability-gates.json) — updates, chat
rollback, agent-host lifecycle, branding — read
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
  under [`docs/`](./docs/). If you added a setting, command or tool, the
  [harness guide](./docs/harness.md) is where it is listed.
- If you touched a file outside the OpenIDE-owned paths, say why it could not
  live in one.

[issues]: https://github.com/Niiihuel/openide/issues
[new-issue]: https://github.com/Niiihuel/openide/issues/new?labels=bug&template=bug_report.md
