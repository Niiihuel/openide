---
title: Getting started
description: Install OpenIDE, open your first project and meet the integrated agent.
---

OpenIDE is a distribution of Visual Studio Code built on a freely-licensed Code OSS base. If you already know VS Code you already know the editor: the same architecture, the same keyboard shortcuts and the same extension ecosystem. What is new is the agent that ships inside the product.

## Install

Builds are published on [GitHub Releases](https://github.com/Niiihuel/openide/releases) for Linux and Windows. The [installation guide](/docs/installation/) covers every format (AppImage, tarball, Windows installer) and the NixOS wrapper.

macOS is not published yet. The code builds and runs there, but a signed and notarized release needs an Apple Developer ID. Building it yourself from source works; see [Building OpenIDE](/docs/building/).

## First steps

1. **Open a folder.** Use *File > Open Folder* to open your project.
2. **Install extensions.** Click the Extensions icon in the activity bar. The gallery is [Open VSX](https://open-vsx.org/) by default; see [Extensions](/docs/extensions/) for alternatives.
3. **Open the agent.** The chat lives in the right dock. Run *OpenIDE: New Chat* from the Command Palette or use the agent icon in the auxiliary bar.
4. **Connect a provider.** Run *OpenIDE: Open Providers* and sign in with OAuth or paste an API key. Credentials are stored in the system keychain through `SecretStorage`, never in `settings.json`. Details in [Providers](/docs/agent-providers/).
5. **Ask for something.** Start in *Agent* mode for a concrete change, or *Plan* mode to design first. The [Agent](/docs/agent/) page explains every mode.

## Basic usage

OpenIDE works just like Visual Studio Code, with a few differences:

- It uses Open VSX for extensions by default instead of the Visual Studio Marketplace.
- It does not include Microsoft telemetry or branding.
- Some proprietary Microsoft extensions refuse to run outside the official build; see [Extensions compatibility](/docs/extensions-compatibility/).
- The AI assistant is part of the workbench. It has native access to files, terminals, the language server index, a local browser preview and git.

## Keyboard shortcuts

A few shortcuts to get you going:

| Action | Linux / Windows | macOS |
| --- | --- | --- |
| Quick Open, go to file | `Ctrl+P` | `Cmd+P` |
| Command Palette | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| User settings | `Ctrl+,` | `Cmd+,` |
| Keyboard shortcuts editor | `Ctrl+K Ctrl+S` | `Cmd+K Cmd+S` |

The full map is compatible with Code OSS; see [Keyboard shortcuts](/docs/keyboard-shortcuts/).

## Next steps

- Read [Usage](/docs/usage/) for portable mode, terminal integration and everyday questions.
- Learn how [updates](/docs/updates/) are signed and applied.
- Moving from VS Code? Follow the [migration guide](/docs/migration/).
- Something broken? Check [Troubleshooting](/docs/troubleshooting/).
- Want to help? Read the [contributing guide](/docs/contributing/) and join the [discussions](https://github.com/Niiihuel/openide/discussions).
