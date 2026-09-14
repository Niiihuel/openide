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

/** Bootstrap Icons, MIT; Copyright (c) 2019-2024 The Bootstrap Authors. See ThirdPartyNotices.txt. */
export const OPENIDE_EXPAND_ICON_PATH = 'M5.828 10.172a.5.5 0 0 0-.707 0l-4.096 4.096V11.5a.5.5 0 0 0-1 0v3.975a.5.5 0 0 0 .5.5H4.5a.5.5 0 0 0 0-1H1.732l4.096-4.096a.5.5 0 0 0 0-.707m4.344-4.344a.5.5 0 0 0 .707 0l4.096-4.096V4.5a.5.5 0 1 0 1 0V.525a.5.5 0 0 0-.5-.5H11.5a.5.5 0 0 0 0 1h2.768l-4.096 4.096a.5.5 0 0 0 0 .707';
export const OPENIDE_CONTRACT_ICON_PATH = 'M.172 15.828a.5.5 0 0 0 .707 0l4.096-4.096V14.5a.5.5 0 1 0 1 0v-3.975a.5.5 0 0 0-.5-.5H1.5a.5.5 0 0 0 0 1h2.768L.172 15.121a.5.5 0 0 0 0 .707M15.828.172a.5.5 0 0 0-.707 0l-4.096 4.096V1.5a.5.5 0 1 0-1 0v3.975a.5.5 0 0 0 .5.5H14.5a.5.5 0 0 0 0-1h-2.768L15.828.879a.5.5 0 0 0 0-.707';

