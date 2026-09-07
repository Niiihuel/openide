<!-- order: 25 -->

# Usage

Everyday questions that are specific to OpenIDE. Anything not covered here
works as it does in Code OSS.

- [Sign in with GitHub](#signin-github)
- [How do I run OpenIDE in portable mode?](#portable)
- [How do I fix the default file manager? (Linux)](#file-manager)
- [How do I open OpenIDE from the terminal?](#terminal-support)
- [How do I validate a Markdown document?](#markdown-validation)
- [How do I change the language of OpenIDE's own UI?](#language)

## <a id="signin-github"></a>Sign in with GitHub

OpenIDE ships its own GitHub OAuth application, so the consent screen shows
OpenIDE rather than Visual Studio Code. Signing in offers a **device code**
flow first (OpenIDE shows a code and opens github.com/login/device) and a
**personal access token** as the fallback. Details, and why the other flows
are unavailable, are in [accounts authentication](./accounts-authentication.md).

### Linux

If you get `Writing login information to the keychain failed with error 'The
name org.freedesktop.secrets was not provided by any .service files'`, install
a Secret Service provider such as `gnome-keyring` or KWallet with its
`kwallet-secrets` bridge. Without one, OpenIDE keeps provider credentials in
memory only and says so in Settings.

## <a id="portable"></a>How do I run OpenIDE in portable mode?

Follow the [portable mode instructions](https://code.visualstudio.com/docs/editor/portable)
from the Visual Studio Code documentation. On Windows and Linux they apply as
written: create a `data` directory next to the extracted archive and OpenIDE
keeps its user data and extensions there. The `VSCODE_PORTABLE` environment
variable is honoured too. macOS is not published, so the macOS variant has not
been verified.

## <a id="file-manager"></a>How do I fix the default file manager? (Linux)

In some cases OpenIDE becomes the application used to open directories
because no file manager was registered as the default and the desktop picked
the most recently installed capable application.

Set the default in `~/.config/mimeapps.list`:

```
[Default Applications]
inode/directory=org.gnome.Nautilus.desktop;
```

You can find your regular file manager with:

```
> grep directory /usr/share/applications/mimeinfo.cache
inode/directory=openide.desktop;org.gnome.Nautilus.desktop;
```

## <a id="terminal-support"></a>How do I open OpenIDE from the terminal?

On Linux, the `.deb`, `.rpm` and AppImage installations put `openide` on the
`PATH` (the AppImage through the wrapper `dev/install-appimage.sh` creates, or
whatever launcher you registered). From a `.tar.gz`, the entry point is
`./bin/openide` inside the extracted directory.

On Windows, the user installer offers to add OpenIDE to the `PATH`; you can
also run *Shell Command: Install 'openide' command in PATH* from the Command
Palette.

```bash
openide .            # open this directory
openide file.txt     # open this file
openide --verbose    # print startup logs, useful when the window does not appear
```

## <a id="markdown-validation"></a>How do I validate a Markdown document?

Open a `.md` file and run **OpenIDE: Validate active Markdown** from the
Command Palette. OpenIDE checks code fences, heading hierarchy and unsafe link
schemes without modifying the document. The counts for headings, links,
images, tasks and code blocks are written to the **OpenIDE Markdown** output
channel.

## <a id="language"></a>How do I change the language of OpenIDE's own UI?

The chat, Settings, plan editor, Project Map and the other OpenIDE surfaces
are available in English and Spanish. `openide.language` is `auto` by default,
which follows the editor's display language; set it to `en` or `es` to pin
one. The rest of the editor follows the usual language packs.
