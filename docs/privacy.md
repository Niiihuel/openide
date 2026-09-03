# OpenIDE privacy

OpenIDE ships none of Microsoft's proprietary telemetry endpoints. Update checks
query only the signed feed in the `Niiihuel/openide` repository and GitHub
Releases. They send just the technical data an HTTP request needs — product
version, operating system and architecture, via the User-Agent — and never
prompts, code, workspace contents, credentials or personal identifiers.

AI providers and installed extensions have their own policies and their own
connections. OpenIDE displays and stores those credentials locally, but your use
of each provider is governed by that provider's terms.
