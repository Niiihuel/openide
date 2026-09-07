<!-- order: 0 -->

# Accounts authentication

This page is about the **editor's** account providers, the ones extensions ask
for through the authentication API. AI providers for the agent are configured
separately in Settings → Providers and are covered in
[getting started](./getting-started.md#connect-a-model).

## GitHub

OpenIDE signs in through its own OAuth app, so the GitHub consent screen shows
**OpenIDE** and its logo rather than Visual Studio Code. The client ID
(`Ov23li4DUJIoCYvb0UdZ`) lives in
`vscode/extensions/github-authentication/src/config.ts`.

Because OpenIDE ships no client secret, `getFlows` (see
`vscode/extensions/github-authentication/src/flows.ts`) leaves only two usable
flows:

- **Device code** — the default. OpenIDE shows a one-time code and opens
  https://github.com/login/device to paste it in. The OAuth app must have
  *Enable Device Flow* checked or this fails.
- **Personal access token** — the fallback, offered if the device flow is
  declined. Create one at
  https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token
  with the scopes the requesting extension needs (GitLens asks for `repo`).

The local-server and URL-handler flows are unavailable: the first needs a client
secret, and the second is restricted to clients GitHub redirects to directly.

On Linux the token is stored through the Secret Service; without a keyring
(`gnome-keyring`, KWallet) the sign-in has to be repeated after a restart. See
[usage](./usage.md#signin-github).

## Microsoft

The `microsoft-authentication` extension is shipped as upstream provides it,
with Microsoft's own client registration. It has not been adapted or tested
for OpenIDE; whether a given Microsoft-backed extension can sign in through it
depends on that extension.

## When does it happen?

An account authentication occurs only when an extension asks for it. OpenIDE
itself never triggers a GitHub or Microsoft sign-in.
