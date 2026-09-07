# OpenIDE privacy

OpenIDE ships none of Microsoft's proprietary telemetry endpoints. There is no
analytics service, no crash reporter and no experiment service: the product has
no telemetry key at all, so the telemetry pipeline is inert in a packaged build
regardless of the setting.

What follows is every connection OpenIDE makes on its own — that is, without you
asking for it.

## Updates

Update checks query the signed feed in the `Niiihuel/openide` repository, and
downloads come from GitHub Releases. They send just the technical data an HTTP
request needs — product version, operating system and architecture, via the
User-Agent — and never prompts, code, workspace contents, credentials or
personal identifiers.

After an update to a new minor version, OpenIDE fetches that version's release
note from this repository to show the card that greets you. Same request shape,
and nothing is sent about you.

## Model catalogue

The first time you open the chat, OpenIDE downloads the model catalogue from
[models.dev](https://models.dev) — the limits, prices and capabilities each
model publishes — and caches it for six hours. **This happens whether or not you
have connected a provider**, so models.dev sees the request the way any website
sees a visitor: an IP address, a time, and nothing identifying the workspace or
you. If you would rather it never happened, the catalogue is a convenience: the
built-in providers work from the entries shipped in the product.

## Welcome page announcements

The welcome page fetches `announcements-extra.json` from this repository so a
notice can be shown without a release. The file is currently empty.
`workbench.welcomePage.extraAnnouncements: false` stops the request.

## Extensions

The extension marketplace is [Open VSX](https://open-vsx.org), operated by the
Eclipse Foundation, and searching or installing goes there. The list of
malicious and deprecated extensions comes from the Eclipse Foundation's
`publish-extensions` repository on GitHub (`extensions.excludeUnsafes`).
Extensions themselves run with your privileges and make their own connections
under their own policies.

## AI providers

Nothing reaches a provider until you connect one, and then everything you would
expect does: your prompts, the file contents and command output the agent
gathers as context, and whatever the tools you allow it to run produce. That
traffic goes to the provider you chose, directly, under that provider's terms.
OAuth sign-in opens the provider's page in your browser and receives the
callback on a local port.

Two things keep talking to a connected provider between conversations:

- **Usage and quota polling** (`openide.agent.usage.enabled`, every
  `openide.agent.usage.pollMinutes`, 15 by default) asks the provider for the
  account's remaining quota so Settings can show it. It is an authenticated
  request to the provider's usage endpoint with no workspace content.
  `openide.agent.usage.cliAccounts` extends this to the accounts of hosted
  CLIs signed in on this machine.
- **Model discovery** re-reads the provider's model list when you open the
  picker or press *Refresh*.

Credentials are stored in your operating system's secret store — never in
`settings.json`, never in the workspace, and never sent anywhere except to the
provider they belong to. On a Linux machine with no keyring, they live in memory
only and are gone on restart; OpenIDE says so in Settings rather than pretending
they were saved.

## Web research

When the agent calls `web_search` or `web_fetch`, OpenIDE makes those requests
itself, from the main process, with no cookies or sessions from the integrated
browser. Search goes to the JSON endpoint in `openide.agent.web.searchEndpoint`
(empty by default, so `web_search` answers with an error until you point it at
a SearXNG-style server or another JSON search API); fetches go to the URL the
model chose, restricted by
`openide.agent.web.allowedHosts` and `openide.agent.web.blockedHosts`, HTTPS
only unless `openide.agent.web.allowHttp`, and never to loopback, LAN,
link-local or cloud-metadata addresses. `openide.agent.web.enabled: false`
removes both tools. Page content is returned to the model and kept in the
transcript, not stored elsewhere.

## MCP servers and hooks

Servers you configure in `.openide/mcp.json` or from the Settings catalog run
with your privileges and connect wherever their command or URL points; the
catalog entries for GitHub, Context7, DeepWiki and the remote GitHub server are
network services. Hooks are shell commands you wrote. OpenIDE asks for consent
per hook and per catalog entry, but what they do afterwards is theirs.

## Local servers

The agent host and the IDE server listen on `127.0.0.1` only and require a
token. They exist so agent CLIs on your own machine can talk to the editor;
nothing on your network or the internet can reach them. The integrated
browser's Playwright session is likewise bound to the local Electron process.
