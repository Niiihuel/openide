---
title: Privacy
description: What OpenIDE sends over the network, what it never sends, and who receives what you type into the agent.
---

OpenIDE does not embed Microsoft's proprietary telemetry endpoints. Update checks query exclusively the signed feed of the `Niiihuel/openide` repository and GitHub Releases. Only the technical data required for HTTP is sent (product version, operating system and architecture in the User-Agent); prompts, code, workspace contents, credentials and personal identifiers are never included.

## What talks to the network

| Connection | Purpose | How to disable |
| --- | --- | --- |
| Update feed on GitHub | Check for new signed releases | `update.mode`: `manual` or `none` |
| Open VSX | Search, install and update extensions | `extensions.autoCheckUpdates`, `extensions.autoUpdate` |
| Extension control list | Definitions of malicious and deprecated extensions | `extensions.excludeUnsafes` (not recommended) |
| Welcome page announcements | News fetched from the repository | `workbench.welcomePage.extraAnnouncements` |
| AI providers | Only the providers you enable, only for the chat you are using | Remove the provider |
| MCP servers, hooks, web tools | Only what you configure and approve | See [Extensibility](/docs/agent-extensibility/) |

The [Telemetry](/docs/telemetry/) page lists the settings that are turned off by default and how to verify that nothing else is sent.

## AI providers and extensions

The AI providers and the installed extensions have their own policies and connections. OpenIDE shows and manages the credentials locally, but the use of each provider is governed by its terms. When you send a message, the agent transmits the prompt, the parts of the workspace it needs (files it reads, command output, screenshots of the preview) and the tool results to the provider selected for that conversation, and to nobody else.

Web exploration by the agent (`web_search`, `web_fetch`) goes through a separate headless downloader that does not share cookies, sessions or credentials with the visible browser, and whose results are not persisted outside the model transcript.

## Credentials

API keys and OAuth tokens are stored in the operating system keychain through `SecretStorage`. They never appear in `settings.json`, so settings sync does not carry them.

## Local data

Everything the agent learns about your project stays in the project: `.openide/MEMORY.md`, plans, canvases and skills are files you can read, edit and delete. The derived indexes under `.openide/memory-indexes/` and `.openide/codegraph/` are ignored by git and can be rebuilt at any time.

## Reporting a concern

If you believe OpenIDE contacts a service it should not, open an issue on the [repository](https://github.com/Niiihuel/openide/issues) with the host and the context. Network privacy is one of the invariants tracked by the [reliability gates](/docs/reliability/).
