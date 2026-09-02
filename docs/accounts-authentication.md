<!-- order: 0 -->

# Accounts authentication

## GitHub

OpenIDE signs in through its own OAuth app, so the GitHub consent screen shows
**OpenIDE** and its logo rather than Visual Studio Code. The client ID lives in
`vscode/extensions/github-authentication/src/config.ts`.

Because OpenIDE ships no client secret, `getFlows` (see
`vscode/extensions/github-authentication/src/flows.ts`) leaves only two usable flows:

- **Device code** — the default. OpenIDE shows a one-time code and opens
  https://github.com/login/device to paste it in. The OAuth app must have
  *Enable Device Flow* checked or this fails.
- **Personal access token** — the fallback, offered if the device flow is declined.
  See https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token

The local-server and URL-handler flows are unavailable: the first needs a client
secret, and the second is restricted to clients GitHub redirects to directly.

## Microsoft

The Microsoft authentication hasn't been patched so its status is unknown.

## When does it happen?

An account authentication occurs only when an extension is asking for it.

For `GitLens`, since the `12 non-plus` version, it won't ask for any new authentication.
