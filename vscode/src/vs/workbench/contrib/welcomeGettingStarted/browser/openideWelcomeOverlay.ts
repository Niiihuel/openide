/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE's first-run screen.
 *
 *  Its own module, and its own stylesheet. It used to live inline in
 *  `gettingStarted.contribution.ts` as ~330 lines of `style.cssText` strings -- which is why it
 *  was the one surface in the product that had drifted off the design system entirely: hardcoded
 *  radii (5px, 8px, 50%), hardcoded hex fallbacks (#0e639c, #303031, #888), its own button
 *  shapes, and a rocket emoji standing in for the product mark. None of that could be restyled by
 *  a theme, and none of it could be found by `dev/audit-surface-tokens.mjs`, which reads
 *  stylesheets.
 *
 *  What it shows is deliberate. This runs once, on a genuinely fresh install, and the four things
 *  it asks about are the four a new install cannot answer for itself: how it should look, who the
 *  user is on GitHub, what configuration they already have somewhere else, and how it will keep
 *  itself current.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, reset } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IOpenideAgentService } from '../../openideAgent/browser/openideAgentService.js';
import { applyOpenideSurfaceCss } from '../../openideAgent/browser/openideSurfaceStyle.js';
import { t } from '../../openideAgent/common/openideStrings.js';
import { IOpenIDEEditor, OPENIDE_EDITORS } from './openideWelcomeEditors.js';
import './media/openideWelcome.css';

/** Theme previews: a mock of the workbench drawn in each OpenIDE theme's real palette. */
interface IOpenIDETheme { id: string; label: string; bg: string; sidebar: string; topbar: string; lines: string[] }
const OPENIDE_THEMES: ReadonlyArray<IOpenIDETheme> = [
	{ id: 'OpenIDE Dark', label: t('welcome.theme.dark'), bg: '#141414', sidebar: '#171717', topbar: '#1f1f1f', lines: ['#5a5a5a', '#8a8a8a', '#6e6e6e', '#9a9a9a', '#7a7a7a'] },
	{ id: 'OpenIDE Light', label: t('welcome.theme.light'), bg: '#ffffff', sidebar: '#f3f3f3', topbar: '#ececec', lines: ['#bdbdbd', '#888888', '#a6a6a6', '#999999', '#bdbdbd'] },
];

/** Widths for the fake code lines in a theme preview, so the mock reads as code and not as a bar chart. */
const PREVIEW_LINE_WIDTHS = ['70%', '45%', '85%', '55%', '38%'];

export interface IOpenideWelcomeServices {
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly authenticationService: IAuthenticationService;
	readonly productService: IProductService;
	readonly updateService: IUpdateService;
	readonly agentService: IOpenideAgentService;
}

/**
 * Paints an editor's mark.
 *
 * VS Code's is the only one with colour of its own, so it goes in as an `<img>`. The rest are
 * single-path glyphs and are masked instead, which makes them take `currentColor` -- the same
 * trick the product mark uses, and the reason they stay legible on a light theme.
 */
function appendEditorLogo(parent: HTMLElement, editor: IOpenIDEEditor): void {
	if (editor.id === 'vscode') {
		const img = append(parent, $('img.openide-welcome-editor-mark')) as HTMLImageElement;
		img.src = editor.logo;
		img.setAttribute('aria-hidden', 'true');
		return;
	}
	const mark = append(parent, $('span.openide-welcome-editor-mark.masked'));
	mark.setAttribute('aria-hidden', 'true');
	// The mark is data, not markup: setting it as a CSS mask keeps it out of innerHTML and out of
	// the way of Trusted Types.
	mark.style.setProperty('-webkit-mask-image', `url("${editor.logo}")`);
	mark.style.setProperty('mask-image', `url("${editor.logo}")`);
}

/** The one-line state of the updater, in the same words `openideUpdateContribution` uses. */
function describeUpdateState(updateService: IUpdateService, product: IProductService): string {
	const state = updateService.state;
	switch (state.type) {
		case StateType.CheckingForUpdates: return t('welcome.update.checking');
		case StateType.AvailableForDownload: return t('welcome.update.available', product.nameShort, state.update.productVersion ?? '');
		case StateType.Downloading: return t('welcome.update.downloading');
		case StateType.Verifying: return t('welcome.update.verifying');
		case StateType.Downloaded: return t('welcome.update.downloaded');
		case StateType.Ready: return t('welcome.update.ready');
		case StateType.Disabled: return t('welcome.update.disabled');
		default: return t('welcome.update.idle');
	}
}

/**
 * OpenIDE's first-run overlay: a four-step wizard, one step on screen at a time.
 */
