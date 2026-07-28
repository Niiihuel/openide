/*---------------------------------------------------------------------------------------------
 *  OpenIDE — HTML/CSS/JS del webview del chat (dock derecho).
 *
 *  IMPORTANTE: el <script> embebido NO usa template literals ni ${...} (los comería el
 *  template literal externo de TS). Sólo concatenación con '+'. Sólo ${nonce} y
 *  ${codiconCss} se interpolan en el HTML. Los codicons llegan como fuente data-URI +
 *  reglas de glifos inyectadas desde el host (openideChatView.buildCodiconCss).
 *--------------------------------------------------------------------------------------------*/

import { OPENIDE_DIAGRAM_SVG_CSS } from './openideDiagramCss.js';
import { webviewGenericCspSource } from '../../webview/common/webview.js';

export function getOpenideChatHtml(nonce: string, codiconCss: string): string {
	return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data: ${webviewGenericCspSource}; img-src data: ${webviewGenericCspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	${codiconCss}
	.codicon-modifier-spin { animation: codicon-spin 1.5s steps(30) infinite; }
	@keyframes codicon-spin { 100% { transform: rotate(360deg); } }

	/* ==== scrollbars estándar OpenIDE: el MISMO look del workbench en TODA scrollarea del
	   webview (popovers, menús, diffs, paneles) — tokens scrollbarSlider, track invisible ==== */
	/* VS Code inyecta scrollbar-color (en _defaultStyles) y con eso Chromium IGNORA todo
	   ::-webkit-scrollbar → track oscuro + flechas estándar. auto re-habilita la réplica. */
	html { scrollbar-color: auto; }
	::-webkit-scrollbar { width: 10px; height: 10px; }
	::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
	::-webkit-scrollbar-track { background: transparent; border: none; }
	::-webkit-scrollbar-corner { background: transparent; }
	/* como el widget nativo: INVISIBLE hasta hovear el área que scrollea; slider plano 10px
	   con los tokens del theme (hover/active como el workbench). */
	::-webkit-scrollbar-thumb { background: transparent; border-radius: 0; border: none; }
	:hover::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4)); }
	::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7)); }
	::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground, rgba(191, 191, 191, 0.4)); }

	* { box-sizing: border-box; }
	/* overflow hidden: los popovers absolutos (menú del modelo, etc.) NO deben generar
	   scroll del documento cuando se acercan a un borde — se reposicionan por JS. */
	html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
	body {
		display: flex; flex-direction: column;
		font-family: var(--vscode-font-family);
		font-size: 13px;
		color: var(--vscode-foreground);
		background: transparent;
		/* el webview vive en una capa OVERLAY que la isla (part con border-radius) NO recorta —
		   sin esto, el header/composer pintan esquinas cuadradas sobre la curva de la isla.
		   El overflow:hidden de arriba hace que el clip siga este radio. */
		border-radius: 12px;
	}

	/* ====================== thread (única zona que scrollea) ================== */
	#messages { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 12px; padding: 10px 10px 40px; scroll-padding-bottom: 40px; }

	/* user = burbuja con borde; assistant = plano */
	.msg.user {
		position: relative;
		border: 1px solid rgba(128, 128, 128, 0.28);
		border-radius: 8px;
		padding: 6px 10px;
		line-height: 1.45;
		background: var(--vscode-input-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
	}
	.msg-capabilities, .msg-links, #capabilityStrip, #linkStrip { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
	.msg-capabilities { margin: 0 0 5px; }
	#capabilityStrip { padding: 1px 0 3px; }
	#capabilityStrip[hidden] { display: none; }
	.msg-links { margin: 0 0 5px; }
	#linkStrip { padding: 1px 0 3px; }
	#linkStrip[hidden] { display: none; }
	.capability-chip {
		height: 24px; max-width: min(260px, 100%); display: inline-flex; align-items: center; gap: 5px;
		padding: 0 7px; border: 1px solid color-mix(in srgb, var(--capability-accent, var(--vscode-textLink-foreground)) 34%, transparent);
		border-radius: 6px; background: color-mix(in srgb, var(--capability-accent, var(--vscode-textLink-foreground)) 16%, transparent);
		color: var(--vscode-foreground); font: 12px/1 var(--vscode-editor-font-family, monospace);
	}
	.capability-chip.skill { --capability-accent: var(--vscode-charts-purple, #b180d7); }
	.capability-chip.command { --capability-accent: var(--vscode-charts-orange, #d19a66); }
	.capability-chip.mcp { --capability-accent: var(--vscode-charts-blue, #5aa7e8); }
	.capability-chip.tool { --capability-accent: var(--vscode-charts-green, #62ad77); }
	.capability-chip > .codicon:first-child { flex: 0 0 auto; font-size: 12px; color: var(--capability-accent); }
	.capability-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.capability-remove { width: 16px; height: 16px; margin-right: -4px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; }
	.capability-remove:hover { background: rgba(128, 128, 128, 0.18); color: var(--vscode-foreground); }
	.capability-remove .codicon { font-size: 10px; }
	.link-chip {
		height: 24px; max-width: min(280px, 100%); display: inline-flex; align-items: center; gap: 5px;
		padding: 0 4px 0 7px; border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 38%, transparent);
		border-radius: 6px; background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
		color: var(--vscode-foreground); font: 12px/1 var(--vscode-font-family);
	}
	.link-chip > .codicon { flex: 0 0 auto; font-size: 13px; color: var(--vscode-textLink-foreground); }
	.link-chip-label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: clip; }
	.link-chip-remove { width: 17px; height: 17px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; }
	.link-chip-remove:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.link-chip-remove .codicon { font-size: 10px; }
	.msg-text { white-space: pre-wrap; overflow-wrap: break-word; }
	.msg-text:empty { display: none; }
	.msg-text.collapsed { max-height: 72px; overflow: hidden; cursor: pointer; }
	.msg-text.faded { -webkit-mask-image: linear-gradient(180deg, #000 40%, transparent 98%); mask-image: linear-gradient(180deg, #000 40%, transparent 98%); }
	.msg-actions { position: absolute; right: 6px; bottom: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity 120ms ease; }
	.msg.user:hover .msg-actions { opacity: 1; }
	.msg-action { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0; }
	.msg-action:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
	.msg-action .codicon { font-size: 13px; }
	.msg.user:not(.editing) { cursor: text; }
	.msg.user.editing { padding: 0; overflow: visible; cursor: default; background: var(--vscode-input-background, rgba(128, 128, 128, 0.04)); z-index: 90; }
	/* El prompt histórico debe seguir sticky mientras se edita. Volverlo relative lo teleportaba
	 * a su posición original (fuera del viewport) al abrir un mensaje pineado. Sólo elevamos su
	 * capa y quitamos el fade inferior; los popovers ya usan position:fixed. */
	.turn-pin:has(.msg.user.editing) { z-index: 90; overflow: visible; }
	.turn-pin:has(.msg.user.editing)::after { display: none; }
	.msg-edit-input { display: block; width: 100%; min-height: 78px; max-height: 260px; resize: none; overflow-y: auto; box-sizing: border-box; border: none; outline: none; padding: 12px 14px 6px; background: transparent; color: var(--vscode-input-foreground, var(--vscode-foreground)); font: inherit; line-height: 1.5; }
	.msg-edit-attachments { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 12px; }
	.msg-edit-attachments:empty { display: none; }
	.msg-edit-attachment { position: relative; width: 54px; height: 54px; border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 6px; overflow: hidden; }
	.msg-edit-attachment img { width: 100%; height: 100%; object-fit: cover; cursor: pointer; }
	.msg-edit-remove { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 50%; padding: 0; background: rgba(0, 0, 0, 0.72); color: #fff; cursor: pointer; }
	.msg-edit-remove .codicon { font-size: 11px; }
	.msg-edit-footer { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 4px 8px 7px 12px; color: var(--vscode-descriptionForeground); }
	.msg-edit-meta { position: relative; display: inline-flex; align-items: center; gap: 5px; min-width: 0; font-size: 12px; }
	.msg-edit-picker { height: 24px; max-width: 190px; padding: 0 5px; border: none; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); font: inherit; cursor: pointer; }
	.msg-edit-picker:hover, .msg-edit-picker[aria-expanded="true"] { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.msg-edit-picker .codicon { flex: 0 0 auto; font-size: 13px; }
	.msg-edit-picker .msg-edit-picker-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.msg-edit-picker .codicon-chevron-down { font-size: 11px; }
	.msg-edit-model { flex: 0 1 auto; overflow: visible; }
	.msg-edit-meta > .menu { position: fixed; top: auto; bottom: auto; left: auto; right: auto; z-index: 1000; min-width: min(260px, calc(100vw - 20px)); max-width: calc(100vw - 20px); max-height: min(420px, calc(100vh - 20px)); overflow-y: auto; }
	.msg-edit-model > .menu { min-width: min(300px, calc(100vw - 20px)); }
	.msg-edit-spacer { flex: 1; }
	.msg-edit-btn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 50%; padding: 0; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; }
	.msg-edit-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.msg-edit-btn.send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
	.msg-edit-btn.send:disabled { opacity: 0.45; cursor: default; }
	.msg-edit-btn .codicon { font-size: 14px; }

	.msg.assistant { padding: 0 2px; line-height: 1.6; overflow-wrap: break-word; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.msg.assistant > *:first-child { margin-top: 0; }
	.msg.assistant > *:last-child { margin-bottom: 0; }

	/* ---- markdown ---- */
	.body { min-width: 0; }
	.body p { margin: 0 0 12px; }
	.body > *:first-child { margin-top: 0; }
	.body > *:last-child { margin-bottom: 0; }
	.body h1, .body h2, .body h3, .body h4, .body h5, .body h6 { margin: 16px 0 8px; font-weight: 600; line-height: 1.3; }
	.body h1 { font-size: 1.231em; } .body h2 { font-size: 1.077em; } .body h3 { font-size: 1em; }
	.body ul, .body ol { margin: 0 0 12px; padding-left: 22px; }
	.body li { margin: 4px 0; }
	.body blockquote { margin: 0 0 12px; padding-left: 10px; border-left: 2px solid rgba(128, 128, 128, 0.25); color: var(--vscode-descriptionForeground); }
	.body hr { border: none; border-top: 1px solid rgba(128, 128, 128, 0.22); margin: 14px 0; }
	.body a { color: var(--vscode-textLink-foreground); text-decoration: none; }
	.body a:hover { color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground)); text-decoration: underline; }
	.body code.inline {
		font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em;
		background: rgba(128, 128, 128, 0.14); padding: 1px 4px; border-radius: 4px;
	}
	/* el WRAP no scrollea (el botón copiar queda FIJO); el scroll horizontal vive en el pre
	   interno — mismo truco que .diagram/.diagram-scroll */
	.body .codewrap {
		position: relative; margin: 6px 0;
		background: rgba(128, 128, 128, 0.1);
		border: 1px solid rgba(128, 128, 128, 0.22);
		border-radius: 2px; overflow: hidden;
	}
	.body .codewrap pre.code { margin: 0; padding: 8px 10px; overflow-x: auto; background: transparent; border: none; }
	.body pre.code code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: pre; }
	.body .codewrap .copy {
		position: absolute; top: 6px; right: 6px; z-index: 2; opacity: 0; transition: opacity 120ms ease;
		display: inline-flex; align-items: center; gap: 4px;
		background: var(--vscode-editor-background); color: var(--vscode-foreground);
		border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 4px; padding: 2px 7px; font-size: 11px; cursor: pointer;
	}
	.body .codewrap .copy .codicon { font-size: 12px; }
	.body .codewrap:hover .copy { opacity: 0.9; }
	/* tablas (grid redondeado, monocromático) */
	.body table { display: block; width: max-content; max-width: 100%; overflow-x: auto; margin: 8px 0; border: 1px solid rgba(128, 128, 128, 0.22); border-radius: 2px; border-collapse: separate; border-spacing: 0; font-size: 12px; line-height: 1.5; }
	.body th, .body td { padding: 6px 12px; text-align: left; vertical-align: top; border-right: 1px solid rgba(128, 128, 128, 0.14); border-bottom: 1px solid rgba(128, 128, 128, 0.14); }
	.body th:last-child, .body td:last-child { border-right: none; }
	.body tbody tr:last-child td { border-bottom: none; }
	.body th { font-weight: 600; border-bottom-color: rgba(128, 128, 128, 0.22); }

	/* ---- diagramas (fences \`\`\`mermaid): parser/layout/SVG propios — sin deps, el CSP
	   del webview no permite cargar mermaid.js. Card con grilla de puntos = "es un canvas". ---- */
	/* el WRAP no scrollea (clip) → el botón de pantalla completa queda FIJO; el scroll vive en
	   .diagram-scroll adentro (antes el icono se movía con el scroll horizontal). */
	.diagram { position: relative; margin: 8px 0; border: 1px solid rgba(128, 128, 128, 0.22); border-radius: 2px; background-color: rgba(128, 128, 128, 0.06); background-image: radial-gradient(rgba(128, 128, 128, 0.22) 1px, transparent 1px); background-size: 22px 22px; overflow: hidden; }
	.diagram-scroll { overflow: auto; max-width: 100%; }
	.diagram svg { display: block; }
	.diagram-pending { display: flex; align-items: center; height: 64px; padding: 0 12px; font-size: 12px; color: var(--vscode-descriptionForeground); }
	.diagram-full { position: absolute; top: 6px; right: 6px; z-index: 2; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 4px; color: var(--vscode-foreground); padding: 0; opacity: 0; cursor: pointer; transition: opacity 150ms ease, background 150ms ease; }
	.diagram:hover .diagram-full { opacity: 0.85; }
	.diagram-full:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
	.diagram-full .codicon { font-size: 13px; }
	/* clases del SVG: COMPARTIDAS con el modal fullscreen (openideDiagramCss.ts) */
	${OPENIDE_DIAGRAM_SVG_CSS}

	/* ---- charts (pie · gantt · sequence · timeline), motor propio de ghost:
	   monocromo por opacidad, sin librerías ---- */
	.diagram.chart { background-image: none; padding: 10px 12px; }
	.chart-title { font-size: 12.5px; font-weight: 600; margin-bottom: 8px; }
	.chart-pie-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
	.chart-keys { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
	.chart-key { display: flex; align-items: center; gap: 7px; }
	.chart-swatch { width: 9px; height: 9px; border-radius: 2px; flex: 0 0 auto; }
	.chart-key-muted { color: var(--vscode-descriptionForeground); }
	.chart-section-name { font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); margin: 8px 0 4px; }
	/* timeline vertical (chips a la derecha de la espina) */
	.tl-row { display: flex; align-items: flex-start; gap: 10px; padding: 2px 0; }
	.tl-time { flex: 0 0 auto; min-width: 64px; text-align: right; font-size: 12px; font-weight: 600; padding-top: 3px; }
	.tl-spine { flex: 0 0 auto; align-self: stretch; display: flex; flex-direction: column; align-items: center; width: 10px; }
	.tl-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-foreground); opacity: 0.7; margin-top: 6px; flex: 0 0 auto; }
	.tl-line { flex: 1; width: 1px; background: rgba(128, 128, 128, 0.3); }
	.tl-events { flex: 1; display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 0 8px; }
	.tl-event { font-size: 12px; padding: 2px 8px; border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 2px; background: rgba(128, 128, 128, 0.08); }
	/* journey: badge de satisfacción 1..5 */
	.jr-task { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12.5px; }
	.jr-score { width: 20px; height: 20px; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 600; flex: 0 0 auto; }

	/* ---- syntax highlighting: colores REALES del theme de Monaco (el host resuelve los
	   tokenColors del color theme activo y los postea a <style id="tokenColorsCss">);
	   estas reglas son el FALLBACK monocromo hasta que llegue esa hoja ---- */
	.hl-com { color: var(--vscode-descriptionForeground); font-style: italic; opacity: 0.85; }
	.hl-str { color: var(--vscode-foreground); opacity: 0.75; }
	.hl-kw { font-weight: 600; }
	.hl-num { opacity: 0.85; }
	.hl-fn { opacity: 0.95; }

	/* ---- cola de mensajes (mandados durante un run) ---- */
	.queue-row { display: flex; align-items: center; gap: 8px; padding: 3px 4px; border-radius: 2px; min-width: 0; }
	.queue-row:hover { background: rgba(128, 128, 128, 0.08); }
	.queue-row > .codicon { font-size: 13px; flex: 0 0 auto; color: var(--vscode-descriptionForeground); }
	.queue-label { flex: 1; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); }
	.queue-actions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }

	/* ---- reasoning / thinking (plano, integrado) ---- */
	.reasoning { display: flex; flex-direction: column; }
	.reasoning summary { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12.5px; color: var(--vscode-descriptionForeground); list-style: none; padding: 2px 0; }
	.reasoning summary:hover { color: var(--vscode-foreground); }
	.reasoning summary::-webkit-details-marker { display: none; }
	.reasoning-chevron { font-size: 12px; transition: transform 120ms ease; }
	.reasoning[open] .reasoning-chevron { transform: rotate(90deg); }
	.reasoning .think { margin: 2px 0 6px; padding: 0; border: none; white-space: pre-wrap; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.55; max-height: 320px; overflow-y: auto; }
	.reasoning:not([open]) .think { display: block; max-height: 66px; overflow: hidden; opacity: 0.5; pointer-events: none; -webkit-mask-image: linear-gradient(#000 25%, transparent); mask-image: linear-gradient(#000 25%, transparent); }
	.reasoning .think ul, .reasoning .think ol { margin: 4px 0; padding-left: 18px; }
	.reasoning .think li { margin: 2px 0; }

	.activity-group { margin: 1px 0; }
	.activity-group > summary { display: flex; align-items: center; gap: 6px; list-style: none; cursor: pointer; min-height: 22px; color: var(--vscode-descriptionForeground); font-size: 12.5px; }
	.activity-group > summary::-webkit-details-marker { display: none; }
	.activity-chevron { font-size: 12px; transition: transform 120ms ease; }
	.activity-group[open] .activity-chevron { transform: rotate(90deg); }
	.activity-body { display: flex; flex-direction: column; gap: 2px; padding-left: 18px; }
	.activity-group:not([open]) > .activity-body { display: flex; max-height: 68px; overflow: hidden; opacity: 0.48; pointer-events: none; -webkit-mask-image: linear-gradient(#000 20%, transparent); mask-image: linear-gradient(#000 20%, transparent); }

	/* ====================== shimmer de actividad (estilo conversacional) ======= */
	/* Barrido de gradiente sobre el propio texto (background-clip:text): mientras una acción
	   está viva —razonando, leyendo, editando, generando— su etiqueta "respira". */
	@keyframes shimmer-sweep { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
	.shimmer {
		background: linear-gradient(90deg, var(--vscode-descriptionForeground) 25%, var(--vscode-foreground) 50%, var(--vscode-descriptionForeground) 75%);
		background-size: 200% 100%;
		-webkit-background-clip: text; background-clip: text;
		color: transparent;
		animation: shimmer-sweep 2.1s linear infinite;
	}
	@media (prefers-reduced-motion: reduce) { .shimmer { animation: none; } }
	/* Las filas de una línea reciben esta clase sólo cuando scrollWidth > clientWidth.
	   El control centralizado evita ellipsis duros y no desvanece textos que sí caben. */
	.fade-overflow {
		--overflow-fade-width: clamp(14px, 12%, 38px);
		text-overflow: clip !important;
		-webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - var(--overflow-fade-width)), transparent 100%);
		mask-image: linear-gradient(to right, #000 0, #000 calc(100% - var(--overflow-fade-width)), transparent 100%);
	}
	/* Marquee ping-pong para títulos realmente recortados. La velocidad se calcula con la
	   distancia real, y los extremos conservan una pausa para poder leer inicio y final. */
	.marquee-viewport { overflow: hidden; text-overflow: clip; white-space: nowrap; }
	.marquee-content { display: block; width: max-content; min-width: 100%; white-space: nowrap; transform: translateX(0); }
	.tab.active .marquee-viewport.marquee-active .marquee-content,
	.tt-toggle .marquee-viewport.marquee-active .marquee-content {
		will-change: transform;
		animation: openide-marquee var(--marquee-duration, 6s) ease-in-out infinite alternate;
	}
	@keyframes openide-marquee {
		0%, 16% { transform: translateX(0); }
		84%, 100% { transform: translateX(var(--marquee-offset, 0px)); }
	}
	@media (prefers-reduced-motion: reduce) {
		.marquee-viewport { text-overflow: ellipsis; }
		.marquee-viewport .marquee-content { animation: none !important; transform: none !important; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	}
	/* Placeholder entre turnos del modelo (antes del 1er token / entre tools): línea plana con shimmer. */
	.gen-row { display: flex; align-items: center; font-size: 12.5px; padding: 2px 0; color: var(--vscode-descriptionForeground); }

	/* Cabecera de fase de exploración (Cursor: "Exploring" con shimmer mientras lee/busca). */
	.explore-header { font-size: 12.5px; line-height: 1.45; padding: 2px 0 4px; color: var(--vscode-descriptionForeground); }

	/* ====================== partes (tool rows) =============================== */
	.part { min-width: 0; }
	/* Todas las capacidades del agente tienen una representación visual estable. Las cards
	   especiales (archivo/terminal) conservan su renderer; el resto comparte esta superficie
	   compacta con identidad Tool / Skill / MCP y estado de ejecución. */
	.part.action-card {
		--action-accent: var(--vscode-descriptionForeground);
		border: 1px solid rgba(128, 128, 128, 0.26); border-radius: 8px;
		background: rgba(128, 128, 128, 0.035); overflow: hidden; margin: 4px 0;
		box-shadow: none;
	}
	.part.action-card.tool-kind-skill, .part.action-card.tool-kind-mcp { --action-accent: var(--vscode-descriptionForeground); }
	.part.action-card .part-head { min-height: 30px; padding: 5px 8px 5px 9px; gap: 7px; }
	.part.action-card .part-icon { display: inline-flex; color: var(--vscode-descriptionForeground); }
	.part.action-card .part-kind {
		flex: 0 0 auto; padding: 2px 5px; border-radius: 3px;
		background: rgba(128, 128, 128, 0.14);
		color: var(--vscode-descriptionForeground);
		font-size: 9px; line-height: 1.2; font-weight: 650; letter-spacing: 0.035em; text-transform: uppercase;
	}
	.part.action-card .part-body { margin: 0; padding: 6px 9px 8px; border-top: 1px solid rgba(128, 128, 128, 0.16); }
	.part.action-card.error { border-color: color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent); box-shadow: none; }
	/* Tool genérica: misma gramática visual de Thinking, sin card, badge ni argumentos visibles. */
	.tool-activity { margin: 2px 0; color: var(--vscode-descriptionForeground); }
	.tool-activity .part-head { min-height: 22px; padding: 1px 0; cursor: default; gap: 6px; }
	.tool-activity .part-icon, .tool-activity .part-kind, .tool-activity .part-status, .tool-activity .part-chevron, .tool-activity .part-detail, .tool-activity .part-cmd { display: none !important; }
	.tool-activity .part-verb { flex: 1; font-size: 12.5px; }
	.tool-activity.error .part-verb { color: var(--vscode-errorForeground); }
	.tool-activity .part-body { margin-left: 0; padding-left: 0; }
	.part-head { display: flex; align-items: center; gap: 5px; min-height: 20px; padding: 1px 0; cursor: pointer; background: transparent; border: none; color: var(--vscode-descriptionForeground); font-size: 12.5px; width: 100%; text-align: left; transition: color 120ms ease; }
	.part-head:hover, .part-head:hover .part-label, .part-head:hover .part-verb { color: var(--vscode-foreground); }
	/* filas de exploración (read/search/list): planas, sin chevron — "Leyendo archivo.ts" */
	.part-explore .part-head { cursor: default; }
	.part-explore .part-chevron { display: none; }
	.part-explore .part-head { flex-wrap: nowrap; overflow: hidden; }
	.part-explore .part-verb { display: block; flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; }
	.part-spacer { flex: 1 1 0; min-width: 0; }
	.part-status { display: inline-flex; flex: 0 0 auto; }
	.part-status .codicon { font-size: 13px; }
	.part-icon { font-size: 13px; flex: 0 0 auto; color: var(--vscode-descriptionForeground); }
	.part-verb { flex: 0 0 auto; color: var(--vscode-foreground); }
	.part-verb:not(.shimmer) { color: var(--vscode-descriptionForeground); }
	.part-label { color: var(--vscode-descriptionForeground); flex: 0 0 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; max-width: 72%; }
	.part-detail { color: var(--vscode-descriptionForeground); flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
	.part-cmd { font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); }
	.part-badge { flex: 0 0 auto; font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 2px; background: rgba(128, 128, 128, 0.18); color: var(--vscode-descriptionForeground); }
	.part-chevron { color: var(--vscode-descriptionForeground); flex: 0 0 auto; display: inline-flex; }
	.part-chevron .codicon { font-size: 12px; }
	/* expansión de una tool row genérica: PLANA, sin caja (integrado) — el detalle se
	   integra con el fondo, indentado bajo el verbo. Las cards especiales (edit/term) overridean. */
	.part-body { margin: 1px 0 6px; border: none; border-radius: 0; padding: 0 0 0 19px; display: none; }
	.part.open .part-body { display: block; }
	.part-label2 { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
	.part-pre { margin: 3px 0 0; white-space: pre-wrap; word-break: break-word; max-height: 260px; overflow: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; line-height: 1.5; color: var(--vscode-descriptionForeground); }
	.part.error .part-status .codicon { color: var(--vscode-errorForeground); }
	.added { flex: 0 0 auto; color: var(--vscode-charts-green, #2ea043); font-size: 11.5px; }
	.removed { flex: 0 0 auto; color: var(--vscode-errorForeground); font-size: 11.5px; }

	/* ---- card de edición de archivo (integrado): UN solo header con icono + filename
	   (shimmer en el nombre mientras escribe) + ±N; click en TODO el header abre el diff;
	   el body es el preview colapsable con fade/chevron ---- */
	.part.edit-card { --edit-preview-surface: var(--vscode-editor-background, var(--vscode-sideBar-background)); border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 8px; margin: 6px 0; overflow: hidden; background: rgba(128, 128, 128, 0.04); }
	.part.edit-card .part-head { padding: 5px 8px; cursor: pointer; gap: 6px; min-height: 28px; }
	.part.edit-card .part-head .ficon,
	.part.edit-card .part-head > .codicon.codicon-file { flex: 0 0 auto; width: 16px; height: 16px; }
	.part.edit-card .part-label { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); max-width: none; flex: 0 1 auto; }
	.part.edit-card .part-label.shimmer { color: transparent; }
	/* la fila genérica (Writing + path + chevron) NO debe verse: un solo header con icono */
	.part.edit-card .part-verb,
	.part.edit-card .part-detail,
	.part.edit-card .part-cmd,
	.part.edit-card .part-status,
	.part.edit-card .part-chevron { display: none !important; }
	.part.edit-card .part-body { display: block; margin: 0; border: none; border-radius: 0; padding: 0; position: relative; }
	.part.edit-card.has-diff .part-body { border-top: 1px solid rgba(128, 128, 128, 0.16); }
	/* Reutiliza el scrollbar tematizado global del chat/workbench. En el preview compacto
	   sólo se habilita el eje horizontal; al expandir aparecen ambos ejes si hacen falta. */
	.part.edit-card:not(.open) .ediff { max-height: 108px; overflow-x: auto; overflow-y: hidden; }
	.part.edit-card.open .ediff { max-height: 320px; overflow: auto; }
	.part.edit-card .ediff::-webkit-scrollbar-track,
	.part.edit-card .ediff::-webkit-scrollbar-corner { background: var(--edit-preview-surface); }
	.part.edit-card .part-body .part-label2, .part.edit-card .part-body .part-pre { display: none; }
	.part.edit-card.error .part-body .part-label2, .part.edit-card.error .part-body .part-pre { display: block; padding: 0 10px 8px; }
	.edit-fade { position: absolute; z-index: 3; left: 0; right: 0; bottom: 0; height: 40px; pointer-events: none;
		background: linear-gradient(to bottom, transparent 0%,
			color-mix(in srgb, var(--edit-preview-surface) 78%, transparent) 48%,
			var(--edit-preview-surface) 100%); }
	/* El fade/chevron sólo existe cuando el preview colapsado tiene MÁS líneas debajo.
	   has-diff por sí solo no alcanza: un reemplazo de una línea también tiene diff. */
	.part.edit-card:not(.needs-expand) .edit-fade { display: none; }
	.edit-expand { position: absolute; left: 50%; bottom: 1px; transform: translateX(-50%); z-index: 4;
		width: 24px; height: 18px; display: flex; align-items: center; justify-content: center;
		border: none; border-radius: 0; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0;
		opacity: 0; pointer-events: none; transition: opacity 100ms ease, color 100ms ease; }
	.part.edit-card:not(.needs-expand) .edit-expand { display: none; }
	.part.edit-card.needs-expand .part-body:hover .edit-expand, .edit-expand:focus-visible { opacity: 1; pointer-events: auto; }
	.edit-expand:hover { color: var(--vscode-foreground); background: transparent; }
	.edit-expand .codicon { font-size: 12px; }
	.ediff { background: var(--edit-preview-surface); font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; line-height: 1.55; padding: 0; }
	.ediff-line { display: flex; white-space: pre; min-width: 100%; width: max-content; }
	.ediff-sign { width: 16px; flex: 0 0 auto; text-align: center; opacity: 0.7; user-select: none; }
	.ediff-add { background: rgba(46, 160, 67, 0.14); }
	.ediff-del { background: rgba(248, 81, 73, 0.13); color: var(--vscode-descriptionForeground); }
	.ediff-gap { background: var(--edit-preview-surface); color: var(--vscode-descriptionForeground); opacity: 0.7; }
	/* Un archivo nuevo no es un bloque de conflicto: todas sus líneas son técnicamente
	   adiciones, pero teñir el viewport completo de verde elimina jerarquía y sintaxis.
	   Conservamos el signo + verde y dejamos el contenido sobre la superficie neutra. */
	.part.edit-card.is-created .ediff-add { background: transparent; }
	.part.edit-card.is-created .ediff-add .ediff-sign { color: var(--vscode-charts-green, #2ea043); opacity: 0.9; }
	.edit-stats { display: inline-flex; gap: 6px; align-items: center; flex: 0 0 auto; margin-left: auto; }
	.edit-badge { font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 8px; background: rgba(128, 128, 128, 0.18); color: var(--vscode-descriptionForeground); }
	.diff-added { color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green, #2ea043)); font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; }
	.diff-removed { color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149); font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; }

	/* ---- terminal embebida (run_command, integrado): card colapsable — header con
	   glifo (>_ colapsada / chevron abierta) + título + ⋯ (menú de auto-run y copiar);
	   body con "$ comando" + output streameado; mientras corre, línea de INPUT que escribe
	   al pty (contestar y/N, REPLs). ---- */
	/* overflow VISIBLE (no hidden como edit-card): el popover del ⋯ debe poder salirse de la
	   card (colapsada mide solo el header y lo recortaría); acá ningún hijo pinta fondo. */
	.part.term-card { border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 8px; margin: 6px 0; position: relative; background: rgba(128, 128, 128, 0.035); }
	.part.term-card .part-head { padding: 5px 6px 5px 10px; gap: 7px; }
	.term-glyph { flex: 0 0 auto; display: inline-flex; color: var(--vscode-descriptionForeground); }
	.term-glyph .codicon { font-size: 13px; }
	.term-title { color: var(--vscode-foreground); font-size: 12.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.term-shell { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 11.5px; font-family: var(--vscode-editor-font-family, monospace); }
	.term-dots { width: 22px; height: 22px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; border: none; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0; }
	.term-dots:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.term-dots .codicon { font-size: 13px; }
	.term-menu { top: calc(100% + 4px); right: 0; min-width: 220px; max-width: min(280px, calc(100vw - 16px)); }
	.part.term-card .part-body { display: none; margin: 0; border: none; border-radius: 0; padding: 0; border-top: 1px solid rgba(128, 128, 128, 0.2); }
	.part.term-card.open .part-body { display: block; }
	.term-out { font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; line-height: 1.55; padding: 8px 10px 4px; max-height: 240px; overflow: auto; color: var(--vscode-descriptionForeground); }
	.term-line { white-space: pre-wrap; word-break: break-word; min-height: 1.1em; }
	.term-line.cmd { color: var(--vscode-foreground); }
	.term-line.cmd .term-dollar { color: var(--vscode-charts-orange, #d18616); margin-right: 7px; user-select: none; }
	.term-in { display: none; align-items: center; gap: 7px; padding: 2px 10px 8px; }
	.part.term-card.running.open .term-in { display: flex; }
	.part.term-card.awaiting-input { border-color: color-mix(in srgb, var(--vscode-charts-orange, #d18616) 55%, rgba(128,128,128,0.28)); }
	.part.term-card.awaiting-input .term-title::after {
		content: ' · esperando input';
		color: var(--vscode-charts-orange, #d18616);
		font-weight: 500;
		font-size: 11px;
	}
	.part.term-card.awaiting-input.open .term-in { display: flex; }
	.term-in .term-caret { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; user-select: none; }
	.term-in input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--vscode-foreground); font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; }
	.term-in input::placeholder { color: var(--vscode-descriptionForeground); opacity: 0.55; }

	/* ---- card del PLAN (modo plan) — INTEGRADA: label "Plan preparado" arriba (muted, fuera
	   del borde) → card con head (ícono lista + filename mono + copiar + chevron), título bold,
	   descripción muted, link "Leer plan detallado", caja de tareas con círculos, y botonera
	   (Rechazar / Build dorado). Las cards viven en un mapa por path para resolverlas. ---- */
	.plan-wrap { margin: 10px 0; }
	.plan-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 0 0 6px 2px; }
	.plan-card { border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 12px; overflow: hidden; background: rgba(128, 128, 128, 0.025); }
	.plan-head { display: flex; align-items: center; gap: 7px; padding: 9px 12px; min-width: 0; border-bottom: 1px solid rgba(128, 128, 128, 0.16); }
	.plan-head > .codicon { color: var(--vscode-descriptionForeground); flex: 0 0 auto; font-size: 14px; }
	.plan-file { color: var(--vscode-descriptionForeground); font-size: 11.5px; font-family: var(--vscode-editor-font-family, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; flex: 1 1 auto; min-width: 0; }
	.plan-file:hover { color: var(--vscode-foreground); text-decoration: underline; }
	.plan-icobtn { flex: 0 0 auto; background: none; border: none; padding: 3px; border-radius: 4px; cursor: pointer; color: var(--vscode-descriptionForeground); }
	.plan-icobtn:hover { background: rgba(128, 128, 128, 0.18); color: var(--vscode-foreground); }
	.plan-icobtn .codicon { font-size: 13px; }
	.plan-body { padding: 14px 16px 6px; }
	.plan-title { font-weight: 650; font-size: 15px; line-height: 1.35; margin: 0 0 6px; }
	.plan-desc { font-size: 12.5px; color: var(--vscode-descriptionForeground); line-height: 1.55; margin: 0 0 8px; }
	.plan-readlink { border: none; background: transparent; padding: 0; color: var(--vscode-textLink-foreground); font-family: inherit; font-size: 12.5px; cursor: pointer; }
	.plan-readlink:hover { text-decoration: underline; }
	.plan-tasks { margin: 12px 0 4px; background: rgba(128, 128, 128, 0.105); border: 1px solid rgba(128, 128, 128, 0.15); border-radius: 9px; padding: 10px 12px; }
	.plan-tasks-head { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 7px; }
	.plan-task { display: flex; align-items: flex-start; gap: 9px; padding: 4px 0; font-size: 12.5px; line-height: 1.5; }
	.plan-task > .codicon { flex: 0 0 auto; margin-top: 1px; font-size: 15px; color: var(--vscode-descriptionForeground); }
	.plan-task.done > .codicon { color: var(--vscode-charts-green, #3fb950); }
	.plan-task.done .plan-task-text { color: var(--vscode-descriptionForeground); text-decoration: line-through; }
	.plan-actions { display: flex; align-items: center; gap: 8px; padding: 10px 14px 12px; }
	.plan-sp { flex: 1; }
	.plan-reject { border: none; background: transparent; padding: 4px 8px; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 12.5px; cursor: pointer; border-radius: 5px; }
	.plan-reject:hover { background: rgba(128, 128, 128, 0.14); color: var(--vscode-foreground); }
	.plan-build { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-family: inherit; font-size: 12.5px; font-weight: 600; padding: 4px 12px; border-radius: 6px; cursor: pointer; }
	.plan-build:hover { background: var(--vscode-button-hoverBackground); }
	.plan-build .codicon { font-size: 13px; color: inherit; }
	.plan-build .kbd { opacity: 0.72; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
	.plan-build.status { cursor: default; pointer-events: none; }
	.build-spinner { width: 12px; height: 12px; border: 2px solid color-mix(in srgb, currentColor 32%, transparent); border-top-color: currentColor; border-radius: 50%; animation: build-spin 900ms linear infinite; }
	@keyframes build-spin { to { transform: rotate(360deg); } }
	.plan-status { padding: 8px 12px; color: var(--vscode-descriptionForeground); font-size: 12.5px; }
	.canvas-card { margin: 10px 0; border: 1px solid rgba(128,128,128,.3); border-radius: 10px; padding: 12px; background: rgba(128,128,128,.035); }
	.canvas-head { display:flex; align-items:center; gap:8px; color:var(--vscode-descriptionForeground); font-size:11px; }
	.canvas-title { margin:8px 0 4px; font-size:14px; font-weight:650; color:var(--vscode-foreground); }
	.canvas-path { font:11px var(--vscode-editor-font-family,monospace); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.canvas-open { margin-top:10px; float:right; border:1px solid var(--vscode-button-border,transparent); border-radius:5px; padding:4px 10px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); cursor:pointer; }

	/* Sugerencia de modo: superficie compacta con la acción integrada en el pie. */
	.suggest-wrap { margin: 10px 0; }
	.suggest-wrap.resolved .suggest-card { opacity: 0.72; }
	.suggest-card { border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 10px; overflow: hidden; background: rgba(128, 128, 128, 0.035); }
	.suggest-head { display: flex; align-items: center; gap: 7px; padding: 10px 12px 7px; }
	.suggest-head > .codicon { color: var(--vscode-descriptionForeground); font-size: 14px; flex: 0 0 auto; }
	.suggest-title { font-size: 13px; font-weight: 600; color: var(--vscode-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
	.suggest-kicker { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; flex: 0 0 auto; }
	.suggest-body { padding: 2px 12px 12px 33px; font-size: 12.5px; color: var(--vscode-descriptionForeground); line-height: 1.5; word-break: break-word; overflow-wrap: anywhere; }
	.suggest-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 9px 10px; border-top: 1px solid rgba(128, 128, 128, 0.16); }
	.suggest-dismiss { border: none; background: transparent; padding: 4px 8px; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 12.5px; cursor: pointer; border-radius: 5px; }
	.suggest-dismiss:hover { background: rgba(128, 128, 128, 0.14); color: var(--vscode-foreground); }
	/* Misma acción primaria que Build Plan: compacta, una línea y con shortcut visual. */
	.suggest-accept { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-family: inherit; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
	.suggest-accept:hover { background: var(--vscode-button-hoverBackground); }
	.suggest-accept .codicon { font-size: 13px; color: inherit; }
	.suggest-accept .kbd { opacity: 0.72; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; font-weight: 400; }

	.retry-row { margin: 6px 0; }

	/* info / approval / cancelled (filas planas) — mismo lenguaje que las tool rows */
	.flatrow { display: flex; align-items: center; gap: 7px; color: var(--vscode-descriptionForeground); font-size: 12.5px; padding: 3px 0; min-width: 0; }
	.flatrow > .codicon { font-size: 13px; flex: 0 0 auto; }
	.flatrow > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	/* info (reintentos/avisos): icono atenuado, texto muted como una tool terminada */
	.flatrow.info { color: var(--vscode-descriptionForeground); }
	.flatrow.info > .codicon { opacity: 0.7; }
	/* error: tarjeta con tinte, título y mensaje con wrap real (el texto largo no se corta) */
	.flatrow.err {
		color: var(--vscode-errorForeground);
		border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 28%, transparent);
		background: color-mix(in srgb, var(--vscode-errorForeground) 6%, transparent);
		border-radius: 8px; padding: 9px 11px; gap: 9px; align-items: flex-start;
	}
	.flatrow.notice {
		color: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, #d7ba7d));
		border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, #d7ba7d) 30%, transparent);
		background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #d7ba7d) 6%, transparent);
		border-radius: 8px; padding: 9px 11px; gap: 9px; align-items: flex-start;
	}
	/* Caja óptica propia: el glifo no se alinea por su baseline tipográfica, sino con la
	   primera línea del título. Evita que el triángulo parezca caído hacia la izquierda. */
	.flatrow.notice > .codicon {
		width: 18px; height: 18px; margin: -1px 0 0 -2px; flex: 0 0 18px;
		display: inline-flex; align-items: center; justify-content: center;
		font-size: 15px; line-height: 1;
	}
	.notice-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
	.notice-title { font-weight: 600; font-size: 10.5px; letter-spacing: 0.6px; text-transform: uppercase; opacity: 0.9; }
	.notice-msg { color: var(--vscode-foreground); opacity: 0.92; font-size: 12.5px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
	.notice-count { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; margin-top: 3px; }
	/* Compactación de contexto: tarjeta neutra y persistente, con el mismo lenguaje que una
	   tool card pero sin acento lateral. Se actualiza in-place de running a completada. */
	.compaction-card {
		display: flex; align-items: center; gap: 9px; min-width: 0; margin: 6px 0;
		border: 1px solid rgba(128, 128, 128, 0.26); border-radius: 8px;
		background: rgba(128, 128, 128, 0.035); padding: 8px 10px;
		color: var(--vscode-descriptionForeground);
	}
	.compaction-icon { width: 18px; height: 18px; flex: 0 0 18px; display: inline-flex; align-items: center; justify-content: center; }
	.compaction-icon .codicon { font-size: 14px; }
	.compaction-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
	.compaction-title { color: var(--vscode-foreground); font-size: 12.5px; line-height: 1.35; }
	.compaction-detail { color: var(--vscode-descriptionForeground); font-size: 11.5px; line-height: 1.35; overflow-wrap: anywhere; }
	.compaction-kind {
		flex: 0 0 auto; padding: 2px 5px; border-radius: 3px; font-size: 9px;
		font-weight: 650; letter-spacing: 0.035em; text-transform: uppercase;
		background: rgba(128, 128, 128, 0.14); color: var(--vscode-descriptionForeground);
	}
	.compaction-card.failed { border-color: color-mix(in srgb, var(--vscode-errorForeground) 28%, transparent); }
	.compaction-card.failed .compaction-icon { color: var(--vscode-errorForeground); }
	.flatrow.err > .codicon { font-size: 14px; margin-top: 2px; }
	.err-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
	.err-title { font-weight: 600; font-size: 10.5px; letter-spacing: 0.6px; text-transform: uppercase; opacity: 0.85; }
	.err-msg { color: var(--vscode-foreground); opacity: 0.92; font-size: 12.5px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
	.err-connect {
		align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; margin-top: 6px;
		padding: 4px 10px; border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 35%, transparent);
		border-radius: 2px; background: transparent; color: var(--vscode-foreground);
		font-size: 12px; cursor: pointer;
	}
	.err-connect:hover { background: var(--vscode-toolbar-hoverBackground); }
	.err-connect .codicon { font-size: 13px; }

	/* Los tooltips [data-tip] son el HOVER NATIVO del workbench: el webview postea
	   tip/tipHide al host y openideChatView los muestra vía IHoverService (bridge). */

	/* ====================== turnos con prompt pineado (conversacional) ========= */
	.turn { display: flex; flex-direction: column; gap: 12px; }
	/* El WRAPPER sticky lleva el fondo de enmascarado (un pseudo-elemento con z negativo
	   pintaría SOBRE el borde de la burbuja — CSS pinta el borde antes que los descendientes
	   de z negativo; exactamente el bug que ghost documenta). */
	.turn-pin {
		position: sticky; top: 0; z-index: 6;
		background: var(--vscode-openide-islandBackground, var(--vscode-editor-background));
		padding: 4px 0; margin: -4px 0;
	}
	/* Máscara del prompt pineado. #messages tiene 10px de padding superior: sin esta
	   extensión, el contenido del turno se veía desplazarse por esa franja entre el
	   header y la caja. El fade inferior ocupa sólo el hueco entre pin y body: así no
	   altera estados legibles como "Planning next moves" ni la primera línea del agente. */
	.turn-pin::before {
		content: ''; position: absolute; z-index: 0; pointer-events: none;
		left: -10px; right: -10px; top: -10px; bottom: 0;
		background: var(--vscode-openide-islandBackground, var(--vscode-editor-background));
	}
	.turn-pin::after {
		content: ''; position: absolute; z-index: 0; pointer-events: none;
		left: -10px; right: -10px; top: 100%; height: 8px;
		background: linear-gradient(to bottom,
			var(--vscode-openide-islandBackground, var(--vscode-editor-background)) 0%,
			color-mix(in srgb, var(--vscode-openide-islandBackground, var(--vscode-editor-background)) 72%, transparent) 48%,
			transparent 100%);
	}
	.turn-pin > .turn-composer { position: relative; z-index: 1; }
	.turn-pin > .turn-composer > .msg.user,
	.turn-pin > .msg.user { background: var(--vscode-input-background, var(--vscode-editorWidget-background, var(--vscode-editor-background))); }

	/* Mensaje user + estado actual de to-dos apilado. La lista queda por DETRAS del
	   prompt pineado, igual que Files/Background Terminal detrás del composer: 10px de
	   inset por lado y una superficie propia, en vez de agrandar la caja del usuario. */
	.turn-composer {
		display: flex; flex-direction: column; align-items: center;
		border: none; border-radius: 8px; overflow: visible; background: transparent;
	}
	.turn-composer > .msg.user {
		position: relative; z-index: 2; width: 100%; box-sizing: border-box;
		background: var(--vscode-input-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
	}
	.turn-todos {
		position: relative; z-index: 1; width: calc(100% - 20px); box-sizing: border-box;
		margin: -4px auto 0; padding-top: 4px;
		border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 0 0 8px 8px;
		background: rgba(128, 128, 128, 0.035);
	}
	.turn-todos[hidden] { display: none; }
	.tt-head { display: flex; align-items: center; gap: 5px; padding: 3px 8px; min-height: 22px; }
	.tt-toggle { display: inline-flex; align-items: center; gap: 5px; flex: 1; min-width: 0; padding: 0; border: none; background: transparent; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 11.5px; cursor: pointer; text-align: left; }
	.tt-toggle:hover { color: var(--vscode-foreground); }
	.tt-toggle .codicon { font-size: 12px; flex: 0 0 auto; }
	.tt-title { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--vscode-foreground); font-weight: 500; }
	.tt-prog { flex: 0 0 auto; font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
	.tt-body { display: flex; flex-direction: column; gap: 0; padding: 0 8px 5px; }
	.tt-row { display: flex; align-items: flex-start; gap: 6px; padding: 1px 0; font-size: 11.5px; line-height: 1.4; }
	.tt-icon { font-size: 12px; flex: 0 0 auto; margin-top: 1px; color: var(--vscode-descriptionForeground); }
	.tt-row.s-completed .tt-icon { color: var(--vscode-charts-green, #2ea043); }
	.tt-row.s-completed .tt-text { opacity: 0.55; text-decoration: line-through; }
	.tt-row.s-in-progress .tt-icon { color: var(--vscode-foreground); }
	.tt-row.s-in-progress .tt-text { font-weight: 600; color: var(--vscode-foreground); }
	.tt-text { flex: 1; min-width: 0; color: var(--vscode-descriptionForeground); }
	/* Snapshot persistente en el transcript: cada update_todos deja una entrada compacta.
	   Al expandirla se ve la lista completa de ese instante, no el estado más reciente. */
	.todo-update {
		border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 8px;
		background: rgba(128, 128, 128, 0.035); overflow: hidden; margin: 2px 0;
	}
	.todo-update .tt-head { padding: 5px 9px; }
	.todo-update .tt-body { padding: 4px 9px 7px; border-top: 1px solid rgba(128, 128, 128, 0.16); }

	/* ====================== cuerpo del turno asistente (plano, integrado) ========= */
	/* Sin burbuja envolvente: exploración, razonamiento y texto fluyen sobre el fondo del
	   panel; diffs, terminales, planes y aprobaciones conservan su card propia. */
	.turn-body {
		display: flex; flex-direction: column; align-self: center; width: calc(100% - 32px); min-width: 0; gap: 4px;
	}
	.turn-body:empty { display: none; }
	.turn-body > .msg.assistant { padding: 2px 0; }
	.turn-body > .reasoning,
	.turn-body > .gen-row,
	.turn-body > .explore-header { padding: 0; }
	.turn-body > .part:not(.term-card):not(.edit-card) { padding: 0; }
	.turn-body > .decision-line,
	.turn-body > .flatrow:not(.err) { padding: 2px 0; }
	.turn-body > .flatrow.err,
	.turn-body > .retry-row { margin: 6px 0; }

	/* ====================== subagentes (modo Ultracode) ====================== */
	/* card inline en el MISMO flujo del chat: header (estado+título+contador) siempre visible,
	   body con el stream compacto de tools/texto del subagente; se colapsa al terminar. */
	.delegation-group { display: flex; flex-direction: column; gap: 8px; margin: 6px 0; min-width: 0; }
	.delegation-children { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
	.delegation-summary { border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 9px; overflow: hidden; background: rgba(128, 128, 128, 0.025); }
	.delegation-summary-main { width: 100%; min-height: 48px; display: flex; align-items: center; gap: 9px; padding: 8px 12px; border: none; background: transparent; color: var(--vscode-descriptionForeground); font-family: inherit; cursor: pointer; }
	.delegation-summary-main:hover { background: rgba(128, 128, 128, 0.07); color: var(--vscode-foreground); }
	.delegation-summary-icon { color: var(--vscode-descriptionForeground); font-size: 17px; }
	.delegation-summary-title { color: var(--vscode-descriptionForeground); font-size: 13px; }
	.delegation-summary-space { flex: 1; }
	.delegation-summary-status { display: inline-flex; color: var(--vscode-descriptionForeground); }
	.delegation-summary-status .codicon { font-size: 14px; }
	.delegation-summary.error .delegation-summary-status { color: var(--vscode-errorForeground); }
	.delegation-summary-chevron { display: inline-flex; }
	.delegation-summary-body { display: none; padding: 8px 12px 10px 39px; border-top: 1px solid rgba(128, 128, 128, 0.18); }
	.delegation-summary.open .delegation-summary-body { display: block; }
	.sub-card { border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 9px; overflow: hidden; background: rgba(128, 128, 128, 0.025); }
	.sub-head { display: flex; align-items: center; gap: 9px; min-height: 58px; padding: 8px 12px; cursor: pointer; user-select: none; font-size: 12.5px; }
	.sub-head:hover { background: rgba(128, 128, 128, 0.07); }
	.sub-st { width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; flex: 0 0 18px; color: var(--vscode-descriptionForeground); }
	.sub-spin { animation: codicon-spin 1.5s steps(30) infinite; }
	.sub-st.st-ok { color: var(--vscode-charts-green, #2ea043); }
	.sub-st.st-err { color: var(--vscode-errorForeground); }
	.sub-title { flex: 1; min-width: 0; font-weight: 600; font-size: 13px; color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.sub-count { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 11.5px; font-family: var(--vscode-editor-font-family, monospace); white-space: nowrap; }
	.sub-model { flex: 0 1 140px; max-width: 140px; color: var(--vscode-descriptionForeground); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.sub-action { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0; flex: 0 0 auto; }
	.sub-action:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.sub-action .codicon { font-size: 16px; }
	.sub-action.sub-open .codicon { font-size: 17px; }
	.sub-action.sub-stop { width: auto; height: 22px; padding: 0 9px; background: rgba(128, 128, 128, 0.14); color: var(--vscode-foreground); font: inherit; font-size: 11.5px; }
	.sub-action.sub-stop:hover { background: rgba(128, 128, 128, 0.24); }
	.sub-card.done .sub-stop { display: none; }
	.sub-chev { flex: 0 0 auto; font-size: 16px; color: var(--vscode-descriptionForeground); transition: transform 120ms ease; }
	.sub-card.collapsed .sub-chev { transform: rotate(180deg); }
	.sub-body { border-top: 1px solid rgba(128, 128, 128, 0.18); padding: 8px 12px; max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; background: rgba(128, 128, 128, 0.018); }
	.sub-card.collapsed .sub-body { display: none; }
	.sub-text { font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
	.sub-tool { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); min-width: 0; }
	.sub-tool .codicon { font-size: 12px; flex: 0 0 auto; }
	.sub-tool .sub-tool-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
	.sub-tool.err { color: var(--vscode-errorForeground); }

	.subagents-tray .dock-sub-row { display: flex; align-items: center; gap: 7px; min-height: 24px; padding: 2px 3px; border-radius: 4px; cursor: pointer; }
	.subagents-tray .dock-sub-row:hover { background: rgba(128, 128, 128, 0.08); }
	.dock-sub-row > .codicon { color: var(--vscode-descriptionForeground); font-size: 13px; }
	.dock-sub-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
	.dock-sub-model { color: var(--vscode-descriptionForeground); font-size: 11.5px; white-space: nowrap; }

	/* ====================== popover de menú (nativo --vscode-menu-*) ========= */
	.menu {
		position: absolute; z-index: 50; display: flex; flex-direction: column;
		min-width: min(220px, calc(100vw - 16px)); max-width: calc(100vw - 16px); max-height: min(420px, 60vh);
		border-radius: 5px; border: 1px solid var(--vscode-menu-border, rgba(128, 128, 128, 0.3));
		background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
		color: var(--vscode-menu-foreground, var(--vscode-foreground));
		box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
		overflow: hidden;
	}
	.menu[hidden] { display: none; }
	/* popovers (modelos/modos/historial): scrollean pero el scrollbar es INVISIBLE (pedido
	   explícito) — la rueda/trackpad siguen andando, sin thumb ni track */
	.menu-content { display: flex; flex-direction: column; min-height: 0; padding: 4px; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; }
	.menu-content::-webkit-scrollbar { display: none; width: 0; height: 0; }
	.menu-row {
		/* width 100%: los <button> NO estiran solos en contenedores block (#historyList) — quirk de form controls */
		display: flex; align-items: center; width: 100%; min-height: 24px; padding: 0 8px 0 4px;
		background: transparent; border: thin solid transparent; border-radius: 4px; cursor: pointer;
		font-family: inherit; font-size: 13px; color: var(--vscode-menu-foreground, var(--vscode-foreground)); text-align: left;
	}
	.menu-row:hover, .menu-row:focus-visible {
		outline: none; background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
		color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, #fff));
		border-color: var(--vscode-menu-selectionBorder, transparent);
	}
	.menu-row-icon { width: 21px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
	.menu-row .codicon { font-size: 14px; color: inherit; }
	.menu-label { flex: 1; padding-right: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.menu-detail { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
	.menu-row:hover .menu-detail, .menu-row:focus-visible .menu-detail { color: inherit; }
	.menu-muted .menu-label { color: var(--vscode-descriptionForeground); }
	.menu-row.menu-muted:hover .menu-label { color: inherit; }
	.menu-section { padding: 6px 8px 2px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); user-select: none; }
	.menu-sep { height: 1px; margin: 4px 0; background: var(--vscode-menu-separatorBackground, rgba(128, 128, 128, 0.25)); opacity: 0.5; }
	.menu-empty { display: flex; align-items: center; min-height: 24px; padding: 0 8px 0 25px; color: var(--vscode-descriptionForeground); font-size: 13px; }
	/* search row + row-actions del historial (reutiliza .menu) */
	.menu-search-row { display: flex; align-items: center; min-height: 28px; padding: 0 8px 0 4px; margin-bottom: 4px; border-bottom: 1px solid var(--vscode-menu-separatorBackground, rgba(128, 128, 128, 0.25)); }
	.menu-search-row .codicon { width: 21px; text-align: center; font-size: 13px; color: var(--vscode-descriptionForeground); flex: 0 0 auto; }
	.menu-search { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--vscode-menu-foreground, var(--vscode-foreground)); font-family: inherit; font-size: 13px; }
	.menu-search::placeholder { color: var(--vscode-descriptionForeground); opacity: 0.7; }
	.menu-row-actions { display: none; align-items: center; gap: 2px; margin-left: auto; flex: 0 0 auto; padding-left: 6px; }
	.menu-row:hover .menu-row-actions, .menu-row:focus-within .menu-row-actions { display: flex; }
	/* SOLO filas con acciones (historial) esconden el detail al hover — la regla global
	   achicaba el popover del modelo al pasar por "Razonamiento: X" (se iba el texto). */
	.menu-row.has-actions:hover .menu-detail, .menu-row.has-actions:focus-within .menu-detail { display: none; }
	.menu-row-action { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; padding: 0; }
	.menu-row-action:hover { background: var(--vscode-toolbar-hoverBackground); }
	.menu-row-action .codicon { font-size: 13px; }

	/* ====================== header: tabs (idénticas al editor Monaco) ========= */
	/* position:relative → #historyMenu (left/right 6px) se ancla al ANCHO COMPLETO del header,
	   no al contenedor angosto de los botones (quedaba apretado con scroll horizontal). */
	/* SIN líneas (pedido explícito): el header se distingue solo por tonalidad */
	#header { position: relative; display: flex; align-items: stretch; flex: 0 0 auto; height: 35px; background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background)); border-bottom: none; }
	#tabs { display: flex; align-items: stretch; flex: 1 1 auto; min-width: 0; height: 100%; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
	#tabs::-webkit-scrollbar { display: none; }
	.tab {
		position: relative; display: flex; align-items: center; gap: 6px; height: 100%; padding: 0 10px;
		flex: 0 0 auto; min-width: 0; max-width: 160px; cursor: pointer; user-select: none; font-size: 13px;
		background: var(--vscode-tab-inactiveBackground, transparent);
		color: var(--vscode-tab-inactiveForeground, var(--vscode-descriptionForeground));
		border: none; border-radius: 0;
	}
	/* La curva pertenece a la isla (body), no al tab. Duplicarla aquí creaba un escalón
	   de un píxel entre el header y el contenido en escalas fraccionarias. */
	.tab:not(.active):hover {
		background: var(--vscode-tab-hoverBackground, rgba(128, 128, 128, 0.08));
		color: var(--vscode-tab-hoverForeground, var(--vscode-tab-inactiveForeground, var(--vscode-foreground)));
	}
	.tab.active {
		background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
		color: var(--vscode-tab-activeForeground, var(--vscode-foreground));
	}
	.tab-icon { font-size: 14px; flex: 0 0 auto; }
	.tab-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.tab-close { width: 18px; height: 18px; flex: 0 0 auto; border: none; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; visibility: hidden; }
	.tab-close .codicon { font-size: 13px; }
	.tab:hover .tab-close, .tab.active .tab-close { visibility: visible; }
	.tab-close:hover { background: var(--vscode-toolbar-hoverBackground); }
	#headerActions { display: flex; align-items: center; gap: 2px; padding: 0 4px; flex: 0 0 auto; }
	.head-btn { width: 24px; height: 24px; border: none; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
	.head-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.head-btn .codicon { font-size: 14px; }
	/* Historial a ANCHO COMPLETO del panel: la lista de conversaciones usa todo el espacio
	   (título + detalle + acciones respiran), en vez de un popover angosto flotando a la derecha. */
	#historyMenu { top: calc(100% + 4px); left: 6px; right: 6px; min-width: 0; max-width: none; max-height: min(480px, 70vh); }
	/* Split estable: al abrir Agentes el workbench agrega una columna y el webview reserva
	   exactamente ese ancho. Sin transform/transition: las animaciones de overlay hacían
	   relayout continuo y lag en los docks. */
	body.agent-layout-open { padding-right:min(340px,45vw); }
	#agentLayoutPanel { position:fixed; z-index:80; top:0; right:0; bottom:0; width:min(340px,45vw); min-width:240px; display:flex; visibility:hidden; pointer-events:none; flex-direction:column; overflow:hidden; contain:layout paint; border-left:1px solid rgba(128,128,128,.28); border-radius:0 12px 12px 0; background:var(--vscode-openide-islandBackground,var(--vscode-editor-background)); }
	#agentLayoutPanel.open { visibility:visible; pointer-events:auto; }
	.agent-layout-head { height:35px; flex:0 0 35px; display:flex; align-items:center; gap:7px; padding:0 8px 0 12px; border-bottom:none; background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background)); font-size:13px; font-weight:400; }
	.agent-layout-toggle-slot { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; flex:0 0 24px; margin-left:-5px; }
	.agent-layout-toggle-slot:empty { display:none; }
	.agent-layout-head .spacer { flex:1; }
	.agent-layout-search-wrap { display:flex; align-items:center; gap:7px; height:28px; flex:0 0 28px; margin:10px 12px; padding:0 8px; box-sizing:border-box; border:1px solid var(--vscode-focusBorder); border-radius:2px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); }
	.agent-layout-search-wrap:focus-within { border-color:var(--vscode-focusBorder); }
	.agent-layout-search-wrap > .codicon { flex:0 0 auto; color:var(--vscode-descriptionForeground); font-size:13px; }
	.agent-layout-search { flex:1; min-width:0; height:100%; padding:0; border:0; border-radius:0; outline:0; appearance:none; background:transparent; color:inherit; font:inherit; }
	.agent-layout-search::-webkit-search-cancel-button { appearance:none; }
	.agent-layout-search::placeholder { color:var(--vscode-input-placeholderForeground,var(--vscode-descriptionForeground)); opacity:.78; }
	.agent-layout-tree { flex:1; min-height:0; overflow:auto; padding:8px 12px 24px; display:flex; flex-direction:column; gap:8px; }
	.agent-tree-parent,.agent-tree-child { position:relative; display:flex; align-items:center; gap:9px; min-height:46px; padding:8px 10px; border:1px solid rgba(128,128,128,.22); border-radius:6px; background:transparent; color:var(--vscode-foreground); font:inherit; text-align:left; cursor:pointer; width:100%; }
	.agent-tree-parent:hover,.agent-tree-child:hover { background:var(--vscode-list-hoverBackground); border-color:var(--vscode-list-hoverBackground); }
	.agent-tree-parent.active { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); border-color:transparent; }
	.agent-tree-parent > .codicon,.agent-tree-child > .codicon:first-child { flex:0 0 16px; font-size:14px; color:var(--vscode-descriptionForeground); }
	.agent-tree-parent .tree-copy,.agent-tree-child .tree-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:1px; }
	.agent-tree-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; font-weight:500; }
	.agent-tree-detail { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--vscode-descriptionForeground); font-size:11px; }
	.agent-tree-section { display:flex; flex-direction:column; gap:2px; }
	.agent-tree-section.collapsed .agent-tree-section-body { display:none; }
	.agent-tree-section-head { display:flex; align-items:center; gap:6px; height:24px; padding:0 4px; border:0; background:transparent; color:var(--vscode-descriptionForeground); cursor:pointer; font:inherit; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
	.agent-tree-section-head:hover { color:var(--vscode-foreground); }
	.agent-tree-section-chev { flex:0 0 auto; font-size:12px; }
	.agent-tree-section-label { flex:0 0 auto; }
	.agent-tree-section-count { flex:0 0 auto; padding:0 5px; height:15px; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); font-size:10px; font-weight:600; text-transform:none; letter-spacing:0; }
	.agent-tree-section-body { display:flex; flex-direction:column; gap:1px; padding-left:8px; position:relative; }
	.agent-tree-section-body::before { content:''; position:absolute; left:0; top:0; bottom:0; width:1px; background:var(--vscode-tree-inactiveIndentGuidesStroke,rgba(128,128,128,.2)); }
	.agent-tree-child { min-height:38px; border:0; border-radius:4px; padding-left:12px; }
	.agent-tree-child:hover { background:var(--vscode-list-hoverBackground); }
	.agent-tree-child.status-running .agent-tree-title { color:var(--vscode-foreground); }
	.agent-tree-child.status-failed .agent-status-icon { color:var(--vscode-errorForeground); }
	.agent-tree-child.status-cancelled .agent-status-icon,.agent-tree-child.status-interrupted .agent-status-icon { color:var(--vscode-descriptionForeground); }
	.agent-tree-child.status-completed .agent-status-icon { color:var(--vscode-testing-iconPassed,var(--vscode-symbolIcon-functionForeground)); }
	.agent-tree-action { flex:0 0 auto; width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:4px; background:transparent; color:var(--vscode-descriptionForeground); cursor:pointer; font-size:13px; opacity:0; }
	.agent-tree-child:hover .agent-tree-action { opacity:.85; }
	.agent-tree-action:hover { background:var(--vscode-toolbar-hoverBackground); color:var(--vscode-foreground); opacity:1; }
	.agent-tree-stop { color:var(--vscode-errorForeground); }
	.agent-tree-empty { padding:24px 12px; text-align:center; color:var(--vscode-descriptionForeground); font-size:12px; line-height:1.5; }
	.agent-tree-child .agent-status-icon { width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; font-size:13px; border:0; border-radius:0; background:transparent; }
	.agent-tree-child .agent-status-icon.codicon-loading { border-color:transparent; }
	@media(max-width:620px){body.agent-layout-open{padding-right:min(300px,78vw)}#agentLayoutPanel{width:min(300px,78vw);min-width:0}}
	/* Menú de más acciones (…) anclado arriba a la derecha, bajo el botón estándar del toolbar. */
	#kebabMenu { top: calc(100% + 4px); right: 6px; min-width: 220px; max-width: min(280px, calc(100vw - 16px)); }
	/* Popover del modelo (estilo menú de modos): anclado al composer, scrolleable. */
	#modelMenu { bottom: calc(100% + 8px); left: 0; min-width: min(260px, calc(100vw - 16px)); max-width: min(320px, calc(100vw - 16px)); }

	/* ====================== dock: composer unificado (integrado) ============= */
	#dock {
		flex: 0 0 auto; display: flex; flex-direction: column; padding: 8px 10px 10px;
		position: relative; z-index: 100; isolation: isolate;
		background: var(--vscode-openide-islandBackground, var(--vscode-editor-background));
	}
	/* Zona de exclusión del composer: el thread termina visualmente antes de la caja y el
	   degradado absorbe la última línea durante el scroll, sin texto visible por detrás. */
	#dock::before {
		content: ''; position: absolute; z-index: 0; pointer-events: none;
		left: 0; right: 0; top: -34px; height: 42px;
		background: linear-gradient(to bottom, transparent 0%, var(--vscode-openide-islandBackground, var(--vscode-editor-background)) 82%);
	}
	/* El acceso "ir al final" queda sobre el thread, pero debajo de cualquier superficie
	   emergente del composer (uso de contexto, modelos, herramientas, etc.). */
	#jumpDown { position: absolute; top: -40px; right: 14px; z-index: 1; width: 28px; height: 28px; display: none; align-items: center; justify-content: center; padding: 0; cursor: pointer; color: var(--vscode-editor-background); background: var(--vscode-foreground); border: none; border-radius: 50%; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); transition: opacity 120ms ease, transform 120ms ease; }
	#jumpDown.show { display: flex; }
	#jumpDown:hover { opacity: 0.85; }
	#jumpDown:active { transform: scale(0.92); }
	#jumpDown .codicon { font-size: 14px; }

	#topDock { flex: 0 0 auto; padding: 8px 10px 0; display: flex; flex-direction: column; }
	#topDock:empty { display: none; }

	/* Composer + bandejas integrado. Files y Background Terminal viven DETRAS del
	   compositor y éste se solapa sobre su borde inferior; no quedan como otra card dentro
	   del textarea. */
	#composer { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; width: 100%; }
	#filesStack {
		position: relative; z-index: 0; display: flex; flex-direction: column; gap: 0;
		width: min(calc(100% - 20px), 740px); box-sizing: border-box;
	}
	#filesStack:empty { display: none; }
	#filesStack:not(:empty) { margin: 0 auto -10px; }
	#filesStack > .dock-section:not(:last-child) { margin-bottom: -10px; }
	#filesStack > .dock-section:nth-last-child(1) { position: relative; z-index: 3; }
	#filesStack > .dock-section:nth-last-child(2) { position: relative; z-index: 2; }
	#filesStack > .dock-section:nth-last-child(3) { position: relative; z-index: 1; }
	#composerDock { display: flex; flex-direction: column; }
	#composerDock:empty { display: none; }
	#composerDock:not(:empty) { margin: 0 0 3px; padding-bottom: 3px; border-bottom: 1px solid rgba(128, 128, 128, 0.14); }
	#composerDock .dock-section:first-child { padding-top: 0; }
	.dock-section { border-bottom: 1px solid rgba(128, 128, 128, 0.12); padding: 2px 1px 3px; }
	.dock-section:last-child { border-bottom: none; padding-bottom: 0; }
	.dock-head { display: flex; align-items: center; gap: 5px; min-height: 20px; }
	.dock-toggle { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: none; background: transparent; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 11.5px; cursor: pointer; min-width: 0; }
	.dock-toggle:hover { color: var(--vscode-foreground); }
	.dock-toggle .codicon { font-size: 11px; flex: 0 0 auto; }
	.dock-spacer { flex: 1; min-width: 4px; }
	.dock-link { border: none; background: transparent; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 11px; cursor: pointer; padding: 1px 3px; border-radius: 3px; white-space: nowrap; }
	.dock-link:hover { color: var(--vscode-foreground); background: rgba(128, 128, 128, 0.1); }
	.dock-btn { border: none; border-radius: 4px; background: rgba(128, 128, 128, 0.22); color: var(--vscode-foreground); font-family: inherit; font-size: 11px; font-weight: 500; padding: 2px 8px; min-height: 20px; cursor: pointer; white-space: nowrap; }
	.dock-btn:hover { background: rgba(128, 128, 128, 0.32); }
	.dock-body { display: flex; flex-direction: column; gap: 0; padding-top: 1px; }
	.dock-body[hidden] { display: none; }

	/* cola de mensajes */
	.dock-queue-row { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: center; column-gap: 6px; padding: 1px 0; min-width: 0; font-size: 11.5px; }
	.dock-queue-row > .codicon:first-child { font-size: 12px; color: var(--vscode-descriptionForeground); flex: 0 0 auto; }
	.dock-queue-text { min-width: 0; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--vscode-foreground); }
	.dock-queue-actions { display: inline-flex; align-items: center; gap: 2px; min-width: max-content; }
	.dock-icon-btn { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0; flex: 0 0 auto; opacity: 0.85; }
	.dock-icon-btn:hover { background: rgba(128, 128, 128, 0.14); color: var(--vscode-foreground); opacity: 1; }
	.dock-icon-btn .codicon { font-size: 12px; }

	/* Bandejas apiladas sobre el composer: cola, cambios y terminales comparten superficie. */
	.queue-tray,
	.queue-tray.dock-section,
	.queue-tray.dock-section:last-child,
	.subagents-tray,
	.subagents-tray.dock-section,
	.subagents-tray.dock-section:last-child,
	.files-tray,
	.files-tray.dock-section,
	.files-tray.dock-section:last-child,
	.terms-tray,
	.terms-tray.dock-section,
	.terms-tray.dock-section:last-child {
		background: var(--vscode-input-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
		border: 1px solid rgba(128, 128, 128, 0.26);
		border-radius: 6px;
		padding: 3px 7px 14px;
		margin: 0;
		display: flex; flex-direction: column; gap: 1px;
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.12);
	}
	.queue-tray .dock-head,
	.subagents-tray .dock-head,
	.files-tray .dock-head,
	.terms-tray .dock-head { min-height: 20px; gap: 4px; }
	.queue-tray .dock-toggle,
	.subagents-tray .dock-toggle,
	.files-tray .dock-toggle,
	.terms-tray .dock-toggle { color: var(--vscode-foreground); font-size: 11.5px; font-weight: 500; gap: 4px; }
	.queue-tray .dock-toggle .codicon,
	.subagents-tray .dock-toggle .codicon,
	.files-tray .dock-toggle .codicon,
	.terms-tray .dock-toggle .codicon { font-size: 11px; color: var(--vscode-descriptionForeground); }
	.files-tray .dock-files-count { font-variant-numeric: tabular-nums; }
	.files-tray .dock-link,
	.terms-tray .dock-link { font-size: 11px; color: var(--vscode-descriptionForeground); padding: 1px 4px; }
	.files-tray .dock-link:hover,
	.terms-tray .dock-link:hover { color: var(--vscode-foreground); background: rgba(128, 128, 128, 0.12); }
	.files-tray .dock-btn {
		border-radius: 4px; background: rgba(128, 128, 128, 0.26);
		font-size: 11px; font-weight: 500; padding: 1px 8px; min-height: 20px;
	}
	.files-tray .dock-btn:hover { background: rgba(128, 128, 128, 0.34); }
	.dock-head-actions { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
	.dock-stop-action, .dock-bulk-action { display: inline-flex; align-items: center; gap: 3px; border: none; background: transparent; color: var(--vscode-foreground); font: inherit; font-size: 11px; cursor: pointer; padding: 1px 2px; white-space: nowrap; }
	.dock-stop-action:hover { color: var(--vscode-errorForeground, var(--vscode-foreground)); }
	.dock-bulk-action:hover { color: var(--vscode-textLink-activeForeground, var(--vscode-foreground)); }
	.dock-stop-action[hidden], .dock-bulk-action[hidden] { display: none; }
	.dock-kbd { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 9.5px; }
	.queue-tray .dock-body,
	.subagents-tray .dock-body,
	.files-tray .dock-body,
	.terms-tray .dock-body { gap: 0; padding-top: 1px; }
	.dock-file-row {
		display: flex; align-items: center; gap: 6px;
		padding: 1px 2px; margin: 0 -1px; border-radius: 3px;
		cursor: pointer; min-width: 0; min-height: 20px; font-size: 11.5px;
	}
	.dock-file-row:hover { background: rgba(128, 128, 128, 0.1); }
	.dock-file-row .ficon, .dock-file-row > .codicon.codicon-file { flex: 0 0 auto; transform: scale(0.92); transform-origin: center; }
	.dock-file-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.dock-diff-add { flex: 0 0 auto; color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green, #2ea043)); font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; font-variant-numeric: tabular-nums; }
	.dock-diff-del { flex: 0 0 auto; color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149); font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; font-variant-numeric: tabular-nums; margin-left: 2px; }
	.dock-file-actions {
		display: none; align-items: center; gap: 0; flex: 0 0 auto; margin-left: 2px;
	}
	.dock-file-row:hover .dock-file-actions,
	.dock-file-row:focus-within .dock-file-actions { display: inline-flex; }
	.dock-file-action {
		width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
		border: none; border-radius: 3px; padding: 0; background: transparent;
		color: var(--vscode-descriptionForeground); cursor: pointer;
	}
	.dock-file-action .codicon { font-size: 12px; }
	.dock-file-action:hover { background: rgba(128, 128, 128, 0.18); color: var(--vscode-foreground); }
	.dock-file-action.reject:hover { color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149); }
	.dock-file-action.accept:hover { color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green, #2ea043)); }

	.term-stop { width: 18px; height: 18px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; border: none; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0; opacity: 0; }
	.dock-bg-row:hover .term-stop { opacity: 1; }
	.term-stop:hover { background: rgba(128, 128, 128, 0.14); }
	.term-stop .codicon { font-size: 12px; }

	/* terminales en segundo plano (lista compacta en el dock) */
	.dock-bg-row { display: flex; align-items: center; gap: 6px; padding: 2px 3px; margin: 0 -1px; border-radius: 3px; cursor: pointer; min-width: 0; font-size: 11.5px; }
	.dock-bg-row:hover { background: rgba(128, 128, 128, 0.08); }
	.dock-bg-row > .codicon { font-size: 12px; color: var(--vscode-descriptionForeground); flex: 0 0 auto; }
	.dock-bg-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
	@media (max-width: 440px) { .dock-stop-action .dock-kbd { display: none; } }

	/* to-dos (arriba del thread, alineados al dock denso) */
	.tray { padding: 3px 8px 4px; border: 1px solid rgba(128, 128, 128, 0.26); border-radius: 6px; margin-bottom: 6px; }
	.tray-head { display: flex; align-items: center; gap: 4px; padding: 1px 0; }
	.tray-toggle { display: flex; align-items: center; gap: 5px; padding: 2px 1px; border: none; background: transparent; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 11.5px; cursor: pointer; min-width: 0; }
	.tray-toggle:hover { color: var(--vscode-foreground); }
	.tray-toggle .codicon { font-size: 11px; flex: 0 0 auto; }
	.tray-current { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.tray-spacer { flex: 1; }
	.tray-progress { flex: 0 0 auto; font-size: 11px; color: var(--vscode-descriptionForeground); padding-right: 2px; }
	.todo-row { display: flex; align-items: flex-start; gap: 6px; padding: 2px 2px; min-width: 0; }
	.todo-icon { font-size: 12px; flex: 0 0 auto; margin-top: 1px; color: var(--vscode-descriptionForeground); }
	.todo-content { flex: 1; min-width: 0; font-size: 11.5px; line-height: 1.4; }
	.todo-row.s-completed .todo-icon { color: var(--vscode-charts-green, #2ea043); }
	.todo-row.s-completed .todo-content { opacity: 0.55; text-decoration: line-through; }
	.todo-row.s-in-progress .todo-icon { color: var(--vscode-foreground); }
	.todo-row.s-in-progress .todo-content { font-weight: 600; }

	/* ====================== panel de pregunta (docked) ======================= */
	.qpanel { padding: 10px 12px 11px; border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 10px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 8px; animation: qp-in 180ms cubic-bezier(0.16, 1, 0.3, 1); }
	@keyframes qp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
	.qpanel-head { display: flex; align-items: center; gap: 6px; }
	.qpanel-head > .codicon { color: var(--vscode-descriptionForeground); font-size: 14px; }
	.qpanel-title { font-size: 12px; font-weight: 600; color: var(--vscode-descriptionForeground); }
	.qpanel-q { font-size: 13px; font-weight: 600; line-height: 1.45; word-break: break-word; overflow-wrap: anywhere; }
	.qopts { display: flex; flex-direction: column; gap: 4px; }
	.qopt { display: flex; align-items: flex-start; gap: 8px; border: none; border-radius: 2px; background: transparent; color: var(--vscode-foreground); font-family: inherit; font-size: 12.5px; text-align: left; cursor: pointer; padding: 5px 7px; }
	.qopt:hover:not(:disabled) { background: rgba(128, 128, 128, 0.12); }
	.qopt:disabled { cursor: default; opacity: 0.6; }
	.qopt.selected { background: rgba(128, 128, 128, 0.12); }
	.qradio .codicon { font-size: 14px; margin-top: 1px; color: var(--vscode-descriptionForeground); }
	.qopt.selected .qradio .codicon { color: var(--vscode-foreground); }
	.qopt-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; word-break: break-word; overflow-wrap: anywhere; }
	/* respuesta libre = INPUT de UNA línea: el texto corre horizontal (nada de textarea que
	   wrappea y muestra scrollbar vertical con flechitas) */
	.qcustom-shell { display: flex; align-items: center; gap: 6px; width: 100%; height: 20px; min-width: 0; overflow: hidden; }
	.qcustom { flex: 1 1 auto; min-width: 48px; width: auto; box-sizing: border-box; height: 20px; padding: 0; border: none; outline: none; background: transparent; color: var(--vscode-foreground); font-family: inherit; font-size: 12.5px; line-height: 1.4; }
	.qcustom::placeholder { color: var(--vscode-descriptionForeground); opacity: 0.75; }
	/* resumen RESPONDIDO en el transcript (estilo ghost): pregunta bold + linea "check respuesta" */
	.q-summary-block { border: 1px solid rgba(128, 128, 128, 0.22); border-radius: 8px; padding: 8px 12px; margin: 6px 0; }
	.q-summary { display: flex; flex-direction: column; gap: 4px; }
	.q-summary + .q-summary { margin-top: 4px; padding-top: 8px; border-top: 1px solid rgba(128, 128, 128, 0.15); }
	.q-summary-q { font-weight: 600; font-size: 13px; }
	.q-summary-a { display: flex; align-items: baseline; gap: 6px; font-size: 12.5px; color: var(--vscode-descriptionForeground); min-width: 0; }
	.q-summary-a .codicon { font-size: 13px; color: var(--vscode-foreground); flex: 0 0 auto; }
	.q-summary-a span:last-child { white-space: pre-wrap; word-break: break-word; }
	.qpanel-foot { display: flex; align-items: center; gap: 8px; }
	.qimages { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; min-height: 0; }
	.qimages:empty { display: none; }
	.qcustom-shell .qimages { flex: 0 1 auto; flex-wrap: nowrap; max-width: 55%; overflow: hidden; }
	.qcustom-shell .qimage-chip { height: 20px; flex: 0 0 auto; }
	.qimage-chip { position: relative; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 5px 0 7px; border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 38%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent); color: var(--vscode-foreground); font: 11.5px var(--vscode-editor-font-family, monospace); }
	.qimage-chip > .codicon { color: var(--vscode-textLink-foreground); font-size: 12px; }
	.qimage-remove { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; }
	.qimage-remove:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.qimage-preview { position: fixed; z-index: 1000; display: none; width: 240px; max-height: 180px; padding: 5px; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); border-radius: 8px; background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background)); box-shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0,0,0,.45)); pointer-events: none; }
	.qimage-preview.show { display: block; }
	.qimage-preview img { display: block; width: 100%; max-height: 168px; object-fit: contain; border-radius: 4px; }
	.qsubmit { height: 24px; padding: 0 12px; border: none; border-radius: 2px; background: var(--vscode-foreground); color: var(--vscode-editor-background); font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 150ms ease; }
	.qsubmit:hover:not(:disabled) { opacity: 0.85; }
	.qsubmit:disabled { opacity: 0.35; cursor: default; }
	.qskip { height: 24px; padding: 0 10px; border: none; border-radius: 2px; background: transparent; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 12px; cursor: pointer; }
	.qskip:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.qback { height: 24px; display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border: none; border-radius: 2px; background: transparent; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 12px; cursor: pointer; }
	.qback:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	/* dots de progreso del stepper (batch de preguntas) */
	.qdots { display: flex; align-items: center; gap: 4px; }
	.qdot { width: 6px; height: 6px; border-radius: 50%; background: rgba(128, 128, 128, 0.35); }
	.qdot.on { background: var(--vscode-foreground); }
	.qdot.done { background: var(--vscode-charts-green, #2ea043); }

	/* ====================== aprobación INLINE, componente TOOL ===============
	   Comparte la anatomía de las cards del browser pero sin barra lateral de color:
	   identidad + badge arriba, contexto y acciones en un cuerpo colapsable. */
	.approval { --approval-accent: var(--vscode-charts-purple, #a855f7); margin: 5px 0 7px; display: flex; flex-direction: column; overflow: visible; background: rgba(128, 128, 128, 0.035); border: 1px solid rgba(128, 128, 128, 0.26); border-radius: 8px; animation: qp-in 180ms cubic-bezier(0.16, 1, 0.3, 1); }
	.approval.tool-kind-skill,
	.approval.tool-kind-mcp { --approval-accent: var(--vscode-descriptionForeground); }
	.approval-head { width: 100%; min-height: 39px; padding: 6px 9px; display: flex; align-items: center; gap: 7px; min-width: 0; border: none; border-radius: 8px; background: transparent; color: var(--vscode-descriptionForeground); font-family: inherit; text-align: left; cursor: pointer; }
	.approval-head:hover { color: var(--vscode-foreground); background: rgba(128, 128, 128, 0.045); }
	.approval-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px var(--vscode-editor-font-family, monospace); color: var(--vscode-foreground); }
	.approval-kind { flex: 0 0 auto; padding: 2px 5px; border-radius: 3px; background: rgba(128, 128, 128, 0.14); color: var(--vscode-descriptionForeground); font-size: 9px; line-height: 1.2; font-weight: 650; letter-spacing: 0.035em; text-transform: uppercase; }
	.approval-chevron { display: inline-flex; flex: 0 0 auto; color: var(--vscode-descriptionForeground); }
	.approval-body { display: none; padding: 8px 9px 9px; border-top: 1px solid rgba(128, 128, 128, 0.16); }
	.approval.open .approval-body { display: block; }
	.approval-request-label { margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 9.5px; font-weight: 650; letter-spacing: 0.055em; text-transform: uppercase; }
	.approval-description { margin-bottom: 7px; color: var(--vscode-foreground); font-size: 12px; line-height: 1.4; }
	.approval-cmd { display: block; max-height: 132px; margin: 1px 0 7px; padding: 6px 8px; overflow: auto; white-space: pre-wrap; word-break: break-word; border: 1px solid rgba(128, 128, 128, 0.22); border-radius: 5px; background: rgba(128, 128, 128, 0.035); color: var(--vscode-foreground); font: 11.5px/1.5 var(--vscode-editor-font-family, monospace); }
	.approval-note { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
	.approval-actions { height: 24px; margin-top: 7px; padding: 0; display: flex; align-items: stretch; gap: 6px; flex-wrap: nowrap; position: relative; }
	.approval-primary-group { height: 24px; display: inline-flex; align-items: stretch; overflow: visible; border: 1px solid color-mix(in srgb, var(--vscode-button-background) 42%, transparent); border-radius: 5px; background: color-mix(in srgb, var(--vscode-button-background) 14%, transparent); }
	.approval-more-anchor { position: relative; display: inline-flex; }
	.approval-menu { bottom: calc(100% + 4px); left: -1px; min-width: 176px; max-width: min(220px, calc(100vw - 16px)); }
	.approval-menu .menu-row.danger { color: var(--vscode-errorForeground); }
	.approval-menu .menu-row.danger:hover, .approval-menu .menu-row.danger:focus-visible { background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent); }
	.abtn { height: 22px; min-height: 0; padding: 0 7px; display: inline-flex; align-items: center; gap: 5px; border: none; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 11.5px; cursor: pointer; transition: background 120ms ease, color 120ms ease; white-space: nowrap; }
	.abtn:hover { background: rgba(128, 128, 128, 0.14); color: var(--vscode-foreground); }
	.abtn .codicon { font-size: 12px; }
	.abtn.primary { border-radius: 4px 0 0 4px; color: var(--vscode-foreground); font-weight: 500; }
	.abtn.primary:hover { background: color-mix(in srgb, var(--vscode-button-background) 22%, transparent); color: var(--vscode-foreground); }
	.abtn.more { width: 20px; padding: 0; justify-content: center; border-left: 1px solid color-mix(in srgb, var(--vscode-button-background) 28%, transparent); border-radius: 0 4px 4px 0; }
	.abtn.deny { color: var(--vscode-descriptionForeground); }
	.abtn.deny:hover { color: var(--vscode-errorForeground); background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent); }
	.abtn.detail { padding: 0 4px; }
	.abtn-kbd { opacity: 0.58; font-size: 9.5px; }
	/* Decisión de permiso resuelta: misma línea plana que Thinking/Exploring (sin card ni badges). */
	.decision-line {
		display: flex; align-items: center; gap: 6px;
		min-height: 22px; margin: 1px 0; padding: 2px 0;
		font-size: 12.5px; color: var(--vscode-descriptionForeground);
	}
	.decision-line .dlabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
	.decision-line.deny .dlabel { color: var(--vscode-descriptionForeground); opacity: 0.85; }

	/* ====================== composer ========================================= */
	#inputCard {
		position: relative; z-index: 1; display: flex; flex-direction: column; gap: 3px; width: min(100%, 760px); box-sizing: border-box; margin: 0 auto; padding: 8px 10px 7px;
		border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 8px;
		background: var(--vscode-input-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
		transition: border-color 150ms ease-in-out;
	}
	@media (max-width: 420px) {
		.turn-body { width: calc(100% - 16px); }
	}
	#inputCard.focused { border-color: rgba(128, 128, 128, 0.45); }
	#prompt {
		width: 100%; resize: none; min-height: 24px; max-height: 160px; overflow-y: auto;
		background: transparent; color: var(--vscode-foreground);
		border: none; outline: none; box-shadow: none; font-family: inherit; font-size: 13px; line-height: 1.4;
	}
	#prompt::placeholder { color: var(--vscode-descriptionForeground); opacity: 0.7; }
	#inputRow { display: flex; align-items: center; gap: 4px; min-width: 0; }
	.anchor { position: relative; display: flex; flex-shrink: 0; }
	.anchor.shrink { flex-shrink: 1; min-width: 0; }
	#modelTrigger, #modeTrigger {
		display: inline-flex; align-items: center; gap: 4px; height: 22px; max-width: 100%;
		padding: 0 4px; border: none; border-radius: 4px; background: transparent; cursor: pointer;
		color: var(--vscode-foreground); font-size: 12px; overflow: hidden;
	}
	#modelTrigger:hover, #modeTrigger:hover { background: var(--vscode-toolbar-hoverBackground); }
	#modelTrigger .mname, #modeTrigger .mname { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
	#modelTrigger.unset .mname { color: var(--vscode-descriptionForeground); font-weight: 400; }
	#modelTrigger .chevron, #modeTrigger .chevron { font-size: 12px; color: var(--vscode-descriptionForeground); flex: 0 0 auto; }
	#modeTrigger > .codicon:first-child { font-size: 13px; color: var(--vscode-descriptionForeground); }
	#modeMenu { bottom: calc(100% + 8px); left: 0; min-width: min(200px, calc(100vw - 16px)); max-width: calc(100vw - 16px); }
	/* autocomplete de @archivos (integrado): ancho completo del composer, sobre el input */
	#mentionMenu { bottom: calc(100% + 6px); left: 8px; right: 8px; min-width: 0; max-height: min(300px, 40vh); }
	#mentionMenu .menu-label { direction: rtl; text-align: left; } /* elide al INICIO: se ve el nombre del archivo */
	/* autocomplete de /comandos: mismo layout que el de @, slug en mono + description muted */
	#slashMenu { bottom: calc(100% + 6px); left: 8px; right: 8px; min-width: 0; max-height: min(440px, 56vh); }
	#slashMenu .menu-content { padding: 4px; }
	#slashMenu .menu-label { font-family: var(--vscode-editor-font-family, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.slash-section + .slash-section { border-top: 1px solid rgba(128, 128, 128, 0.18); margin-top: 4px; padding-top: 4px; }
	.slash-section-title { height: 23px; display: flex; align-items: center; padding: 0 7px; color: var(--vscode-descriptionForeground); font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
	#slashMenu .menu-row { min-height: 42px; align-items: flex-start; padding-top: 5px; padding-bottom: 5px; }
	#slashMenu .menu-row-icon { padding-top: 2px; }
	#slashMenu .slash-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
	#slashMenu .menu-detail { display: block; width: 100%; max-width: none; overflow: hidden; text-overflow: clip; white-space: nowrap; font-size: 11.5px; color: var(--vscode-descriptionForeground);
		-webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 44px), transparent 100%);
		mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 44px), transparent 100%); }
	#slashMenu .menu-row.focus .menu-detail { color: inherit; opacity: 0.72; }
	.slash-risk { flex: 0 0 auto; margin-top: 2px; font-size: 10px; color: var(--vscode-descriptionForeground); }
	#slashMenu .slash-hint { color: var(--vscode-descriptionForeground); font-style: italic; } /* ghost del argument-hint */
	.menu-row.focus {
		outline: none; background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
		color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, #fff));
		border-color: var(--vscode-menu-selectionBorder, transparent);
	}

	/* adjuntos (paste/pick de imágenes) */
	#attachStrip { display: flex; flex-wrap: wrap; gap: 6px; }
	#attachStrip[hidden] { display: none; }
	/* chip de Pick & Polish: elemento seleccionado en la app local, pendiente de enviar */
	#pickChip { display: flex; align-items: center; gap: 6px; min-height: 22px; padding: 2px 6px; margin-bottom: 2px; border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 45%, transparent); border-radius: 3px; background: color-mix(in srgb, var(--vscode-textLink-foreground) 8%, transparent); font-size: 12px; }
	#pickChip[hidden] { display: none; }
	#pickChip .codicon-inspect { color: var(--vscode-textLink-foreground); font-size: 13px; flex: 0 0 auto; }
	#pickChip .pick-sel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family, monospace); }
	#pickChip .pick-x { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; color: inherit; cursor: pointer; border-radius: 2px; padding: 0; flex: 0 0 auto; }
	#pickChip .pick-x:hover { background: var(--vscode-toolbar-hoverBackground); }
	#fileReferenceStrip { display: flex; flex-wrap: wrap; gap: 5px; padding: 1px 0 3px; }
	#fileReferenceStrip[hidden] { display: none; }
	.file-reference-chip { height: 23px; max-width: min(260px, 100%); display: inline-flex; align-items: center; gap: 5px; padding: 0 4px 0 6px; border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 42%, transparent); border-radius: 4px; background: color-mix(in srgb, var(--vscode-textLink-foreground) 14%, transparent); color: var(--vscode-foreground); font-size: 12px; }
	.file-reference-chip .ficon, .file-reference-chip > .codicon { flex: 0 0 auto; width: 16px; height: 16px; color: var(--vscode-textLink-foreground); }
	.file-reference-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.file-reference-remove { width: 17px; height: 17px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; }
	.file-reference-remove:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.file-reference-remove .codicon { font-size: 11px; }
	.attach-chip { position: relative; width: 44px; height: 44px; border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 2px; overflow: hidden; cursor: zoom-in; }
	.attach-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.attach-remove { position: absolute; top: 1px; right: 1px; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #fff; cursor: pointer; padding: 0; }
	.attach-remove .codicon { font-size: 11px; }

	/* imágenes en mensajes del usuario */
	.msg-imgs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
	.msg-img { width: 72px; height: 72px; border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 2px; overflow: hidden; cursor: zoom-in; padding: 0; background: transparent; }
	.msg-img img { width: 100%; height: 100%; object-fit: cover; display: block; }

	/* card de captura de pantalla inline (browser_screenshot/navigate) */
	.shot-card { margin: 8px 0; border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 10px; overflow: hidden; }
	.shot-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid rgba(128, 128, 128, 0.16); }
	.shot-head > .codicon { font-size: 13px; }
	.shot-body { display: block; width: 100%; padding: 0; border: none; background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.06)); cursor: zoom-in; }
	.shot-body img { display: block; width: 100%; max-height: 260px; object-fit: contain; object-position: top; }

	#inputRow .spacer { flex: 1; }
	.util-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0; flex: 0 0 auto; transition: background 120ms ease, color 120ms ease; }
	.util-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.util-btn .codicon { font-size: 13px; }
	#followBtn { position: relative; }
	/* Seguir es un estado utilitario, no una acción primaria: conserva la superficie neutra del
	   composer en cualquier theme. El pulso del glifo comunica el estado sin punto ni azul fijo. */
	#followBtn.active { color: var(--vscode-foreground); background: transparent; box-shadow: none; }
	#followBtn.active:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
	#followBtn.active .codicon { animation: follow-pulse 1.6s ease-in-out infinite; }
	@keyframes follow-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(.88); opacity: .58; } }
	@media (prefers-reduced-motion: reduce) { #followBtn.active .codicon { animation: none; } }
	/* dictado por voz: mismo slot que el botón de enviar (composer vacío = mic; con texto = enviar).
	   Círculo con fondo suave, integrado. Grabando = rojo pulsante; transcribiendo = shimmer. */
	#micBtn { width: 24px; height: 24px; border-radius: 50%; background: rgba(128, 128, 128, 0.14); color: var(--vscode-foreground); }
	#micBtn:hover { background: rgba(128, 128, 128, 0.26); }
	#micBtn[hidden] { display: none; }
	#micBtn.rec { color: var(--vscode-errorForeground); animation: mic-pulse 1.2s ease-in-out infinite; }
	#micBtn.busy { pointer-events: none; }
	@keyframes mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

	#send {
		width: 24px; height: 24px; flex: 0 0 auto; border: none; border-radius: 50%; cursor: pointer;
		display: inline-flex; align-items: center; justify-content: center;
		background: var(--vscode-foreground); color: var(--vscode-editor-background);
		transition: transform 120ms ease, opacity 120ms ease;
	}
	#send[hidden] { display: none; }
	#send:hover { opacity: 0.85; }
	#send:active { transform: scale(0.92); }
	#send:disabled { background: rgba(128, 128, 128, 0.25); color: var(--vscode-descriptionForeground); cursor: default; }
	#send:disabled:hover { opacity: 1; }
	#send .codicon { font-size: 12px; }
	.stop-square { width: 8px; height: 8px; border-radius: 1.5px; background: currentColor; }

	/* Panel de uso de contexto: comparte la geometría de 8px del inputCard y siempre se
	   compone por encima del acceso transitorio "ir al final". */
	#ctxPanel { bottom: calc(100% + 8px); left: 0; right: 0; z-index: 40; border-radius: 8px; border: 1px solid rgba(128, 128, 128, 0.3); background: var(--vscode-editor-background); box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36)); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; position: absolute; }
	#ctxPanel[hidden] { display: none; }
	.ctx-head { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; gap: 8px; }
	.ctx-close { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0; flex: 0 0 auto; }
	.ctx-close:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
	.ctx-close .codicon { font-size: 14px; }
	.ctx-meta { display: flex; align-items: center; justify-content: space-between; color: var(--vscode-descriptionForeground); font-size: 12px; }
	.ctx-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(128, 128, 128, 0.18); gap: 1px; }
	.ctx-fill { background: var(--vscode-foreground); border-radius: 3px; transition: width 200ms ease; }
	/* barra segmentada con colores por rubro (integrado) */
	.ctx-seg { height: 100%; transition: width 200ms ease, opacity 120ms ease; flex: 0 0 auto; }
	.ctx-bar.dim .ctx-seg { opacity: 0.22 !important; }
	.ctx-bar.dim .ctx-seg.hot { opacity: 1 !important; }
	.ctx-row { display: flex; align-items: center; gap: 8px; border-radius: 2px; padding: 1px 4px; margin: 0 -4px; cursor: default; }
	.ctx-row.seg-row:hover { background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.1)); }
	.ctx-row .lbl { flex: 1; color: var(--vscode-foreground); }
	.ctx-row .val { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
	.ctx-row .sw { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 auto; }
	.ctx-sep { border-top: 1px solid rgba(128, 128, 128, 0.22); margin: 2px 0; }

	/* Íconos del FILE ICON THEME (los mismos del árbol de archivos): el host inyecta el
	   stylesheet del theme en #iconThemeCss; estas reglas base replican el sizing que en el
	   workbench aporta .monaco-icon-label. Los selectores del theme (más específicos) pisan
	   el content/background según el archivo. */
	body.show-file-icons .ficon { display: inline-block; width: 16px; height: 16px; }
	body.show-file-icons .ficon::before { content: ' '; display: inline-block; width: 16px; height: 16px; font-size: 16px; line-height: 16px; background-size: 16px; background-position: 0 center; background-repeat: no-repeat; vertical-align: top; }
</style>
<style id="iconThemeCss"></style>
<style id="tokenColorsCss"></style>
</head>
<body>
	<div id="header">
		<div id="tabs"></div>
		<div id="headerActions">
			<button id="agentLayoutBtn" class="head-btn" data-tip="Árbol de agentes" data-tip-position="below" aria-pressed="false"><span class="codicon codicon-layout-sidebar-right"></span></button>
			<button id="historyBtn" class="head-btn" data-tip="Historial de conversaciones" data-tip-position="below"><span class="codicon codicon-history"></span></button>
			<button id="newBtn" class="head-btn" data-tip="Nueva conversación" data-tip-position="below"><span class="codicon codicon-add"></span></button>
			<button id="menuBtn" class="head-btn" data-tip="Más opciones" data-tip-position="below"><span class="codicon codicon-toolbar-more"></span></button>
		</div>
		<div id="historyMenu" class="menu" hidden><div class="menu-content" id="historyMenuContent"></div></div>
		<div id="kebabMenu" class="menu" hidden><div class="menu-content" id="kebabMenuContent"></div></div>
	</div>
	<aside id="agentLayoutPanel" aria-label="Árbol de agentes"><div class="agent-layout-head"><span id="agentLayoutToggleSlot" class="agent-layout-toggle-slot"></span><span>Agentes</span><span class="spacer"></span><button id="agentLayoutClose" class="head-btn" aria-label="Cerrar árbol de agentes"><span class="codicon codicon-close"></span></button></div><label class="agent-layout-search-wrap"><span class="codicon codicon-search" aria-hidden="true"></span><input id="agentLayoutSearch" class="agent-layout-search" type="search" placeholder="Buscar agentes…" aria-label="Buscar agentes"></label><div id="agentLayoutTree" class="agent-layout-tree"></div></aside>
	<div id="topDock"></div>
	<div id="messages"></div>
	<div id="dock">
		<button id="jumpDown" data-tip="Ir al final"><span class="codicon codicon-arrow-down"></span></button>
		<div id="composer">
			<div id="filesStack"></div>
			<div id="inputCard">
				<div id="composerDock"></div>
				<div id="pickChip" hidden></div>
				<div id="fileReferenceStrip" hidden></div>
				<div id="attachStrip" hidden></div>
				<div id="capabilityStrip" hidden></div>
				<div id="linkStrip" hidden></div>
					<textarea id="prompt" rows="1" placeholder="Plan, Build, / for skills, @ for context"></textarea>
				<div id="inputRow">
					<span class="anchor">
						<button id="modeTrigger" data-tip="Agent mode"><span class="codicon codicon-openide-mode-agent"></span><span class="mname">Agent</span><span class="codicon codicon-chevron-down chevron"></span></button>
						<div id="modeMenu" class="menu" hidden><div class="menu-content" id="modeMenuContent"></div></div>
					</span>
					<span class="anchor shrink">
						<button id="modelTrigger" class="unset" data-tip="Modelo / proveedor"><span class="mname">Seleccionar modelo</span><span class="codicon codicon-chevron-down chevron"></span></button>
						<div id="modelMenu" class="menu" hidden><div class="menu-content" id="modelMenuContent"></div></div>
					</span>
					<span class="spacer"></span>
					<button id="followBtn" class="util-btn" aria-pressed="false" data-tip="Seguir al agente"><span class="codicon codicon-target"></span></button>
					<button id="attachBtn" class="util-btn" data-tip="Adjuntar imagen (o pegala con Ctrl+V)"><span class="codicon codicon-attach"></span></button>
					<input id="attachInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple style="display:none">
					<button id="micBtn" class="util-btn" data-tip="Dictado por voz"><span class="codicon codicon-mic-filled"></span></button>
					<button id="send" data-tip="Send (Enter)" hidden><span class="codicon codicon-arrow-up"></span></button>
				</div>
				<div id="ctxPanel" hidden></div>
				<div id="mentionMenu" class="menu" hidden><div class="menu-content" id="mentionMenuContent"></div></div>
				<div id="slashMenu" class="menu" hidden><div class="menu-content" id="slashMenuContent"></div></div>
			</div>
		</div>
	</div>
<script nonce="${nonce}">
(function () {
	var vscode = acquireVsCodeApi();
	var messagesEl = document.getElementById('messages');
	var dockEl = document.getElementById('dock');
	var composerEl = document.getElementById('composer');
	var composerDockEl = document.getElementById('composerDock');
	var filesStackEl = document.getElementById('filesStack');
	var topDockEl = document.getElementById('topDock');       // to-dos, arriba del thread (Cursor)
	var promptEl = document.getElementById('prompt');
	var inputCard = document.getElementById('inputCard');
	var sendBtn = document.getElementById('send');
	var modelTrigger = document.getElementById('modelTrigger');
	var modelMenu = document.getElementById('modelMenu');
	var modelMenuContent = document.getElementById('modelMenuContent');
	var ctxPanel = document.getElementById('ctxPanel');
	var mentionMenu = document.getElementById('mentionMenu');
	var mentionMenuContent = document.getElementById('mentionMenuContent');
	var tabsEl = document.getElementById('tabs');
	var headerActions = document.getElementById('headerActions');
	var historyBtn = document.getElementById('historyBtn');
	var agentLayoutBtn = document.getElementById('agentLayoutBtn');
	var agentLayoutToggleSlot = document.getElementById('agentLayoutToggleSlot');
	var agentLayoutPanel = document.getElementById('agentLayoutPanel');
	var agentLayoutClose = document.getElementById('agentLayoutClose');
	var agentLayoutSearch = document.getElementById('agentLayoutSearch');
	var agentLayoutTree = document.getElementById('agentLayoutTree');
	var newBtn = document.getElementById('newBtn');
	var historyMenu = document.getElementById('historyMenu');
	var historyMenuContent = document.getElementById('historyMenuContent');
	var modeTrigger = document.getElementById('modeTrigger');
	var modeMenu = document.getElementById('modeMenu');
	var modeMenuContent = document.getElementById('modeMenuContent');
	var attachBtn = document.getElementById('attachBtn');
	var followBtn = document.getElementById('followBtn');
	var attachInput = document.getElementById('attachInput');
	var attachStrip = document.getElementById('attachStrip');
	var fileReferenceStrip = document.getElementById('fileReferenceStrip');
	var capabilityStrip = document.getElementById('capabilityStrip');
	var linkStrip = document.getElementById('linkStrip');

	var openTabs = [];          // [{id,title,...}] abiertas en el strip
	var allSessions = [];       // [{id,title,archived,updatedAt,hasError}] historial completo
	var activeSessionId = '';

	var busy = false;
	var followEnabled = false;
	var assistant = null;       // { wrap, body, raw }
	var reasoning = null;       // { details, think, raw }
	var diagramSeq = 0;         // contador de ids únicos para los <svg> de diagramas (fullscreen los busca por id)
	var tools = {};             // id -> { el, statusEl, resultPre, resultLabel }
	var trays = {};             // todos | terms | files | question -> element
	var fileRows = {};          // path -> row (dentro del files tray)
	var fileIcons = {};         // path -> clases del file icon theme
	var termRows = {};          // id -> row (dentro del terms tray)
	var turnTodosHost = null;   // to-dos unificados al mensaje user del turno activo
	var todosFallback = null;   // to-dos en el hilo cuando no hay turno activo (restore)
	var lastTodoItems = null;
	var session = { provider: '', model: '', connected: false, activeId: '', groups: [], defaultModel: '', effort: '' };
	var ctx = { input: 0, output: 0, used: 0, limit: 0, breakdown: null, capabilities: { tools: 0, mcp: 0, skills: 0 } };
	var attachments = [];       // imágenes adjuntas del composer: {mimeType, data(base64)}
	var fileReferences = [];    // chips @ estructurados: el host adjunta su contenido al turno
	var fileReferenceIcons = {}; // path -> clases del file icon theme
	var composerLinks = [];     // URLs pegadas: chips visibles; se reinsertan completas al enviar
	var mode = 'agent';         // modo del agente: agent | plan | ask | ultra
	var MODES = [
		{ id: 'agent', icon: 'openide-mode-agent', label: 'Agent', desc: 'Edit and run' },
		{ id: 'plan', icon: 'openide-mode-plan', label: 'Plan', desc: 'Read-only planning' },
		{ id: 'ask', icon: 'openide-mode-ask', label: 'Ask', desc: 'Read-only Q&A' },
		{ id: 'ultra', icon: 'rocket', label: 'Ultra', desc: 'Parallel subagents' }
	];

	// prioridad de apilado de trays (menor = más arriba); el composer es la base.
	// terms (bg) arriba de files, de forma integrada: "1 background terminal" → "N Files".
	var TRAY_PRIORITY = { todos: 1, subagents: 1, terms: 2, queue: 3, files: 4, question: 5, approval: 6 };
	var queue = [];             // mensajes encolados: texto + adjuntos/referencias/capabilities/links
	var selectedCapabilities = []; // menciones estructuradas elegidas desde el picker de barra
	var userMsgSeq = 0;         // índice secuencial de mensajes user (para editar/reenviar)

	// Las operaciones de lectura y búsqueda se agrupan en una fase colapsable.
	var exploreActive = 0;
	var exploreGroup = null;
	function ensureExploreGroup() {
		if (exploreGroup) { return exploreGroup; }
		var details = document.createElement('details'); details.className = 'activity-group'; details.open = true;
		var summary = document.createElement('summary');
		summary.innerHTML = '<span class="activity-label shimmer">Exploring</span>' + ic('chevron-right');
		summary.querySelector('.codicon').classList.add('activity-chevron');
		var body = document.createElement('div'); body.className = 'activity-body';
		details.appendChild(summary); details.appendChild(body); appendToFlow(details);
		exploreGroup = { details: details, label: summary.querySelector('.activity-label'), body: body, count: 0, files: 0, searches: 0, other: 0 };
		return exploreGroup;
	}
	function exploredLabel(group) {
		var parts = [];
		if (group.files) { parts.push(group.files + (group.files === 1 ? ' file' : ' files')); }
		if (group.searches) { parts.push(group.searches + (group.searches === 1 ? ' search' : ' searches')); }
		if (group.other) { parts.push(group.other + (group.other === 1 ? ' item' : ' items')); }
		return 'Explored ' + (parts.length ? parts.join(', ') : '0 items');
	}
	function onExploreStart(meta) {
		exploreActive++;
		var group = ensureExploreGroup();
		group.count++;
		if (meta && meta.exploreKind === 'file') { group.files++; }
		else if (meta && meta.exploreKind === 'search') { group.searches++; }
		else { group.other++; }
		group.details.open = true;
		group.label.classList.add('shimmer');
		group.label.textContent = 'Exploring';
		removeGenerating();
	}
	function onExploreEnd() {
		exploreActive = Math.max(0, exploreActive - 1);
		if (exploreGroup && exploreActive === 0) {
			exploreGroup.label.classList.remove('shimmer');
			exploreGroup.label.textContent = exploredLabel(exploreGroup);
		}
	}
	function finalizeExploreGroup() {
		if (!exploreGroup) { return; }
		exploreGroup.label.classList.remove('shimmer');
		exploreGroup.label.textContent = exploredLabel(exploreGroup);
		exploreGroup.details.open = false;
		exploreGroup = null;
		exploreActive = 0;
	}

	var TOOL_META = {
		read_file:          { icon: 'file',     verb: 'Read',              done: 'Read',              key: 'path',    base: true, explore: true, exploreKind: 'file' },
		list_files:         { icon: 'folder',   verb: 'Listed',            done: 'Listed',            key: 'path', explore: true, exploreKind: 'search' },
		search_text:        { icon: 'search',   verb: 'Searched',          done: 'Searched',          key: 'query', explore: true, exploreKind: 'search' },
		find_files:         { icon: 'files',    verb: 'Searched files',    done: 'Searched files',    key: 'pattern', explore: true, exploreKind: 'search' },
		get_diagnostics:    { icon: 'warning',  verb: 'Checked',           done: 'Checked',           key: 'path',    base: true, explore: true, exploreKind: 'file' },
		codebase_search:    { icon: 'symbol-key', verb: 'Searched symbols', done: 'Searched symbols', key: 'query', explore: true, exploreKind: 'search' },
		codebase_explore:   { icon: 'references', verb: 'Explored symbol',  done: 'Explored symbol',  key: 'query', explore: true, exploreKind: 'search' },
		codebase_callers:   { icon: 'type-hierarchy', verb: 'Checked callers', done: 'Checked callers', key: 'symbol', explore: true, exploreKind: 'search' },
		write_file:         { icon: 'file',     verb: 'Writing',           done: 'Wrote',             key: 'path',    base: true },
		edit_file:          { icon: 'file',     verb: 'Editing',           done: 'Edited',            key: 'path',    base: true },
		run_command:        { icon: 'terminal', verb: 'Running',           done: 'Ran',               key: 'command', cmd: true },
		update_todos:       { icon: 'checklist', verb: 'Updating todos',   done: 'Updated todos',     key: '' },
		ask_user:           { icon: 'question', verb: 'Asking',            done: 'Asked',             key: 'question' },
		memory:             { icon: 'database', verb: 'Updating memory',   done: 'Updated memory',    key: '' },
		skill_view:         { icon: 'book',     verb: 'Loading skill',     done: 'Loaded skill',      key: 'name' },
		skill_save:         { icon: 'book',     verb: 'Saving skill',      done: 'Saved skill',       key: 'name' },
		plan_save:          { icon: 'checklist', verb: 'Saving plan',      done: 'Saved plan',        key: 'title' },
		git_status:         { icon: 'git-commit', verb: 'Checking git',   done: 'Checked git',       key: '' },
		git_preflight:      { icon: 'shield',     verb: 'Checking commit', done: 'Commit checked',    key: 'message' },
		git_commit:         { icon: 'git-commit', verb: 'Committing',     done: 'Committed',         key: 'message' },
		git_checkpoint:     { icon: 'git-commit', verb: 'Committing',     done: 'Committed',         key: 'message' },
		review_changes:     { icon: 'shield',     verb: 'Reviewing',       done: 'Reviewed',          key: '' },
		delegate_task:      { icon: 'run-all',  verb: 'Delegating',        done: 'Delegated',         key: '' },
		browser_open:       { icon: 'globe',    verb: 'Opening preview',   done: 'Opened preview',    key: 'url' },
		browser_navigate:   { icon: 'globe',    verb: 'Navigating',        done: 'Navigated',         key: 'url' },
		browser_snapshot:   { icon: 'list-tree', verb: 'Reading snapshot', done: 'Read snapshot',     key: '' },
		browser_screenshot: { icon: 'device-camera', verb: 'Capturing',    done: 'Captured',          key: 'selector' },
		browser_read_dom:   { icon: 'code',     verb: 'Reading DOM',       done: 'Read DOM',          key: 'selector' },
		browser_console:    { icon: 'terminal', verb: 'Reading console',   done: 'Read console',      key: '' },
		browser_click:      { icon: 'inspect',  verb: 'Clicking',          done: 'Clicked',           key: 'selector' },
		browser_type:       { icon: 'edit',     verb: 'Typing',            done: 'Typed',             key: 'selector' },
		browser_evaluate:   { icon: 'code',     verb: 'Evaluating JS',     done: 'Evaluated',         key: 'expression' },
		browser_set_style:  { icon: 'paintcan', verb: 'Applying styles',   done: 'Applied styles',    key: 'selector' },
		browser_playwright: { icon: 'run',      verb: 'Running Playwright', done: 'Ran Playwright',   key: 'code' },
		browser_dialog:     { icon: 'comment-discussion', verb: 'Handling dialog', done: 'Handled dialog', key: '' }
	};
	function toolVisualKind(name) {
		if (String(name || '').indexOf('mcp_') === 0) { return { id: 'mcp', label: 'MCP', icon: 'plug' }; }
		if (String(name || '').indexOf('skill_') === 0) { return { id: 'skill', label: 'Skill', icon: 'book' }; }
		return { id: 'tool', label: 'Tool', icon: 'tools' };
	}

	function ic(name) { return '<span class="codicon codicon-' + name + '"></span>'; }
	function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
	function basename(p) { var s = String(p || '').replace(/[\\\\/]+$/, ''); var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\\\')); return i >= 0 ? s.slice(i + 1) : s; }

	/* Política única de overflow para el chat: toda etiqueta de una línea que realmente se
	   recorta termina en fade. ResizeObserver cubre cambios de dock; MutationObserver cubre
	   filas y texto que llegan por streaming sin acoplar la regla a cada renderer. */
	var OVERFLOW_FADE_SELECTOR = [
		'.msg-edit-model', '.queue-label', '.part-label', '.part-detail', '.part-cmd',
		'.part-explore .part-verb', '.term-title', '.plan-file', '.flatrow > span',
		'.tt-title', '.sub-title', '.sub-model', '.sub-tool-name', '.dock-sub-title',
		'.dock-sub-model', '.menu-label', '.menu-detail', '.tab-title', '.dock-queue-text',
		'.dock-file-name', '.dock-bg-label', '.tray-current', '.approval-summary',
		'#modelTrigger .mname', '#modeTrigger .mname', '#pickChip .pick-sel', '.file-reference-name', '.link-chip-label'
	].join(',');
	var overflowFadeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function (entries) {
		for (var i = 0; i < entries.length; i++) { syncOverflowFade(entries[i].target); }
	}) : null;
	function syncOverflowFade(el) {
		if (!el || !el.classList) { return; }
		var isMarquee = el.matches && el.matches('.tab-title, .tt-title');
		var content = isMarquee ? el.querySelector('.marquee-content') : null;
		var contentWidth = content ? content.scrollWidth : el.scrollWidth;
		var overflow = el.clientWidth > 0 && contentWidth > el.clientWidth + 1;
		el.classList.toggle('fade-overflow', overflow && !isMarquee);
		if (overflow && !isMarquee) {
			var hidden = Math.max(0, contentWidth - el.clientWidth);
			var fadeWidth = Math.max(12, Math.min(42, Math.min(el.clientWidth * 0.18, hidden * 0.72 + 10)));
			el.style.setProperty('--overflow-fade-width', Math.round(fadeWidth) + 'px');
		} else { el.style.removeProperty('--overflow-fade-width'); }
		if (isMarquee) {
			var distance = Math.max(0, Math.ceil(contentWidth - el.clientWidth));
			el.classList.toggle('marquee-active', distance > 1);
			el.style.setProperty('--marquee-offset', (-distance) + 'px');
			el.style.setProperty('--marquee-duration', Math.max(5.5, distance / 28 + 3.5).toFixed(2) + 's');
		}
	}
	function watchOverflowFade(root) {
		if (!root || root.nodeType !== 1) { return; }
		var nodes = [];
		if (root.matches && root.matches(OVERFLOW_FADE_SELECTOR)) { nodes.push(root); }
		if (root.querySelectorAll) { nodes = nodes.concat(Array.from(root.querySelectorAll(OVERFLOW_FADE_SELECTOR))); }
		for (var i = 0; i < nodes.length; i++) {
			if (overflowFadeObserver) { overflowFadeObserver.observe(nodes[i]); }
			syncOverflowFade(nodes[i]);
			requestAnimationFrame((function (node) { return function () { syncOverflowFade(node); }; })(nodes[i]));
		}
	}
	function unwatchOverflowFade(root) {
		if (!overflowFadeObserver || !root || root.nodeType !== 1) { return; }
		if (root.matches && root.matches(OVERFLOW_FADE_SELECTOR)) { overflowFadeObserver.unobserve(root); }
		if (root.querySelectorAll) {
			var nodes = root.querySelectorAll(OVERFLOW_FADE_SELECTOR);
			for (var i = 0; i < nodes.length; i++) { overflowFadeObserver.unobserve(nodes[i]); }
		}
	}
	watchOverflowFade(document.body);
	if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function () { watchOverflowFade(document.body); }); }
	window.addEventListener('resize', function () { watchOverflowFade(document.body); });
	new MutationObserver(function (records) {
		for (var i = 0; i < records.length; i++) {
			if (records[i].type === 'characterData') { watchOverflowFade(records[i].target.parentElement); }
			else {
				for (var j = 0; j < records[i].removedNodes.length; j++) { unwatchOverflowFade(records[i].removedNodes[j]); }
				for (var k = 0; k < records[i].addedNodes.length; k++) { watchOverflowFade(records[i].addedNodes[k]); }
			}
		}
	}).observe(document.body, { childList: true, characterData: true, subtree: true });
	// ---- auto-follow del scroll: seguir la conversación solo si el usuario está al final.
	// Scrollear hacia arriba desengancha (scroll libre); volver al fondo (o el botón
	// "ir al final") re-engancha el modo automático.
	var autoFollow = true;
	var programmaticScroll = false;
	var scrollFollowFrame = 0;
	var jumpBtn = document.getElementById('jumpDown');
	function atBottom() { return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 32; }
	function setFollow(v) {
		if (autoFollow === v) { return; }
		autoFollow = v;
		jumpBtn.classList.toggle('show', !v);
	}
	function scrollDown(force) {
		if (force) { setFollow(true); }
		if (!autoFollow) { return; }
		programmaticScroll = true;
		messagesEl.scrollTop = messagesEl.scrollHeight;
		if (scrollFollowFrame) { cancelAnimationFrame(scrollFollowFrame); }
		scrollFollowFrame = requestAnimationFrame(function () {
			// Imágenes, markdown y cards pueden resolver su altura después del append inicial.
			messagesEl.scrollTop = messagesEl.scrollHeight;
			scrollFollowFrame = requestAnimationFrame(function () {
				scrollFollowFrame = 0;
				programmaticScroll = false;
			});
		});
	}
	messagesEl.addEventListener('scroll', function () {
		if (programmaticScroll) { return; }
		setFollow(atBottom());
	});
	jumpBtn.addEventListener('click', function () { scrollDown(true); });
	// Sigue cambios de altura asíncronos del turno (imagen cargada, diff, todo, markdown
	// incremental). Sin esto el scrollbar podía quedar unos cientos de píxeles antes del final
	// aunque el usuario nunca hubiese desenganchado el auto-follow.
	var flowResizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () {
		if (autoFollow) { scrollDown(); }
	}) : null;
	function watchFlowHeight(el) {
		if (!flowResizeObserver || !el) { return; }
		flowResizeObserver.observe(el.classList && el.classList.contains('turn') ? el : (el.closest && el.closest('.turn')) || el);
	}

	// ---- markdown (sin dependencias, tolerante a streaming) ----
	function inlineMd(s) {
		s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
		s = s.replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>');
		s = s.replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g, '<a href="$2">$1</a>');
		return s;
	}
	function isTableSep(l) { return /^\\s*\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)+\\|?\\s*$/.test(l); }
	function splitRow(l) {
		var t = l.trim().replace(/^\\|/, '').replace(/\\|$/, '');
		return t.split('|').map(function (c) { return c.trim(); });
	}

	/* ---- diagramas: el PARSEO y el LAYOUT viven en el BACKEND (openideDiagramEngine, via
	   host). Aca solo queda el RENDER (SVG/DOM) del resultado — reemplazable sin tocar el motor. ---- */
	// label del nodo: convierte los <br/> a saltos reales (el resto escapado) — antes salían literales
	function diagramLabelHtml(label) {
		return String(label).split(/<br\\s*\\/?>/i).map(function (s) { return escapeHtml(s.trim()); }).join('<br>');
	}
	function diagramShapeSvg(n) {
		var cx = n.x + n.w / 2, cy = n.y + n.h / 2;
		if (n.shape === 'circle') { return '<ellipse class="dnode-shape" cx="' + cx + '" cy="' + cy + '" rx="' + (n.w / 2) + '" ry="' + (n.h / 2) + '"></ellipse>'; }
		if (n.shape === 'diamond') {
			var pts = cx + ',' + n.y + ' ' + (n.x + n.w) + ',' + cy + ' ' + cx + ',' + (n.y + n.h) + ' ' + n.x + ',' + cy;
			return '<polygon class="dnode-shape" points="' + pts + '"></polygon>';
		}
		if (n.shape === 'round') { return '<rect class="dnode-shape" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="' + (n.h / 2) + '" ry="' + (n.h / 2) + '"></rect>'; }
		return '<rect class="dnode-shape" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="2" ry="2"></rect>';
	}
	function renderDiagramSvg(layout, svgId) {
		var defs = '<defs><marker id="' + svgId + '-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="rgba(128,128,128,0.7)"></path></marker></defs>';
		var edgesSvg = '';
		layout.edges.forEach(function (e) {
			var midx = (e.sx + e.tx) / 2, midy = (e.sy + e.ty) / 2, c1x, c1y, c2x, c2y;
			if (layout.horizontal) { c1x = midx; c1y = e.sy; c2x = midx; c2y = e.ty; }
			else { c1x = e.sx; c1y = midy; c2x = e.tx; c2y = midy; }
			var d = 'M' + e.sx + ',' + e.sy + ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + e.tx + ',' + e.ty;
			edgesSvg += '<path class="dedge-path' + (e.dashed ? ' dashed' : '') + '" d="' + d + '" marker-end="url(#' + svgId + '-arrow)"></path>';
			if (e.label) {
				edgesSvg += '<foreignObject x="' + (midx - 60) + '" y="' + (midy - 9) + '" width="120" height="18"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;justify-content:center;pointer-events:none;"><span class="dchip">' + escapeHtml(e.label) + '</span></div></foreignObject>';
			}
		});
		var nodesSvg = '';
		for (var nid in layout.nodes) {
			var n = layout.nodes[nid];
			var innerW = (n.shape === 'diamond' || n.shape === 'circle') ? n.w * 0.62 : n.w;
			var innerH = (n.shape === 'diamond' || n.shape === 'circle') ? n.h * 0.72 : n.h;
			var innerX = n.x + (n.w - innerW) / 2, innerY = n.y + (n.h - innerH) / 2;
			nodesSvg += diagramShapeSvg(n) + '<foreignObject x="' + innerX + '" y="' + innerY + '" width="' + innerW + '" height="' + innerH + '"><div xmlns="http://www.w3.org/1999/xhtml" class="dnode-label">' + diagramLabelHtml(n.label) + '</div></foreignObject>';
		}
		return '<svg id="' + svgId + '" viewBox="0 0 ' + layout.width + ' ' + layout.height + '" width="' + layout.width + '" height="' + layout.height + '" xmlns="http://www.w3.org/2000/svg">' + defs + edgesSvg + nodesSvg + '</svg>';
	}
	/* ---- charts (familia CHART de mermaid: pie · gantt · sequence · timeline) — port del motor
	   propio de ghost (ghost-mermaid-charts.ts + ghost-charts.tsx): parsers a spec tipada y SVG/HTML
	   a mano, monocromo por opacidad (color-mix sobre --vscode-foreground). journey/quadrant/git
	   caen al bloque de código. ---- */
	function fgA(a) { return 'color-mix(in srgb, var(--vscode-foreground) ' + Math.round(a * 100) + '%, transparent)'; }
	function chartRamp(n) {
		var steps = [0.88, 0.55, 0.32, 0.16];
		if (n <= steps.length) { return steps.slice(0, n).map(fgA); }
		var out = [];
		for (var i = 0; i < n; i++) { out.push(fgA(Math.max(0.14, 0.88 - (0.74 * i) / (n - 1)))); }
		return out;
	}
	var CH_GRID = 'rgba(128,128,128,0.16)', CH_AXIS = 'rgba(128,128,128,0.35)', CH_MUTED = 'rgba(128,128,128,0.9)';
	var CH_SOFT = 'rgba(128,128,128,0.12)', CH_MID = 'rgba(128,128,128,0.25)';
	var CH_HATCH_FILL = 'rgba(128,128,128,0.10)', CH_HATCH_INK = 'rgba(128,128,128,0.55)';
	function textWpx(s, px) { return String(s).length * (px || 7); }
	function donutSlice(cx, cy, innerR, outerR, a0, a1) {
		function pt(r, a) { return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }
		var large = a1 - a0 > Math.PI ? 1 : 0;
		var p0 = pt(outerR, a0), p1 = pt(outerR, a1), p2 = pt(innerR, a1), p3 = pt(innerR, a0);
		return 'M ' + p0[0] + ' ' + p0[1] + ' A ' + outerR + ' ' + outerR + ' 0 ' + large + ' 1 ' + p1[0] + ' ' + p1[1] +
			' L ' + p2[0] + ' ' + p2[1] + ' A ' + innerR + ' ' + innerR + ' 0 ' + large + ' 0 ' + p3[0] + ' ' + p3[1] + ' Z';
	}

	var CH_DAY = 86400000;
	function renderPieChartHtml(spec) {
		var total = spec.slices.reduce(function (sum, s) { return sum + s.value; }, 0) || 1;
		var R = 88, INNER = 44, C = 96;
		var ramp = chartRamp(spec.slices.length);
		var angle = 0, paths = '', keys = '';
		spec.slices.forEach(function (s, i) {
			var frac = s.value / total;
			var a0 = angle, a1 = angle + frac * 2 * Math.PI;
			angle = a1;
			var d = frac >= 0.999
				? donutSlice(C, C, INNER, R, 0, Math.PI) + ' ' + donutSlice(C, C, INNER, R, Math.PI, 2 * Math.PI)
				: donutSlice(C, C, INNER, R, a0, a1);
			var tipTxt = escapeHtml(s.label) + ' — ' + s.value + ' · ' + Math.round(frac * 100) + '%';
			paths += '<path d="' + d + '" fill="' + ramp[i] + '" stroke="var(--vscode-editor-background)" stroke-width="2"><title>' + tipTxt + '</title></path>';
			keys += '<div class="chart-key"><span class="chart-swatch" style="background:' + ramp[i] + '"></span><span>' + escapeHtml(s.label) + '</span><span class="chart-key-muted">' + s.value + ' · ' + Math.round(frac * 100) + '%</span></div>';
		});
		var svgId = 'oichart-' + (++diagramSeq);
		return (spec.title ? '<div class="chart-title">' + escapeHtml(spec.title) + '</div>' : '') +
			'<div class="chart-pie-row"><svg id="' + svgId + '" width="' + (2 * C) + '" height="' + (2 * C) + '" viewBox="0 0 ' + (2 * C) + ' ' + (2 * C) + '" xmlns="http://www.w3.org/2000/svg">' + paths + '</svg>' +
			'<div class="chart-keys">' + keys + '</div></div>';
	}

	function renderGanttChartHtml(spec) {
		var tasks = [];
		spec.sections.forEach(function (s) { tasks = tasks.concat(s.tasks); });
		if (!tasks.length) { return undefined; }
		var min = Math.min.apply(null, tasks.map(function (t) { return t.start; }));
		var max = Math.max.apply(null, tasks.map(function (t) { return t.end; }));
		var span = (max - min) || CH_DAY;
		var LABEL_W = 178, LABEL_MAX = 22, CHART_W = 440, ROW_H = 26, TOP = 28;
		function x(ms) { return LABEL_W + ((ms - min) / span) * CHART_W; }
		function fmt(ms) { return new Date(ms).toISOString().slice(5, 10); }
		var hatchId = 'oihatch-' + (++diagramSeq);
		function barFill(status) {
			if (status === 'crit') { return 'url(#' + hatchId + ')'; }
			if (status === 'active') { return fgA(0.85); }
			if (status === 'done') { return 'rgba(128,128,128,0.18)'; }
			return CH_MID;
		}
		var body = '', y = TOP;
		spec.sections.forEach(function (sec) {
			if (sec.name) {
				body += '<text x="4" y="' + (y + 17) + '" fill="' + fgA(0.78) + '" font-size="12" font-weight="600">' + escapeHtml(sec.name) + '</text>';
				y += ROW_H;
			}
			sec.tasks.forEach(function (t) {
				var bx = x(t.start);
				var bw = Math.max(t.milestone ? 0 : 6, x(t.end) - bx);
				var lbl = t.label.length > LABEL_MAX ? t.label.slice(0, LABEL_MAX - 1) + '…' : t.label;
				body += '<text x="' + (LABEL_W - 8) + '" y="' + (y + 17) + '" text-anchor="end" fill="' + fgA(0.78) + '" font-size="12">' + escapeHtml(lbl) + '</text>';
				if (t.milestone) {
					body += '<path d="M ' + bx + ',' + (y + 6) + ' l 7,7 l -7,7 l -7,-7 Z" fill="var(--vscode-focusBorder)"><title>' + escapeHtml(t.label) + ' — ' + fmt(t.start) + '</title></path>';
				} else {
					body += '<rect x="' + bx + '" y="' + (y + 5) + '" width="' + bw + '" height="' + (ROW_H - 10) + '" rx="3" fill="' + barFill(t.status) + '"' +
						(t.status === 'crit' ? ' stroke="' + CH_HATCH_INK + '"' : '') + '><title>' + escapeHtml(t.label) + ' — ' + fmt(t.start) + ' → ' + fmt(t.end) + '</title></rect>';
				}
				y += ROW_H;
			});
		});
		var ticks = '';
		for (var i = 0; i < 5; i++) {
			var ms = min + (span * i) / 4;
			ticks += '<line x1="' + x(ms) + '" y1="' + (TOP - 6) + '" x2="' + x(ms) + '" y2="' + (y + 4) + '" stroke="' + CH_GRID + '" stroke-width="1"></line>' +
				'<text x="' + x(ms) + '" y="' + (TOP - 10) + '" text-anchor="middle" fill="' + CH_MUTED + '" font-size="10.5">' + fmt(ms) + '</text>';
		}
		var W = LABEL_W + CHART_W + 24, H = y + 8;
		var svgId = 'oichart-' + (++diagramSeq);
		return (spec.title ? '<div class="chart-title">' + escapeHtml(spec.title) + '</div>' : '') +
			'<svg id="' + svgId + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
			'<defs><pattern id="' + hatchId + '" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(-45)">' +
			'<rect width="5" height="5" fill="' + CH_HATCH_FILL + '"></rect><line x1="0" y1="0" x2="0" y2="5" stroke="' + CH_HATCH_INK + '" stroke-width="2"></line></pattern></defs>' +
			ticks + body + '</svg>';
	}

	function renderSequenceChartHtml(spec) {
		var parts = spec.participants, events = spec.events;
		var COL_W = 120;
		parts.forEach(function (p) { COL_W = Math.max(COL_W, textWpx(p.label, 8) + 28); });
		var MARGIN = 20, HEAD_H = 34, ROW_H = 38;
		function colX(id) {
			var idx = 0;
			for (var i = 0; i < parts.length; i++) { if (parts[i].id === id) { idx = i; break; } }
			return MARGIN + idx * COL_W + COL_W / 2;
		}
		var ink2 = fgA(0.78);
		var minX = 0, maxX = MARGIN * 2 + parts.length * COL_W;
		function touch(x0, x1) { minX = Math.min(minX, x0); maxX = Math.max(maxX, x1); }
		var layers = [];        // strings; los bloques van al fondo con unshift
		var blockStack = [], actStack = {};
		function pushAct(id, y) { (actStack[id] = actStack[id] || []).push(y); }
		function popAct(id, y) {
			var s = actStack[id];
			var start = s && s.pop();
			if (start !== undefined) {
				var cx = colX(id) + (s ? s.length : 0) * 4;
				layers.push('<rect x="' + (cx - 4) + '" y="' + start + '" width="8" height="' + Math.max(8, y - start) + '" rx="2" fill="' + CH_MID + '" stroke="' + CH_AXIS + '" stroke-width="1"></rect>');
			}
		}
		var y = HEAD_H + 18, num = 1;
		events.forEach(function (e) {
			if (e.type === 'block-start') { blockStack.push({ kind: e.kind, label: e.label, y: y - 10, elses: [] }); y += 26; return; }
			if (e.type === 'block-else') {
				var top = blockStack[blockStack.length - 1];
				if (top) { top.elses.push(y - 8); }
				layers.push('<text x="' + (MARGIN + 8) + '" y="' + (y + 2) + '" fill="' + CH_MUTED + '" font-size="10.5" font-style="italic">[' + escapeHtml(e.label || 'else') + ']</text>');
				y += 18; return;
			}
			if (e.type === 'block-end') {
				var b = blockStack.pop();
				if (b) {
					var bx0 = MARGIN - 6, bx1 = MARGIN + parts.length * COL_W + 6;
					touch(bx0, bx1);
					var blk = '<g><rect x="' + bx0 + '" y="' + b.y + '" width="' + (bx1 - bx0) + '" height="' + (y - b.y + 4) + '" rx="4" fill="none" stroke="' + CH_AXIS + '" stroke-width="1"></rect>' +
						'<rect x="' + bx0 + '" y="' + b.y + '" width="' + (textWpx(b.kind, 6) + 18) + '" height="16" fill="' + CH_SOFT + '"></rect>' +
						'<text x="' + (bx0 + 6) + '" y="' + (b.y + 12) + '" fill="' + ink2 + '" font-size="10.5" font-weight="600">' + escapeHtml(b.kind) + '</text>';
					if (b.label) { blk += '<text x="' + (bx0 + textWpx(b.kind, 6) + 22) + '" y="' + (b.y + 12) + '" fill="' + CH_MUTED + '" font-size="10.5">[' + escapeHtml(b.label) + ']</text>'; }
					b.elses.forEach(function (ey) { blk += '<line x1="' + bx0 + '" y1="' + ey + '" x2="' + bx1 + '" y2="' + ey + '" stroke="' + CH_GRID + '" stroke-dasharray="4 3" stroke-width="1"></line>'; });
					layers.unshift(blk + '</g>');
				}
				y += 8; return;
			}
			if (e.type === 'note') {
				var xs = e.actors.map(colX);
				var cx0 = Math.min.apply(null, xs), cx1 = Math.max.apply(null, xs);
				var w = Math.max(textWpx(e.text, 6.8) + 20, cx1 - cx0 + 60);
				var nx = e.placement === 'left' ? cx0 - w - 10 : e.placement === 'right' ? cx1 + 10 : (cx0 + cx1) / 2 - w / 2;
				touch(nx - 4, nx + w + 4);
				layers.push('<g><rect x="' + nx + '" y="' + (y - 4) + '" width="' + w + '" height="24" rx="3" fill="' + CH_SOFT + '" stroke="' + CH_GRID + '" stroke-width="1"></rect>' +
					'<text x="' + (nx + w / 2) + '" y="' + (y + 11) + '" text-anchor="middle" fill="' + ink2 + '" font-size="11.5">' + escapeHtml(e.text) + '</text></g>');
				y += 34; return;
			}
			// message
			if (e.activate && e.from === e.to && !e.text) { pushAct(e.to, y - 6); return; }
			if (e.deactivate && e.from === e.to && !e.text) { popAct(e.from, y - 6); return; }
			var x1 = colX(e.from), x2 = colX(e.to);
			var label = spec.autonumber ? (num++) + '. ' + e.text : e.text;
			var dash = e.dashed ? ' stroke-dasharray="5 4"' : '';
			if (e.from === e.to) {
				touch(x1, x1 + 46 + textWpx(label, 7.5));
				layers.push('<g><path d="M ' + x1 + ',' + y + ' h 34 v 18 h -30" fill="none" stroke="' + CH_MUTED + '" stroke-width="1.5"' + dash + '></path>' +
					'<polygon points="' + (x1 + 4) + ',' + (y + 18) + ' ' + (x1 + 12) + ',' + (y + 14) + ' ' + (x1 + 12) + ',' + (y + 22) + '" fill="' + CH_MUTED + '"></polygon>' +
					'<text x="' + (x1 + 40) + '" y="' + (y - 2) + '" fill="' + ink2 + '" font-size="12">' + escapeHtml(label) + '</text></g>');
				y += ROW_H + 6;
			} else {
				var dir = x2 > x1 ? 1 : -1;
				touch((x1 + x2) / 2 - textWpx(label, 7.5) / 2 - 4, (x1 + x2) / 2 + textWpx(label, 7.5) / 2 + 4);
				var head;
				if (e.open) {
					head = '<path d="M ' + (x2 - dir * 9) + ',' + (y - 4) + ' L ' + x2 + ',' + y + ' L ' + (x2 - dir * 9) + ',' + (y + 4) + '" fill="none" stroke="' + CH_MUTED + '" stroke-width="1.5"></path>';
				} else {
					head = '<polygon points="' + x2 + ',' + y + ' ' + (x2 - dir * 9) + ',' + (y - 4) + ' ' + (x2 - dir * 9) + ',' + (y + 4) + '" fill="' + CH_MUTED + '"></polygon>';
				}
				layers.push('<g><text x="' + ((x1 + x2) / 2) + '" y="' + (y - 6) + '" text-anchor="middle" fill="' + ink2 + '" font-size="12">' + escapeHtml(label) + '</text>' +
					'<line x1="' + x1 + '" y1="' + y + '" x2="' + (x2 - dir * 2) + '" y2="' + y + '" stroke="' + CH_MUTED + '" stroke-width="1.5"' + dash + '></line>' + head + '</g>');
				if (e.activate) { pushAct(e.to, y); }
				if (e.deactivate) { popAct(e.from, y); }
				y += ROW_H;
			}
		});
		for (var aid in actStack) {
			while (actStack[aid] && actStack[aid].length) { popAct(aid, y); }
		}
		var bottom = y + 8;
		var left = minX - 4;
		var W = maxX + 4 - left, H = bottom + HEAD_H;
		var lifelines = '', heads = '';
		parts.forEach(function (p) {
			var cx = colX(p.id);
			lifelines += '<line x1="' + cx + '" y1="' + HEAD_H + '" x2="' + cx + '" y2="' + bottom + '" stroke="' + CH_GRID + '" stroke-width="1" stroke-dasharray="3 4"></line>';
			[HEAD_H / 2, bottom + HEAD_H / 2].forEach(function (cy) {
				heads += '<g><rect x="' + (cx - COL_W / 2 + 8) + '" y="' + (cy - 12) + '" width="' + (COL_W - 16) + '" height="24" rx="' + (p.actor ? 12 : 2) + '" fill="' + CH_SOFT + '" stroke="' + CH_GRID + '" stroke-width="1"></rect>' +
					'<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" fill="var(--vscode-foreground)" font-size="12" font-weight="500">' + escapeHtml(p.label) + '</text></g>';
			});
		});
		var svgId = 'oichart-' + (++diagramSeq);
		return '<svg id="' + svgId + '" width="' + W + '" height="' + H + '" viewBox="' + left + ' 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' + lifelines + layers.join('') + heads + '</svg>';
	}

	function renderTimelineChartHtml(spec) {
		var html = spec.title ? '<div class="chart-title">' + escapeHtml(spec.title) + '</div>' : '';
		spec.sections.forEach(function (sec) {
			if (sec.name) { html += '<div class="chart-section-name">' + escapeHtml(sec.name) + '</div>'; }
			sec.periods.forEach(function (p) {
				var chips = p.events.map(function (e) { return '<span class="tl-event">' + escapeHtml(e) + '</span>'; }).join('');
				html += '<div class="tl-row"><div class="tl-time">' + escapeHtml(p.time) + '</div>' +
					'<div class="tl-spine"><span class="tl-dot"></span><span class="tl-line"></span></div>' +
					'<div class="tl-events">' + chips + '</div></div>';
			});
		});
		return html;
	}

	// journey: badge de score 1..5 con ramp de opacidad (el dígito lleva la info, no el hue)
	function renderJourneyChartHtml(spec) {
		var steps = [0.18, 0.18, 0.32, 0.5, 0.7, 0.88];
		var html = spec.title ? '<div class="chart-title">' + escapeHtml(spec.title) + '</div>' : '';
		spec.sections.forEach(function (sec) {
			if (sec.name) { html += '<div class="chart-section-name">' + escapeHtml(sec.name) + '</div>'; }
			sec.tasks.forEach(function (t) {
				var s = Math.max(1, Math.min(5, Math.round(t.score)));
				var fg = s >= 4 ? 'var(--vscode-editor-background)' : 'var(--vscode-foreground)';
				html += '<div class="jr-task"><span class="jr-score" style="background:' + fgA(steps[s]) + ';color:' + fg + '">' + s + '</span><span>' + escapeHtml(t.label) + '</span>' +
					(t.actors.length ? '<span class="chart-key-muted">\\u00b7 ' + escapeHtml(t.actors.join(', ')) + '</span>' : '') + '</div>';
			});
		});
		return html;
	}

	function renderQuadrantChartHtml(spec) {
		var QCHAR = 7.2;
		var longest = 0;
		spec.quadrants.forEach(function (q) { longest = Math.max(longest, q.length); });
		var S = Math.min(440, Math.max(300, Math.round(longest * QCHAR * 2) + 40));
		var mid = S / 2;
		var maxChars = Math.max(4, Math.floor((mid - 12) / QCHAR));
		function clip(s) { return s.length > maxChars ? s.slice(0, maxChars - 1) + '\\u2026' : s; }
		var ox = 58, oy = 12;
		function px(x) { return ox + x * S; }
		function py(y) { return oy + (1 - y) * S; }
		var quads = [
			{ x: ox + mid, y: oy, label: spec.quadrants[0], tinted: true },
			{ x: ox, y: oy, label: spec.quadrants[1], tinted: false },
			{ x: ox, y: oy + mid, label: spec.quadrants[2], tinted: true },
			{ x: ox + mid, y: oy + mid, label: spec.quadrants[3], tinted: false }
		];
		var W = ox + S + 16, H = oy + S + 34;
		var ink2 = fgA(0.78);
		var svg = '';
		quads.forEach(function (q) { if (q.tinted) { svg += '<rect x="' + q.x + '" y="' + q.y + '" width="' + mid + '" height="' + mid + '" fill="' + fgA(0.05) + '"></rect>'; } });
		svg += '<rect x="' + ox + '" y="' + oy + '" width="' + S + '" height="' + S + '" fill="none" stroke="' + CH_GRID + '" stroke-width="1"></rect>' +
			'<line x1="' + (ox + mid) + '" y1="' + oy + '" x2="' + (ox + mid) + '" y2="' + (oy + S) + '" stroke="' + CH_GRID + '" stroke-width="1" stroke-dasharray="4 4"></line>' +
			'<line x1="' + ox + '" y1="' + (oy + mid) + '" x2="' + (ox + S) + '" y2="' + (oy + mid) + '" stroke="' + CH_GRID + '" stroke-width="1" stroke-dasharray="4 4"></line>';
		quads.forEach(function (q) {
			if (q.label) { svg += '<text x="' + (q.x + mid / 2) + '" y="' + (q.y + 19) + '" text-anchor="middle" font-size="12" font-weight="500" fill="' + CH_MUTED + '">' + escapeHtml(clip(q.label)) + '</text>'; }
		});
		if (spec.xAxis) {
			svg += '<text x="' + (ox + 2) + '" y="' + (oy + S + 22) + '" font-size="11.5" fill="' + ink2 + '">' + escapeHtml(spec.xAxis[0]) + '</text>' +
				'<text x="' + (ox + S - 2) + '" y="' + (oy + S + 22) + '" text-anchor="end" font-size="11.5" fill="' + ink2 + '">' + escapeHtml(spec.xAxis[1]) + '</text>';
		}
		if (spec.yAxis) {
			svg += '<text x="' + (ox - 16) + '" y="' + (oy + S) + '" font-size="11.5" fill="' + ink2 + '" transform="rotate(-90 ' + (ox - 16) + ' ' + (oy + S) + ')">' + escapeHtml(spec.yAxis[0]) + '</text>' +
				'<text x="' + (ox - 16) + '" y="' + oy + '" text-anchor="end" font-size="11.5" fill="' + ink2 + '" transform="rotate(-90 ' + (ox - 16) + ' ' + oy + ')">' + escapeHtml(spec.yAxis[1]) + '</text>';
		}
		spec.points.forEach(function (p) {
			var flip = p.x > 0.5;
			svg += '<g><circle cx="' + px(p.x) + '" cy="' + py(p.y) + '" r="5" fill="var(--vscode-focusBorder)"><title>' + escapeHtml(p.label) + ' \\u2014 x ' + p.x + ' \\u00b7 y ' + p.y + '</title></circle>' +
				'<text x="' + (px(p.x) + (flip ? -9 : 9)) + '" y="' + (py(p.y) + 4) + '" text-anchor="' + (flip ? 'end' : 'start') + '" font-size="12" fill="var(--vscode-foreground)">' + escapeHtml(p.label) + '</text></g>';
		});
		var svgId = 'oichart-' + (++diagramSeq);
		return (spec.title ? '<div class="chart-title">' + escapeHtml(spec.title) + '</div>' : '') +
			'<svg id="' + svgId + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>';
	}

	function renderGitChartHtml(spec) {
		var branches = spec.branches, commits = spec.commits;
		var ramp = chartRamp(Math.max(branches.length, 1));
		function laneOf(b) { return Math.max(0, branches.indexOf(b)); }
		var COL = 56, ROW = 52, TAG_H = 17, TAG_GAP = 4, TAG_CLEAR = 10;
		var START_X = 64;
		branches.forEach(function (b) { START_X = Math.max(START_X, Math.round(b.length * 7) + 26); });
		var byId = {};
		commits.forEach(function (c) { byId[c.id] = c; });
		function colOf(c) { return START_X + c.x * COL; }
		function color(b) { return ramp[laneOf(b) % ramp.length]; }
		// stack de tags por lane (greedy): cada tag toma el primer nivel donde no pisa al anterior
		var tags = [], levelRight = {};
		commits.forEach(function (c) {
			if (!c.tag) { return; }
			var w = textWpx(c.tag, 6.6) + 12;
			var x0 = colOf(c) - w / 2;
			var levels = levelRight[c.branch] || (levelRight[c.branch] = []);
			var level = 0;
			while (level < levels.length && x0 < levels[level] + 8) { level++; }
			levels[level] = x0 + w;
			tags.push({ commit: c, cx: colOf(c), w: w, level: level });
		});
		var lane0Stack = 0;
		tags.forEach(function (t) { if (laneOf(t.commit.branch) === 0) { lane0Stack = Math.max(lane0Stack, t.level + 1); } });
		var TOP = Math.max(24, TAG_CLEAR + lane0Stack * (TAG_H + TAG_GAP) + 8);
		function cy(c) { return TOP + laneOf(c.branch) * ROW; }
		function tagY(t) { return cy(t.commit) - TAG_CLEAR - (t.level + 1) * (TAG_H + TAG_GAP) + TAG_GAP; }
		var maxX = 0;
		commits.forEach(function (c) { maxX = Math.max(maxX, c.x); });
		var left = 0, right = START_X + maxX * COL + 26;
		tags.forEach(function (t) { left = Math.min(left, t.cx - t.w / 2 - 6); right = Math.max(right, t.cx + t.w / 2 + 6); });
		var W = right - left, H = TOP + (branches.length - 1) * ROW + 26;
		var svg = '';
		branches.forEach(function (b, i) {
			var xs = commits.filter(function (c) { return c.branch === b; }).map(function (c) { return c.x; });
			var y = TOP + i * ROW;
			if (xs.length) {
				var mn = Math.min.apply(null, xs), mx = Math.max.apply(null, xs);
				svg += '<line x1="' + (START_X + mn * COL) + '" y1="' + y + '" x2="' + (START_X + mx * COL) + '" y2="' + y + '" stroke="' + color(b) + '" stroke-width="2.5" opacity="0.28" stroke-linecap="round"></line>';
			}
			svg += '<text x="' + (START_X - 14) + '" y="' + (y + 4) + '" text-anchor="end" font-size="12" font-weight="500" fill="' + color(b) + '">' + escapeHtml(b) + '</text>';
		});
		commits.forEach(function (c) {
			c.parents.forEach(function (pid) {
				var p = byId[pid];
				if (!p) { return; }
				var x1 = colOf(p), y1 = cy(p), x2 = colOf(c), y2 = cy(c);
				var d = y1 === y2 ? 'M ' + x1 + ',' + y1 + ' L ' + x2 + ',' + y2
					: 'M ' + x1 + ',' + y1 + ' C ' + (x1 + COL * 0.55) + ',' + y1 + ' ' + (x2 - COL * 0.55) + ',' + y2 + ' ' + x2 + ',' + y2;
				svg += '<path d="' + d + '" fill="none" stroke="' + color(c.branch) + '" stroke-width="2" opacity="0.65"></path>';
			});
		});
		commits.forEach(function (c) {
			svg += '<g><circle cx="' + colOf(c) + '" cy="' + cy(c) + '" r="' + (c.highlight ? 9 : 6.5) + '" fill="' + color(c.branch) + '" stroke="var(--vscode-editor-background)" stroke-width="3"><title>' + escapeHtml(c.id + (c.tag ? ' \\u2014 ' + c.tag : '')) + '</title></circle>' +
				(c.parents.length >= 2 ? '<circle cx="' + colOf(c) + '" cy="' + cy(c) + '" r="2.5" fill="var(--vscode-editor-background)"></circle>' : '') + '</g>';
		});
		tags.forEach(function (t) {
			svg += '<line x1="' + t.cx + '" y1="' + (tagY(t) + TAG_H) + '" x2="' + t.cx + '" y2="' + (cy(t.commit) - (t.commit.highlight ? 9 : 6.5) - 2) + '" stroke="' + CH_GRID + '" stroke-width="1"></line>';
		});
		tags.forEach(function (t) {
			svg += '<g><rect x="' + (t.cx - t.w / 2) + '" y="' + tagY(t) + '" width="' + t.w + '" height="' + TAG_H + '" rx="2" fill="' + CH_SOFT + '" stroke="' + CH_GRID + '" stroke-width="1"></rect>' +
				'<text x="' + t.cx + '" y="' + (tagY(t) + 12) + '" text-anchor="middle" font-size="11" fill="' + fgA(0.78) + '">' + escapeHtml(t.commit.tag) + '</text></g>';
		});
		var svgId = 'oichart-' + (++diagramSeq);
		return '<svg id="' + svgId + '" width="' + W + '" height="' + H + '" viewBox="' + left + ' 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>';
	}

	function renderChartHtml(spec) {
		var inner, fullscreen = false;
		if (spec.kind === 'pie') { inner = renderPieChartHtml(spec); fullscreen = true; }
		else if (spec.kind === 'gantt') { inner = renderGanttChartHtml(spec); fullscreen = true; }
		else if (spec.kind === 'sequence') { inner = renderSequenceChartHtml(spec); fullscreen = true; }
		else if (spec.kind === 'timeline') { inner = renderTimelineChartHtml(spec); }
		else if (spec.kind === 'journey') { inner = renderJourneyChartHtml(spec); }
		else if (spec.kind === 'quadrant') { inner = renderQuadrantChartHtml(spec); fullscreen = true; }
		else if (spec.kind === 'git') { inner = renderGitChartHtml(spec); fullscreen = true; }
		if (!inner) { return undefined; }
		var btn = '';
		if (fullscreen) {
			var idm = /id="(oichart-\\d+)"/.exec(inner);
			if (idm) { btn = '<button class="diagram-full" data-svg-id="' + idm[1] + '" data-tip="Pantalla completa (modal con zoom)">' + ic('screen-full') + '</button>'; }
		}
		return '<div class="diagram chart">' + btn + '<div class="diagram-scroll">' + inner + '</div></div>';
	}

	/* ---- syntax highlighting (regex, monocromo: comments/strings/keywords/números) ---- */
	var HL_KEYWORDS = {
		js: 'abstract|any|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|private|protected|public|readonly|return|set|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|with|yield',
		py: 'False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|self|try|while|with|yield',
		sh: 'case|cd|do|done|echo|elif|else|esac|exit|export|fi|for|function|if|in|local|return|set|source|then|while',
		clike: 'auto|bool|break|case|catch|char|class|const|continue|default|delete|do|double|else|enum|extern|false|final|float|fn|for|func|go|if|impl|import|int|interface|let|long|match|mut|namespace|new|nil|null|override|package|private|protected|pub|public|return|self|short|signed|sizeof|static|struct|super|switch|template|this|throw|true|try|typedef|union|unsigned|use|var|virtual|void|while',
		json: 'true|false|null',
		css: '',
		sql: 'ALTER|AND|AS|ASC|BETWEEN|BY|CASE|CREATE|DELETE|DESC|DISTINCT|DROP|ELSE|END|EXISTS|FROM|GROUP|HAVING|IN|INDEX|INNER|INSERT|INTO|IS|JOIN|LEFT|LIKE|LIMIT|NOT|NULL|ON|OR|ORDER|OUTER|RIGHT|SELECT|SET|TABLE|THEN|UNION|UPDATE|VALUES|WHEN|WHERE|WITH|alter|and|as|asc|between|by|case|create|delete|desc|distinct|drop|else|end|exists|from|group|having|in|index|inner|insert|into|is|join|left|like|limit|not|null|on|or|order|outer|right|select|set|table|then|union|update|values|when|where|with'
	};
	function hlFamily(lang) {
		if (/^(js|jsx|ts|tsx|javascript|typescript|mjs|cjs)$/.test(lang)) { return { kw: HL_KEYWORDS.js, hash: false }; }
		if (/^(py|python)$/.test(lang)) { return { kw: HL_KEYWORDS.py, hash: true }; }
		if (/^(sh|bash|shell|zsh|fish|console)$/.test(lang)) { return { kw: HL_KEYWORDS.sh, hash: true }; }
		if (/^(c|h|cpp|cc|hpp|cs|csharp|java|go|rust|rs|swift|kt|kotlin|php|scala)$/.test(lang)) { return { kw: HL_KEYWORDS.clike, hash: false }; }
		if (/^(json|jsonc)$/.test(lang)) { return { kw: HL_KEYWORDS.json, hash: false }; }
		if (/^(yaml|yml|toml|ini|ruby|rb|r|nix|makefile|dockerfile|conf|properties)$/.test(lang)) { return { kw: '', hash: true }; }
		if (/^(sql)$/.test(lang)) { return { kw: HL_KEYWORDS.sql, hash: true }; }
		if (/^(css|scss|less)$/.test(lang)) { return { kw: '', hash: false }; }
		return undefined;
	}
	function highlightCode(code, lang) {
		var fam = hlFamily(String(lang || '').trim().toLowerCase());
		if (!fam) { return escapeHtml(code); }
		// fase 1: separar comments / strings / números del resto
		var re = fam.hash
			? /(#[^\\n]*)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|(\\b\\d[\\w.]*\\b)/g
			: /(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d[\\w.]*\\b)/g;
		var kwRe = fam.kw ? new RegExp('\\\\b(' + fam.kw + ')\\\\b', 'g') : undefined;
		function plain(seg) {
			var esc = escapeHtml(seg);
			return kwRe ? esc.replace(kwRe, '<span class="hl-kw">$1</span>') : esc;
		}
		var out = '', last = 0, m;
		while ((m = re.exec(code))) {
			out += plain(code.slice(last, m.index));
			if (m[1] !== undefined) { out += '<span class="hl-com">' + escapeHtml(m[1]) + '</span>'; }
			else if (m[2] !== undefined) { out += '<span class="hl-str">' + escapeHtml(m[2]) + '</span>'; }
			else { out += '<span class="hl-num">' + escapeHtml(m[3]) + '</span>'; }
			last = m.index + m[0].length;
		}
		out += plain(code.slice(last));
		return out;
	}
	function appendHighlightedCode(target, code, lang) {
		var fam = hlFamily(String(lang || '').trim().toLowerCase());
		if (!fam) { target.textContent = code; return; }
		var re = fam.hash
			? /(#[^\\n]*)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|(\\b\\d[\\w.]*\\b)/g
			: /(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d[\\w.]*\\b)/g;
		var kwRe = fam.kw ? new RegExp('\\\\b(' + fam.kw + ')\\\\b', 'g') : null;
		function token(cls, text) {
			var span = document.createElement('span');
			span.className = cls;
			span.textContent = text;
			target.appendChild(span);
		}
		function plain(text) {
			if (!kwRe) { target.appendChild(document.createTextNode(text)); return; }
			kwRe.lastIndex = 0;
			var start = 0, match;
			while ((match = kwRe.exec(text))) {
				if (match.index > start) { target.appendChild(document.createTextNode(text.slice(start, match.index))); }
				token('hl-kw', match[0]);
				start = match.index + match[0].length;
			}
			if (start < text.length) { target.appendChild(document.createTextNode(text.slice(start))); }
		}
		var last = 0, match;
		while ((match = re.exec(code))) {
			plain(code.slice(last, match.index));
			if (match[1] !== undefined) { token('hl-com', match[1]); }
			else if (match[2] !== undefined) { token('hl-str', match[2]); }
			else { token('hl-num', match[3]); }
			last = match.index + match[0].length;
		}
		plain(code.slice(last));
	}

	// El parseo/layout es del BACKEND: mandamos la fuente al host (una vez por fence, cacheado)
	// y renderizamos cuando vuelve el spec. Mientras tanto: placeholder de "generando".
	var diagCache = {};          // source -> { key, html? }
	var diagByKey = {};          // key -> entrada del cache (incluye source)
	var diagKeySeq = 0;
	function codeBlockHtml(code, lang) {
		return '<div class="codewrap"><button class="copy" data-copy="' + encodeURIComponent(code) + '">' + ic('copy') + 'copiar</button><pre class="code"><code>' + highlightCode(code, lang) + '</code></pre></div>';
	}
	function renderDiagramResult(result) {
		try {
			if (result && result.family === 'graph' && result.layout) {
				var svgId = 'oidiag-' + (++diagramSeq);
				var svg = renderDiagramSvg(result.layout, svgId);
				return '<div class="diagram"><button class="diagram-full" data-svg-id="' + svgId + '" data-tip="Pantalla completa (modal con zoom)">' + ic('screen-full') + '</button><div class="diagram-scroll">' + svg + '</div></div>';
			}
			if (result && result.family === 'chart' && result.spec) {
				return renderChartHtml(result.spec);
			}
		} catch (e) { /* resultado malformado: cae al code block */ }
		return undefined;
	}
	function buildDiagramOrCodeHtml(info, code) {
		var lang = (info || '').trim().toLowerCase();
		if (lang === 'mermaid' || lang === 'flowchart' || lang === 'diagram') {
			var entry = diagCache[code];
			if (entry && entry.html) { return entry.html; }
			if (!entry) {
				entry = { key: 'dg' + (++diagKeySeq), source: code, lang: lang };
				diagCache[code] = entry;
				diagByKey[entry.key] = entry;
				vscode.postMessage({ type: 'parseDiagram', key: entry.key, source: code });
			}
			return '<div class="diagram-pending" data-diag-key="' + entry.key + '"><span class="shimmer">Generando diagrama\u2026</span></div>';
		}
		return codeBlockHtml(code, lang);
	}
	// Respuesta del motor: renderizar y reemplazar los placeholders vivos de ese fence.
	function applyDiagramResult(key, result) {
		var entry = diagByKey[key];
		if (!entry) { return; }
		entry.html = renderDiagramResult(result) || codeBlockHtml(entry.source, entry.lang);
		var pending = messagesEl.querySelectorAll('[data-diag-key="' + key + '"]');
		for (var i = 0; i < pending.length; i++) {
			var holder = document.createElement('div');
			holder.innerHTML = entry.html;
			var node = holder.firstChild;
			// mantener __oiSrc en sync con lo que renderizaría el próximo patchMarkdown
			// (buildDiagramOrCodeHtml ya devuelve entry.html) para no re-crear el SVG.
			node.__oiSrc = entry.html;
			pending[i].replaceWith(node);
		}
		if (pending.length) { scrollDown(); }
	}

	// Devuelve el markdown renderizado como ARRAY de bloques html top-level (un elemento
	// por bloque). patchMarkdown() usa esa granularidad para re-renderizar SOLO los bloques
	// que cambiaron durante el streaming (los diagramas/SVG/tablas ya estables no se tocan
	// → sin parpadeo). renderMarkdown() los junta para el render completo (restore, etc.).
	function renderMarkdown(src) { return renderMarkdownBlocks(src).join('\\n'); }
	function renderMarkdownBlocks(src) {
		var codeBlocks = [], inlineCodes = [], pendingDiagram = '';
		// fence \`\`\`mermaid sin cerrar todavía (streaming): placeholder en vez de texto crudo.
		var fenceCount = (src.match(/\`\`\`/g) || []).length;
		if (fenceCount % 2 === 1) {
			var openIdx = src.lastIndexOf('\`\`\`');
			var fenceHead = src.slice(0, openIdx);
			var fenceTail = src.slice(openIdx + 3);
			var infoMatch = /^([^\\n]*)\\n?/.exec(fenceTail);
			var infoStr = infoMatch ? infoMatch[1].trim().toLowerCase() : '';
			if (infoStr === 'mermaid' || infoStr === 'flowchart' || infoStr === 'diagram') {
				src = fenceHead;
				pendingDiagram = '<div class="diagram-pending"><span class="shimmer">Generando diagrama…</span></div>';
			}
		}
		src = src.replace(/\`\`\`([^\\n]*)\\n([\\s\\S]*?)\`\`\`/g, function (_m, info, code) {
			codeBlocks.push({ info: info, code: code }); return '\\u0001B' + (codeBlocks.length - 1) + '\\u0002';
		});
		src = src.replace(/\`([^\`\\n]+)\`/g, function (_m, c) {
			inlineCodes.push(c); return '\\u0001I' + (inlineCodes.length - 1) + '\\u0002';
		});
		var text = escapeHtml(src);
		var lines = text.split('\\n');
		var out = [], i = 0;
		function isBlank(l) { return /^\\s*$/.test(l); }
		function isCodePh(l) { return /^\\u0001B\\d+\\u0002$/.test(l.trim()); }
		while (i < lines.length) {
			var line = lines[i];
			if (isCodePh(line)) { out.push(line.trim()); i++; continue; }
			if (isBlank(line)) { i++; continue; }
			// tabla: fila con | seguida de fila separadora
			if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
				var head = splitRow(line); i += 2;
				var rows = [];
				while (i < lines.length && lines[i].indexOf('|') >= 0 && !isBlank(lines[i])) { rows.push(splitRow(lines[i])); i++; }
				var th = head.map(function (c) { return '<th>' + inlineMd(c) + '</th>'; }).join('');
				var body = rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inlineMd(c) + '</td>'; }).join('') + '</tr>'; }).join('');
				out.push('<table><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>'); continue;
			}
			var h = line.match(/^(#{1,6})\\s+(.*)$/);
			if (h) { var n = h[1].length; out.push('<h' + n + '>' + inlineMd(h[2]) + '</h' + n + '>'); i++; continue; }
			if (/^\\s*(---|\\*\\*\\*|___)\\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
			if (/^\\s*[-*+]\\s+/.test(line)) {
				var ul = [];
				while (i < lines.length && /^\\s*[-*+]\\s+/.test(lines[i])) { ul.push('<li>' + inlineMd(lines[i].replace(/^\\s*[-*+]\\s+/, '')) + '</li>'); i++; }
				out.push('<ul>' + ul.join('') + '</ul>'); continue;
			}
			if (/^\\s*\\d+\\.\\s+/.test(line)) {
				var ol = [];
				while (i < lines.length && /^\\s*\\d+\\.\\s+/.test(lines[i])) { ol.push('<li>' + inlineMd(lines[i].replace(/^\\s*\\d+\\.\\s+/, '')) + '</li>'); i++; }
				out.push('<ol>' + ol.join('') + '</ol>'); continue;
			}
			if (/^\\s*>\\s?/.test(line)) {
				var q = [];
				while (i < lines.length && /^\\s*>\\s?/.test(lines[i])) { q.push(inlineMd(lines[i].replace(/^\\s*>\\s?/, ''))); i++; }
				out.push('<blockquote>' + q.join('<br>') + '</blockquote>'); continue;
			}
			var para = [];
			while (i < lines.length && !isBlank(lines[i]) && !isCodePh(lines[i]) && !/^(#{1,6})\\s/.test(lines[i]) && !/^\\s*[-*+]\\s+/.test(lines[i]) && !/^\\s*\\d+\\.\\s+/.test(lines[i]) && !/^\\s*>\\s?/.test(lines[i]) && !(lines[i].indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
				para.push(lines[i]); i++;
			}
			out.push('<p>' + inlineMd(para.join('<br>')) + '</p>');
		}
		var blocks = out.map(function (b) {
			b = b.replace(/\\u0001B(\\d+)\\u0002/g, function (_m, k) {
				var blk = codeBlocks[+k] || { info: '', code: '' };
				return buildDiagramOrCodeHtml(blk.info, blk.code);
			});
			b = b.replace(/\\u0001I(\\d+)\\u0002/g, function (_m, k) {
				return '<code class="inline">' + escapeHtml(inlineCodes[+k] || '') + '</code>';
			});
			return b;
		});
		if (pendingDiagram) { blocks.push(pendingDiagram); }
		return blocks;
	}

	// ---- thread ----
	// Turno actual (contenedor .turn): el contenido del run (assistant, tools, subagentes,
	// errores) se appendea al turno del último mensaje user para que el pin sticky funcione.
	var currentTurn = null;
	function appendToFlow(el) { (currentTurn || messagesEl).appendChild(el); watchFlowHeight(currentTurn ? currentTurn.parentElement : el); }
	var activeMessageEditor = null;
	function openMessageEditor(wrap, text, images, userIndex, capabilities, messageId, turnMode, turnProvider, turnModel) {
		if (wrap.classList.contains('editing')) { return; }
		if (activeMessageEditor) { activeMessageEditor.cancel(); }
		var original = Array.prototype.slice.call(wrap.childNodes);
		var localImages = (images || []).map(function (img) { return { mimeType: img.mimeType, data: img.data }; });
		var input = document.createElement('textarea'); input.className = 'msg-edit-input'; input.value = text;
		input.setAttribute('aria-label', 'Editar mensaje');
		var imageStrip = document.createElement('div'); imageStrip.className = 'msg-edit-attachments';
		var footer = document.createElement('div'); footer.className = 'msg-edit-footer';
		var editMode = turnMode || mode;
		var editProvider = turnProvider || session.activeId || session.provider || '';
		var editModel = turnModel || session.model || session.defaultModel || '';
		var modeMeta = document.createElement('span'); modeMeta.className = 'msg-edit-meta';
		var modePick = document.createElement('button'); modePick.type = 'button'; modePick.className = 'msg-edit-picker'; modePick.setAttribute('aria-expanded', 'false');
		var modePopup = document.createElement('div'); modePopup.className = 'menu'; modePopup.hidden = true;
		var modePopupContent = document.createElement('div'); modePopupContent.className = 'menu-content'; modePopup.appendChild(modePopupContent);
		modeMeta.appendChild(modePick); modeMeta.appendChild(modePopup);
		var modelMeta = document.createElement('span'); modelMeta.className = 'msg-edit-meta msg-edit-model';
		var modelPick = document.createElement('button'); modelPick.type = 'button'; modelPick.className = 'msg-edit-picker'; modelPick.setAttribute('aria-expanded', 'false');
		var modelPopup = document.createElement('div'); modelPopup.className = 'menu msg-edit-model-popup'; modelPopup.hidden = true;
		var modelPopupContent = document.createElement('div'); modelPopupContent.className = 'menu-content'; modelPopup.appendChild(modelPopupContent);
		modelMeta.appendChild(modelPick); modelMeta.appendChild(modelPopup);
		function paintEditMode() { var meta = modeById(editMode); modePick.innerHTML = ic(meta.icon) + '<span class="msg-edit-picker-label"></span>' + ic('chevron-down'); modePick.querySelector('.msg-edit-picker-label').textContent = meta.label; }
		function paintEditModel() { modelPick.innerHTML = '<span class="msg-edit-picker-label"></span>' + ic('chevron-down'); modelPick.querySelector('.msg-edit-picker-label').textContent = editModel || modelTrigger.querySelector('.mname').textContent || 'Modelo'; }
		function closeEditPopups() { modePopup.hidden = true; modelPopup.hidden = true; modePick.setAttribute('aria-expanded', 'false'); modelPick.setAttribute('aria-expanded', 'false'); }
		function placeEditPopup(popup, trigger) {
			popup.style.left = ''; popup.style.right = ''; popup.style.top = ''; popup.style.bottom = '';
			var triggerRect = trigger.getBoundingClientRect();
			var margin = 8;
			var width = Math.min(popup.classList.contains('msg-edit-model-popup') ? 320 : 270, window.innerWidth - margin * 2);
			popup.style.width = width + 'px';
			var availableAbove = triggerRect.top - margin;
			var availableBelow = window.innerHeight - triggerRect.bottom - margin;
			var maxHeight = Math.max(140, Math.min(420, Math.max(availableAbove, availableBelow)));
			popup.style.maxHeight = maxHeight + 'px';
			popup.style.left = Math.max(margin, Math.min(triggerRect.left, window.innerWidth - width - margin)) + 'px';
			// Preferir arriba como el composer inferior; si no entra, desplegar hacia abajo.
			if (availableAbove >= Math.min(240, popup.scrollHeight) || availableAbove >= availableBelow) {
				popup.style.bottom = (window.innerHeight - triggerRect.top + 6) + 'px';
			} else {
				popup.style.top = (triggerRect.bottom + 6) + 'px';
			}
		}
		function buildEditModes() { modePopupContent.innerHTML = ''; MODES.forEach(function (entry) { var row = document.createElement('button'); row.type = 'button'; row.className = 'menu-row'; row.innerHTML = '<span class="menu-row-icon">' + (entry.id === editMode ? ic('check') : ic(entry.icon)) + '</span><span class="menu-label"></span>'; row.querySelector('.menu-label').textContent = entry.label; row.addEventListener('click', function (event) { event.stopPropagation(); editMode = entry.id; paintEditMode(); closeEditPopups(); }); modePopupContent.appendChild(row); }); }
		function buildEditModels() { modelPopupContent.innerHTML = ''; (session.groups || []).forEach(function (group) { var models = group.models || []; if (!models.length) { return; } var section = document.createElement('div'); section.className = 'menu-section'; section.textContent = group.label; modelPopupContent.appendChild(section); models.forEach(function (candidate) { var row = document.createElement('button'); row.type = 'button'; row.className = 'menu-row'; var selected = group.id === editProvider && candidate === editModel; row.innerHTML = '<span class="menu-row-icon">' + (selected ? ic('check') : '') + '</span><span class="menu-label"></span>'; row.querySelector('.menu-label').textContent = candidate; row.addEventListener('click', function (event) { event.stopPropagation(); editProvider = group.id; editModel = candidate; paintEditModel(); closeEditPopups(); }); modelPopupContent.appendChild(row); }); }); if (!modelPopupContent.childElementCount) { var empty = document.createElement('div'); empty.className = 'menu-empty'; empty.textContent = 'Sin proveedores conectados'; modelPopupContent.appendChild(empty); } }
		modePick.addEventListener('click', function (event) { event.stopPropagation(); modelPopup.hidden = true; buildEditModes(); modePopup.hidden = !modePopup.hidden; modePick.setAttribute('aria-expanded', String(!modePopup.hidden)); if (!modePopup.hidden) { placeEditPopup(modePopup, modePick); } });
		modelPick.addEventListener('click', function (event) { event.stopPropagation(); modePopup.hidden = true; buildEditModels(); modelPopup.hidden = !modelPopup.hidden; modelPick.setAttribute('aria-expanded', String(!modelPopup.hidden)); if (!modelPopup.hidden) { placeEditPopup(modelPopup, modelPick); } });
		paintEditMode(); paintEditModel();
		var spacer = document.createElement('span'); spacer.className = 'msg-edit-spacer';
		var attach = document.createElement('button'); attach.className = 'msg-edit-btn'; attach.type = 'button'; attach.setAttribute('data-tip', 'Agregar imagen'); attach.innerHTML = ic('attach');
		var picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/png,image/jpeg,image/gif,image/webp'; picker.multiple = true; picker.hidden = true;
		var submit = document.createElement('button'); submit.className = 'msg-edit-btn send'; submit.type = 'button'; submit.setAttribute('data-tip', 'Reenviar desde aquí'); submit.innerHTML = ic('arrow-up');
		footer.appendChild(modeMeta); footer.appendChild(modelMeta); footer.appendChild(spacer); footer.appendChild(attach); footer.appendChild(picker); footer.appendChild(submit);
		function resize() {
			input.style.height = 'auto';
			input.style.height = Math.min(260, Math.max(78, input.scrollHeight)) + 'px';
			submit.disabled = !input.value.trim() && !localImages.length;
		}
		function renderImages() {
			imageStrip.innerHTML = '';
			localImages.forEach(function (img, index) {
				var chip = document.createElement('div'); chip.className = 'msg-edit-attachment';
				var preview = document.createElement('img'); preview.src = 'data:' + img.mimeType + ';base64,' + img.data;
				preview.addEventListener('click', function () { openImagePreview(preview.src); });
				var remove = document.createElement('button'); remove.className = 'msg-edit-remove'; remove.type = 'button'; remove.innerHTML = ic('close');
				remove.addEventListener('click', function () { localImages.splice(index, 1); renderImages(); });
				chip.appendChild(preview); chip.appendChild(remove); imageStrip.appendChild(chip);
			});
			resize();
		}
		function addFile(file) {
			if (!file || !/^image\\/(png|jpeg|gif|webp)$/.test(file.type) || localImages.length >= 6) { return; }
			var reader = new FileReader();
			reader.onload = function () {
				var url = String(reader.result || ''); var comma = url.indexOf(',');
				if (comma < 0) { return; }
				localImages.push({ mimeType: file.type, data: url.slice(comma + 1) });
				renderImages();
			};
			reader.readAsDataURL(file);
		}
		function cancel() {
			closeEditPopups();
			wrap.classList.remove('editing');
			wrap.replaceChildren.apply(wrap, original);
			var restoredText = wrap.querySelector('.msg-text');
			if (restoredText && restoredText.scrollHeight > 78) { restoredText.classList.add('collapsed', 'faded'); }
			if (activeMessageEditor && activeMessageEditor.wrap === wrap) { activeMessageEditor = null; }
		}
		function resend() {
			var edited = input.value.trim();
			if (!edited && !localImages.length) { return; }
			submit.disabled = true; input.disabled = true;
			vscode.postMessage({ type: 'editAndResend', messageId: messageId || '', userIndex: userIndex, text: edited, images: localImages, mode: editMode, providerId: editProvider, model: editModel, capabilities: capabilities || [] });
		}
		wrap.classList.add('editing');
		wrap.replaceChildren(input, imageStrip, footer);
		activeMessageEditor = { wrap: wrap, cancel: cancel };
		attach.addEventListener('click', function () { picker.click(); });
		picker.addEventListener('change', function () {
			var files = picker.files || [];
			for (var i = 0; i < files.length; i++) { addFile(files[i]); }
			picker.value = '';
		});
		input.addEventListener('input', resize);
		input.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); resend(); }
		});
		input.addEventListener('paste', function (e) {
			var items = (e.clipboardData && e.clipboardData.items) || []; var gotImage = false;
			for (var i = 0; i < items.length; i++) {
				if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) {
					var file = items[i].getAsFile(); if (file) { addFile(file); gotImage = true; }
				}
			}
			if (gotImage) { e.preventDefault(); }
		});
		input.addEventListener('dragover', function (e) { e.preventDefault(); });
		input.addEventListener('drop', function (e) {
			e.preventDefault();
			var files = (e.dataTransfer && e.dataTransfer.files) || [];
			for (var i = 0; i < files.length; i++) { addFile(files[i]); }
		});
		submit.addEventListener('click', resend);
		renderImages(); resize();
		// Cerca del siguiente turno el prompt estaba sticky y quedaba parcialmente tapado. Al
		// entrar en edición, centrar suavemente el editor completo dentro del viewport.
		requestAnimationFrame(function () { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
	}
	function capabilityIcon(kind) {
		return kind === 'skill' ? 'sparkle' : kind === 'command' ? 'terminal' : kind === 'mcp' ? 'plug' : 'tools';
	}
	function capabilityText(text, capabilities) {
		var body = String(text || '').trimStart();
		(capabilities || []).forEach(function (capability) {
			var prefix = '/' + capability.name;
			if (body === prefix) { body = ''; }
			else if (body.indexOf(prefix + ' ') === 0) { body = body.slice(prefix.length).trimStart(); }
		});
		return body;
	}
	function appendCapabilityChip(host, capability, removable, removeAt) {
		var chip = document.createElement('span'); chip.className = 'capability-chip ' + capability.kind;
		chip.innerHTML = ic(capabilityIcon(capability.kind)) + '<span class="capability-name"></span>';
		chip.querySelector('.capability-name').textContent = '/' + capability.name;
		chip.title = (capability.kind === 'mcp' ? 'MCP' : capability.kind.charAt(0).toUpperCase() + capability.kind.slice(1)) + ': ' + capability.name;
		if (removable) {
			var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'capability-remove'; remove.innerHTML = ic('close');
			remove.setAttribute('data-tip', 'Quitar');
			remove.addEventListener('click', function () { removeAt(); });
			chip.appendChild(remove);
		}
		host.appendChild(chip);
	}
	function renderCapabilityChips() {
		capabilityStrip.innerHTML = '';
		capabilityStrip.hidden = !selectedCapabilities.length;
		selectedCapabilities.forEach(function (capability, index) {
			appendCapabilityChip(capabilityStrip, capability, true, function () {
				selectedCapabilities.splice(index, 1); renderCapabilityChips(); updateSendEnabled(); promptEl.focus();
			});
		});
	}
	function normalizeComposerLink(raw) {
		var candidate = String(raw || '').trim();
		var suffix = '';
		var trailing = candidate.match(/[),.;!?]+$/);
		if (trailing) { suffix = trailing[0]; candidate = candidate.slice(0, -suffix.length); }
		if (/^www\\./i.test(candidate)) { candidate = 'https://' + candidate; }
		try {
			var parsed = new URL(candidate);
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return null; }
			return { url: parsed.href, suffix: suffix };
		} catch (e) { return null; }
	}
	function extractComposerLinks(text) {
		var links = [];
		var body = String(text || '').replace(/(?:https?:\\/\\/|www\\.)[^\\s<>"']+/gi, function (raw, offset, source) {
			// Un URL dentro de código/markup (xmlns="…", href="…") no es un link adjunto:
			// se conserva para no dejar atributos vacíos al pegar SVG o HTML.
			var before = String(source || '').slice(0, Number(offset) || 0);
			if (/[A-Za-z_:][-A-Za-z0-9_:.]*\\s*=\\s*["']?$/.test(before)) { return raw; }
			var parsed = normalizeComposerLink(raw);
			if (!parsed) { return raw; }
			if (links.indexOf(parsed.url) < 0) { links.push(parsed.url); }
			return parsed.suffix;
		});
		body = body.replace(/[ \\t]{2,}/g, ' ').replace(/ *\\n */g, '\\n');
		return { text: body, links: links };
	}
	function linkLabel(url) {
		try {
			var parsed = new URL(url);
			var tail = (parsed.pathname === '/' ? '' : parsed.pathname) + parsed.search + parsed.hash;
			return parsed.hostname + tail;
		} catch (e) { return String(url || '').replace(/^https?:\\/\\//i, ''); }
	}
	function appendLinkChip(host, url, removable, removeAt) {
		var chip = document.createElement('span'); chip.className = 'link-chip'; chip.setAttribute('data-tip', url);
		chip.innerHTML = ic('link') + '<span class="link-chip-label"></span>';
		chip.querySelector('.link-chip-label').textContent = linkLabel(url);
		if (removable) {
			var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'link-chip-remove'; remove.innerHTML = ic('close');
			remove.setAttribute('data-tip', 'Quitar link');
			remove.addEventListener('click', function (event) { event.stopPropagation(); removeAt(); });
			chip.appendChild(remove);
		}
		host.appendChild(chip); watchOverflowFade(chip);
	}
	function renderLinkChips() {
		linkStrip.innerHTML = '';
		linkStrip.hidden = !composerLinks.length;
		composerLinks.forEach(function (url, index) {
			appendLinkChip(linkStrip, url, true, function () {
				composerLinks.splice(index, 1); renderLinkChips(); updateSendEnabled(); promptEl.focus();
			});
		});
	}
	function hydrateComposerLinks(text) {
		var parsed = extractComposerLinks(text);
		composerLinks = parsed.links.slice();
		promptEl.value = parsed.text.trim();
		renderLinkChips();
	}
	function addComposerLinks(links) {
		(links || []).forEach(function (url) {
			if (composerLinks.indexOf(url) < 0) { composerLinks.push(url); }
		});
		renderLinkChips();
	}
	function harvestPromptLinks() {
		var parsed = extractComposerLinks(promptEl.value);
		if (!parsed.links.length) { return; }
		promptEl.value = parsed.text.trim();
		addComposerLinks(parsed.links);
		autosize();
	}
	function addUser(text, images, capabilities, links, messageId, turnMode, turnProvider, turnModel) {
		var wrap = document.createElement('div'); wrap.className = 'msg user';
		var mentions = Array.isArray(capabilities) ? capabilities : [];
		var urls = Array.isArray(links) ? links : [];
		if (mentions.length) {
			var capabilityRow = document.createElement('div'); capabilityRow.className = 'msg-capabilities';
			mentions.forEach(function (capability) { appendCapabilityChip(capabilityRow, capability, false, function () { }); });
			wrap.appendChild(capabilityRow);
		}
		if (urls.length) {
			var linkRow = document.createElement('div'); linkRow.className = 'msg-links';
			urls.forEach(function (url) { appendLinkChip(linkRow, url, false, function () { }); });
			wrap.appendChild(linkRow);
		}
		var t = document.createElement('div'); t.className = 'msg-text';
		var bodyText = capabilityText(text, mentions);
		t.textContent = bodyText;
		if (bodyText) { wrap.appendChild(t); }
		if (images && images.length) {
			var strip = document.createElement('div'); strip.className = 'msg-imgs';
			images.forEach(function (img) {
				var b = document.createElement('button'); b.className = 'msg-img'; b.type = 'button'; b.title = 'Ver imagen';
				var im = document.createElement('img'); im.src = 'data:' + img.mimeType + ';base64,' + img.data;
				b.appendChild(im); strip.appendChild(b);
			});
			wrap.appendChild(strip);
		}
		var uidx = userMsgSeq++;
		var actions = document.createElement('div'); actions.className = 'msg-actions';
		// única acción, estilo ghost (codicon-discard): VOLVER acá — trunca la historia desde
		// este mensaje y deja el texto en el composer para editar y reenviar.
		var back = document.createElement('button'); back.className = 'msg-action'; back.type = 'button';
		back.setAttribute('data-tip', 'Volver acá (editar y reenviar desde este punto)');
		back.innerHTML = ic('discard');
		back.addEventListener('click', function (event) {
			event.stopPropagation();
			if (!messageId || back.disabled) { return; }
			back.disabled = true;
			var requestId = 'rollback-' + Date.now() + '-' + Math.random().toString(36).slice(2);
			back.setAttribute('data-rollback-request', requestId);
			vscode.postMessage({ type: 'rollback', requestId: requestId, messageId: messageId, userIndex: uidx });
		});
		actions.appendChild(back);
		wrap.appendChild(actions);
		wrap.addEventListener('click', function (e) {
			if (e.target.closest('button, input, textarea') || wrap.classList.contains('editing')) { return; }
			// Frenar la propagación: el handler "click afuera" del document cancelaría el editor
			// recién abierto, porque replaceChildren() desconecta el target original del DOM.
			e.stopPropagation();
			openMessageEditor(wrap, [bodyText].concat(urls).filter(Boolean).join('\\n'), images, uidx, mentions, messageId, turnMode || mode, turnProvider || session.activeId || session.provider || '', turnModel || session.model || session.defaultModel || '');
		});
		// Turno nuevo (conversacional): mensaje user + to-dos en un solo contenedor pineado.
		var turn = document.createElement('div'); turn.className = 'turn';
		var pin = document.createElement('div'); pin.className = 'turn-pin';
		var shell = document.createElement('div'); shell.className = 'turn-composer';
		shell.appendChild(wrap);
		var todosHost = document.createElement('div'); todosHost.className = 'turn-todos'; todosHost.setAttribute('data-expanded', '0'); todosHost.hidden = true;
		shell.appendChild(todosHost);
		turnTodosHost = todosHost;
		pin.appendChild(shell);
		var tbody = document.createElement('div'); tbody.className = 'turn-body';
		turn.appendChild(pin);
		turn.appendChild(tbody);
		messagesEl.appendChild(turn);
		watchFlowHeight(turn);
		currentTurn = tbody;
		// clamp a ~3 líneas si es largo
		if (bodyText && t.scrollHeight > 78) {
			t.classList.add('collapsed', 'faded');
			t.addEventListener('click', function () { t.classList.remove('collapsed', 'faded'); });
		}
		scrollDown(true); // mandar un mensaje re-engancha el auto-follow
	}
	function ensureAssistant() {
		if (assistant) { return assistant; }
		var wrap = document.createElement('div'); wrap.className = 'msg assistant';
		var b = document.createElement('div'); b.className = 'body';
		wrap.appendChild(b); appendToFlow(wrap);
		assistant = { wrap: wrap, body: b, raw: '' };
		return assistant;
	}
	// Render incremental: compara el html de cada bloque con el que ya está en el DOM
	// (guardado en __oiSrc) y solo reemplaza los que cambiaron — el streaming solo muta
	// la cola, así que los bloques previos (diagramas, tablas, código) quedan intactos.
	function patchMarkdown(body, blocks) {
		for (var i = 0; i < blocks.length; i++) {
			var el = body.children[i];
			if (el && el.__oiSrc === blocks[i]) { continue; }
			var tmp = document.createElement('div');
			tmp.innerHTML = blocks[i];
			var node = tmp.children.length === 1 ? tmp.firstElementChild : tmp;
			node.__oiSrc = blocks[i];
			if (el) { el.replaceWith(node); } else { body.appendChild(node); }
		}
		while (body.children.length > blocks.length) { body.removeChild(body.lastElementChild); }
	}
	function appendText(delta) {
		if (reasoning) { finalizeReasoning(); }
		finalizeExploreGroup();
		removeGenerating();
		var a = ensureAssistant();
		a.raw += delta;
		patchMarkdown(a.body, renderMarkdownBlocks(a.raw));
		scrollDown();
	}
	function appendReasoning(delta) {
		removeGenerating();
		if (!reasoning) {
			var d = document.createElement('details'); d.className = 'reasoning'; d.open = true;
			var s = document.createElement('summary');
			s.innerHTML = '<span class="reasoning-label shimmer">Thinking</span>' + ic('chevron-right');
			s.querySelector('.codicon').classList.add('reasoning-chevron');
			var t = document.createElement('div'); t.className = 'think';
			d.appendChild(s); d.appendChild(t); appendToFlow(d);
			reasoning = { details: d, think: t, raw: '', start: Date.now() };
		}
		reasoning.raw += delta; reasoning.think.textContent = reasoning.raw;
		reasoning.think.scrollTop = reasoning.think.scrollHeight; scrollDown();
	}
	// Cierra el bloque de razonamiento activo: quita el shimmer y pone el tiempo total ("Razonó Ns").
	function finalizeReasoning() {
		if (reasoning && reasoning.start) {
			var secs = Math.max(1, Math.round((Date.now() - reasoning.start) / 1000));
			var label = reasoning.details.querySelector('.reasoning-label');
			if (label) { label.classList.remove('shimmer'); label.textContent = secs < 2 ? 'Thought briefly' : ('Thought for ' + secs + 's'); }
			reasoning.details.open = false;
		}
		reasoning = null;
	}
	// ---- placeholder "Generando" (entre turnos del modelo: antes del 1er token y entre tools) ----
	var generatingEl = null;
	function ensureGenerating() {
		if (!busy) { return; }
		removeGenerating();
		generatingEl = document.createElement('div'); generatingEl.className = 'gen-row';
		generatingEl.innerHTML = '<span class="shimmer">Planning next moves</span>';
		appendToFlow(generatingEl); scrollDown();
	}
	function removeGenerating() {
		if (generatingEl) { generatingEl.remove(); generatingEl = null; }
	}

	function detailFor(meta, args) {
		if (!meta || !meta.key || !args) { return ''; }
		var v = '';
		var o = null;
		try { o = JSON.parse(args); v = o[meta.key]; }
		catch (e) {
			var m = args.match(new RegExp('"' + meta.key + '"\\\\s*:\\\\s*"((?:[^"\\\\\\\\]|\\\\\\\\.)*)"'));
			if (m) { v = m[1].replace(/\\\\"/g, '"'); }
		}
		if (v == null) { return ''; }
		var s = String(v);
		if (meta.key === 'path' && o) {
			var loc = '';
			if (o.start_line != null) { loc = ' L' + o.start_line + (o.end_line != null ? ('-' + o.end_line) : ''); }
			else if (o.offset != null) { loc = ' L' + o.offset; }
			// devolver el PATH COMPLETO (relativo al workspace): openDiff/resolveUri lo necesitan.
			// El label de la card usa basename() aparte; acá basename rompía docs/DESIGN.md → DESIGN.md.
			return s + loc;
		}
		return s;
	}
	function parseToolArguments(args) {
		if (!args) { return {}; }
		try { return JSON.parse(args) || {}; } catch (e) { return {}; }
	}
	/* Cursor presenta la actividad como una única frase compacta. Para rutas mostramos el
	   basename (el path completo sigue disponible en el tooltip) y mantenemos Lx-y junto al
	   nombre; grep/glob/símbolos conservan su query en esa misma fila. */
	function compactExploreDetail(meta, detail) {
		var value = String(detail || '');
		if (!value || !meta || meta.key !== 'path') { return value; }
		var match = value.match(/^(.*?)(\\s+L\\d+(?:-\\d+)?)$/);
		var path = match ? match[1] : value;
		var range = match ? match[2] : '';
		return basename(path) + range;
	}
	function resultLineCount(result) {
		var value = String(result || '').replace(/\\n?…\\(truncado\\)$/, '');
		return value ? value.split(/\\r?\\n/).length : 0;
	}
	function finalizeExploreLine(tool, result, isError) {
		if (!tool || !tool.explore || !tool.verbEl || isError || tool.name !== 'read_file') { return; }
		var args = tool.argsObject || {};
		var path = String(args.path || tool.detail || '').replace(/\\s+L\\d+(?:-\\d+)?$/, '');
		var count = resultLineCount(result);
		if (!path || !count || /^Error:/.test(String(result || ''))) { return; }
		var requestedStart = Number(args.start_line);
		var start = Number.isFinite(requestedStart) && requestedStart > 0 ? Math.floor(requestedStart) : 1;
		var end = start + count - 1;
		var range = ' L' + start + (end !== start ? ('-' + end) : '');
		tool.verbEl.textContent = 'Read ' + basename(path) + range;
		tool.verbEl.title = path + range;
	}
	/* ---- terminal embebida del chat (run_command foreground, integrado): card colapsable
	   con título + menú ⋯, output streameado en vivo (evento terminalData) y línea de input
	   que escribe al pty mientras el comando corre ---- */
	var openTermMenu = null;
	function closeTermMenu() { if (openTermMenu) { openTermMenu.hidden = true; openTermMenu = null; } }
	function addTermCard(id, po) {
		assistant = null; finalizeReasoning(); finalizeExploreGroup(); removeGenerating();
		// background y background_persistent viven en el dock/tray; no hay card inline con stdin.
		var bg = !!(po.background || po.background_persistent);
		if (bg) {
			// Long-running background: tray only (backgroundTerminal event) — no inline card.
			tools[id] = {
				el: null, statusEl: null, verbEl: null, titleEl: null, meta: TOOL_META.run_command,
				resultPre: null, resultLabel: null, head: null, body: null, detail: String(po.command || ''),
				edit: false, card: false,
				term: { bg: true, cmd: String(po.command || ''), dock: !!po.background_persistent },
			};
			return;
		}
		var el = document.createElement('div'); el.className = 'part term-card open' + (bg ? '' : ' running');
		var head = document.createElement('button'); head.className = 'part-head'; head.type = 'button';
		var st = document.createElement('span'); st.className = 'part-status'; st.style.display = 'none';
		var glyph = document.createElement('span'); glyph.className = 'term-glyph'; glyph.innerHTML = ic('chevron-down');
		var title = document.createElement('span'); title.className = 'term-title shimmer';
		title.textContent = String(po.command || po.description || '');
		if (po.description) { title.setAttribute('data-tip', String(po.command || '')); }
		var sp = document.createElement('span'); sp.style.flex = '1';
		var anchor = document.createElement('span'); anchor.className = 'anchor';
		var dots = document.createElement('button'); dots.className = 'term-dots'; dots.type = 'button';
		dots.innerHTML = ic('ellipsis'); dots.setAttribute('data-tip', 'Command options');
		var menu = document.createElement('div'); menu.className = 'menu term-menu'; menu.hidden = true;
		var mc = document.createElement('div'); mc.className = 'menu-content'; menu.appendChild(mc);
		anchor.appendChild(dots); anchor.appendChild(menu);
		head.appendChild(st); head.appendChild(glyph); head.appendChild(title); head.appendChild(sp); head.appendChild(anchor);
		var body = document.createElement('div'); body.className = 'part-body';
		var out = document.createElement('div'); out.className = 'term-out';
		var cmdLine = document.createElement('div'); cmdLine.className = 'term-line cmd';
		var dollar = document.createElement('span'); dollar.className = 'term-dollar'; dollar.textContent = '$';
		var cmdText = document.createElement('span'); cmdText.textContent = String(po.command || '');
		cmdLine.appendChild(dollar); cmdLine.appendChild(cmdText);
		var live = document.createElement('div'); live.className = 'term-line';
		out.appendChild(cmdLine); out.appendChild(live);
		var inRow = document.createElement('div'); inRow.className = 'term-in';
		var caret = document.createElement('span'); caret.className = 'term-caret'; caret.textContent = '>';
		var input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Escribir en la terminal\\u2026'; input.spellcheck = false;
		inRow.appendChild(caret); inRow.appendChild(input);
		body.appendChild(out);
		if (!bg) { body.appendChild(inRow); } // background: no hay stdin (corre en el panel)
		el.appendChild(head); el.appendChild(body);
		head.addEventListener('click', function (e) {
			if (e.target.closest && (e.target.closest('.term-dots') || e.target.closest('.term-menu'))) { return; }
			var opened = el.classList.toggle('open');
			glyph.innerHTML = opened ? ic('chevron-down') : ic('terminal');
		});
		dots.addEventListener('click', function (e) {
			e.stopPropagation();
			if (!menu.hidden) { closeTermMenu(); return; }
			closeMenus(); closeTermMenu();
			buildTermMenu(mc, String(po.command || ''));
			menu.hidden = false; openTermMenu = menu;
		});
		input.addEventListener('keydown', function (ev) {
			if (ev.key === 'Enter') {
				ev.preventDefault(); ev.stopPropagation();
				vscode.postMessage({ type: 'termWrite', data: input.value });
				input.value = '';
			}
		});
		input.addEventListener('click', function (ev) { ev.stopPropagation(); });
		// A running foreground command belongs to the conversation flow. Background commands
		// already have their single canonical representation in the background terminal tray.
		appendToFlow(el); scrollDown();
		tools[id] = {
			el: el, statusEl: st, verbEl: null, titleEl: title, meta: TOOL_META.run_command, resultPre: null, resultLabel: null,
			head: head, body: body, detail: String(po.command || ''), edit: false, card: false,
			term: { out: out, live: live, input: input, streamed: false, bg: bg, cmd: String(po.command || '') },
		};
	}
	function buildTermMenu(mc, command) {
		mc.innerHTML = '';
		var copy = document.createElement('button'); copy.className = 'menu-row'; copy.type = 'button';
		copy.innerHTML = '<span class="menu-row-icon">' + ic('copy') + '</span><span class="menu-label">Copiar comando</span>';
		copy.addEventListener('click', function (e) { e.stopPropagation(); try { navigator.clipboard.writeText(command); } catch (err) { } closeTermMenu(); });
		mc.appendChild(copy);
		// Mueve la terminal oculta del agente al panel/dock del IDE (sigue viva y con foco).
		var toPanel = document.createElement('button'); toPanel.className = 'menu-row'; toPanel.type = 'button';
		toPanel.innerHTML = '<span class="menu-row-icon">' + ic('terminal') + '</span><span class="menu-label">Enviar al panel</span>';
		toPanel.setAttribute('data-tip', 'Mostrar esta terminal en el panel del IDE');
		toPanel.addEventListener('click', function (e) {
			e.stopPropagation();
			vscode.postMessage({ type: 'termToPanel' });
			closeTermMenu();
		});
		mc.appendChild(toPanel);
		var sep = document.createElement('div'); sep.className = 'menu-sep'; mc.appendChild(sep);
		var sec = document.createElement('div'); sec.className = 'menu-section'; sec.textContent = 'Auto-Run'; mc.appendChild(sec);
		var cur = session.permission || 'ask';
		PERMISSIONS.forEach(function (p) {
			var row = document.createElement('button'); row.className = 'menu-row'; row.type = 'button';
			row.innerHTML = '<span class="menu-row-icon">' + (p[0] === cur ? ic('check') : ic(p[2])) + '</span><span class="menu-label"></span>';
			row.querySelector('.menu-label').textContent = p[1];
			row.setAttribute('data-tip', p[3]);
			row.addEventListener('click', function (e) {
				e.stopPropagation(); session.permission = p[0];
				vscode.postMessage({ type: 'setPermission', mode: p[0] });
				closeTermMenu();
			});
			mc.appendChild(row);
		});
	}
	function feedTermCard(id, data) {
		var t = tools[id];
		if (!t || !t.term) { return; }
		t.term.streamed = true;
		var parts = String(data).replace(/\\r\\n/g, '\\n').split('\\n');
		for (var i = 0; i < parts.length; i++) {
			var seg = parts[i];
			var cr = seg.lastIndexOf('\\r');
			if (cr >= 0) { t.term.live.textContent = ''; seg = seg.slice(cr + 1); } // \\r pisa la línea en curso (progreso)
			if (seg) { t.term.live.textContent += seg; }
			if (i < parts.length - 1) {
				var done = document.createElement('div'); done.className = 'term-line';
				done.textContent = t.term.live.textContent;
				t.term.out.insertBefore(done, t.term.live);
				t.term.live.textContent = '';
			}
		}
		while (t.term.out.children.length > 400) { t.term.out.removeChild(t.term.out.firstChild); }
		t.term.out.scrollTop = t.term.out.scrollHeight;
	}
	function finishTermCard(t, result, isError) {
		var text = String(result || '');
		// awaiting-input: el proceso sigue vivo esperando y/N — la card queda abierta con stdin.
		if (!isError && text.indexOf('awaiting-input') === 0) {
			t.el.classList.add('running');
			t.el.classList.add('awaiting-input');
			t.el.classList.add('open');
			if (t.titleEl) { t.titleEl.classList.remove('shimmer'); }
			t.statusEl.innerHTML = ''; t.statusEl.style.display = 'none';
			var glyphA = t.head.querySelector('.term-glyph');
			if (glyphA) { glyphA.innerHTML = ic('chevron-down'); }
			if (!t.term.streamed) {
				var aLines = text.split('\\n').slice(1); // saltear el prefijo awaiting-input
				var aMax = Math.min(aLines.length, 200);
				for (var ai = 0; ai < aMax; ai++) {
					if (!aLines[ai]) { continue; }
					var aLine = document.createElement('div'); aLine.className = 'term-line';
					aLine.textContent = aLines[ai];
					t.term.out.insertBefore(aLine, t.term.live);
				}
			}
			t.term.out.scrollTop = t.term.out.scrollHeight;
			return;
		}
		t.el.classList.remove('running');
		t.el.classList.remove('awaiting-input');
		if (t.titleEl) { t.titleEl.classList.remove('shimmer'); }
		if (isError) { t.statusEl.innerHTML = ic('error'); t.el.classList.add('error'); }
		else { t.statusEl.innerHTML = ''; t.statusEl.style.display = 'none'; }
		if (t.term.bg) {
			var glyph = t.head.querySelector('.term-glyph');
			t.el.classList.remove('open'); if (glyph) { glyph.innerHTML = ic('terminal'); }
		}
		if (!t.term.streamed && result) {
			var lines = String(result).split('\\n');
			if (!isError && lines.length && lines[0].indexOf('exit code:') === 0) { lines.shift(); }
			var max = Math.min(lines.length, 200);
			for (var i = 0; i < max; i++) {
				var ln = document.createElement('div'); ln.className = 'term-line';
				ln.textContent = lines[i];
				t.term.out.insertBefore(ln, t.term.live);
			}
			t.term.out.scrollTop = t.term.out.scrollHeight;
		}
	}
	function finishRunningTermCards() {
		Object.keys(tools).forEach(function (id) {
			var t = tools[id];
			if (!t || !t.term || t.term.bg || !t.el || !t.el.classList.contains('running')) { return; }
			finishTermCard(t, '', false);
		});
	}

	/* card de captura de pantalla inline (browser_screenshot/navigate): header + imagen
	   clickeable (zoom en el visor). El base64 no se persiste → solo en vivo. */
	function renderScreenshot(m) {
		if (!m.data) { return; }
		assistant = null; finalizeReasoning(); removeGenerating();
		var src = 'data:' + (m.mimeType || 'image/png') + ';base64,' + m.data;
		var card = document.createElement('div'); card.className = 'shot-card';
		var head = document.createElement('div'); head.className = 'shot-head';
		head.innerHTML = ic('device-camera') + '<span>Captura</span>';
		var body = document.createElement('button'); body.className = 'shot-body'; body.type = 'button';
		body.setAttribute('data-tip', 'Ampliar');
		var img = document.createElement('img'); img.src = src; img.alt = 'Captura de pantalla';
		body.appendChild(img);
		body.addEventListener('click', function () { openImagePreview(src); });
		card.appendChild(head); card.appendChild(body);
		appendToFlow(card); scrollDown();
	}

	function addTool(id, name, args, restoring) {
		// update_todos tiene dos representaciones propias: estado compacto bajo el prompt y
		// snapshot en el transcript. Evitamos sumar además la fila genérica "Updated todos".
		if (name === 'update_todos') {
			tools[id] = { todo: true };
			return;
		}
		// Estas tools ya cuentan con un componente de dominio más rico en el transcript.
		if (name === 'ask_user') { tools[id] = { ask: true }; return; }
		if (name === 'delegate_task' || name === 'review_changes') {
			var delegationTool = ensureDelegation(id, 0);
			tools[id] = { delegation: true, parentId: id, args: args, group: delegationTool };
			return;
		}
		// run_command (foreground O background) → terminal embebida (card integrado). El
		// foreground streamea + tiene stdin; el background muestra la nota de inicio (su salida
		// vive en la terminal de fondo del panel, accesible desde el tray de terminales).
		if (name === 'run_command') {
			var po = null;
			try { po = JSON.parse(args || '{}'); } catch (e2) { po = null; }
			if (po && po.command) { addTermCard(id, po); return; }
		}
		assistant = null; finalizeReasoning(); removeGenerating();
		var meta = TOOL_META[name] || { icon: 'tools', verb: name, key: '' };
		var argsObject = parseToolArguments(args);
		var detail = detailFor(meta, args);
		var isExplore = !!meta.explore;
		var isEdit = name === 'edit_file' || name === 'write_file';
		if (isExplore) { onExploreStart(meta); }
		else { finalizeExploreGroup(); }

		// Edit card integrado: desde el primer momento es UNA sola card con icono + filename
		// (shimmer en el nombre mientras escribe). No hay fila "Writing path…" aparte.
		if (isEdit) {
			var path = detail || '';
			// detailFor puede traer "path L10-20": el openDiff quiere solo el path.
			var pathOnly = path.replace(/\\s+L\\d+(-\\d+)?$/, '');
			var el = document.createElement('div'); el.className = 'part edit-card';
			var head = document.createElement('button'); head.className = 'part-head'; head.type = 'button';
			var iconEl = document.createElement('span');
			applyFileThemeIcon(iconEl, pathOnly);
			var label = document.createElement('span'); label.className = 'part-label shimmer';
			label.textContent = pathOnly ? basename(pathOnly) : (name === 'write_file' ? 'Creating file…' : 'Editing file…');
			if (pathOnly) { label.title = pathOnly; }
			var stats = document.createElement('span'); stats.className = 'edit-stats';
			head.appendChild(iconEl); head.appendChild(label); head.appendChild(stats);
			head.addEventListener('click', function () {
				if (pathOnly) { vscode.postMessage({ type: 'openDiff', path: pathOnly }); }
			});
			var body = document.createElement('div'); body.className = 'part-body';
			var resultPre = document.createElement('pre'); resultPre.className = 'part-pre'; resultPre.style.display = 'none';
			var rl = document.createElement('div'); rl.className = 'part-label2'; rl.textContent = 'Resultado'; rl.style.display = 'none';
			body.appendChild(rl); body.appendChild(resultPre);
			el.appendChild(head); el.appendChild(body);
			appendToFlow(el); scrollDown();
			tools[id] = {
				el: el, statusEl: null, verbEl: label, meta: meta, resultPre: resultPre, resultLabel: rl,
				head: head, body: body, detail: detail, explore: false,
				edit: true, card: true, labelEl: label, iconEl: iconEl, statsEl: stats, editPath: pathOnly,
				running: !restoring, pendingDiff: null,
			};
			editToolIds.push(id);
			return;
		}

		var visualKind = toolVisualKind(name);
		var el = document.createElement('div'); el.className = 'part tool-activity tool-kind-' + visualKind.id + (isExplore ? ' part-explore' : '');
		var head = document.createElement('button'); head.className = 'part-head'; head.type = 'button';
		var activityIcon = document.createElement('span'); activityIcon.className = 'part-icon'; activityIcon.innerHTML = ic(meta.icon || visualKind.icon);
		var st = document.createElement('span'); st.className = 'part-status'; st.style.display = 'none';
		var verb = document.createElement('span'); verb.className = 'part-verb shimmer';
		head.appendChild(activityIcon);
		if (isExplore) {
			var compactDetail = compactExploreDetail(meta, detail);
			var line = meta.verb + (compactDetail ? ' ' + compactDetail : '');
			verb.textContent = line;
			verb.title = meta.verb + (detail ? ' ' + detail : '');
			head.appendChild(verb);
		} else {
			verb.textContent = meta.verb;
			head.appendChild(verb);
			if (detail) {
				if (meta.cmd) { var c = document.createElement('span'); c.className = 'part-cmd'; c.textContent = detail; head.appendChild(c); }
				else { var s2 = document.createElement('span'); s2.className = 'part-detail'; s2.textContent = detail; head.appendChild(s2); }
			}
		}
		var sp = document.createElement('span'); sp.className = 'part-spacer'; head.appendChild(sp);
		head.appendChild(st);
		var tg = null;
		if (!isExplore) {
			tg = document.createElement('span'); tg.className = 'part-chevron'; tg.innerHTML = ic('chevron-right'); head.appendChild(tg);
		}
		var body = document.createElement('div'); body.className = 'part-body';
		// Los argumentos operacionales no se duplican en el transcript; el modelo conserva el payload completo.
		var resultPre = document.createElement('pre'); resultPre.className = 'part-pre'; resultPre.style.display = 'none';
		var rl = document.createElement('div'); rl.className = 'part-label2'; rl.textContent = 'Resultado'; rl.style.display = 'none';
		body.appendChild(rl); body.appendChild(resultPre);
		el.appendChild(head); el.appendChild(body);
		if (tg) {
			head.addEventListener('click', function () {
				if (el.classList.contains('edit-card')) { return; }
				el.classList.toggle('open');
				tg.innerHTML = el.classList.contains('open') ? ic('chevron-down') : ic('chevron-right');
			});
		}
		if (isExplore && exploreGroup) { exploreGroup.body.appendChild(el); }
		else { appendToFlow(el); }
		scrollDown();
		tools[id] = {
			el: el, statusEl: st, verbEl: verb, meta: meta, resultPre: resultPre, resultLabel: rl,
			head: head, body: body, detail: detail, explore: isExplore, name: name, argsObject: argsObject,
			edit: false, card: false,
		};
	}

	/* ---- fila de reintento (rate limit): una sola, con countdown, se saca al retomar ---- */
	var retryEl = null;
	var retryTimer = null;
	function renderRetry(m) {
		removeGenerating();
		removeRetry();
		var el = document.createElement('div'); el.className = 'flatrow notice retry-row';
		el.innerHTML = ic('warning') + '<div class="notice-body"><div class="notice-title">Advertencia del proveedor</div><div class="notice-msg"></div><div class="notice-count"></div></div>';
		var label = m.kind === 'rate-limit' ? 'Rate limit del proveedor' : 'Error transitorio del proveedor';
		el.querySelector('.notice-msg').textContent = label + ' \\u2014 reintento ' + m.attempt + ' de ' + m.max;
		var count = el.querySelector('.notice-count');
		var left = Math.max(1, Math.round((m.delayMs || 1000) / 1000));
		function tick() {
			if (left > 0) { count.textContent = 'en ' + left + 's\\u2026'; left--; }
			else { count.textContent = 'reintentando\\u2026'; if (retryTimer) { clearInterval(retryTimer); retryTimer = null; } }
		}
		tick();
		retryTimer = setInterval(tick, 1000);
		appendToFlow(el); retryEl = el; scrollDown();
	}
	function removeRetry() {
		if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
		if (retryEl) { retryEl.remove(); retryEl = null; }
	}

	function renderNotice(text) {
		var el = document.createElement('div'); el.className = 'flatrow notice';
		el.innerHTML = ic('warning') + '<div class="notice-body"><div class="notice-title">Advertencia</div><div class="notice-msg"></div></div>';
		el.querySelector('.notice-msg').textContent = String(text || '');
		appendToFlow(el); scrollDown();
	}

	/* ---- card de edición (integrado): al llegar el fileDiff del run, completa la card
	   ya creada (icono + filename con shimmer) con ±N + diff inline. Click en el HEADER abre
	   el archivo; el chevron del body expande/colapsa el preview. ---- */
	var editToolIds = [];
	function syncEditCardOverflow(card, diff) {
		if (!card || !diff) { return; }
		// Esperar layout y medir sólo la altura de las filas. scrollHeight/clientHeight puede dar
		// un falso positivo cuando aparece únicamente el scrollbar horizontal.
		requestAnimationFrame(function () {
			if (!diff.isConnected || card.classList.contains('open')) { return; }
			var rows = diff.querySelectorAll('.ediff-line');
			var contentHeight = 0;
			for (var i = 0; i < rows.length; i++) { contentHeight += rows[i].getBoundingClientRect().height; }
			var maxHeight = parseFloat(getComputedStyle(diff).maxHeight) || 108;
			card.classList.toggle('needs-expand', contentHeight > maxHeight + 1);
		});
	}
	function toggleEditCard(el, expandBtn) {
		var open = el.classList.toggle('open');
		if (expandBtn) {
			var icn = expandBtn.querySelector('.codicon');
			if (icn) { icn.className = 'codicon codicon-' + (open ? 'chevron-up' : 'chevron-down'); }
			expandBtn.setAttribute('data-tip', open ? 'Compactar diff' : 'Expandir diff');
		}
	}
	function upgradeEditCard(m, forId) {
		if (!m.diffLines) { return; } // updates fuera de run (bloques): solo tocan la bandeja
		var t = null;
		if (forId && tools[forId] && tools[forId].edit) {
			t = tools[forId]; // restore: id EXACTO de la tool (sin heurística de basename)
		} else {
			for (var i = editToolIds.length - 1; i >= 0; i--) {
				var cand = tools[editToolIds[i]];
				// Preferir cards de edit que todavía no tienen el diff (evita reusar una card vieja
				// del mismo basename cuando hay varias ediciones en el mismo turno).
				if (cand && cand.edit && !cand.diffReady && (!cand.detail || basename(cand.detail) === basename(m.path))) { t = cand; break; }
			}
		}
		if (!t) { return; }
		if (t.running && !forId) {
			t.pendingDiff = m;
			return;
		}
		t.card = true;
		t.diffReady = true;
		t.editPath = m.path;
		t.el.classList.add('edit-card');
		t.el.classList.toggle('is-created', !!m.created);

		// Header limpio: icono + filename (sin verb/detail/chevron de la fila genérica).
		var head = t.head;
		var iconEl = t.iconEl || head.querySelector('.ficon, .codicon-file');
		if (!iconEl) {
			iconEl = document.createElement('span');
			head.insertBefore(iconEl, head.firstChild);
		}
		t.iconEl = iconEl;
		var icn = m.icon || fileIcons[m.path];
		if (icn) { fileIcons[m.path] = icn; }
		applyFileThemeIcon(iconEl, m.path, icn);

		var label = t.labelEl || head.querySelector('.part-label');
		if (!label) {
			label = document.createElement('span'); label.className = 'part-label';
			head.insertBefore(label, head.children[1] || null);
		}
		t.labelEl = label;
		label.textContent = basename(m.path);
		label.title = m.path;
		label.classList.remove('shimmer');

		// Ocultar restos de la fila genérica (por si la card vino de un restore viejo).
		var leftovers = head.querySelectorAll('.part-verb, .part-detail, .part-cmd, .part-status, .part-chevron');
		for (var li = 0; li < leftovers.length; li++) { leftovers[li].style.display = 'none'; }

		var stats = t.statsEl || head.querySelector('.edit-stats');
		if (!stats) {
			stats = document.createElement('span'); stats.className = 'edit-stats';
			head.appendChild(stats);
		}
		t.statsEl = stats;
		stats.textContent = '';
		if (m.created) { var b = document.createElement('span'); b.className = 'edit-badge'; b.textContent = 'nuevo'; stats.appendChild(b); }
		if (m.editAdded) { var a = document.createElement('span'); a.className = 'diff-added'; a.textContent = '+' + m.editAdded; stats.appendChild(a); }
		if (m.editRemoved) { var r = document.createElement('span'); r.className = 'diff-removed'; r.textContent = '\\u2212' + m.editRemoved; stats.appendChild(r); }

		// Click en TODO el header → abrir el archivo (integrado). Una sola vez.
		if (!t.headOpensFile) {
			t.headOpensFile = true;
			head.addEventListener('click', function () {
				var p = t.editPath || m.path;
				if (p) { vscode.postMessage({ type: 'openDiff', path: p }); }
			});
		}

		if (m.diffLines.length) {
			t.el.classList.remove('open');
			t.el.classList.remove('needs-expand');
			t.el.classList.add('has-diff');
			var oldDiff = t.body.querySelector('.ediff');
			if (oldDiff) { oldDiff.remove(); }
			var oldFade = t.body.querySelector('.edit-fade');
			if (oldFade) { oldFade.remove(); }
			var oldExp = t.body.querySelector('.edit-expand');
			if (oldExp) { oldExp.remove(); }
			var diff = document.createElement('div'); diff.className = 'ediff';
			m.diffLines.forEach(function (ln) {
				var row = document.createElement('div'); row.className = 'ediff-line ediff-' + ln.t;
				var sign = document.createElement('span'); sign.className = 'ediff-sign';
				sign.textContent = ln.t === 'add' ? '+' : ln.t === 'del' ? '\\u2212' : ' ';
				var tx = document.createElement('span'); tx.className = 'ediff-code';
				appendHighlightedCode(tx, ln.x || ' ', 'typescript');
				row.appendChild(sign); row.appendChild(tx); diff.appendChild(row);
			});
			t.body.insertBefore(diff, t.body.firstChild);
			var fade = document.createElement('div'); fade.className = 'edit-fade';
			var expandBtn = document.createElement('button'); expandBtn.className = 'edit-expand'; expandBtn.type = 'button';
			expandBtn.setAttribute('data-tip', 'Expandir diff');
			expandBtn.innerHTML = ic('chevron-down');
			expandBtn.addEventListener('click', function (ev) { ev.stopPropagation(); toggleEditCard(t.el, expandBtn); });
			t.body.appendChild(fade); t.body.appendChild(expandBtn);
			syncEditCardOverflow(t.el, diff);
		}
	}

	var activeCompaction = null;
	function formatCompactTokens(value) {
		var n = Number(value) || 0;
		if (n >= 1000000) { return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace('.0', '') + 'M'; }
		if (n >= 1000) { return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'K'; }
		return String(Math.round(n));
	}
	function renderCompaction(m, restored) {
		var status = String(m.status || 'completed');
		var card = (!restored && activeCompaction && activeCompaction.isConnected) ? activeCompaction : null;
		if (!card) {
			card = document.createElement('div'); card.className = 'compaction-card';
			card.innerHTML = '<span class="compaction-icon"></span><span class="compaction-copy"><span class="compaction-title"></span><span class="compaction-detail"></span></span><span class="compaction-kind"></span>';
			appendToFlow(card);
		}
		card.className = 'compaction-card' + (status === 'failed' ? ' failed' : '');
		var icon = status === 'started' ? 'loading' : status === 'failed' ? 'error' : status === 'skipped' ? 'info' : 'check';
		card.querySelector('.compaction-icon').innerHTML = ic(icon);
		if (status === 'started') { card.querySelector('.compaction-icon .codicon').classList.add('codicon-modifier-spin'); }
		var title = status === 'started' ? 'Compactando contexto…' : status === 'failed' ? 'No se pudo compactar' : status === 'skipped' ? 'Contexto sin cambios' : 'Contexto compactado';
		card.querySelector('.compaction-title').textContent = title;
		var detail = String(m.message || '');
		if (status === 'completed' && m.beforeTokens !== undefined && m.afterTokens !== undefined) {
			detail = formatCompactTokens(m.beforeTokens) + ' → ' + formatCompactTokens(m.afterTokens) + ' tokens';
			if (m.savingsPercent !== undefined) { detail += ' · ' + Math.round(Number(m.savingsPercent) || 0) + '% liberado'; }
		} else if (status === 'started' && m.beforeTokens !== undefined) {
			detail = formatCompactTokens(m.beforeTokens) + ' tokens antes de resumir';
		}
		card.querySelector('.compaction-detail').textContent = detail;
		card.querySelector('.compaction-detail').hidden = !detail;
		card.querySelector('.compaction-kind').textContent = m.origin === 'manual' ? 'Manual' : m.origin === 'recovery' ? 'Recovery' : 'Auto';
		activeCompaction = status === 'started' && !restored ? card : null;
		scrollDown();
	}
	function finishTool(id, name, result, isError) {
		var t = tools[id];
		if (!t) { addTool(id, name, ''); t = tools[id]; }
		if (t.todo) { ensureGenerating(); scrollDown(); return; }
		if (t.ask) { ensureGenerating(); scrollDown(); return; }
		if (t.delegation) { finishDelegationTool(t, result, isError); ensureGenerating(); scrollDown(); return; }
		if (t.term && !t.el) { ensureGenerating(); scrollDown(); return; }
		if (t.term) { finishTermCard(t, result, isError); ensureGenerating(); scrollDown(); return; }
		if (t.edit) {
			t.running = false;
			if (t.pendingDiff) {
				var pendingDiff = t.pendingDiff;
				t.pendingDiff = null;
				upgradeEditCard(pendingDiff, id);
			}
			if (t.labelEl) { t.labelEl.classList.remove('shimmer'); }
			else if (t.verbEl) { t.verbEl.classList.remove('shimmer'); }
			if (isError) { t.el.classList.add('error'); }
			if (t.card && !isError) { result = ''; }
			if (result) {
				t.resultPre.textContent = result.length > 6000 ? (result.slice(0, 6000) + '\\n…') : result;
				t.resultPre.style.display = ''; t.resultLabel.style.display = '';
			}
			ensureGenerating();
			scrollDown();
			return;
		}
		finalizeExploreLine(t, result, isError);
		if (t.verbEl) {
			t.verbEl.classList.remove('shimmer');
			if (!t.explore && t.meta && t.meta.done) { t.verbEl.textContent = t.meta.done; }
		}
		if (t.explore) { onExploreEnd(); }
		if (isError) { t.el.classList.add('error'); if (t.verbEl) { t.verbEl.textContent = (t.meta && t.meta.done ? t.meta.done : name) + ' — error'; } }
		if (t.card && !isError) { result = ''; } // la card ya muestra el diff: el "OK: editado…" es ruido
		// El resultado completo queda en el mensaje tool para el modelo; la fila visual sólo comunica estado.
		// tras un resultado, el modelo va a producir su próximo turno → mostrar "Generando"
		ensureGenerating();
		scrollDown();
	}
	function addFlat(message, icon, kind) {
		assistant = null; finalizeReasoning(); removeGenerating();
		var row = document.createElement('div'); row.className = 'flatrow' + (kind ? (' ' + kind) : '');
		row.innerHTML = ic(icon) + '<span></span>';
		row.querySelector('span').textContent = message;
		appendToFlow(row); scrollDown();
	}
	function addErrorMsg(message, action) {
		assistant = null; finalizeReasoning();
		var row = document.createElement('div'); row.className = 'flatrow err';
		row.innerHTML = ic('error') + '<div class="err-body"><div class="err-title">Error</div><div class="err-msg"></div></div>';
		row.querySelector('.err-msg').textContent = message;
		if (action === 'connect') {
			// error de credencial: el fix está a UN click (asistente de conexión, con límites independientes del modelo)
			var btn = document.createElement('button'); btn.className = 'err-connect'; btn.type = 'button';
			btn.innerHTML = ic('plug') + '<span>Conectar proveedor\u2026</span>';
			btn.addEventListener('click', function () { vscode.postMessage({ type: 'openProviders' }); });
			row.querySelector('.err-body').appendChild(btn);
		}
		appendToFlow(row); scrollDown();
	}

	// ---- subagentes del modo Ultracode (cards inline en el mismo flujo) ----
	var subCards = {};
	var delegations = {};
	function ensureDelegation(parentId, total) {
		var id = String(parentId || '');
		if (!id) { return null; }
		var delegation = delegations[id];
		if (delegation) {
			delegation.total = Math.max(delegation.total || 0, Number(total) || 0);
			return delegation;
		}
		var group = document.createElement('div'); group.className = 'delegation-group'; group.setAttribute('data-delegation-id', id);
		var children = document.createElement('div'); children.className = 'delegation-children'; group.appendChild(children);
		appendToFlow(group);
		delegation = { id: id, total: Number(total) || 0, completed: 0, children: {}, group: group, childHost: children, summary: null, status: 'running' };
		delegations[id] = delegation;
		return delegation;
	}
	function onDelegationStart(m) { ensureDelegation(m.id, m.total); renderAgentLayoutTree(); scrollDown(); }
	function restoreDelegation(id, args, result) {
		var parsed = {}; try { parsed = JSON.parse(args || '{}'); } catch (e) { parsed = {}; }
		var tasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 6) : [];
		addTool(id, 'delegate_task', args || '', true); onDelegationStart({ id: id, total: tasks.length });
		tasks.forEach(function (task, index) {
			var subId = id + '-' + index;
			onSubagentStart({ id: subId, parentId: id, index: index, total: tasks.length, status: 'running', title: String(task.title || 'Subagente'), prompt: String(task.prompt || ''), model: '' });
			onSubagentDone({ id: subId, parentId: id, index: index, total: tasks.length, status: 'completed', isError: false, cancelled: false });
		});
		onDelegationDone({ id: id, total: tasks.length, status: 'completed' }); finishTool(id, 'delegate_task', result || '', false);
	}
	function orderedDelegationInsert(delegation, card, index) {
		card.setAttribute('data-subagent-index', String(index));
		var nodes = delegation.childHost.children;
		for (var i = 0; i < nodes.length; i++) {
			if (Number(nodes[i].getAttribute('data-subagent-index')) > index) { delegation.childHost.insertBefore(card, nodes[i]); return; }
		}
		delegation.childHost.appendChild(card);
	}
	function subBriefArgs(json) {
		try {
			var a = JSON.parse(json || '{}');
			return String(a.path || a.query || a.pattern || a.name || a.command || '').slice(0, 60);
		} catch (e) { return ''; }
	}
	function compactSubagentTokens(value) { return value >= 1000000 ? (Math.round(value / 100000) / 10) + 'M' : value >= 1000 ? (Math.round(value / 100) / 10) + 'K' : String(value); }
	function renderPersistentSubagentRun(run) {
		if (!run || !run.runId) { return; }
		var existing = subCards[run.runId];
		if (!existing) {
			var routedModel = (run.providerId ? run.providerId + '/' : '') + (run.model || '');
			onSubagentStart({ id: run.runId, parentId: 'run:' + run.parentMessageId, index: Object.keys(subCards).length, total: 1, status: 'running', title: run.definitionName || 'Subagente', prompt: run.task || '', model: routedModel });
			existing = subCards[run.runId];
		}
		if (!existing) { return; }
		existing.card.setAttribute('data-parent-message-id', run.parentMessageId || '');
		var label = existing.card.querySelector('.sub-count');
		var tokenTotal = Number(run.metrics && run.metrics.inputTokens || 0) + Number(run.metrics && run.metrics.outputTokens || 0);
		existing.tokenTotal = tokenTotal;
		if (label) {
			var attempts = Number(run.metrics && run.metrics.routingAttempts || 0);
			var fallbacks = Number(run.metrics && run.metrics.fallbacks || 0);
			label.textContent = (run.progress || run.status || '') + (tokenTotal ? ' · ' + compactSubagentTokens(tokenTotal) + ' tokens' : '') + (fallbacks ? ' · ' + fallbacks + ' fallback' + (fallbacks === 1 ? '' : 's') : '');
			label.title = (tokenTotal ? 'Entrada: ' + Number(run.metrics.inputTokens || 0).toLocaleString() + ' · Salida: ' + Number(run.metrics.outputTokens || 0).toLocaleString() : '') + (attempts ? ' · Intentos: ' + attempts : '');
		}
		if (Array.isArray(run.routingAttempts) && run.routingAttempts.length && !existing.routingRendered) {
			existing.routingRendered = true;
			var route = document.createElement('div'); route.className = 'sub-text sub-routing';
			route.textContent = 'Routing: ' + run.routingAttempts.map(function (attempt) { return attempt.providerId + '/' + attempt.model + (attempt.errorReason ? ' (' + attempt.errorReason + ')' : ''); }).join(' → ');
			existing.body.appendChild(route);
		}
		if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'interrupted') {
			onSubagentDone({ id: run.runId, parentId: existing.parentId, status: run.status, isError: run.status === 'failed' || run.status === 'interrupted', cancelled: run.status === 'cancelled' });
			if (run.result && run.result.summary) { var result = document.createElement('div'); result.className = 'sub-text sub-result'; result.textContent = run.result.summary; existing.body.appendChild(result); }
		}
	}
	function appendPersistentSubagentTimeline(runId, event) {
		var state = subCards[runId]; if (!state || !event) { return; }
		if (event.type === 'toolStart') { onSubagentEvent({ id: runId, ev: { type: 'toolStart', id: event.toolCallId, name: event.toolName, argumentsJson: event.argumentsJson } }); }
		else if (event.type === 'toolResult' || event.type === 'permissionDenied') { onSubagentEvent({ id: runId, ev: { type: 'info', message: event.message || event.type } }); }
		else if (event.message) { onSubagentEvent({ id: runId, ev: { type: 'info', message: event.message } }); }
	}
	function onSubagentStart(m) {
		assistant = null; finalizeReasoning();
		if (subCards[m.id]) { return; }
		var delegation = ensureDelegation(m.parentId, m.total);
		if (!delegation) { return; }
		var card = document.createElement('div'); card.className = 'sub-card';
		card.innerHTML = '<div class="sub-head">' +
			'<span class="codicon codicon-loading sub-st sub-spin"></span>' +
			'<span class="sub-title shimmer"></span>' +
			'<span class="sub-model"></span>' +
			'<span class="sub-count"></span>' +
			'<button class="sub-action sub-open" data-tip="Abrir chat del subagente">' + ic('link-external') + '</button>' +
			'<button class="sub-action sub-stop" data-tip="Cancelar subagente">Stop</button>' +
			'<span class="codicon codicon-chevron-up sub-chev"></span>' +
			'</div><div class="sub-body"></div>';
		var subTitle = card.querySelector('.sub-title'); subTitle.textContent = m.title || 'Subagente'; subTitle.title = m.title || 'Subagente';
		var subModel = card.querySelector('.sub-model'); subModel.textContent = m.model || ''; subModel.title = m.model || '';
		var subHead = card.querySelector('.sub-head'); subHead.setAttribute('role', 'button'); subHead.setAttribute('tabindex', '0'); subHead.setAttribute('aria-expanded', 'true'); subHead.setAttribute('aria-label', 'Subagente ejecutándose: ' + (m.title || 'Subagente'));
		subHead.addEventListener('click', function (e) {
			if (e.target.closest('.sub-action')) { return; }
			card.classList.toggle('collapsed'); subHead.setAttribute('aria-expanded', card.classList.contains('collapsed') ? 'false' : 'true');
		});
		subHead.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.sub-action')) { e.preventDefault(); subHead.click(); } });
		card.querySelector('.sub-open').addEventListener('click', function (e) {
			e.stopPropagation();
			if (m.sessionId) { vscode.postMessage({ type: 'openSubagentChat', id: m.sessionId }); }
		});
		card.querySelector('.sub-stop').addEventListener('click', function (e) {
			e.stopPropagation(); vscode.postMessage({ type: 'cancelSubagent', id: m.id });
		});
		orderedDelegationInsert(delegation, card, Number(m.index) || 0); scrollDown();
		var runKeyId = Object.keys(subCards).length;
		var subState = { card: card, body: card.querySelector('.sub-body'), count: card.querySelector('.sub-count'), textEl: null, tools: 0, tokenTotal: 0, title: m.title || 'Subagente', model: m.model || '', sessionId: m.sessionId || '', parentId: m.parentId, index: Number(m.index) || 0, status: 'running', running: true, runId: m.id };
		card.setAttribute('data-run-id', m.id);
		subCards[m.id] = subState; delegation.children[m.id] = subState;
		renderSubagentTray(); renderAgentLayoutTree();
	}
	function onSubagentEvent(m) {
		var s = subCards[m.id];
		var ev = m.ev || {};
		if (!s) { return; }
		if (ev.type === 'text') {
			if (!s.textEl) { s.textEl = document.createElement('div'); s.textEl.className = 'sub-text'; s.body.appendChild(s.textEl); }
			s.textEl.textContent += ev.delta || '';
		} else if (ev.type === 'toolStart') {
			s.textEl = null;
			s.tools++;
			s.count.textContent = s.tools + (s.tools === 1 ? ' tool' : ' tools');
			var row = document.createElement('div'); row.className = 'sub-tool'; row.setAttribute('data-tid', ev.id || '');
			row.innerHTML = '<span class="codicon codicon-tools"></span><span class="sub-tool-name"></span>';
			row.querySelector('.sub-tool-name').textContent = ev.name + (subBriefArgs(ev.argumentsJson) ? ' · ' + subBriefArgs(ev.argumentsJson) : '');
			s.body.appendChild(row);
		} else if (ev.type === 'toolResult') {
			if (ev.isError) {
				var trow = s.body.querySelector('[data-tid="' + (ev.id || '') + '"]');
				if (trow) { trow.classList.add('err'); }
			}
		} else if (ev.type === 'usage') {
			var tokenTotal = Number(ev.inputTokens || 0) + Number(ev.outputTokens || 0);
			s.tokenTotal = (s.tokenTotal || 0) + tokenTotal;
			s.count.textContent = (s.tools ? s.tools + (s.tools === 1 ? ' tool' : ' tools') + ' · ' : '') + compactSubagentTokens(s.tokenTotal) + ' tokens';
			renderAgentLayoutTree();
		} else if (ev.type === 'info') {
			var irow = document.createElement('div'); irow.className = 'sub-text';
			irow.textContent = '(' + (ev.message || '') + ')';
			s.body.appendChild(irow);
		}
		s.body.scrollTop = s.body.scrollHeight;
	}
	function onSubagentDone(m) {
		var s = subCards[m.id];
		if (!s || s.status !== 'running') { return; }
		var st = s.card.querySelector('.sub-st');
		st.className = 'codicon sub-st ' + (m.cancelled ? 'codicon-circle-slash' : (m.isError ? 'codicon-error st-err' : 'codicon-pass-filled st-ok'));
		var doneHead = s.card.querySelector('.sub-head'); doneHead.setAttribute('aria-label', (m.cancelled ? 'Subagente cancelado: ' : (m.isError ? 'Subagente con error: ' : 'Subagente completado: ')) + s.title);
		var subTitle = s.card.querySelector('.sub-title'); if (subTitle) { subTitle.classList.remove('shimmer'); }
		s.running = false; s.status = m.status || (m.cancelled ? 'cancelled' : (m.isError ? 'failed' : 'completed'));
		var delegation = delegations[s.parentId]; if (delegation) { delegation.completed++; }
		s.card.classList.add('collapsed', 'done', 'status-' + s.status);
		if (m.cancelled) { s.count.textContent = 'cancelado' + (s.tokenTotal ? ' · ' + compactSubagentTokens(s.tokenTotal) + ' tokens' : ''); }
		renderSubagentTray(); renderAgentLayoutTree();
		scrollDown();
	}
	function onDelegationDone(m) {
		var delegation = ensureDelegation(m.id, m.total);
		if (!delegation || delegation.status !== 'running') { return; }
		delegation.status = m.status || 'completed';
		delegation.group.classList.add('done', 'status-' + delegation.status); renderAgentLayoutTree();
	}
	function finishDelegationTool(tool, result, isError) {
		var delegation = ensureDelegation(tool.parentId, 0);
		if (!delegation) { return; }
		if (!delegation.summary) {
			var row = document.createElement('div'); row.className = 'delegation-summary' + (isError ? ' error' : '');
			var toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'delegation-summary-main'; toggle.setAttribute('aria-expanded', 'false');
			toggle.innerHTML = '<span class="codicon codicon-run-all delegation-summary-icon"></span><span class="delegation-summary-title">Delegated</span><span class="delegation-summary-space"></span><span class="part-kind">TOOL</span><span class="delegation-summary-status">' + ic(isError ? 'error' : 'pass-filled') + '</span><span class="delegation-summary-chevron">' + ic('chevron-right') + '</span>';
			var body = document.createElement('div'); body.className = 'delegation-summary-body';
			var argsLabel = document.createElement('div'); argsLabel.className = 'part-label2'; argsLabel.textContent = 'Argumentos';
			var argsPre = document.createElement('pre'); argsPre.className = 'part-pre'; argsPre.textContent = tool.args || '';
			var resultLabel = document.createElement('div'); resultLabel.className = 'part-label2'; resultLabel.textContent = 'Resultado';
			var resultPre = document.createElement('pre'); resultPre.className = 'part-pre'; resultPre.textContent = result || '';
			body.appendChild(argsLabel); body.appendChild(argsPre); body.appendChild(resultLabel); body.appendChild(resultPre);
			toggle.addEventListener('click', function () { var open = row.classList.toggle('open'); toggle.setAttribute('aria-expanded', open ? 'true' : 'false'); toggle.querySelector('.delegation-summary-chevron').innerHTML = ic(open ? 'chevron-down' : 'chevron-right'); });
			row.appendChild(toggle); row.appendChild(body); delegation.group.appendChild(row); delegation.summary = row;
		} else if (isError) { delegation.summary.classList.add('error'); }
	}
	var agentLayoutPending = false;
	var requestedAgentLayoutOpen = false;
	function applyAgentLayoutState(open) {
		agentLayoutPanel.classList.toggle('open', open);
		document.body.classList.toggle('agent-layout-open', open);
		agentLayoutBtn.setAttribute('aria-pressed', String(open));
		agentLayoutBtn.setAttribute('data-tip', open ? 'Cerrar árbol de agentes' : 'Árbol de agentes');
		if (open) { agentLayoutToggleSlot.appendChild(agentLayoutBtn); }
		else { headerActions.insertBefore(agentLayoutBtn, historyBtn); }
		agentLayoutBtn.removeAttribute('aria-busy');
		agentLayoutPending = false;
		if (open) { renderAgentLayoutTree(); }
	}
	function setAgentLayoutOpen(open) {
		if (agentLayoutPending && requestedAgentLayoutOpen === open) { return; }
		agentLayoutPending = true;
		requestedAgentLayoutOpen = open;
		agentLayoutBtn.setAttribute('aria-busy', 'true');
		vscode.postMessage({ type: 'agentLayoutState', open: open });
	}
	function closeAgentLayout() {
		setAgentLayoutOpen(false);
	}
	function renderAgentLayoutTree() {
		if (!agentLayoutTree) { return; }
		var query = String(agentLayoutSearch && agentLayoutSearch.value || '').trim().toLowerCase();
		agentLayoutTree.innerHTML = '';
		// Nodo padre: conversación actual.
		var parent = document.createElement('button'); parent.type = 'button'; parent.className = 'agent-tree-parent active';
		parent.innerHTML = '<span class="codicon codicon-openide-chat"></span><span class="tree-copy"><span class="agent-tree-title"></span><span class="agent-tree-detail"></span></span>';
		parent.querySelector('.agent-tree-title').textContent = (openTabs.filter(function (tab) { return tab.id === activeSessionId; })[0] || {}).title || 'Conversación actual';
		parent.querySelector('.agent-tree-detail').textContent = modeById(mode).label + ' · conversación padre';
		parent.addEventListener('click', closeAgentLayout);
		agentLayoutTree.appendChild(parent);

		// Unificar fuentes: delegaciones legacy + runs persistentes por parentMessageId.
		var groups = {};
		Object.keys(delegations).forEach(function (parentId) {
			var delegation = delegations[parentId];
			if (!groups[parentId]) { groups[parentId] = { label: 'Delegación', children: [] }; }
			Object.keys(delegation.children).forEach(function (id) { groups[parentId].children.push(delegation.children[id]); });
		});
		Object.keys(subCards).forEach(function (id) {
			var child = subCards[id];
			var key = 'run:' + (child.card.getAttribute('data-parent-message-id') || child.parentId || 'orphan');
			if (!groups[key]) { groups[key] = { label: 'Ejecución', children: [] }; }
			if (!groups[key].children.some(function (c) { return c === child; })) { groups[key].children.push(child); }
		});

		var hasChildren = false;
		Object.keys(groups).forEach(function (groupId) {
			var group = groups[groupId];
			var matches = group.children.filter(function (child) { return !query || (child.title + ' ' + (child.model || '') + ' ' + (child.status || '')).toLowerCase().indexOf(query) >= 0; });
			if (!matches.length) { return; }
			hasChildren = true;
			var section = document.createElement('div'); section.className = 'agent-tree-section';
			var sectionHead = document.createElement('button'); sectionHead.type = 'button'; sectionHead.className = 'agent-tree-section-head';
			sectionHead.innerHTML = '<span class="codicon codicon-chevron-down agent-tree-section-chev"></span><span class="agent-tree-section-label"></span><span class="agent-tree-section-count"></span>';
			sectionHead.querySelector('.agent-tree-section-label').textContent = group.label;
			sectionHead.querySelector('.agent-tree-section-count').textContent = matches.length;
			var sectionBody = document.createElement('div'); sectionBody.className = 'agent-tree-section-body';
			sectionHead.addEventListener('click', function () { var open = section.classList.toggle('collapsed'); sectionHead.querySelector('.agent-tree-section-chev').className = 'codicon codicon-chevron-' + (open ? 'right' : 'down') + ' agent-tree-section-chev'; });
			matches.sort(function (a, b) { return (a.index || 0) - (b.index || 0); }).forEach(function (child) {
				var row = document.createElement('div'); row.className = 'agent-tree-child status-' + (child.status || 'running');
				var statusIcon = child.status === 'running' ? 'loading codicon-modifier-spin' : child.status === 'failed' ? 'error' : child.status === 'cancelled' ? 'circle-slash' : child.status === 'interrupted' ? 'warning' : 'check';
				row.innerHTML = '<span class="agent-status-icon codicon codicon-' + statusIcon + '"></span><span class="tree-copy"><span class="agent-tree-title"></span><span class="agent-tree-detail"></span></span>' + (child.running !== false ? '<button class="agent-tree-action agent-tree-stop" data-tip="Cancelar">' + ic('debug-stop') + '</button>' : '') + '<button class="agent-tree-action agent-tree-open" data-tip="Abrir">' + ic('link-external') + '</button>';
				row.querySelector('.agent-tree-title').textContent = child.title || 'Subagente';
				var detail = (child.model || 'Subagente');
				if (child.tools) { detail += ' · ' + child.tools + ' tools'; }
				if (child.tokenTotal) { detail += ' · ' + compactSubagentTokens(child.tokenTotal) + ' tokens'; }
				if (child.status && child.status !== 'running') { detail += ' · ' + child.status; }
				row.querySelector('.agent-tree-detail').textContent = detail;
				var stopBtn = row.querySelector('.agent-tree-stop');
				if (stopBtn) { stopBtn.addEventListener('click', function (e) { e.stopPropagation(); vscode.postMessage({ type: 'cancelSubagent', id: child.runId || '' }); }); }
				row.querySelector('.agent-tree-open').addEventListener('click', function (e) { e.stopPropagation(); if (child.sessionId) { vscode.postMessage({ type: 'openSubagentChat', id: child.sessionId }); } });
				row.addEventListener('click', function () { if (child.sessionId) { vscode.postMessage({ type: 'openSubagentChat', id: child.sessionId }); } });
				sectionBody.appendChild(row);
			});
			section.appendChild(sectionHead); section.appendChild(sectionBody);
			agentLayoutTree.appendChild(section);
		});
		if (!hasChildren) {
			var empty = document.createElement('div'); empty.className = 'agent-tree-empty';
			empty.textContent = query ? 'Sin resultados' : 'No hay subagentes activos. Usá delegate_to_subagent para lanzar uno.';
			agentLayoutTree.appendChild(empty);
		}
	}
	function renderSubagentTray() {
		var running = Object.keys(subCards).map(function (id) { return { id: id, item: subCards[id] }; }).filter(function (entry) { return entry.item.running; });
		if (!running.length) { removeTray('subagents'); return; }
		var el = ensureTray('subagents', 'subagents-tray');
		var expanded = el.getAttribute('data-expanded') !== '0';
		el.innerHTML = '';
		var head = document.createElement('div'); head.className = 'dock-head';
		var toggle = document.createElement('button'); toggle.className = 'dock-toggle'; toggle.type = 'button';
		toggle.innerHTML = ic(expanded ? 'chevron-down' : 'chevron-right') + '<span>' + running.length + (running.length === 1 ? ' subagent running' : ' subagents running') + '</span>';
		toggle.addEventListener('click', function () { el.setAttribute('data-expanded', expanded ? '0' : '1'); renderSubagentTray(); });
		head.appendChild(toggle); el.appendChild(head);
		if (expanded) {
			var body = document.createElement('div'); body.className = 'dock-body';
			running.forEach(function (entry) {
				var row = document.createElement('div'); row.className = 'dock-sub-row';
				row.innerHTML = ic('send') + '<span class="dock-sub-title shimmer"></span><span class="dock-sub-model"></span><button class="sub-action sub-stop">Stop</button>';
				row.querySelector('.dock-sub-title').textContent = entry.item.title;
				row.querySelector('.dock-sub-model').textContent = entry.item.model;
				row.addEventListener('click', function () {
					if (entry.item.sessionId) { vscode.postMessage({ type: 'openSubagentChat', id: entry.item.sessionId }); }
				});
				row.querySelector('.sub-stop').addEventListener('click', function (e) {
					e.stopPropagation(); vscode.postMessage({ type: 'cancelSubagent', id: entry.id });
				});
				body.appendChild(row);
			});
			el.appendChild(body);
		}
	}

	/* ---- card del PLAN (modo plan): revisión + aprobación inline en el transcript. El host
	   la manda al guardar plan_save; Aprobar/Rechazar resuelven la botonera a una línea de
	   estado. Las cards viven en un mapa por path para actualizarlas desde el host. ---- */
	var planCards = {};          // path -> { card, actions }
	var planIsMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
	function planStatusLine(status, path) {
		if (status === 'rechazado') {
			var st = document.createElement('div'); st.className = 'plan-status';
			st.textContent = 'Rechazado';
			return st;
		}
		var actions = document.createElement('div'); actions.className = 'plan-actions';
		var view = document.createElement('button'); view.className = 'plan-reject'; view.type = 'button'; view.textContent = 'Ver plan';
		view.addEventListener('click', function () { vscode.postMessage({ type: 'planOpen', path: path }); });
		var sp = document.createElement('span'); sp.className = 'plan-sp';
		var building = document.createElement('span'); building.className = 'plan-build status';
		building.innerHTML = '<span>Building</span><span class="build-spinner"></span>';
		actions.appendChild(view); actions.appendChild(sp); actions.appendChild(building);
		return actions;
	}
	function resolvePlanCard(path, status) {
		var pc = planCards[path];
		if (!pc || !pc.actions) { return; }
		pc.actions.replaceWith(planStatusLine(status, path));
		pc.actions = null;
	}
	// Parseo simple del markdown del plan: título (# ...), descripción (1er párrafo tras el título)
	// y tareas (checkboxes bajo "## Tareas"). Sin frontmatter (la card recibe el markdown pelado).
	function parsePlan(md) {
		var lines = String(md || '').split('\\n');
		var title = '', descLines = [], tasks = [], i = 0, tasksIdx = -1;
		for (var k = 0; k < lines.length; k++) {
			if (/^##\\s+(Tareas|Tasks|To-?dos?)\\b/i.test(lines[k])) { tasksIdx = k; }
		}
		// título: primer '# '
		while (i < lines.length && !/^#\\s+/.test(lines[i])) { i++; }
		if (i < lines.length) { title = lines[i].replace(/^#\\s+/, '').trim(); i++; }
		// descripción: primer párrafo no vacío que no sea heading, hasta el fin del párrafo
		while (i < lines.length && /^\\s*$/.test(lines[i])) { i++; }
		while (i < lines.length && !/^\\s*$/.test(lines[i]) && !/^#{1,6}\\s/.test(lines[i])) { descLines.push(lines[i].trim()); i++; }
		// tareas
		if (tasksIdx >= 0) {
			for (var j = tasksIdx + 1; j < lines.length; j++) {
				var mt = lines[j].match(/^\\s*[-*+]\\s+\\[([ xX])\\]\\s+(.*)$/);
				if (mt) { tasks.push({ text: mt[2].trim(), done: mt[1].toLowerCase() === 'x' }); continue; }
				if (/^#{1,6}\\s/.test(lines[j])) { break; }
			}
		}
		return { title: title, desc: descLines.join(' '), tasks: tasks };
	}
	function renderPlanCard(m) {
		assistant = null; finalizeReasoning(); removeGenerating();
		var path = String(m.path || '');
		var md = String(m.markdown || '');
		var parsed = parsePlan(md);
		var wrap = document.createElement('div'); wrap.className = 'plan-wrap';
		var label = document.createElement('div'); label.className = 'plan-label'; label.textContent = 'Plan preparado';
		wrap.appendChild(label);
		var card = document.createElement('div'); card.className = 'plan-card';

		// head: ícono lista + filename mono (→ abrir editor) + copiar
		var head = document.createElement('div'); head.className = 'plan-head';
		var lico = document.createElement('span'); lico.innerHTML = ic('list-tree'); head.appendChild(lico.firstChild);
		var file = document.createElement('span'); file.className = 'plan-file';
		file.textContent = basename(path); file.title = path;
		file.addEventListener('click', function () { vscode.postMessage({ type: 'planOpen', path: path }); });
		head.appendChild(file);
		var copyBtn = document.createElement('button'); copyBtn.className = 'plan-icobtn'; copyBtn.type = 'button';
		copyBtn.setAttribute('data-tip', 'Copiar el plan'); copyBtn.innerHTML = ic('copy');
		copyBtn.addEventListener('click', function () { try { navigator.clipboard.writeText(md); } catch (e) { } });
		head.appendChild(copyBtn);
		card.appendChild(head);

		// body: título + descripción + "Leer plan detallado" + tareas
		var body = document.createElement('div'); body.className = 'plan-body';
		var title = document.createElement('div'); title.className = 'plan-title';
		title.textContent = parsed.title || m.title || 'Plan';
		body.appendChild(title);
		if (parsed.desc) { var desc = document.createElement('div'); desc.className = 'plan-desc'; desc.textContent = parsed.desc; body.appendChild(desc); }
		var readLink = document.createElement('button'); readLink.className = 'plan-readlink'; readLink.type = 'button';
		readLink.textContent = 'Leer plan detallado';
		readLink.addEventListener('click', function () { vscode.postMessage({ type: 'planOpen', path: path }); });
		body.appendChild(readLink);
		if (parsed.tasks.length) {
			var tbox = document.createElement('div'); tbox.className = 'plan-tasks';
			var th = document.createElement('div'); th.className = 'plan-tasks-head';
			var remaining = parsed.tasks.filter(function (task) { return !task.done; }).length;
			th.textContent = remaining + (remaining === 1 ? ' tarea pendiente' : ' tareas pendientes');
			tbox.appendChild(th);
			parsed.tasks.forEach(function (t) {
				var row = document.createElement('div'); row.className = 'plan-task' + (t.done ? ' done' : '');
				var ci = document.createElement('span'); ci.innerHTML = ic(t.done ? 'pass-filled' : 'circle-large-outline'); row.appendChild(ci.firstChild);
				var tx = document.createElement('span'); tx.className = 'plan-task-text'; tx.textContent = t.text; row.appendChild(tx);
				tbox.appendChild(row);
			});
			body.appendChild(tbox);
		}
		card.appendChild(body);

		// botonera: Rechazar (secundario) + Build (dorado, hint de teclado)
		var actions = document.createElement('div'); actions.className = 'plan-actions';
		var sp = document.createElement('span'); sp.className = 'plan-sp'; actions.appendChild(sp);
		var reject = document.createElement('button'); reject.className = 'plan-reject'; reject.type = 'button';
		reject.textContent = 'Rechazar';
		reject.addEventListener('click', function () { vscode.postMessage({ type: 'planReject', path: path }); });
		actions.appendChild(reject);
		var approve = document.createElement('button'); approve.className = 'plan-build'; approve.type = 'button';
		approve.innerHTML = ic('play') + '<span>Build</span><span class="kbd">' + (planIsMac ? '\\u2318\\u21a9' : 'Ctrl+\\u21a9') + '</span>';
		approve.addEventListener('click', function () { vscode.postMessage({ type: 'planBuild', path: path }); });
		actions.appendChild(approve);
		card.appendChild(actions);

		wrap.appendChild(card);
		appendToFlow(wrap); scrollDown();
		planCards[path] = { card: wrap, actions: actions };
	}
	function renderCanvasCard(m) {
		assistant = null; finalizeReasoning(); removeGenerating();
		var path = String(m.path || '');
		var card = document.createElement('div'); card.className = 'canvas-card';
		var head = document.createElement('div'); head.className = 'canvas-head'; head.innerHTML = ic('layout') + '<span></span>';
		head.querySelector('span').textContent = m.created === false ? 'Canvas actualizado' : 'Canvas creado';
		var title = document.createElement('div'); title.className = 'canvas-title'; title.textContent = String(m.title || basename(path));
		var file = document.createElement('div'); file.className = 'canvas-path'; file.textContent = path; file.title = path;
		var open = document.createElement('button'); open.type = 'button'; open.className = 'canvas-open'; open.textContent = 'Abrir';
		open.addEventListener('click', function(){ vscode.postMessage({type:'canvasOpen',path:path}); });
		card.appendChild(head); card.appendChild(title); card.appendChild(file); card.appendChild(open); card.appendChild(document.createElement('div')).style.clear='both';
		appendToFlow(card); scrollDown();
	}

	// ---- tarjeta de sugerencia de modo (triaje de complejidad: plan/ultra/fork) ----
	var SUGGEST_META = {
		agent: { icon: 'openide-mode-agent', label: 'Agent', verb: 'Cambiar a modo Agent' },
		plan:  { icon: 'openide-mode-plan',  label: 'Plan',  verb: 'Cambiar a modo Plan' },
		ask:   { icon: 'openide-mode-ask',   label: 'Ask',   verb: 'Cambiar a modo Ask' },
		ultra: { icon: 'rocket',      label: 'Ultracode', verb: 'Usar Ultracode' },
		fork:  { icon: 'repo-forked', label: 'Fork',      verb: 'Abrir una rama (fork)' }
	};
	function renderSuggestMode(m) {
		assistant = null; finalizeReasoning(); removeGenerating();
		var target = String(m.mode || '');
		var meta = SUGGEST_META[target]; if (!meta) { return; }
		var refined = String(m.prompt || '');
		var wrap = document.createElement('div'); wrap.className = 'suggest-wrap';
		var card = document.createElement('div'); card.className = 'suggest-card';
		var head = document.createElement('div'); head.className = 'suggest-head';
		head.innerHTML = ic(meta.icon) + '<span class="suggest-title"></span><span class="suggest-kicker">Modo recomendado</span>';
		head.querySelector('.suggest-title').textContent = meta.label;
		card.appendChild(head);
		var body = document.createElement('div'); body.className = 'suggest-body'; body.textContent = String(m.reason || '');
		card.appendChild(body);
		var actions = document.createElement('div'); actions.className = 'suggest-actions';
		var dismiss = document.createElement('button'); dismiss.className = 'suggest-dismiss'; dismiss.type = 'button';
		dismiss.textContent = 'Seguir en ' + modeById(mode).label;
		dismiss.addEventListener('click', function () { actions.remove(); wrap.classList.add('resolved'); vscode.postMessage({ type: 'modeSuggestionResponse', id: m.id, accepted: false }); });
		var accept = document.createElement('button'); accept.className = 'suggest-accept'; accept.type = 'button';
		accept.innerHTML = ic(meta.icon) + '<span class="suggest-accept-label"></span><span class="kbd">' + (planIsMac ? '\\u2318\\u21a9' : 'Ctrl+\\u21a9') + '</span>';
		accept.querySelector('.suggest-accept-label').textContent = meta.verb;
		accept.addEventListener('click', function () {
			actions.remove(); wrap.classList.add('resolved');
			var text = refined || lastSent;
			if (target === 'fork') {
				vscode.postMessage({ type: 'modeSuggestionResponse', id: m.id, accepted: true });
				// rama nueva que hereda el contexto (handler existente); sembramos el composer con
				// el pedido reformulado para que el usuario ajuste y dispare la rama divergente.
				if (activeSessionId) { vscode.postMessage({ type: 'forkSession', id: activeSessionId }); }
				if (text) { promptEl.value = text; autosize(); updateSendEnabled(); promptEl.focus(); }
			} else {
				// Transición silenciosa: el host reutiliza el mismo turno user y reanuda con la flag
				// de modo nueva. No insertar otro globo/prompt visual en el transcript.
				applyMode(target);
				vscode.postMessage({ type: 'modeSuggestionResponse', id: m.id, accepted: true, mode: target, prompt: text });
			}
		});
		actions.appendChild(dismiss); actions.appendChild(accept);
		card.appendChild(actions);
		wrap.appendChild(card); appendToFlow(wrap); scrollDown();
	}

	// ---- composer ----
	function setBusy(b) {
		busy = b;
		followBtn.classList.toggle('tracking', followEnabled && b);
		if (b) { sendBtn.classList.add('running'); sendBtn.innerHTML = '<span class="stop-square"></span>'; sendBtn.setAttribute('data-tip', 'Stop'); sendBtn.disabled = false; sendBtn.hidden = false; micBtn.hidden = true; }
		else { finishRunningTermCards(); finalizeExploreGroup(); sendBtn.classList.remove('running'); sendBtn.innerHTML = ic('arrow-up'); sendBtn.setAttribute('data-tip', 'Send (Enter)'); updateSendEnabled(); removeGenerating(); removeApprovals(); }
		// El stop pertenece al estado del run, no a la bandeja de archivos: mantenerlo visible
		// en el composer durante toda la tarea aunque cambien prompt, approvals o trays.
		if (b) { sendBtn.hidden = false; sendBtn.disabled = false; }
		syncFilesTrayActions();
	}
	function setFollowState(enabled) {
		followEnabled = !!enabled;
		followBtn.classList.toggle('active', followEnabled);
		followBtn.classList.toggle('tracking', followEnabled && busy);
		followBtn.setAttribute('aria-pressed', followEnabled ? 'true' : 'false');
		followBtn.setAttribute('data-tip', followEnabled
			? 'Dejar de seguir al agente'
			: 'Seguir al agente — muestra archivos, ediciones, terminal y browser mientras trabaja');
	}
	function updateSendEnabled() {
		if (!busy) { sendBtn.disabled = !promptEl.value.trim() && !attachments.length && !fileReferences.length && !selectedCapabilities.length && !composerLinks.length; }
		// UN solo slot a la derecha (integrado): composer vacío → mic (dictado); con
		// contenido o run activo → enviar/stop. Grabando/transcribiendo, el mic no se va.
		var showSend = busy || !!promptEl.value.trim() || !!attachments.length || !!fileReferences.length || !!selectedCapabilities.length || !!composerLinks.length;
		if (micState !== 'idle') { showSend = false; }
		sendBtn.hidden = !showSend;
		micBtn.hidden = showSend;
	}
	function autosize() { promptEl.style.height = 'auto'; promptEl.style.height = Math.min(180, promptEl.scrollHeight) + 'px'; }
	var lastSent = '';          // último texto despachado (para reenviar si suggest_mode no trae prompt)
	function composerPayload(inputText, capabilities, links) {
		var plain = String(inputText || '').trim();
		var mentions = (capabilities || []).slice();
		var labels = mentions.map(function (capability) { return '/' + capability.name; }).join(' ');
		var command = mentions.find(function (capability) { return capability.kind === 'command'; });
		var linkText = (links || []).join('\\n');
		var content = [plain, linkText].filter(Boolean).join('\\n');
		return {
			text: command ? ('/' + command.name + (content ? ' ' + content : '')) : (content || labels),
			displayText: [labels, plain].filter(Boolean).join(' '),
		};
	}
	function dispatchSend(text, imgs, displayText, references, capabilities, links, providerId, targetModel) {
		lastSent = text;
		// /compact es una acción local del historial: no se agrega como turno de usuario ni se
		// manda al modelo. El host devuelve una tarjeta de progreso/resultado persistente.
		if (String(text || '').trim().toLowerCase() === '/compact' && !(imgs || []).length && !(references || []).length && !(links || []).length) {
			assistant = null; reasoning = null; exploreActive = 0;
			setBusy(true); ensureGenerating();
			vscode.postMessage({ type: 'compact' });
			return;
		}
		var visibleText = displayText !== undefined ? displayText : text;
		addUser(visibleText || (references && references.length ? references.map(basename).join(', ') : ''), imgs, capabilities, links);   // UI limpia; archivos/links viajan completos
		assistant = null; reasoning = null;
		exploreActive = 0;
		setBusy(true);
		ensureGenerating(); // feedback inmediato hasta el primer token/tool
		vscode.postMessage({
			type: 'send', text: text, images: imgs, mode: mode, displayText: displayText || undefined,
			references: references || [], capabilities: capabilities || [],
			providerId: providerId || undefined, model: targetModel || undefined
		});
	}
	function send() {
		harvestPromptLinks();
		var inputText = promptEl.value.trim();
		var capabilities = selectedCapabilities.slice();
		var links = composerLinks.slice();
		var payload = composerPayload(inputText, capabilities, links);
		if (busy) {
			// composer con contenido → se ENCOLA (integrado); vacío → stop.
			if (!inputText && !attachments.length && !fileReferences.length && !capabilities.length && !links.length) { vscode.postMessage({ type: 'abort' }); setBusy(false); return; }
			queue.push({ text: payload.text, inputText: inputText, displayText: payload.displayText, images: attachments.slice(), references: fileReferences.slice(), capabilities: capabilities, links: links });
			promptEl.value = ''; autosize();
			attachments = []; fileReferences = []; selectedCapabilities = []; composerLinks = []; renderAttachments(); renderFileReferences(); renderCapabilityChips(); renderLinkChips(); updateSendEnabled();
			renderQueue();
			return;
		}
		if (!inputText && !attachments.length && !fileReferences.length && !capabilities.length && !links.length) { return; }
		var imgs = attachments.slice();
		var references = fileReferences.slice();
		promptEl.value = ''; autosize();
		attachments = []; fileReferences = []; selectedCapabilities = []; composerLinks = []; renderAttachments(); renderFileReferences(); renderCapabilityChips(); renderLinkChips();
		dispatchSend(payload.text, imgs, payload.displayText, references, capabilities, links);
	}

	// ---- cola de mensajes (en el composer dock) ----
	function renderQueue() {
		if (!queue.length) { removeTray('queue'); return; }
		var el = ensureTray('queue', 'queue-tray');
		var expanded = el.getAttribute('data-expanded') !== '0';
		el.innerHTML = '';
		var head = document.createElement('div'); head.className = 'dock-head';
		var toggle = document.createElement('button'); toggle.className = 'dock-toggle'; toggle.type = 'button';
		toggle.innerHTML = ic(expanded ? 'chevron-down' : 'chevron-right') + '<span>' + (queue.length === 1 ? '1 in queue' : (queue.length + ' in queue')) + '</span>';
		toggle.addEventListener('click', function () { el.setAttribute('data-expanded', expanded ? '0' : '1'); renderQueue(); });
		head.appendChild(toggle); el.appendChild(head);
		if (expanded) {
			var body = document.createElement('div'); body.className = 'dock-body';
			queue.forEach(function (it, idx) {
				var row = document.createElement('div'); row.className = 'dock-queue-row';
				row.innerHTML = ic('circle-large-outline') + '<span class="dock-queue-text"></span><span class="dock-queue-actions">' +
					'<button class="dock-icon-btn q-edit" data-tip="Editar">' + ic('edit') + '</button>' +
					'<button class="dock-icon-btn q-now" data-tip="Enviar ahora">' + ic('arrow-up') + '</button>' +
					'<button class="dock-icon-btn q-del" data-tip="Quitar">' + ic('trash') + '</button></span>';
				row.querySelector('.dock-queue-text').textContent = it.displayText || ((it.links || []).map(linkLabel).join(', ')) || it.text || ((it.references || []).map(basename).join(', ')) || '(imagen)';
				row.querySelector('.q-edit').addEventListener('click', function () {
					promptEl.value = it.inputText || ''; attachments = (it.images || []).map(function (img) { return { mimeType: img.mimeType, data: img.data }; });
					fileReferences = (it.references || []).slice(); selectedCapabilities = (it.capabilities || []).slice(); composerLinks = (it.links || []).slice();
					renderAttachments(); renderFileReferences(); renderCapabilityChips(); renderLinkChips(); autosize(); updateSendEnabled(); promptEl.focus();
					queue.splice(idx, 1); renderQueue();
				});
				row.querySelector('.q-del').addEventListener('click', function () { queue.splice(idx, 1); renderQueue(); });
				row.querySelector('.q-now').addEventListener('click', function () {
					queue.splice(idx, 1); renderQueue();
					if (busy) { vscode.postMessage({ type: 'abort' }); setBusy(false); }
					dispatchSend(it.text, it.images || [], it.displayText, it.references || [], it.capabilities || [], it.links || []);
				});
				body.appendChild(row);
			});
			el.appendChild(body);
		}
	}
	function drainQueue() {
		if (busy || !queue.length) { return; }
		var it = queue.shift();
		renderQueue();
		dispatchSend(it.text, it.images, it.displayText, it.references || [], it.capabilities || [], it.links || []);
	}

	// ---- chip de Pick & Polish (el host guarda contexto + screenshot; acá solo se muestra) ----
	var pickChipEl = document.getElementById('pickChip');
	function renderPickChip(selector) {
		pickChipEl.innerHTML = '';
		if (!selector) { pickChipEl.hidden = true; return; }
		pickChipEl.hidden = false;
		var icon = document.createElement('span'); icon.className = 'codicon codicon-inspect';
		var sel = document.createElement('span'); sel.className = 'pick-sel'; sel.textContent = selector;
		sel.setAttribute('data-tip', 'Elemento seleccionado en la app (se adjunta al próximo mensaje)');
		var x = document.createElement('button'); x.className = 'pick-x'; x.type = 'button';
		x.setAttribute('data-tip', 'Quitar elemento');
		x.innerHTML = ic('close');
		x.addEventListener('click', function () { renderPickChip(''); vscode.postMessage({ type: 'pickRemove' }); });
		pickChipEl.appendChild(icon); pickChipEl.appendChild(sel); pickChipEl.appendChild(x);
		promptEl.focus();
	}

	// ---- adjuntos (imágenes: paste, drag o picker) ----
	function renderAttachments() {
		attachStrip.innerHTML = '';
		attachStrip.hidden = !attachments.length;
		attachments.forEach(function (img, idx) {
			var chip = document.createElement('div'); chip.className = 'attach-chip';
			var im = document.createElement('img'); im.src = 'data:' + img.mimeType + ';base64,' + img.data;
			im.addEventListener('click', function (e) { e.stopPropagation(); openImagePreview(im.src); });
			var rm = document.createElement('button'); rm.className = 'attach-remove'; rm.type = 'button'; rm.title = 'Quitar';
			rm.innerHTML = ic('close');
			rm.addEventListener('click', function () { attachments.splice(idx, 1); renderAttachments(); updateSendEnabled(); });
			chip.appendChild(im); chip.appendChild(rm); attachStrip.appendChild(chip);
		});
	}
	function addAttachmentFile(file) {
		if (!file || !/^image\\/(png|jpeg|gif|webp)$/.test(file.type) || attachments.length >= 6) { return; }
		var reader = new FileReader();
		reader.onload = function () {
			var url = String(reader.result || '');
			var comma = url.indexOf(',');
			if (comma < 0) { return; }
			attachments.push({ mimeType: file.type, data: url.slice(comma + 1) });
			renderAttachments(); updateSendEnabled();
		};
		reader.readAsDataURL(file);
	}

	// ---- dock del composer (integrado) ----
	// Files + background terminals: bandejas flotantes DETRAS del compositor (integrado).
	// cola / aprobaciones / term foreground: #composerDock (también dentro del inputCard).
	var TRAY_PARENT = { todos: 'top', subagents: 'files', queue: 'files', files: 'files', terms: 'files' };
	function syncComposerDock() {
		composerDockEl.hidden = !composerDockEl.childElementCount;
	}
	function placeTray(el, kind) {
		el.setAttribute('data-prio', TRAY_PRIORITY[kind] || 9);
		var parent = composerDockEl;
		if (TRAY_PARENT[kind] === 'top') { parent = topDockEl; }
		else if (TRAY_PARENT[kind] === 'files') { parent = filesStackEl; }
		var prio = TRAY_PRIORITY[kind] || 9;
		var before = null;
		for (var i = 0; i < parent.children.length; i++) {
			var k = parent.children[i];
			if (parseInt(k.getAttribute('data-prio') || '9', 10) > prio) { before = k; break; }
		}
		if (before) { parent.insertBefore(el, before); } else { parent.appendChild(el); }
		if (parent === composerDockEl) { syncComposerDock(); }
	}
	function ensureTray(kind, className) {
		if (trays[kind]) { return trays[kind]; }
		var el = document.createElement('div'); el.className = 'dock-section ' + (className || '');
		trays[kind] = el; placeTray(el, kind);
		return el;
	}
	function removeTray(kind) {
		if (trays[kind]) { trays[kind].remove(); delete trays[kind]; syncComposerDock(); }
	}
	function paintTodoPanel(host, items, expanded, onToggle) {
		items = Array.isArray(items) ? items : [];
		var done = items.filter(function (it) { return it.status === 'completed'; }).length;
		var allDone = items.length > 0 && done === items.length;
		var current = null;
		for (var i = 0; i < items.length; i++) { if (items[i].status === 'in-progress') { current = items[i]; break; } }
		if (!current) { for (var j = 0; j < items.length; j++) { if (items[j].status === 'pending') { current = items[j]; break; } } }
		if (!current && items.length) { current = items[items.length - 1]; }

		host.innerHTML = '';
		var head = document.createElement('div'); head.className = 'tt-head';
		var toggle = document.createElement('button'); toggle.className = 'tt-toggle'; toggle.type = 'button';
		var caret = expanded ? 'chevron-down' : (allDone ? 'checklist' : 'arrow-circle-right');
		toggle.innerHTML = ic(caret) + '<span class="tt-title marquee-viewport"><span class="marquee-content"></span></span>';
		var titleEl = toggle.querySelector('.marquee-content');
		titleEl.textContent = expanded ? 'Tareas' : (current ? (current.title || 'Tareas') : 'Sin tareas');
		toggle.addEventListener('click', onToggle);
		head.appendChild(toggle);
		var prog = document.createElement('span'); prog.className = 'tt-prog'; prog.textContent = done + '/' + items.length;
		head.appendChild(prog);
		host.appendChild(head);
		if (expanded && items.length) {
			var body = document.createElement('div'); body.className = 'tt-body';
			items.forEach(function (it) {
				var status = it.status || 'pending';
				var row = document.createElement('div'); row.className = 'tt-row s-' + status;
				var glyph = status === 'completed' ? 'pass' : status === 'in-progress' ? 'arrow-right' : 'circle-large-outline';
				row.innerHTML = '<span class="codicon codicon-' + glyph + ' tt-icon"></span><span class="tt-text"></span>';
				row.querySelector('.tt-text').textContent = it.title || '';
				body.appendChild(row);
			});
			host.appendChild(body);
		}
	}

	function renderTodos(items) {
		if (items) { lastTodoItems = items; }
		items = lastTodoItems;
		removeTray('todos');
		if (!items || !items.length) {
			if (turnTodosHost) { turnTodosHost.hidden = true; turnTodosHost.innerHTML = ''; }
			if (todosFallback) { todosFallback.remove(); todosFallback = null; }
			return;
		}
		var host = turnTodosHost;
		if (!host) {
			// Sin turno activo: conserva un estado compacto en el flujo, pero separado de los
			// snapshots históricos que deja cada llamada a update_todos.
			if (!todosFallback) { todosFallback = document.createElement('div'); appendToFlow(todosFallback); }
			host = todosFallback;
			host.className = 'turn-todos';
		} else {
			host.hidden = false;
			host.className = 'turn-todos';
		}
		if (!host.hasAttribute('data-expanded')) { host.setAttribute('data-expanded', '0'); }
		var expanded = host.getAttribute('data-expanded') === '1';
		paintTodoPanel(host, items, expanded, function () {
			host.setAttribute('data-expanded', expanded ? '0' : '1');
			renderTodos();
		});
	}

	function appendTodoUpdate(items) {
		var snapshot = (Array.isArray(items) ? items : []).map(function (it) {
			return { id: it.id, title: it.title || '', status: it.status || 'pending' };
		});
		assistant = null; finalizeReasoning(); finalizeExploreGroup(); removeGenerating();
		var host = document.createElement('div'); host.className = 'todo-update'; host.setAttribute('data-expanded', '1');
		function repaint() {
			var expanded = host.getAttribute('data-expanded') === '1';
			paintTodoPanel(host, snapshot, expanded, function () {
				host.setAttribute('data-expanded', expanded ? '0' : '1');
				repaint();
			});
		}
		repaint(); appendToFlow(host); scrollDown();
	}

	function handleTodoUpdate(items) {
		renderTodos(items);
		appendTodoUpdate(items);
	}

	function renderBgTerm(m) {
		if (m.status === 'exited') {
			if (termRows[m.id]) { termRows[m.id].remove(); delete termRows[m.id]; }
			var rest = Object.keys(termRows).length;
			if (!rest) { removeTray('terms'); }
			else { updateBgTermHead(); }
			return;
		}
		var el = ensureTray('terms', 'terms-tray');
		if (!el.getAttribute('data-init')) {
			el.setAttribute('data-init', '1'); el.setAttribute('data-expanded', '1');
			var head = document.createElement('div'); head.className = 'dock-head';
			var toggle = document.createElement('button'); toggle.className = 'dock-toggle'; toggle.type = 'button';
			toggle.innerHTML = ic('chevron-down') + '<span class="dock-bg-count shimmer"></span>';
			toggle.addEventListener('click', function () {
				var exp = el.getAttribute('data-expanded') === '1'; el.setAttribute('data-expanded', exp ? '0' : '1');
				toggle.firstChild.outerHTML = ic(exp ? 'chevron-right' : 'chevron-down');
				var list = el.querySelector('.dock-body'); if (list) { list.hidden = exp; }
			});
			head.appendChild(toggle); el.appendChild(head);
			var body = document.createElement('div'); body.className = 'dock-body'; el.appendChild(body);
		}
		var listEl = el.querySelector('.dock-body');
		var row = termRows[m.id];
		if (!row) {
			row = document.createElement('div'); row.className = 'dock-bg-row running'; row.setAttribute('data-id', m.id);
			row.innerHTML = ic('terminal') + '<span class="dock-bg-label shimmer"></span>' +
				'<button class="term-stop" data-tip="Stop" data-kill="' + m.id + '">' + ic('close') + '</button>';
			row.querySelector('.term-stop').addEventListener('click', function (e) {
				e.stopPropagation(); vscode.postMessage({ type: 'killTerminal', id: m.id });
			});
			listEl.appendChild(row); termRows[m.id] = row;
		}
		row.querySelector('.dock-bg-label').textContent = m.command || '';
		updateBgTermHead();
	}
	function updateBgTermHead() {
		var el = trays['terms']; if (!el) { return; }
		var n = Object.keys(termRows).length;
		var tc = el.querySelector('.dock-bg-count');
		if (tc) { tc.textContent = n === 1 ? '1 Background Terminal' : (n + ' Background Terminals'); }
	}

	function renderFileDiff(m) {
		if (!m.added && !m.removed) {
			var done = fileRows[m.path];
			if (done) { done.remove(); delete fileRows[m.path]; delete fileIcons[m.path]; updateFilesCount(); }
			return;
		}
		if (m.icon) { fileIcons[m.path] = m.icon; }
		var el = ensureTray('files', 'files-tray');
		if (!el.getAttribute('data-init')) {
			el.setAttribute('data-init', '1'); el.setAttribute('data-expanded', '1');
			var head = document.createElement('div'); head.className = 'dock-head';
			var toggle = document.createElement('button'); toggle.className = 'dock-toggle'; toggle.type = 'button';
			toggle.innerHTML = ic('chevron-down') + '<span class="dock-files-count"></span>';
			toggle.addEventListener('click', function () {
				var exp = el.getAttribute('data-expanded') === '1'; el.setAttribute('data-expanded', exp ? '0' : '1');
				toggle.firstChild.outerHTML = ic(exp ? 'chevron-right' : 'chevron-down');
				var list = el.querySelector('.dock-body'); if (list) { list.hidden = exp; }
			});
			head.appendChild(toggle);
			var spacer = document.createElement('span'); spacer.className = 'dock-spacer'; head.appendChild(spacer);
			var actions = document.createElement('span'); actions.className = 'dock-head-actions';
			var stopBtn = document.createElement('button'); stopBtn.className = 'dock-stop-action'; stopBtn.type = 'button'; stopBtn.innerHTML = '<span>Stop</span><span class="dock-kbd">Ctrl+Shift+Backspace</span>';
			stopBtn.setAttribute('data-tip', 'Stop');
			stopBtn.addEventListener('click', function (e) { e.stopPropagation(); vscode.postMessage({ type: 'abort' }); setBusy(false); });
			var undoAllBtn = document.createElement('button'); undoAllBtn.className = 'dock-bulk-action dock-undo-all'; undoAllBtn.type = 'button'; undoAllBtn.textContent = 'Undo All';
			undoAllBtn.setAttribute('data-tip', 'Deshacer todos los cambios');
			undoAllBtn.addEventListener('click', function (e) { e.stopPropagation(); resolveAllFileRows('revertFile'); });
			var keepAllBtn = document.createElement('button'); keepAllBtn.className = 'dock-bulk-action dock-keep-all'; keepAllBtn.type = 'button'; keepAllBtn.textContent = 'Keep All';
			keepAllBtn.setAttribute('data-tip', 'Conservar todos los cambios');
			keepAllBtn.addEventListener('click', function (e) { e.stopPropagation(); keepAllFileRows(); });
			var reviewBtn = document.createElement('button'); reviewBtn.className = 'dock-btn dock-review-btn'; reviewBtn.type = 'button'; reviewBtn.textContent = 'Review';
			reviewBtn.setAttribute('data-tip', 'Revisar cambios en el editor');
			reviewBtn.addEventListener('click', function () {
				var paths = Object.keys(fileRows);
				if (paths.length) { vscode.postMessage({ type: 'openDiff', path: paths[0] }); }
			});
			actions.appendChild(stopBtn); actions.appendChild(undoAllBtn); actions.appendChild(keepAllBtn); actions.appendChild(reviewBtn); head.appendChild(actions);
			el.appendChild(head);
			var list = document.createElement('div'); list.className = 'dock-body'; el.appendChild(list);
			syncFilesTrayActions();
		}
		var listEl = el.querySelector('.dock-body');
		var row = fileRows[m.path];
		if (!row) {
			row = document.createElement('div'); row.className = 'dock-file-row'; row.setAttribute('data-path', m.path);
			var icon = document.createElement('span'); icon.className = 'ficon';
			var name = document.createElement('span'); name.className = 'dock-file-name';
			var add = document.createElement('span'); add.className = 'dock-diff-add';
			var rem = document.createElement('span'); rem.className = 'dock-diff-del';
			var actions = document.createElement('span'); actions.className = 'dock-file-actions';
			var reject = document.createElement('button'); reject.className = 'dock-file-action reject'; reject.type = 'button';
			reject.setAttribute('data-tip', 'Reject'); reject.innerHTML = ic('close');
			reject.addEventListener('click', function (e) {
				e.preventDefault(); e.stopPropagation();
				resolveFileRow(m.path, 'revertFile');
			});
			var accept = document.createElement('button'); accept.className = 'dock-file-action accept'; accept.type = 'button';
			accept.setAttribute('data-tip', 'Accept'); accept.innerHTML = ic('check');
			accept.addEventListener('click', function (e) {
				e.preventDefault(); e.stopPropagation();
				resolveFileRow(m.path, 'keepFile');
			});
			actions.appendChild(reject); actions.appendChild(accept);
			row.appendChild(icon); row.appendChild(name); row.appendChild(add); row.appendChild(rem); row.appendChild(actions);
			listEl.appendChild(row); fileRows[m.path] = row;
		}
		var icn = fileIcons[m.path];
		var iconEl = row.querySelector('.ficon, .codicon-file');
		applyFileThemeIcon(iconEl, m.path, icn);
		row.querySelector('.dock-file-name').textContent = basename(m.path);
		row.querySelector('.dock-file-name').title = m.path;
		row.querySelector('.dock-diff-add').textContent = m.added ? ('+' + m.added) : '';
		row.querySelector('.dock-diff-del').textContent = m.removed ? ('\\u2212' + m.removed) : '';
		updateFilesCount();
	}
	function updateFilesCount() {
		var el = trays['files'];
		if (!el) { return; }
		var n = Object.keys(fileRows).length;
		if (!n) { removeTray('files'); return; }
		var tc = el.querySelector('.dock-files-count');
		if (tc) { tc.textContent = n + (n === 1 ? ' File' : ' Files'); }
	}
	function syncFilesTrayActions() {
		var el = trays['files'];
		var stopBtn = el && el.querySelector('.dock-stop-action');
		if (stopBtn) { stopBtn.hidden = !busy; }
		var undoAll = el && el.querySelector('.dock-undo-all');
		var keepAll = el && el.querySelector('.dock-keep-all');
		if (undoAll) { undoAll.hidden = busy; }
		if (keepAll) { keepAll.hidden = busy; }
	}
	function resolveAllFileRows(act) {
		Object.keys(fileRows).forEach(function (path) { resolveFileRow(path, act); });
	}
	function keepAllFileRows() {
		var paths = Object.keys(fileRows);
		if (!paths.length) { return; }
		// Un único mensaje evita que un restart interrumpa N aceptaciones independientes; el host
		// borra el snapshot como transacción y fuerza el flush antes de completar.
		vscode.postMessage({ type: 'keepFiles', paths: paths });
		paths.forEach(function (path) {
			var row = fileRows[path];
			if (row) { row.remove(); }
			delete fileRows[path]; delete fileIcons[path];
		});
		updateFilesCount();
	}
	function resolveFileRow(path, act) {
		vscode.postMessage({ type: act, path: path });
		var row = fileRows[path];
		if (row) { row.remove(); delete fileRows[path]; delete fileIcons[path]; }
		updateFilesCount();
	}

	// Stepper de preguntas (batch 1..5, estilo ghost): una pregunta por vez, dots de progreso,
	// elegir una opción avanza sola; texto libre u omitir avanzan con los botones.
	// ---- aprobación INLINE: card dockeada arriba del composer (en el box del chat) ----
	// aprobación INLINE en el HILO del chat (no en el dock): card estilizada que aparece en el
	// transcript. Se remueve al decidir o al terminar el run.
	var approvals = {};
	function removeApprovals() { for (var k in approvals) { if (approvals[k]) { if (approvals[k]._cleanup) { approvals[k]._cleanup(); } approvals[k].remove(); } } approvals = {}; }
	function renderApproval(m) {
		assistant = null; finalizeReasoning(); removeGenerating();
		var el = document.createElement('div');
		var visualKind = toolVisualKind(String(m.tool || ''));
		el.className = 'approval open ' + (m.risk === 'exec' ? 'exec' : 'write') + ' tool-kind-' + visualKind.id;
		var head = document.createElement('button'); head.className = 'approval-head'; head.type = 'button';
		head.innerHTML = '<span class="approval-title"></span><span style="flex:1"></span><span class="approval-kind"></span><span class="approval-chevron">' + ic('chevron-down') + '</span>';
		var approvalTitle = head.querySelector('.approval-title');
		approvalTitle.textContent = String(m.tool || (m.risk === 'exec' ? 'run_command' : 'edit_file'));
		head.querySelector('.approval-kind').textContent = visualKind.label;
		var approvalChevron = head.querySelector('.approval-chevron');
		head.addEventListener('click', function () {
			var opened = el.classList.toggle('open');
			approvalChevron.innerHTML = ic(opened ? 'chevron-down' : 'chevron-right');
		});
		var context = String(m.command || m.detail || '').trim();
		el.appendChild(head);
		var body = document.createElement('div'); body.className = 'approval-body';
		var requestLabel = document.createElement('div'); requestLabel.className = 'approval-request-label'; requestLabel.textContent = 'Permiso requerido';
		body.appendChild(requestLabel);
		var description = document.createElement('div'); description.className = 'approval-description';
		description.textContent = m.title || (m.risk === 'exec' ? 'Ejecutar comando' : 'Editar archivo');
		body.appendChild(description);
		if (context) {
			var command = document.createElement('pre'); command.className = 'approval-cmd'; command.textContent = context;
			body.appendChild(command);
		}
		if (m.sensitive) {
			var note = document.createElement('div'); note.className = 'approval-note';
			note.textContent = 'Ruta sensible: se vuelve a preguntar en cada uso.';
			body.appendChild(note);
		}
		var actions = document.createElement('div'); actions.className = 'approval-actions';
		var primaryGroup = document.createElement('span'); primaryGroup.className = 'approval-primary-group';
		var moreAnchor = document.createElement('span'); moreAnchor.className = 'approval-more-anchor';
		var menu = document.createElement('div'); menu.className = 'menu approval-menu'; menu.hidden = true;
		var menuContent = document.createElement('div'); menuContent.className = 'menu-content'; menu.appendChild(menuContent);
		function closeApprovalMenu() { menu.hidden = true; }
		function cleanup() { document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', keydown, true); }
		function decide(decision) { cleanup(); el.remove(); delete approvals[m.id]; vscode.postMessage({ type: 'approvalResponse', id: m.id, decision: decision }); }
		var once = document.createElement('button'); once.className = 'abtn primary'; once.type = 'button';
		once.innerHTML = '<span>Permitir</span><span class="abtn-kbd">Ctrl+Enter</span>';
		once.addEventListener('click', function () { decide('once'); });
		var more = document.createElement('button'); more.className = 'abtn more'; more.type = 'button';
		more.innerHTML = ic('chevron-down'); more.setAttribute('data-tip', 'Más opciones de permiso');
		more.addEventListener('click', function (ev) { ev.stopPropagation(); menu.hidden = !menu.hidden; });
		function addChoice(label, iconName, decision, danger) {
			var button = document.createElement('button'); button.type = 'button'; button.className = 'menu-row' + (danger ? ' danger' : '');
			button.innerHTML = '<span class="menu-row-icon">' + ic(iconName) + '</span><span class="menu-label"></span>';
			button.querySelector('.menu-label').textContent = label;
			button.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
			button.addEventListener('click', function () { decide(decision); });
			menuContent.appendChild(button);
		}
		addChoice('Permitir esta sesión', 'history', 'session', false);
		if (!m.sensitive) { addChoice('Permitir siempre', 'shield', 'always', false); }
		addChoice('Rechazar', 'close', 'deny', true);
		moreAnchor.appendChild(more); moreAnchor.appendChild(menu);
		primaryGroup.appendChild(once); primaryGroup.appendChild(moreAnchor);
		actions.appendChild(primaryGroup);
		var deny = document.createElement('button'); deny.className = 'abtn deny'; deny.type = 'button';
		deny.innerHTML = '<span>Rechazar</span><span class="abtn-kbd">Esc</span>';
		deny.addEventListener('click', function () { decide('deny'); });
		actions.appendChild(deny);
		body.appendChild(actions);
		el.appendChild(body);
		function outside(ev) { if (!menu.hidden && !moreAnchor.contains(ev.target)) { closeApprovalMenu(); } }
		function keydown(ev) {
			if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); decide('once'); }
			else if (ev.key === 'Escape') { ev.preventDefault(); if (!menu.hidden) { closeApprovalMenu(); } else { decide('deny'); } }
		}
		document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', keydown, true);
		el._cleanup = cleanup;
		appendToFlow(el); approvals[m.id] = el; scrollDown();
	}
	// Decisión de permiso resuelta. Las concesiones (once/session/always) NO dejan rastro:
	// la tool card / edit-card ya es la representación canónica (shimmer + filename como
	// Thinking). Sólo los rechazos se anotan, y como línea plana estilo reasoning — sin card,
	// sin badge TOOL, sin "permitido".
	function permissionToolLabel(name) {
		var labels = { run_command: 'Run command', edit_file: 'Edit file', write_file: 'Write file', delete_file: 'Delete file', terminal_send: 'Terminal send' };
		return labels[name] || String(name || '').replace(/_/g, ' ');
	}
	function addDecisionRow(name, decision) {
		// Permitido: silencio. La edit-card / term-card / tool-activity (shimmer) ya cuenta la acción.
		if (decision !== 'deny') { return; }
		assistant = null; finalizeReasoning(); removeGenerating();
		// Misma línea plana que Thinking/Exploring: sin card, sin badge TOOL.
		var row = document.createElement('div'); row.className = 'decision-line deny';
		var label = document.createElement('span'); label.className = 'dlabel';
		label.textContent = 'Rechazado · ' + permissionToolLabel(name);
		row.appendChild(label);
		appendToFlow(row); scrollDown();
	}
	function renderAsk(m) {
		assistant = null; finalizeReasoning();
		var questions = m.questions || (m.question ? [{ question: m.question, options: m.options }] : []);
		if (!questions.length) { return; }
		var el = document.createElement('div');
		el.className = 'qpanel';            // va en el hilo del chat (no en el composer)
		appendToFlow(el); scrollDown();
		var idx = 0;
		var answers = questions.map(function () { return ''; });
		var answerImages = questions.map(function () { return []; });
		function imageContext(images) { return images.map(function (img, i) { return '[image-' + (i + 1) + ': data:' + img.mimeType + ';base64,' + img.data + ']'; }).join('\\n'); }
		function finish() {
			var answer;
			if (questions.length === 1) { answer = (answers[0] || '(omitida)') + (answerImages[0].length ? '\\n' + imageContext(answerImages[0]) : ''); }
			else {
				answer = questions.map(function (q, i) {
					return 'P: ' + (q.question || '') + '\\nR: ' + (answers[i] || '(omitida)') + (answerImages[i].length ? '\\n' + imageContext(answerImages[i]) : '');
				}).join('\\n\\n');
			}
			// la respuesta queda EN EL TEXTO del transcript (estilo ghost: pregunta + check respuesta)
			var block = document.createElement('div'); block.className = 'q-summary-block';
			questions.forEach(function (q, i) {
				var s = document.createElement('div'); s.className = 'q-summary';
				var qt = document.createElement('div'); qt.className = 'q-summary-q'; qt.textContent = q.question || '';
				var a = document.createElement('div'); a.className = 'q-summary-a';
				a.innerHTML = ic('pass-filled') + '<span></span>';
				a.querySelector('span:last-child').textContent = answers[i] || '(omitida)';
				s.appendChild(qt); s.appendChild(a);
				if (answerImages[i].length) { var summaryImages = document.createElement('div'); summaryImages.className = 'qimages'; answerImages[i].forEach(function (img, imageIndex) { appendAskImageChip(summaryImages, img, imageIndex, null); }); s.appendChild(summaryImages); }
				block.appendChild(s);
			});
			appendToFlow(block);
			vscode.postMessage({ type: 'askResponse', id: m.id, answer: answer });
			el.remove();
			scrollDown();
		}
		function appendAskImageChip(host, img, imageIndex, remove) {
			var chip = document.createElement('span'); chip.className = 'qimage-chip'; chip.innerHTML = ic('file-media') + '<span>image-' + (imageIndex + 1) + '</span>';
			var preview = document.createElement('div'); preview.className = 'qimage-preview'; var image = document.createElement('img'); image.src = 'data:' + img.mimeType + ';base64,' + img.data; image.alt = 'image-' + (imageIndex + 1); preview.appendChild(image); document.body.appendChild(preview);
			chip.addEventListener('mouseenter', function () { var rect = chip.getBoundingClientRect(); preview.style.left = Math.min(window.innerWidth - 250, Math.max(8, rect.left)) + 'px'; preview.style.top = Math.max(8, rect.top - 190) + 'px'; preview.classList.add('show'); });
			chip.addEventListener('mouseleave', function () { preview.classList.remove('show'); });
			if (remove) { var removeBtn = document.createElement('button'); removeBtn.type = 'button'; removeBtn.className = 'qimage-remove'; removeBtn.innerHTML = ic('close'); removeBtn.setAttribute('aria-label', 'Quitar image-' + (imageIndex + 1)); removeBtn.addEventListener('click', function () { preview.remove(); remove(); }); chip.appendChild(removeBtn); }
			host.appendChild(chip);
		}
		function readAskImage(file, done) { if (!file || !/^image\\/(png|jpeg|gif|webp)$/.test(file.type)) { return; } var reader = new FileReader(); reader.onload = function () { var raw = String(reader.result || ''); var comma = raw.indexOf(','); if (comma >= 0) { done({ mimeType: file.type, data: raw.slice(comma + 1) }); } }; reader.readAsDataURL(file); }
		function advance() {
			if (idx + 1 < questions.length) { idx++; renderStep(); } else { finish(); }
		}
		function renderStep() {
			var q = questions[idx];
			el.innerHTML = '';
			var head = document.createElement('div'); head.className = 'qpanel-head';
			head.innerHTML = ic('question') + '<span class="qpanel-title"></span><span class="tray-spacer"></span><span class="qdots"></span>';
			head.querySelector('.qpanel-title').textContent = questions.length > 1 ? ('Pregunta ' + (idx + 1) + ' de ' + questions.length) : 'Pregunta';
			var dots = head.querySelector('.qdots');
			if (questions.length > 1) {
				questions.forEach(function (_qq, i) {
					var d = document.createElement('span');
					d.className = 'qdot' + (i === idx ? ' on' : (answers[i] ? ' done' : ''));
					dots.appendChild(d);
				});
			}
			el.appendChild(head);
			var qEl = document.createElement('div'); qEl.className = 'qpanel-q'; qEl.textContent = q.question || ''; el.appendChild(qEl);
			var selected = { value: answers[idx] || '' };
			var custom = null;
			var customRow = null;
			var imageStrip = null;
			var opts = document.createElement('div'); opts.className = 'qopts';
			(q.options || []).forEach(function (o) {
				var b = document.createElement('button'); b.className = 'qopt' + (selected.value === o ? ' selected' : ''); b.type = 'button';
				b.innerHTML = '<span class="qradio">' + ic(selected.value === o ? 'pass-filled' : 'circle-large') + '</span><span class="qopt-body"><span></span></span>';
				b.querySelector('.qopt-body span').textContent = o;
				b.addEventListener('click', function () {
					answers[idx] = o;
					advance();          // elegir una opción avanza al siguiente paso (ghost-style)
				});
				opts.appendChild(b);
			});
			if (m.allowFreeText !== false) {
				var row = document.createElement('div'); row.className = 'qopt qcustom-row';
				customRow = row;
				row.innerHTML = '<span class="qradio">' + ic('circle-large') + '</span><span class="qopt-body"></span>';
				var customShell = document.createElement('span'); customShell.className = 'qcustom-shell';
				custom = document.createElement('input'); custom.type = 'text'; custom.className = 'qcustom'; custom.placeholder = 'Escribí tu propia respuesta…';
				if (selected.value && (q.options || []).indexOf(selected.value) < 0) { custom.value = selected.value; }
				custom.addEventListener('input', function () {
					updateCustomState();
					updateSubmit();
				});
				custom.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' && custom.value.trim()) { e.preventDefault(); answers[idx] = custom.value.trim(); advance(); }
			});
				imageStrip = document.createElement('span'); imageStrip.className = 'qimages';
				customShell.appendChild(custom);
				customShell.appendChild(imageStrip);
				row.querySelector('.qopt-body').appendChild(customShell);
				row.addEventListener('click', function (e) { if (e.target === row || (e.target.closest && e.target.closest('.qradio'))) { custom.focus(); } });
				opts.appendChild(row);
			}
			el.appendChild(opts);
			function updateCustomState() {
				if (!customRow) { return; }
				var has = !!((custom && custom.value.trim()) || answerImages[idx].length);
				customRow.classList.toggle('selected', has);
				var radioIcon = customRow.querySelector('.qradio .codicon');
				if (radioIcon) { radioIcon.className = 'codicon codicon-' + (has ? 'pass-filled' : 'circle-large'); }
			}
			function renderQuestionImages() {
				if (!imageStrip) { return; }
				imageStrip.innerHTML = '';
				answerImages[idx].forEach(function (img, imageIndex) { appendAskImageChip(imageStrip, img, imageIndex, function () { answerImages[idx].splice(imageIndex, 1); renderQuestionImages(); updateSubmit(); }); });
				updateCustomState();
			}
			var foot = document.createElement('div'); foot.className = 'qpanel-foot';
			if (idx > 0) {
				var back = document.createElement('button'); back.className = 'qback'; back.type = 'button'; back.innerHTML = ic('arrow-left') + '<span>Anterior</span>';
				back.addEventListener('click', function () { var previousValue = customVal(); if (previousValue) { answers[idx] = previousValue; } idx--; renderStep(); });
				foot.appendChild(back);
			}
			var skip = document.createElement('button'); skip.className = 'qskip'; skip.type = 'button';
			skip.textContent = 'Omitir';
			skip.addEventListener('click', function () { answers[idx] = ''; advance(); });
			foot.appendChild(skip);
			var spacer = document.createElement('span'); spacer.className = 'tray-spacer'; foot.appendChild(spacer);
			var submit = document.createElement('button'); submit.className = 'qsubmit'; submit.type = 'button';
			submit.textContent = (idx + 1 < questions.length) ? 'Siguiente' : 'Enviar';
			function customVal() { return (custom && custom.value.trim()) ? custom.value.trim() : ''; }
			function updateSubmit() { submit.disabled = !customVal() && !answers[idx] && !answerImages[idx].length; }
			updateSubmit();
			submit.addEventListener('click', function () {
				var v = customVal(); if (v) { answers[idx] = v; }
				if (!answers[idx] && !answerImages[idx].length) { return; }
				advance();
			});
			foot.appendChild(submit); el.appendChild(foot); renderQuestionImages(); updateCustomState();
			if (imageStrip) { el.addEventListener('paste', function (event) { var items = (event.clipboardData && event.clipboardData.items) || []; var captured = false; for (var p = 0; p < items.length; p++) { if (items[p].kind === 'file' && items[p].type.indexOf('image/') === 0) { var pasted = items[p].getAsFile(); if (pasted) { captured = true; readAskImage(pasted, function (img) { answerImages[idx].push(img); renderQuestionImages(); updateSubmit(); }); } } } if (captured) { event.preventDefault(); } }, { once: true }); }
			if (custom && !(q.options || []).length) { custom.focus(); }
		}
		renderStep();
	}

	// ---- popover del modelo: MODELOS agrupados por proveedor CONECTADO + razonamiento ----
	var EFFORTS = [
		['', 'Default del modelo'],
		['none', 'Sin razonamiento'],
		['minimal', 'Minimal'],
		['low', 'Low'],
		['medium', 'Medium'],
		['high', 'High'],
		['xhigh', 'Extra High'],
		['max', 'Max']
	];
	function effortLabel(v) {
		for (var i = 0; i < EFFORTS.length; i++) { if (EFFORTS[i][0] === v) { return EFFORTS[i][1]; } }
		return 'Default del modelo';
	}
	var modelSearch = '';
	function buildModelMenu() {
		modelMenuContent.innerHTML = '';
		var groups = session.groups || [];
		if (!groups.length) {
			var em = document.createElement('div'); em.className = 'menu-empty'; em.textContent = 'Sin proveedores conectados'; modelMenuContent.appendChild(em);
		}
		// con muchos modelos: buscador arriba (mismo recipe del historial) + el .menu ya capea altura
		var totalModels = 0;
		groups.forEach(function (g) { totalModels += (g.models || []).length; });
		if (totalModels > 8) {
			var sr = document.createElement('div'); sr.className = 'menu-search-row';
			sr.innerHTML = ic('search') + '<input class="menu-search" type="text" placeholder="Buscar modelos…">';
			var sInput = sr.querySelector('.menu-search'); sInput.value = modelSearch;
			sInput.addEventListener('input', function () { modelSearch = sInput.value; renderModelRows(); });
			sInput.addEventListener('click', function (e) { e.stopPropagation(); });
			modelMenuContent.appendChild(sr);
			setTimeout(function () { sInput.focus(); }, 0);
		}
		var listEl = document.createElement('div'); listEl.id = 'modelList'; modelMenuContent.appendChild(listEl);
		function renderModelRows() {
			listEl.innerHTML = '';
			var q = modelSearch.trim().toLowerCase();
			var any = false;
			groups.forEach(function (g) {
				var mids = (g.models || []).filter(function (mid) { return !q || mid.toLowerCase().indexOf(q) >= 0 || g.label.toLowerCase().indexOf(q) >= 0; });
				if (!mids.length) { return; }
				any = true;
				var sec = document.createElement('div'); sec.className = 'menu-section'; sec.textContent = g.label;
				listEl.appendChild(sec);
				mids.forEach(function (mid) {
					var row = document.createElement('button'); row.className = 'menu-row'; row.type = 'button';
					var active = g.id === session.activeId && (session.model ? mid === session.model : mid === g.defaultModel);
					row.innerHTML = '<span class="menu-row-icon">' + (active ? ic('check') : '') + '</span><span class="menu-label"></span>' + (mid === g.defaultModel ? '<span class="menu-detail">default</span>' : '');
					row.querySelector('.menu-label').textContent = mid;
					row.setAttribute('data-tip', g.label + ' \\u00b7 ' + mid);
					row.addEventListener('click', function () {
						closeMenus();
						// elegir el default del proveedor = sin override de modelo
						vscode.postMessage({ type: 'selectProviderModel', id: g.id, model: mid === g.defaultModel ? '' : mid });
					});
					listEl.appendChild(row);
				});
			});
			if (!any && groups.length) {
				var em2 = document.createElement('div'); em2.className = 'menu-empty'; em2.textContent = 'Sin resultados'; listEl.appendChild(em2);
			}
		}
		renderModelRows();
		var sep = document.createElement('div'); sep.className = 'menu-sep'; modelMenuContent.appendChild(sep);
		// Razonamiento (effort/thinking con límites independientes del modelo/Cursor): submenú con volver.
		var eff = document.createElement('button'); eff.className = 'menu-row'; eff.type = 'button';
		eff.innerHTML = '<span class="menu-row-icon">' + ic('lightbulb') + '</span><span class="menu-label"></span><span class="menu-detail"></span><span class="codicon codicon-chevron-right" style="color: var(--vscode-descriptionForeground); font-size: 12px;"></span>';
		eff.querySelector('.menu-label').textContent = 'Razonamiento';
		eff.querySelector('.menu-detail').textContent = effortLabel(session.effort || '');
		eff.setAttribute('data-tip', 'Esfuerzo de razonamiento (thinking) del modelo');
		eff.addEventListener('click', function (e) { e.stopPropagation(); buildEffortMenu(); });
		modelMenuContent.appendChild(eff);
		var cfg = document.createElement('button'); cfg.className = 'menu-row menu-muted'; cfg.type = 'button';
		cfg.innerHTML = '<span class="menu-row-icon">' + ic('plug') + '</span><span class="menu-label">Configurar proveedores…</span>';
		cfg.addEventListener('click', function () { closeMenus(); vscode.postMessage({ type: 'openProviders' }); });
		modelMenuContent.appendChild(cfg);
	}
	function buildEffortMenu() {
		modelMenuContent.innerHTML = '';
		var back = document.createElement('button'); back.className = 'menu-row menu-muted'; back.type = 'button';
		back.innerHTML = '<span class="menu-row-icon">' + ic('arrow-left') + '</span><span class="menu-label">Modelos</span>';
		back.addEventListener('click', function (e) { e.stopPropagation(); buildModelMenu(); });
		modelMenuContent.appendChild(back);
		var sec = document.createElement('div'); sec.className = 'menu-section'; sec.textContent = 'Razonamiento';
		modelMenuContent.appendChild(sec);
		EFFORTS.forEach(function (opt) {
			var row = document.createElement('button'); row.className = 'menu-row'; row.type = 'button';
			var active = (session.effort || '') === opt[0];
			row.innerHTML = '<span class="menu-row-icon">' + (active ? ic('check') : '') + '</span><span class="menu-label"></span>';
			row.querySelector('.menu-label').textContent = opt[1];
			row.addEventListener('click', function () {
				closeMenus();
				vscode.postMessage({ type: 'setEffort', effort: opt[0] });
			});
			modelMenuContent.appendChild(row);
		});
	}
	// ---- popover del modo (agent / plan / ask) ----
	function modeById(id) {
		for (var i = 0; i < MODES.length; i++) { if (MODES[i].id === id) { return MODES[i]; } }
		return MODES[0];
	}
	function applyMode(id) {
		mode = id;
		var m = modeById(id);
		modeTrigger.querySelector('.codicon:first-child').className = 'codicon codicon-' + m.icon;
		modeTrigger.querySelector('.mname').textContent = m.label;
	}
	// Modos de PERMISOS (política de aprobación). El label corto va en la fila del submenú.
	var PERMISSIONS = [
		['ask', 'Preguntar siempre', 'shield', 'Cada edición y comando pide aprobación (lo más seguro).'],
		['auto-edit', 'Auto-aprobar ediciones', 'edit', 'Las ediciones de archivo se aplican solas; la terminal sigue preguntando.'],
		['auto-all', 'Auto-aprobar todo', 'zap', 'Todo se ejecuta sin preguntar, salvo lo peligroso y los archivos sensibles.']
	];
	function permissionLabel(mode) {
		for (var i = 0; i < PERMISSIONS.length; i++) { if (PERMISSIONS[i][0] === (mode || 'ask')) { return PERMISSIONS[i][1]; } }
		return 'Preguntar siempre';
	}
	function buildModeMenu() {
		modeMenuContent.innerHTML = '';
		var sec = document.createElement('div'); sec.className = 'menu-section'; sec.textContent = 'Modo';
		modeMenuContent.appendChild(sec);
		MODES.forEach(function (mo) {
			var row = document.createElement('button'); row.className = 'menu-row'; row.type = 'button';
			// la descripción va como TOOLTIP (el texto al costado se cortaba en paneles angostos)
			row.innerHTML = '<span class="menu-row-icon">' + (mo.id === mode ? ic('check') : ic(mo.icon)) + '</span><span class="menu-label"></span>';
			row.querySelector('.menu-label').textContent = mo.label;
			row.setAttribute('data-tip', mo.desc);
			row.addEventListener('click', function () { closeMenus(); applyMode(mo.id); });
			modeMenuContent.appendChild(row);
		});
		// Permisos: fila con submenú (mismo patrón que "Razonamiento" en el popover del modelo)
		var sep = document.createElement('div'); sep.className = 'menu-sep'; modeMenuContent.appendChild(sep);
		var perm = document.createElement('button'); perm.className = 'menu-row'; perm.type = 'button';
		perm.innerHTML = '<span class="menu-row-icon">' + ic('shield') + '</span><span class="menu-label"></span><span class="menu-detail"></span><span class="codicon codicon-chevron-right" style="color: var(--vscode-descriptionForeground); font-size: 12px;"></span>';
		perm.querySelector('.menu-label').textContent = 'Permisos';
		perm.querySelector('.menu-detail').textContent = permissionLabel(session.permission);
		perm.setAttribute('data-tip', 'Política de aprobación de ediciones y comandos');
		perm.addEventListener('click', function (e) { e.stopPropagation(); buildPermissionMenu(); });
		modeMenuContent.appendChild(perm);
	}
	function buildPermissionMenu() {
		modeMenuContent.innerHTML = '';
		var back = document.createElement('button'); back.className = 'menu-row menu-muted'; back.type = 'button';
		back.innerHTML = '<span class="menu-row-icon">' + ic('arrow-left') + '</span><span class="menu-label">Modo</span>';
		back.addEventListener('click', function (e) { e.stopPropagation(); buildModeMenu(); });
		modeMenuContent.appendChild(back);
		var sec = document.createElement('div'); sec.className = 'menu-section'; sec.textContent = 'Permisos';
		modeMenuContent.appendChild(sec);
		var cur = session.permission || 'ask';
		PERMISSIONS.forEach(function (p) {
			var row = document.createElement('button'); row.className = 'menu-row'; row.type = 'button';
			row.innerHTML = '<span class="menu-row-icon">' + (p[0] === cur ? ic('check') : ic(p[2])) + '</span><span class="menu-label"></span>';
			row.querySelector('.menu-label').textContent = p[1];
			row.setAttribute('data-tip', p[3]);
			row.addEventListener('click', function () { closeMenus(); session.permission = p[0]; vscode.postMessage({ type: 'setPermission', mode: p[0] }); });
			modeMenuContent.appendChild(row);
		});
	}
	function closeMenus() { modelMenu.hidden = true; modeMenu.hidden = true; ctxPanel.hidden = true; historyMenu.hidden = true; mentionMenu.hidden = true; closeSlashMenu(); var km = document.getElementById('kebabMenu'); if (km) { km.hidden = true; } closeTermMenu(); }

	// Images use the native Images Preview editor (modal/editor tab), never a webview-local dialog.
	function openImagePreview(src) {
		vscode.postMessage({ type: 'imageFullscreen', src: src });
	}

	function ctxTotal() {
		if (ctx.used) { return ctx.used; }
		return (ctx.input || 0) + (ctx.output || 0);
	}
	function fmtTokens(n) {
		n = n || 0;
		return n >= 1000 ? (Math.round(n / 100) / 10) + 'K' : String(n);
	}
	// El indicador de contexto vive ahora en el STATUS BAR NATIVO (host, openideChatView).
	// Acá solo queda refrescar el panel de desglose si está abierto.
	function renderCtx() {
		if (!ctxPanel.hidden) {
			var total = ctxTotal();
			fillCtxPanel(total, ctx.limit ? Math.min(100, Math.round(total / ctx.limit * 100)) : 0);
		}
	}
	function toggleCtxPanel() {
		if (ctxPanel.hidden) {
			var total = ctxTotal();
			fillCtxPanel(total, ctx.limit ? Math.min(100, Math.round(total / ctx.limit * 100)) : 0);
			ctxPanel.hidden = false;
		} else {
			ctxPanel.hidden = true;
		}
	}
	// Panel de contexto DETALLADO (integrado): colores por rubro en barra + leyenda.
	// [key, label, siempreVisible, capabilityCountKey?]
	var CTX_COLORS = {
		system: '#9ca3af',
		memory: '#22c55e',
		skills: '#f59e0b',
		tools: '#a855f7',
		mcp: '#06b6d4',
		mentions: '#c084fc',
		images: '#e879f9',
		subagents: '#60a5fa',
		conversation: '#64748b'
	};
	var CTX_SEGS = [
		['system', 'System prompt', true],
		['tools', 'Herramientas', true, 'tools'],
		['mcp', 'MCP', true, 'mcp'],
		['memory', 'Memoria', false],
		['skills', 'Skills', true, 'skills'],
		['mentions', 'Menciones (@archivos)', false],
		['images', 'Imágenes', false],
		['subagents', 'Subagentes', false],
		['conversation', 'Conversación', true]
	];
	function fillCtxPanel(total, pct) {
		var html =
			'<div class="ctx-head"><span>Uso de contexto</span><button type="button" class="ctx-close" data-tip="Cerrar">' + ic('close') + '</button></div>' +
			'<div class="ctx-meta"><span>' + pct + '% lleno</span><span>~' + fmtTokens(total) + (ctx.limit ? (' / ' + fmtTokens(ctx.limit) + ' tokens') : ' tokens') + '</span></div>';
		var b = ctx.breakdown;
		if (b && ctx.limit) {
			var bar = '';
			var rows = '';
			CTX_SEGS.forEach(function (s) {
				var v = b[s[0]] || 0;
				if (!v && !s[2]) { return; }
				var col = CTX_COLORS[s[0]] || '#9ca3af';
				var w = Math.min(100, Math.round(v / ctx.limit * 1000) / 10);
				bar += '<span class="ctx-seg" data-k="' + s[0] + '" style="width:' + w + '%;background:' + col + '"></span>';
				var count = s[3] ? (ctx.capabilities[s[3]] || 0) : 0;
				var label = s[1] + (s[3] ? ' (' + count + ')' : '');
				rows += '<div class="ctx-row seg-row" data-k="' + s[0] + '"><span class="sw" style="background:' + col + '"></span><span class="lbl">' + label + '</span><span class="val">' + fmtTokens(v) + '</span></div>';
			});
			html += '<div class="ctx-bar">' + bar + '</div>' + rows;
		} else {
			html += '<div class="ctx-bar"><span class="ctx-fill" style="width:' + pct + '%"></span></div>';
			[['tools', 'Herramientas'], ['mcp', 'MCP'], ['skills', 'Skills']].forEach(function (item) {
				var count = ctx.capabilities[item[0]] || 0;
				html += '<div class="ctx-row"><span class="sw" style="background:' + CTX_COLORS[item[0]] + '"></span><span class="lbl">' + item[1] + '</span><span class="val">' + count + ' disponibles</span></div>';
			});
		}
		html += '<div class="ctx-sep"></div>' +
			'<div class="ctx-row"><span class="lbl">Entrada</span><span class="val">' + (ctx.input || 0).toLocaleString() + '</span></div>' +
			'<div class="ctx-row"><span class="lbl">Salida</span><span class="val">' + (ctx.output || 0).toLocaleString() + '</span></div>' +
			'<div class="ctx-row"><span class="lbl">Total</span><span class="val">' + total.toLocaleString() + (ctx.limit ? (' / ' + ctx.limit.toLocaleString()) : '') + '</span></div>';
		ctxPanel.innerHTML = html;
		var closeBtn = ctxPanel.querySelector('.ctx-close');
		if (closeBtn) { closeBtn.addEventListener('click', function (e) { e.stopPropagation(); ctxPanel.hidden = true; }); }
		// hover en una fila → ilumina su segmento en la barra (integrado)
		var barEl = ctxPanel.querySelector('.ctx-bar');
		var segRows = ctxPanel.querySelectorAll('.ctx-row.seg-row');
		for (var i = 0; i < segRows.length; i++) {
			(function (rowEl) {
				var k = rowEl.getAttribute('data-k');
				rowEl.addEventListener('mouseenter', function () {
					if (!barEl) { return; }
					barEl.classList.add('dim');
					var seg = barEl.querySelector('.ctx-seg[data-k="' + k + '"]');
					if (seg) { seg.classList.add('hot'); }
				});
				rowEl.addEventListener('mouseleave', function () {
					if (!barEl) { return; }
					barEl.classList.remove('dim');
					var seg = barEl.querySelector('.ctx-seg[data-k="' + k + '"]');
					if (seg) { seg.classList.remove('hot'); }
				});
			})(segRows[i]);
		}
	}

	function clearConversation() {
		messagesEl.innerHTML = '';
		assistant = null; reasoning = null; tools = {}; fileRows = {}; fileIcons = {}; termRows = {};
		subCards = {}; delegations = {};
		activeCompaction = null;
		activeMessageEditor = null;
		currentTurn = null;
		selectedCapabilities = []; composerLinks = []; renderCapabilityChips(); renderLinkChips();
		userMsgSeq = 0; queue = [];
		turnTodosHost = null; lastTodoItems = null; todosFallback = null;
		for (var k in trays) { if (trays[k]) { trays[k].remove(); } }
		trays = {};
		syncComposerDock();
		ctx = { input: 0, output: 0, used: 0, limit: ctx.limit, breakdown: null, capabilities: ctx.capabilities }; renderCtx();
		setBusy(false);
	}

	// ---- tabs de conversaciones (estilo editor Monaco) ----
	function postSession2(type, id) { vscode.postMessage({ type: type, id: id }); }
	function renderTabs() {
		tabsEl.innerHTML = '';
		openTabs.forEach(function (t) {
			var tab = document.createElement('div');
			tab.className = 'tab' + (t.id === activeSessionId ? ' active' : '');
			tab.setAttribute('data-id', t.id);
			tab.title = t.title || 'Nuevo chat';
			tab.innerHTML = '<span class="codicon codicon-openide-chat tab-icon"></span><span class="tab-title marquee-viewport"><span class="marquee-content"></span></span><button class="tab-close" data-tip="Cerrar conversación"><span class="codicon codicon-close"></span></button>';
			tab.querySelector('.marquee-content').textContent = t.title || 'Nuevo chat';
			tabsEl.appendChild(tab);
		});
		var active = tabsEl.querySelector('.tab.active');
		if (active) { active.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
	}

	// ---- popover de historial (estilo menú nativo) ----
	var historySearch = '';
	var archivedOpen = false;
	function groupOf(ts) {
		var now = new Date();
		var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		var DAY = 86400000;
		if (ts >= startToday) { return 'Hoy'; }
		if (ts >= startToday - DAY) { return 'Ayer'; }
		if (ts >= startToday - 7 * DAY) { return 'Últimos 7 días'; }
		if (ts >= startToday - 30 * DAY) { return 'Últimos 30 días'; }
		return 'Más viejas';
	}
	function buildHistoryMenu() {
		historyMenuContent.innerHTML = '';
		var sr = document.createElement('div'); sr.className = 'menu-search-row';
		sr.innerHTML = ic('search') + '<input class="menu-search" type="text" placeholder="Buscar conversaciones…">';
		var input = sr.querySelector('.menu-search'); input.value = historySearch;
		input.addEventListener('input', function () { historySearch = input.value; renderHistoryList(); });
		input.addEventListener('click', function (e) { e.stopPropagation(); });
		historyMenuContent.appendChild(sr);
		var list = document.createElement('div'); list.id = 'historyList'; historyMenuContent.appendChild(list);
		renderHistoryList();
		setTimeout(function () { input.focus(); }, 0);
	}
	function renderHistoryList() {
		var list = document.getElementById('historyList');
		if (!list) { return; }
		list.innerHTML = '';
		var q = historySearch.trim().toLowerCase();
		var visible = allSessions.filter(function (e) { return !q || (e.title || 'Nuevo chat').toLowerCase().indexOf(q) >= 0; });
		var recent = visible.filter(function (e) { return !e.archived; });
		var archived = visible.filter(function (e) { return e.archived; });
		if (!recent.length && !archived.length) {
			var em = document.createElement('div'); em.className = 'menu-empty'; em.textContent = q ? 'Sin resultados' : 'Sin conversaciones'; list.appendChild(em); return;
		}
		var lastGroup = '';
		recent.forEach(function (e) {
			var g = groupOf(e.updatedAt || 0);
			if (g !== lastGroup) { lastGroup = g; var sec = document.createElement('div'); sec.className = 'menu-section'; sec.textContent = g; list.appendChild(sec); }
			list.appendChild(historyRow(e, false));
		});
		if (archived.length) {
			var sep = document.createElement('div'); sep.className = 'menu-sep'; list.appendChild(sep);
			var toggle = document.createElement('button'); toggle.className = 'menu-row'; toggle.type = 'button';
			toggle.innerHTML = '<span class="menu-row-icon">' + ic(archivedOpen ? 'chevron-down' : 'chevron-right') + '</span><span class="menu-label">Archivadas (' + archived.length + ')</span>';
			toggle.addEventListener('click', function (ev) { ev.stopPropagation(); archivedOpen = !archivedOpen; renderHistoryList(); });
			list.appendChild(toggle);
			if (archivedOpen) { archived.forEach(function (e) { list.appendChild(historyRow(e, true)); }); }
		}
	}
	function historyRow(e, isArchived) {
		var row = document.createElement('button'); row.className = 'menu-row has-actions'; row.type = 'button';
		var active = e.id === activeSessionId;
		row.innerHTML = '<span class="menu-row-icon">' + ic(active ? 'check' : (e.hasError ? 'error' : (e.forked ? 'repo-forked' : 'comment'))) + '</span><span class="menu-label"></span><span class="menu-detail"></span><span class="menu-row-actions"></span>';
		row.querySelector('.menu-label').textContent = e.title || 'Nuevo chat';
		var actions = row.querySelector('.menu-row-actions');
		var forkRowBtn = document.createElement('button'); forkRowBtn.className = 'menu-row-action'; forkRowBtn.type = 'button';
		forkRowBtn.setAttribute('data-tip', 'Fork (rama independiente con este contexto)'); forkRowBtn.innerHTML = ic('repo-forked');
		forkRowBtn.addEventListener('click', function (ev) { ev.stopPropagation(); historyMenu.hidden = true; postSession2('forkSession', e.id); });
		actions.appendChild(forkRowBtn);
		var archBtn = document.createElement('button'); archBtn.className = 'menu-row-action'; archBtn.type = 'button';
		archBtn.setAttribute('data-tip', isArchived ? 'Desarchivar' : 'Archivar');
		archBtn.innerHTML = ic(isArchived ? 'inbox' : 'archive');
		archBtn.addEventListener('click', function (ev) { ev.stopPropagation(); postSession2(isArchived ? 'unarchiveSession' : 'archiveSession', e.id); });
		var delBtn = document.createElement('button'); delBtn.className = 'menu-row-action'; delBtn.type = 'button';
		delBtn.setAttribute('data-tip', 'Eliminar'); delBtn.innerHTML = ic('trash');
		delBtn.addEventListener('click', function (ev) { ev.stopPropagation(); postSession2('deleteSession', e.id); });
		actions.appendChild(archBtn); actions.appendChild(delBtn);
		row.addEventListener('click', function () { historyMenu.hidden = true; postSession2('switchSession', e.id); });
		return row;
	}

	// ---- restaurar el thread de una conversación (texto + tool rows resueltas) ----
	function hydrateRollbackComposer(composer) {
		composer = composer || {};
		// Reset completo: el rollback es un commit autoritativo, nunca se mezcla con el draft que
		// hubiera quedado en el composer ni con chips/adjuntos del turno eliminado.
		promptEl.value = '';
		selectedCapabilities = Array.isArray(composer.capabilities) ? composer.capabilities.slice() : [];
		composerLinks = [];
		fileReferences = []; fileReferenceIcons = {};
		attachments = (Array.isArray(composer.images) ? composer.images : []).map(function (img) { return { mimeType: img.mimeType, data: img.data }; });
		hydrateComposerLinks(capabilityText(String(composer.text || ''), selectedCapabilities));
		renderCapabilityChips(); renderAttachments(); renderFileReferences(); renderLinkChips(); autosize(); updateSendEnabled(); promptEl.focus();
	}
	function restoreThread(messages) {
		clearConversation();
		var msgs = messages || [];
		// resultados + diffs de tools por toolCallId, para resolver/estilizar las rows restauradas
		var results = {};
		var diffs = {};
		msgs.forEach(function (m) {
			if (m.role === 'tool' && m.toolCallId) {
				results[m.toolCallId] = m.content || '';
				if (m.fileDiff) { diffs[m.toolCallId] = m.fileDiff; } // edit card persistida
			}
		});
		var lastTodos = null; // estado final para la tarjeta compacta pineada
		msgs.forEach(function (m) {
			if (m.compaction) {
				renderCompaction({ status: 'completed', origin: m.compaction.origin, beforeTokens: m.compaction.beforeTokens, afterTokens: m.compaction.afterTokens, savingsPercent: m.compaction.savingsPercent }, true);
				return;
			}
			// Compatibilidad con sesiones compactadas por builds anteriores, que todavía no
			// persistían metadata. El resumen interno jamás debe parecer un pedido del usuario.
			if (m.role === 'user' && String(m.content || '').indexOf('[Resumen histórico compacto]') === 0) {
				renderCompaction({ status: 'completed', origin: 'automatic', message: 'Resumen histórico conservado para continuar la conversación.' }, true);
				return;
			}
			if (m.role === 'user') {
				var restoredLinkData = extractComposerLinks(m.content || '');
				var restoredText = m.displayText !== undefined ? m.displayText : restoredLinkData.text;
				addUser(restoredText, m.images, m.capabilities, restoredLinkData.links, m.messageId, m.executionMode, m.providerId, m.modelId);
			}
			else if (m.role === 'assistant') {
				if (m.content) {
					var wrap = document.createElement('div'); wrap.className = 'msg assistant';
					var b = document.createElement('div'); b.className = 'body'; b.innerHTML = renderMarkdown(m.content);
					wrap.appendChild(b); appendToFlow(wrap);
				}
				(m.toolCalls || []).forEach(function (call) {
					// COMPONENTES ESTILIZADOS reconstruidos desde los args/result persistidos (así el
					// chat se ve igual tras Ctrl+R): to-dos, plan card, ask (pregunta+respuesta).
					if (call.name === 'update_todos') {
						try {
							lastTodos = JSON.parse(call.argumentsJson || '{}').todos || [];
							appendTodoUpdate(lastTodos);
						} catch (e) { }
						return;
					}
					if (call.name === 'ask_user') {
						restoreAskSummary(call.argumentsJson || '', results[call.id] || '');
						return;
					}
					if (call.name === 'plan_save') {
						restorePlanCard(call.argumentsJson || '', results[call.id] || '');
						return;
					}
					if (call.name === 'canvas_write') {
						try { var ca = JSON.parse(call.argumentsJson || '{}'); var rr = results[call.id] || ''; var cm = rr.match(/en\\s+(\\.openide\\/canvases\\/[^\\s]+\\.canvas\\.tsx)/); renderCanvasCard({ path: cm ? cm[1] : '.openide/canvases/' + String(ca.name || 'canvas').replace(/\\.canvas\\.tsx$/, '') + '.canvas.tsx', title: String(ca.name || 'Canvas'), created: rr.indexOf('actualizado') < 0 }); } catch (e) { }
						return;
					}
					if (call.name === 'delegate_task') { restoreDelegation(call.id, call.argumentsJson || '', results[call.id] || ''); return; }
					addTool(call.id, call.name, call.argumentsJson || '', true);
					// edit card estilizada: ANTES de finishTool (setea t.card → no muestra "OK: editado…")
					var fd = diffs[call.id];
					if (fd) { upgradeEditCard({ path: fd.path, created: fd.created, editAdded: fd.editAdded, editRemoved: fd.editRemoved, diffLines: fd.diffLines || [] }, call.id); }
					var res = results[call.id];
					if (res !== undefined) { finishTool(call.id, call.name, res, res.indexOf('Error') === 0); }
					else { finishTool(call.id, call.name, '', false); }
				});
			}
		});
		// La tarjeta bajo el prompt refleja el ÚLTIMO estado; arriba ya restauramos un snapshot
		// dentro del chat por CADA llamada a update_todos.
		if (lastTodos) { renderTodos(lastTodos); }
		assistant = null; reasoning = null;
		scrollDown();
	}

	/* reconstrucción de componentes al restaurar (Ctrl+R): usan los args del tool call + su result */
	function restoreAskSummary(argsJson, result) {
		var qs = [];
		try {
			var a = JSON.parse(argsJson || '{}');
			if (Array.isArray(a.questions)) { qs = a.questions.map(function (q) { return { question: q.question || '' }; }); }
			else if (a.question) { qs = [{ question: a.question }]; }
		} catch (e) { }
		if (!qs.length) { return; }
		var answers;
		if (qs.length <= 1) { answers = [result || '(omitida)']; }
		else {
			var blocks = String(result).split('\\n\\n');
			answers = qs.map(function (q, i) { var mm = (blocks[i] || '').match(/R:\\s*([\\s\\S]*)$/); return mm ? mm[1].trim() : '(omitida)'; });
		}
		var block = document.createElement('div'); block.className = 'q-summary-block';
		qs.forEach(function (q, i) {
			var s = document.createElement('div'); s.className = 'q-summary';
			var qt = document.createElement('div'); qt.className = 'q-summary-q'; qt.textContent = q.question || '';
			var a = document.createElement('div'); a.className = 'q-summary-a';
			a.innerHTML = ic('pass-filled') + '<span></span>';
			a.querySelector('span:last-child').textContent = answers[i] || '(omitida)';
			s.appendChild(qt); s.appendChild(a); block.appendChild(s);
		});
		appendToFlow(block);
	}
	function restorePlanCard(argsJson, result) {
		var title = '', md = '';
		try { var a = JSON.parse(argsJson || '{}'); title = a.title || ''; md = a.markdown || ''; } catch (e) { }
		// el path viene en el result ("OK: plan guardado en <path>")
		var mm = String(result).match(/en\\s+(\\.openide\\/plans\\/[^\\s]+\\.md)/);
		var path = mm ? mm[1] : ('.openide/plans/' + (title || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md');
		renderPlanCard({ path: path, title: title, markdown: md });
	}

	function applySession(m) {
		session.provider = m.provider || ''; session.model = m.model || ''; session.connected = !!m.connected; session.activeId = m.activeId || m.provider || '';
		session.groups = Array.isArray(m.groups) ? m.groups : [];
		session.defaultModel = m.defaultModel || '';
		session.effort = m.effort || '';
		session.permission = m.permission || 'ask';
		if (typeof m.contextLimit === 'number' && m.contextLimit > 0) { ctx.limit = m.contextLimit; renderCtx(); }
		var name = modelTrigger.querySelector('.mname');
		name.textContent = m.connected ? (m.model || session.defaultModel || m.provider || 'Modelo') : 'Seleccionar modelo';
		modelTrigger.classList.toggle('unset', !m.connected);
		if (!modelMenu.hidden) { buildModelMenu(); }
	}

	// ---- tooltips [data-tip] = HOVER NATIVO del workbench (bridge al host) ----
	// El webview no puede usar IHoverService directo (iframe aislado): manda el rect del
	// target (coords del iframe = coords del container del host) y el host muestra el
	// hover nativo real sobre un anchor invisible. Delay acá; el hover lo pinta vscode.
	var tipTimer = null;
	var tipTarget = null;
	function showTip(target) {
		var text = target.getAttribute('data-tip');
		if (!text) { return; }
		var r = target.getBoundingClientRect();
		vscode.postMessage({ type: 'tip', text: text, x: r.left, y: r.top, w: r.width, h: r.height, position: target.getAttribute('data-tip-position') || '' });
	}
	function hideTip() {
		clearTimeout(tipTimer); tipTimer = null;
		if (tipTarget) { tipTarget = null; vscode.postMessage({ type: 'tipHide' }); }
	}
	document.addEventListener('mouseover', function (e) {
		var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
		if (t === tipTarget) { return; }
		hideTip();
		if (!t) { return; }
		tipTarget = t;
		tipTimer = setTimeout(function () { if (tipTarget === t) { showTip(t); } }, 350);
	});
	document.addEventListener('mousedown', hideTip, true);
	document.addEventListener('scroll', hideTip, true);
	window.addEventListener('blur', hideTip);

	// Reposiciona un menú recién abierto para que quede DENTRO del viewport (8px de margen).
	// Sin esto, un menú anclado con left:0 a un trigger cercano al borde derecho desborda el
	// documento; overflow:hidden en el body evita el scrollbar, pero el menú quedaría cortado.
	function clampMenu(menu) {
		menu.style.left = '';
		menu.style.right = '';
		var r = menu.getBoundingClientRect();
		var overRight = r.right - (window.innerWidth - 8);
		if (overRight > 0) {
			menu.style.left = (menu.offsetLeft - overRight) + 'px';
			r = menu.getBoundingClientRect();
		}
		if (r.left < 8) {
			menu.style.left = (menu.offsetLeft + (8 - r.left)) + 'px';
		}
	}

	// ---- autocomplete de @archivos (integrado) ----
	var mentionItems = [];
	var mentionIcons = [];       // clases del file icon theme, alineadas con mentionItems
	var iconThemeReady = false;  // hay stylesheet del theme inyectado
	var mentionSel = 0;
	var mentionQuery = null;   // token activo {start, q} o null (menú cerrado)
	var mentionTimer = null;

	function applyFileThemeIcon(el, path, classes) {
		if (!el) { return; }
		var themed = classes || fileIcons[path];
		if (iconThemeReady && themed) {
			el.className = 'ficon ' + themed;
			el.innerHTML = '';
		} else {
			el.className = 'codicon codicon-file';
			el.innerHTML = '';
		}
	}
	function refreshFileThemeIcons() {
		Object.keys(fileRows).forEach(function (path) {
			applyFileThemeIcon(fileRows[path].querySelector('.ficon, .codicon-file'), path);
		});
		Object.keys(tools).forEach(function (id) {
			var tool = tools[id];
			if (tool && tool.edit && tool.iconEl) {
				applyFileThemeIcon(tool.iconEl, tool.editPath || '', fileIcons[tool.editPath || '']);
			}
		});
		renderFileReferences();
		renderMentionMenu();
	}
	function renderFileReferences() {
		fileReferenceStrip.innerHTML = '';
		fileReferenceStrip.hidden = !fileReferences.length;
		fileReferences.forEach(function (path) {
			var chip = document.createElement('span'); chip.className = 'file-reference-chip'; chip.title = path;
			var icon = document.createElement('span');
			applyFileThemeIcon(icon, path, fileReferenceIcons[path]);
			var name = document.createElement('span'); name.className = 'file-reference-name'; name.textContent = basename(path);
			var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'file-reference-remove';
			remove.setAttribute('data-tip', 'Quitar referencia'); remove.innerHTML = ic('close');
			remove.addEventListener('click', function () {
				fileReferences = fileReferences.filter(function (candidate) { return candidate !== path; });
				delete fileReferenceIcons[path]; renderFileReferences(); updateSendEnabled(); promptEl.focus();
			});
			chip.appendChild(icon); chip.appendChild(name); chip.appendChild(remove); fileReferenceStrip.appendChild(chip);
		});
	}

	function mentionTokenAtCaret() {
		var pos = promptEl.selectionStart;
		var before = promptEl.value.slice(0, pos);
		var m = before.match(/(^|\\s)@([^\\s@]*)$/);
		if (!m) { return null; }
		return { start: pos - m[2].length - 1, q: m[2] };
	}
	function closeMentionMenu() {
		mentionMenu.hidden = true;
		mentionItems = [];
		mentionQuery = null;
	}
	function renderMentionMenu() {
		mentionMenuContent.innerHTML = '';
		if (!mentionItems.length) { closeMentionMenu(); return; }
		mentionItems.forEach(function (p, i) {
			var row = document.createElement('button');
			row.type = 'button';
			row.className = 'menu-row' + (i === mentionSel ? ' focus' : '');
			// ícono del FILE ICON THEME si el host mandó clases (y hay theme css); si no, codicon
			var themed = iconThemeReady && mentionIcons[i];
			row.innerHTML = '<span class="menu-row-icon">' + (themed ? '<span class="ficon"></span>' : ic('file')) + '</span><span class="menu-label"></span>';
			if (themed) { row.querySelector('.ficon').className = 'ficon ' + mentionIcons[i]; }
			row.querySelector('.menu-label').textContent = p;
			row.title = p;
			row.addEventListener('mousedown', function (e) { e.preventDefault(); });  // no robar foco del textarea
			row.addEventListener('click', function () { acceptMention(p); });
			mentionMenuContent.appendChild(row);
		});
		mentionMenu.hidden = false;
	}
	function moveMentionSel(delta) {
		if (!mentionItems.length) { return; }
		mentionSel = (mentionSel + delta + mentionItems.length) % mentionItems.length;
		var rows = mentionMenuContent.querySelectorAll('.menu-row');
		for (var i = 0; i < rows.length; i++) {
			rows[i].classList.toggle('focus', i === mentionSel);
		}
		if (rows[mentionSel] && rows[mentionSel].scrollIntoView) { rows[mentionSel].scrollIntoView({ block: 'nearest' }); }
	}
	function acceptMention(path) {
		var tok = mentionTokenAtCaret();
		if (!tok) { closeMentionMenu(); return; }
		var v = promptEl.value;
		var pos = promptEl.selectionStart;
		promptEl.value = v.slice(0, tok.start) + v.slice(pos);
		var np = tok.start;
		promptEl.setSelectionRange(np, np);
		if (fileReferences.indexOf(path) < 0) { fileReferences.push(path); }
		var selectedIndex = mentionItems.indexOf(path);
		if (selectedIndex >= 0 && mentionIcons[selectedIndex]) { fileReferenceIcons[path] = mentionIcons[selectedIndex]; }
		renderFileReferences();
		closeMentionMenu();
		autosize(); updateSendEnabled();
		promptEl.focus();
	}
	function updateMentionMenu() {
		var tok = mentionTokenAtCaret();
		if (!tok) { closeMentionMenu(); return; }
		mentionQuery = tok;
		clearTimeout(mentionTimer);
		mentionTimer = setTimeout(function () {
			vscode.postMessage({ type: 'fileQuery', q: tok.q });
		}, 120);
	}

	// ---- autocomplete de /comandos (clon del pipeline del @; el host expande en handleSend) ----
	var slashMenu = document.getElementById('slashMenu');
	var slashMenuContent = document.getElementById('slashMenuContent');
	var slashItems = [];
	var slashSel = 0;
	var slashQuery = null;   // token activo {q} o null (menú cerrado)
	var slashTimer = null;
	var slashGhost = null;   // {slug, hint} recién aceptado: el hint se muestra como fila fantasma
	function compactSlashDescription(value) {
		var text = String(value || '').replace(/\s+/g, ' ').trim();
		if (!text) { return ''; }
		var sentence = text.indexOf('. ');
		if (sentence > 18) { text = text.slice(0, sentence + 1); }
		var parenthesis = text.indexOf(' (');
		if (parenthesis > 24) { text = text.slice(0, parenthesis); }
		if (text.length <= 62) { return text; }
		var cut = text.slice(0, 59).lastIndexOf(' ');
		return text.slice(0, cut > 34 ? cut : 59).replace(/[,:;\s]+$/, '') + '\u2026';
	}

	// Un token de barra puede abrirse al inicio o después de cualquier espacio. Así una selección
	// anterior no bloquea el picker y se pueden encadenar skills, tools y MCP.
	function slashTokenAtCaret() {
		var pos = promptEl.selectionStart;
		var before = promptEl.value.slice(0, pos);
		var m = before.match(/(^|\\s)\\/([a-zA-Z0-9_.-]*)$/);
		if (!m) { return null; }
		return { q: m[2], start: pos - m[2].length - 1, end: pos };
	}
	function closeSlashMenu() {
		slashMenu.hidden = true;
		slashItems = [];
		slashQuery = null;
		slashGhost = null;
	}
	function renderSlashMenu() {
		slashMenuContent.innerHTML = '';
		if (!slashItems.length) { closeSlashMenu(); return; }
		var groups = [
			{ kind: 'skill', label: 'Skills', icon: 'sparkle' },
			{ kind: 'command', label: 'Commands', icon: 'terminal' },
			{ kind: 'mcp', label: 'MCP', icon: 'plug' },
			{ kind: 'tool', label: 'Tools', icon: 'tools' }
		];
		groups.forEach(function (group) {
			var entries = slashItems.map(function (it, index) { return { it: it, index: index }; }).filter(function (entry) { return entry.it.kind === group.kind; });
			if (!entries.length) { return; }
			var section = document.createElement('div'); section.className = 'slash-section';
			var title = document.createElement('div'); title.className = 'slash-section-title'; title.textContent = group.label; section.appendChild(title);
			entries.forEach(function (entry) {
				var it = entry.it; var i = entry.index;
				var row = document.createElement('button'); row.type = 'button';
				row.className = 'menu-row' + (i === slashSel ? ' focus' : ''); row.setAttribute('data-slash-index', String(i));
				row.innerHTML = '<span class="menu-row-icon">' + ic(group.icon) + '</span><span class="slash-copy"><span class="menu-label"></span><span class="menu-detail"></span></span><span class="slash-risk"></span>';
				row.querySelector('.menu-label').textContent = '/' + it.name + (it.hint ? ' ' + it.hint : '');
				row.querySelector('.menu-detail').textContent = compactSlashDescription(it.description);
				row.querySelector('.slash-risk').textContent = it.risk === 'exec' ? 'exec' : it.risk === 'write' ? 'write' : '';
				row.setAttribute('data-tip', it.description || '/' + it.name);
				row.setAttribute('data-tip-position', 'left');
				row.addEventListener('mousedown', function (e) { e.preventDefault(); });
				row.addEventListener('click', function () { acceptSlash(it); });
				section.appendChild(row);
			});
			slashMenuContent.appendChild(section);
		});
		slashMenu.hidden = false;
	}
	function moveSlashSel(delta) {
		if (!slashItems.length) { return; }
		slashSel = (slashSel + delta + slashItems.length) % slashItems.length;
		var rows = slashMenuContent.querySelectorAll('.menu-row');
		for (var i = 0; i < rows.length; i++) {
			rows[i].classList.toggle('focus', Number(rows[i].getAttribute('data-slash-index')) === slashSel);
		}
		var active = slashMenuContent.querySelector('[data-slash-index="' + slashSel + '"]');
		if (active && active.scrollIntoView) { active.scrollIntoView({ block: 'nearest' }); }
	}
	function acceptSlash(it) {
		if (!it) { closeSlashMenu(); return; }
		var tok = slashQuery || slashTokenAtCaret();
		if (!tok) { closeSlashMenu(); return; }
		var before = promptEl.value.slice(0, tok.start);
		var after = promptEl.value.slice(tok.end);
		promptEl.value = before + after;
		promptEl.setSelectionRange(before.length, before.length);
		if (it.kind === 'command') {
			selectedCapabilities = selectedCapabilities.filter(function (capability) { return capability.kind !== 'command'; });
		}
		if (!selectedCapabilities.some(function (capability) { return capability.kind === it.kind && capability.name === it.name; })) {
			selectedCapabilities.push({ kind: it.kind, name: it.name });
		}
		renderCapabilityChips();
		closeSlashMenu();
		// El hint queda como popover liviano; escribir otra barra lo reemplaza por el picker.
		if (it.hint) { slashGhost = { slug: it.name, hint: it.hint }; renderSlashGhost(); }
		autosize(); updateSendEnabled();
		promptEl.focus();
	}
	function renderSlashGhost() {
		if (!slashGhost) { return; }
		slashMenuContent.innerHTML = '';
		var row = document.createElement('div');
		row.className = 'menu-row';
		row.innerHTML = '<span class="menu-row-icon">' + ic('terminal') + '</span><span class="slash-copy"><span class="menu-label"></span><span class="menu-detail slash-hint"></span></span>';
		row.querySelector('.menu-label').textContent = '/' + slashGhost.slug;
		row.querySelector('.menu-detail').textContent = slashGhost.hint;
		slashMenuContent.appendChild(row);
		slashMenu.hidden = false;
	}
	function updateSlashMenu() {
		if (slashGhost) {
			slashGhost = null; slashMenu.hidden = true; slashMenuContent.innerHTML = '';
		}
		var tok = slashTokenAtCaret();
		if (!tok) { closeSlashMenu(); return; }
		slashQuery = tok;
		clearTimeout(slashTimer);
		slashTimer = setTimeout(function () {
			vscode.postMessage({ type: 'commandQuery', q: tok.q });
		}, 120);
	}

	// ---- eventos del DOM ----
	sendBtn.addEventListener('click', send);
	modelTrigger.addEventListener('click', function (e) {
		e.stopPropagation();
		ctxPanel.hidden = true; modeMenu.hidden = true;
		// SIEMPRE el popover (aunque no haya nada conectado: buildModelMenu muestra el estado
		// vacío + la fila "Configurar proveedores…"). Antes saltaba directo a la página, lo que
		// resultaba confuso ("por qué me abre proveedores y no el popover").
		if (modelMenu.hidden) {
			modelSearch = ''; buildModelMenu(); modelMenu.hidden = false; clampMenu(modelMenu);
		} else { modelMenu.hidden = true; }
	});
	modeTrigger.addEventListener('click', function (e) {
		e.stopPropagation();
		ctxPanel.hidden = true; modelMenu.hidden = true;
		if (modeMenu.hidden) { buildModeMenu(); modeMenu.hidden = false; clampMenu(modeMenu); } else { modeMenu.hidden = true; }
	});
	attachBtn.addEventListener('click', function () { attachInput.click(); });

	// ---- dictado por voz: toggle grabar/parar; el host captura y transcribe ----
	var micBtn = document.getElementById('micBtn');
	var micState = 'idle'; // idle | recording | busy
	micBtn.addEventListener('click', function () {
		if (micState === 'busy') { return; }
		vscode.postMessage({ type: micState === 'recording' ? 'voiceStop' : 'voiceStart' });
	});
	function applyVoiceState(status) {
		micState = status;
		micBtn.classList.toggle('rec', status === 'recording');
		micBtn.classList.toggle('busy', status === 'busy');
		var icon = micBtn.querySelector('.codicon');
		icon.className = status === 'busy' ? 'codicon codicon-mic-filled shimmer' : 'codicon codicon-mic-filled';
		micBtn.setAttribute('data-tip', status === 'recording' ? 'Parar y transcribir' : status === 'busy' ? 'Transcribiendo…' : 'Dictado por voz');
		updateSendEnabled(); // re-evaluar el slot mic/enviar (al terminar el dictado puede tocar mostrar enviar)
	}
	function insertVoiceText(text) {
		if (!text) { return; }
		var sep = promptEl.value && !/\\s$/.test(promptEl.value) ? ' ' : '';
		promptEl.value += sep + text;
		autosize();
		updateSendEnabled();
		promptEl.focus();
	}
	attachInput.addEventListener('change', function () {
		var files = attachInput.files || [];
		for (var i = 0; i < files.length; i++) { addAttachmentFile(files[i]); }
		attachInput.value = '';
	});
	promptEl.addEventListener('paste', function (e) {
		var items = (e.clipboardData && e.clipboardData.items) || [];
		var got = false;
		for (var i = 0; i < items.length; i++) {
			if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) {
				var f = items[i].getAsFile();
				if (f) { addAttachmentFile(f); got = true; }
			}
		}
		if (got) { e.preventDefault(); return; }
		var pasted = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
		var parsed = extractComposerLinks(pasted);
		if (parsed.links.length) {
			e.preventDefault();
			var start = promptEl.selectionStart; var end = promptEl.selectionEnd;
			promptEl.value = promptEl.value.slice(0, start) + parsed.text + promptEl.value.slice(end);
			var caret = start + parsed.text.length; promptEl.setSelectionRange(caret, caret);
			addComposerLinks(parsed.links); autosize(); updateSendEnabled(); updateMentionMenu(); updateSlashMenu();
		}
	});
	newBtn.addEventListener('click', function (e) { e.stopPropagation(); closeMenus(); vscode.postMessage({ type: 'newSession' }); });
	// Más acciones (…): mismo patrón visual que los toolbars nativos de editor y navegador.
	var menuBtn = document.getElementById('menuBtn');
	var kebabMenu = document.getElementById('kebabMenu');
	var kebabMenuContent = document.getElementById('kebabMenuContent');
	var KEBAB_ITEMS = [
		{ icon: 'repo-forked', label: 'Fork de esta conversación', act: function () { if (activeSessionId) { vscode.postMessage({ type: 'forkSession', id: activeSessionId }); } } },
		{ icon: 'export', label: 'Copiar transcript', act: function () { vscode.postMessage({ type: 'exportTranscript' }); } },
		{ sep: true },
		{ icon: 'type-hierarchy', label: 'Memoria del proyecto (grafo)', act: function () { vscode.postMessage({ type: 'openMemoryGraph' }); } }
	];
	function buildKebabMenu() {
		kebabMenuContent.innerHTML = '';
		KEBAB_ITEMS.forEach(function (it) {
			if (it.sep) { var sp = document.createElement('div'); sp.className = 'menu-sep'; kebabMenuContent.appendChild(sp); return; }
			var row = document.createElement('button'); row.className = 'menu-row'; row.type = 'button';
			row.innerHTML = '<span class="menu-row-icon">' + ic(it.icon) + '</span><span class="menu-label"></span>';
			row.querySelector('.menu-label').textContent = it.label;
			row.addEventListener('click', function (e) { e.stopPropagation(); kebabMenu.hidden = true; it.act(); });
			kebabMenuContent.appendChild(row);
		});
	}
	menuBtn.addEventListener('click', function (e) {
		e.stopPropagation(); modelMenu.hidden = true; modeMenu.hidden = true; ctxPanel.hidden = true; historyMenu.hidden = true;
		if (kebabMenu.hidden) { buildKebabMenu(); kebabMenu.hidden = false; } else { kebabMenu.hidden = true; }
	});
	agentLayoutBtn.addEventListener('click', function (e) { e.stopPropagation(); setAgentLayoutOpen(!agentLayoutPanel.classList.contains('open')); });
	agentLayoutClose.addEventListener('click', closeAgentLayout);
	agentLayoutSearch.addEventListener('input', renderAgentLayoutTree);
	historyBtn.addEventListener('click', function (e) {
		e.stopPropagation(); modelMenu.hidden = true; modeMenu.hidden = true; ctxPanel.hidden = true;
		if (historyMenu.hidden) { buildHistoryMenu(); historyMenu.hidden = false; } else { historyMenu.hidden = true; }
	});
	tabsEl.addEventListener('click', function (e) {
		var close = e.target.closest ? e.target.closest('.tab-close') : null;
		if (close) { e.stopPropagation(); var ct = close.closest('.tab'); if (ct) { postSession2('closeTab', ct.getAttribute('data-id')); } return; }
		var tab = e.target.closest ? e.target.closest('.tab') : null;
		if (tab) { postSession2('switchSession', tab.getAttribute('data-id')); }
	});
	tabsEl.addEventListener('auxclick', function (e) {
		if (e.button === 1) { var tab = e.target.closest ? e.target.closest('.tab') : null; if (tab) { e.preventDefault(); postSession2('closeTab', tab.getAttribute('data-id')); } }
	});
	tabsEl.addEventListener('wheel', function (e) { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabsEl.scrollLeft += e.deltaY; } }, { passive: true });
	document.addEventListener('click', function (e) {
		// Click fuera del editor inline: restaurar la burbuja original y su clamp/fade.
		if (activeMessageEditor && e.target && e.target.closest && !e.target.closest('.msg.user.editing')) { activeMessageEditor.cancel(); }
		if (!e.target.closest('#modelMenu') && !e.target.closest('#modelTrigger')) { modelMenu.hidden = true; }
		if (!e.target.closest('#modeMenu') && !e.target.closest('#modeTrigger')) { modeMenu.hidden = true; }
		if (!e.target.closest('#ctxPanel')) { ctxPanel.hidden = true; }
		if (!e.target.closest('#mentionMenu') && !e.target.closest('#prompt')) { closeMentionMenu(); }
		if (!e.target.closest('#slashMenu') && !e.target.closest('#prompt')) { closeSlashMenu(); }
		if (!e.target.closest('#historyMenu') && !e.target.closest('#historyBtn')) { historyMenu.hidden = true; }
		if (!e.target.closest('.term-menu') && !e.target.closest('.term-dots')) { closeTermMenu(); }
	});
	document.addEventListener('keydown', function (e) {
		if (busy && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Backspace') {
			e.preventDefault(); vscode.postMessage({ type: 'abort' }); setBusy(false); return;
		}
		if (e.key === 'Escape') { closeMenus(); }
	});
	promptEl.addEventListener('input', function () {
		autosize(); updateSendEnabled(); updateMentionMenu(); updateSlashMenu();
	});
	promptEl.addEventListener('focus', function () { inputCard.classList.add('focused'); });
	promptEl.addEventListener('blur', function () { inputCard.classList.remove('focused'); });
	followBtn.addEventListener('click', function () { vscode.postMessage({ type: 'toggleFollow' }); });
	promptEl.addEventListener('keydown', function (e) {
		// con el autocomplete de @ abierto, el teclado navega el menú (no manda el mensaje)
		if (!mentionMenu.hidden) {
			if (e.key === 'ArrowDown') { e.preventDefault(); moveMentionSel(1); return; }
			if (e.key === 'ArrowUp') { e.preventDefault(); moveMentionSel(-1); return; }
			if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptMention(mentionItems[mentionSel]); return; }
			if (e.key === 'Escape') { e.preventDefault(); closeMentionMenu(); return; }
		}
		// ídem con el autocomplete de /comandos (el ghost del hint no tiene items: Enter envía)
		if (!slashMenu.hidden && slashItems.length) {
			if (e.key === 'ArrowDown') { e.preventDefault(); moveSlashSel(1); return; }
			if (e.key === 'ArrowUp') { e.preventDefault(); moveSlashSel(-1); return; }
			if (e.key === 'Enter' || e.key === 'Tab') {
				var sit = slashItems[slashSel];
				if (sit) { e.preventDefault(); acceptSlash(sit); return; }
				closeSlashMenu();
			}
			if (e.key === 'Escape') { e.preventDefault(); closeSlashMenu(); return; }
		}
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
	});
	messagesEl.addEventListener('click', function (e) {
		var t = e.target;
		var cp = t && t.closest ? t.closest('.copy') : null;
		if (cp) { var data = decodeURIComponent(cp.getAttribute('data-copy') || ''); try { navigator.clipboard.writeText(data); } catch (err) { } return; }
		var df = t && t.closest ? t.closest('.diagram-full') : null;
		if (df) {
			// pantalla completa = MODAL NATIVO del workbench (con zoom), no el modal casero
			var svgEl = document.getElementById(df.getAttribute('data-svg-id'));
			if (svgEl) { vscode.postMessage({ type: 'diagramFullscreen', html: svgEl.outerHTML }); }
			return;
		}
		var mi = t && t.closest ? t.closest('.msg-img') : null;
		if (mi) { var im = mi.querySelector('img'); if (im) { openImagePreview(im.src); } return; }
		var ac = t && t.closest ? t.closest('.attach-chip') : null;
		if (ac && !t.closest('.attach-remove')) { var aim = ac.querySelector('img'); if (aim) { openImagePreview(aim.src); } return; }
		var a = t && t.closest ? t.closest('a[href]') : null;
		if (a) { e.preventDefault(); vscode.postMessage({ type: 'open', url: a.getAttribute('href') }); }
	});
	dockEl.addEventListener('click', function (e) {
		if (e.target && e.target.closest && e.target.closest('.dock-file-action')) { return; }
		var fr = e.target && e.target.closest ? e.target.closest('.dock-file-row') : null;
		if (fr) { vscode.postMessage({ type: 'openDiff', path: fr.getAttribute('data-path') }); return; }
		var tr = e.target && e.target.closest ? e.target.closest('.dock-bg-row') : null;
		if (tr) { vscode.postMessage({ type: 'revealTerminal', id: tr.getAttribute('data-id') }); return; }
	});

	window.addEventListener('message', function (event) {
		var m = event.data;
			switch (m.type) {
			case 'text': removeRetry(); appendText(m.delta); break;
			case 'reasoning': removeRetry(); appendReasoning(m.delta); break;
			case 'followState': setFollowState(!!m.enabled); break;
			case 'toolStart': removeRetry(); addTool(m.id, m.name, m.argumentsJson); break;
			case 'retry': renderRetry(m); break;
			case 'toolResult': finishTool(m.id, m.name, m.result, m.isError); break;
			case 'terminalData': feedTermCard(m.id, m.data); break;
			case 'screenshot': renderScreenshot(m); break;
			case 'usage':
				if (typeof m.inputTokens === 'number') { ctx.input = m.inputTokens; }
				if (typeof m.outputTokens === 'number') { ctx.output = m.outputTokens; }
				if (typeof m.contextUsed === 'number') { ctx.used = m.contextUsed; }
				if (typeof m.contextLimit === 'number' && m.contextLimit > 0) { ctx.limit = m.contextLimit; }
				ctx.breakdown = m.breakdown || null;
				renderCtx(); break;
			case 'contextCapabilities':
				ctx.capabilities = { tools: Number(m.tools) || 0, mcp: Number(m.mcp) || 0, skills: Number(m.skills) || 0 };
				renderCtx(); break;
			case 'compaction': removeGenerating(); renderCompaction(m, false); break;
			case 'info': renderNotice(m.message); break;
			case 'voiceState': applyVoiceState(String(m.status || 'idle')); break;
			case 'voiceText': insertVoiceText(String(m.text || '')); break;
			case 'approvalRequest': renderApproval(m); break;
			case 'approval': addDecisionRow(m.name, m.decision); break;
			case 'todos': handleTodoUpdate(m.items); break;
			case 'ask': renderAsk(m); break;
			case 'fileDiff': renderFileDiff(m); upgradeEditCard(m); break;
			case 'delegationStart': onDelegationStart(m); break;
			case 'subagentStart': onSubagentStart(m); break;
			case 'subagentRun': renderPersistentSubagentRun(m.run); break;
			case 'subagentTimeline': appendPersistentSubagentTimeline(m.runId, m.event); break;
			case 'subagentEvent': onSubagentEvent(m); break;
			case 'subagentDone': onSubagentDone(m); break;
			case 'delegationDone': onDelegationDone(m); break;
			case 'planCard': renderPlanCard(m); break;
			case 'canvasCard': renderCanvasCard(m); break;
			case 'suggestMode': renderSuggestMode(m); break;
			case 'planResolved': resolvePlanCard(String(m.path || ''), String(m.status || '')); break;
			case 'planBuildStart':
				// Aprobación silenciosa: sólo actualizar flags/card. El host inicia el run hidden.
				applyMode('agent');
				resolvePlanCard(String(m.path || ''), 'aprobado');
				setBusy(true); ensureGenerating();
				break;
			case 'silentModeResume':
			        applyMode(String(m.mode || 'agent')); setBusy(true); ensureGenerating();
			        break;
			case 'canvasChoice':
			        if (!busy && typeof m.label === 'string' && m.label.trim()) { promptEl.value = m.label.trim(); autosize(); updateSendEnabled(); promptEl.focus(); }
			        break;
			case 'resendEdited':
				applyMode(String(m.mode || 'agent'));
				var editedCapabilities = Array.isArray(m.capabilities) ? m.capabilities : [];
				var editedLinkData = extractComposerLinks(String(m.text || ''));
				var editedPayload = composerPayload(editedLinkData.text, editedCapabilities, editedLinkData.links);
				dispatchSend(editedPayload.text, Array.isArray(m.images) ? m.images : [], editedPayload.displayText, [], editedCapabilities, editedLinkData.links, m.providerId, m.model);
				break;
			case 'rollbackCommitted':
				// Un commit reemplaza de manera autoritativa transcript + composer. Cerrar cualquier editor
				// inline viejo evita que un nodo desconectado vuelva a inyectar el turno eliminado.
				if (activeMessageEditor && activeMessageEditor.cancel) { activeMessageEditor.cancel(); }
				applyMode(String(m.mode || 'agent'));
				restoreThread(m.messages || []);
				hydrateRollbackComposer(m.composer || {});
				setBusy(false);
				break;
			case 'rollbackRejected':
				var pendingRollback = document.querySelector('[data-rollback-request="' + String(m.requestId || '') + '"]');
				if (pendingRollback) { pendingRollback.disabled = false; pendingRollback.removeAttribute('data-rollback-request'); }
				if (m.message) { renderNotice(m.message); }
				break;
			case 'backgroundTerminal': renderBgTerm(m); break;
			case 'runState':
				setBusy(!!m.busy);
				if (!m.busy) { removeGenerating(); removeRetry(); assistant = null; finalizeReasoning(); setTimeout(drainQueue, 60); }
				break;
			case 'clear': clearConversation(); break;
			case 'tabs': openTabs = m.open || []; allSessions = m.all || []; activeSessionId = m.activeId || ''; renderTabs(); if (!historyMenu.hidden) { renderHistoryList(); } break;
			case 'restore': restoreThread(m.messages); break;
			case 'done': setBusy(false); removeGenerating(); removeRetry(); assistant = null; finalizeReasoning(); setTimeout(drainQueue, 60); break;
			case 'error': removeGenerating(); removeRetry(); addErrorMsg(m.message, m.action); setBusy(false); assistant = null; finalizeReasoning(); setTimeout(drainQueue, 60); break;
			case 'diagramSpec': applyDiagramResult(String(m.key), m.result); break;
			case 'session': applySession(m); break;
			case 'pickChip': renderPickChip(String(m.selector || '')); break;
			case 'showCtx': modelMenu.hidden = true; modeMenu.hidden = true; toggleCtxPanel(); break;
			case 'fileSuggest':
				// respuesta del autocomplete de @: solo si el token sigue vigente (evita stale)
				if (mentionQuery && m.q === mentionQuery.q) {
					mentionItems = Array.isArray(m.items) ? m.items : [];
					mentionIcons = Array.isArray(m.icons) ? m.icons : [];
					mentionSel = 0;
					renderMentionMenu();
				}
				break;
			case 'commandSuggest':
				// respuesta del autocomplete de /: mismo guard anti-stale por token que el @
				if (slashQuery && m.q === slashQuery.q) {
					var slashOrder = { skill: 0, command: 1, mcp: 2, tool: 3 };
					slashItems = (Array.isArray(m.items) ? m.items : []).slice().sort(function (a, b) {
						var group = (slashOrder[a.kind] == null ? 9 : slashOrder[a.kind]) - (slashOrder[b.kind] == null ? 9 : slashOrder[b.kind]);
						return group || String(a.name || '').localeCompare(String(b.name || ''));
					});
					slashSel = 0;
					renderSlashMenu();
				}
				break;
			case 'tokenColorsCss': {
				var tokStyle = document.getElementById('tokenColorsCss');
				if (tokStyle) { tokStyle.textContent = String(m.css || ''); }
				break;
			}
			case 'iconThemeCss': {
				// stylesheet del file icon theme activo (urls ya reescritas por el host)
				var iconStyle = document.getElementById('iconThemeCss');
				iconStyle.textContent = String(m.css || '');
				iconThemeReady = !!m.css;
				document.body.classList.toggle('show-file-icons', iconThemeReady);
				refreshFileThemeIcons();
				break;
			}
			case 'agentLayoutReady':
				// El workbench primero reserva la columna y recién entonces movemos el
				// contenido del webview. Evita un frame intermedio con dos relayouts.
				applyAgentLayoutState(m.open === true);
				break;
		}
	});

	autosize(); updateSendEnabled(); renderCtx();
	vscode.postMessage({ type: 'ready' });
}());
</script>
</body>
</html>`;
}
