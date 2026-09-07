# Fork, harness and hosted CLI implementation plan

Status: implementation integrated locally; final Linux checks and product evidence are recorded in [the implementation report](fork-hardening-results.md). Windows CI and packaged/third-party CLI evidence remain separate release requirements.

Prepared on 5 September 2026 following the local architecture review. This plan
targets correctness, maintainable layer boundaries and upstream maintenance.
Keep the vendored Code OSS model and the existing native chat / embedded PTY
experience. Preserve public tool names, commands, settings and session history
unless a migration is explicitly included in the relevant change.

## Evidence and scope

The review found:

- One main-process IDE bridge shared by multiple workbench windows. A local
  reproduction against the existing compiled server returned the same endpoint
  and token for two workspace starts and delivered one request to both listeners.
- Hosted CLI rollback writes or deletes a file without validating later changes.
- The source layer checker reported 24 native-service references across nine
  `openideAgent/browser` files.
- `openideAgentService.ts` contains 5,265 lines and is imported by 60 files.
- Comparing `HEAD:vscode` with the locally available Code OSS base
  `a44adf7f53e00964ab890f9f8758a334f1fc15bc` found 559 modified, 719 added and
  4,154 deleted files. These counts describe committed trees, not uncommitted edits.

725 agent/host/repository tests passed against the existing `out/`, together
with 16 tooling tests. This is a baseline, not proof of a fresh build, a packaged
product, real CLI compatibility or isolation between Electron windows.

The current worktree contains pre-existing changes. Preserve them. Each
implementation change must identify its actual base commit and source changes;
the numbers above must be regenerated when that base changes.

## Delivery order

| Delivery | Depends on | Concrete result |
|---|---|---|
| A — Baseline and regression fixtures | — | Reproducible bridge and rollback failures; committed-tree delta report |
| B — Window-owned IDE bridge | A | Requests, credentials and lifecycle isolated by owner |
| C — Safe CLI restore | A | Restore cannot silently overwrite later or ambiguous work |
| D — Native adapters and shared contracts | B, C | Source follows browser/common/Electron boundaries |
| E1 — Provider and account responsibilities | D | Existing provider components exposed through narrow services |
| E2 — Tools, voice and context responsibilities | E1 | Feature implementations leave the central agent service |
| E3 — Turn execution runtime | E2 | Tested run lifecycle independent of UI widgets |
| F — Fork inventory and sync checks | A | Reproducible divergence accounting integrated with synchronization |
| G — Product integration and release evidence | B–F | Fresh-build, multi-window and CLI lifecycle checks in CI |

Ship B and C as focused fixes before the larger extractions. F is independently
implementable after A. Run each delivery's tests when it lands; G consolidates
product-level evidence rather than postponing testing until the end.

## A. Establish reproducible evidence

Create focused fixtures for two windows with different workspaces, two windows
with the same workspace, and a temporary Git repository with pre-existing edits.
Reproduce failures using real server dispatch and filesystem operations where
relevant. A test that stubs the failing method cannot protect that method.

Capture the current layer violations and the committed upstream delta. Keep
test output in CI artifacts and link commands from the reliability registry.
Regression tests should accompany their fixes; intermediate failing tests must
not leave the main branch broken.

Acceptance: the bridge fixture detects delivery to a second owner, and the
rollback fixture detects loss of edits made after the captured CLI change.

## B. Give the IDE bridge a window owner

Primary files:

- `vscode/src/vs/code/electron-main/app.ts`
- `vscode/src/vs/platform/openideAgentHost/common/openideIdeServer.ts`
- `vscode/src/vs/platform/openideAgentHost/common/openideAgentHost.ts`
- `vscode/src/vs/platform/openideAgentHost/electron-main/openideAgentHostMain.ts`
- `vscode/src/vs/platform/openideAgentHost/electron-main/openideIdeServerMain.ts`
- `vscode/src/vs/workbench/contrib/openideAgent/browser/openideIdeServerService.ts`

Introduce an owner-aware bridge channel and registry in the main process. Each
live window owner has its own endpoint, credentials, tool catalog, pending calls,
temporary CLI configuration and subscriptions. Treat workspace identity and
window identity separately: two windows opening the same folder are still two
owners. Include a generation so a reloaded renderer cannot answer an old call.

Bind ownership to the actual Electron IPC connection. Audit how the sender is
associated with channel context before implementing this: the generic IPC
context is serialized by a client, so a caller-supplied `windowId` alone is not
an authority. If trusted identity is unavailable at the service boundary, add
the smallest transport adapter needed to expose it and record that upstream edit.

Route requests to one owner before broadcasting any renderer event. Validate
the owner again for responses, tool-catalog replacement, notifications and stop.
Use owner/generation-qualified request IDs. Multiple `start` calls by one owner
must share an in-flight start; different owners must never share credentials.

