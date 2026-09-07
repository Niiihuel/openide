# The OpenIDE harness

This guide describes the implementation shipped in the OpenIDE 1.2.0 source
line: its native agent, memory, tool registry, visual surfaces and external CLI
bridge. Tool availability depends on the active mode, configuration and model
capabilities. A configured provider does not necessarily support tool calling
or audio input.

## From a request to a reviewed change

1. The native agent assembles the conversation, editor context, project and user
   memory, rules, relevant codebase context and the available skill index.
2. The selected provider receives the request and the tools allowed for that
   mode. Plan and Ask filter out native mutation and terminal tools; Agent and
   Debug can work on the project according to the permission policy.
3. Tool calls are routed through the registry and applicable approval and
   workspace checks. Results return to the model and render in the workbench.
4. The agent can continue reading, editing, testing and inspecting the visible
   browser. Tasks, questions, terminal activity and changes have dedicated UI.
5. The user reviews changes. Git preflight and commit tools support an explicit
   file set and configured checks; creating a commit does not push it.

The model chooses actions; the harness supplies execution, context, lifecycle
and presentation. Streaming, context compaction, cancellation and fallback are
part of this runtime. Hosted coding CLIs run their own loops and use the
separate bridge described below.

## Memory, nodes and retrieval

### Authored memory

Project knowledge lives in `.openide/MEMORY.md` in the first workspace folder.
Profile-wide preferences live in `openideAgent/USER.md` under the editor's user
roaming-data directory. The native agent receives a bounded snapshot; the
`memory` tool adds, replaces or removes entries.

Store facts that will help another session: architectural decisions, project
conventions, recurring pitfalls and stable preferences. A useful project note
might be:

```markdown
# Project memory

- `src/payments/checkout.ts` owns checkout orchestration. Keep provider-specific
  request formats inside the payment adapters.
- Run the checkout integration suite when changing retry behavior.
```

These are authored statements, not automatically verified facts. They remain
readable and editable Markdown. Consolidating outdated notes is preferable to
saving a transcript of every task. Project note length is configurable through
`openide.memory.notes.maxChars`.

### Derived codebase graph

The graph is a local, rebuildable index. Its node vocabulary includes workspace,
folder, file, module, package, namespace, class, interface, trait, enum, type,
function, method, constructor, property, field, variable, constant, endpoint,
route, database entity, test, configuration, dependency and note.

Relationships describe containment, definitions, imports/exports, dependencies,
calls, references, usage, inheritance, implementation, overrides, instantiation,
reads/writes, tests, routing, configuration and annotations. The schema supports
more kinds than every language provider can extract: available coverage varies
by language, installed language services and fallback indexing.

Each indexed entity carries its source URI and, where available, a range,
qualified name, signature or documentation. Evidence includes the provider,
confidence, verification status and indexing time. Language-service results can
enrich text/regex discovery, and weaker fallback evidence does not replace
verified relationships. Retrieval reports its index version and staleness so a
caller can decide when to inspect the source again.

Indexing runs through the shared utility process with incremental file updates.
Persistence uses a JSON manifest and per-file JSON records under
`openideAgent/memory-indexes` in the user roaming-data directory, outside the
repository. This is not an embedding database. The index can be rebuilt from
source; disabling persistence removes its disk cache while allowing in-memory
operation.

Relevant settings include `openide.memory.enabled`, `openide.memory.include`,
`openide.memory.exclude`, `openide.memory.indexTests`,
`openide.memory.enableRegexFallback` and `openide.memory.persistIndex`.

### Notes become nodes

The index can ingest entries from `.openide/MEMORY.md` as `note` nodes with
`authored` provenance. Explicit references in backticks or `[[...]]` can create
`ANNOTATES` edges when a file or symbol resolves unambiguously. A note about
checkout can therefore be retrieved alongside the checkout code rather than
only appearing in a flat memory block.

`openide.memory.notes.enabled` controls note indexing.
`openide.memory.notes.linking` selects explicit references, identifier matching
or no linking. An annotation expresses a relationship supplied by an author;
it does not establish that the note is correct.

### Retrieval and learning

`project_map_query` takes a question and an optional `maxTokens` budget. The
current tool defaults to approximately 2,000 tokens and clamps the requested
budget to 500–4,000. It selects relevant entities and relationships, includes
related notes and reports evidence, staleness and truncation. Token sizes are
estimates, not an exact provider tokenizer measurement.

