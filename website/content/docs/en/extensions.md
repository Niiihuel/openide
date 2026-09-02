---
title: Extensions and marketplace
description: Open VSX is the default gallery; how to switch to another gallery, self-host one, and what proprietary extensions cannot do.
---

## Marketplace

Being a VS Code based editor, OpenIDE gets additional features by installing Visual Studio Code extensions. Microsoft [prohibits use of the Microsoft marketplace by any other product](https://github.com/microsoft/vscode/issues/31168) and redistribution of `.vsix` files from it, so extensions have to be installed differently.

By default `product.json` points the extension gallery at [open-vsx.org](https://open-vsx.org/), which provides an [adapter](https://github.com/eclipse/openvsx/wiki/Using-Open-VSX-in-VS-Code) for the marketplace API VS Code uses. You may miss some extensions you know from the Visual Studio Marketplace. Your options:

- Ask the extension maintainers to publish to Open VSX as well. The process is documented in the [Open VSX wiki](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).
- Open a pull request to [publish-extensions](https://github.com/open-vsx/publish-extensions) so the `@open-vsx` service account publishes the extension for you.
- Download and [install the `.vsix` file](https://code.visualstudio.com/docs/editor/extension-gallery#_install-from-a-vsix), for example from the release page of the extension's repository.

## Use the Open VSX Registry

The [Open VSX Registry](https://open-vsx.org/) is the pre-set gallery in OpenIDE, so the Extensions view uses it by default. See [this article](https://web.archive.org/web/20200423131829/https://www.gitpod.io/blog/open-vsx/) for the motivation behind Open VSX.

## Use a different extension gallery

You can switch from the pre-set Open VSX Registry by configuring the endpoints in one of two ways.

Environment variables:

- `VSCODE_GALLERY_SERVICE_URL` **(required)**
- `VSCODE_GALLERY_ITEM_URL` **(required)**
- `VSCODE_GALLERY_CACHE_URL`
- `VSCODE_GALLERY_CONTROL_URL`
- `VSCODE_GALLERY_EXTENSION_URL_TEMPLATE` **(required)**
- `VSCODE_GALLERY_RESOURCE_URL_TEMPLATE`

Or a custom `product.json` at the following location (replace `OpenIDE` with `OpenIDE - Insiders` if you use that channel):

- Windows: `%APPDATA%\OpenIDE` or `%USERPROFILE%\AppData\Roaming\OpenIDE`
- macOS: `~/Library/Application Support/OpenIDE`
- Linux: `$XDG_CONFIG_HOME/OpenIDE` or `~/.config/OpenIDE`

with content like:

```jsonc
{
  "extensionsGallery": {
    "serviceUrl": "", // required
    "itemUrl": "", // required
    "cacheUrl": "",
    "controlUrl": "",
    "extensionUrlTemplate": "", // required
    "resourceUrlTemplate": ""
  }
}
```

## Self-host your own extension gallery

Individual developers and companies in regulated or security-conscious industries can self-host a gallery. The following are known to work:

- [Open VSX](https://github.com/eclipse/openvsx), the Eclipse open source project. The public instance run by the Eclipse Foundation is the pre-set endpoint, but you can host your own.

  > Open VSX is a [vendor-neutral](https://projects.eclipse.org/projects/ecd.openvsx) open source alternative to the Visual Studio Marketplace. It provides a server application that manages VS Code extensions in a database, a web application similar to the Visual Studio Marketplace, and a command-line tool for publishing extensions similar to `vsce`.

- [code-marketplace](https://coder.com/blog/running-a-private-vs-code-extension-marketplace), an open source project by Coder.

  > `code-marketplace` is a self-contained Go binary without a frontend or any mechanism for authors to add or update extensions. It reads extensions from file storage and provides an API for VS Code compatible editors.

## Visual Studio Marketplace

As with any online service, make sure you have understood [its terms of use](https://aka.ms/vsmarketplace-ToU), which include:

> Marketplace Offerings are intended for use only with Visual Studio Products and Services and you may only install and use Marketplace Offerings with Visual Studio Products and Services.

We cannot provide any help if you intend to infringe those terms. Note also that the gallery hosts non-free extensions whose licenses explicitly forbid use in non-Microsoft products, and that use telemetry.

## Proprietary debugging tools

The debugger provided with Microsoft's [C# extension](https://github.com/OmniSharp/omnisharp-vscode) and the Windows debugger provided with the [C++ extension](https://github.com/Microsoft/vscode-cpptools) are licensed to work only with the official Visual Studio Code build. See [this comment in the C# repository](https://github.com/OmniSharp/omnisharp-vscode/issues/2491#issuecomment-418811364) and [this one in the C++ repository](https://github.com/Microsoft/vscode-cpptools/issues/21#issuecomment-248349017).

For C# projects a workaround exists with Samsung's open source [netcoredbg](https://github.com/Samsung/netcoredbg).

## Proprietary extensions

Like those debuggers, some marketplace extensions (for example the [Remote Development](https://code.visualstudio.com/docs/remote/remote-overview) pack) only function with the official build. You can sometimes work around this by adding the extension's internal ID to the `extensionAllowedProposedApi` property of `product.json` in your installation:

```jsonc
"extensionAllowedProposedApi": [
  // ...
  "ms-vscode-remote.vscode-remote-extensionpack",
  "ms-vscode-remote.remote-wsl",
  // ...
],
```

In some cases this does not help because the extension is hard-coded to run only with the official product. See [Extensions compatibility](/docs/extensions-compatibility/) for open replacements.

## Using the "VSIX Manager" extension

The [**VSIX Manager**](https://github.com/zokugun/vscode-vsix-manager) extension provides a friendly interface for managing `.vsix` files directly inside OpenIDE. It is particularly useful for:

- **Multiple marketplaces:** install and manage extensions from several galleries at the same time.
- **Local files:** manage a collection of `.vsix` files stored locally.
- **GitHub or Forgejo releases:** install an extension straight from its release page.
- **Fallback options** when a gallery is temporarily unreachable.

Typical use cases are offline development, teams that distribute pinned extension versions, and enterprises with restricted environments that need control over what is installed.
