/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the product's visual language, in a single place.
 *
 *  The webviews (chat, plan viewer) live in an iframe and cannot import a workbench stylesheet,
 *  so the tokens travel as a string that each one inlines. Settings is workbench DOM and gets
 *  the same string injected into <head> by `applyOpenideSurfaceCss()`. One definition, both
 *  worlds — Settings used to keep a parallel `--ois-*` set, and the two had already drifted
 *  (its surface honoured `openide-islandBackground`, the webviews' did not).
 *
 *  Only `--vscode-*` reaches inside a webview: the host exports the active theme's colours as
 *  custom properties (see webview/browser/themeing.ts). Workbench MODULES do not cross that
 *  boundary, which is why this is CSS text and not a TypeScript theme object.
 *
 *  Rule: if a visual value (radius, tone, size) has to be identical on two surfaces, it lives
 *  here. What belongs to one surface stays in it.
 *
 *  The tokens derive from the theme by luminance (`color-mix` over the editor background)
 *  instead of bringing their own colours: that way they follow the user's theme instead of fighting it.
 *--------------------------------------------------------------------------------------------*/

export const OPENIDE_SURFACE_CSS = `
/* TWO selectors, and the second one is load-bearing: the theme variables (--vscode-*) do NOT
   live on :root in the workbench, they live on .monaco-workbench. Declared on :root alone, every
   token below that derives from a --vscode-* resolved to "invalid at computed-value time" and
   computed to NOTHING on every native surface — the chat dock, Settings, the plan editor, the
   Project Map — so all of them ran on each rule's fallback instead of on the design system.
   Inside a webview .monaco-workbench does not exist and :root is what applies, which is how this
   worked until now. Measured: --vscode-editor-background is unset on :root, #282a36 on
   .monaco-workbench. See docs/theming-surfaces.md. */
:root, .monaco-workbench {
	/* Neutral hairlines and tints. ONE grey, six alphas: every rgba(128, 128, 128, a) that used to
	   be typed by hand (26 different alphas across the fork) maps onto one of these.
	   - border-strong replaces alphas 0.30-0.40 (emphasised outlines, pressed states)
	   - border replaces 0.20-0.28 (the default 1px outline)
	   - border-soft replaces 0.14-0.18 (row separators, quiet outlines)
	   - tint-3 replaces 0.12, tint-2 replaces 0.08-0.105, tint-1 replaces 0.025-0.06 (fills) */
	--oi-border-strong: rgba(128, 128, 128, 0.34);
	--oi-border: rgba(128, 128, 128, 0.24);
	--oi-border-soft: rgba(128, 128, 128, 0.14);
	--oi-tint-1: rgba(128, 128, 128, 0.04);
	--oi-tint-2: rgba(128, 128, 128, 0.08);
	--oi-tint-3: rgba(128, 128, 128, 0.12);
	--oi-separator: var(--vscode-menu-separatorBackground, rgba(128, 128, 128, 0.25));
	/* islandBackground is the product's own surface colour; falling back to the plain editor
	   background made the webviews sit on a different tone than Settings. */
	--oi-surface: var(--vscode-openide-islandBackground, var(--vscode-editor-background));
	/* Derived from the surface, ALWAYS — not "input.background" with a color-mix fallback.
	   NOTE: no backticks in here, they close the TypeScript template literal.
	   That fallback never ran, because every theme defines "input.background"; and when a theme
	   gives it the same value as the island (Dracula: both #282a36) a search field ended up the
	   exact colour of the surface under it, separated only by its border. Mixing foreground into
	   the surface moves toward contrast on light and dark themes alike. */
	--oi-raised: color-mix(in srgb, var(--oi-surface) 94%, var(--vscode-foreground));
	--oi-card: color-mix(in srgb, var(--oi-surface) 97%, var(--vscode-foreground));
	--oi-sidebar: color-mix(in srgb, var(--oi-surface) 93%, var(--vscode-foreground));
	--oi-overlay: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--oi-surface)));
	--oi-hover: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
	--oi-hover-strong: var(--vscode-toolbar-hoverBackground, var(--oi-hover));
	--oi-selected: var(--vscode-list-activeSelectionBackground, var(--vscode-menu-selectionBackground, rgba(128, 128, 128, 0.2)));
	--oi-focus: var(--vscode-focusBorder);

	/* Text. Naming these stops every surface from repeating the theme's fallback chain. */
	--oi-text: var(--vscode-foreground);
	--oi-text-muted: var(--vscode-descriptionForeground);
	--oi-text-link: var(--vscode-textLink-foreground);

	--oi-danger: var(--vscode-errorForeground);
	--oi-warn: var(--vscode-editorWarning-foreground);
	/* The product's diff green and red: the cool green of the review's overview-ruler marker
	   (openideEditReview.ts), NOT the theme's gitDecoration/charts colours — those are what the
	   user's grey-leaning themes neutralise. Overridable through --openide-accent-green/red. */
	--openide-green: var(--openide-accent-green, #2b9771);
	--openide-red: var(--openide-accent-red, #c23f60);
	/* The amber of an edit that is NOT accepted yet: the review's gutter marks the lines the agent
	   touched and still owe a Keep/Undo, which is a different fact from "this line was added" and
	   deserves its own colour. Same warmth as the green and the red above are cool, so the three
	   read as one family. Overridable through --openide-accent-amber. */
	--openide-amber: var(--openide-accent-amber, #d1a54a);
	--oi-success: var(--openide-green);

	--oi-font: var(--vscode-font-family);
	--oi-font-mono: var(--vscode-editor-font-family, monospace);
	/* Elevation. Three recipes, and the theme's widget.shadow paints all of them.
	   - shadow-sm replaces "0 1px 1px rgba(0, 0, 0, 0.12)" (a card lifted off its surface)
	   - shadow replaces "0 2px 8px rgba(0, 0, 0, 0.35)" (popovers, menus)
	   - shadow-lg replaces "0 16px 48px rgba(0, 0, 0, 0.42)" (modals) */
	--oi-shadow-sm: 0 1px 1px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.12));
	--oi-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
	--oi-shadow-lg: 0 16px 48px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.42));

	/* Reading width. A document spanning a whole monitor is not read, it is skimmed. */
	--oi-column: 880px;

	/* Corner radii. Four steps, following the workbench's own cornerRadius scale so a theme that
	   redefines it moves the fork with it. Before this the fork carried 3/4/5/6/8/9/10/12px and
	   the SAME upstream token with two different fallbacks (4px in two places, 6px in thirteen).
	   - radius-sm replaces 3px and 4px (chips, small buttons, inputs)
	   - radius-md replaces 5px and 6px (buttons, segments, callouts)
	   - radius-lg replaces 8px, 9px, 10px and 12px (cards, the composer, dialogs)
	   - radius-circle replaces 999px / 9999px (pills, dots) */
	--oi-radius-sm: var(--vscode-cornerRadius-small, 4px);
	--oi-radius-md: var(--vscode-cornerRadius-medium, 6px);
	--oi-radius-lg: var(--vscode-cornerRadius-large, 8px);
	--oi-radius-circle: var(--vscode-cornerRadius-circle, 9999px);
	/* Alias kept for the Settings cards: it was a literal 10px, one step outside the scale. */
	--oi-radius: var(--oi-radius-lg);

	/* Type and row heights. Declared so the surfaces have a name to reach for; the existing
	   font-size / height literals are NOT migrated yet, that pass is a visual decision. */
	--oi-text-xs: 11px;
	--oi-text-sm: 12px;
	--oi-text-md: 13px;
	--oi-text-lg: 14px;
	--oi-row-sm: 24px;
	--oi-row-md: 28px;
	--oi-row-lg: 32px;

	/* THE transcript surface. Every card in the chat — the user's bubble, approvals, questions,
	   terminal, edits, plan, subagents — reads these three, so the dock has one card recipe
	   instead of the seven rgba(128,128,128,…) variants transcribed from the webview. */
	/* The user's bubble and every card in the transcript sit on the same neutral lift the rest of
	   the product uses — a few percent of foreground over the surface — NOT on Copilot's
	   chat.requestBubbleBackground / chat.requestBorder. Those two are tinted blue by most
	   themes (they are Copilot's brand inside the theme), so the dock read as a different product
	   from the Settings, the panels and the editor around it. */
	--oi-chat-card-bg: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
	--oi-chat-card-border: var(--oi-border);
	--oi-chat-card-radius: var(--oi-radius-lg);
}

/* Columna de lectura, igual que la de Settings. */
.oi-column { width: 100%; max-width: var(--oi-column); margin: 0 auto; }

/* Section header: title, description and a line separating it from the content. */
.oi-head { padding-bottom: 13px; border-bottom: 1px solid var(--oi-border); }
.oi-title { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; letter-spacing: -0.005em; }
.oi-desc { max-width: 62ch; margin: 5px 0 0; color: var(--vscode-descriptionForeground); font-size: 12.5px; line-height: 19px; }

/* Card: groups rows so they read as one block. */
.oi-card { border: 1px solid var(--oi-border-soft); border-radius: var(--oi-radius); background: var(--oi-card); overflow: hidden; }

/* Live status pill. The tones come from the theme. */
.oi-pill {
	flex: 0 0 auto;
	padding: 1px 8px;
	border: 1px solid var(--oi-border);
	border-radius: var(--oi-radius-lg);
	background: var(--oi-raised);
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
	white-space: nowrap;
}
.oi-pill.ok { border-color: color-mix(in srgb, var(--openide-green) 45%, transparent); color: var(--openide-green); }
.oi-pill.warn { border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 45%, transparent); color: var(--vscode-editorWarning-foreground); }
.oi-pill.error { border-color: color-mix(in srgb, var(--vscode-errorForeground) 45%, transparent); color: var(--vscode-errorForeground); }

/* Framed notice: something to read before carrying on. */
.oi-callout { margin: 10px 0; padding: 10px 12px; border: 1px solid var(--oi-border); border-left-width: 3px; border-radius: var(--oi-radius-md); background: var(--oi-raised); font-size: 12px; line-height: 1.5; }
.oi-callout.warn { border-left-color: var(--vscode-editorWarning-foreground); }
.oi-callout.error { border-left-color: var(--vscode-errorForeground); }
.oi-callout-title { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-weight: 600; }

/* Shortcut hint INSIDE a button ("Build  Ctrl+⏎"): the button's own font, one step smaller and
   quieter through the colour, never a boxed key cap. Every control that carries a shortcut uses
   this one class, so the hints read as one family across the chat, the plan and the trays. */
.oi-kbd { margin-left: 6px; font-size: 11px; font-weight: 400; letter-spacing: 0.01em; white-space: nowrap; color: color-mix(in srgb, currentColor 65%, transparent); }

/* Split button ("Build  Ctrl+⏎ | v"): ONE filled pill whose two halves are transparent buttons
   told apart by a 1px divider in the button's own text colour. Used by the chat's plan card and
   the plan editor's toolbar, so the two never drift. States: .running (disabled, spinner in the
   main half) and .completed (check). */
.oi-split { display: inline-flex; flex: 0 0 auto; align-items: stretch; height: 24px; border: 1px solid var(--vscode-button-border, transparent); border-radius: var(--oi-radius-md); background: var(--vscode-button-background); color: var(--vscode-button-foreground); overflow: hidden; }
.oi-split > button { display: inline-flex; align-items: center; gap: 0; min-width: 0; padding: 0 8px; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; font-size: 12.5px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; }
.oi-split > button:hover { background: color-mix(in srgb, var(--vscode-button-foreground) 12%, transparent); }
.oi-split > button:disabled { cursor: default; }
.oi-split > button:disabled:hover { background: transparent; }
.oi-split > .oi-split-more { padding: 0 5px; border-left: 1px solid color-mix(in srgb, var(--vscode-button-foreground) 28%, transparent); }
.monaco-workbench .oi-split > .oi-split-more .codicon[class*="codicon-"] { font-size: 12px; color: inherit; }
.monaco-workbench .oi-split > button .codicon[class*="codicon-"] { font-size: 13px; color: inherit; }
.oi-split > button .codicon + span, .oi-split > button .openide-chat-plan-spinner + span { margin-left: 5px; }
/* Focus: the workbench paints "button:focus" with a 1px outline, which on a half of the split shows
   as a box cut by the pill's rounded clip. A pointer press leaves no ring (modernUI's rule for the
   parts, applied here too); keyboard focus draws ONE ring around the whole pill. */
.monaco-workbench .oi-split > button:focus { outline: none; }
/* Keyboard focus lights the pill's OWN border, never a second ring outside it. */
.monaco-workbench .oi-split:has(> button:focus-visible) { border-color: var(--vscode-focusBorder); }

/* Buttons: the same weight and radius as the Settings ones. */
.oi-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 29px; padding: 4px 12px; border: 0; border-radius: var(--oi-radius-md); background: var(--oi-hover); color: var(--vscode-foreground); font: inherit; cursor: pointer; }
.oi-btn:hover { background: color-mix(in srgb, var(--oi-hover) 60%, var(--vscode-foreground) 8%); }
.oi-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.oi-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
.oi-btn:disabled { opacity: 0.5; cursor: default; }

/* Segments: a choice among a few mutually exclusive options. */
.oi-segmented { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--oi-radius-md); background: var(--oi-raised); }
.oi-segment { min-height: 25px; padding: 3px 12px; border: 0; border-radius: var(--oi-radius-md); background: transparent; color: var(--vscode-descriptionForeground); font: inherit; font-size: 12px; cursor: pointer; }
.oi-segment:hover { background: var(--oi-hover); color: var(--vscode-foreground); }
.oi-segment.active { background: var(--vscode-list-activeSelectionBackground, var(--oi-border-soft)); color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); font-weight: 550; }
/* ---- Scroll surfaces ------------------------------------------------------------------------
   ONE scrollbar skin for every overflow container the fork paints itself: Settings (nav and
   page), the chat transcript and everything inside it (fences, tables, the prompt textarea), the
   diagram stage. It used to be five copies of a square 10px thumb flush against the edge, which
   read as a stray grey block next to whatever sat in the corner. The shape is Cursor's: a 6px
   pill floating in a 12px gutter — the 3px transparent border plus background-clip is what
   insets the thumb without shrinking the hit area — and no track, no stepper arrows.

   scrollbar-color: auto is load-bearing: a non-auto value (the workbench base styles set one)
   makes Chromium draw the STANDARD scrollbar and ignore every ::-webkit-scrollbar rule on that
   element. Same for scrollbar-width — never set it to thin/none on a surface listed here. A
   surface that wants the bar hidden (the tab strips, the menus) sets both to none on its own.

   No .oi-scroll class: the chat rules select on descendants (*) and the others are named
   containers, so a marker class would have to be added by hand in five widgets for nothing. */
.openide-settings-nav,
.openide-settings-content,
.openide-chat-native *,
.openide-diagram *,
.openide-diagram-scroll,
.openide-cli-changes { scrollbar-color: auto; scrollbar-width: auto; }

.openide-settings-nav::-webkit-scrollbar,
.openide-settings-content::-webkit-scrollbar,
.openide-chat-native *::-webkit-scrollbar,
.openide-diagram *::-webkit-scrollbar,
.openide-diagram-scroll::-webkit-scrollbar ,
.openide-cli-changes::-webkit-scrollbar { width: 12px; height: 12px; }

.openide-settings-nav::-webkit-scrollbar-button,
.openide-settings-content::-webkit-scrollbar-button,
.openide-chat-native *::-webkit-scrollbar-button,
.openide-diagram *::-webkit-scrollbar-button,
.openide-diagram-scroll::-webkit-scrollbar-button ,
.openide-cli-changes::-webkit-scrollbar-button { display: none; width: 0; height: 0; }

.openide-settings-nav::-webkit-scrollbar-track,
.openide-settings-content::-webkit-scrollbar-track,
.openide-chat-native *::-webkit-scrollbar-track,
.openide-diagram *::-webkit-scrollbar-track,
.openide-diagram-scroll::-webkit-scrollbar-track,
.openide-settings-nav::-webkit-scrollbar-corner,
.openide-settings-content::-webkit-scrollbar-corner,
.openide-chat-native *::-webkit-scrollbar-corner,
.openide-diagram *::-webkit-scrollbar-corner,
.openide-diagram-scroll::-webkit-scrollbar-corner ,
.openide-cli-changes::-webkit-scrollbar-corner { background: transparent; border: none; }

.openide-settings-nav::-webkit-scrollbar-thumb,
.openide-settings-content::-webkit-scrollbar-thumb,
.openide-chat-native *::-webkit-scrollbar-thumb,
.openide-diagram *::-webkit-scrollbar-thumb,
.openide-diagram-scroll::-webkit-scrollbar-thumb ,
.openide-cli-changes::-webkit-scrollbar-thumb {
	min-height: 28px;
	min-width: 28px;
	border: 3px solid transparent;
	border-radius: var(--oi-radius-circle);
	background: var(--vscode-scrollbarSlider-background);
	background-clip: padding-box;
}

.openide-settings-nav::-webkit-scrollbar-thumb:hover,
.openide-settings-content::-webkit-scrollbar-thumb:hover,
.openide-chat-native *::-webkit-scrollbar-thumb:hover,
.openide-diagram *::-webkit-scrollbar-thumb:hover,
.openide-diagram-scroll::-webkit-scrollbar-thumb:hover ,
.openide-cli-changes::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground); }

.openide-settings-nav::-webkit-scrollbar-thumb:active,
.openide-settings-content::-webkit-scrollbar-thumb:active,
.openide-chat-native *::-webkit-scrollbar-thumb:active,
.openide-diagram *::-webkit-scrollbar-thumb:active,
.openide-diagram-scroll::-webkit-scrollbar-thumb:active ,
.openide-cli-changes::-webkit-scrollbar-thumb:active { background-color: var(--vscode-scrollbarSlider-activeBackground); }

/* The workbench's own scrollbars (every list, tree, editor, panel: they all go through
   monaco-scrollable-element) get the SAME 6px pill, so the explorer, the transcript and Settings
   no longer show three different bars side by side. The slider node is sized and positioned by
   JS (abstractScrollbar.ts writes width/height/top/left inline) and carries contain: strict, so
   the box itself is left alone: it stays the full-width hit area, painted transparent, and the
   pill is a pseudo-element centred inside it. That keeps the 14px editor bar and the 10px list
   bar drawing the identical thumb without touching editor.scrollbar.* settings. Hover and
   active keep upstream's three slider tokens. Minimap slider is not a scrollbar; untouched. */
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider { background: transparent; }
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider::after {
	content: '';
	position: absolute;
	border-radius: var(--oi-radius-circle);
	background: var(--vscode-scrollbarSlider-background);
}
.monaco-workbench .monaco-scrollable-element > .scrollbar.vertical > .slider::after { top: 0; bottom: 0; left: 50%; width: 6px; margin-left: -3px; }
.monaco-workbench .monaco-scrollable-element > .scrollbar.horizontal > .slider::after { left: 0; right: 0; top: 50%; height: 6px; margin-top: -3px; }
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider:hover { background: transparent; }
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider:hover::after { background: var(--vscode-scrollbarSlider-hoverBackground); }
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider.active { background: transparent; }
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider.active::after { background: var(--vscode-scrollbarSlider-activeBackground); }
`;