export function showOpenIDEWelcomeOverlay(services: IOpenideWelcomeServices): void {
	// Avoid duplicates when an overlay is already open.
	if (mainWindow.document.querySelector('.openide-welcome-overlay')) {
		return;
	}

	const { commandService, configurationService, authenticationService, productService, updateService, agentService } = services;

	// The stylesheet below is written against the `--oi-*` tokens. They are installed at
	// BlockRestore by `OpenideDialogsContribution`, well before this can run, but the call is
	// idempotent and this surface is also reachable by command -- so it asks rather than assumes.
	applyOpenideSurfaceCss();

	const store = new DisposableStore();
	let current = 0;

	// Mounted inside .monaco-workbench so the --vscode-* variables (the theme's colours)
	// cascade into the overlay and update live when the theme changes.
	const overlayHost = (mainWindow.document.querySelector('.monaco-workbench') as HTMLElement) ?? mainWindow.document.body;
	const overlay = append(overlayHost, $('.openide-welcome-overlay'));
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', t('welcome.title', productService.nameLong));
	const dismiss = () => { store.dispose(); overlay.remove(); };

	// ---- Header: the mark, the product, the build, and the way out ----------------------------

	const header = append(overlay, $('header.openide-welcome-header'));
	const brand = append(header, $('.openide-welcome-brand'));
	append(brand, $('.openide-welcome-mark', { 'aria-hidden': 'true' }));
	const brandText = append(brand, $('.openide-welcome-brand-text'));
	append(brandText, $('.openide-welcome-product', {}, productService.nameLong));
	// The version is here and not in a step because it is the answer to "what did I just install",
	// and it is the first thing anyone pastes into an issue.
	append(brandText, $('.openide-welcome-build', {}, productService.version));

	const skip = append(header, $('button.openide-welcome-skip'));
	skip.textContent = t('welcome.skip');
	store.add(addDisposableListener(skip, 'click', () => dismiss()));

	// ---- Body: one step at a time -------------------------------------------------------------

	const body = append(overlay, $('.openide-welcome-body'));
	const inner = append(body, $('.openide-welcome-inner'));
	const stepTitle = append(inner, $('h1.openide-welcome-step-title'));
	const stepSubtitle = append(inner, $('p.openide-welcome-step-subtitle'));
	const stepArea = append(inner, $('.openide-welcome-step'));

	const setStepHeader = (title: string, subtitle: string) => {
		stepTitle.textContent = title;
		stepSubtitle.textContent = subtitle;
	};

	// ---- Step 1: theme ------------------------------------------------------------------------

	const renderThemeStep = (host: HTMLElement) => {
		setStepHeader(
			t('welcome.step1.title'),
			t('welcome.step1.desc'));

		const row = append(host, $('.openide-welcome-themes'));
		const tiles: HTMLElement[] = [];
		const currentTheme = configurationService.getValue<string>('workbench.colorTheme');

		for (const theme of OPENIDE_THEMES) {
			const tile = append(row, $('button.openide-welcome-theme')) as HTMLButtonElement;
			tile.setAttribute('aria-pressed', String(currentTheme === theme.id));

			const preview = append(tile, $('.openide-welcome-theme-preview'));
			preview.setAttribute('aria-hidden', 'true');
			// The preview is a portrait of ONE theme, so its colours are the theme's own and cannot
			// come from tokens: painting it with `--oi-*` would draw every tile in the theme that is
			// already active, which is precisely the comparison the step exists to offer.
			preview.style.background = theme.bg;
			append(preview, $('.openide-welcome-theme-topbar')).style.background = theme.topbar;
			const previewBody = append(preview, $('.openide-welcome-theme-body'));
			append(previewBody, $('.openide-welcome-theme-sidebar')).style.background = theme.sidebar;
			const code = append(previewBody, $('.openide-welcome-theme-code'));
			for (let index = 0; index < theme.lines.length; index++) {
				const line = append(code, $('.openide-welcome-theme-line'));
				line.style.width = PREVIEW_LINE_WIDTHS[index % PREVIEW_LINE_WIDTHS.length];
				line.style.background = theme.lines[index];
			}

			append(tile, $('.openide-welcome-theme-label', {}, theme.label));
			tiles.push(tile);
			tile.classList.toggle('selected', currentTheme === theme.id);

			store.add(addDisposableListener(tile, 'click', () => {
				configurationService.updateValue('workbench.colorTheme', theme.id);
				for (const other of tiles) {
					other.classList.remove('selected');
					other.setAttribute('aria-pressed', 'false');
				}
				tile.classList.add('selected');
				tile.setAttribute('aria-pressed', 'true');
			}));
		}
	};

	// ---- Step 2: GitHub -----------------------------------------------------------------------

	const renderGitHubStep = (host: HTMLElement) => {
		setStepHeader(
			t('welcome.step2.title'),
			t('welcome.step2.desc'));

		const status = append(host, $('.openide-welcome-github'));
		const render = async () => {
			reset(status);
			let connected: string | undefined;
			try {
				const sessions = await authenticationService.getSessions('github');
				if (sessions.length) {
					connected = sessions[0].account.label;
				}
			} catch {
				// the provider may not be ready yet
			}

			if (connected) {
				append(status, $('span.codicon.codicon-pass-filled.openide-welcome-connected-icon', { 'aria-hidden': 'true' }));
				append(status, $('span.openide-welcome-connected', {}, t('welcome.gh.connected', connected)));
				return;
			}

			const button = append(status, $('button.openide-welcome-button.primary')) as HTMLButtonElement;
			append(button, $('span.codicon.codicon-github', { 'aria-hidden': 'true' }));
			const label = append(button, $('span', {}, t('welcome.gh.connect')));
			store.add(addDisposableListener(button, 'click', async () => {
				label.textContent = t('welcome.gh.connecting');
				button.disabled = true;
				try {
					await authenticationService.createSession('github', ['read:user', 'user:email', 'repo']);
				} catch {
					// cancelled, or the flow failed
				}
				// The overlay may already be gone by the time the device flow comes back.
				if (status.isConnected) {
					render();
				}
			}));
		};
		void render();
	};

	// ---- Step 3: import from another editor ---------------------------------------------------

	const renderImportStep = (host: HTMLElement) => {
		setStepHeader(
			t('welcome.step3.title'),
			t('welcome.step3.desc'));

		const list = append(host, $('.openide-welcome-editors'));
		list.setAttribute('role', 'list');
		const status = append(host, $('.openide-welcome-editors-status'));
		status.textContent = t('welcome.import.searching');

		// Every editor is drawn straight away, disabled, and the probe below only PROMOTES the ones
		// it finds. Waiting for the probe to draw anything would leave the step blank for as long as
		// a shell takes to answer, and a first-run screen that starts empty reads as broken.
		const rows = new Map<string, { row: HTMLElement; button: HTMLButtonElement; detail: HTMLElement }>();
		for (const editor of OPENIDE_EDITORS) {
			const row = append(list, $('.openide-welcome-editor'));
			row.setAttribute('role', 'listitem');
			const markWrap = append(row, $('.openide-welcome-editor-logo'));
			appendEditorLogo(markWrap, editor);
			const text = append(row, $('.openide-welcome-editor-text'));
			append(text, $('.openide-welcome-editor-name', {}, editor.name));
			const detail = append(text, $('.openide-welcome-editor-detail'));
			detail.textContent = t('welcome.import.unknown');
			const button = append(row, $('button.openide-welcome-button.quiet')) as HTMLButtonElement;
			button.textContent = t('welcome.import.btn');
			button.disabled = true;
			store.add(addDisposableListener(button, 'click', () => {
				commandService.executeCommand('openide.importFromVSCode', editor.id);
			}));
			rows.set(editor.id, { row, button, detail });
		}

		// One probe for every launcher, not one per editor: `resolveExecutables` runs them through a
		// single shell command precisely because concurrent probes read each other's output.
		void agentService.resolveExecutables(OPENIDE_EDITORS.map(editor => editor.binary))
			.then(found => {
				if (!list.isConnected) {
					return;
				}
				let installed = 0;
				for (const editor of OPENIDE_EDITORS) {
					const entry = rows.get(editor.id);
					const path = found.get(editor.binary);
					if (!entry || !path) {
						continue;
					}
					installed++;
					entry.row.classList.add('found');
					entry.button.disabled = false;
					// The resolved path and not just a checkmark: on a machine with several forks
					// installed, WHICH `code` is on the PATH is the thing the user actually wants to
					// confirm before handing over their settings.
					entry.detail.textContent = path;
					entry.detail.title = path;
					list.prepend(entry.row);
				}
				status.textContent = installed
					? t('welcome.import.found', installed, OPENIDE_EDITORS.length)
					: t('welcome.import.none');
				// An editor that was not found is still importable: the launcher can be missing from
				// the PATH while the configuration folder is right where it always is.
				for (const { button } of rows.values()) {
					button.disabled = false;
				}
			}, () => {
				if (!list.isConnected) {
					return;
				}
				// The probe failing is not the same fact as "nothing is installed", and saying the
				// second when the first happened sends the user hunting through their PATH.
				status.textContent = t('welcome.import.probeFailed');
				for (const { button } of rows.values()) {
					button.disabled = false;
				}
			});
	};

	// ---- Step 4: updates ----------------------------------------------------------------------

	const renderUpdateStep = (host: HTMLElement) => {
		setStepHeader(
			t('welcome.step4.title'),
			t('welcome.step4.desc'));

		// Same anatomy as the post-update card (`postUpdateWidget.css`): banner, badge, title,
		// feature rows, actions. One shape for everything the update system says.
		const card = append(host, $('.openide-welcome-card'));
		append(card, $('.openide-welcome-card-banner', { 'aria-hidden': 'true' }));
		const cardBody = append(card, $('.openide-welcome-card-body'));
		append(cardBody, $('.openide-welcome-card-badge', {}, productService.quality === 'insider'
			? t('welcome.update.channelInsider')
			: t('welcome.update.channelStable')));
		append(cardBody, $('.openide-welcome-card-title', {}, t('welcome.update.cardTitle')));

		const features = append(cardBody, $('.openide-welcome-card-features'));
		features.setAttribute('role', 'list');
		const entries: ReadonlyArray<{ icon: string; title: string; description: string }> = [
			{
				icon: 'codicon-shield',
				title: t('welcome.update.f1.title'),
				description: t('welcome.update.f1.desc'),
			},
			{
				icon: 'codicon-verified',
				title: t('welcome.update.f2.title'),
				description: t('welcome.update.f2.desc'),
			},
			{
				icon: 'codicon-history',
				title: t('welcome.update.f3.title'),
				description: t('welcome.update.f3.desc'),
			},
		];
		for (const entry of entries) {
			const row = append(features, $('.openide-welcome-card-feature'));
			row.setAttribute('role', 'listitem');
			append(row, $(`span.codicon.${entry.icon}.openide-welcome-card-feature-icon`, { 'aria-hidden': 'true' }));
			const text = append(row, $('.openide-welcome-card-feature-text'));
			append(text, $('.openide-welcome-card-feature-title', {}, entry.title));
			append(text, $('.openide-welcome-card-feature-description', {}, entry.description));
		}

		const actions = append(cardBody, $('.openide-welcome-card-actions'));
		const state = append(actions, $('.openide-welcome-card-state'));
		state.textContent = describeUpdateState(updateService, productService);
		store.add(updateService.onStateChange(() => {
			if (state.isConnected) {
				state.textContent = describeUpdateState(updateService, productService);
			}
		}));

		const check = append(actions, $('button.openide-welcome-button.quiet')) as HTMLButtonElement;
		check.textContent = t('welcome.update.check');
		store.add(addDisposableListener(check, 'click', () => {
			void commandService.executeCommand('openide.update.check');
		}));
	};

	const steps = [renderThemeStep, renderGitHubStep, renderImportStep, renderUpdateStep];

	// ---- Footer: progress and navigation ------------------------------------------------------

	const nav = append(overlay, $('footer.openide-welcome-nav'));

	const prevButton = append(nav, $('button.openide-welcome-button.ghost')) as HTMLButtonElement;
	append(prevButton, $('span.codicon.codicon-chevron-left', { 'aria-hidden': 'true' }));
	append(prevButton, $('span', {}, t('welcome.prev')));

	const dots = append(nav, $('.openide-welcome-dots'));
	const dotElements: HTMLElement[] = [];
	for (let index = 0; index < steps.length; index++) {
		const dot = append(dots, $('button.openide-welcome-dot')) as HTMLButtonElement;
		dot.setAttribute('aria-label', t('welcome.goToStep', index + 1, steps.length));
		dotElements.push(dot);
		store.add(addDisposableListener(dot, 'click', () => { current = index; renderCurrent(); }));
	}

	const nextButton = append(nav, $('button.openide-welcome-button.primary')) as HTMLButtonElement;
	const nextLabel = append(nextButton, $('span'));
	const nextIcon = append(nextButton, $('span.codicon.codicon-chevron-right', { 'aria-hidden': 'true' }));

	function renderCurrent() {
		reset(stepArea);
		steps[current](stepArea);
		for (let index = 0; index < dotElements.length; index++) {
			dotElements[index].classList.toggle('active', index === current);
			dotElements[index].setAttribute('aria-current', String(index === current));
		}
		prevButton.style.visibility = current === 0 ? 'hidden' : 'visible';
		const last = current === steps.length - 1;
		nextLabel.textContent = last ? t('welcome.finish') : t('welcome.next');
		nextIcon.style.display = last ? 'none' : '';
	}

	store.add(addDisposableListener(prevButton, 'click', () => { if (current > 0) { current--; renderCurrent(); } }));
	store.add(addDisposableListener(nextButton, 'click', () => {
		if (current < steps.length - 1) {
			current++;
			renderCurrent();
		} else {
			dismiss();
		}
	}));
	store.add(addDisposableListener(overlay, 'keydown', (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			dismiss();
		}
	}));

	renderCurrent();
	overlay.tabIndex = -1;
	overlay.focus();
}
