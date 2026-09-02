---
title: Accounts authentication
description: How GitHub and Microsoft account authentication behave in OpenIDE, and when an extension triggers it.
---

## GitHub

GitHub authentication has been patched to use personal access tokens. Create one following the [GitHub documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) and select the scopes the extension needs.

On Linux the token is stored in the system keyring; if you see a `org.freedesktop.secrets` error, install `gnome-keyring` (see [Usage](/docs/usage/#linux)).

## Microsoft

Microsoft authentication has not been patched, so its status is unknown.

## When does it happen?

An account authentication only occurs when an extension asks for it.

For GitLens, since version 12 (non-plus), it does not ask for any new authentication.

## AI providers

Provider credentials for the agent are a separate mechanism: they go to `SecretStorage` and are managed from the providers panel. See [Providers and models](/docs/agent-providers/).
