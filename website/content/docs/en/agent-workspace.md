---
title: Workspace tools
description: Files, commands, codebase navigation, git flow, the localhost preview, Pick & Polish, plans, canvas and codebase memory.
---

Because the agent runs inside the workbench, its tools are native services rather than shell scripts. This page describes what it can touch and the surfaces built on top of that.

## Files and commands

- **Reading and editing files** goes through the editor's file service, so edits show up as diffs you can review block by block before accepting.
- **Running commands** uses an integrated terminal. Output is captured for the model; long-running processes can be stopped from the chat.
- **Approvals.** Actions that leave the workspace or are hard to undo ask for consent. Your answers can be remembered per project.

## Codebase navigation

The agent does not grep blindly. It queries the **Project Map**, an index built from the language server (symbols, references, imports) and persisted under `.openide/`. Two tools sit on top of it:

- A fast symbol search by name, optionally filtered by kind (class, function, method, interface).
- An impact analysis that reports direct and transitive dependents and related tests before a symbol is modified.

When the index has no answer the agent falls back to textual search; `openide.memory.enableRegexFallback` controls that.

## Git flow

The safe git flow produces atomic commits: one logical change per commit, staged from the explicit files the agent touched. Subagents can work in isolated worktrees (`openide.subagents.useWorktrees`) so parallel work never collides on the working copy. Nothing is pushed or force-pushed by the agent.

## Localhost preview

**OpenIDE: Local Preview** (`openide.localPreview`) opens an integrated browser for your running app. The agent can:

- take screenshots and accessible snapshots of the page,
- open DevTools,
- interact with the visible preview through Playwright (click, type, navigate).

Only hosts listed in `openide.agent.browserAllowedHosts` can be opened. The automation runs in the main process (`platform/openideBrowser`) with the same page you see.

## Pick & Polish

Run **OpenIDE: Pick Element** (`openide.agent.pickElement`) and click an element in the preview. Its selector, HTML, computed styles and a screenshot are attached to the chat, so you can ask for a visual change with the exact element in context. This is the fastest way to refine UI details.

## Plans

*Plan* mode writes a complete implementation plan to `.openide/plans/<slug>.md`. Plans open in a dedicated editor (**OpenIDE: Open Plan**, `openide.plan.open`) with:

- interactive tasks you can check off,
- a per-plan model selection for execution (`openide.plan.execModel`),
- a *Build* action that starts executing the plan in *Agent* mode (`openide.plan.build`).

Plans are Markdown, so they can be reviewed in a pull request like any other file.

## Canvas

A canvas is a visual analytical artifact stored as `.openide/canvases/<name>.canvas.tsx`. It can hold tables, charts and standalone diagrams built from data the agent gathered. Open one with **OpenIDE: Open Canvas** (`openide.canvas.open`). Diagrams can be expanded to full screen (`openide.diagram.fullscreen`), and the *Architecture map* command (`openide.archmap.project`) produces a diagram of the project structure.

## Codebase memory

OpenIDE keeps two kinds of memory:

- **Durable facts** in `.openide/MEMORY.md`: conventions, decisions and preferences the agent stores with your consent and re-reads in every session. Project-level facts are versioned with the repository; user-level facts stay in your profile.
- **The code graph**, a persistent index of entities and relationships in the project. **OpenIDE: Open Memory** (`openide.memory.open`) shows it as a 3D WebGL graph. `openide.memory.include`, `openide.memory.exclude` and `openide.memory.indexTests` control what is indexed; `openide.memory.indexOnOpen` rebuilds on startup, and **OpenIDE: Rebuild Memory** forces a rebuild. `openide.memory.persistIndex` keeps the index on disk between sessions.

The heavy indexes live in `.openide/memory-indexes/` and `.openide/codegraph/`, which are ignored by git. Hand-written content (`MEMORY.md`, skills, plans) is versioned.

## Change review

Every edit made by the agent lands in the change review view. Step through blocks with *Next block* and *Previous block*, accept the ones you want and roll back the rest. Message-level rollback restores the workspace to the state before a given turn, atomically.
