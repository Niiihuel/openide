# OpenIDE and the local DeepSeek Harness reference

This comparison describes the baseline before the follow-up implementation. See
[OpenIDE harness evolution](harness-evolution.md) for the implemented services,
configuration, validation and remaining limits as of 6 September 2026.

Reviewed on 5 September 2026. Reference checkout:
`/home/nihuel/projects/personal/refs/deepseek-harness`, commit
`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` (`0.1.0-rc.7`, 17 August 2026).
OpenIDE means the current working tree, including the
[fork hardening implementation](fork-hardening-results.md).

This is a source and test-design comparison. DeepSeek's tests were inspected,
not executed; no packages were installed, models called, or reference files
changed. Statements about latency, token efficiency or task success would need
an equal-model benchmark. Neither a package count nor a coverage threshold
establishes those outcomes.

## Assessment

DeepSeek has the more developed reusable harness infrastructure in the inspected
areas: event-derived history, explicit persistence checkpoints, centralized tool
policy, replaceable execution providers and replay testing. OpenIDE has a more
direct integration with the actual editor: live selection and diagnostics,
visible preview automation, project-map context, native review and hosted CLI
sessions inside the workbench. Those strengths address different requirements.

| Area | Observed difference | Decision for OpenIDE |
|---|---|---|
| Runtime composition | DeepSeek composes service definitions, providers and consumers through Cordis. OpenIDE now has separate turn, stream, compaction and provider modules, but the facade still owns UI/permission adapters and a separate subagent loop. | Continue extraction through existing VS Code services; reuse the runtime across entry points. |
| History and recovery | DeepSeek derives requests from session events and can checkpoint before effects. OpenIDE persists conversation snapshots and separate change sets; request-only context is not a complete durable journal. | Add effective-request records and explicit checkpoint boundaries. |
| Tool authorization | DeepSeek enforces composed policy in its tool executor. OpenIDE's main loop, external-tool exposure and subagent allowlists have separate enforcement paths. | Consolidate validation and effective authority at dispatch. |
| Process isolation | DeepSeek has OS sandbox providers used by shell/terminal consumers. The examined OpenIDE native shell path uses a regular terminal. | Add an execution service that preserves the visual terminal and reports actual confinement. |
| Editor context | OpenIDE directly uses editor selection, markers, open tabs and preview services. DeepSeek has LSP support, backed by its filesystem/subprocess providers. | Preserve live workbench integration and make disk-versus-buffer semantics explicit. |
| Project knowledge | OpenIDE has an incremental project graph, relations, provenance, freshness and budgeted retrieval. No equivalent integrated graph was found in the inspected DeepSeek packages. | Treat this as a differentiator; measure retrieval usefulness instead of assuming it saves tokens. |
| Tests and replay | DeepSeek ships composed-application replay and crash-recovery fixtures. OpenIDE now has real Electron and hosted-product checks plus scripted runtime tests. | Add replay of native requests and crash recovery to the new test base. |
| Providers | DeepSeek also has a generic `llm-pi-ai` adapter; it is not DeepSeek-only. OpenIDE has native adapters and account/OAuth/catalog UI. | Preserve account UX; compare actual supported protocols and flows, not provider counts. |

## Useful decisions already present in OpenIDE

OpenIDE's new `openideProviderStream.ts:26` fences late events and settles
cancellation even when a provider ignores it. Its retry path (`:66`) stops
replaying a request once text, reasoning or tool-argument deltas have escaped,
and keeps a finite attempt budget. DeepSeek's examined loop delegates failures
to retry policy and can retry after recording failed chunks
(`packages/core/agent-loop/src/agent.ts:354`). These are different recovery
semantics: OpenIDE's conservative choice is useful when preserving the visible
stream and avoiding accidental replay matters. It should not be replaced merely
to match the reference.

OpenIDE also seals orphan tool calls before continuing and isolates overflow
recovery between conversations. The new `IOpenideTurnPorts` separation is
sufficient to add a journal and checkpoints; a second plugin framework is not
required. The existing change sets already survive transcript compaction because
they are stored separately.

## Highest-value changes

### 1. One tool executor with explicit authority

DeepSeek's `packages/core/tools/src/index.ts:1474` evaluates policy and guards
inside execution; `packages/core/tools/tests/scoped.spec.ts:284` and `:318`
exercise denials and composition. This makes alternate callers subject to the
same mandatory restrictions.

OpenIDE's `openideAgentService.ts:3240` validates schemas and `:3277` checks
approval in the main turn adapter. `openideTools.ts:372` parses JSON and invokes
the implementation directly. The subagent loop does enforce an allowlist,
risk restrictions and budgets (`openideAgentService.ts:3654`), then uses a
different dispatch path. External exposure has its own deliberate allowlist
in `common/openideIdeExposure.ts`; this is not an absence of permission controls.

Introduce a small execution request containing run identity, parent grant,
workspace, origin and cancellation. Validate arguments and evaluate mandatory
policy in one executor before effects. Human approval can grant only what the
parent and platform policy allow. Native, subagent and inbound MCP entry points
should delegate to it while preserving their distinct exposure policies.

Acceptance: a denied operation stays denied through direct, nested and delegated
calls; malformed arguments never reach the implementation; cancellation between
approval and dispatch produces no filesystem or process effect.

### 2. A coherent workspace and process execution service

`openideSubagentWorkspaceService.ts:46` accepts a worktree backend, but no
production registration was found in the inspected contribution. Its actual
fallback is a single writer (`:54`). Reads can receive `context.workspaceRoot`
(`openideTools.ts:498`), while `write_file` and `edit_file` resolve the general
workspace roots (`:646`, `:740`). Terminal creation (`:1242`) does not receive
the lease's cwd. Consequently, the extension point does not yet establish
end-to-end worktree isolation. This is a conditional gap in that capability,
not evidence that the default single-workspace path is already using a worktree.

