<!-- order: 15 -->

# Extensions and the marketplace

- [Where extensions come from](#marketplace)
- [Getting an extension that is not on Open VSX](#missing)
- [Using a different gallery](#howto-switch-marketplace)
- [Self-hosting a gallery](#howto-selfhost-marketplace)
- [The Visual Studio Marketplace](#visual-studio-marketplace)
- [Proprietary extensions and API proposals](#proprietary-extensions)
- [Extensions compatibility](./extensions-compatibility.md)

## <a id="marketplace"></a>Where extensions come from

OpenIDE runs Visual Studio Code extensions. Microsoft's own marketplace,
however, [may only be used by Microsoft products](https://github.com/microsoft/vscode/issues/31168),
so like every other Code OSS distribution OpenIDE points its Extensions view at
[Open VSX](https://open-vsx.org), the vendor-neutral registry run by the
Eclipse Foundation. `vscode/product.json` sets:

```json
"extensionsGallery": {
  "serviceUrl": "https://open-vsx.org/vscode/gallery",
  "itemUrl": "https://open-vsx.org/vscode/item",
  "latestUrlTemplate": "https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest",
  "controlUrl": "https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json"
}
```

Searching, installing and updating go to Open VSX. The `controlUrl` is the
Eclipse Foundation's list of malicious and deprecated extensions; see
[telemetry](./telemetry.md#replacements).

## <a id="missing"></a>Getting an extension that is not on Open VSX

Most popular extensions are published to both registries, but not all. When
one is missing:

- Ask the maintainers to publish to Open VSX; the process is documented in
  the [Open VSX wiki](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).
- Open a pull request against
  [open-vsx/publish-extensions](https://github.com/open-vsx/publish-extensions)
  so the Open VSX service account publishes it.
- Download the `.vsix` from the extension's own release page and install it
  with *Extensions: Install from VSIX…*. Extensions installed this way do not
  receive updates until they appear on the gallery.

An extension manager such as
[VSIX Manager](https://open-vsx.org/extension/zokugun/vsix-manager) can
install from several sources at once and keep a local `.vsix` collection; it
is a third-party extension, not part of OpenIDE.

## <a id="howto-switch-marketplace"></a>Using a different gallery

Set these environment variables before launching OpenIDE:

- `VSCODE_GALLERY_SERVICE_URL` (required)
- `VSCODE_GALLERY_ITEM_URL` (required)
- `VSCODE_GALLERY_EXTENSION_URL_TEMPLATE` (required)
- `VSCODE_GALLERY_CACHE_URL`
- `VSCODE_GALLERY_CONTROL_URL`
- `VSCODE_GALLERY_RESOURCE_URL_TEMPLATE`

Or create a user-level `product.json` that overrides the gallery:

- Windows: `%APPDATA%\OpenIDE\product.json`
- macOS: `~/Library/Application Support/OpenIDE/product.json`
- Linux: `~/.config/OpenIDE/product.json`

```jsonc
{
  "extensionsGallery": {
    "serviceUrl": "",            // required
    "itemUrl": "",               // required
    "extensionUrlTemplate": "",  // required
    "cacheUrl": "",
    "controlUrl": "",
    "resourceUrlTemplate": ""
  }
}
```

## <a id="howto-selfhost-marketplace"></a>Self-hosting a gallery

Two servers are known to work with the gallery protocol OpenIDE speaks:

- [Open VSX](https://github.com/eclipse/openvsx) itself, the same software
  behind the public registry, with a web UI and a publishing CLI.
- [code-marketplace](https://coder.com/blog/running-a-private-vs-code-extension-marketplace),
  a single Go binary that serves `.vsix` files from storage with no frontend.

Point OpenIDE at either with the settings above.

## <a id="visual-studio-marketplace"></a>The Visual Studio Marketplace

Its [terms of use](https://aka.ms/vsmarketplace-ToU) restrict it to Visual
Studio products:

> Marketplace Offerings are intended for use only with Visual Studio Products
> and Services and you may only install and use Marketplace Offerings with
> Visual Studio Products and Services.

OpenIDE does not configure it and cannot help with using it. Several
extensions hosted there also carry licences that forbid running them in
non-Microsoft products.

## <a id="proprietary-extensions"></a>Proprietary extensions and API proposals

Some Microsoft extensions — the C# and C++ debuggers, Live Share, the Remote
Development pack — check at runtime that they are running in the official
build, or are licensed only for it. The list and the open replacements are in
[extensions compatibility](./extensions-compatibility.md).

Extensions that merely need a proposed API are a different case. Upstream
gates those through `extensionEnabledApiProposals` in `product.json`, and
OpenIDE ships upstream's list. To grant a proposal to another extension, add
it to the user-level `product.json` described above:

```jsonc
{
  "extensionEnabledApiProposals": {
    "publisher.extension": ["proposalName"]
  }
}
```

This does not help with an extension that refuses to start outside Visual
Studio Code; that check is in the extension's own code.
