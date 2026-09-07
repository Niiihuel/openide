# Fork hardening implementation and evidence

This implements the [fork, harness and hosted CLI plan](fork-hardening-plan.md)
in the existing vendored Code OSS tree. Validation below distinguishes local
Linux evidence from CI coverage that has been configured but not run here.
Pre-existing worktree changes were retained; this work has not been committed
or synchronized against a new upstream version.

## Architecture and behavior

The Electron IPC server now supports connection-owned channels. The trusted
Electron sender establishes ownership; serialized client context does not.
Each owner receives its own agent host, IDE socket, authentication token,
request IDs, MCP configuration files and browser automation instance. Closing,
reloading or crashing a renderer revokes that generation. Disconnect before the
initial context message also releases the pending handshake.

HTTP disconnects cancel only their own renderer request, even when JSON-RPC IDs
repeat. Cancellation reaches external tools and pending plan/diff reviews.
A late approval or cancelled request cannot resolve a replacement review for
the same path. Workspace changes serialize bridge restart and clear cached
selection and credentials. Claude hook drop directories include a renderer
owner ID supplied to the hosted process.

Hosted launches receive the current window's endpoint automatically. Manual
MCP registration uses a unique OpenIDE entry and versioned, nonsecret metadata;
repeating the command within one generation is idempotent. Closing or reloading
expires that endpoint. Reconnect creates a separate entry. Legacy `openide`
entries and unrelated MCP configuration are never overwritten or deleted.
Old entries can be removed explicitly using the CLI's own configuration tools.
A crash cannot prove that an external registration succeeded or remained
unchanged, so its metadata stays uncertain.

Native message rollback and CLI snapshots now use `OpenideRestoreEngine`.
The CLI captures dirty content before the PTY starts, pins the Git base and
records existing tracked, untracked and ignored paths. Exact baseline capture
is bounded to 128 files, 8 MiB total and 256 KiB per file. Missing provenance,
Git conversions without original bytes, binary content and symlinks remain
review-only. Selected CLI restoration is explicit and requires the CLI process
to exit; a quiet interval or hook boundary does not prove that it stopped writing.

Restore checks later file contents, unsaved buffers and active native/CLI runs.
Main-process leases serialize cooperating restores. Another live window owning
the same paths, or an owner whose workspace has not yet registered, conservatively
prevents restore. File provider conditions and quarantined deletion reduce
concurrent-write hazards, but are not an atomic transaction against arbitrary
external writers or power failure. Conflicts and partial failures are reported.

Browser/common code now consumes `IOpenideNativeServices`. Electron registers
the actual IPC adapters; web registers explicitly unavailable native operations.
Project-map contracts live in `platform/openideCodebase/common`; DOM-dependent
visual lint lives in `browser`.

The agent facade delegates to provider/account, picker-preference, voice and
codebase-tool modules. Prompt construction, streaming retries, turn orchestration,
conversation coordination and context compaction are separate common modules.
The existing session keys, provider/model choices and public commands remain
compatible. Provider failover and permission/UI tool adapters still reside in
`AgentService`; the extraction is not a claim that this facade is now minimal.

## Fork maintenance

`dev/audit-fork-delta.mjs` compares explicit committed trees, includes blob/type/
mode changes, and reports uncommitted work separately. The exception manifest
records intentional removals and reviewed upstream edits with ownership and
validation notes. Counts measure divergence, not implementation quality.

The local inventory against `a44adf7f53e00964ab890f9f8758a334f1fc15bc` and the
unchanged committed fork tree contains 559 modified, 719 added and 4,154 deleted
paths, with no undeclared deletion. These counts exclude this uncommitted
implementation and must be regenerated after committing or updating the base.

Sync refuses local modifications in managed paths, preserves downstream deltas,
retains conflict/inventory/check reports and advances base metadata only after
source layers, typecheck, fresh transpilation and relevant tests pass. A sync PR
explicitly dispatches the complete CI workflow. No real upstream sync was run
on this dirty worktree.

## Validation and retained evidence

Local Linux validation passed: **803 agent/host/common/Node tests, 254 Chromium tests, 21 tooling/registry tests, 8 real Electron checks and 12 hosted-product checks**. Source typecheck and all source-layer checks passed.

Local checks use freshly transpiled canonical source. Logs and product artifacts
are under `.build/fork-hardening/` and `.build/hardening-*.log`.

- Source typecheck and the complete source-layer check.
- Common agent/host tests, connection IPC tests and repository contracts.
- Real HTTP server ownership/cancellation and real Git/filesystem restoration.
- Chromium agent UI/service tests, including provider migration, voice transport
  selection, plan-review cancellation and native rollback.
- Real Electron renderers with forged duplicate context, independent endpoints,
  token rejection, owner routing, close, reload and renderer crash.
- An isolated local CLI fixture in the running IDE: real PTY, launch-scoped MCP,
  keyboard input, disposable file changes, tab preservation, resize, relaunch
  and launch-failure recovery. MCP also verifies live editor selection and workspace data; selection is sent to the PTY, and real plan review covers edited disk content, approval, rejection and HTTP cancellation. The driver asserts the exact temporary executable
  path before selecting it; no installed commercial CLI is invoked.
- Fork inventory/sync fixtures, reliability registry and language audits.

Reproduction commands and known gaps are also registered in
`dev/reliability-gates.json`. CI runs the bridge and hosted-product drivers under
Xvfb and uploads their artifacts even on failure. It additionally schedules
restore tests on a native Windows runner.

## Remaining release evidence

The Windows job was configured but not executed in this local Linux session.
macOS, packaged smoke, real Claude hooks, third-party CLI/version compatibility and power-failure
recovery require their own native evidence. A scripted provider proves the
runtime contract, not the behavior of every hosted model API. Gates remain at
soak/experimental maturity; none was promoted to blocking on assumed evidence.