More focused tools find callers, impact, paths and related tests. When the index
cannot answer a question, narrow text searches and source reads remain useful.
The native context-selection path also has its own configurable retrieval
budget; it does not send the entire graph with every request.

Project Map keeps local outcome signals for retrieved entities. Positive and
negative signals can produce `tentative`, `preferred` or `contested` states.
Their influence decays with a 30-day half-life, and stable keys omit line numbers
so moving a function within its file does not immediately lose the signal.
This prioritizes context; it does not train model weights or certify an answer.
These derived signals are separate from authored project notes.

### Scoped project priorities

`codebase_save_priority` stores durable project rules in
`.openide/codegraph/priorities.json`. Each rule can have a priority level and
path/topic scope; relevant rules are included in subsequent codebase exploration.
These explicit rules are separate from the graph's automatic learning signals.

### Visual Project Map

The Project Map editor uses a 2D canvas with community colors, node size based
on connectivity, emphasis on highly connected nodes, search, community filters,
selection, pan, zoom and a minimap. It lets a person inspect the structure that
the retrieval tools use, then navigate back to the relevant code.

## Native tool reference

Names below are the native tool names. They are not a promise that every tool
is sent to every model on every turn. Read-only modes, disabled features,
provider capabilities and MCP configuration affect the exposed set.

### Files, code and terminals

| Tools | Purpose |
|---|---|
| `read_file`, `list_files` | Inspect file content and directory entries. |
| `search_text`, `find_files` | Search content and locate files. |
| `get_diagnostics` | Read editor/language-service diagnostics. |
| `write_file`, `edit_file` | Create or replace content and apply targeted edits. |
| `delete_file`, `rename_file` | Remove or move workspace files. |
| `run_command` | Run commands and report output, exit state or background activity. |
| `terminal_send` | Send input to an existing terminal. |
| `batch_read` | Combine supported read operations into a bounded batch. |
| `codebase_search`, `codebase_explore`, `codebase_callers` | Navigate indexed entities, relationships and callers. |
| `codebase_save_priority` | Save durable project rules with path/topic scope for relevant codebase exploration. |

### Memory and graph

| Tools | Purpose |
|---|---|
| `memory` | Add, replace or remove durable project or user notes. |
| `memory_graph_status` | Inspect the index's state. |
| `project_map_query` | Retrieve a bounded graph/context answer for a question. |
| `memory_graph_impact` | Inspect the potential impact of changing an entity. |
| `memory_graph_path` | Find a relationship path between entities. |
| `memory_graph_related_tests` | Locate tests related through the indexed graph. |

### Work coordination and customization

| Tools | Purpose |
|---|---|
| `update_todos` | Maintain the visible task list and progress. |
| `ask_user` | Request structured input through the chat's question UI. |
| `suggest_mode` | Present a proposed mode change for the user to accept or reject. |
| `delegate_to_subagent` | Assign a task to a configured subagent. |
| `await_subagent`, `cancel_subagent` | Collect or cancel background delegated work. |
| `review_changes` | Request isolated review of the current changes. |
| `list_conversations`, `message_conversation` | Discover and coordinate with other conversations. |
| `skill_view`, `skill_save` | Load a reusable procedure or save one for future tasks. |
| `subagent_save` | Create or update a named subagent definition. |
| `rule_manage` | Manage persistent rules within the applicable authorization checks. |

### Git workflow

| Tools | Purpose |
|---|---|
| `git_status` | Inspect branch and working-tree changes. |
| `git_preflight` | Run the configured checks before committing. |
| `git_commit` | Commit an explicit set of files through the guarded Git workflow. |
| `git_checkpoint` | Compatibility alias for the commit workflow. |
| `workflow_configure` | Configure the project's Git/preflight workflow. |
| `git_configure` | Compatibility alias for workflow configuration. |

### Visible browser and visual evidence

