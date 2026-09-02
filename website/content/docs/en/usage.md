---
title: Usage
description: Portable mode, terminal integration, GitHub sign-in, the default file manager and Markdown validation.
---

## Sign in with GitHub

In OpenIDE, *Sign in with GitHub* uses a personal access token. Follow the [GitHub documentation](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token) to create one and select the scopes the extension needs (GitLens, for example, requires the `repo` scope). See [Accounts authentication](/docs/accounts-authentication/) for details.

### Linux

If you get the error `Writing login information to the keychain failed with error 'The name org.freedesktop.secrets was not provided by any .service files'`, install the `gnome-keyring` package (or another Secret Service provider).

## Portable mode

Follow the [portable mode instructions](https://code.visualstudio.com/docs/editor/portable) from the Visual Studio Code website.

- **Windows / Linux:** the instructions can be followed as written, creating a `data` folder next to the executable.
- **macOS:** portable mode is enabled by a specially named folder. For VS Code it is `code-portable-data`; for OpenIDE create `openide-portable-data` instead.

## Fix the default file manager (Linux)

In some cases OpenIDE becomes the application used to open directories instead of Dolphin or Nautilus. This happens when no application is declared as the default file manager, so the system picks the latest capable one.

Set the default explicitly in `~/.config/mimeapps.list`:

```ini
[Default Applications]
inode/directory=org.gnome.Nautilus.desktop;
```

You can find your regular file manager with:

```bash
grep directory /usr/share/applications/mimeinfo.cache
# inode/directory=openide.desktop;org.gnome.Nautilus.desktop;
```

## Press and hold a key to repeat it (macOS)

The `defaults` domain is different from VS Code:

```bash
defaults write com.openide ApplePressAndHoldEnabled -bool false
```

## Open OpenIDE from the terminal

On macOS and Windows:

1. Open the Command Palette (*View > Command Palette…*).
2. Run *Shell command: Install 'openide' command in PATH*.

This lets you open files or directories directly from your shell:

```bash
openide .          # open this directory
openide file.txt   # open this file
```

Feel free to alias the command in your shell profile, for example `alias code=openide`.

On Linux, when installed with a package manager, `openide` is already on your `PATH`.

### From the Linux tarball

When `OpenIDE-linux-<arch>-<version>.tar.gz` is extracted, the main entry point is `./bin/openide`.

## Validate a Markdown document

Open a `.md` file and run **OpenIDE: Validate Active Markdown** from the Command Palette. OpenIDE checks code fences, heading hierarchy and unsafe link schemes without modifying the document. The counts for headings, links, images, tasks and code blocks are written to the **OpenIDE Markdown** output channel.

## Language

The workbench UI follows the `openide.language` setting. The agent's own strings follow the same setting, so the chat, the settings surfaces and the plan editor switch together.