On close, crash, reload or workspace replacement, settle that owner's pending
calls once and dispose its resources. Verify the HTTP response path actually
settles too. Propagate cancellation to renderer work where supported; late
responses must not reach a replacement window or duplicate side effects.

Update CLI launch configuration to target the exact window. Existing persistent
registrations require an explicit migration: version OpenIDE-owned registration
metadata, refresh only entries OpenIDE can prove it owns, and never silently
route an ambiguous registration to whichever window started first. Old endpoints
must reject stale credentials. Show a reconnect action when migration needs a
new registration; keep unrelated user MCP entries intact.

Inspect related multi-window resources: Claude hook drop consumption, plan review
state and browser targets. A window must not delete another session's hook event
or control another window's preview. Prefer session-specific drop directories and
owner-bound targets. Apply necessary fixes within B; record unrelated host work
separately rather than replacing the whole process subsystem.

Acceptance tests:

- One tool request reaches exactly one renderer for different and identical roots.
- A response, stop or tool update from another owner is rejected.
- Closing A leaves B's CLI, tools and pending plan review operational.
- Reload, concurrent starts, port collision and startup failure leave no orphan
  listener or stale request capable of executing in the next generation.
- Hook events, plan decisions and browser actions remain within their owner.
- Workspace changes and stale persistent registrations never select another root.

Include a real two-window Electron test in CI before claiming this delivery done.

## C. Make hosted CLI restore preserve other work

Primary files:

- `vscode/src/vs/workbench/contrib/openideAgent/browser/openideCliChangesService.ts`
- `vscode/src/vs/workbench/contrib/openideAgent/browser/openideMessageChangeSetService.ts`
- `vscode/src/vs/workbench/contrib/openideAgent/common/openideCliTurnChanges.ts`
- `vscode/src/vs/workbench/contrib/openideAgent/common/openideMessageChanges.ts`
- `vscode/src/vs/workbench/contrib/openideAgent/browser/openidePlanBreadcrumbActions.ts`

Separate three facts in the model: confidence in turn boundaries, availability
of an exact before/after snapshot, and attribution to a writer. Hooks improve
the first fact; filesystem watchers alone cannot establish the third.

Replace the boolean restore result with explicit restored, conflict, unavailable
and failed outcomes. Record snapshot provenance, existence, content/hash and
version metadata. Pin the Git base at session start; a later `HEAD` is not an
earlier snapshot. Capture existing dirty/untracked content before execution when
feasible within a bounded budget. Never label a first-write-late snapshot exact.

Extract a shared restore engine from the native change-set implementation. Keep
native and CLI adapters responsible for producing evidence; the engine validates
and applies it. Share per-resource serialization across both callers. Account
for multiple windows through an appropriate shared coordinator; a renderer-local
queue cannot serialize another renderer's writes.

Before mutation, validate workspace membership, supported resource type, dirty
editor buffers and expected current content. Recheck at commit and use the file
provider's version/etag protections where available. Preserve recovery copies
for multi-step operations. Do not claim atomicity against arbitrary external
writers or power loss; document and test the guarantees the provider supplies.

Default policy:

- Exact before/after evidence and unchanged current state: restore is eligible.
- Later edits, an active writer, uncertain snapshots, unsupported binary/symlink
  handling or ambiguous ownership: show a conflict/review result without writing.
- Changes observed during a CLI turn remain labeled as observed. If attribution
  is uncertain, offer an explicit snapshot comparison and selected restoration;
  do not imply automatic undo of only the CLI's edits.
- Legacy history without sufficient evidence opens a diff and explains why safe
  restore is unavailable. A heuristic status transition cannot authorize deletion.

Acceptance tests cover edits made before/during/after a turn, tracked and
untracked files, create/delete/rename conflicts, unsaved buffers, two sessions
and two windows touching one file, failed/cancelled execution, repeated restore,
and a write injected between preflight and mutation. Preserve all existing native
rollback tests. The button must report conflicts and retain recoverable content.

## D. Restore the intended source layers

Put shared contracts in `common/`, platform-independent UI in `browser/` and
native IPC adapters in `electron-browser/`. Register desktop implementations
from the desktop entry point. Browser contributions must not eagerly resolve
desktop-only services. Provide an explicit unavailable capability for unsupported
hosts, rather than an implementation that reports success while doing nothing.

Move shared codebase graph contracts out of `vs/code/common` into a suitable
`vs/platform/openideCodebase/common` boundary; retain the indexer implementation
in the shared utility process. Adapt consumers on both sides of IPC together.

Use the existing layer checker and per-environment TypeScript projects. Inspect
dependency cycles introduced by moves. Do not silence violations by widening
checker exceptions or moving UI code wholesale into an Electron folder.

Acceptance: `npm run valid-layers-check` passes, relevant desktop tests pass,
and unsupported browser paths load without trying to obtain native IPC services.
Add the layer check to `.github/workflows/ci-openide.yml` once the existing
violations are resolved; use a fixed no-growth baseline during a staged migration
only if several separately merged changes are necessary.