| Tools | Purpose |
|---|---|
| `browser_open`, `browser_navigate` | Open the integrated preview and navigate its page. |
| `browser_snapshot`, `browser_read_dom` | Inspect accessibility structure and DOM content. |
| `browser_screenshot`, `browser_console` | Capture the visible page and inspect console output. |
| `browser_click`, `browser_type` | Interact with the current page. |
| `browser_evaluate`, `browser_set_style` | Evaluate page logic or inspect a temporary style change. |
| `browser_playwright` | Run a self-contained Playwright operation against the integrated browser. |
| `browser_dialog` | Handle page dialogs. |
| `browser_record_start`, `browser_record_mark`, `browser_record_stop` | Record a flow and mark meaningful moments. |
| `browser_check_visual` | Gather heuristic visual findings for review. |

The browser tools operate on the visible preview, with its current session and
login state, subject to allowed-host configuration. This lets both the user and
the agent inspect the same application state. Pick & Polish attaches an element's
selector, HTML, styles and screenshot to a request.

Recordings return a video, contact sheet and keyframes. Findings can point to
motion stalls, flashes, layout shifts, clipping, broken images or other possible
defects. Inspect the evidence before treating a finding as a bug. Temporary
browser style changes are not a replacement for editing the application's
source files.

### Research, plans and artifacts

| Tools | Purpose |
|---|---|
| `web_search`, `web_fetch` | Search the web and retrieve bounded page content for research. |
| `plan_save` | Save a plan for the dedicated plan editor. |
| `canvas_write`, `canvas_read`, `canvas_list`, `canvas_open` | Create, inspect, discover and open visual canvas artifacts. |
| `mcp_call` | Route a call to a configured MCP tool when the compressed catalog is used. |
| `mcp_*` | Dynamically discovered server tools; the concrete names depend on configuration. |

Web research uses a separate fetch path rather than borrowing preview cookies.
It is intended for bounded page retrieval, not general crawling, executing page
JavaScript or bypassing access controls.

Plans live in `.openide/plans/*.md`. Canvas files live in
`.openide/canvases/*.canvas.tsx`, import from `openide/canvas`, and can use
host-themed layout, form, chart, table, wireframe and choice components. Canvas
state can persist across interactions. The runtime restricts imports and network
access; it is a visual artifact surface, not an unrestricted application runtime.

The separate **diagram MCP server** offers `diagram_parse`, `diagram_layout`
and `diagram_kinds`. It exposes the native diagram parser and graph layout to
configured external clients. Supported families include flowchart, state,
mindmap, pie, Gantt, sequence, timeline, journey, quadrant and Git diagrams;
this does not imply support for every feature of the Mermaid language.
**OpenIDE Agent: Copy the diagrams MCP configuration** supplies the server
launch details.

### MCP server catalog

Settings → MCP offers a catalog of servers that can be added with one form
instead of hand-written JSON. Each entry knows its transport and asks only for
the values it needs; the result is written to `.openide/mcp.json` (project) or
the profile's `openideAgent/mcp.json` (user), and can be edited afterwards
like any other entry.

| Entry | Transport | What it asks for |
|---|---|---|
| Filesystem | stdio | The folder to expose (defaults to the workspace root) |
| GitHub | stdio | A personal access token |
| Playwright | stdio | Nothing; a browser separate from OpenIDE's integrated one |
| Memory | stdio | Nothing; the reference knowledge-graph server |
| Context7 | stdio | An optional API key for a higher rate limit |
| Sequential Thinking | stdio | Nothing |
| PostgreSQL | stdio | A connection string |
| DeepWiki | HTTP | Nothing |
| GitHub (remote) | HTTP | An `Authorization: Bearer …` header |
| Everything (test) | stdio | Nothing; the reference server that exercises every MCP feature |

Catalog entries are ordinary MCP servers: they run with your privileges, and
the network ones talk to their services under those services' terms. Servers
are tested from the same screen, and `openide.agent.mcp.enabled: false` turns
the whole mechanism off. When a model's tool budget is tight, OpenIDE can send
a compressed catalog and route calls through `mcp_call` instead of exposing
every server tool individually.

## Hosted CLI integration

### What the dock provides

Installed coding CLIs run in an embedded PTY with their own TUI. OpenIDE discovers
executables on `PATH`, associates brand icons and session state, and builds
launch/resume arguments for the catalog entries. Hosting does not transfer a
CLI's subscription, authentication or model selection to the native agent.

