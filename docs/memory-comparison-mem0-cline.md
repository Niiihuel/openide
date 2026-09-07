# Memory architecture review: OpenIDE, Mem0 and Cline

Review date: 6 September 2026. Recommendation: keep OpenIDE's native memory and
code graph, fix their consistency and retrieval gaps, then evaluate semantic
recall behind an optional provider. Mem0 can complement the system; it should
not become a second authoritative project memory or replace the code graph.
Cline is particularly useful as a reference for context budgeting and session
continuity.

## Scope and evidence

The analysis inspected actual code, not just feature lists:

- OpenIDE HEAD `72c2545ea9750d0f9630813a140157842410ecaa`, **including the existing
  modified and untracked working-tree files**. In particular, the newer journal,
  compactor, restore engine and `platform/openideCodebase` extraction were included.
- [Mem0 at `dae67f74`](https://github.com/mem0ai/mem0/tree/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3),
  shallow clone at `/home/nihuel/projects/personal/refs/mem0`.
- [Cline at `dac3b35b`](https://github.com/cline/cline/tree/dac3b35ba485dbab3b5a73aca239b0d07ce071cf),
  shallow clone at `/home/nihuel/projects/personal/refs/cline`. This revision has
  a monorepo and SDK; older articles about its former context manager are not
  an accurate map of these sources.

Six focused probes executed the actual OpenIDE TypeScript modules, transpiled
in memory, with simulated filesystem, storage and dependency-injection services.
All six observed the behaviors described below. This is module-level evidence,
not a full Electron integration run or a measurement of model quality.

Reproduction assets live outside the product repository:

- [Probe script](/home/nihuel/projects/personal/refs/openide-memory-analysis-2026-09-06/reproduce.cjs)
- [Observed results](/home/nihuel/projects/personal/refs/openide-memory-analysis-2026-09-06/results.json)
- [Inspected source fingerprints](/home/nihuel/projects/personal/refs/openide-memory-analysis-2026-09-06/source-snapshot.json)

Run with the existing local TypeScript installation:

```sh
node /home/nihuel/projects/personal/refs/openide-memory-analysis-2026-09-06/reproduce.cjs
```

No product implementation was changed, external model credentials used, or
Mem0/Cline dependency installation performed. Their complete test suites and
published quality benchmarks were not run.

## What OpenIDE already does well

**Keep the distinct memory layers.** Project conventions in `.openide/MEMORY.md`
and profile preferences in `USER.md` are human-readable. The code graph is a
derived index with typed relations, source locations, providers and confidence.
Learning signals are local metadata, and the run journal records execution
history. A session summary, a coding convention and an inferred call edge should
not acquire the same semantics merely because they can all be embedded.

**Keep the graph's evidence and invalidation.** The shared process separates
workspace runtimes and serializes graph mutations. Restored indexes are marked
stale; `graphVersion` detects unfinished finalization. Notes become nodes and
explicit mentions resolve only when unambiguous. This is a stronger basis for
code navigation than extracting natural-language entities from chat.
See [the channel](../vscode/src/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryChannel.ts),
[storage](../vscode/src/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryStorage.ts)
and [note linking](../vscode/src/vs/platform/openideCodebase/common/openideCodebaseNotes.ts).

**Keep cross-client reuse.** The native agent and supported hosted CLIs already
share project notes and Project Map through the IDE bridge. External memory
arguments are forced to project scope. Another memory server is unnecessary just
to make those clients share knowledge.
See [external exposure](../vscode/src/vs/workbench/contrib/openideAgent/common/openideIdeExposure.ts:160).

**Build on the recent recovery work.** The current journal already preserves
pre-compaction history and effective requests; the compactor rejects concurrent
history changes. The restore engine already has preparation, conflict checking
and recovery handling. These are implemented foundations, not missing features
to add from scratch. See [harness evolution](harness-evolution.md).

## Confirmed gaps in OpenIDE

### 1. Memory writes can lose durable knowledge — first priority

In [openideAgentMemory.ts](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentMemory.ts:94),
`mutate()` reads the file, builds a string, then writes it without an expected
revision or a per-resource mutation owner.

The concurrent probe issued two additions against one instance. Both returned
`OK`, but only the second survived. The graph channel's mutation queue does not
protect this separate authored-memory path. Multiple conversations or clients
make this a practical consistency concern.

The same class's `read()` catches **every** read error and returns an empty string.
The second probe simulated a failed read followed by a successful write: adding
a note overwrote the existing memory. Only a missing file should mean empty
memory; permission, transport and other read failures should stop a mutation.

Recommended change: one authoritative mutation service per canonical resource,
shared by native and bridge callers; revision/hash preconditions; serialized
cooperating writers; conflict-aware writes through `IFileService`; and a bounded
revision history. A renderer-only mutex is insufficient across windows. Retain
the existing Markdown format and reconcile manual edits rather than overwriting
them. Add crash and actual-provider concurrency tests during implementation.

### 2. The memory store ceiling is bypassable

The size check at [line 132](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentMemory.ts:132)
only applies to `add`. The probe used `replace` to store 7,003 characters in user
memory despite its 1,500-character ceiling. Also, `old_text` is described as
unique, but the implementation accepts the first substring match without checking
ambiguity.

Apply size and uniqueness rules to the resulting document for every operation.
For an already oversized file, allow a reducing consolidation while rejecting
growth. Prefer stable entry identifiers with expected revisions over arbitrary
substring replacement, while keeping compatibility for older clients.

### 3. Retrieval misses the body of long notes

[Note extraction](../vscode/src/vs/platform/openideCodebase/common/openideCodebaseNotes.ts:220)
keeps the full note in `documentation` but caps its name at 80 characters.
[searchableNodeText](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseQueryService.ts:311)
searches name, qualified name, URI and signature; it excludes `documentation`.

The probe found a note by an early word and failed to find it by
`QuasarRecovery`, present only later in that same note. Graph traversal can
occasionally recover such a note through a linked entity, but direct text
retrieval is incomplete. The native full-file snapshot can also mask the problem;
it does not fix Project Map queries.

First index the complete note text and headings, with scoring appropriate to
note bodies. Then evaluate BM25 and optional semantic retrieval. Do not use an
embedding dependency to compensate for an omitted searchable field.

### 4. Implicit success prevents later outcome correction

[creditPreviousTurnSurvived](../vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatController.ts:782)
credits the previous turn when the conversation continues.
[recordOutcome](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideProjectMapLearningService.ts:120)
then deletes its context association. A later rollback cannot correct it.
The probe remained `tentative` after `survived` followed by `rollback`.

Keep a bounded persisted association between turn, retrieved entities and outcome
events. Deduplicate event IDs, but let explicit keep/revert/rollback supersede
implicit signals. Continuing to talk is weak evidence of usefulness, not proof
that the remembered fact was correct. Attribution to every injected entity is
also coarse; distinguish retrieved, actually used, changed and verified entities.

In this revision, learning state is rendered into selected context via
`learning.getState()`. The query scorer itself does not use it. Consequently,
describe the existing behavior as an annotation for the model, rather than
claiming a learned retrieval ranking already exists.

### 5. Compaction cannot handle short oversized histories

[planContextCompaction](../vscode/src/vs/workbench/contrib/openideAgent/common/openideContextCompaction.ts:64)
returns no plan when the message count is at most `minimumTailMessages + 2`.
The default is eight tail messages. A three-message fixture containing a large
tool result estimated at 50,024 tokens produced no plan for a 16,000-token window.
This reproduces a planner limitation; it is not a live provider experiment.

The [runtime overflow branch](../vscode/src/vs/workbench/contrib/openideAgent/common/openideTurnRuntime.ts:115)
retries only if the same compactor succeeds. Add a deterministic emergency
projection driven by token pressure rather than message count. Preserve the
active user request and tool-call/result consistency, reduce oversized tool
payloads, and return an explicit cannot-fit result when protected content alone
exceeds the budget.

Two related static findings deserve coverage in that work:

- The compactor sizes the summarization transcript using the active
  `contextLimit` before resolving its auxiliary model. That model's own input
  limit is not part of `IOpenideCompactionProvider`.
- Successful compaction checks relative savings, but does not establish that the
  complete rebuilt request, including fixed context and output allowance, fits.

See [the compactor](../vscode/src/vs/workbench/contrib/openideAgent/common/openideContextCompactor.ts:80).
These two findings were inspected statically, not independently exercised by the
six probes.

## What to take from Mem0

The current implementation differs from its older extract/UPDATE/DELETE loop.
The inferred ingestion path performs one additive extraction call, embeds facts
in batches, deduplicates exact hashes against retrieved candidates and the batch,
records history, and links entities. Explicit update/delete APIs still exist;
“additive” does not mean deletion is impossible.
See [Python ingestion](https://github.com/mem0ai/mem0/blob/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3/mem0/memory/main.py#L879)
and [TypeScript ingestion](https://github.com/mem0ai/mem0/blob/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3/mem0-ts/src/oss/src/memory/index.ts#L838).

Useful ideas for OpenIDE:

- Extract **candidate** durable decisions or preferences from completed turns,
  carrying the originating message/tool result. An assistant claiming a test
  passed should not outrank the actual failed test output.
- Record revisions and supersession instead of letting an extraction model
  silently erase previous evidence. Apply retention and explicit deletion across
  derived indexes too.
- Combine exact symbol/path matches, full-text note retrieval and optional
  embeddings. Expose retrieval reasons and score components, as Mem0's `explain`
  option does. Scores measure retrieval relevance, not truth probability.
- Require explicit workspace/profile/session scopes and provider capability
  metadata at the adapter boundary.

There are material limits to copying Mem0 directly:

1. **Cloud and OSS differ.** The OSS Python implementation rejects `timestamp`
   on `add` and `reference_date` on `search`; basic `expiration_date` filtering is
   implemented. These are not interchangeable temporal capabilities. Its README
   explicitly attributes the headline benchmark scores to the managed platform,
   including proprietary optimizations. Those numbers do not establish the
   quality of a local OpenIDE integration.
   [Search implementation](https://github.com/mem0ai/mem0/blob/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3/mem0/memory/main.py#L1379),
   [README](https://github.com/mem0ai/mem0/blob/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3/README.md).
2. **The candidate pool is semantically gated.** In the inspected Python and TS
   searches, keyword/entity signals boost candidates originating from semantic
   search. A keyword-only hit outside that pool is not independently introduced.
   For code identifiers, implement a union of lexical, semantic and graph
   candidates before fusion, instead of inheriting this limitation.
   [Python candidate construction](https://github.com/mem0ai/mem0/blob/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3/mem0/memory/main.py#L1670),
   [TS candidate construction](https://github.com/mem0ai/mem0/blob/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3/mem0-ts/src/oss/src/memory/index.ts#L1548).
3. **Persistent local storage does not imply scalable retrieval.** The TS
   `MemoryVectorStore` persists in SQLite via `better-sqlite3`, but its search
   loads rows and computes similarities in JavaScript. It is usable for an
   experiment, not evidence of an ANN index suitable for an entire large codebase.
   [Vector store](https://github.com/mem0ai/mem0/blob/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3/mem0-ts/src/oss/src/vector_stores/memory.ts#L352).
4. **Defaults introduce extra providers.** TS defaults select OpenAI for
   extraction and embeddings; telemetry is enabled unless configured otherwise.
   A local integration must explicitly choose providers, data paths and telemetry
   policy. Native SQLite packaging also needs Electron ABI validation.
   [Defaults](https://github.com/mem0ai/mem0/blob/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3/mem0-ts/src/oss/src/config/defaults.ts),
   [telemetry](https://github.com/mem0ai/mem0/blob/dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3/mem0-ts/src/oss/src/utils/telemetry.ts).

An optional TypeScript OSS adapter is technically plausible; a Python sidecar,
Neo4j service or cloud subscription is not inherently necessary. Prefer an
isolated Node/shared-process adapter using OpenIDE-owned scope enforcement and
timeouts. Keep Markdown/journal sources authoritative and the provider's index
replaceable. Benchmark Spanish questions and English identifiers explicitly;
natural-language entity extraction is not a replacement for LSP evidence.

## What to take from Cline

**Memory Bank is a documentation methodology.** Its six Markdown files separate
project purpose, architecture, technical setup, active focus and progress. It is
not a built-in vector memory engine. Take the separation of stable knowledge and
active work; do not require OpenIDE to read another six full files at every turn.
Offer an optional importer if users already have this format.
[Memory Bank source](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/docs/best-practices/memory-bank.mdx).

**Make budget reduction an explicit result.** Cline's budget projection reports
what it truncated, dropped or preserved, why, whether the live tail survived and
whether the target was achievable. This maps well to OpenIDE's existing context
panel and journal.
[Budget contract](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/sdk/packages/core/src/extensions/context/budget-projection/types.ts).

**Separate normal summarization from emergency recovery.** Cline's overflow
recovery uses deterministic basic compaction, checks a custom result against
the target and avoids depending on another successful LLM call. Its agentic
summarizer separately resolves the auxiliary model's own input budget.
[Overflow handling](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/sdk/packages/core/src/extensions/context/compaction.ts),
[auxiliary budgeting](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/sdk/packages/core/src/extensions/context/agentic-compaction.ts#L154).

**Persist the compacted view's provenance.** Cline stores a versioned projection
with source message count and prefix hash, then validates that prefix before
reapplying the summary after resume. OpenIDE already has the original journal;
add a durable projection descriptor referencing journal sequence/hash and the
summary version, rather than building a second history subsystem.
[Projection state](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/sdk/packages/core/src/session/models/session-compaction.ts#L134).

**Borrow restore transaction boundaries, not whole-workspace resets.** Cline's
restore transaction captures state and exposes commit/rollback. OpenIDE should
continue strengthening its existing change-set restore flow, which understands
live editors and concurrent edits; copying the Git-reset strategy would be a
poor fit for that ownership model.
[Cline transaction](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/sdk/packages/core/src/session/checkpoint-restore.ts#L43),
[OpenIDE restore engine](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideRestoreEngine.ts).

## Proposed architecture

Keep authored project Markdown and profile preferences as durable, editable
sources. Add revisioned entry metadata through one memory mutation service. The
run journal remains the source for session events and tool evidence; compacted
handoffs are derived views. The existing graph and any new full-text/vector
indexes remain rebuildable caches.

Each structured memory record should carry a stable ID, kind, scope, source
reference, content revision/hash, creation/verification times and status such as
candidate, confirmed, superseded or retracted. Code-related facts also carry
repository/worktree identity and the relevant source revision. Store an explicit
supersedes relationship when a decision changes. Do not expire a confirmed user
preference simply because an unrelated session is old.

Retrieval should apply scope and validity filters, union lexical/semantic/graph
candidates, deduplicate by stable identity, rank by task relevance, and pack the
result under a **single** request budget. Reserve space for the active user turn,
tool schemas and output before spending on optional recall. Inject pinned
preferences and selected facts; avoid injecting the full project file plus the
same notes again through graph retrieval.

Classify remembered text by origin. Project notes may be authored by humans,
native agents, or external CLIs; the current `authored` graph provider identifies
the extraction source, not factual verification. Retrieved memories should remain
context data, not implicitly acquire the authority of rules or user permission.
Expose source, age, conflict and “why retrieved” details in the existing panel,
with edit/forget controls. Connect forgetting to graph, vector and session-derived
cache invalidation instead of deleting only a visible row.

## Implementation sequence and acceptance

**First: make current memory dependable.** Fix read-error handling, concurrent
mutation ownership, revision checks, all-operation size limits, ambiguous edits
and full note text search. Turn the focused probes into the appropriate native
unit/integration tests. Acceptance: concurrent acknowledged notes survive; stale
writes conflict; a failed read cannot erase memory; long-note body terms are found.

**Second: close budgeting and continuity gaps.** Add deterministic emergency
projection, auxiliary-model budgets, full-request fit checks, persisted projection
provenance and revisable learning outcomes. Acceptance: recover the short oversized
tool fixture; keep valid tool pairs and the latest user request; reject stale
projections after editing history; an explicit rollback changes the prior signal.

**Third: make durable knowledge structured.** Introduce IDs, source attribution,
supersession, session handoffs and candidate extraction from completed journal
events. Acceptance: a new conversation resumes pending work without promoting
temporary state to a permanent convention; a corrected preference replaces the
active view while retaining its revision history; concurrent worktrees remain scoped.

**Finally: run an optional Mem0 experiment.** Compare the corrected lexical/graph
baseline with full-text fusion and a Mem0 OSS adapter on the same frozen tasks.
Keep it disabled by default until it demonstrates a useful tradeoff. Test failure,
timeout and offline fallback before considering a hosted provider.

Use a proposed 40–60-case local evaluation set covering Spanish paraphrases,
English symbols, long notes, contradictory decisions, renamed/deleted files,
worktree drift, cross-client writes, resume and forget. Measure recall at a fixed
token budget, invalid/superseded retrieval rate, task completion with tool evidence,
tokens injected, p50/p95 retrieval latency and extraction/embedding calls. Include
cross-workspace isolation and adversarial remembered instructions as pass/fail
cases. These are proposed measurements; this review does not claim unmeasured
percentage improvements or cost savings.

The first implementation slice should be memory consistency plus full-text note
retrieval. It provides direct value with the current architecture and produces a
credible baseline for deciding whether Mem0 adds enough to justify its runtime,
packaging and provider costs.
