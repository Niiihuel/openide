# OpenIDE harness evolution

Implementation dated 6 September 2026, following the
[local harness comparison](harness-comparison-deepseek.md). These are OpenIDE
services built on the fork's existing VS Code interfaces. The reference checkout
was inspected; its source was not copied or modified.

## Execution and permissions

`OpenideToolExecutor` validates JSON and tool schemas, checks the run's tool/risk
allowlist, applies mandatory command guards and requests approval before dispatch.
Native tools, nested `mcp_call`/`batch_read`, registered and legacy subagents, and
the registry tools exposed to dock CLIs use this boundary. The main loop's special
UI tools use its preflight and the same durable batch checkpoints. Answered approval
cards retain their decision through transcript repaints.

Nested calls retain the parent's execution context. Subagents receive a bounded
intersection of their definition, risk profile and implemented workspace tools.
Protected Rules remain guarded, and a conversation cannot operate another
conversation's subagent by passing its run ID. Compressed MCP catalogs retain the
permissions of the published tools. The dock's existing restricted IDE-tool
exposure remains its grant; this does not change a third-party CLI's own harness.

Main entry points:

- `vscode/src/vs/workbench/contrib/openideAgent/common/openideToolExecutor.ts`
- `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts`
- `vscode/src/vs/workbench/contrib/openideAgent/browser/openideTools.ts`

## Durable history and recovery

`OpenideRunJournalStore` writes ordered JSONL records with a hash chain and fsync
barriers. Model requests, attempts/retries, assistant results, tool intents/results,
compaction snapshots and terminal run state are recorded. A failed checkpoint
stops dependent execution; it is not classified as a provider outage or retried
through another account. The terminal completion event follows the final checkpoint.

The main process scopes storage by canonical workspace roots (workspace identity
for an empty window) under:

```text
<user-data>/User/globalStorage/openide/run-journal/<workspace-hash>/<session-hash>.jsonl
```

Connection leases prevent a second window from recovering a live session. On
reopening, incomplete intents become an explicit unknown outcome. Recovery does
not execute tools. A transcript older than the journal receives uncertainty
context while retaining the newest user prompt. Request reconstruction is offline
and reproduces the model-facing adapter input, excluding transport credentials
and headers; it is not a capture of adapter-expanded HTTP bytes.

Compaction still replaces the model's working projection, but the journal keeps
its original messages and the prepared summary. A changed projection during the
asynchronous summary invalidates the compaction. History lost before this version
was installed cannot be reconstructed retroactively.

Current bounds: 16 MiB per record, 128 MiB and 10,000 records per session. Reaching
a bound stops the run and requires a new session. There is no global quota,
rotation, or full-history archive browser yet. Each append currently verifies the
whole prefix, so long sessions have increasing IO/CPU cost. Hash chaining detects
corruption; it is not an authentication mechanism against the local account.
Conversation and tool content are retained, including sensitive text supplied in
prompts or files, even though transport secrets are excluded.

## Editor and filesystem observations

`OpenideWorkspaceAccess` reads the open text model when available and labels the
source (`editor` or `disk`) and an opaque `observation_id`. Existing-file writes,
edits, renames and deletions require a current observation from the same run;
`expected_observation` can name it explicitly. Creation uses an exclusive create.

Validation compares model revision, exact disk bytes and encoded editor text.
Cancellation is checked again after asynchronous validation, before a filesystem
mutation or terminal payload is dispatched.
Unsaved buffers and clean buffers awaiting a disk reload are protected. Encoding
and BOM are preserved for existing files. Clean owned models reload after a write.
Filesystem tools reject Git-metadata mutations, including symlink aliases.

Filesystem operations, searches, diagnostics, file claims and shell working
directories use the assigned workspace. Native canonical-path checks reject
symlink escapes, including dangling destinations. A worktree child does not receive
the primary workspace's graph tools as if that graph described its own edits.

These are optimistic checks, not an OS transaction against arbitrary external
writers between validation and the filesystem operation.

## Processes and visible terminals

Agent commands continue using OpenIDE's visible terminal and shell integration.
The optional Linux backend executes their payload through bubblewrap, with the
workspace mounted at its actual path, runtime directories and required Git metadata
read-only, a private temporary directory/home, and a clean environment.