| CLI | Executable | Resume adapter | OpenIDE MCP configuration | Activity source |
|---|---|---|---|---|
| Claude Code | `claude` | Yes | Launch-scoped configuration file | Native hooks |
| Codex | `codex` | Yes | Launch-scoped configuration overrides | Terminal-output heuristics |
| Gemini CLI | `gemini` | Yes | No automatic adapter | Terminal-output heuristics |
| OpenCode | `opencode` | Yes | Launch-scoped configuration file | Terminal-output heuristics |
| Amp | `amp` | No | No automatic adapter | Terminal-output heuristics |
| Factory Droid | `droid` | No | No automatic adapter | Terminal-output heuristics |
| Copilot CLI | `copilot` | No | No automatic adapter | Terminal-output heuristics |
| Grok | `grok` | Yes | Explicit registration command | Terminal-output heuristics |

This matrix describes OpenIDE's adapters, not every capability offered by each
CLI independently. The CLI must be installed and configured before it can run.

Claude hook events are associated with an OpenIDE session ID. Other integrations
can infer activity from terminal output, so status transitions are less precise.
The changes view compares working-tree snapshots around activity boundaries and
presents file icons, additions/deletions and diffs. A partial baseline or a
concurrent manual edit can affect attribution and undo; the UI preserves those
limitations rather than assuming every observed change belongs to the agent.

### How a CLI gets OpenIDE tools

With a workspace open and `openide.ideServer.enabled` enabled, the IDE starts a
local authenticated bridge after the workbench restores. It supports an IDE
compatibility WebSocket interface and Streamable HTTP MCP. Supported launch
adapters hand the endpoint and credentials to the CLI for that session; Grok's
registration uses **OpenIDE: Register OpenIDE tools in a CLI**.

The MCP client discovers tool schemas and descriptions. OpenIDE prefixes its own
exposed tools with `openide_`; the client may add its own server-name prefix.
Descriptions explain that the browser is the user's visible session, that graph
queries reuse the existing index, and that a submitted plan waits for review.
The CLI's model can then select these tools during its normal reasoning loop.
The bridge does not force a particular model to choose them.

| Exposed capability | External tool names |
|---|---|
| Visible preview, interaction, screenshots and recordings | `openide_browser_*`, including `openide_browser_open` |
| Indexed project context | `openide_project_map_query` |
| Shared repository notes | `openide_memory_read`, `openide_memory` |
| Human-reviewed plan | `openide_plan_save` |

External memory writes are constrained to the project notes. The derived graph,
learning state and user-wide memory are not writable through this interface.

Compatibility tools expose `openFile`, `openDiff`, `getCurrentSelection`,
`getLatestSelection`, `getOpenEditors`, `getWorkspaceFolders`, `getDiagnostics`,
`checkDocumentDirty`, `saveDocument`, `close_tab` and `closeAllDiffTabs`.
`getLatestSelection` can retain a selection after focus moves to the composer.
The compatibility entry `executeCode` returns an unsupported result: this bridge
does not provide a Jupyter kernel.

Native file mutation, shell execution, terminal input and MCP-proxy tools are
not included in the `openide_` allowlist. A CLI continues to use its own editing
and shell tools. The external bridge uses the CLI's MCP permission system,
not the native agent's approval dialog. Compatibility operations such as saving
an open document remain part of the IDE bridge's separate surface.

### Example: one task across editor and CLI

1. Open a sample web app and launch a supported CLI in the chat dock.
2. Ask it to inspect the checkout flow. It can call
   `openide_project_map_query` for related modules and
   `openide_memory_read` for durable project notes.
3. Ask for a plan before changing code. `openide_plan_save` opens the plan editor
   and holds the tool call until the user approves or rejects it. The response
   includes the plan after the user's edits.
4. The CLI edits and tests with its own tools. OpenIDE shows observed file changes
   in the session's changes view.
5. It calls `openide_browser_navigate`, inspects the live app and captures a
   screenshot or short recording. Screenshots arrive as MCP image content;
   recordings include visual artifacts for inspection.
6. It records a durable convention through `openide_memory`. A later native or
   bridged session can read the same project note.

A standalone external harness can use the same MCP interface when configured
with the workspace endpoint and authentication. Merely running a CLI inside the
terminal does not automatically give every client every native tool.

## Extension points and permissions

