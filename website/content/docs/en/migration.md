---
title: Migration
description: Move your settings, keybindings and extensions from Visual Studio Code to OpenIDE.
---

## Manual migration from Visual Studio Code

OpenIDE (like any copy of VS Code built from source) stores its extensions in `~/.vscode-oss`. If you currently have Visual Studio Code installed, your extensions will not populate automatically. You can copy them from `~/.vscode/extensions` to `~/.vscode-oss/extensions`.

Visual Studio Code stores `keybindings.json` and `settings.json` in these locations:

- **Windows:** `%APPDATA%\Code\User`
- **macOS:** `$HOME/Library/Application Support/Code/User`
- **Linux:** `$HOME/.config/Code/User`

Copy those files to the OpenIDE user settings folder:

- **Windows:** `%APPDATA%\OpenIDE\User`
- **macOS:** `$HOME/Library/Application Support/OpenIDE/User`
- **Linux:** `$HOME/.config/OpenIDE/User`

To copy your settings manually from inside the editor:

1. In Visual Studio Code, open Settings (`Ctrl+,` / `Cmd+,`).
2. Click the three dots `…` and choose *Open settings.json*.
3. Copy the contents into the same file in OpenIDE.

## Semi-automatic migration with the "Sync Settings" extension

The [**Sync Settings**](https://github.com/zokugun/vscode-sync-settings) extension simplifies the process by synchronizing settings, keybindings, extensions and more between Visual Studio Code and OpenIDE. It is available on the Visual Studio Marketplace, Open VSX and its GitHub repository.

1. Install **Sync Settings** in both Visual Studio Code and OpenIDE.
2. Configure the extension in both editors: open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run *Sync Settings: Open the repository settings* and configure the repository.
3. Export your current settings from Visual Studio Code: run *Sync Settings: Upload (user -> repository)*.
4. Import them into OpenIDE:
   - The setting `"syncSettings.openOutputOnActivity": true` is recommended.
   - Run *Sync Settings: Download (repository -> user)*.
   - Wait for every extension to be downloaded and installed (follow the logs in the *Output* panel) before restarting OpenIDE.

This method transfers every supported configuration.

## What does not migrate

- Extensions that are licensed only for the official Microsoft build. See [Extensions compatibility](/docs/extensions-compatibility/) for replacements.
- GitHub Copilot, which is disabled and not configured in OpenIDE. See [GitHub Copilot](/docs/github-copilot/).
- Microsoft account sessions. GitHub sign-in uses a personal access token; see [Accounts authentication](/docs/accounts-authentication/).
