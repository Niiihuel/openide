# CLI discovery implementation — 6 September 2026

The implementation adds a shared capability catalog (browser, Project Map, Markdown memory, plans and editor context), concise MCP initialization instructions and `openide_capabilities` progressive help. Help reports **registered tools and runtime prerequisites**, not an assumption that a browser or index is ready. Existing tool names and the external allowlist remain intact.

Reapplying the new description transform to the original measured 24-tool catalog reduces repeated context from **13,214 to 4,103 UTF-8 bytes (69%)**. The longest resulting description is **978 bytes**; none exceeds 2 KiB. This measures serialized description bytes, not tokenizer tokens or spontaneous model selection. Results: `.build/performance-cli-implementation/cli-description-budgets.json`.

## Behavior and verification

- The terminal now distinguishes preparing, configured but unverified, failed, explicit/manual and unavailable integration. Expand the secondary tools row for intent examples and observed **window-level** MCP initialization/listing. It never identifies a specific CLI from `clientInfo.name`, and never equates writing a config with a successful model connection.
- Host observations include timestamps and tool count only. They reset when the server stops. Authentication, workspace ownership and existing window credential lifetime remain unchanged.
- Exposed tools use a typed `{output,isError}` path. Argument/approval/guard failures, cancellation and thrown failures become MCP `isError`. Screenshot/video content blocks and blocking plan review retain their previous transport. Browser handlers normalize their own anchored `Error:` sentinel at the browser boundary; unrelated successful prose is not searched for error words. New canonical memory handlers already throw on CAS/validation failures.
- Claude receives a separate launch settings file containing a `SessionStart` hook. The documented event covers initial start, resume and post-compaction. It emits bounded `additionalContext` only with the hosted session/owner environment present, drains stdin otherwise, and does not alter personal hooks or permission decisions. MCP configuration and hook settings are 0600 files owned and cleaned up by the existing window host. The shell output and unowned-launch guard were executed against fixtures. Actual model consumption across compaction is not certified.
- Session config failures are visible. Config publication checks workspace generation after async writes, and injected server keys include the window port to avoid shadowing an ordinary personal `openide` entry.
- Focused Node suite: **68 passing** across external policy/description, CLI launch/config, typed execution and HTTP server ownership/discovery. Log: `.build/performance-cli-implementation/cli-tests.log`. The real hosted-PTY fixture also now covers capability help, truthful window observations and invalid-memory-write `isError`; the coordinating test run records its actual outcome separately.

## Adapter matrix and sources

