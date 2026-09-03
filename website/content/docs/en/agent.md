---
title: The agent
description: What the integrated agent is, how the operating modes differ and how a conversation flows from request to reviewed commit.
---

The OpenIDE agent is a native workbench contribution, not an extension. It lives in `vscode/src/vs/workbench/contrib/openideAgent/` and runs with the same access the editor has: files, terminals, the language server index, git, a local browser and the settings UI. Because it is part of the product it can offer surfaces an extension cannot, such as a plan editor, a canvas editor and a persistent memory of your codebase.

## Where it lives

The chat opens in the right dock (the auxiliary bar). Run **OpenIDE: New Chat** from the Command Palette or click the agent icon. Each conversation is a session; you can fork one with **OpenIDE: Fork Chat** to explore an alternative without losing the original thread.

The header of the chat shows the active provider and model. Use **OpenIDE: Select Provider** to switch; see [Providers](/docs/agent-providers/).

## Operating modes

| Mode | What the agent does | When to use it |
| --- | --- | --- |
| **Agent** | Executes: reads, edits, runs commands and delegates to subagents when a task is clear. | A concrete change you want done. |
| **Plan** | Read-only. Produces a complete implementation plan that you review before any code is written. | Larger or risky changes, anything you want to design first. |
| **Ask** | Read-only. Answers questions using the reading tools, without editing. | Understanding code, getting explanations. |
| **Fork** | Branches the current conversation into a new session with the same context. | Trying an alternative approach. |

The agent can also suggest a better mode for the current request: when a message in *Ask* mode really asks for a change, it offers to switch to *Agent* with the request already scoped.

## From request to commit

1. **Context.** The agent reads the project map from [codebase memory](/docs/agent-workspace/#codebase-memory), the skills that apply, the always-on rules and whatever you attached (files, selections, Pick & Polish elements).
2. **Work.** In *Agent* mode it edits files and runs commands with the [workspace tools](/docs/agent-workspace/). Long tasks can be delegated to subagents with isolated permissions and, optionally, their own git worktrees.
3. **Review.** Before anything is committed, an adversarial review pass examines the diff of the explicit files with an isolated context and reports problems. The change review view lets you step through blocks (*Next block*, *Previous block*) and accept or roll back atomically.
4. **Commit.** The safe git flow produces atomic commits; nothing is pushed without you.

## Context management

Every provider has a context window. As the conversation approaches the limit the agent compacts it automatically, summarizing older turns with a configurable summarization model. You control the input and output token budgets from the settings. Use **OpenIDE: Show Context** to inspect what the model currently sees, and **OpenIDE: Show Usage** for the usage meter of the active provider (`openide.agent.showUsage`, `openide.agent.usage.pollMinutes`).

## Voice

`openide.agent.voiceMode` enables dictation in the composer. The microphone button transcribes into the input; nothing is sent until you submit.

## Notifications

Long tasks notify when they finish. `openide.agent.notifications.sound` toggles the sound; **OpenIDE: Test Notification** previews it.

## Quick commands

Reusable prompts live in `.openide/quick-commands.json` and appear as commands (`openide.agent.runQuickCommand`). Create them from the settings UI (*Commands* section) or by editing the file.

## Extending the agent

MCP servers, shell hooks, skills, rules and custom subagents are covered in [Extensibility](/docs/agent-extensibility/).
