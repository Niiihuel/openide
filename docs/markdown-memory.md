# Agent-authored Markdown memory

OpenIDE can preserve durable project knowledge while the native agent works.
Notes are ordinary Markdown files under `.openide/memory/notes/`; the graph and
optional semantic mirror are derived from those files. This implementation uses
Engram's deliberate save/search/handoff workflow without requiring Engram or
Mem0 to run the IDE.

## Behavior

The agent has `memory_search`, `memory_get`, `memory_save`,
`memory_session_summary`, and `memory_forget`. The same tools are available to
external clients through the existing bridge with the `openide_` prefix. MCP
initialization and tool descriptions explain the workflow. External writes are
attributed to external calls; the IDE does not invent the CLI's original prompt
or claim control over checkpoints inside its model loop.

With automatic capture enabled, the native runtime checkpoints meaningful work
at completion, before compaction, and every eight tool rounds. One bounded
save-only extraction pass classifies the unprocessed delta: save up to three
notes or give an explicit no-change reason. Its ceiling is 1,000 output tokens
and approximately 4,000 input tokens, reduced for the active context limit. It
has no shell, workspace-edit or delegation tools. Normal provider transport
retries can still occur.

Pending transcripts and validated candidates are kept outside the repository.
Cancellation starts no new inference. An interrupted checkpoint can resume in an
active session without replaying workspace tools. The journal retains the
original request and results; each note refers to its source session and message.
Saving a file never upgrades a claim to verified evidence.

Successful native saves show a Markdown link in chat. Project Map indexes each
note with a stable identity, connects explicit paths or `path#symbol` references
inside its own workspace, and exposes the note's source and revision in the
inspector. File fingerprints let the graph identify references needing review.
Unresolved references remain in the document; no edge is invented for them.
Session handoffs are excluded from the default architecture graph and recalled
for their originating native conversation.

## Controls

| Setting | Default | Purpose |
| --- | --- | --- |
| `openide.memory.captureMode` | `automatic` | `automatic`, `manual`, or `off`; independent of graph enablement |
| `openide.memory.maxNoteBytes` | `8192` | Maximum serialized bytes per note |
| `openide.memory.maxNotes` | `500` | Durable note capacity; no automatic eviction of decisions |
| `openide.memory.maxContextTokens` | `3000` | Shared note/code retrieval budget |
| `openide.memory.semantic.enabled` | `false` | Optional Mem0 mirror and semantic candidates |
| `openide.memory.semantic.endpoint` | `http://127.0.0.1:8000` | Local Mem0 OSS REST endpoint |

Manual capture requires a user memory request in the native run. Off prevents
authored writes while existing memories remain readable. Project-memory writes
use a dedicated capability; arbitrary file writes do not inherit it. Native
profile-memory mutations require an expressed preference or remember request and
retain ordinary authorization checks. External clients cannot target profile
memory. A trusted local workspace is required.

The existing `.openide/MEMORY.md` overview and profile `openideAgent/USER.md`
remain compatible. New records are not appended to the overview. Handoffs use
`.openide/memory/sessions/`, with a separate 200-record limit; this repository
ignores that directory in Git. Other projects should decide their own handoff
ignore policy. Durable notes can be versioned deliberately; no automatic commit
is performed.

## Record and update contract

A record has YAML frontmatter followed by its Markdown body. The service assigns
`id`, `revision`, timestamps, `operation_id`, `source_kind`, `source_session`, and
`source_message`. Writers provide a stable `topic_key`, body, kind, and optional
workspace-relative `related` references. The service captures available file
fingerprints in `related_hashes`. Evidence remains `inferred` for generated notes.

Read before updating. `memory_get` returns the current revision and SHA-256
content hash, both required by an update or forget. Refine the same ID when
clarifying a topic. Use `supersedes` when replacing a decision; default recall
hides the old decision. Forgetting the replacement does not reactivate obsolete
advice. Historical records can still be read explicitly by their own IDs.

IDs survive body/title edits and renames within the recognized memory
directories. Duplicate IDs or invalid record files produce conflicts. The native
owner serializes cooperating clients across windows, checks registered dirty
buffers, rejects symbolic/shared hard links, and uses exclusive creation or
atomic replacement with file and directory durability barriers where supported.
Read failures do not become empty documents. Legacy replacement requires one
unambiguous match and checks the resulting size.

This is coordination among participating IDE clients, not a lock against every
external filesystem program. A noncooperating writer can still race the final
replacement boundary. Changed revision/hash checks and dirty-buffer checks reduce
that risk; no universal filesystem transaction guarantee is claimed.

