<!-- order: 1 -->

# OpenIDE documentation

## Using OpenIDE

- [Getting started](./getting-started.md) — install, where files live, connect a model, first conversation
- [Usage](./usage.md) — GitHub sign-in, portable mode, terminal, Markdown validation, UI language
  - [Accounts authentication](./accounts-authentication.md) — the editor's GitHub and Microsoft providers
- [Harness, memory and tool reference](./harness.md) — native tools, Project Map, settings, hosted CLIs and visual workflows
- [Voice transports](./voice-transports.md) — supported dictation formats and custom providers
- [Keyboard shortcuts](./keyboard-shortcuts.md) — the shortcuts and commands OpenIDE adds
- [Updates](./updates.md) — how OpenIDE checks for, verifies and applies updates
  - [Update notes](./updates/README.md) — the "what's new" card shown after an update
- [Migration](./migration.md) — moving settings and extensions from Visual Studio Code
- [Troubleshooting](./troubleshooting.md)

- [Markdown memory](./markdown-memory.md) — automatic notes, Project Map, controls and validation

## Extensions

- [Extensions and the marketplace](./extensions.md)
  - [Getting an extension that is not on Open VSX](./extensions.md#missing)
  - [Using a different gallery](./extensions.md#howto-switch-marketplace)
  - [Self-hosting a gallery](./extensions.md#howto-selfhost-marketplace)
  - [Proprietary extensions and API proposals](./extensions.md#proprietary-extensions)
- [Extensions compatibility](./extensions-compatibility.md) — what does not run and what replaces it
- [GitHub Copilot](./ext-github-copilot.md)

## Privacy and security

- [Privacy](./privacy.md) — every connection OpenIDE makes on its own
- [Telemetry and online services](./telemetry.md) — what is off and what the remaining settings talk to
- [Security policy](../SECURITY.md) — how to report a vulnerability

## Releases

- [Release notes](./releases/1.2.0.md) and the [release review](./reviews/1.2.0.md) for 1.2.0
- [Code OSS 1.136.1 integration](./codeoss-1.136.1.md) — the last upstream migration and what it validated

## Contributing

- [Contributing guidelines](../CONTRIBUTING.md)
- [Building OpenIDE](../BUILD.md)
- [Fork architecture](./fork-architecture.md) — how the vendored Code OSS tree is laid out, where OpenIDE's own code goes, and how upstream updates land
- [Fork hardening implementation](./fork-hardening-results.md) — changes, validation and pending release evidence
- [Harness comparison with DeepSeek](./harness-comparison-deepseek.md) — local source comparison and prioritized improvements
- [OpenIDE harness evolution](harness-evolution.md) — execution, durable history, workspace observations and process/worktree isolation.
- [Performance and CLI discovery investigation](./performance-cli-discovery-investigation.md) — measured bottlenecks, index integrity reproductions and integration plan
- [Reliability gates](./reliability.md) — invariants that must hold before a release
- [Surfaces and themes](./theming-surfaces.md) — how OpenIDE's own UI gets its colours, and the ways it has gone wrong
- [Product demo shooting script](./demo/openide-90s-en.md) — 88-second English demo and draft captions

## Other

- [Other resources](./others.md)
  - [What are reh and reh-web archives?](./others.md#reh)
