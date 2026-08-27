/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — SHARED CSS for the agent's diagram SVGs. The chat renders the SVG with
 *  these classes and the full-screen modal (openideDiagramEditor) carries that already-rendered
 *  SVG: BOTH documents must serve the same rules or the modal looks different
 *  (shapes with a default black fill, uncentred labels). A single source of truth.
 *--------------------------------------------------------------------------------------------*/

export const OPENIDE_DIAGRAM_SVG_CSS = `
	:root {
	/* Editorial tokens (diagram-design style-guide.md), derived from the active theme: warm-neutral
	   paper, one ink, ONE accent. Referenced by every diagram renderer as var(--oid-*). */
	--oid-paper: var(--vscode-editor-background);
	--oid-paper-2: color-mix(in srgb, var(--vscode-foreground) 4%, var(--vscode-editor-background));
	--oid-ink: var(--vscode-foreground);
	--oid-muted: color-mix(in srgb, var(--vscode-descriptionForeground) 85%, var(--vscode-foreground));
	--oid-soft: color-mix(in srgb, var(--vscode-descriptionForeground) 62%, transparent);
	--oid-rule: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
	--oid-rule-solid: color-mix(in srgb, var(--vscode-foreground) 26%, transparent);
	--oid-accent: var(--openide-diagram-accent, #eb6c36);
	--oid-accent-tint: color-mix(in srgb, var(--openide-diagram-accent, #eb6c36) 9%, transparent);
	--oid-link: var(--vscode-textLink-foreground, #2e5aa8);
	--oid-dot: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
	}
	.dnode-shape { fill: var(--oid-paper); stroke: var(--oid-rule-solid); stroke-width: 1; }
	.dnode-shape.focal { fill: var(--oid-accent-tint); stroke: var(--oid-accent); stroke-width: 1.2; }
	.dnode-label { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 4px 8px; box-sizing: border-box; font-size: 12px; font-weight: 600; color: var(--oid-ink); line-height: 1.3; overflow: hidden; font-family: var(--vscode-font-family); }
	.dedge-path { fill: none; stroke: var(--oid-muted); stroke-width: 1.2; }
	.dedge-path.dashed { stroke-dasharray: 4 3; stroke-width: 1; }
	.dchip { font-family: var(--vscode-editor-font-family, monospace); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; padding: 1px 5px; border-radius: 2px; background: var(--oid-paper); color: var(--oid-muted); display: inline-block; white-space: nowrap; }
	.dleg-swatch { fill: var(--oid-paper); stroke: var(--oid-rule-solid); stroke-width: 1; }
	.dleg-swatch.focal { fill: var(--oid-accent-tint); stroke: var(--oid-accent); }
	.dleg-line { stroke: var(--oid-muted); stroke-width: 1; stroke-dasharray: 4 3; }
	.dleg-label { fill: var(--oid-soft); font-size: 8.5px; font-family: var(--vscode-font-family); }
	/* Workbench-style scrollbars: the webview pages otherwise show Electron's native bar,
	   which no workbench surface has (same skin as the chat's, openideChatNative.css). */
	::-webkit-scrollbar { width: 10px; height: 10px; }
	::-webkit-scrollbar-track { background: transparent; }
	::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); }
	::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
	::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground); }
	::-webkit-scrollbar-button { display: none; }
	::-webkit-scrollbar-corner { background: transparent; }
`;
