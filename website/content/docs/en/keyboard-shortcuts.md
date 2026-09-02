---
title: Keyboard shortcuts
description: OpenIDE keeps the Code OSS keymap, so your muscle memory and every extension keybinding keep working.
---

OpenIDE preserves the command map compatible with Code OSS and the ecosystem of extensions. Browse and customize every shortcut from **File > Preferences > Keyboard Shortcuts** (`Ctrl+K Ctrl+S` on Linux and Windows, `⌘K ⌘S` on macOS).

## Essentials

| Action | Linux / Windows | macOS |
| --- | --- | --- |
| Quick Open, go to file | `Ctrl+P` | `⌘P` |
| Command Palette | `Ctrl+Shift+P` | `⇧⌘P` |
| User settings | `Ctrl+,` | `⌘,` |
| Keyboard shortcuts editor | `Ctrl+K Ctrl+S` | `⌘K ⌘S` |
| Toggle terminal | `` Ctrl+` `` | `` ⌃` `` |
| Toggle sidebar | `Ctrl+B` | `⌘B` |
| Go to symbol in workspace | `Ctrl+T` | `⌘T` |
| Find in files | `Ctrl+Shift+F` | `⇧⌘F` |

## Agent commands

The agent registers its actions as regular commands, so you can bind any of them from the Keyboard Shortcuts editor. Search for `OpenIDE` in the editor to list them. Useful ones:

| Command | What it does |
| --- | --- |
| `openide.agent.newChat` | Start a new chat in the right dock |
| `openide.agent.forkChat` | Fork the current conversation |
| `openide.agent.selectProvider` | Pick the active provider and model |
| `openide.agent.openProviders` | Open the providers settings |
| `openide.agent.pickElement` | Start Pick & Polish on the local preview |
| `openide.localPreview` | Open the localhost preview |
| `openide.plan.open` | Open a plan in the plan editor |
| `openide.canvas.open` | Open a canvas |
| `openide.memory.open` | Open the codebase memory graph |
| `openide.markdown.validate` | Validate the active Markdown document |

## Importing your keybindings

Your `keybindings.json` from VS Code can be copied as-is into the OpenIDE user folder. See [Migration](/docs/migration/).
