/*---------------------------------------------------------------------------------------------
 *  OpenIDE — HTML/CSS/JS del webview de la página "Proveedores de IA". Réplica del visual de
 *  settings de hermes-agent desktop (apps/desktop/src/app/settings/providers-settings.tsx +
 *  credential-key-ui.tsx + onboarding/providers.tsx), adaptada al theme de vscodium:
 *
 *    - Vista CUENTAS: proveedor recomendado destacado, grupo "Conectadas" siempre visible,
 *      "Otros proveedores" tras un disclosure, locales al final. Click en un proveedor NO
 *      conectado arranca el OAuth; el código device / paste PKCE se muestran INLINE en la
 *      página (nada de QuickPicks que se cierran al perder foco).
 *    - Vista API KEYS: búsqueda, una fila por proveedor con dot de estado + KeyField inline
 *      (key guardada = input enmascarado de solo lectura, click para editar; Guardar aparece
 *      al tipear; Quitar/Esc al editar una guardada), expandible con blurb + link de docs.
 *    - Activación: cada proveedor conectado expande selector de modelo + "Usar este proveedor"
 *      — el modelo se elige donde tiene sentido: atado a un proveedor CONECTADO.
 *
 *  IMPORTANTE: el <script> embebido NO usa template literals ni ${...} (los comería el
 *  template literal externo de TS). Sólo concatenación con '+'. Sólo ${nonce} y ${codiconCss}
 *  se interpolan. Todo el texto va por textContent (sin innerHTML con datos).
 *--------------------------------------------------------------------------------------------*/

import { getOpenideAgentSettingsHeader, getOpenideAgentSettingsNavigation, OPENIDE_AGENT_SETTINGS_NAV_CSS, OPENIDE_AGENT_SETTINGS_NAV_SCRIPT } from './openideAgentSettingsNavigation.js';