Up to 20 prior revisions per updated note are retained outside the repository.
Forget removes the selected canonical note and its retained revisions, prevents
replaying its creation operation, refreshes the graph, and attempts removal from
configured semantic mirrors. If Mem0 is unavailable, the response identifies
pending mirror deletion and future synchronization retries it. Retrieval already
rejects absent or obsolete canonical records. Raw run-journal and Git history
retention are separate; forget does not purge those archives.

## Retrieval and context reliability

Local retrieval searches full bodies and topics, with bounded excerpts, source
references and matching terms. It reads the canonical files, so a freshly saved
note remains available even if the graph is disabled or rebuilding. Native
context assembly excludes duplicate authored notes from the graph portion and
budgets notes, handoffs and code together.

Compaction has a deterministic emergency projection for short histories with
oversized tool results. The original projection and its fingerprint remain in
the journal. Summary requests respect the selected summarizer's own context
limit. A rebuilt request is checked with fixed instructions, tool schemas and
output reserve before dispatch. Token counts are estimates, not provider BPE
counts; provider overflow recovery remains necessary.

Learning retains a bounded association between turns and retrieved entities.
Repeated identical feedback is idempotent. An explicit rollback after an implicit
`survived` signal still reaches the entities, including after a service restart;
it does not delete independent authored decisions.

## Optional Mem0

The adapter targets the OSS REST API inspected in the reference checkout at
`dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3`. It accepts loopback HTTP(S) endpoints
only. Authentication uses `OPENIDE_MEM0_API_KEY` in the native process environment,
via `X-API-Key`; scoped replacement/deletion requires the server's admin grant.
Credentials are not sent through note metadata or tool arguments.

The mirror sends existing authored text with `infer: false`. Mem0's configured
embedding provider may itself use a remote service; configure that server
accordingly. Results must match the workspace scope, canonical record ID and
current source hash. Exact lexical candidates remain eligible. Network work is
bounded and failure falls back to local recall. No semantic service is installed
or enabled automatically.

The adapter is implemented and its contract is tested. Real semantic retrieval
quality, extraction precision, and provider cost are **not yet measured**; keep
semantic retrieval opt-in until that comparison is available. This is an explicit
remaining evaluation gate, not a demonstrated improvement over local search.

## Validation and reproducibility

Source validation: `npm --prefix vscode run typecheck-client`.
Compile the client before running source-derived tests or the scripts below.
The implementation run retained a targeted compilation helper and complete logs
under `.build/memory-implementation/` without touching unrelated working changes.

The focused Mocha run passed **143 tests** and covers native storage, Markdown identity/linking, memory
checkpoints, Mem0 contracts, graph search, learning, context recovery, tool
permissions, external exposure, system prompts, and chat rendering. It includes
actual temporary-filesystem operations, simultaneous native-owner clients,
stale revisions, duplicate IDs, symlinks, read errors, forgotten-operation replay,
cancellation, pending-candidate recovery, and rollback after restart.

`dev/test-memory-runtime.mjs` launches the real development Electron application
with a deterministic local HTTP provider and disposable workspace/profile. It
checks native saving, automatic capture, graph retrieval, restart recall, and
unsaved-editor protection. On this Hyprland environment its windows are assigned
to workspace 6 without initial focus; the test verifies the workspace assignment.
It saves screenshots and results in `.build/memory-implementation/runtime/`.
On the project's NixOS environment:

```sh
./result-fhs/bin/openide-build -c 'node dev/test-memory-runtime.mjs'
```

`node dev/evaluate-memory-recall.mjs` runs 50 English/Spanish queries over 10
representative topics with a 600-token retrieval budget. The measured local run
retrieved the expected record in **41/50 cases (82%)**, with **zero budget
violations**. Ranking-only latency was approximately **0.03 ms p50 / 0.83 ms p95**
on this machine; those timings exclude filesystem scans, graph work and provider
latency. This small fixture set is a regression baseline, not a production-quality
estimate.

Set `OPENIDE_MEM0_ENDPOINT` explicitly when running that script to compare a real
local Mem0 server at the same budget. It creates an isolated evaluation scope
and attempts to clean up its fixtures afterward. Without an endpoint the report
marks semantic quality unmeasured. HTTP contract fixtures are not a substitute
for that experiment.

Implementation-specific decisions relative to the original plan: extraction
uses the active model with fixed conservative bounds; separate capture-model
settings are deferred. Pending state is a bounded private checkpoint alongside
the journal, not another raw-prompt archive in Git. External clients receive the
protocol through MCP and control their own capture timing. Broader CLI tool
discovery and IDE performance optimization are the next work items.
