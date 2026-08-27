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
	--oi-border: rgba(128, 128, 128, 0.24);
	--oi-border-soft: rgba(128, 128, 128, 0.14);
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
	--oi-success: var(--openide-green);

	--oi-font: var(--vscode-font-family);
	--oi-font-mono: var(--vscode-editor-font-family, monospace);
	--oi-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));

	/* Reading width. A document spanning a whole monitor is not read, it is skimmed. */
	--oi-column: 880px;
	--oi-radius: 10px;
	--oi-radius-sm: 6px;
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
	border-radius: 10px;
	background: var(--oi-raised);
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
	white-space: nowrap;
}
.oi-pill.ok { border-color: color-mix(in srgb, var(--openide-green) 45%, transparent); color: var(--openide-green); }
.oi-pill.warn { border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 45%, transparent); color: var(--vscode-editorWarning-foreground); }
.oi-pill.error { border-color: color-mix(in srgb, var(--vscode-errorForeground) 45%, transparent); color: var(--vscode-errorForeground); }

/* Framed notice: something to read before carrying on. */
.oi-callout { margin: 10px 0; padding: 10px 12px; border: 1px solid var(--oi-border); border-left-width: 3px; border-radius: var(--oi-radius-sm); background: var(--oi-raised); font-size: 12px; line-height: 1.5; }
.oi-callout.warn { border-left-color: var(--vscode-editorWarning-foreground); }
.oi-callout.error { border-left-color: var(--vscode-errorForeground); }
.oi-callout-title { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-weight: 600; }

/* Buttons: the same weight and radius as the Settings ones. */
.oi-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 29px; padding: 4px 12px; border: 0; border-radius: var(--oi-radius-sm); background: var(--oi-hover); color: var(--vscode-foreground); font: inherit; cursor: pointer; }
.oi-btn:hover { background: color-mix(in srgb, var(--oi-hover) 60%, var(--vscode-foreground) 8%); }
.oi-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.oi-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
.oi-btn:disabled { opacity: 0.5; cursor: default; }

/* Segments: a choice among a few mutually exclusive options. */
.oi-segmented { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--oi-radius-sm); background: var(--oi-raised); }
.oi-segment { min-height: 25px; padding: 3px 12px; border: 0; border-radius: 5px; background: transparent; color: var(--vscode-descriptionForeground); font: inherit; font-size: 12px; cursor: pointer; }
.oi-segment:hover { background: var(--oi-hover); color: var(--vscode-foreground); }
.oi-segment.active { background: var(--vscode-list-activeSelectionBackground, rgba(128, 128, 128, 0.18)); color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); font-weight: 550; }
`;
