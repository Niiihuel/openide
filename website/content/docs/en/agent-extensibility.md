---
title: MCP, hooks, skills and subagents
description: Extend the agent with Model Context Protocol servers, shell hooks, project skills, always-on rules and custom subagents, all behind explicit consent.
---

Everything on this page lives under `.openide/` in your project (or in your user profile) and is opt-in. The agent never runs a server, a hook or a subagent you have not approved.

## MCP servers

Model Context Protocol servers are declared in `.openide/mcp.json`. Add one from the settings UI (*MCP* section) or with **OpenIDE: Add MCP Server**; **OpenIDE: Reload MCP** (`openide.agent.reloadMcp`) restarts them after editing the file. `openide.agent.mcp.enabled` turns the feature on and off globally.

Each server is started with an allowlisted environment: `NODE_OPTIONS`, loaders, `NODE_PATH` and CA overrides are blocked, arguments and environment values are validated, JSON-RPC frames and HTTP/SSE responses have size limits, and the process tree is cleaned up on disconnect, timeout or shutdown. Workspace Trust gates the project configuration: an untrusted folder cannot start servers.

Tools exposed by a server appear in the agent's catalog with their exact name. OpenIDE itself can be registered as an MCP server for other tools (`openide.ide.registerMcp`), and the diagrams service can be exported as an MCP configuration (`openide.agent.copyDiagramsMcpConfig`).

## Hooks

User shell hooks in `.openide/hooks.json` run at defined points of the agent lifecycle (before a tool runs, after an edit, when a session ends). Each hook must be **approved** explicitly the first time it is seen (`openide.hooks.approve`) and can be revoked at any time (`openide.hooks.revoke`). Input and output of a hook are bounded, and a hook that fails does not silently block the agent.

Hooks written for other agent CLIs can be reused: the `.openide/agent-hooks/` directory holds adapters (for example `.openide/agent-hooks/claude/`).

## Skills

A skill is a reusable project procedure stored as `.openide/skills/<name>/SKILL.md`: a one-line description with keywords plus the full instructions. The agent indexes skills at the start of a session and **injects the ones that apply** to the current task automatically; you can also select one explicitly from the composer.

Create skills from the settings UI (*Skills* section) or ask the agent to save a procedure it just followed. Names are kebab-case. `openide.agent.disabledSkills` turns individual skills off without deleting them. Skills can also be installed from a catalog (`openide.skills.install`).

## Rules

Rules are always-on Markdown files in `.openide/rules/` that the agent reads on every turn: coding standards, forbidden patterns, review checklists. Create one with **OpenIDE: New Rule** or from the settings UI. Keep them short; long rules cost context on every message.

## Subagents

The agent can delegate a specialized task to a registered subagent with isolated permissions and, optionally, its own git worktree. Definitions live in `.openide/agents/` (project) or in your profile (user) and contain a description, a specialized system prompt and an execution preference (foreground or background).

- `openide.subagents.enabled` turns delegation on.
- `openide.subagents.allowWritable` must be `true` before a subagent that edits files can be created.
- `openide.subagents.maxParallelRuns`, `openide.subagents.maxDepth` and `openide.subagents.defaultTimeoutMinutes` bound the work.
- `openide.subagents.useWorktrees` gives each subagent its own worktree.
- `openide.subagents.routing.*` lets a routing policy pick the subagent automatically (`policy`, `preset`, `maxAttempts`).

Create or edit a subagent with **OpenIDE: Create Subagent** (`openide.subagent.create`) and open its definition with `openide.subagent.openEditor`.

## Web exploration

`web_search` and `web_fetch` use a headless downloader separate from the localhost preview. `openide.agent.web.enabled` turns them on; `openide.agent.web.allowedHosts`, `openide.agent.web.blockedHosts` and `openide.agent.web.allowHttp` scope them, and `openide.agent.web.searchEndpoint` selects the search backend. The downloader validates HTTPS, resolves DNS per hop, blocks loopback, LAN, link-local and metadata addresses, follows redirects manually and caps timeouts and sizes. Results carry citations and nothing is persisted outside the model transcript.

## Workflows

Deterministic multi-agent workflows are declared in `.openide/workflow.json` and used by *Ultracode* mode. They describe phases, the agents that run in each phase and how results are merged.

## Consent model

Every integration above is disabled until you enable it, and project-level configuration is only honoured in a trusted workspace. Approvals are tied to a fingerprint of the command, URL, environment and headers, so a change in any of them asks again.
