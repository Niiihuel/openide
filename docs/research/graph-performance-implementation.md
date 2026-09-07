# Graph integrity and performance implementation

Date: 2026-09-06. OpenIDE implementation; no third-party code imported.

## Implemented

- The watcher keeps URI revisions until the shared process acknowledges the complete batch. One drain is active; at most eight reads run together, at most 500 changes are submitted, and content is flushed around 4 MiB (under 8 MiB including the final group of eight reads). Stat and bounded reads avoid loading oversized files; oversized files purge their previous graph entry. Recoverable reads retain the revision while other files progress. Rejected IPC batches retry after one second. New events for a URI survive acknowledgement of its predecessor. Trust, workspace, configuration and disposal stop pending work.
- The recursive watcher uses owned `fileService.watch` registrations. This repository's correlated `createWatcher` API only supports `recursive: false`, so it cannot replace the recursive registration here.
- Renderer memory and query caches share one load per generation, discard invalidated results and retry against the latest generation. Failed loads release their in-flight slot. The facade's warm cache no longer calls `getVersion` on every access.
- Shared-process incremental writes, full rebuilds, language-server writes and snapshot composition use the same workspace mutation queue. Snapshot composition cannot interleave a partial write with unrelated graph finalization. IPC content validation counts UTF-8 bytes.
- Storage updates mutate its private file dictionary and adjust node/stale/edge counters by difference; `getManifest` copies the dictionary at its public snapshot boundary. Repeated directory creation is shared. Manifest persistence still happens at existing batch/flush boundaries.
- Query snapshots normalize searchable fields once. Search computes term weights once per request and retains the requested ranked prefix instead of sorting every matching node. Existing substring matches, scores and deterministic tie ordering remain supported.
- Contributions register their watcher and language-server bridge for disposal. Disabling incremental indexing stops the bridge, including a pending outline read. Restored stale indexes now trigger recovery when `indexOnOpen` is enabled; trust and workspace changes recheck that condition.

## Verification

The following command passed **34 tests** (11 new graph regressions plus the existing suites):

```bash
cd vscode
node node_modules/mocha/bin/mocha.js --ui tdd --timeout 10000 \
  out/vs/workbench/contrib/openideAgent/test/node/openideCodebasePerformance.test.js \
  out/vs/workbench/contrib/openideAgent/test/common/openideCodebaseMemory.test.js \
  out/vs/workbench/contrib/openideAgent/test/common/openideMemoryIntegration.test.js
```

New regressions cover 501 and 2,000 events, bounded read concurrency, rejected sends and newer revisions, failed reads, oversized files, disposal during reads, query and facade snapshot races, shared load retries, ranking, storage counters, shared-process mutation ordering and multibyte IPC size validation.

`node dev/probe-memory-indexing.mjs` also passed. The earlier bug reproducer now asserts fixed behavior through public file events. Results include source/output hashes and write to `.build/performance-cli-implementation/reproductions.json`. Observed batches: `[500]`, `[500, 1]`, `[500, 500, 500, 500]`; all 500/501/2,000 distinct files acknowledged, maximum eight reads.

Product modules and tests were transpiled with the repository TypeScript compiler, ES2024/ES2022 modules, decorators enabled and `useDefineForClassFields: false`. The coordinating agent runs the integrated typecheck. No GUI was opened by this workstream.

## Measurements and provenance

The baseline is the original [investigation](../performance-cli-discovery-investigation.md), with archived results and source hashes in [performance-cli-2026-09-06.json](performance-cli-2026-09-06.json). These are synthetic Node fixtures, not production IDE interaction measurements.

| Operation | Baseline | New observation |
| --- | ---: | ---: |
| Insert 5,000 empty file payloads, persistence disabled | 6,109 ms, median of three runs | 5.8 ms, one exploratory run |
| Hot query, 5,000 nodes | p50 5.5 ms | p50 3.0 ms |
| Hot query, 25,000 nodes | p50 24.8 ms | p50 10.2 ms |
| Hot query, 100,000 nodes | p50 100.5 ms | p50 55.0 ms |

New query values come from the updated probe: nine samples after a warm-up, same synthetic names/signatures/query and ranking logic. Its p95/max values were 6.1/15.4/67.2 ms. Another exploratory run yielded p50 3.8/11.2/31.6 ms; parallel development and CPU scheduling add noise. The exploratory storage and earlier query results are retained in `.build/performance-cli-implementation/graph-benchmark.json`. Do not treat the single storage sample as a statistical speedup estimate, or the query figures as renderer FPS. Snapshot construction, IPC, disk and provider latency are excluded from hot query timings.

## Remaining limits

- Restoration currently uses the existing full rebuild to reconcile stale persisted state. A dedicated incremental restore protocol, validation of changed indexing options and bounded cold payload loading remain follow-ups; recovery no longer silently leaves every restored file stale.
- Search still scans normalized candidates in the renderer. It preserves arbitrary substring semantics and does not yet use an inverted index or a worker. Large cold snapshots and a 100,000-node search can still exceed a frame budget.
- The workspace queue deliberately prioritizes consistency: a snapshot waits behind an already active full rebuild. Worker offload and interactive scheduling need traces and cancellation contracts, not bypassing the queue.
- Retrying filesystem failures preserves pending work while the window remains active; it is not a persisted watcher journal. Startup recovery handles process restarts when enabled.
- Installed CLI/model evaluations, complete production startup distributions and memory checkpoint durability belong to their separate workstreams.