export function getOpenideProvidersHtml(nonce: string, codiconCss: string, embedded = false): string {
	return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	${codiconCss}
	${OPENIDE_AGENT_SETTINGS_NAV_CSS}
	.codicon-modifier-spin { animation: oi-spin 1.5s steps(30) infinite; }
	@keyframes oi-spin { 100% { transform: rotate(360deg); } }

	/* scrollbars estándar OpenIDE (mismo look del workbench en todos los webviews) */
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
	html, body { height: 100%; margin: 0; padding: 0; }
	body {
		font-family: var(--vscode-font-family);
		font-size: 13px;
		color: var(--vscode-foreground);
		background: var(--vscode-editor-background);
		overflow: hidden;
	}

	#providerScroll { height: 100%; overflow-y: auto; overflow-x: hidden; }
	#page { max-width: 1040px; margin: 0 auto; padding: 22px 30px 64px; }

	/* ---- header (anatomía del Settings/Profiles nativo) ---- */
	h1 { font-size: 19px; line-height: 26px; font-weight: 600; margin: 0 0 5px; }
	.sub { margin: 0 0 14px; color: var(--vscode-descriptionForeground); line-height: 1.5; }

	/* banner: credenciales en memoria (Linux sin keyring) */
	#secretsBanner {
		display: none;
		border: 1px solid rgba(128, 128, 128, 0.4);
		border-left: 3px solid var(--vscode-inputValidation-warningBorder, #cca700);
		background: var(--vscode-inputValidation-warningBackground, rgba(128, 128, 128, 0.1));
		border-radius: 2px;
		padding: 10px 12px;
		margin: 0 0 16px;
		gap: 10px;
		flex-direction: column;
	}
	#secretsBanner.on { display: flex; }
	#secretsBanner .sb-title {
		display: flex; align-items: center; gap: 8px;
		font-weight: 600; font-size: 13px;
	}
	#secretsBanner .sb-title .codicon { color: var(--vscode-inputValidation-warningBorder, #cca700); }
	#secretsBanner .sb-text {
		font-size: 12px; line-height: 1.5;
		color: var(--vscode-descriptionForeground);
	}
	#secretsBanner .sb-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

	/* estado activo actual */
	#activeLine {
		display: flex; align-items: center; gap: 8px;
		border: 0; border-radius: 5px;
		padding: 8px 10px; margin-bottom: 14px;
		background: color-mix(in srgb, var(--vscode-input-background) 84%, transparent);
	}
	#activeLine .codicon { color: var(--vscode-descriptionForeground); }
	#activeLine .al-label { color: var(--vscode-descriptionForeground); }
	#activeLine .al-value { font-weight: 600; }
	#activeLine .al-model { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 12px; }
	#activeLine.none { color: var(--vscode-descriptionForeground); }

	/* ---- tabs Cuentas / API keys ---- */
	#tabs { display: inline-flex; gap: 2px; padding: 2px; border: 0; border-radius: 5px; margin-bottom: 16px; background: var(--vscode-input-background); }
	.tab {
		appearance: none; background: transparent; border: none; color: var(--vscode-descriptionForeground);
		font-size: 13px; font-family: inherit; padding: 4px 10px; min-height: 26px; cursor: pointer;
		border-radius: 3px;
	}
	.tab:hover { color: var(--vscode-foreground); }
	.tab.on { color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); font-weight: 500; background: var(--vscode-list-activeSelectionBackground); }

	/* ---- secciones / grupos ---- */
	.headrow { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 4px 0 2px; }
	.headrow h2 { font-size: 14px; font-weight: 600; margin: 0; display: flex; align-items: center; gap: 6px; }
	.headrow h2 .codicon { font-size: 14px; color: var(--vscode-descriptionForeground); }
	.linkbtn {
		appearance: none; background: transparent; border: none; padding: 2px 0; cursor: pointer;
		color: var(--vscode-textLink-foreground); font-size: 12px; font-family: inherit;
		display: inline-flex; align-items: center; gap: 4px;
	}
	.linkbtn:hover { text-decoration: underline; }
	.caption { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.5; margin: 2px 0 10px; }
	.grouplabel { margin: 14px 2px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); }

	/* ---- fila de proveedor ---- */
	.prow {
		position: relative;
		border-radius: 6px; margin: 3px 0; cursor: pointer;
	}
	.prow:hover { background: var(--vscode-list-hoverBackground); }
	.prow.open { background: var(--vscode-list-hoverBackground); outline: none; }
	.prow.active::before {
		content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px;
		background: var(--vscode-settings-modifiedItemIndicator);
	}
	.prow-main { display: flex; align-items: center; gap: 10px; padding: 9px 12px; min-width: 0; }
	.prow-info { flex: 1; min-width: 0; }
	.prow-title { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
	.prow-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.prow-blurb { margin-top: 2px; font-size: 12px; line-height: 1.45; color: var(--vscode-descriptionForeground); }
	.prow-side { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
	.prow-chevron {
		color: var(--vscode-descriptionForeground);
		transform: rotate(0deg);
		transition: transform 150ms ease;
		transform-origin: center;
	}
	.prow.open .prow-chevron { transform: rotate(90deg); }
	@media (prefers-reduced-motion: reduce) { .prow-chevron { transition: none; } }

	/* featured (recomendado) */
	.prow.featured { border: 0; background: transparent; }
	.prow.featured:hover { background: var(--vscode-list-hoverBackground); }

	/* pills */
	.pill {
		display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px;
		font-size: 11px; font-weight: 600; border-radius: 2px; white-space: nowrap;
	}
	.pill .codicon { font-size: 11px; }
	.pill.ok { color: var(--vscode-charts-green); background: rgba(128, 128, 128, 0.12); }
	.pill.reco { color: var(--vscode-button-foreground); background: var(--vscode-button-background); text-transform: uppercase; letter-spacing: 0.1em; font-size: 10px; }
	.pill.act { color: var(--vscode-foreground); background: rgba(128, 128, 128, 0.16); }

	/* dot de estado (vista keys) */
	.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: rgba(128, 128, 128, 0.45); }
	.dot.set { background: var(--vscode-charts-green); }

	/* iconbtn (desconectar / abrir) */
	.iconbtn {
		appearance: none; display: inline-flex; align-items: center; justify-content: center;
		width: 24px; height: 24px; border: none; border-radius: 2px; background: transparent;
		color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0;
	}
	.iconbtn:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
	.iconbtn .codicon { font-size: 14px; }

	/* ---- panel expandido de una fila ---- */
	.pbody { padding: 2px 12px 12px 30px; cursor: default; display: flex; flex-direction: column; gap: 10px; }
	.pbody .caption { margin: 0; }
	.fieldrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.fieldlabel { font-size: 12px; color: var(--vscode-descriptionForeground); min-width: 60px; }

	input[type=text], input[type=password] {
		font-family: inherit; font-size: 12px; color: var(--vscode-input-foreground, var(--vscode-foreground));
		background: var(--oi-settings-raised);
		border: 1px solid var(--oi-settings-border);
		border-radius: 3px; padding: 3px 8px; outline: none; height: 28px;
	}
	input[type=text], input[type=password] { width: 260px; max-width: 100%; }

	/* ---- dropdown propio (el <select> nativo no se puede estilizar) ---- */
	.dd { position: relative; display: inline-block; min-width: 220px; }
	.dd-btn {
		appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
		width: 100%; height: 28px; padding: 3px 8px; cursor: pointer;
		font-family: inherit; font-size: 12px; color: var(--vscode-input-foreground, var(--vscode-foreground));
		background: var(--oi-settings-raised);
		border: 1px solid var(--oi-settings-border);
		border-radius: 3px;
	}
	.dd-btn:focus { outline: none; border-color: var(--vscode-focusBorder); }
	.dd-btn .dd-val { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.dd-btn .codicon { font-size: 12px; color: var(--vscode-descriptionForeground); }
	.dd-menu {
		position: absolute; top: calc(100% + 4px); left: 0; z-index: 60; min-width: 100%;
		max-height: 240px; overflow-y: auto; padding: 4px;
		background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
		color: var(--vscode-menu-foreground, var(--vscode-foreground));
		border: 1px solid var(--vscode-menu-border, rgba(128, 128, 128, 0.3));
		border-radius: 2px; box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
	}
	.dd-menu[hidden] { display: none; }
	.dd-row {
		display: flex; align-items: center; width: 100%; min-height: 24px; padding: 0 8px 0 4px;
		background: transparent; border: none; border-radius: 2px; cursor: pointer;
		font-family: inherit; font-size: 12px; color: inherit; text-align: left;
	}
	.dd-row:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, #fff)); }
	.dd-row .dd-ico { width: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
	.dd-row .dd-ico .codicon { font-size: 12px; }
	.dd-row .dd-lbl { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	/* Los tooltips [data-tip] son el HOVER NATIVO del workbench (bridge tip/tipHide al host). */
	input:focus, select:focus { border-color: var(--vscode-focusBorder); }
	input::placeholder { color: var(--vscode-input-placeholderForeground); }
	input.masked { color: var(--vscode-descriptionForeground); cursor: pointer; letter-spacing: 2px; }

	button.btn {
		appearance: none; font-family: inherit; font-size: 12px; cursor: pointer;
		border: none; border-radius: 3px; padding: 5px 12px; height: 28px;
		background: var(--vscode-button-background); color: var(--vscode-button-foreground);
		display: inline-flex; align-items: center; gap: 5px;
	}
	button.btn:hover { background: var(--vscode-button-hoverBackground); }
	button.btn.sec {
		background: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.16));
		color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
	}
	button.btn.sec:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.25)); }
	button.btn:disabled { opacity: 0.5; cursor: default; }
	button.btn .codicon { font-size: 13px; }
	.danger { color: var(--vscode-errorForeground); }
	.hintline { font-size: 11px; color: var(--vscode-descriptionForeground); display: flex; align-items: center; gap: 6px; }
	.hintline .linkbtn { font-size: 11px; }

	/* ---- panel OAuth inline ---- */
	.oauthbox {
		border: 0; border-radius: 5px;
		padding: 12px; display: flex; flex-direction: column; gap: 10px; cursor: default;
		background: color-mix(in srgb, var(--vscode-input-background) 84%, transparent);
	}
	.oauthbox .obtitle { display: flex; align-items: center; gap: 8px; font-weight: 600; }
	.oauthbox .obtext { font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.5; overflow-wrap: anywhere; }
	.usercode {
		display: flex; align-items: center; gap: 10px;
	}
	.usercode .code {
		font-family: var(--vscode-editor-font-family); font-size: 20px; font-weight: 700;
		letter-spacing: 3px; padding: 6px 14px; border: 1px dashed rgba(128, 128, 128, 0.5);
		border-radius: 2px; user-select: text;
	}
	.oauthbox.err { border-color: var(--vscode-errorForeground); }
	.oauthbox.err .obtitle { color: var(--vscode-errorForeground); }

	/* ---- UsageBar (rate-limits OAuth) ---- */
	.usagebox {
		display: flex; flex-direction: column; gap: 8px;
		padding: 10px 12px; border-radius: 5px;
		background: color-mix(in srgb, var(--vscode-input-background) 84%, transparent);
	}
	.usagebox-head {
		display: flex; align-items: center; justify-content: space-between; gap: 8px;
	}
	.usagebox-title {
		display: inline-flex; align-items: center; gap: 6px;
		font-size: 12px; font-weight: 600;
	}
	.usagebox-title .codicon { font-size: 13px; color: var(--vscode-descriptionForeground); }
	.usage-row { display: flex; flex-direction: column; gap: 4px; }
	.usage-meta {
		display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
		font-size: 11px; color: var(--vscode-descriptionForeground);
	}
	.usage-meta .ulabel { font-weight: 600; color: var(--vscode-foreground); }
	.usage-meta .upct { font-variant-numeric: tabular-nums; font-weight: 600; }
	.usage-meta .ureset { font-variant-numeric: tabular-nums; }
	.usage-track {
		height: 6px; border-radius: 999px; overflow: hidden;
		background: rgba(128, 128, 128, 0.22);
	}
	.usage-fill { height: 100%; border-radius: inherit; transition: width 240ms ease; }
	.usage-fill.green { background: var(--vscode-charts-green, #89d185); }
	.usage-fill.amber { background: var(--vscode-charts-orange, #d18616); }
	.usage-fill.red { background: var(--vscode-charts-red, #f14c4c); }
	.usage-error { font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.4; }
	.usage-empty { font-size: 11px; color: var(--vscode-descriptionForeground); }
	.usage-loading { opacity: 0.6; }

	/* ---- buscador (vista keys) ---- */
	#searchwrap {
		display: flex; align-items: center; gap: 7px; width: 100%; height: 28px;
		margin: 4px 0 10px; padding: 0 9px;
		background: var(--oi-settings-raised); border: 1px solid var(--oi-settings-focus); border-radius: 3px;
	}
	#searchwrap .codicon-search { position: static; flex: 0 0 auto; font-size: 13px; color: var(--vscode-descriptionForeground); }
	#search {
		flex: 1 1 auto; width: auto; min-width: 0; height: 26px; padding: 0;
		border: 0; border-radius: 0; background: transparent; box-shadow: none;
	}
	#search:focus { border: 0; box-shadow: none; }

	.empty { padding: 28px 12px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; }

	/* toggle "otros proveedores" */
	.disclosure {
		appearance: none; background: transparent; border: none; cursor: pointer;
		color: var(--vscode-descriptionForeground); font-size: 12px; font-family: inherit;
		display: inline-flex; align-items: center; gap: 4px; padding: 6px 2px;
	}
	.disclosure:hover { color: var(--vscode-foreground); }
	.disclosure .codicon { font-size: 12px; transition: transform 120ms ease; }
	.disclosure.open .codicon { transform: rotate(180deg); }
</style>
</head>
<body>

${embedded ? '' : `<div id="agent-settings-page">
	${getOpenideAgentSettingsHeader('Buscar proveedores de IA…')}
	<div id="agent-settings-shell">`}
	${embedded ? '' : getOpenideAgentSettingsNavigation('providers')}
	${embedded ? '' : '<main id="agent-settings-surface">'}<div id="providerScroll"><div id="page">
	<h1>Proveedores de IA</h1>
	<p class="sub">Conectá tu cuenta (suscripción / OAuth) o pegá una API key. Las credenciales se guardan cifradas en el almacén de secretos del sistema — nunca en settings.json.</p>
	<div id="secretsBanner" role="status">
		<div class="sb-title"></div>
		<div class="sb-text"></div>
		<div class="sb-actions"></div>
	</div>
	<div id="activeLine"></div>
	<div id="tabs"></div>
	<div id="content"></div>
	</div></div>${embedded ? '' : '</main>'}
${embedded ? '' : '\t</div>\n</div>'}
<script nonce="${nonce}">
(function () {
	'use strict';
	var vscode = acquireVsCodeApi();

	var state = { activeId: '', model: '', providers: [], secretsPersistence: 'unknown', canEnableBasicPasswordStore: false };
	var view = 'accounts';          // 'accounts' | 'keys'
	var showOthers = false;         // disclosure de "otros proveedores"
	var openId = null;              // fila expandida
	var editKey = {};               // id -> true (KeyField en modo edición)
	var draftKey = {};              // id -> valor tipeado
	var draftModel = {};            // id -> modelo elegido en el select
	var customModel = {};           // id -> true (input libre de modelo visible)
	var query = '';
	var oauth = null;               // { id, phase: start|code|paste|error, url, code, prompt, message }
	var busyKey = null;             // id mientras se guarda una key
	var enablingPasswordStore = false;
	var settingsScope = 'user';
	var usageById = {};             // providerId → { windows, error, fetchedAt } | null
	var usageLoading = {};          // providerId → bool

	function post(msg) { vscode.postMessage(msg); }
	${OPENIDE_AGENT_SETTINGS_NAV_SCRIPT}

	function renderSettingsScopes() {
		var bar = document.getElementById('agent-settings-scopes');
		if (!bar) { return; }
		bar.textContent = '';
		[['user', 'User'], ['workspace', 'Workspace'], ['openide', 'openide']].forEach(function (entry) {
			var button = document.createElement('button');
			button.type = 'button';
			button.className = 'agent-settings-scope' + (settingsScope === entry[0] ? ' active' : '');
			button.textContent = entry[1];
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(settingsScope === entry[0]));
			button.addEventListener('click', function () { settingsScope = entry[0]; renderSettingsScopes(); });
			bar.appendChild(button);
		});
	}

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) { n.className = cls; }
		if (text !== undefined && text !== null) { n.textContent = String(text); }
		return n;
	}

	/* Dropdown propio (el <select> nativo del browser no respeta el theme). */
	function closeDropdowns() {
		var open = document.querySelectorAll('.dd-menu:not([hidden])');
		for (var i = 0; i < open.length; i++) { open[i].hidden = true; }
	}
	function dropdown(items, value, onPick) {
		var wrap = el('div', 'dd');
		var btn = el('button', 'dd-btn');
		btn.type = 'button';
		var cur = items[0];
		for (var i = 0; i < items.length; i++) { if (items[i].value === value) { cur = items[i]; break; } }
		btn.appendChild(el('span', 'dd-val', cur ? cur.label : ''));
		btn.appendChild(icon('chevron-down'));
		var menu = el('div', 'dd-menu');
		menu.hidden = true;
		items.forEach(function (it) {
			var row = el('button', 'dd-row');
			row.type = 'button';
			var ico = el('span', 'dd-ico');
			if (it.value === value) { ico.appendChild(icon('check')); }
			row.appendChild(ico);
			row.appendChild(el('span', 'dd-lbl', it.label));
			row.addEventListener('click', function (e) {
				e.stopPropagation();
				menu.hidden = true;
				onPick(it.value);
			});
			menu.appendChild(row);
		});
		btn.addEventListener('click', function (e) {
			e.stopPropagation();
			var wasHidden = menu.hidden;
			closeDropdowns();
			menu.hidden = !wasHidden;
		});
		wrap.appendChild(btn);
		wrap.appendChild(menu);
		return wrap;
	}
	document.addEventListener('click', closeDropdowns);

	/* Tooltips [data-tip] = HOVER NATIVO del workbench: el host (openideProvidersEditor)
	   los muestra vía IHoverService sobre un anchor con el rect que mandamos. */
	var tipTimer = null;
	var tipTarget = null;
	function showTip(target) {
		var text = target.getAttribute('data-tip');
		if (!text) { return; }
		var r = target.getBoundingClientRect();
		post({ type: 'tip', text: text, x: r.left, y: r.top, w: r.width, h: r.height });
	}
	function hideTip() {
		clearTimeout(tipTimer); tipTimer = null;
		if (tipTarget) { tipTarget = null; post({ type: 'tipHide' }); }
	}
	function initTips() {
		document.addEventListener('mouseover', function (e) {
			var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
			if (t === tipTarget) { return; }
			hideTip();
			if (t) {
				tipTarget = t;
				tipTimer = setTimeout(function () { if (tipTarget === t) { showTip(t); } }, 350);
			}
		});
		document.addEventListener('mousedown', hideTip, true);
		document.addEventListener('scroll', hideTip, true);
		window.addEventListener('blur', hideTip);
	}
	initTips();
	function icon(name, extra) {
		return el('span', 'codicon codicon-' + name + (extra ? ' ' + extra : ''));
	}
	function byId(id) {
		for (var i = 0; i < state.providers.length; i++) {
			if (state.providers[i].id === id) { return state.providers[i]; }
		}
		return null;
	}
	function flowSubtitle(p) {
		if (p.auth === 'oauth') { return p.blurb || 'Iniciá sesión con tu cuenta — sin API key.'; }
		if (p.auth === 'none') { return p.blurb || 'Endpoint local, sin credencial.'; }
		return p.blurb || '';
	}

	/* ============================ header ============================ */

	function renderSecretsBanner() {
		var box = document.getElementById('secretsBanner');
		if (!box) { return; }
		if (state.secretsPersistence !== 'in-memory') {
			box.className = '';
			box.textContent = '';
			return;
		}
		box.className = 'on';
		box.textContent = '';
		var title = el('div', 'sb-title');
		title.appendChild(icon('warning'));
		title.appendChild(el('span', null, 'Las credenciales no se están guardando en disco'));
		box.appendChild(title);
		box.appendChild(el('div', 'sb-text', 'En este entorno no hay un keyring del sistema (típico en Linux sin GNOME/KDE). Las API keys y sesiones OAuth viven solo en memoria y se pierden al cambiar de carpeta o reiniciar.' + (state.canEnableBasicPasswordStore ? ' Activá el almacenamiento local, reiniciá, y volvé a conectar tus proveedores una vez.' : '')));
		if (state.canEnableBasicPasswordStore) {
			var actions = el('div', 'sb-actions');
			var btn = el('button', 'btn');
			btn.disabled = enablingPasswordStore;
			if (enablingPasswordStore) {
				btn.appendChild(icon('loading', 'codicon-modifier-spin'));
				btn.appendChild(el('span', null, 'Activando…'));
			} else {
				btn.appendChild(icon('save'));
				btn.appendChild(el('span', null, 'Guardar en disco y reiniciar'));
			}
			btn.addEventListener('click', function () {
				if (enablingPasswordStore) { return; }
				enablingPasswordStore = true;
				renderSecretsBanner();
				post({ type: 'enableBasicPasswordStore' });
			});
			actions.appendChild(btn);
			box.appendChild(actions);
		}
	}

	function renderActiveLine() {
		var box = document.getElementById('activeLine');
		box.textContent = '';
		var active = byId(state.activeId);
		if (!active || !active.connected) {
			box.className = 'none';
			box.appendChild(icon('plug'));
			box.appendChild(el('span', null, 'Sin proveedor activo — conectá uno abajo para usar el chat.'));
			return;
		}
		box.className = '';
		box.appendChild(icon('pass-filled'));
		box.appendChild(el('span', 'al-label', 'Activo:'));
		box.appendChild(el('span', 'al-value', active.label));
		var m = state.model || active.defaultModel || '';
		if (m) { box.appendChild(el('span', 'al-model', m + (state.model ? '' : ' (default)'))); }
	}

	function renderTabs() {
		var tabs = document.getElementById('tabs');
		tabs.textContent = '';
		var defs = [['accounts', 'Cuentas'], ['keys', 'API keys']];
		for (var i = 0; i < defs.length; i++) {
			(function (d) {
				var b = el('button', 'tab' + (view === d[0] ? ' on' : ''), d[1]);
				b.addEventListener('click', function () { view = d[0]; openId = null; render(); });
				tabs.appendChild(b);
			})(defs[i]);
		}
	}

	/* ============================ fila de proveedor ============================ */

	function providerRow(p, opts) {
		opts = opts || {};
		var expanded = openId === p.id || !!(oauth && oauth.id === p.id);
		var row = el('div', 'prow' + (p.id === state.activeId && p.connected ? ' active' : '') + (expanded ? ' open' : '') + (opts.featured ? ' featured' : ''));
		var main = el('div', 'prow-main');
		row.appendChild(main);

		if (opts.dot) {
			main.appendChild(el('span', 'dot' + (p.hasKey ? ' set' : '')));
		}
		var info = el('div', 'prow-info');
		main.appendChild(info);
		var title = el('div', 'prow-title');
		info.appendChild(title);
		title.appendChild(el('span', 'prow-name', p.label));
		if (opts.featured && !p.connected) {
			title.appendChild(el('span', 'pill reco', 'Recomendado'));
		}
		if (p.connected && p.auth !== 'none') {
			var okpill = el('span', 'pill ok');
			okpill.appendChild(icon('check'));
			okpill.appendChild(el('span', null, 'Conectado'));
			title.appendChild(okpill);
		}
		if (p.id === state.activeId && p.connected) {
			title.appendChild(el('span', 'pill act', 'Activo'));
		}
		if (!opts.dot) {
			info.appendChild(el('div', 'prow-blurb', flowSubtitle(p)));
		}

		var side = el('div', 'prow-side');
		main.appendChild(side);
		if (opts.dot) {
			side.appendChild(keyField(p));
		}
		if (p.auth === 'oauth' && p.connected) {
			var out = el('button', 'iconbtn');
			out.setAttribute('data-tip', 'Cerrar sesión de ' + p.label);
			out.appendChild(icon('trash'));
			out.addEventListener('click', function (e) { e.stopPropagation(); post({ type: 'signOut', id: p.id }); });
			side.appendChild(out);
		}
		side.appendChild(icon('chevron-right', 'prow-chevron'));

		main.addEventListener('click', function () { onRowClick(p); });

		if (oauth && oauth.id === p.id) {
			var wrap = el('div', 'pbody');
			wrap.addEventListener('click', function (e) { e.stopPropagation(); });
			wrap.appendChild(oauthPanel(p));
			row.appendChild(wrap);
		} else if (openId === p.id) {
			row.appendChild(rowBody(p));
		}
		return row;
	}

	function onRowClick(p) {
		if (oauth && oauth.id === p.id) { return; }
		if (p.auth === 'oauth' && !p.connected) {
			startConnect(p);
			return;
		}
		openId = (openId === p.id) ? null : p.id;
		render();
	}

	function startConnect(p) {
		oauth = { id: p.id, phase: 'start' };
		openId = null;
		post({ type: 'connect', id: p.id });
		render();
	}

	/* panel expandido: modelo + activación + acciones secundarias */
	function rowBody(p) {
		var body = el('div', 'pbody');
		body.addEventListener('click', function (e) { e.stopPropagation(); });

		if (p.blurb && p.auth !== 'apiKey') {
			body.appendChild(el('p', 'caption', p.blurb));
		}
		if (p.auth === 'apiKey') {
			if (p.blurb) { body.appendChild(el('p', 'caption', p.blurb)); }
			if (p.apiKeysUrl) {
				var get = el('button', 'linkbtn');
				get.appendChild(el('span', null, 'Conseguir una API key'));
				get.appendChild(icon('link-external'));
				get.addEventListener('click', function () { post({ type: 'openUrl', url: p.apiKeysUrl }); });
				body.appendChild(get);
			}
		}

		if (p.connected) {
			var frow = el('div', 'fieldrow');
			frow.appendChild(el('span', 'fieldlabel', 'Modelo'));
			var current = draftModel[p.id] !== undefined ? draftModel[p.id] : (p.id === state.activeId ? state.model : '');
			if (customModel[p.id]) {
				var ti = el('input');
				ti.type = 'text';
				ti.placeholder = 'nombre exacto del modelo';
				ti.value = current || '';
				ti.addEventListener('input', function () { draftModel[p.id] = ti.value.trim(); });
				frow.appendChild(ti);
				var backSel = el('button', 'linkbtn', 'lista');
				backSel.addEventListener('click', function () { delete customModel[p.id]; delete draftModel[p.id]; render(); });
				frow.appendChild(backSel);
			} else {
				var models = p.models && p.models.length ? p.models : (p.defaultModel ? [p.defaultModel] : []);
				var items = [{ value: '', label: p.defaultModel ? 'Default (' + p.defaultModel + ')' : 'Default del proveedor' }];
				for (var i = 0; i < models.length; i++) {
					if (models[i] === p.defaultModel) { continue; }
					items.push({ value: models[i], label: models[i] });
				}
				if (current && current !== p.defaultModel && models.indexOf(current) < 0) {
					items.push({ value: current, label: current });
				}
				var selValue = (current === p.defaultModel) ? '' : (current || '');
				frow.appendChild(dropdown(items, selValue, function (v) { draftModel[p.id] = v; render(); }));
				var other = el('button', 'linkbtn', 'otro…');
				other.addEventListener('click', function () { customModel[p.id] = true; render(); });
				frow.appendChild(other);
			}
			body.appendChild(frow);

			if (p.supportsUsage) {
				body.appendChild(usagePanel(p));
			}

			var actions = el('div', 'fieldrow');
			var isActive = p.id === state.activeId;
			var useBtn = el('button', 'btn');
			useBtn.appendChild(icon(isActive ? 'pass-filled' : 'check'));
			useBtn.appendChild(el('span', null, isActive ? 'Proveedor activo — aplicar modelo' : 'Usar este proveedor'));
			useBtn.addEventListener('click', function () {
				var m = draftModel[p.id] !== undefined ? draftModel[p.id] : (isActive ? state.model : '');
				post({ type: 'activate', id: p.id, model: m || '' });
			});
			actions.appendChild(useBtn);
			if (p.auth === 'oauth') {
				var re = el('button', 'btn sec');
				re.appendChild(icon('sync'));
				re.appendChild(el('span', null, 'Reconectar'));
				re.addEventListener('click', function () { startConnect(p); });
				actions.appendChild(re);
			}
			body.appendChild(actions);
		} else if (p.auth === 'apiKey') {
			body.appendChild(el('p', 'caption', 'Pegá tu API key en el campo de la derecha para conectar este proveedor.'));
		}
		return body;
	}

	function usageBand(pct) {
		if (pct == null || !isFinite(pct)) { return 'green'; }
		if (pct >= 80) { return 'red'; }
		if (pct >= 60) { return 'amber'; }
		return 'green';
	}

	function formatReset(resetsAt, resetDescription) {
		if (resetDescription) { return resetDescription; }
		if (resetsAt == null || !isFinite(resetsAt)) { return ''; }
		var ms = Math.max(0, resetsAt - Date.now());
		if (ms <= 0) { return 'Resets soon'; }
		var totalMin = Math.floor(ms / 60000);
		var days = Math.floor(totalMin / (60 * 24));
		var hours = Math.floor((totalMin % (60 * 24)) / 60);
		var mins = totalMin % 60;
		if (days > 0) { return hours > 0 ? ('Resets in ' + days + 'd ' + hours + 'h') : ('Resets in ' + days + 'd'); }
		if (hours > 0) { return mins > 0 ? ('Resets in ' + hours + 'h ' + mins + 'm') : ('Resets in ' + hours + 'h'); }
		if (mins > 0) { return 'Resets in ' + mins + 'm'; }
		return 'Resets in <1m';
	}

	function usagePanel(p) {
		var box = el('div', 'usagebox' + (usageLoading[p.id] ? ' usage-loading' : ''));
		var head = el('div', 'usagebox-head');
		var title = el('div', 'usagebox-title');
		title.appendChild(icon('graph'));
		title.appendChild(el('span', null, 'Usage'));
		head.appendChild(title);
		var refresh = el('button', 'btn sec');
		refresh.appendChild(icon(usageLoading[p.id] ? 'loading' : 'refresh'));
		refresh.appendChild(el('span', null, usageLoading[p.id] ? 'Consultando…' : 'Actualizar'));
		if (usageLoading[p.id]) { refresh.disabled = true; }
		refresh.addEventListener('click', function () { post({ type: 'refreshUsage', id: p.id }); });
		head.appendChild(refresh);
		box.appendChild(head);

		var u = usageById[p.id];
		if (!u && usageLoading[p.id]) {
			box.appendChild(el('div', 'usage-empty', 'Consultando límites…'));
			return box;
		}
		if (!u) {
			box.appendChild(el('div', 'usage-empty', 'Sin datos de usage todavía. Tocá Actualizar.'));
			return box;
		}
		if (u.error) {
			box.appendChild(el('div', 'usage-error', u.error));
			return box;
		}
		var windows = u.windows || [];
		if (!windows.length) {
			box.appendChild(el('div', 'usage-empty', 'El provider no reportó ventanas de rate-limit.'));
			return box;
		}
		for (var i = 0; i < windows.length; i++) {
			box.appendChild(usageRow(windows[i]));
		}
		return box;
	}

	function usageRow(w) {
		var row = el('div', 'usage-row');
		var meta = el('div', 'usage-meta');
		meta.appendChild(el('span', 'ulabel', w.label || 'Usage'));
		var right = el('span');
		var pct = (w.usedPercent != null && isFinite(w.usedPercent)) ? Math.round(w.usedPercent) : null;
		if (pct != null) {
			var up = el('span', 'upct', pct + '%');
			right.appendChild(up);
		}
		var reset = formatReset(w.resetsAt, w.resetDescription);
		if (reset) {
			if (pct != null) { right.appendChild(document.createTextNode(' · ')); }
			right.appendChild(el('span', 'ureset', reset));
		}
		meta.appendChild(right);
		row.appendChild(meta);
		var track = el('div', 'usage-track');
		var fill = el('div', 'usage-fill ' + usageBand(pct));
		fill.style.width = (pct != null ? Math.max(0, Math.min(100, pct)) : 0) + '%';
		track.appendChild(fill);
		row.appendChild(track);
		return row;
	}

	/* ============================ OAuth inline ============================ */

	function oauthPanel(p) {
		var box = el('div', 'oauthbox' + (oauth.phase === 'error' ? ' err' : ''));
		var title = el('div', 'obtitle');
		box.appendChild(title);

		if (oauth.phase === 'start') {
			title.appendChild(icon('loading', 'codicon-modifier-spin'));
			title.appendChild(el('span', null, 'Conectando con ' + p.label + '…'));
			box.appendChild(el('div', 'obtext', 'Se está abriendo tu navegador para autorizar el acceso.'));
		} else if (oauth.phase === 'code') {
			title.appendChild(icon('key'));
			title.appendChild(el('span', null, 'Ingresá este código en tu navegador'));
			box.appendChild(el('div', 'obtext', 'Abrimos ' + (oauth.url || 'la página de autorización') + '. Si no se abrió, entrá manualmente e ingresá el código:'));
			var uc = el('div', 'usercode');
			uc.appendChild(el('span', 'code', oauth.code || ''));
			var copy = el('button', 'btn sec');
			copy.appendChild(icon('copy'));
			copy.appendChild(el('span', null, 'Copiar'));
			copy.addEventListener('click', function () { post({ type: 'copy', text: oauth.code || '' }); });
			uc.appendChild(copy);
			if (oauth.url) {
				var reopen = el('button', 'btn sec');
				reopen.appendChild(icon('link-external'));
				reopen.appendChild(el('span', null, 'Abrir de nuevo'));
				reopen.addEventListener('click', function () { post({ type: 'openUrl', url: oauth.url }); });
				uc.appendChild(reopen);
			}
			box.appendChild(uc);
			var waiting = el('div', 'hintline');
			waiting.appendChild(icon('loading', 'codicon-modifier-spin'));
			waiting.appendChild(el('span', null, 'Esperando autorización…'));
			box.appendChild(waiting);
		} else if (oauth.phase === 'paste') {
			title.appendChild(icon('key'));
			title.appendChild(el('span', null, 'Pegá el código de autorización'));
			box.appendChild(el('div', 'obtext', oauth.prompt || 'Autorizá en el navegador y pegá acá el código (o la URL completa de redirección).'));
			var prow = el('div', 'fieldrow');
			var input = el('input');
			input.type = 'text';
			input.placeholder = 'código o URL de callback';
			input.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' && input.value.trim()) { post({ type: 'oauthPaste', value: input.value.trim() }); }
			});
			prow.appendChild(input);
			var go = el('button', 'btn');
			go.appendChild(el('span', null, 'Continuar'));
			go.addEventListener('click', function () {
				if (input.value.trim()) { post({ type: 'oauthPaste', value: input.value.trim() }); }
			});
			prow.appendChild(go);
			box.appendChild(prow);
			setTimeout(function () { input.focus(); }, 0);
		} else if (oauth.phase === 'error') {
			title.appendChild(icon('error'));
			title.appendChild(el('span', null, 'No se pudo conectar ' + p.label));
			box.appendChild(el('div', 'obtext', oauth.message || 'Error desconocido.'));
			var retry = el('button', 'btn sec');
			retry.appendChild(icon('sync'));
			retry.appendChild(el('span', null, 'Reintentar'));
			retry.addEventListener('click', function () { startConnect(p); });
			var rrow = el('div', 'fieldrow');
			rrow.appendChild(retry);
			box.appendChild(rrow);
		}

		// Aviso específico del proveedor (ej: Codex exige habilitar device-auth en ChatGPT).
		if (p.oauthHint && oauth.phase !== 'start') {
			var hint = el('div', 'obtext');
			hint.appendChild(el('span', null, p.oauthHint + ' '));
			if (p.oauthHintUrl) {
				var hl = el('button', 'linkbtn');
				hl.appendChild(el('span', null, 'Abrir configuración'));
				hl.appendChild(icon('link-external'));
				hl.addEventListener('click', function () { post({ type: 'openUrl', url: p.oauthHintUrl }); });
				hint.appendChild(hl);
			}
			box.appendChild(hint);
		}

		var cancel = el('button', 'linkbtn', oauth.phase === 'error' ? 'Cerrar' : 'Cancelar');
		cancel.addEventListener('click', function () {
			post({ type: 'oauthCancel' });
			oauth = null;
			render();
		});
		box.appendChild(cancel);
		return box;
	}

	/* ============================ KeyField (vista keys) ============================ */

	function keyField(p) {
		var wrap = el('div');
		wrap.addEventListener('click', function (e) { e.stopPropagation(); });

		if (p.hasKey && !editKey[p.id]) {
			var masked = el('input', 'masked');
			masked.type = 'text';
			masked.readOnly = true;
			masked.value = '••••••••••••';
			masked.setAttribute('data-tip', 'Click para cambiar la API key');
			masked.addEventListener('focus', function () { editKey[p.id] = true; draftKey[p.id] = ''; render(); });
			masked.addEventListener('click', function () { editKey[p.id] = true; draftKey[p.id] = ''; render(); });
			wrap.appendChild(masked);
			return wrap;
		}

		var frow = el('div', 'fieldrow');
		var input = el('input');
		input.type = 'password';
		input.placeholder = 'Pegar API key de ' + p.label + '…';
		input.value = draftKey[p.id] || '';
		input.addEventListener('input', function () {
			var was = !!(draftKey[p.id] && draftKey[p.id].trim());
			draftKey[p.id] = input.value;
			var now = !!input.value.trim();
			if (was !== now) { render(); refocusKey(p.id); }
		});
		input.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' && input.value.trim()) { saveKey(p); }
			if (e.key === 'Escape' && editKey[p.id]) {
				e.preventDefault();
				delete editKey[p.id]; delete draftKey[p.id];
				render();
			}
		});
		input.dataset.keyfor = p.id;
		frow.appendChild(input);
		if (draftKey[p.id] && draftKey[p.id].trim()) {
			var save = el('button', 'btn');
			save.disabled = busyKey === p.id;
			save.appendChild(busyKey === p.id ? icon('loading', 'codicon-modifier-spin') : icon('save'));
			save.appendChild(el('span', null, busyKey === p.id ? 'Guardando…' : 'Guardar'));
			save.addEventListener('click', function () { saveKey(p); });
			frow.appendChild(save);
		}
		wrap.appendChild(frow);
		if (editKey[p.id] && p.hasKey) {
			var hint = el('div', 'hintline');
			var rm = el('button', 'linkbtn danger', 'Quitar la key');
			rm.addEventListener('click', function () {
				delete editKey[p.id]; delete draftKey[p.id];
				post({ type: 'clearKey', id: p.id });
			});
			hint.appendChild(rm);
			hint.appendChild(el('span', null, '· o Esc para cancelar'));
			wrap.appendChild(hint);
		}
		return wrap;
	}

	function refocusKey(id) {
		var inp = document.querySelector('input[data-keyfor="' + id + '"]');
		if (inp) {
			inp.focus();
			var v = inp.value;
			inp.setSelectionRange(v.length, v.length);
		}
	}

	function saveKey(p) {
		var v = (draftKey[p.id] || '').trim();
		if (!v) { return; }
		busyKey = p.id;
		post({ type: 'saveKey', id: p.id, key: v });
		render();
	}

	/* ============================ vistas ============================ */

	function renderAccounts(root) {
		var oauthProviders = [];
		var locals = [];
		var filter = query.trim().toLowerCase();
		for (var i = 0; i < state.providers.length; i++) {
			var p = state.providers[i];
			if (filter && (p.label + ' ' + (p.company || '') + ' ' + (p.blurb || '')).toLowerCase().indexOf(filter) < 0) { continue; }
			if (p.auth === 'oauth') { oauthProviders.push(p); }
			if (p.auth === 'none') { locals.push(p); }
		}

		var head = el('div', 'headrow');
		var h2 = el('h2');
		h2.appendChild(icon('account'));
		h2.appendChild(el('span', null, 'Conectá una cuenta'));
		head.appendChild(h2);
		var wantKey = el('button', 'linkbtn', 'Tengo una API key');
		wantKey.addEventListener('click', function () { view = 'keys'; openId = null; render(); });
		head.appendChild(wantKey);
		root.appendChild(head);
		root.appendChild(el('p', 'caption', 'Usá una cuenta compatible (ChatGPT, Copilot, Google, SuperGrok…) iniciando sesión — sin API key.'));

		var FEATURED = 'openai-codex';
		var featured = null;
		var connected = [];
		var others = [];
		for (var j = 0; j < oauthProviders.length; j++) {
			var q = oauthProviders[j];
			if (q.id === FEATURED && !q.connected) { featured = q; continue; }
			if (q.connected) { connected.push(q); } else { others.push(q); }
		}

		if (featured) {
			root.appendChild(providerRow(featured, { featured: true }));
		}
		if (connected.length) {
			root.appendChild(el('div', 'grouplabel', 'Conectadas'));
			for (var c = 0; c < connected.length; c++) { root.appendChild(providerRow(connected[c])); }
		}

		var collapsible = connected.length > 0 && (others.length > 0 || locals.length > 0);
		var open = !collapsible || showOthers || (oauth && !!findIn(others, oauth.id)) || (openId && !!findIn(others.concat(locals), openId));
		if (open) {
			if (connected.length && (others.length || locals.length)) {
				root.appendChild(el('div', 'grouplabel', 'Otros proveedores'));
			}
			for (var o = 0; o < others.length; o++) { root.appendChild(providerRow(others[o])); }
			if (locals.length) {
				root.appendChild(el('div', 'grouplabel', 'Locales (sin credencial)'));
				for (var l = 0; l < locals.length; l++) { root.appendChild(providerRow(locals[l])); }
			}
		}
		if (collapsible) {
			var d = el('button', 'disclosure' + (open ? ' open' : ''));
			d.appendChild(el('span', null, open ? 'Contraer' : 'Conectar otra cuenta'));
			d.appendChild(icon('chevron-down'));
			d.addEventListener('click', function () { showOthers = !open; render(); });
			root.appendChild(d);
		}
	}

	function findIn(arr, id) {
		for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) { return arr[i]; } }
		return null;
	}

	function renderKeys(root) {
		var head = el('div', 'headrow');
		var h2 = el('h2');
		h2.appendChild(icon('key'));
		h2.appendChild(el('span', null, 'API keys'));
		head.appendChild(h2);
		var wantAcc = el('button', 'linkbtn', 'Prefiero conectar una cuenta');
		wantAcc.addEventListener('click', function () { view = 'accounts'; openId = null; render(); });
		head.appendChild(wantAcc);
		root.appendChild(head);
		root.appendChild(el('p', 'caption', 'Una fila por proveedor: pegá la key y guardala. Click en la fila para ver de dónde sacarla y elegir modelo.'));

		var q = query.trim().toLowerCase();
		var any = false;
		for (var i = 0; i < state.providers.length; i++) {
			var p = state.providers[i];
			if (p.auth !== 'apiKey') { continue; }
			if (q) {
				var hay = (p.label + ' ' + (p.company || '') + ' ' + (p.blurb || '')).toLowerCase();
				if (hay.indexOf(q) < 0) { continue; }
			}
			any = true;
			root.appendChild(providerRow(p, { dot: true }));
		}
		if (!any) {
			root.appendChild(el('div', 'empty', q ? 'Ningún proveedor coincide con "' + query + '".' : 'No hay proveedores por API key en el catálogo.'));
		}
	}

	function render() {
		renderSecretsBanner();
		renderActiveLine();
		renderTabs();
		var count = document.getElementById('agent-settings-count');
		if (count) { count.textContent = state.providers.length + ' proveedores'; }
		var root = document.getElementById('content');
		root.textContent = '';
		if (view === 'accounts') { renderAccounts(root); } else { renderKeys(root); }
	}

	renderSettingsScopes();
	var settingsSearch = document.getElementById('agent-settings-search');
	if (settingsSearch) {
		settingsSearch.addEventListener('input', function () {
			query = this.value;
			render();
		});
	}

	/* ============================ mensajes del host ============================ */

	window.addEventListener('message', function (ev) {
		var msg = ev.data || {};
		switch (msg.type) {
			case 'settingsFilter':
				query = String(msg.query || '');
				render();
				break;
			case 'state': {
				state = {
					activeId: msg.activeId || '',
					model: msg.model || '',
					providers: msg.providers || [],
					secretsPersistence: msg.secretsPersistence || 'unknown',
					canEnableBasicPasswordStore: !!msg.canEnableBasicPasswordStore
				};
				busyKey = null;
				enablingPasswordStore = false;
				// una key recién guardada sale del modo edición
				for (var i = 0; i < state.providers.length; i++) {
					var p = state.providers[i];
					if (p.hasKey && draftKey[p.id] !== undefined && !editKey[p.id]) { delete draftKey[p.id]; }
				}
				render();
				break;
			}
			case 'keySaved': {
				delete editKey[msg.id];
				delete draftKey[msg.id];
				busyKey = null;
				openId = msg.id; // mostrar el panel de modelo/activación recién conectado
				render();
				break;
			}
			case 'oauth': {
				if (!oauth || oauth.id !== msg.id) { oauth = { id: msg.id }; }
				oauth.phase = msg.phase;
				oauth.url = msg.url;
				oauth.code = msg.code;
				oauth.prompt = msg.prompt;
				oauth.message = msg.message;
				if (msg.phase === 'done') {
					oauth = null;
					openId = msg.id; // el proveedor recién conectado queda expandido
				}
				render();
				break;
			}
			case 'usageLoading': {
				usageLoading[msg.id] = !!msg.loading;
				// re-render sólo si el panel del provider está abierto
				if (openId === msg.id) { render(); }
				break;
			}
			case 'usage': {
				usageById[msg.id] = msg.usage || null;
				usageLoading[msg.id] = false;
				if (openId === msg.id) { render(); }
				break;
			}
		}
	});

	render();
	post({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
