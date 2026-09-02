# Surfaces and themes

How OpenIDE's own UI gets its colours and shapes, and the ways it has gone wrong.

Every rule here comes from a bug that shipped. They share one shape: **the surface
looked correct in the theme it was written against, and fell apart in another
one.** None of them announced itself as an error — the IDE just looked slightly
off, which is the most expensive kind of defect to carry, because nobody files it
and it accumulates for months.

`dev/audit-surface-tokens.mjs` enforces the three invariants that can be checked
statically. The rest are review rules.

## 1. Fork tokens are declared where the theme variables live

The workbench defines `--vscode-*` on **`.monaco-workbench`**, not on `:root`.

`openideSurfaceCss.ts` defines the product's tokens (`--oi-surface`,
`--oi-raised`, `--oi-card`, …) and every one of them derives from a `--vscode-*`.
Declared on `:root` alone, each token resolved to *invalid at computed-value time*
and computed to nothing on every native surface: the chat dock, Settings, the plan
editor, the Project Map. All of them had been running on the per-rule fallbacks
rather than on the design system.

The selector must carry both scopes:

```css
:root, .monaco-workbench { --oi-surface: …; }
```

`:root` is what applies inside a webview, where `.monaco-workbench` does not
exist and the host exports the theme as custom properties on the iframe root.

*Audited.* Checked in `auditTokenScope`.

## 2. A surface uses the colour family that paints it

The fork does not paint its parts with `sideBar.background`. `sidebarPart.ts` uses
`openide.islandBackground` — the "island" design. A rule that reaches for the
upstream id instead looks identical in a theme that defines both the same way, and
splits in two the moment a theme does not.

`openide.islandBackground` falls back to `editorBackground`, so any theme that
does not define it still resolves — just to a different value than
`sideBar.background`. That is exactly the case that breaks.

Write fork surfaces against `--oi-surface`. Reach for a `--vscode-*` id directly
only when the surface genuinely belongs to upstream.

## 3. No `opacity` over an already-themed colour

A separator painted with `menu.separatorBackground` and then dimmed with
`opacity: .5` is legible in a theme with a strong separator colour and invisible
in one without. The theme author already decided how visible that line should be;
halving it overrides that decision in the direction of "gone".

If a colour needs to be softer, define it softer — or let the theme's own token
carry it.

## 4. One widget owns its border and its focus ring

A raw `<input>` inside a styled `<div>` produces **two** rings as soon as it takes
focus: the wrapper draws its own on `:focus-within`, and the input receives the
workbench's global `[tabindex]:focus` outline. The `outline: none` usually written
to suppress the second one loses on specificity — `:not()` takes the specificity
of its argument, so the obvious guard ties with the global rule and loses on load
order.

This produced three separate "double border" reports before the pattern was named.
The fix is not a more specific override: it is to use the native widget
(`InputBox`, `Button`, `SelectBox`, `Checkbox` from `base/browser/ui/`), which is a
single element that owns both. Native widgets also bring theme colours, focus
handling, high contrast and the font-scaling metrics — each hand-rolled copy is one
more thing that drifts.

## 5. No backticks inside CSS-in-TS comments

`openideSurfaceCss.ts` is a TypeScript template literal holding a stylesheet. A
backtick inside it closes the literal, including one inside a comment where it
reads as ordinary quoting. The parse error then surfaces four to eight lines away,
in unrelated code, with nothing pointing at the cause. This has cost two separate
debugging sessions.

Use plain quotes in those comments.

*Audited.* Checked in `auditBackticks`.

## 6. One scale for radii, hairlines and shadows

Nothing here was ever reported as a bug, which is the point. The fork's own
stylesheets carried eight corner radii (3, 4, 5, 6, 8, 9, 10 and 12px), 26 distinct
alphas of `rgba(128, 128, 128, α)` and six shadow recipes. Worse, the same upstream
token had two different fallbacks: `--vscode-cornerRadius-medium` was written as
`4px` in two places and `6px` in thirteen, so the *same* control took two shapes
depending on which file drew it and on whether the theme defined the token. Two cards
side by side never quite matched, and nobody could say which one was right.

Each value is defensible on its own. Together they are a design system nobody chose.
The rule is that these three families are written **only** through the `--oi-*`
scale declared in `openideSurfaceCss.ts`; a literal is a decision made in one file
about something that has to hold across all of them.