| CLI | Implemented connection | Evidence and remaining limit |
| --- | --- | --- |
| Claude Code | Additive `--mcp-config` and `--settings` files per launch | Existing adapter retained; SessionStart JSON/shell scoping tested. [Official hooks](https://code.claude.com/docs/en/hooks), [MCP](https://code.claude.com/docs/en/mcp). Real-model recall/compaction evaluation remains separate. |
| Codex | Launch `-c` server overrides; bearer from named environment variable | Existing adapter and argv/resume tests retained. [Official MCP](https://developers.openai.com/codex/mcp). The hosted fixture is Codex-shaped, not a real Codex model. |
| OpenCode | Launch `OPENCODE_CONFIG` file | Existing 1.17.12 mechanism retained. [Official merge behavior](https://opencode.ai/docs/mcp-servers/). A pre-existing custom `OPENCODE_CONFIG` environment override is not merged by this adapter; personal default/project configs follow the CLI's precedence. |
| Amp | New additive `--mcp-config` file with a **direct server map** | Fixed official `@ampcode/cli-linux-x64@0.0.1788739286-gf348fe`: help verified; `mcp list` with isolated settings showed both existing fixture and session-added server. Personal fixture contents preserved. Account server lookup returned 401; no model was invoked. [Official loading precedence](https://ampcode.com/docs/customize/mcp). Remote orbs do not inherit a local endpoint. |
| Copilot | New additive `--additional-mcp-config @file`; HTTP schema, headers, tool filter and timeout | Fixed official `@github/copilot-linux-x64@1.0.83` confirms the launch flag. [Official remote schema and permission semantics](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference). `mcp list` does not include the interactive launch override, so that command is **not** evidence of a successful connection; full model/transport certification remains pending. `tools:["*"]` exposes the server catalog; it grants no automatic invocation permission. |
| Grok | Existing explicit registration with unique owned name | Installed 1.0.13 help verifies `mcp remove --scope user` and `mcp doctor --json`; stale catalog comment corrected. No automatic removal of old entries: stored provenance does not prove the user left external config unchanged. |
| Gemini | Explicitly unavailable automatic adapter | No verified additive launch mechanism; no administrative settings override or personal config mutation. [Official MCP](https://geminicli.com/docs/tools/mcp-server/). |
| Droid | Explicitly unavailable automatic adapter | No verified additive launch mechanism. [Official MCP](https://docs.factory.ai/harness/mcp). |

Fixed CLI packages and help files are isolated under `.build/performance-cli-implementation/cli-packages/`; they are not globally installed. No approval bypass flags, strict replacement of other MCP servers, automatic CLI authentication or model requests were added.

## Deliberately unimplemented security boundary

Automatic approval review rejected the proposed broad rewrite adding host-minted per-launch HTTP credentials, ticket issuance, independent revocation and IPC identity changes, citing security-boundary exposure/disruption risk and insufficiently specific authorization. The safer completed alternative adds **read-only window-scoped discovery evidence** while retaining the existing authentication implementation. Independent session revocation and authoritative per-CLI attribution therefore remain pending, and the UI explicitly does not claim them. No rejected mutation ran and no alternate route was used to perform it.

Eight real-model discovery evaluations, restart/compaction certification in each external CLI, and a production startup A/B are not supplied by these contract tests. In particular, an external model is responsible for deciding when to call memory tools; a hook or registered schema is not proof that a canonical Markdown save occurred.

## Authenticated Claude evaluation

The user explicitly authorized using the existing authenticated `/home/nihuel/.local/bin/claude` from PATH. Version 2.1.263 completed two real model invocations through the live OpenIDE MCP endpoint in an isolated Xvfb product window. A transparent test launcher supplied fixed prompts to that binary; it did not simulate model responses or tool choices. The existing Claude authentication was reused, without changing personal configuration.

The first fresh invocation selected capability help for all five families, searched/read the empty project memory, and saved `payments/retry-policy`. The test independently verified the canonical Markdown file on disk. A second invocation with no shared conversation history selected memory search/get and recovered the same decision and canonical path without writing. Both returned success and zero permission denials. Their CLI elapsed times were about 31 and 10 seconds.

This evaluation isolates the supplied MCP server and grants only the six relevant test tool names for the invocation. It uses print mode, disables conversation persistence and built-in tools, and runs in a disposable repository. Therefore it demonstrates real-model discovery and cross-session canonical recall under this controlled setup; it does not certify spontaneous capture in an ordinary unrestricted session, interactive permission prompts or post-compaction recall. At the time of that Claude evaluation, other clients remained untested with real models; see the Codex evaluation below.

Reproduce only with explicit authorization to consume Claude usage:

```bash
OPENIDE_LIVE_CLAUDE=/home/nihuel/.local/bin/claude ./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-claude-live.mjs'
```

Artifacts: `.build/performance-cli-implementation/claude-live/result.json` and the two streamed event logs. The temporary workspace and IDE profile are removed after the run; the report retains the synthetic note as evidence.


## Codex natural-intent regression — 7 September 2026

The reported session already had a working OpenIDE MCP endpoint and all 37 tools. Codex 0.153.4 nevertheless selected another plugin's computer/browser inventory for a natural-language request about OpenIDE's internal browser. Explicit OpenIDE tool names worked. Richer MCP descriptions alone did not fix the controlled natural-intent reproduction.

The launch adapter now adds a private, random, mode-0600 Codex profile containing concise OpenIDE orientation and the effective existing developer instructions read through `config/read`. It preserves the user's main configuration and other plugins; the existing host removes the profile on disposal. The server also answers `resources/templates/list` with an empty list and capability help lists only registered entry tools. Orientation maps natural browser, memory, map, plan and editor requests to available tools.

With the authenticated Codex binary and `gpt-5.6-luna`, three natural Spanish requests selected the intended tools: browser snapshot, memory search/get, and project-map query. This is a real-model selection test against controlled read-only MCP fixtures, not certification of the underlying browser or index implementation. No credentials were changed. Results: `.build/codex-discovery/live/result.json`.

Credential-free profile checks also passed for preservation of global instructions, project AGENTS.md, unchanged configuration and file permissions. An explicit project `developer_instructions` override retains Codex's higher precedence and can replace the added orientation. Older Codex versions without `CONFIG_PROFILE_V2` keep MCP-only discovery. Neither case is claimed to guarantee natural tool selection.

Validation: client transpilation, client typecheck and layer checks passed; 62 focused unit tests and 14 hosted-PTY/isolated-GUI checks passed. The hosted GUI uses a fixture CLI; it is distinct from the three real-model tests. These changes are in source, not in the installed 1.3.0 release.

Reproduction (live test consumes usage from the configured account):

```bash
OPENIDE_TEST_CODEX=/home/nihuel/.npm-global/bin/codex node dev/test-codex-context.mjs
OPENIDE_LIVE_CODEX=/home/nihuel/.npm-global/bin/codex OPENIDE_CODEX_TEST_MODEL=gpt-5.6-luna node dev/test-codex-live.mjs
```
