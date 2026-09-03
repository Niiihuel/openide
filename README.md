<div id="openide-logo" align="center">
  <br />
  <img src="./icons/openide.png" alt="OpenIDE Logo" width="180" />
  <h1>OpenIDE</h1>
  <h3>An open IDE built on VS Code, with an AI agent built into the product.</h3>
</div>

---

## What is OpenIDE?

**OpenIDE** is a distribution of Visual Studio Code built on a freely-licensed
Code OSS base. The goal is a familiar editor that stays compatible with the VS
Code ecosystem, but with an AI agent experience integrated deeply into the
editor itself: the assistant is not an extension, it is part of the product,
with access to native workspace tools, local preview, change review, plans, and
persistent codebase memory.

This repository contains the complete source of OpenIDE. The product is
maintained directly on top of the Code OSS source tree — features, branding and
defaults live in the source and compile without rebuilding the application from
patches.

## Features

### Editor and compatibility

- **VS Code base** — keeps compatibility with the architecture, extensions and
  workflow of VS Code.
- **OpenIDE branding** — its own product name, icons, application identifiers
  and resources.
- **Complete canonical source** — the product code lives in `vscode/`, and a
  build never resets or replaces that tree.
- **Open configuration** — freely-licensed binaries with no Microsoft
  proprietary telemetry, and Open VSX as the extension gallery.

### Integrated agent

The OpenIDE agent lives as a native workbench contribution
(`vscode/src/vs/workbench/contrib/openideAgent/`) rather than an extension:

- **Agent chat** — conversation in the right dock, with operating modes (Agent,
  Plan, Ask, Ultracode, Fork) and adversarial review of changes before
  committing.
- **Multi-provider** — a catalog with OAuth and API keys (Anthropic, OpenAI,
  Gemini Cloud Code, OpenRouter, Codex, and more), plus any OpenAI-compatible
  custom provider (Ollama, corporate proxies). Credentials go to `SecretStorage`,
  never to `settings.json`.
- **Workspace tools** — reading and editing files, running commands, codebase
  navigation backed by the language server index, and a safe git flow with
  atomic commits.
- **Localhost preview** — an integrated browser for local apps, with
  screenshots, accessible snapshots, DevTools, and Playwright-driven interaction
  over the visible preview.
- **Pick & Polish** — visually select elements of your running app (selector,
  HTML, styles and screenshot) and attach them to the chat to refine the UI.
- **Plans** — a design mode before writing code; plans (`.openide/plans/*.md`)
  open in a dedicated editor with interactive tasks and per-plan model
  selection.
- **Canvas** — visual analytical artifacts (`.openide/canvases/*.canvas.tsx`)
  with tables, charts and standalone diagrams.
- **Codebase memory** — a 3D WebGL graph visualizing project relationships and
  persistent memory across sessions.
- **MCP and hooks** — Model Context Protocol servers (`.openide/mcp.json`) and
  user shell hooks (`.openide/hooks.json`), both behind explicit consent.
- **Skills** — reusable project procedures (`.openide/skills/`) that the agent
  loads and injects automatically when they apply to the task.
- **Context management** — automatic compaction as the model limit approaches,
  with a configurable summarization model and input/output token control.
- **Voice dictation** and **provider fallback** (ordered failover on errors).
- **Markdown QA** — `OpenIDE: Validar Markdown activo` checks the open document
  for unclosed code fences, skipped heading levels and unsafe link schemes, then
  reports a compact structure summary in the OpenIDE Markdown output channel.

### Build and distribution

- **Generic Linux build** — output in `VSCode-linux-x64/`, runnable on NixOS
  through an FHS sandbox.
- **Independent versioning** — OpenIDE has its own version line, separate from
  the Code OSS release it is built on. The editor still reports the upstream VS
  Code API version to extensions, so `engines.vscode` ranges keep resolving
  normally.

## Project status

| Field | Value |
|---|---|
| OpenIDE version | `1.0.0` |
| VS Code API version | `1.121.0` |
| Code OSS base | `1.121.0` |
| Channel | `stable` |

The two versions answer different questions. **OpenIDE version** is what the
product calls itself: it names the installers, drives the update feed, and is
what the About dialog shows. **VS Code API version** is the extension API this
build implements — it is what every extension's `engines.vscode` range is
checked against, so it keeps tracking upstream. Both are declared in
`openide-version.json`; nothing is maintained by hand in `package.json` or
`product.json`.

## Repository layout

| Path | Description |
|---|---|
| `vscode/` | The complete canonical OpenIDE source. |
| `vscode/src/vs/workbench/contrib/openideAgent/` | Integrated agent, chat, tools, providers and custom editors. |
| `dev/` | Tooling, helper scripts and the FHS environment for development and builds. |
| `src/` | Distribution configuration (stable/insider) and release assets. |
| `docs/` | Documentation (installation, extensions, troubleshooting). |
| `build.sh`, `dev/build.sh` | Build orchestration from the canonical source. |
| `product.json` | OpenIDE product identity and configuration. |
| `openide-version.json` | Single source of truth: product version, VS Code API version, channel, Code OSS commit and the update signing key. |
| `BUILD.md` | How to build, run and maintain OpenIDE. |

## Development

The reference guide for compiling and running the product is **[BUILD.md](./BUILD.md)**.

> A build compiles the current state of `vscode/`. It does not run `git reset`,
> does not clone another repository, and does not apply patches.

Quick iteration on NixOS:

```sh
nix-build dev/openide-fhs.nix -o result-fhs
./result-fhs/bin/openide-build -c 'cd vscode && npm run compile'
./result-fhs/bin/openide-build -c 'cd vscode && ./scripts/code.sh'
```

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md) before opening an issue or a pull
request. Responsible use of AI tools to draft discussions or code is accepted,
as long as it passes human review and the use is disclosed.

## Relationship to VS Code and VSCodium

OpenIDE builds on the work of upstream projects:

- [Microsoft VS Code](https://github.com/microsoft/vscode) — the editor base.
- [VSCodium](https://github.com/VSCodium/vscodium) — the reference for
  freely-licensed builds without the proprietary configuration of Microsoft's
  official binaries. OpenIDE began as a fork of VSCodium's build tooling and
  still owes much of its packaging and privacy defaults to that project.

The binaries produced by this repository are built from open sources with the
product configuration defined by OpenIDE.

## License

OpenIDE is MIT licensed, the same license it inherits from Code OSS and
VSCodium. The copyright notices of the upstream projects are kept alongside
OpenIDE's own — see [LICENSE](./LICENSE).