| Mechanism | Storage and behavior |
|---|---|
| Rules | `.openide/rules/*.md` and profile `openideAgent/rules/*.md`; bounded snapshots enter native turns. A project rule with the same name overrides the global one. |
| Skills | `.openide/skills/<name>/SKILL.md` and project `.agents/skills/<name>/SKILL.md`; the model sees descriptions and loads applicable procedures with `skill_view`. OpenIDE's project copy wins a name collision. |
| Subagents | `.openide/agents/*.md`; named definitions can select a model, profile, read-only behavior, background operation and tool restrictions. |
| Hooks | `.openide/hooks.json` plus profile `openideAgent/hooks.json`; events include `preToolUse`, `postToolUse`, `userPromptSubmit`, `sessionStart`, `stop` and `subagentStop`. |
| MCP | `.openide/mcp.json` plus profile `openideAgent/mcp.json`; configured servers publish additional schemas and tools. Settings offers a [catalog](#mcp-server-catalog) of common servers. |

Hook consent is tracked separately for an event/command pair, with script-change
handling. A hook cannot override a hard denial from the native permission layer.
Native tools, configured MCP servers and external CLI permissions have different
execution paths; configuring one is not a blanket approval for the others.

Skills can also be disabled individually (`openide.agent.disabledSkills`) and
imported from a folder through Settings → Skills. Subagent definitions have a
dedicated editor (**OpenIDE: Create Subagent**, **Open Subagent Editor**) and
can be shared across projects from `openide.subagents.globalDirectory`.

See [reliability](./reliability.md) for the current guarantees and limitations,
[accounts](./accounts-authentication.md) for authentication behavior, and
[voice transports](./voice-transports.md) for dictation contracts.

## Settings reference

Every OpenIDE setting starts with `openide.`. The Settings editor exposes the
common ones with descriptions in the language chosen by `openide.language`;
this table is the map. Defaults are the shipped values.

### Language and bridge

| Setting | Default | Meaning |
|---|---|---|
| `openide.language` | `auto` | Language of OpenIDE's own surfaces: `auto` follows the editor, or `en` / `es`. |
| `openide.ideServer.enabled` | `true` | Start the local IDE/MCP bridge for hosted CLIs when a workspace is open. |

### Providers, models and context

| Setting | Default | Meaning |
|---|---|---|
| `openide.agent.customProviders` | `[]` | Extra endpoints: `id`, `label`, `protocol` (`openai`, `anthropic`, `gemini`), `auth`, `baseUrl`, optional `voiceModel` / `voiceTransport` / `voiceModelTransports`. |
| `openide.agent.fallbackProviders`, `openide.agent.fallbackChain` | `[]` | Ordered providers or provider+model pairs to try when the active one fails with an eligible error. |
| `openide.agent.accountFailover` | | `off`, `auto` or `ask`: what to do when the active account of a provider is exhausted and another account is saved. |
| `openide.agent.reasoningEffort`, `openide.agent.reasoningEffortByModel` | | Reasoning effort sent to models that accept it, globally or per model. |
| `openide.agent.contextTokens` | `0` | Context window override; `0` uses the catalog value. |
| `openide.agent.maxOutputTokens` | `0` | Output cap; `0` uses the model default. |
| `openide.agent.maxAgentIterations` | `200` | Tool-call rounds a single turn may take before stopping. |
| `openide.agent.autoCompact` | `true` | Summarise the conversation when it approaches the context limit. |
| `openide.agent.compactionThreshold` | `0.6` | Fraction of the context window at which compaction starts. |
| `openide.agent.compactionTailRatio` | `0.2` | Fraction of recent conversation kept verbatim. |
| `openide.agent.compactionModel` | `""` | Model used for the summary; empty means the active one. |
| `openide.agent.streamStaleTimeoutSeconds` | `180` | Abort a response that has streamed nothing for this long. |
| `openide.agent.googleCloudProject` | `""` | Project id for Gemini Cloud Code Assist accounts that need one. |
| `openide.agent.usage.enabled` / `.pollMinutes` / `.cliAccounts` | `true` / `15` / `true` | Poll connected providers (and signed-in CLIs) for quota. |

### Permissions and tools

| Setting | Default | Meaning |
|---|---|---|
| `openide.agent.permissionMode` | | The policy chosen in the composer: ask before actions, allow edits automatically, or allow broader execution. Stored per workspace. |
| `openide.agent.toolAllowlist` | `[]` | Tools that never ask, in addition to the policy. |
| `openide.agent.hooks.enabled` | `true` | Run hooks from `.openide/hooks.json` and the profile. |
| `openide.agent.hooksAllowlist` | | Hook commands already approved. Managed by the consent UI. |
| `openide.agent.mcp.enabled` | `true` | Connect configured MCP servers. |
| `openide.agent.disabledSkills` | `[]` | Skill names hidden from the model. |
| `openide.agent.suggestMode.autoAcceptSeconds` | `0` | Auto-accept a `suggest_mode` proposal after this many seconds; `0` waits for the user. |

### Web research

| Setting | Default | Meaning |
|---|---|---|
| `openide.agent.web.enabled` | `true` | Expose `web_search` and `web_fetch`. |
| `openide.agent.web.searchEndpoint` | `""` | JSON search endpoint; `web_search` errors until one is set. |
| `openide.agent.web.allowedHosts`, `.blockedHosts` | `[]` | Host allow/deny lists for `web_fetch`. |
| `openide.agent.web.allowHttp` | `false` | Permit plain HTTP; loopback, LAN, link-local and metadata addresses stay blocked either way. |
| `openide.agent.web.timeoutSeconds` | `15` | Total time per request. |
| `openide.agent.web.maxResponseBytes` | `2000000` | Download cap. |
| `openide.agent.web.maxExtractedChars` | `60000` | Text handed to the model per page. |

### Integrated browser tools

| Setting | Default | Meaning |
|---|---|---|
| `openide.agent.browserTools.enabled` | `true` | Expose the `browser_*` tools. |
| `openide.agent.browserAllowedHosts` | `[]` | Hosts the agent may navigate to; empty means any. |
| `openide.agent.browserTools.actionTimeoutMs` / `.navigationTimeoutMs` | `5000` / `10000` | Per-action and per-navigation limits. |
| `openide.agent.browserTools.settleMs` | `140` | Wait after an action before reading the page. |
| `openide.agent.browserTools.keystrokeDelayMs` / `.maxKeystrokes` | `70` / `80` | Typing cadence and cap for `browser_type`. |
| `openide.agent.browserTools.maxDomReadChars` | `50000` | Cap for `browser_read_dom`. |
| `openide.agent.browserTools.screenshotQuality` | `80` | JPEG quality of screenshots sent to the model. |
| `openide.agent.browserTools.showCursor` | `true` | Draw the pointer in screenshots and recordings. |
| `openide.agent.browserTools.recordFps` / `.recordMaxSeconds` / `.recordFramesToModel` | `12` / `90` / `6` | Recording rate, length cap, and how many keyframes the model receives. |

### Memory and Project Map

| Setting | Default | Meaning |
|---|---|---|
| `openide.memory.enabled` | `true` | Build and use the codebase graph. |
| `openide.memory.indexOnOpen` / `.incrementalIndexing` | `true` / `true` | Index when a workspace opens; update on file changes. |
| `openide.memory.persistIndex` | `true` | Keep the index on disk under the profile's `openideAgent/memory-indexes`. |
| `openide.memory.include` / `.exclude` | `[]` | Glob filters for indexing. |
| `openide.memory.indexTests` | `true` | Include test files so `memory_graph_related_tests` can answer. |
| `openide.memory.enableRegexFallback` | `true` | Use text/regex discovery where no language service is available. |
| `openide.memory.showHeuristicRelations` | `true` | Include lower-confidence relations in tool answers. |
| `openide.memory.maxContextTokens` | `3000` | Retrieval budget added to a native turn. |
| `openide.memory.maxRetrievedNodes` / `.maxTraversalDepth` | `24` / `3` | Retrieval breadth and depth. |
| `openide.memory.notes.enabled` / `.linking` / `.maxChars` | `true` / `explicit` | Ingest `.openide/MEMORY.md` as nodes; link by explicit references, identifiers, or not at all; note size cap. |
| `openide.memory.visualization.defaultMode` | | Project Map's initial view: `architecture`, `graph`, `dependencies`, `impact` or `matrix`. |
| `openide.memory.visualization.maxVisibleNodes` / `.maxRelationDepth` / `.showHeuristicEdges` | `300` / `2` / `true` | Project Map rendering limits. |

### Subagents

| Setting | Default | Meaning |
|---|---|---|
| `openide.subagents.enabled` | `true` | Allow `delegate_to_subagent`. |
| `openide.subagents.maxParallelRuns` / `.maxDepth` | `4` / `2` | Concurrency and nesting limits. |
| `openide.subagents.defaultTimeoutMinutes` | `15` | Time limit per run. |
| `openide.subagents.defaultModel` | `default` | Model for definitions that do not name one. |
| `openide.subagents.defaultBackground` | `false` | Run in the background unless the definition says otherwise. |
| `openide.subagents.allowWritable` | `false` | Let subagents mutate files; read-only by default. |
| `openide.subagents.useWorktrees` | `true` | Give writable subagents an isolated Git worktree. |
| `openide.subagents.showDetailedToolCalls` / `.preserveCompletedRuns` | `true` / `true` | UI detail and history. |
| `openide.subagents.globalDirectory` | `""` | Extra directory of shared definitions. |
| `openide.subagents.routing.enabled` / `.preset` / `.maxAttempts` / `.policy` | `false` / `balanced` / `3` | Optional model routing across attempts: `manual`, `quality`, `balanced` or `savings`. |

### Chat, editor and notifications

| Setting | Default | Meaning |
|---|---|---|
| `openide.chat.fontSize` / `.density` | `13` / `comfortable` | Chat typography; density is `comfortable` or `compact`. |
| `openide.chat.autoScroll` | `whenAtBottom` | Follow streaming output only when already at the bottom, or `always`. |
| `openide.chat.queue.enabled` | `true` | Queue messages typed while a turn is running. |
| `openide.chat.thinking.defaultOpen` / `.tools.defaultExpanded` | `false` / `false` | Expand reasoning and tool cards by default. |
| `openide.chat.userMessage.clampLines` | `3` | Lines shown of a long user message before "show more". |
| `openide.chat.workingIndicator` | `true` | Show the activity indicator while the agent works. |
| `openide.chat.selectionToCli` | | Send editor selections to the hosted CLI instead of the native composer. |
| `openide.autocomplete.enabled` | `true` | Inline completion from the agent's provider. |
| `openide.autocomplete.model` | `""` | Model for completions; empty means the active chat model. |
| `openide.autocomplete.debounceMs` / `.maxTokens` | `350` / `256` | Request cadence and length. |
| `openide.autocomplete.multiline` | `auto` | Allow multi-line suggestions. |
| `openide.autocomplete.disableInFiles` | `[]` | Globs where completion is off. |
| `openide.agent.voiceModel` / `openide.agent.voiceMode` | `""` / | Dictation model and `toggle` or `holdToTalk`; see [voice transports](./voice-transports.md). |
| `openide.agent.notifications.enabled` / `.onTaskComplete` / `.sound` / `.suppressWhenFocused` | `true` | Desktop notifications when a turn finishes. |

## Implementation map

These entry points connect the documentation to the source:

| Area | Entry point |
|---|---|
| Native orchestration | [openideAgentService.ts](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts) |
| Core workspace tools | [openideTools.ts](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideTools.ts) |
| Browser tools | [openideBrowserTools.ts](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideBrowserTools.ts) |
| Authored memory | [openideAgentMemory.ts](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentMemory.ts) |
| Graph data model | [openideCodebaseMemoryTypes.ts](../vscode/src/vs/code/common/openideCodebaseMemoryTypes.ts) |
| Authored graph notes | [openideCodebaseNotes.ts](../vscode/src/vs/code/common/openideCodebaseNotes.ts) |
| Retrieval | [openideCodebaseContextService.ts](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseContextService.ts) |
| Visual map | [Project Map](../vscode/src/vs/workbench/contrib/openideAgent/browser/projectMap/) |
| CLI catalog and injection | [openideAgentCliCatalog.ts](../vscode/src/vs/workbench/contrib/openideAgent/common/openideAgentCliCatalog.ts) |
| External tool policy | [openideIdeExposure.ts](../vscode/src/vs/workbench/contrib/openideAgent/common/openideIdeExposure.ts) |
| Workbench bridge | [openideIdeServerService.ts](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideIdeServerService.ts) |
| Main-process bridge | [openideIdeServerMain.ts](../vscode/src/vs/platform/openideAgentHost/electron-main/openideIdeServerMain.ts) |
| Diagram MCP server | [openideDiagramsMcpServer.ts](../vscode/src/vs/workbench/contrib/openideAgent/node/openideDiagramsMcpServer.ts) |
