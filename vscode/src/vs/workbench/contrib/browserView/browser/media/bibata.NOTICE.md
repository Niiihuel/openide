# Bibata Modern Classic cursor

`bibataModernClassic.svg` is the normal left pointer from
[Bibata Cursor](https://github.com/ful1e5/Bibata_Cursor), designed by
Abdulkaiz Khatri (ful1e5), under the GNU General Public License version 3.
The complete upstream license is in `bibata.LICENSE.txt`.

Pinned upstream revision: `35ccfe209a808e40d6c2ca60a46cbe4faf68b690`.
Retrieved on 2026-09-22.

Sources at that revision:

- [`svg/groups/modern/left_ptr.svg`](https://github.com/ful1e5/Bibata_Cursor/blob/35ccfe209a808e40d6c2ca60a46cbe4faf68b690/svg/groups/modern/left_ptr.svg)
- [`render.json`](https://github.com/ful1e5/Bibata_Cursor/blob/35ccfe209a808e40d6c2ca60a46cbe4faf68b690/render.json)
- [`configs/normal/x.build.toml`](https://github.com/ful1e5/Bibata_Cursor/blob/35ccfe209a808e40d6c2ca60a46cbe4faf68b690/configs/normal/x.build.toml)

The SVG keeps the original path, stroke width, view box, and padding. The only
artwork modification applies upstream's `Bibata-Modern-Classic` color map:
`#00FF00` to `#000000`, `#0000FF` to `#FFFFFF`, and `#FF0000` to `#000000`.
A provenance comment was added. This editable SVG is the source asset; it is
loaded locally without requesting anything from upstream at runtime.

## Size and hotspot

The original SVG canvas and view box are 256 by 256. Render the complete canvas
at **20 by 20 CSS pixels**, matching the nominal cursor size, rather than cropping
the artwork or enlarging its visible bounds to 20 pixels.

The upstream `left_ptr` hotspot is `(55, 17)` in that canvas. At 20 CSS pixels,
its precise vector hotspot is `(4.296875, 1.328125)`. Place the image that far
left and above the logical pointer coordinate. CSS can equivalently translate
the image by `(-21.484375%, -6.640625%)`. This keeps the click/ripple coordinate
aligned with the original cursor's tip while preserving sharp rendering at
fractional browser zoom and device pixel ratios.
