# Icons

Source artwork for every OpenIDE icon and the script that renders the
platform-specific formats from it.

## Layout

| Path | Contents |
|---|---|
| `openide.svg`, `openide.png` | The product mark. The README and the welcome page use the PNG. |
| `corner_512.png`, `template_macos.png` | Masks used when composing the macOS-style rounded icon. |
| `stable/`, `insider/` | Per-channel source SVGs (see the table below). The insider variant renders in orange, stable in blue. |
| `build_icons.sh` | Renders the ICO, ICNS, PNG sets and the Windows/Linux resource files into `src/stable/` and `src/insider/`, from where the build copies them into `vscode/resources`. |

## Source files per channel

The file names are inherited from the upstream icon pipeline; the artwork is
OpenIDE's.

| File | Variant | Width | Border |
|---|---|---|---|
| `codium_clt.svg` | light on dark (title bar, tray) | | |
| `codium_cnl.svg` | full colour | | |
| `codium_cnl_w80_b8.svg` | full colour, inset | 80% | 8pt |

## Regenerating

```sh
./icons/build_icons.sh        # stable
./icons/build_icons.sh -i     # insider
```

Requires `imagemagick`, `librsvg` (`rsvg-convert`) and `png2icns`
(`npm install -g png2icns`). The script fails loudly when a tool is missing
rather than silently regenerating nothing. Run `node dev/audit-branding.mjs`
afterwards: it checks that the resources the build ships carry OpenIDE's
branding.
