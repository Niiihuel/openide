/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — SHARED CSS for the agent's diagram SVGs. The chat renders the SVG with
 *  these classes and the full-screen modal (openideDiagramEditor) carries that already-rendered
 *  SVG: BOTH documents must serve the same rules or the modal looks different
 *  (shapes with a default black fill, uncentred labels). A single source of truth.
 *
 *  The `--oid-*` tokens these rules read are NOT declared here. They live once, in
 *  diagrams/media/openideDiagrams.css on `.openide-diagram`: every consumer of a diagram today is
 *  workbench DOM (the native chat, the plan viewer, the full-screen editor pane), which loads that
 *  stylesheet. This string kept a `:root` copy of the same eleven declarations from the webview
 *  days and the two had already started to drift; a rule here reads the .css definition. If a
 *  webview host ever inlines this string again it must inline the token block alongside it.
 *--------------------------------------------------------------------------------------------*/

export const OPENIDE_DIAGRAM_SVG_CSS = `
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
	.amap-title { fill: var(--oid-muted); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; font-family: var(--vscode-font-family); }
	.amap-hull { fill: color-mix(in srgb, var(--oid-ink) 3%, transparent); stroke: var(--oid-rule); stroke-dasharray: 5 4; }
	.amap-hull-label { fill: var(--oid-soft); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; font-family: var(--vscode-font-family); }
	.amap-edge { fill: none; stroke: var(--oid-muted); stroke-width: 1.2; opacity: 0.45; transition: opacity 0.12s, stroke 0.12s; }
	.amap-edge.dashed { stroke-dasharray: 4 3; stroke-width: 1; }
	.amap-node { transition: opacity 0.12s; }
	.amap-shape { fill: var(--oid-paper); stroke-width: 1.2; }
	.amap-shape.emphasis { stroke-width: 1.8; }
	.amap-card { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; overflow: hidden; font-family: var(--vscode-font-family); pointer-events: none; }
	.amap-card-row { display: flex; align-items: center; gap: 6px; max-width: 100%; }
	.amap-card-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
	.amap-card-title { font-size: 11.5px; font-weight: 600; color: var(--oid-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.amap-card-sub { font-size: 9.5px; color: var(--oid-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
	.amap-focus .amap-node { opacity: 0.18; }
	.amap-focus .amap-edge { opacity: 0.06; }
	.amap-focus .amap-node.on { opacity: 1; }
	.amap-focus .amap-edge.on { opacity: 0.85; stroke: var(--amap-c, var(--oid-muted)); stroke-width: 1.4; }
	.amap-focus .amap-node.pinned .amap-shape { stroke-width: 2.4; }
	.smap-lifeline { stroke: var(--oid-rule-solid); stroke-width: 1; stroke-dasharray: 2 4; }
	/* Scrollbars: the same thin pill as the shared skin in openideSurfaceCss.ts. A webview page
	   otherwise shows Electron's native bar, which no workbench surface has. */
	::-webkit-scrollbar { width: 12px; height: 12px; }
	::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
	::-webkit-scrollbar-thumb { min-height: 28px; min-width: 28px; border: 3px solid transparent; border-radius: var(--oi-radius-circle); background: var(--vscode-scrollbarSlider-background); background-clip: padding-box; }
	::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground); }
	::-webkit-scrollbar-thumb:active { background-color: var(--vscode-scrollbarSlider-activeBackground); }
	::-webkit-scrollbar-button { display: none; }
`;
