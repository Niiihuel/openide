# Product icon font

`bootstrap-icons.woff2` is the webfont from [Bootstrap Icons](https://icons.getbootstrap.com/)
v1.13.1, taken from the `bootstrap-icons` npm package (`font/fonts/bootstrap-icons.woff2`) on
2026-08-25. MIT licensed — the license text is next to it as `bootstrap-icons.LICENSE`.

`openide-bootstrap-product-icon-theme.json` is **generated**, not hand-written. Re-generate it
from the repo root after editing the map:

```
node dev/gen-bootstrap-icons.mjs
```

The generator (`dev/gen-bootstrap-icons.mjs`) reads the codepoints from
`dev/bootstrap-icons.codepoints.json` — the package's own `font/bootstrap-icons.json` — and
refuses to emit anything it cannot prove:

- every codicon id must be one the workbench actually registers, so a typo cannot become a
  mapping that silently does nothing;
- every Bootstrap glyph name must exist in the codepoint table, so a typo cannot become an empty
  box in the UI.

Ids that are absent from the map fall back to upstream's codicon **on purpose** — only those with
no honest equivalent in Bootstrap's set.

## Why the Search icon used to be wrong

The theme this replaced mapped `search` but never `search-large`, and the Search view registers
`search-view-icon` with `Codicon.searchLarge` as its default. The result: one icon in the activity
bar kept upstream's glyph while every neighbour was themed. The generator now collects ids from
**both** registries — `codiconsLibrary`/`codicons` and every `registerIcon(...)` call in `src` —
so a derived id can be mapped instead of silently dropped.

## Size: the font is rescaled, not corrected in CSS

A product icon theme cannot set a size: `IProductIconThemeDocument.fonts` accepts only `id`,
`src`, `weight` and `style` (`src/vs/workbench/services/themes/common/productIconThemeSchema.ts`).
Whatever font a theme installs is rendered with codicon's own metric,
`font: normal normal normal 16px/1 codicon`
(`src/vs/base/browser/ui/codicons/codicon/codicon.css`).

Matching `unitsPerEm` is necessary but not sufficient: what decides the apparent size is how much
of the em the artwork occupies. Measured as the median of the per-glyph bounding boxes:

| Font | unitsPerEm | asc/desc | median glyph | spans | at 16px |
| --- | --- | --- | --- | --- | --- |
| `codicon.ttf` | 300 | 300 / 0 | 0.8133 em | 0.0933 → 0.9067 em | 13.01 px |
| `bootstrap-icons` as shipped | 300 | 300 / 0 | 1.0000 em | 0.0000 → 1.0000 em | 16.00 px |
| `bootstrap-icons.woff2` here | 300 | 300 / 0 | 0.8133 em | 0.0933 → 0.9067 em | 13.01 px |

Bootstrap draws edge to edge inside its 16-unit viewBox; codicon leaves ~1.5px of padding at
16px. That 23% difference in drawn size is what read as "the icons are too big" across the IDE.

Both sets are centred on 0.5 em, so the correction is a pure uniform scale about the centre of the
em — factor **0.813333** (244/300) — with no vertical shift, no change to `unitsPerEm`, the
advance widths or the baseline, and no CSS override. `dev/scale-bootstrap-webfont.py` applies it:

```
nix-shell -p python3Packages.fonttools python3Packages.brotli \
    --run "python3 dev/scale-bootstrap-webfont.py <upstream.woff2> vscode/extensions/theme-defaults/producticons/bootstrap-icons.woff2"
```

Re-run it after every version bump: the file in this directory is NOT the one npm ships.

The Tabler font this replaced had a second problem on top of size: `unitsPerEm` 1000 with a
**-100 descender**, which sat its artwork 10% of the em below codicon's baseline, and 2-unit
strokes on a 24 grid (8.3% of the glyph) against Bootstrap's 1 on 16 (6.25%).

## Where the theme carries an open/closed state

The workbench swaps glyph by state in exactly one pattern, and it is one a theme can follow: the
action registers TWO icon ids and the menu item alternates them with
`toggled: { condition, icon }`. The base `icon:` is the CLOSED state, the `toggled` one is OPEN —
so the id *without* `-off` is what shows while the panel is open.

| Toggle | closed | open |
| --- | --- | --- |
| Primary side bar, left (`layoutActions.ts`) | `panel-left-off` → `layout-sidebar` | `panel-left` → `layout-sidebar-inset` |
| Primary side bar, right | `panel-right-off` → `layout-sidebar-reverse` | `panel-right` → `layout-sidebar-inset-reverse` |
| Bottom panel (`panelActions.ts`) | `panel-layout-icon-off` → `terminal` | `panel-layout-icon` → `terminal-fill` |
| Secondary side bar, right (`auxiliaryBarActions.ts`) | `auxiliarybar-right-off-layout-icon` → `chat-square` | `auxiliarybar-right-layout-icon` → `chat-square-fill` |
| Secondary side bar, left | `auxiliarybar-left-off-layout-icon` → `chat-square` | `auxiliarybar-left-layout-icon` → `chat-square-fill` |
| Sessions secondary side bar (`changesTitleBarWidget.ts`) | `agent-secondary-sidebar-toggle-closed` → `chat-square` | `agent-secondary-sidebar-toggle-open` → `chat-square-fill` |

Both halves of every pair are mapped deliberately. Mapping only one themes a button that jumps to
upstream's codicon the moment it is clicked.

The bottom panel reads as a terminal, not as a layout diagram — it is what that panel actually
holds. The layout ids proper (`panel-bottom`, used by the Customize Layout picker) keep their
layout glyph: a different surface answering a different question.

The primary side bar is the one pair that cannot use a literal fill — Bootstrap publishes no
`layout-sidebar-fill`, and none of its twelve layout glyphs has a `-fill` twin. It uses the INSET
pair instead: the side column goes from an empty outline (`layout-sidebar`) to a solid block
(`layout-sidebar-inset`), which reads as off/on exactly the way the other three read as
outline/fill. The base codicons behind it (`layout-sidebar-left` / `layout-sidebar-left-off` and
their right-hand twins) follow the same split, so any other surface drawing the raw codicon reads
correctly too — they used to map to ONE glyph for both states, which is why that toggle appeared
frozen.

## The activity bar, by contrast, is outline throughout

The view containers have no such pair. Upstream does not swap to a filled icon for the active one
and neither does this fork: `compositeBarActions.ts` is byte-identical to upstream, and there is no
`fill` anywhere in `parts/activitybar/`. The active state is the `active-item-indicator` bar plus
`activityBar.foreground` — the glyph never changes.

It could not be done with this set anyway: Bootstrap publishes no `search-fill`, no `git-fill` and
no `files-fill`, so Explorer, Search and Source Control have no solid form. A half-solid bar would
be worse than a consistent outline one, so the bar is uniformly outline — which is why `account`
and `accounts-view-bar-icon` map to `person` and not to the solid `person-circle`.

Making the active container fill would need real code: a second registered icon id per view
container (`explorer-view-icon-active`, …) and a swap in `CompositeBarActionViewItem`, plus a
substitute glyph for the three that have no solid twin. It is a feature, not a mapping.

## Outline and fill

Upstream does not ship a separate filled theme font: outline and solid are separate **ids** in one
family. Bootstrap works the same way — `chat-square` / `chat-square-fill`, `circle` / `circle-fill`
— so this theme declares a single `fonts` entry where the Tabler one needed two.

78 ids resolve to a `-fill` glyph. They are of two kinds, and the map decides id by id rather than
by name:

- the explicit `*-filled` / `*-full` ids (`person-filled`, `pass-filled`, `mic-filled`, …);
- the ones codicon draws solid with nothing in the name to say so — `error`, `warning`, `info`,
  `record`, the live `debug-breakpoint*` variants, `diff-modified`, the `dialog-*` badges.

`screen-full` is not one of them: "full" there means fullscreen. `sparkle-filled` maps to `stars`,
which Bootstrap already draws solid and has no `-fill` twin.

## Chat

`openide-chat`, `chat-view-icon`, `comment` and `comment-discussion` all resolve to Bootstrap's
`chat-square` (`\f265`): the chat is one thing across the IDE and reads as one glyph.

## The Settings sprite

Settings draws its category glyphs inline rather than through the font
(`src/vs/workbench/contrib/openideSettings/browser/openideBootstrapIcons.ts`, generated by
`dev/gen-bootstrap-sprite.mjs`). Same family, same grid — the two must be regenerated together if
the vendored version ever moves.
