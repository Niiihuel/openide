---
title: GitHub Copilot
description: Copilot is disabled and not configured in OpenIDE. This is what it takes to enable it anyway.
---

Unlike Visual Studio Code, in OpenIDE the Copilot features are disabled and not configured. OpenIDE ships its own [agent](/docs/agent/), which does not depend on Copilot; the GitHub Copilot provider is available in the [provider catalog](/docs/agent-providers/) if you want to use your Copilot subscription with it.

If you want the upstream Copilot Chat extension instead, follow these steps.

## Update your settings

In your settings set:

```json
"chat.disableAIFeatures": false
```

## Configure `product.json`

Create a custom `product.json` at the following location (replace `OpenIDE` with `OpenIDE - Insiders` if you use that channel):

- Windows: `%APPDATA%\OpenIDE` or `%USERPROFILE%\AppData\Roaming\OpenIDE`
- macOS: `~/Library/Application Support/OpenIDE`
- Linux: `$XDG_CONFIG_HOME/OpenIDE` or `~/.config/OpenIDE`

Then follow the guide [Running with Code OSS](https://github.com/microsoft/vscode-copilot-chat/blob/main/CONTRIBUTING.md#running-with-code-oss) with the `product.json` you just created. You will need to add the `trustedExtensionAuthAccess` and `defaultChatAgent` properties.

Note that the Copilot extension that ships with Code OSS (`extensions/copilot`) has been removed from the OpenIDE tree, because the agent is native. The steps above install it from the marketplace instead.
