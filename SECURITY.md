# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use [GitHub's private vulnerability reporting](https://github.com/Niiihuel/openide/security/advisories/new).
It creates a private advisory only the maintainers can read, and it is the
fastest way to reach us. If you cannot use it, write to
`openide.chitchat405@aleeas.com` instead.

Please include what you need to make the problem reproducible: the OpenIDE
version (Help → About), the platform, and the steps or the input that triggers
it. A proof of concept helps; a video without the steps usually does not.

You will get an acknowledgement within a few days. OpenIDE is maintained by one
person in their own time, so a fix is not on a service-level agreement — but you
will be told what is happening and when it ships, and you will be credited in the
advisory unless you ask not to be.

## What is in scope

The code in this repository: the OpenIDE-specific surface (the agent and its
tools, providers and credential handling, the update client and its signature
verification, the local IDE server, settings and the packaging scripts), and the
Code OSS tree as OpenIDE builds and ships it.

Things worth reporting, as examples: a way to read or exfiltrate credentials
from the secret store, an update that installs without a valid signature, the
local agent server reachable or usable without its token, code execution from
opening a repository or a file, and a prompt injection that makes the agent act
outside the permissions the user granted.

## What is out of scope

- **Upstream Code OSS bugs that OpenIDE inherits unchanged.** Report those to
  [microsoft/vscode](https://github.com/microsoft/vscode/security/policy); if
  the fork made them worse or exploitable in a way upstream is not, report it
  here.
- **Extensions and their marketplace.** Extensions run with the user's
  privileges by design, and Open VSX is a third party.
- **AI providers.** What a provider does with a prompt is governed by that
  provider's terms; see [docs/privacy.md](docs/privacy.md) for what OpenIDE
  itself sends.
- Reports produced by running a scanner over the tree, with no analysis of
  whether the finding is reachable in OpenIDE.

## Supported versions

The latest release. There are no long-term support branches: fixes ship in the
next version, and the updater carries it to installations that can auto-update
(see [docs/updates.md](docs/updates.md)).

## Update integrity

Releases are signed with an Ed25519 key and every update manifest is verified
against the public half embedded in the product before anything is installed.
The key id in use is published in `openide-version.json` and `product.json`. If
you find a way to make the client accept a manifest or an artifact that key did
not sign, that is the highest-severity report this project can receive — please
send it privately.
