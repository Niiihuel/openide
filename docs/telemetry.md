<!-- order: 10 -->

# Telemetry and online services

OpenIDE sends no telemetry. This page lists what is off, what the remaining
online settings actually talk to, and how to turn the rest off. The complete
list of connections the product makes on its own is in [privacy](./privacy.md).

- [What is disabled](#telemetry)
- [What the online-service settings point at](#replacements)
- [Turning off the remaining connections](#opt-out)
- [Checking for yourself](#checking)

## <a id="telemetry"></a>What is disabled

The product ships **no telemetry key** (`product.json` has no `aiConfig`), so
the telemetry pipeline has nowhere to send anything and is inert regardless of
settings. On top of that, the defaults differ from upstream:

| Setting | OpenIDE default | Upstream default |
|---|---|---|
| `telemetry.telemetryLevel` | `off` | `all` |
| `telemetry.enableCrashReporter` | `false` | `true` |
| `telemetry.editStats.enabled` | `false` | `true` |
| `workbench.enableExperiments` | `false` | `true` |

There is no experiment service, no crash reporter endpoint and no analytics
service in the build.

**Extensions are a separate matter.** They run with your privileges and follow
their own policies; some Microsoft extensions send telemetry to Microsoft
regardless of the editor's setting. Check each extension's own settings.

## <a id="replacements"></a>What the online-service settings point at

Search the Settings UI for `@tag:usesOnlineServices` to see every setting
upstream marks as contacting a service. Their descriptions still say
"Microsoft online service" because the text is upstream's; in OpenIDE they
resolve to:

| Setting | Talks to |
|---|---|
| `update.mode` | OpenIDE's signed update feed in the `Niiihuel/openide` repository and GitHub Releases. See [updates](./updates.md). |
| `extensions.autoCheckUpdates`, `extensions.autoUpdate` | [Open VSX](https://open-vsx.org), the gallery in `product.json`. |
| `extensions.excludeUnsafes` | The Eclipse Foundation's list of malicious and deprecated extensions at `raw.githubusercontent.com/EclipseFdn/publish-extensions/…/extension-control/extensions.json`. |
| `workbench.welcomePage.extraAnnouncements` | `announcements-extra.json` in this repository, shown on the welcome page. It is currently empty. |
| `workbench.settings.enableNaturalLanguageSearch`, `workbench.commandPalette.experimental.enableNaturalLanguageSearch` | Nothing: the upstream backend is Microsoft-only and OpenIDE ships no endpoint for it. |

## <a id="opt-out"></a>Turning off the remaining connections

For the editor:

- `update.mode`: `manual` checks only when you ask, `none` never checks.
- `update.titleBar: false` hides the title-bar indicator without changing the
  check.
- `extensions.autoCheckUpdates` and `extensions.autoUpdate`: `false`.
- `extensions.excludeUnsafes: false` stops fetching the unsafe-extension list.
  Not recommended: it is the only protection against a known-malicious
  extension already installed.
- `workbench.welcomePage.extraAnnouncements: false`.

For the agent, whose connections only start once you connect a provider or use
a feature:

- `openide.agent.web.enabled: false` disables `web_search` and `web_fetch`.
- `openide.agent.usage.enabled: false` stops polling connected providers for
  quota and usage.
- The models.dev catalog download has no switch; the built-in provider
  entries work without it.

`telemetry.feedback.enabled` stays on: it only controls whether the *Report
Issue* command is offered, and reporting an issue opens the GitHub issue form in
your browser.

## <a id="checking"></a>Checking for yourself

Run the editor with a network monitor (Wireshark, `nethogs`, GlassWire) and an
empty workspace. The only hosts you should see are `raw.githubusercontent.com`
and `github.com` for updates and announcements, `open-vsx.org` when the
Extensions view is open, and `models.dev` the first time the chat opens.
Anything else belongs to an extension or to a provider you connected.
