---
title: Surfaces and themes
description: How OpenIDE's own UI gets its colours, and the five ways it has gone wrong.
---

Every rule here comes from a bug that shipped. They share one shape: **the surface looked correct in the theme it was written against, and fell apart in another one.** None of them announced itself as an error; the IDE just looked slightly off, which is the most expensive kind of defect to carry, because nobody files it and it accumulates for months.

`dev/audit-surface-tokens.mjs` enforces the two invariants that can be checked statically. The rest are review rules.

## 1. Fork tokens are declared where the theme variables live

The workbench defines `--vscode-*` on **`.monaco-workbench`**, not on `:root`.

`openideSurfaceCss.ts` defines the product's tokens (`--oi-surface`, `--oi-raised`, `--oi-card`, …) and every one of them derives from a `--vscode-*`. Declared on `:root` alone, each token resolved to *invalid at computed-value time* and computed to nothing on every native surface: the chat dock, Settings, the plan editor, the Project Map. All of them had been running on the per-rule fallbacks rather than on the design system.

The selector must carry both scopes:

```css
:root, .monaco-workbench { --oi-surface: …; }
```

`:root` is what applies inside a webview, where `.monaco-workbench` does not exist and the host exports the theme as custom properties on the iframe root.

*Audited.* Checked in `auditTokenScope`.

## 2. A surface uses the colour family that paints it

The fork does not paint its parts with `sideBar.background`. `sidebarPart.ts` uses `openide.islandBackground`, the "island" design. A rule that reaches for the upstream id instead looks identical in a theme that defines both the same way, and splits in two the moment a theme does not.

`openide.islandBackground` falls back to `editorBackground`, so any theme that does not define it still resolves, just to a different value than `sideBar.background`. That is exactly the case that breaks.

Write fork surfaces against `--oi-surface`. Reach for a `--vscode-*` id directly only when the surface genuinely belongs to upstream.

## 3. No `opacity` over an already-themed colour

A separator painted with `menu.separatorBackground` and then dimmed with `opacity: .5` is legible in a theme with a strong separator colour and invisible in one without. The theme author already decided how visible that line should be; halving it overrides that decision in the direction of "gone".

If a colour needs to be softer, define it softer, or let the theme's own token carry it.

## 4. One widget owns its border and its focus ring

A raw `<input>` inside a styled `<div>` produces **two** rings as soon as it takes focus: the wrapper draws its own on `:focus-within`, and the input receives the workbench's global `[tabindex]:focus` outline. The `outline: none` usually written to suppress the second one loses on specificity: `:not()` takes the specificity of its argument, so the obvious guard ties with the global rule and loses on load order.

This produced three separate "double border" reports before the pattern was named. The fix is not a more specific override: it is to use the native widget (`InputBox`, `Button`, `SelectBox`, `Checkbox` from `base/browser/ui/`), which is a single element that owns both. Native widgets also bring theme colours, focus handling, high contrast and the font-scaling metrics; each hand-rolled copy is one more thing that drifts.

## 5. No backticks inside CSS-in-TS comments

`openideSurfaceCss.ts` is a TypeScript template literal holding a stylesheet. A backtick inside it closes the literal, including one inside a comment where it reads as ordinary quoting. The parse error then surfaces four to eight lines away, in unrelated code, with nothing pointing at the cause. This has cost two separate debugging sessions.

Use plain quotes in those comments.

*Audited.* Checked in `auditBackticks`.

## Verifying a surface

Typecheck proves nothing about colour. The IDE runs with `--remote-debugging-port=9222`; drive it with `playwright-core` through `chromium.connectOverCDP` and read the computed styles.

Two traps worth knowing before trusting a measurement:

- Read the side you mean. A probe that reports `borderTopWidth` for whichever side it detected will call a `border-right: 1px` element "0px" and clear it of suspicion. That mistake hid the Settings separators through a whole round.
- A CSS mask paints the element's own background through the glyph. Without `background-color` and `mask-size` the mark is an invisible box, not a missing file, and an asset that arrives on a full-bleed plate renders as a solid square.

Check at least two themes with different palettes. A single dark theme will agree with almost any mistake in this document.
