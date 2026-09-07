<!-- order: 16 -->

# GitHub Copilot

OpenIDE does not bundle GitHub Copilot or Copilot Chat. Code OSS ships the
Copilot Chat extension in its tree; OpenIDE removes it (`extensions/copilot`)
because the product has its own agent, and upstream's chat surfaces are hidden
behind `chat.disableAIFeatures`, which is `true` by default.

What remains is the descriptor upstream uses to *recognise* Copilot Chat:
`vscode/product.json` still carries the `defaultChatAgent` block for
`GitHub.copilot-chat` and lists it in `extensionsEnabledWithApiProposalVersion`.
That is inherited configuration, kept so upstream syncs do not conflict; it
does not install or enable anything.

## Using the Copilot CLI instead

Copilot's coding CLI can run inside OpenIDE's chat dock like any other hosted
CLI, with its own authentication and permissions. See the
[hosted CLI matrix](./harness.md#hosted-cli-integration).

## Enabling Copilot Chat by hand

This is possible but **not supported or tested** by OpenIDE. Copilot's licence
and the extension's own checks are between you and GitHub.

1. Install `GitHub.copilot-chat` (and `GitHub.copilot`) from a `.vsix`; they
   are not on Open VSX.
2. Set `"chat.disableAIFeatures": false` in your settings.
3. If the extension asks for authentication access it does not get, add
   `trustedExtensionAuthAccess` to a user-level `product.json` (locations in
   [extensions](./extensions.md#howto-switch-marketplace)) as described in the
   Copilot Chat repository's
   [Running with Code OSS](https://github.com/microsoft/vscode-copilot-chat/blob/main/CONTRIBUTING.md#running-with-code-oss)
   guide.

Expect the upstream chat UI and OpenIDE's native chat to coexist as two
separate surfaces if you do this.
