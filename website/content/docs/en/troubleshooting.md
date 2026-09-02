---
title: Troubleshooting
description: Known problems on Linux and Windows and how to work around them.
---

## Linux

### Fonts showing up as rectangles

Clear the font caches and rebuild them:

```bash
rm -rf ~/.cache/fontconfig
rm -rf ~/snap/openide/common/.cache
fc-cache -r
```

### Text or the entire interface not appearing

You have likely hit a [bug in Chromium and Electron](https://github.com/microsoft/vscode/issues/190437) when compiling Mesa shaders, which affects every Visual Studio Code and OpenIDE build on Linux since 1.82. The workaround is to delete the GPU cache:

```bash
rm -rf ~/.config/OpenIDE/GPUCache
```

### Global menu workaround for KDE

Install these packages on Fedora:

- `libdbusmenu-devel`
- `dbus-glib-devel`
- `libdbusmenu`

On Ubuntu the package is called `libdbusmenu-glib4`.

### Flatpak most common issues

- Blurry screen with HiDPI on Wayland:
  ```bash
  flatpak override --user --nosocket=wayland com.openide.openide
  ```
- To execute commands on the host system from inside the sandbox:
  ```bash
  flatpak-spawn --host <COMMAND>
  # or
  host-spawn <COMMAND>
  ```
- Missing extensions: use the [VSIX Manager](https://open-vsx.org/extension/zokugun/vsix-manager) extension or edit `product.json`; see [Extensions](/docs/extensions/).

### Remote SSH does not work

Use the compatible extension [Open Remote - SSH](https://open-vsx.org/extension/jeanp413/open-remote-ssh). On the server, `AllowTcpForwarding` must be set to `yes` in the `sshd` configuration. Some distributions (Alpine, for example) need additional dependencies.

### The window does not show up

If you are under Wayland:

1. Run `openide --verbose`.
2. If you see an error like `:ERROR:ui/gl/egl_util.cc:92] EGL Driver message (Error) eglCreateContext: Requested version is not supported`, start with `openide --ozone-platform=x11`.

### native-keymap fails to load on NixOS

The keyboard layout module needs `libxkbfile`. Run the product through the FHS wrapper described in [Installation](/docs/installation/#nixos), which provides it.

## Windows

### Group Policy Objects (GPOs) are ignored

OpenIDE uses its own policy watcher library which reads GPO values from a **different registry path** than VS Code.

OpenIDE reads policies from:

```text
HKLM\SOFTWARE\Policies\OpenIDE\OpenIDE
```

VS Code reads policies from:

```text
HKLM\SOFTWARE\Policies\Microsoft\VSCode
```

If you deploy OpenIDE in an enterprise environment via Group Policy:

1. Copy the `.admx` template file to `C:\Windows\PolicyDefinitions\`.
2. Copy the `.adml` language file to `C:\Windows\PolicyDefinitions\en-US\`.
3. Open `gpedit.msc` and configure policies under the OpenIDE group.
4. Verify that the resulting registry key exists at `HKLM\SOFTWARE\Policies\OpenIDE\OpenIDE` (not `Microsoft\OpenIDE`).

If you set policies manually with the Registry Editor, create the key at the correct path:

```text
HKLM\SOFTWARE\Policies\OpenIDE\OpenIDE\<PolicyName>  (REG_SZ or REG_DWORD)
```

For example, to set *Update: Mode* to `none`:

```text
Registry key: HKLM\SOFTWARE\Policies\OpenIDE\OpenIDE
Value name:   update.mode
Value type:   REG_SZ
Value data:   none
```

Per-user policies are also supported under `HKCU\SOFTWARE\Policies\OpenIDE\OpenIDE` (machine policies take precedence).

### "Open with OpenIDE" missing from the context menu

If the **Open with OpenIDE** option does not appear after installation, even with the checkbox checked during setup:

1. **Run the installer again** and make sure *Add 'Open with OpenIDE' action to Windows Explorer file context menu* is checked.
2. **Windows 11 note:** Windows 11 hides most context menu entries behind **Shift + right-click** (*Show more options*). The entry may be present but hidden in the condensed menu.
3. If it still does not appear, add it manually with the Registry Editor, adjusting the install path:

   ```text
   Key:   HKEY_CLASSES_ROOT\*\shell\Open with OpenIDE
   Value: (Default) = "Open with OpenIDE"

   Key:   HKEY_CLASSES_ROOT\*\shell\Open with OpenIDE\command
   Value: (Default) = "C:\Program Files\OpenIDE\OpenIDE.exe" "%1"
   ```

### Windows Defender flags the installer as malware

Some users report Windows Defender detecting the installer as `Cinjo` or another threat. This is a **false positive** caused by the unsigned nature of the build artifacts.

- Download OpenIDE **only** from the official [GitHub Releases page](https://github.com/Niiihuel/openide/releases).
- Verify the SHA-256 or SHA-512 checksum of the file against the `.sha256` or `.sha512` file published next to each release.
- If Defender blocks the installer, add an exclusion for the downloaded file, run the install, then remove the exclusion.
- You can report the false positive to Microsoft through the [Windows Defender Security Intelligence submission portal](https://www.microsoft.com/en-us/wdsi/filesubmission).

## Agent

### A provider returns an empty answer

Some OpenAI-compatible endpoints put the model's reasoning in a separate field and return an empty `content`. OpenIDE retries such requests without tools and reads the reasoning field, but if a custom provider keeps answering empty, check that the endpoint speaks the Chat Completions API and that the model supports tool calls. See [Providers](/docs/agent-providers/).

### The agent cannot reach my local server

The localhost preview and the browser tools only open hosts allowed by `openide.agent.browserAllowedHosts`. Web exploration (`web_search`, `web_fetch`) is a separate, headless downloader controlled by `openide.agent.web.*` that blocks loopback and LAN addresses by design; see [Reliability](/docs/reliability/#web-exploration-by-the-agent).

## Still stuck?

Check the [existing issues](https://github.com/Niiihuel/openide/issues) and, if nobody has reported your problem, [open a bug report](https://github.com/Niiihuel/openide/issues/new?labels=bug&template=bug_report.md) with the details the template asks for.