| Token | Value | Replaces |
| --- | --- | --- |
| `--oi-radius-sm` | `var(--vscode-cornerRadius-small, 4px)` | `3px`, `4px`, `var(--vscode-cornerRadius-small, …)` |
| `--oi-radius-md` | `var(--vscode-cornerRadius-medium, 6px)` | `5px`, `6px`, `var(--vscode-cornerRadius-medium, …)` |
| `--oi-radius-lg` | `var(--vscode-cornerRadius-large, 8px)` | `8px`, `9px`, `10px`, `12px`, `var(--vscode-cornerRadius-large, …)` |
| `--oi-radius-circle` | `var(--vscode-cornerRadius-circle, 9999px)` | `999px`, `9999px` |
| `--oi-radius` | alias of `--oi-radius-lg` | the Settings cards' literal `10px` (deliberately 10 → 8: one step outside the scale is not a step) |
| `--oi-chat-card-radius` | alias of `--oi-radius-lg` | its own `var(--vscode-cornerRadius-large, 8px)` |
| `--oi-tint-1` | `rgba(128, 128, 128, 0.04)` | alphas 0.025 – 0.06 (quiet fills) |
| `--oi-tint-2` | `rgba(128, 128, 128, 0.08)` | alphas 0.08 – 0.105 (hover fills) |
| `--oi-tint-3` | `rgba(128, 128, 128, 0.12)` | alpha 0.12 (pressed fills) |
| `--oi-border-soft` | `rgba(128, 128, 128, 0.14)` | alphas 0.14 – 0.18 (row separators) |
| `--oi-border` | `rgba(128, 128, 128, 0.24)` | alphas 0.20 – 0.28 (the default outline) |
| `--oi-border-strong` | `rgba(128, 128, 128, 0.34)` | alphas 0.30 – 0.40 (emphasised outlines) |
| `--oi-shadow-sm` | `0 1px 1px var(--vscode-widget-shadow, …)` | `0 1px 1px rgba(0, 0, 0, 0.12)` — a card lifted off its surface |
| `--oi-shadow` | `0 2px 8px var(--vscode-widget-shadow, …)` | `0 2px 8px rgba(0, 0, 0, 0.35)` — popovers, menus |
| `--oi-shadow-lg` | `0 16px 48px var(--vscode-widget-shadow, …)` | `0 16px 48px rgba(0, 0, 0, 0.42)` — modals |

Radii of 2px and under, `0`, `50%` and `inherit` stay literal: they are not on the
scale because they are not a corner treatment, they are "square" or "round".
`var(--vscode-cornerRadius-xSmall, 2px)` is allowed for the same reason. Upstream's
own `var(--vscode-shadow-*, …)` and `var(--vscode-*-shadow, …)` stay as they are:
they are theme tokens, not recipes of ours. When a grey appears as the fallback of a
theme token, the fallback is the `--oi-*` token — `var(--vscode-menu-border,
var(--oi-border-strong))` is the shape to write.

The scale also declares `--oi-text-xs/sm/md/lg` (11/12/13/14px) and
`--oi-row-sm/md/lg` (24/28/32px). They are names to reach for; the existing font-size
and height literals have **not** been migrated onto them yet, and are not audited.

*Audited.* Checked in `auditScaleSource` — rule C, over every own `.css` and both
CSS-in-TS literals; the token block of `openideSurfaceCss.ts` is the one place the
raw greys and shadow recipes may appear.

## 7. No loose hairlines

A 1px line that separates two regions — a sidebar from its content, a header from the body
under it, one row from the next — is the inherited look the fork is moving away from. Every one
of them looks correct in the theme it was drawn against and reads as "stripes" over a flat
background in the next one: a theme that defines `titleBar.border` as a strong colour turns the
rule into a bar, one that leaves it undefined makes the same rule vanish, and a row separator
over a low-contrast card is a grey smear nobody asked for.

Regions are told apart by **surface and space**, not by a line. The sidebar of Settings sits on
`--oi-sidebar`, the content on `--oi-surface`; the modal's header has the title bar colour and
the body the editor's. Rows are separated by their own height, their inset padding and the hover
box that lights up under the pointer — the popover's recipe (`openideChatMenus.css`): a
container with 4px of padding and rounded rows inside it, nothing drawn between them.

The rule is "no loose lines", not "no borders": the 1px `--oi-border-soft` **around** a card, an
input or a callout is the box's own edge and stays. What goes is a line with nothing on one side.

Removed so far:

- `modalEditorPart.css` — the `border-bottom` under the modal header and the `border-right`
  of the modal sidebar. The modal's outer edge became the floating-card recipe
  (`floatingPanels.css`): `surface.border` with `--oi-border` as fallback, radius
  `cornerRadius-large`.
- `openideSettings.css` — the `border-bottom` of `.openide-settings-status-row`, the inset
  `::before` hairlines between `.openide-settings-insetrow` and between
  `.openide-settings-provider-model`, and the dead `border-top: 0` / `border-right: 0`
  resets that only existed to undo lines drawn elsewhere.
- Settings' own sidebar and content header never drew one; the modal was the last place a line
  crossed the Settings surface.

*Review rule.* Not audited: a `border-bottom` is legitimate on a card's own edge, and the audit
cannot tell the two apart.

## Verifying a surface

Typecheck proves nothing about colour. The IDE runs with
`--remote-debugging-port=9222`; drive it with `playwright-core` through
`chromium.connectOverCDP` and read the computed styles.

Two traps worth knowing before trusting a measurement:

- Read the side you mean. A probe that reports `borderTopWidth` for whichever side
  it detected will call a `border-right: 1px` element "0px" and clear it of
  suspicion. That mistake hid the Settings separators through a whole round.
- A CSS mask paints the element's own background through the glyph. Without
  `background-color` and `mask-size` the mark is an invisible box, not a missing
  file — and an asset that arrives on a full-bleed plate renders as a solid square.

Check at least two themes with different palettes. A single dark theme will agree
with almost any mistake in this document.