export const OPENIDE_SURFACE_TOKENS_CSS = `
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
	--oi-border-strong: var(--oi-border-overlay);
	--oi-border: var(--vscode-widget-border, rgba(128, 128, 128, 0.24));
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
	--oi-raised: var(--vscode-input-background, color-mix(in srgb, var(--oi-surface) 92%, var(--vscode-foreground)));
	--oi-card: color-mix(in srgb, var(--oi-surface) 95%, var(--vscode-foreground));
	/* Conversation controls share one elevated surface and one compact navigation rhythm. */
	--oi-conversation-panel: color-mix(in srgb, var(--oi-surface) 90%, var(--vscode-foreground));
	--oi-navigation-row-height: 30px;
	--oi-navigation-row-padding: 4px 8px;
	--oi-navigation-row-radius: var(--oi-radius-row);
	--oi-navigation-row-gap: 2px;
	--oi-sidebar: var(--oi-shell);
	--oi-overlay: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--oi-surface)));
	--oi-hover: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
	--oi-hover-strong: var(--vscode-toolbar-hoverBackground, var(--oi-hover));
	--oi-selected: var(--vscode-list-activeSelectionBackground, var(--vscode-menu-selectionBackground, rgba(128, 128, 128, 0.2)));
	--oi-focus: var(--vscode-focusBorder);

	/* Text. Naming these stops every surface from repeating the theme's fallback chain. */
	--oi-text: var(--vscode-foreground);
	--oi-text-muted: var(--vscode-descriptionForeground);
	--oi-text-link: var(--vscode-textLink-foreground);
	--oi-accent: var(--oi-text-link);

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
	--oi-shadow-md: var(--oi-shadow);
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
	--oi-radius-sm: var(--oi-radius-item);
	--oi-radius-md: var(--oi-radius-control);
	--oi-radius-lg: var(--oi-radius-group);
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
	--oi-shell: var(--vscode-openide-workbenchBackground, var(--vscode-sideBar-background));
	--oi-canvas: var(--oi-surface);
	--oi-group: var(--oi-card);
	/* Controls have a quiet fill independent of theme input/card elevation. */
	--oi-control: color-mix(in srgb, var(--oi-surface) 97%, var(--oi-text));
	--oi-control-border: var(--vscode-contrastBorder, color-mix(in srgb, var(--oi-surface) 88%, var(--oi-text)));
	--oi-control-border-hover: var(--vscode-contrastActiveBorder, color-mix(in srgb, var(--oi-surface) 78%, var(--oi-text)));
	--oi-popover: var(--oi-overlay);
	--oi-divider: var(--oi-separator);
	--oi-secondary: var(--oi-text-muted);
	--oi-border-overlay: var(--vscode-editorWidget-border, var(--oi-border));
	--oi-border-hover: color-mix(in srgb, var(--oi-border-overlay) 92%, var(--vscode-foreground));
	--oi-primary: var(--oi-text);
	--oi-primary-foreground: var(--oi-canvas);
	--oi-primary-hover: color-mix(in srgb, var(--oi-primary) 86%, var(--oi-canvas));
	--oi-round-action-background: #fff;
	--oi-round-action-foreground: #111;
	--oi-icon-expand-size: 14px;
	--oi-icon-expand-mask: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cpath%20fill-rule='evenodd'%20d='${OPENIDE_EXPAND_ICON_PATH}'/%3E%3C/svg%3E");
	--oi-icon-contract-mask: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cpath%20fill-rule='evenodd'%20d='${OPENIDE_CONTRACT_ICON_PATH}'/%3E%3C/svg%3E");
	--oi-icon-action: 16px;
	--oi-icon-send: 14px;
	--oi-icon-tab-close: 13px;
	--oi-round-action-size: 24px;
	--oi-radius-control: 12px;
	--oi-radius-item: 7px;
	--oi-radius-row: 9px;
	--oi-radius-group: 14px;
	--oi-radius-popover: 12px;
	--oi-radius-tooltip: 7px;
	--oi-radius-composer: 18px;
	--oi-radius-dialog: 20px;
	--oi-content-width-settings: 960px;
	--oi-shimmer-duration: 3.2s;
	--oi-shimmer-delay: 1s;
	--oi-shimmer-spread: calc(2ch + 24px);
	--oi-motion-enter: 180ms;
	--oi-motion-exit: 120ms;
	--oi-motion-morph: 260ms;
	--oi-motion-tooltip: 110ms;
	--oi-duration-hover: 120ms;
	--oi-ease-out: cubic-bezier(.32, .72, 0, 1);
	--oi-ease: var(--oi-ease-out);
	--oi-scroll-inset: 6px;
	--vscode-context-view-motion-duration: var(--oi-motion-morph);
	--vscode-context-view-motion-enter-duration: var(--oi-motion-enter);
	--vscode-context-view-motion-exit-duration: var(--oi-motion-exit);
	--vscode-context-view-motion-easing: var(--oi-ease-out);


	/* THE transcript surface. Every card in the chat — the user's bubble, approvals, questions,
	   terminal, edits, plan, subagents — reads these three, so the dock has one card recipe
	   instead of the seven rgba(128,128,128,…) variants transcribed from the webview. */
	/* The user's bubble and every card in the transcript sit on the same neutral lift the rest of
	   the product uses — a few percent of foreground over the surface — NOT on Copilot's
	   chat.requestBubbleBackground / chat.requestBorder. Those two are tinted blue by most
	   themes (they are Copilot's brand inside the theme), so the dock read as a different product
	   from the Settings, the panels and the editor around it. */
	--oi-chat-card-bg: var(--oi-group);
	--oi-chat-card-border: var(--oi-border);
	--oi-chat-card-radius: var(--oi-radius-lg);
}

.monaco-workbench.monaco-reduce-motion {
	--oi-motion-enter: 0ms;
	--oi-motion-exit: 0ms;
	--oi-motion-morph: 0ms;
	--oi-motion-tooltip: 0ms;
	--oi-duration-hover: 0ms;
}

@media (prefers-reduced-motion: reduce) {
	:root, .monaco-workbench { --oi-motion-enter: 0ms; --oi-motion-exit: 0ms; --oi-motion-morph: 0ms; --oi-motion-tooltip: 0ms; --oi-duration-hover: 0ms; }
}
`;

