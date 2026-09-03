# OpenIDE reliability

OpenIDE records its critical invariants in `dev/reliability-gates.json`. The
registry does not replace tests: it documents which property is protected, who
owns it, which commands verify it, which gaps are still open, and under what
condition the gate loses maturity.

## Maturity

- `experimental`: initial coverage exists, but it does not yet protect merges or
  releases.
- `soak`: the contract and its tests are stable; sustained evidence or platform
  coverage is still missing.
- `blocking`: every promotion criterion is demonstrated, the command runs in the
  corresponding CI or release job, and a reproducible failure blocks the merge or
  the release.

`promotionCriteria` lists the conditions still required for the next level. It
must therefore be non-empty at `experimental` and `soak`, and empty at
`blocking`; the validator rejects any contradictory combination. Maturity may
never hide a known failure. If `demotionRule` is violated, the gate must be
demoted and a fix task opened before it can be promoted again.

## Local validation

```sh
node dev/check-reliability-gates.mjs
node --test dev/reliability-gates.test.mjs
```

The validator requires:

- a known schema and strict fields;
- unique kebab-case IDs;
- non-empty owner, layer, invariant and demotion rule;
- allowed maturity levels and platforms;
- explicit commands and criteria;
- test paths that are relative, safe and existing.

It does not run the declared commands itself. CI and the release workflows are
responsible for invoking the commands relevant to their layer.

## Change policy

Any change that adds a critical surface must:

1. create or update a gate;
2. include reproducible tests;
3. declare real gaps, not aspirational ones;
4. keep paths concrete and current;
5. define when it should block or be demoted;
6. avoid personal metrics, prompts, code or product telemetry.

## Initial scope

The registry starts with:

- the signed, anti-rollback updater;
- AppImage update and recovery;
- atomic per-message rollback;
- MCP and Agent Host process lifecycle;
- the distributed branding audit.

It will grow to cover package smoke tests, subagent leases, extension and skill
provenance, network privacy, terminal recovery and legal artifacts.

## Agent web exploration

`web_search` and `web_fetch` use a headless downloader separate from the
localhost preview. The authoritative boundary lives in the Electron main process
and enforces HTTPS validation, per-hop DNS resolution, blocking of
loopback/LAN/link-local/metadata addresses, manual redirects, a total timeout,
content-type checks and byte and character limits. No cookies, sessions or
credentials are shared with the visible browser. Results carry `[S#]` and `[W#]`
citations; content is not persisted outside the model transcript, and API keys
must never travel in URLs or logs. The implementation is static extraction: it
runs no JavaScript, solves no CAPTCHAs or paywalls, and does no open-ended
crawling.

## Agent Host and MCP

The `agent-host-process-lifecycle` gate covers a first hardening layer:

- an allowlisted inherited environment;
- blocking of `NODE_OPTIONS`, loaders, `NODE_PATH` and CA overrides;
- validation of arguments and environment values;
- maximum JSON-RPC frame size and HTTP/SSE response size;
- a cap on the number and total bytes of in-flight stdio requests;
- bounded stderr logs created with restrictive permissions;
- bounded input and output for hooks;
- connect and tool deadlines;
- keepalive, host-side backoff and parking;
- process-tree cleanup on disconnect, timeout and shutdown.

The gate stays `experimental` until there are multi-process Electron tests for
kill-tree, timeout, incremental SSE, HTTP disconnect and crash-loop on all three
platforms. Workspace Trust blocks project-level MCP configuration; persistent
consent bound to a command/url/env/headers fingerprint will land together with
the extension and skill provenance work.