## E. Reduce the central harness service incrementally

Treat this as behavior-preserving extraction after the correctness fixes. Reuse
`OpenideAuthManager`, `OpenideProviderAccountsService`, `OpenideModelCatalog`,
usage services and existing tool/context helpers. New names below describe
responsibilities, not a requirement to create parallel replacements.

E1: expose narrow provider/account/model services and move picker preferences
to their UI owner. Consumers request those interfaces rather than the entire
agent service. Preserve account persistence and credential access boundaries.

E2: move tool assembly and feature implementations into dedicated modules; extract
voice/transcription and context assembly. Keep permission decisions authoritative
and preserve the external MCP exposure allowlist. Keep configuration registration
separate from tool bodies and command handlers.

E3: extract turn execution with explicit per-run state: conversation identity,
provider/model snapshot, cancellation, retries, compaction and terminal outcome.
Inject provider transport, tool execution, context and permission interfaces.
Keep the central service as a facade while callers migrate. Remove transitional
delegation when all callers use their proper contracts.

Acceptance is based on responsibilities and dependencies, not an arbitrary line
count. A test can execute a turn with a scripted provider and tools without DOM,
Electron startup or a real paid model. Cover cancellation during streaming/tool
execution, retries without duplicate tool effects, failover, compaction, parallel
conversations and exactly one terminal outcome. Run existing UI and session tests
after each extraction. Keep session formats stable or supply versioned migrations.

## F. Make the fork delta visible and reproducible

Add `dev/audit-fork-delta.mjs` with explicit upstream object store, base commit
and fork revision inputs. Default to committed trees; report worktree dirtiness
separately. If the base object is absent, fail with acquisition instructions rather
than reporting an empty delta. Never depend on a maintainer's `.build/` cache.

Produce JSON and a readable summary of additions, modifications and deletions,
grouped by subsystem, including mode changes and non-OpenIDE-prefixed additions.
Use a deterministic counting policy; treat rename detection as supplementary so
similarity heuristics do not change baseline counts. Include both commit IDs.

Add a reviewed exception manifest for deliberate removals and important upstream
edits, with owner, rationale and validation. Unexpected deletion is an actionable
failure; file count alone is not a quality score. Reconcile the sync script's
automatic preservation of absent paths with this explicit removal policy.

Update `dev/codeoss-sync.mjs`, its tests, the synchronization workflow and
`docs/fork-architecture.md`. Publish the delta and conflict report even when an
update fails. Exercise clean sync, staged/unstaged changes, upstream rename/delete,
intentional removals, unrelated local work and conflict continuation in fixtures.
Advance base metadata only after the integration contract is satisfied.

Acceptance: the same pair of commits produces the same inventory in a fresh
checkout and CI. The sync review includes affected subsystem tests and layer
checks in addition to compilation, with reports available when checks fail.

## G. Verify the integrated product and retain the guarantees

Create a small controllable CLI fixture that runs in the real hosted PTY and can
emit hook events, issue MCP requests, edit disposable files, pause and exit. Use
it for deterministic lifecycle tests. It does not establish compatibility with
third-party CLI versions; record separate real-CLI smoke results where available.

Test switching between native chat and hosted CLI, terminal preservation across
tabs, resize, selection delivery, restart/resume, launch failure, owner reload,
plan approval/rejection and diff/restore outcomes. No real model is required for
the blocking suite. Test one CLI with hooks and a launch path without hooks.

Run integration checks on a fresh build, then packaged smoke tests for the
platforms actually distributed. Use native Linux and Windows runners for the
relevant process/filesystem cases. Record macOS as pending while its release
jobs are disabled; do not infer cross-platform evidence from Linux tests.

Add or update gates for IDE bridge ownership, CLI restore, layer boundaries,
turn execution and fork synchronization in `dev/reliability-gates.json`.
Each gate names its command, owner, tests, current platform evidence and demotion
rule. Promote maturity only when the registry's criteria are demonstrated.

## Completion and recovery

Each delivery is reviewable independently, includes its regression tests and
documents changed user behavior. Generate fresh test output for changed source;
do not use the review's pre-existing `out/` as final implementation evidence.
Run the checks appropriate to the affected layer, and broader product tests when
integration or packaging changes justify them.

The work is complete when window isolation is demonstrated in Electron, unsafe
CLI restoration is prevented, layer checks pass in CI, the run runtime can be
tested through injected dependencies, the upstream inventory is reproducible,
and the integrated product tests protect these contracts on supported platforms.

For a regression in an extraction, revert that extraction while retaining the
focused correctness fixes. For a bridge or restore regression, disable the
affected capability with an explicit unavailable state until repaired; do not
restore the shared broadcast or unchecked file-write behavior. Keep migrations
versioned and idempotent, and preserve user sessions and unrelated CLI settings.