Enable it in settings:

```json
{
  "openide.agent.processIsolation": "required",
  "openide.agent.processIsolationNetwork": "deny"
}
```

`processIsolation` defaults to `off`. `required` fails if bubblewrap or the necessary
kernel namespaces are unavailable; it never falls back to an ordinary command.
`processIsolationNetwork: "allow"` explicitly permits network access. macOS and
Windows currently report this process backend unavailable. Hosted third-party
CLIs continue using their own execution and permission settings.

The backend permits read-only system runtime directories and Git metadata; it does
not expose arbitrary user files outside the workspace. Writable scratch storage
is intentional. Workspace preflight rejects writable hard links and local sockets
when the corresponding confinement guarantee would be violated.

Agent-owned terminals are transient across renderer lifetimes, including commands
marked persistent across turns. The native owner authenticates terminal backend
IDs against ready events and working directories, registers them before commands
are sent, and waits for backend exit during subagent cleanup. Persisted worktree
shell PIDs prevent adoption while a previously recorded shell remains alive. It
never kills an arbitrary OS PID. Unconfined commands can intentionally daemonize;
`off` does not provide process-tree confinement or an OS-level writer freeze.

## Subagent worktrees

Writer subagents use detached worktrees through `OpenideSubagentWorktrees` when
`openide.subagents.useWorktrees` is enabled. Creation requires a clean, committed
repository root, so the child cannot silently start from a stale HEAD while the
parent has uncommitted work. Failure to create an enabled worktree is explicit;
it does not silently switch the child to the parent's files.

After the run finishes, the command palette offers:

- **OpenIDE: Apply Subagent Changes** — applies the child's delta to the source
  working tree, without switching branches or staging the user's real index.
- **OpenIDE: Discard Subagent Changes** — removes the selected owned worktree
  after an explicit discard choice.
- **OpenIDE: Recover Subagent Changes** — adopts abandoned outputs after reload
  or restart when no live owner or recorded shell still holds them.

Apply requires stopped agent runs and saved editors. Native validation rejects
HEAD drift, conflicting edits on touched files, changed symlinks/submodules, and
Git filter drivers that could execute outside confinement. Unrelated local edits
made after worktree creation are retained. A private Git index builds and checks
the patch; the user's index is preserved. A worktree can be applied only once.

The current apply budget is 64 MiB and 1,024 changed paths. Repositories using
external Git filters, including typical LFS configurations, require another
workflow. Completed worktrees survive owner disconnection, but are stored under
the OS temporary directory and remain subject to its cleanup policy. Apply/discard
and recovery do not establish atomicity against unrelated external processes.

## Validation

Tests cover shared dispatch and nested permissions, real filesystem/editor
observations, encoding and symlink cases, actual journal disk failures, a killed
child process after an effect, recovery and request reconstruction, real Git
worktrees, and Linux kernel confinement. Chromium tests exercise the registry,
workspace lifecycle and terminal adapter. Product tests use the running Electron
IDE and deterministic local providers/CLI fixtures; no external model account is
required.

Local validation on Linux completed with:

| Check | Result |
|---|---|
| Client TypeScript and source-layer checks | Pass |
| Common/node suites, including actual bubblewrap kernel execution | 860 passing, no skips |
| Chromium workbench suites | 267 passing |
| Fork tooling and reliability registry | 21 passing |
| Real Electron bridge lifecycle | 8 checks passing |
| Hosted CLI in the running IDE | 12 checks passing |
| Native harness in the running IDE | 4 checks passing |

The native product fixture covers an actual local HTTP provider turn, durable
request/effect records, preservation of an unsaved editor buffer, real terminal
dispatch and the settled approval UI. Its environment did not provide captured
shell-integration output; it verifies the terminal's exact filesystem effect.
Capture with shell integration is covered by the browser adapter tests.

Evidence is under `.build/fork-hardening/harness-runtime/`, `hosted-cli/`,
`electron-bridge/` and `harness-evolution/`. The new suites are included by the
existing CI globs. CI now installs bubblewrap, requires working namespaces, runs
the native product fixture, and uploads its evidence. The workflow changes were
validated locally; this is not a claim that a remote CI run or packaged release
has completed. Native Windows/macOS validation remains outstanding.