/** A narrow text-only sweep shared by live chat labels and background CLI changes. */
export const OPENIDE_SHIMMER_CSS = `
:is(.openide-chat-shimmer, .openide-cli-changes-shimmer, .oi-shimmer) {
	color: var(--oi-shimmer-base, var(--oi-secondary, var(--vscode-descriptionForeground)));
	background-image: linear-gradient(100deg,
		transparent calc(50% - var(--oi-shimmer-spread, 40px) / 2),
		var(--oi-shimmer-highlight, var(--oi-text, var(--vscode-foreground))) 50%,
		transparent calc(50% + var(--oi-shimmer-spread, 40px) / 2)),
		linear-gradient(currentColor, currentColor);
	background-size: 250% 100%, 100% 100%;
	background-position: 100% 0, 0 0;
	background-repeat: no-repeat;
	background-clip: text;
	-webkit-background-clip: text;
	-webkit-text-fill-color: transparent;
	animation: openide-text-shimmer var(--oi-shimmer-duration, 3.2s) linear var(--oi-shimmer-delay, 1s) infinite;
	/* Background clipping paints only this label. No per-frame JS, duplicated text,
	   filters or will-change layer; the final interval stays still between sweeps. */
}
@keyframes openide-text-shimmer {
	0% { background-position: 100% 0, 0 0; }
	60%, 100% { background-position: 0% 0, 0 0; }
}
.monaco-reduce-motion :is(.openide-chat-shimmer, .openide-cli-changes-shimmer, .oi-shimmer) {
	animation: none;
	background-image: none;
	-webkit-text-fill-color: currentColor;
}
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
	:is(.openide-chat-shimmer, .openide-cli-changes-shimmer, .oi-shimmer) {
		animation: none;
		background-image: none;
		-webkit-text-fill-color: currentColor;
	}
}
`;

/** One loading indicator for native widgets and OpenIDE webviews; semantic sync/refresh icons stay intact. */
export const OPENIDE_SPINNER_CSS = `
/* Paint only the glyph of native controls: their parent retains its hit target, alignment and
   lifecycle. In particular a toolbar action can itself carry codicon-loading at a wider size. */
:is(.oi-spinner, .openide-chat-plan-spinner) {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: var(--oi-spinner-size, var(--oi-icon-action, 16px));
	height: var(--oi-spinner-size, var(--oi-icon-action, 16px));
}
:is(.oi-spinner, .openide-chat-plan-spinner,
	.monaco-workbench.openide-visual .codicon-loading,
	.monaco-workbench.openide-visual .codicon-tree-item-loading,
	.openide-usage-refresh.loading .codicon) {
	/* Native codicon-loading normally rotates the entire control. The ring alone rotates here. */
	animation: none;
}
:is(.oi-spinner, .openide-chat-plan-spinner,
	.monaco-workbench.openide-visual .codicon-loading,
	.monaco-workbench.openide-visual .codicon-tree-item-loading,
	.openide-usage-refresh.loading .codicon)::before {
	content: "";
	display: inline-block;
	box-sizing: border-box;
	width: var(--oi-spinner-size, var(--oi-icon-action, 16px));
	height: var(--oi-spinner-size, var(--oi-icon-action, 16px));
	border: var(--oi-spinner-stroke, 2px) solid color-mix(in srgb, currentColor 32%, transparent);
	border-top-color: currentColor;
	border-radius: 50%;
	vertical-align: middle;
	animation: openide-spinner-turn var(--oi-spinner-duration, 900ms) linear infinite;
	transform-origin: center;
}
@keyframes openide-spinner-turn { to { transform: rotate(360deg); } }
:is(.monaco-workbench.openide-visual.monaco-reduce-motion, .monaco-reduce-motion) :is(.oi-spinner, .openide-chat-plan-spinner, .codicon-loading, .codicon-tree-item-loading)::before {
	animation: none;
}
@media (prefers-reduced-motion: reduce) {
	:is(.oi-spinner, .openide-chat-plan-spinner,
		.monaco-workbench.openide-visual .codicon-loading,
		.monaco-workbench.openide-visual .codicon-tree-item-loading,
	.openide-usage-refresh.loading .codicon)::before { animation: none; }
}
`;

