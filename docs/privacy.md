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

## Extensions

The extension marketplace is [Open VSX](https://open-vsx.org), operated by the
Eclipse Foundation, and searching or installing goes there. Extensions
themselves run with your privileges and make their own connections under their
own policies.

## AI providers

Nothing reaches a provider until you connect one, and then everything you would
expect does: your prompts, the file contents and command output the agent
gathers as context, and whatever the tools you allow it to run produce. That
traffic goes to the provider you chose, directly, under that provider's terms.

Credentials are stored in your operating system's secret store — never in
`settings.json`, never in the workspace, and never sent anywhere except to the
provider they belong to. On a Linux machine with no keyring, they live in memory
only and are gone on restart; OpenIDE says so in Settings rather than pretending
they were saved.

## Local servers

The agent host and the IDE server listen on `127.0.0.1` only and require a
token. They exist so agent CLIs on your own machine can talk to the editor;
nothing on your network or the internet can reach them.