DeepSeek propagates child session/cwd and delegated policy in
`packages/subagent/subagent/src/child-agent.ts:110`, `:174`, `:198`, `:216`.
Its terminal consumer resolves session policy and confines argv in
`packages/terminal/terminal-bash/src/index.ts:82`, `:125`.

Use one workspace handle for read, write, search, shell, LSP and restore. Complete
and register the worktree backend before exposing independent writer isolation.
Separate permission approval from OS confinement: OpenIDE's approval policy
and command checks do not make a regular PTY a filesystem/network sandbox.
DeepSeek's sandbox selection lives in
`packages/sandbox/sandbox-local/src/index.ts:336`, with real denial scenarios in
`tests/bwrap.e2e.ts:63`, `:81`. Its Windows backend is explicitly partial, and its
workflow VM is not a security boundary; those limitations should remain visible
in any adaptation.

Acceptance: a child assigned to a separate temporary worktree reads, edits,
searches and executes only there; the main workspace remains byte-identical.
An OS-confined test command cannot write outside its grant. Unsupported backends
report their actual capability rather than presenting an approval as confinement.

### 3. Reconstructable requests and checkpoints before effects

DeepSeek's architecture makes model-visible inputs session facts. The concrete
checkpoint plugin awaits `ctx.sessions.flush(session)` before model dispatch
(`packages/session/session-checkpoint-policy/src/index.ts:35`), before top-level
tool dispatch (`:72`) and at the next pre-step boundary (`:79`). These guarantees
depend on mounting that plugin and an appropriate persistence backend; an
in-memory append alone is not durable. JSONL persistence implements filesystem
synchronization, and crash-recovery tests exercise process termination.

The request source is concrete: `packages/core/agent-loop/src/agent.ts:458`
records effective request headers; `runtime-context.ts:64` records dynamic
context. `tests/request-reconstruction.spec.ts:566` reconstructs requests from
log prefixes. Compaction appends a summary and checks the source prefix before
publishing a replacement projection in
`packages/compaction/compaction-basic/src/region.ts:386`, `:426`, retaining the
original events.

OpenIDE's `openideChatSessions.ts:195` stores complete session snapshots through
`IStorageService`. That store has its own persistence behavior; the difference
is that the harness has no explicit checkpoint before each model/tool effect.
`openideAgentService.ts:2989` builds system and runtime context dynamically;
`common/openideTurnRuntime.ts` adds request-only continuation/context, and
`common/openideContextCompactor.ts` replaces the active message array. A saved
transcript therefore is not a complete reconstruction of every request.

Add an append-only run journal alongside the existing session format. Record
admitted input, effective prompt sections/tool definitions, selected model,
context provenance, tool call/result, cancellation and compaction boundaries.
Reference large assets and exclude credentials. Preserve the original transcript
when creating a compacted projection. Introduce explicit flush barriers at the
boundaries that need recovery guarantees, with versioned migration of existing
sessions.

Acceptance: replay reconstructs the effective request; cancelling compaction
preserves the prior history; injected persistence failure prevents a write tool
from starting; restarting after a crash exposes incomplete work without blindly
repeating its external effects.

### 4. Align live editor content with filesystem observations

OpenIDE's IDE bridge gets selection from the live editor model
(`openideIdeServerService.ts:475`) and diagnostics from the marker service
(`:520`). Its native `read_file` instead calls `fileService.readFile`
(`openideTools.ts:499`). An unsaved edit can therefore make two tools describe
different versions of the same file. Safe rollback's dirty-buffer checks do not
by themselves solve ordinary reading and editing semantics.

Define whether each operation reads the editor buffer or persisted disk bytes,
and return enough provenance/version information to validate a subsequent edit.
DeepSeek's `packages/fs/fs-observation-policy/src/index.ts:63` derives write
intent from observed presence/version; `:78` requires prior observation for an
edit. This is a useful pattern to adapt to VS Code text models and file providers,
while preserving explicit disk operations where they are needed.

Acceptance: an unsaved buffer is reported consistently; a model edit based on
an old observation conflicts instead of silently replacing a newer version;
external disk changes and editor-version changes have distinguishable outcomes.

### 5. Replay tests, then a measured comparison

DeepSeek's testing policy distinguishes unit coverage, real API tests, keyless
application replay and built-artifact smokes. Inspecting that policy and its
fixtures is evidence of test design, not a claim that its entire suite passed
here or that its 100% coverage target makes the product fault-free.

Build on OpenIDE's newly passing runtime, Electron and product checks with native
request/transcript fixtures. Keep the provider scripted and the real executor,
filesystem and session persistence active. Include cancellation, recovery,
compaction, delegated authority and tool-output boundaries. Add crash tests and
retain native platform evidence separately from source checks.

For an effectiveness comparison, pin one model, settings, repository state and
comparable tools. Use tasks with external assertions: find the relevant symbol,
fix a failing test, preserve an unrelated edit, recover from a tool error,
continue after compaction and stop after cancellation. Measure verified task
success, unintended file changes, requests, tokens and elapsed time. Report
editor UX separately; a headless benchmark cannot measure the dock's value.

## What to retain

Keep the vendored Code OSS structure, its dependency injection/disposables,
window ownership, actual editor services, visible browser preview, project-map
retrieval and native/CLI session experience. These are concrete advantages for
an IDE product. Their current integration evidence is recorded in the
[implementation report](fork-hardening-results.md).

A public TypeScript/Python SDK, arbitrary workflow scripting, hot plugin loading
and a second composition framework are lower priorities until OpenIDE has a
consumer that requires them. A small internal `start/cancel/events/result` API
would already improve tests and automation using the modules extracted here.