export const OPENIDE_SURFACE_CSS = `${OPENIDE_SURFACE_TOKENS_CSS}
${OPENIDE_SHIMMER_CSS}
${OPENIDE_SPINNER_CSS}
/* Native action widgets keep their own geometry, connected edges and semantic status colors.
   Aliasing their paint tokens makes the same hover apply to activity, editor/dock toolbars and
   neutral status items without adding another background over their indicator. */
.monaco-workbench.openide-visual {
	--vscode-toolbar-hoverBackground: var(--oi-hover);
	--vscode-toolbar-activeBackground: var(--oi-selected);
	--vscode-modernActivityBar-hoverBackground: var(--oi-hover);
	--vscode-modernActivityBar-hoverForeground: var(--oi-text);
	--vscode-statusBarItem-hoverBackground: var(--oi-hover);
	--vscode-statusBarItem-compactHoverBackground: var(--oi-hover);
}
.monaco-workbench.openide-visual .monaco-action-bar .action-label {
	transition: background-color var(--oi-duration-hover) var(--oi-ease);
}
.monaco-workbench.openide-visual .activitybar .active-item-indicator {
	transition: background-color var(--oi-duration-hover) var(--oi-ease);
}
/* The native actions keep ownership of checked state, keyboard handling and tooltips. Render
   only their expansion glyph through the same Bootstrap paths as the chat's SVG button. */
.monaco-workbench.openide-visual :is(.codicon-screen-full:not(.openide-icon-fit), .codicon-screen-normal,
	.codicon-panel-maximize, .codicon-panel-restore, .codicon-auxiliarybar-maximize,
	.codicon-auxiliarybar-restore, .codicon-fullscreen)::before {
	content: "";
	display: inline-block;
	width: var(--oi-icon-expand-size, 14px);
	height: var(--oi-icon-expand-size, 14px);
	background-color: currentColor;
	mask-image: var(--oi-icon-expand-mask);
	mask-size: 12px 12px;
	mask-position: center;
	mask-repeat: no-repeat;
	vertical-align: middle;
}
.monaco-workbench.openide-visual :is(.codicon-screen-normal, .codicon-panel-restore,
	.codicon-auxiliarybar-restore, .codicon-panel-maximize.checked, .codicon-auxiliarybar-maximize.checked,
	.codicon-fullscreen.checked, .codicon-screen-full.checked:not(.openide-icon-fit))::before {
	mask-image: var(--oi-icon-contract-mask);
}
/* The legacy panel arrows rotated with its dock edge. Diagonal expand/contract keeps its orientation. */
.monaco-workbench.openide-visual .part.basepanel:is(.left, .right, .top) .global-actions :is(.codicon-panel-maximize, .codicon-panel-restore)::before {
	transform: none;
}

/* Opt-in adapter for native icon toolbars. The native action owns its hover and checked state. */
.monaco-workbench :is(.oi-dock-toolbar, .openide-agent-editor-surface .multiDiffEditor .actions) .monaco-action-bar .actions-container { gap: var(--vscode-spacing-size4, 4px); }
.monaco-workbench :is(.oi-dock-toolbar, .openide-agent-editor-surface .multiDiffEditor .actions) .monaco-action-bar .action-label.codicon:not(.separator) {
	box-sizing: border-box;
	width: 24px;
	height: 24px;
	padding: 4px;
	margin: 0;
	justify-content: center;
	font-size: var(--oi-icon-action);
	border-radius: var(--oi-radius-item);
	color: var(--oi-text-muted);
}
.monaco-workbench :is(.oi-dock-toolbar, .openide-agent-editor-surface .multiDiffEditor .actions) .monaco-action-bar .action-label.codicon:not(.separator)::before { font-size: var(--oi-icon-action); }
.monaco-workbench :is(.oi-dock-toolbar, .openide-agent-editor-surface .multiDiffEditor .actions) .monaco-action-bar .action-item:not(.disabled) .action-label:not(.separator):hover {
	background-color: var(--oi-hover);
	color: var(--oi-text);
}
.monaco-workbench :is(.oi-dock-toolbar, .openide-agent-editor-surface .multiDiffEditor .actions) .monaco-action-bar .monaco-dropdown-with-primary:not(.disabled):hover { background-color: transparent; }
.monaco-workbench :is(.oi-dock-toolbar, .openide-agent-editor-surface .multiDiffEditor .actions) .monaco-action-bar .action-label.checked:not(.separator) {
	background-color: var(--oi-selected);
	color: var(--oi-text);
}
.monaco-workbench :is(.oi-dock-toolbar, .openide-agent-editor-surface .multiDiffEditor .actions) .monaco-action-bar .action-label:focus:not(:focus-visible) { outline: none; }
.monaco-workbench :is(.oi-dock-toolbar, .openide-agent-editor-surface .multiDiffEditor .actions) .monaco-action-bar .action-label:focus-visible { outline: 1px solid var(--oi-focus); outline-offset: -1px; }
.monaco-workbench :is(.oi-dock-toolbar, .openide-agent-editor-surface .multiDiffEditor .actions) .monaco-action-bar .action-label.separator {
	width: 4px;
	min-width: 4px;
	margin: 0 !important;
	background: transparent;
	pointer-events: none;
}

/* A joined status control still has one owner per hover. Avoid the legacy second tint layer. */
.monaco-workbench.openide-visual .part.statusbar > .items-container > .statusbar-item:is(.compact-left, .compact-right) > a.statusbar-item-label:hover:not(.disabled) {
	background-image: none;
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
.oi-split { display: inline-flex; flex: 0 0 auto; align-items: stretch; height: 28px; border: 1px solid color-mix(in srgb, var(--vscode-button-background) 75%, white); border-radius: var(--oi-radius-md); background: var(--vscode-button-background); color: var(--vscode-button-foreground); overflow: hidden; }
.oi-split > button { display: inline-flex; align-items: center; gap: 0; min-width: 0; padding: 0 8px; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; font-size: 12.5px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; }
.oi-split > button:hover { background: color-mix(in srgb, var(--vscode-button-foreground) 12%, transparent); }
.oi-split > button:disabled { cursor: default; }
.oi-split > button:disabled:hover { background: transparent; }
.oi-split > .oi-split-more { padding: 0 5px; border-left: 1px solid color-mix(in srgb, var(--vscode-button-foreground) 28%, transparent); }
.monaco-workbench .oi-split > .oi-split-more .codicon[class*="codicon-"] { font-size: 12px; color: inherit; }
.monaco-workbench .oi-split > button .codicon[class*="codicon-"] { font-size: 13px; color: inherit; }
.oi-split > button .codicon + span, .oi-split > button .openide-chat-plan-spinner + span { margin-left: 6px; }
/* And the mirror: the running plan puts its ring AFTER the word in the chat card, where nothing
   was separating them. A spinner needs air on whichever side it lands on. */
.oi-split > button span + .openide-chat-plan-spinner { margin-left: 6px; }
/* Focus: the workbench paints "button:focus" with a 1px outline, which on a half of the split shows
   as a box cut by the pill's rounded clip. A pointer press leaves no ring (modernUI's rule for the
   parts, applied here too); keyboard focus draws ONE ring around the whole pill. */
.monaco-workbench .oi-split > button:focus { outline: none; }
/* Keyboard focus lights the pill's OWN border, never a second ring outside it. */
.monaco-workbench .oi-split:has(> button:focus-visible) { border-color: var(--vscode-focusBorder); }

/* Buttons: the same weight and radius as the Settings ones. */
.oi-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 29px; padding: 4px 12px; box-sizing: border-box; border: 1px solid var(--oi-control-border); border-radius: var(--oi-radius-control); background: var(--oi-control); color: var(--oi-text); font: inherit; cursor: pointer; transition: background-color var(--oi-duration-hover) var(--oi-ease), border-color var(--oi-duration-hover) var(--oi-ease); }
.oi-btn:hover:not(:disabled) { background: var(--oi-hover); border-color: var(--oi-control-border-hover); }
.oi-btn.primary { background: var(--oi-primary); color: var(--oi-primary-foreground); }
.oi-btn.primary:hover:not(:disabled) { background: var(--oi-primary-hover); }
.oi-btn.ghost { background: transparent; border-color: transparent; }
.oi-btn.ghost:hover:not(:disabled) { background: var(--oi-hover); border-color: transparent; }
.oi-btn.danger { color: var(--oi-danger); }
.oi-btn:disabled { opacity: 0.5; cursor: default; }
.oi-btn:focus:not(:focus-visible), .oi-segment:focus:not(:focus-visible) { outline: none; }
.oi-btn:focus-visible, .oi-segment:focus-visible { outline: 1px solid var(--oi-focus); outline-offset: 2px; }

/* Form and choice primitives shared with the isolated Canvas runtime. */
.oi-field { min-height: 29px; min-width: 0; box-sizing: border-box; padding: 5px 8px; border: 1px solid var(--oi-control-border); border-radius: var(--oi-radius-control); background: var(--oi-control); color: var(--oi-text); font: inherit; }
.oi-field:hover:not(:disabled) { border-color: var(--oi-control-border-hover); }
.oi-field:focus-visible { outline: 1px solid var(--oi-focus); outline-offset: 2px; }
.oi-field:disabled { opacity: .5; cursor: default; }
textarea.oi-field { resize: vertical; }
.oi-choice { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--oi-border); border-radius: var(--oi-radius-group); background: var(--oi-group); color: var(--oi-text); text-align: left; cursor: pointer; transition: background-color var(--oi-duration-hover) var(--oi-ease); }
.oi-choice:hover:not(:disabled) { background: var(--oi-hover); }
.oi-choice:is([aria-pressed=true], :has(> input:checked)) { border-color: var(--oi-focus); background: var(--oi-control); }
.oi-choice:focus-visible, .oi-choice:has(> input:focus-visible) { outline: 1px solid var(--oi-focus); outline-offset: 2px; }
.oi-choice > input { flex: 0 0 auto; margin: 3px 0 0; accent-color: var(--oi-focus); }
.oi-choice > input[type=radio] { appearance: none; width: 14px; height: 14px; border: 1px solid var(--oi-secondary); border-radius: 50%; background: transparent; color: var(--oi-text); }
.oi-choice > input[type=radio]:checked { border-color: currentColor; background: radial-gradient(circle, currentColor 0 3px, transparent 3px); }
.oi-choice > input:focus-visible { outline: none; }
.oi-choice strong, .oi-choice small { display: block; }
.oi-choice small { margin-top: 4px; color: var(--oi-secondary); line-height: 1.5; }

/* Dock roles adapt existing native elements: no wrapper, event handler, row height or scroll
   owner is replaced. Each renderer keeps its geometry and opts into the same paint variants. */
.oi-dock-row {
	border-radius: var(--oi-navigation-row-radius);
	background: transparent;
	border-color: transparent;
	transition: background-color var(--oi-duration-hover) var(--oi-ease);
}
.oi-dock-row:where(:hover:not(:disabled):not([aria-disabled="true"])) { background: var(--oi-hover); }
.oi-dock-row:is(.selected, [aria-selected="true"]) { background: var(--oi-selected); color: var(--vscode-list-activeSelectionForeground, var(--oi-text)); }
.oi-dock-row:focus:not(:focus-visible) { outline: none; }
.oi-dock-row:focus-visible { outline: 1px solid var(--oi-focus); outline-offset: -1px; }
.oi-dock-action {
	border-radius: var(--oi-radius-item);
	border-color: transparent;
	background: transparent;
	color: var(--oi-text-muted);
	transition: background-color var(--oi-duration-hover) var(--oi-ease), color var(--oi-duration-hover) var(--oi-ease);
}
.oi-dock-action:hover:not(:disabled):not([aria-disabled="true"]) { background: var(--oi-hover); color: var(--oi-action-hover-foreground, var(--oi-text)); }
.oi-dock-action:is(:disabled, [aria-disabled="true"]) { opacity: .5; cursor: default; }
.oi-dock-action:focus:not(:focus-visible) { outline: none; }
.oi-dock-action:focus-visible { outline: 1px solid var(--oi-focus); outline-offset: -1px; }
.oi-dock-section {
	border-radius: 0;
	background: transparent;
	color: var(--oi-text-muted);
	border-color: var(--oi-divider);
}

/* Segments: a choice among a few mutually exclusive options. */
.oi-segmented { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--oi-radius-md); background: var(--oi-raised); }
.oi-segment { min-height: 25px; padding: 3px 12px; border: 0; border-radius: var(--oi-radius-md); background: transparent; color: var(--vscode-descriptionForeground); font: inherit; font-size: 12px; cursor: pointer; }
.oi-segment:hover { background: var(--oi-hover); color: var(--vscode-foreground); }
.oi-segment.active { background: var(--vscode-list-activeSelectionBackground, var(--oi-border-soft)); color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); font-weight: 550; }
/* ---- Scroll surfaces ------------------------------------------------------------------------
   Native overflow and Monaco's simulated scrollbar share one themed skin. This does NOT set
   overflow, padding or viewport sizes: owners keep their measured frames, and a native bar only
   exists when that owner really overflows. The 12px hit area contains a 6px thumb, inset 3px.

   The global selector is deliberately zero-specificity. Widget rules that hide native scroll
   (input mirrors, editor tabs, virtualized lists) and prompt auto-hide still take precedence.
   Never reset scrollbar-width globally: width:none is part of those widgets' scroll ownership.

   Context views are siblings of the chat under the workbench, not descendants of chat-native.
   A menu's scrollbar-width:thin selects Chromium's platform scrollbar, bypassing the WebKit
   thumb AND button rules. Explicitly reset known native scrollports to auto; leave the rest of
   the workbench's scroll architecture alone. Rounded frames keep their own 6px viewport inset. */
:where(.monaco-workbench, .monaco-workbench *) { scrollbar-color: auto; scrollbar-gutter: auto; }
.monaco-workbench .openide-menu-content,
.oi-scroll,
.openide-settings-nav,
.openide-settings-content,
.openide-chat-native *,
.openide-diagram *,
.openide-diagram-scroll,
.openide-cli-changes { scrollbar-color: auto; scrollbar-width: auto; scrollbar-gutter: auto; }

:where(.monaco-workbench, .monaco-workbench *)::-webkit-scrollbar,
.monaco-workbench .openide-menu-content::-webkit-scrollbar,
.openide-settings-nav::-webkit-scrollbar,
.openide-settings-content::-webkit-scrollbar,
.openide-chat-native *::-webkit-scrollbar,
.openide-diagram *::-webkit-scrollbar,
.openide-diagram-scroll::-webkit-scrollbar ,
.openide-cli-changes::-webkit-scrollbar { width: 12px; height: 12px; }

:where(.monaco-workbench, .monaco-workbench *)::-webkit-scrollbar-button,
.monaco-workbench .openide-menu-content::-webkit-scrollbar-button,
.openide-settings-nav::-webkit-scrollbar-button,
.openide-settings-content::-webkit-scrollbar-button,
.openide-chat-native *::-webkit-scrollbar-button,
.openide-diagram *::-webkit-scrollbar-button,
.openide-diagram-scroll::-webkit-scrollbar-button ,
.openide-cli-changes::-webkit-scrollbar-button { display: none; width: 0; height: 0; }

:where(.monaco-workbench, .monaco-workbench *)::-webkit-scrollbar-track,
.monaco-workbench .openide-menu-content::-webkit-scrollbar-track,
.monaco-workbench .openide-menu-content::-webkit-scrollbar-corner,
:where(.monaco-workbench, .monaco-workbench *)::-webkit-scrollbar-corner,
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
.openide-cli-changes::-webkit-scrollbar-corner,
.openide-cli-changes::-webkit-scrollbar-track { background: transparent; border: none; }

/* End insets keep the pill away from the frame's rounded corners without reserving empty space. */
:where(.monaco-workbench, .monaco-workbench *)::-webkit-scrollbar-track { margin: 3px; }

:where(.monaco-workbench, .monaco-workbench *)::-webkit-scrollbar-thumb,
.monaco-workbench .openide-menu-content::-webkit-scrollbar-thumb,
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
	background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
	background-clip: padding-box;
}

:where(.monaco-workbench, .monaco-workbench *)::-webkit-scrollbar-thumb:hover,
.monaco-workbench .openide-menu-content::-webkit-scrollbar-thumb:hover,
.openide-settings-nav::-webkit-scrollbar-thumb:hover,
.openide-settings-content::-webkit-scrollbar-thumb:hover,
.openide-chat-native *::-webkit-scrollbar-thumb:hover,
.openide-diagram *::-webkit-scrollbar-thumb:hover,
.openide-diagram-scroll::-webkit-scrollbar-thumb:hover ,
.openide-cli-changes::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7)); }

:where(.monaco-workbench, .monaco-workbench *)::-webkit-scrollbar-thumb:active,
.monaco-workbench .openide-menu-content::-webkit-scrollbar-thumb:active,
.openide-settings-nav::-webkit-scrollbar-thumb:active,
.openide-settings-content::-webkit-scrollbar-thumb:active,
.openide-chat-native *::-webkit-scrollbar-thumb:active,
.openide-diagram *::-webkit-scrollbar-thumb:active,
.openide-diagram-scroll::-webkit-scrollbar-thumb:active ,
.openide-cli-changes::-webkit-scrollbar-thumb:active { background-color: var(--vscode-scrollbarSlider-activeBackground, rgba(191, 191, 191, 0.4)); }

/* The workbench's own scrollbars (every list, tree, editor, panel: they all go through
   monaco-scrollable-element, xterm terminals, plus the diff overview viewport) get the SAME 6px pill, so the explorer, the transcript and Settings
   no longer show three different bars side by side. The slider node is sized and positioned by
   JS (abstractScrollbar.ts writes width/height/top/left inline) and carries contain: strict, so
   the box itself is left alone: it stays the full-width hit area, painted transparent, and the
   pill is a pseudo-element centred inside it. That keeps the 14px editor bar and the 10px list
   bar drawing the identical thumb without touching editor.scrollbar.* settings.
   The diff overview retains its full hit area and colored change markers. Hover and
   active keep upstream's three slider tokens. Minimap slider is not a scrollbar; untouched. */
.monaco-workbench .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider,
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider,
.monaco-workbench .monaco-diff-editor .diffOverview > .diffViewport { background: transparent; }
.monaco-workbench .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider::after,
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider::after,
.monaco-workbench .monaco-diff-editor .diffOverview > .diffViewport::after {
	content: '';
	position: absolute;
	border-radius: var(--oi-radius-circle);
	background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
}
.monaco-workbench .xterm .xterm-scrollable-element > .xterm-scrollbar.xterm-vertical > .xterm-slider::after,
.monaco-workbench .monaco-scrollable-element > .scrollbar.vertical > .slider::after,
.monaco-workbench .monaco-diff-editor .diffOverview > .diffViewport::after { top: 0; bottom: 0; left: 50%; width: 6px; margin-left: -3px; }
.monaco-workbench .xterm .xterm-scrollable-element > .xterm-scrollbar.xterm-horizontal > .xterm-slider::after,
.monaco-workbench .monaco-scrollable-element > .scrollbar.horizontal > .slider::after { left: 0; right: 0; top: 50%; height: 6px; margin-top: -3px; }
.monaco-workbench .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider:hover,
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider:hover,
.monaco-workbench .monaco-diff-editor .diffOverview > .diffViewport:hover { background: transparent; }
.monaco-workbench .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider:hover::after,
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider:hover::after,
.monaco-workbench .monaco-diff-editor .diffOverview > .diffViewport:hover::after { background: var(--vscode-scrollbarSlider-hoverBackground); }
.monaco-workbench .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider.xterm-active,
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider.active,
.monaco-workbench .monaco-diff-editor .diffOverview > .diffViewport:active { background: transparent; }
.monaco-workbench .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider.xterm-active::after,
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider.active::after,
.monaco-workbench .monaco-diff-editor .diffOverview > .diffViewport:active::after { background: var(--vscode-scrollbarSlider-activeBackground); }
`;
