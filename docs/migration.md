<!-- order: 20 -->

# Migrating from Visual Studio Code

OpenIDE stores its data in its own locations, so nothing from an existing
Visual Studio Code installation is picked up automatically. Both editors can
stay installed.

- [Settings and keybindings](#settings)
- [Extensions](#extensions)
- [Settings Sync extensions](#sync)

## <a id="settings"></a>Settings and keybindings

Visual Studio Code keeps `settings.json`, `keybindings.json` and `snippets/`
in:

- Windows: `%APPDATA%\Code\User`
- macOS: `~/Library/Application Support/Code/User`
- Linux: `~/.config/Code/User`

OpenIDE reads the same files from:

- Windows: `%APPDATA%\OpenIDE\User`
- macOS: `~/Library/Application Support/OpenIDE/User`
- Linux: `~/.config/OpenIDE/User`

Copy the files across, or open *Preferences: Open User Settings (JSON)* in
both editors and paste. Settings that name Microsoft-only services (Settings
Sync, Copilot, the Microsoft marketplace) have no effect in OpenIDE and can be
left as they are.

## <a id="extensions"></a>Extensions

Visual Studio Code installs extensions under `~/.vscode/extensions`; OpenIDE
uses `~/.openide/extensions`. Copying the directory works for most extensions,
but two things differ:

- OpenIDE's gallery is [Open VSX](https://open-vsx.org). An extension copied
  from VS Code that is not published there will keep working but will not
  receive updates; see [extensions](./extensions.md) for the options.
- Some Microsoft extensions refuse to run outside the official build; see
  [extensions compatibility](./extensions-compatibility.md) for the list and
  their replacements.

The cleaner route is to reinstall from the Extensions view and let OpenIDE
resolve each one against Open VSX.

## <a id="sync"></a>Settings Sync extensions

Microsoft's built-in Settings Sync needs Microsoft's backend and is not
available in OpenIDE. Third-party alternatives such as
[Sync Settings](https://open-vsx.org/extension/zokugun/sync-settings) work in
both editors and can carry settings, keybindings, snippets and the extension
list through a Git repository or a folder: install it in both, upload from
VS Code, download in OpenIDE, and restart once the extensions have finished
installing. OpenIDE does not endorse or maintain any of these extensions.
