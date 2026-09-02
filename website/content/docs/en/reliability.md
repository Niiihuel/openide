---
title: Reliability gates
description: The registry of critical invariants that must hold before a release, its maturity levels and the policy for changing it.
---

OpenIDE records its critical invariants in `dev/reliability-gates.json`. The registry does not replace the tests: it documents which property is protected, who is responsible, which commands verify it, which gaps are still open and under which condition the gate loses maturity.

## Maturity

- `experimental`: initial coverage exists, but it does not yet protect merges or releases.
- `soak`: the contract and its tests are stable; sustained evidence or platform coverage is still missing.
- `blocking`: every promotion criterion is demonstrated, the command runs in the corresponding CI or release workflow, and a reproducible failure blocks merge or release.

`promotionCriteria` lists the conditions still required for the next level. It must therefore be non-empty in `experimental` and `soak` and empty in `blocking`; the validator rejects any contradictory combination. Maturity cannot hide a known failure: if `demotionRule` is violated, the gate must be demoted and a fix task opened before promoting it again.

## Local validation

```bash
node dev/check-reliability-gates.mjs
node --test dev/reliability-gates.test.mjs
```

The validator requires:

- a known schema and strict fields;
- unique kebab-case IDs;
- non-empty owner, layer, invariant and demotion rule;
- allowed maturity values and platforms;
- explicit commands and criteria;
- test paths that are relative, safe and existing.

It does not run the declared commands automatically. CI and the release workflows must invoke the commands relevant to their layer.

## Change policy

Every change that adds a critical surface must:

1. create or update a gate;
2. include reproducible tests;
3. declare real gaps, not aspirational ones;
4. keep paths concrete and current;
5. define when it must block or be demoted;
6. avoid personal metrics, prompts, code or product telemetry.

## Initial scope

The registry starts with:

- signed updater and anti-rollback;
- AppImage update and recovery;
- atomic rollback of messages;
- MCP and Agent Host process lifecycle;
- audit of distributed branding.

It will progressively extend to package smoke tests, subagent leases, extension and skill provenance, network privacy, terminal recovery and legal artifacts.

## Web exploration by the agent

`web_search` and `web_fetch` use a headless downloader separate from the localhost preview. The authoritative boundary lives in Electron's main process and applies HTTPS validation, DNS resolution per hop, blocking of loopback, LAN, link-local and metadata addresses, manual redirects, a total timeout, content-type checks and byte and character limits. No cookies, sessions or credentials of the visible browser are shared. Results deliver `[S#]` and `[W#]` citations; the content is not persisted outside the model transcript and API keys must not travel in URLs or logs. The implementation is static extraction: it does not execute JavaScript, does not solve CAPTCHAs or paywalls and does not crawl without limits.

## Agent Host and MCP

The `agent-host-process-lifecycle` gate covers a first layer of hardening:

- allowlisted inherited environment;
- blocking of `NODE_OPTIONS`, loaders, `NODE_PATH` and CA overrides;
- validation of arguments and environment values;
- maximum size of JSON-RPC frames and HTTP/SSE responses;
- maximum count and bytes of in-flight stdio requests;
- bounded stderr logs created with restrictive permissions;
- bounded input and output for hooks;
- connect and tool deadlines;
- keepalive, host-side backoff and parking;
- process tree cleanup on disconnect, timeout or shutdown.

The gate stays `experimental` until there are multi-process Electron tests for kill-tree, timeout, incremental SSE, HTTP disconnect and crash loop on the three platforms. Workspace Trust gates the project MCP configuration; persistent consent tied to a fingerprint of command, URL, environment and headers will be implemented together with the provenance block for extensions and skills.
