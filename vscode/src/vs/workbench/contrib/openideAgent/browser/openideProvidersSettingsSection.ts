/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > Providers.
 *
 *  An account is not a config key: credentials live in the system secret store and the state
 *  (connected, quota, accounts) is live. The page is 100% section.
 *
 *  All the logic already lives in IOpenideAgentService — here we only draw and call. What
 *  disappeared when migrating from the webview: the "Accounts / API keys" tabs that invented a
 *  navigation parallel to Settings' own, and the custom CSS for buttons, switches and inputs.
 *
 *  OAuth is INLINE in the provider's row: showing the code and waiting for authorization inside
 *  the row that asked for it makes its origin visible, which a separate modal loses.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import type { IOpenideSettingsNavigationEntry } from '../../openideSettings/common/openideSettingsTypes.js';
import { ISectionStatus, OpenideSectionRenderer } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import { filterProviderModels, orderProviderModels, PROVIDER_MODEL_SEARCH_THRESHOLD } from '../common/openideProviderModels.js';
import { providerSupportsUsage } from '../common/openideUsage.js';
import { IOpenideAgentService, IOpenidePickerModel } from './openideAgentService.js';
import { IOAuthInteraction } from './openideOAuth.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { openideInputBoxStyles } from './openideControlStyles.js';
import { createProviderIcon } from './openideProviderIcons.js';
import { t } from '../common/openideStrings.js';

interface IProviderView {
	readonly id: string;
	readonly label: string;
	readonly company: string;
	readonly auth: string;
	readonly blurb: string;
	readonly connected: boolean;
	readonly hasKey: boolean;
	readonly supportsUsage: boolean;
	readonly accounts: readonly { id: string; label: string; isActive?: boolean }[];
	readonly models: readonly string[];
	/** Catalog metadata per model id (models.dev via the registry), same order as `models`. */
	readonly modelInfos: readonly IOpenidePickerModel[];
	readonly defaultModel: string;
	readonly apiKeysUrl: string;
	readonly oauthHint: string;
	readonly oauthHintUrl: string;
}

/** Login in progress. One at a time: starting another cancels the previous one. */
interface IOAuthState {
	readonly providerId: string;
	cancelled: boolean;
	phase: 'start' | 'code' | 'paste' | 'error';
	url?: string;
	code?: string;
	prompt?: string;
	message?: string;
	pendingPaste?: DeferredPromise<string | undefined>;
}

interface IUsageWindow {
	readonly label: string;
	readonly usedPercent?: number;
	readonly resetsAt?: number;
	readonly resetDescription?: string;
}

interface IUsageState {
	loading: boolean;
	error?: string;
	windows: readonly IUsageWindow[];
	loaded: boolean;
}

/** Nav id of a provider's own page. Kept next to the parser so the two never drift. */
export function providerPageId(providerId: string): string { return 'openideAgent/providers/' + providerId; }
export function providerIdFromPage(category: string | undefined): string | undefined {
	const prefix = 'openideAgent/providers/';
	return category && category.startsWith(prefix) ? category.slice(prefix.length) : undefined;
}

export class OpenideProvidersSettingsSection extends Disposable implements IOpenideSettingsSection {
	readonly ownedSettings: readonly string[] = [];

	private readonly _onDidChangeNavigation = this._register(new Emitter<void>());
	/** Fired when the provider list changes, so the sidebar picks up a new page. */
	readonly onDidChangeNavigation = this._onDidChangeNavigation.event;
	/** One page per provider. Ten providers stacked in a single scroll meant reaching the last
	 *  one required scrolling past every account form above it. */
	private _navigationChildren: readonly IOpenideSettingsNavigationEntry[] = [];
	get navigationChildren(): readonly IOpenideSettingsNavigationEntry[] { return this._navigationChildren; }
	/** Provider whose page is being drawn; undefined on the index. */
	private activeProviderId: string | undefined;
	private navigate: ((category: string) => void) | undefined;

	private readonly renderStore = this._register(new DisposableStore());
	private readonly ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);
	private root: HTMLElement | undefined;
	private generation = 0;

	private oauth: IOAuthState | undefined;
	/** Index status per provider (connected / key saved). `undefined` = never loaded (skeleton). */
	private statusCache: Map<string, { connected: boolean; hasKey: boolean }> | undefined;
	private statusLoading = false;
	private statusStale = true;
	/** Detail view of the ONE provider page being shown. The index never pays for models/accounts. */
	private detailCache: { id: string; view: IProviderView } | undefined;
	private detailLoading = false;
	private detailStale = true;
	private readonly usage = new Map<string, IUsageState>();
	/** Model chosen but not yet applied, per provider. */
	private readonly draftModel = new Map<string, string>();
	/** Query typed in the model list's search box, per provider. */
	private readonly modelQuery = new Map<string, string>();
	private readonly keyDraft = new Map<string, string>();
	private busyKey: string | undefined;
	private enablingStore = false;

	constructor(
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		// Credentials and config can change from outside (the palette wizard, another Settings).
		// The caches go stale instead of being dropped: the page repaints with the data it has and
		// the fresh load swaps it in when it lands — no skeleton flash on every credential event.
		this._register(this.agentService.onDidChange(() => {
			this.statusStale = true;
			this.detailStale = true;
			this.refreshNavigation();
			this.paint();
		}));
		this.refreshNavigation();
	}

	render(container: HTMLElement, context: IOpenideSettingsSectionContext): void {
		this.activeProviderId = providerIdFromPage(context.category);
		this.navigate = context.navigate;
		// No scope and no filter of its own: a credential belongs to the user, and search filtering
		// is applied by the editor over what this section draws.
		this.root = append(container, $('.openide-settings-sections'));
		this.paint();
	}

	override dispose(): void {
		this.cancelOAuth();
		super.dispose();
	}

	private paint(): void {
		const root = this.root;
		if (!root?.isConnected) { return; }
		this.renderStore.clear();
		clearNode(root);
		const token = ++this.generation;
		void this.paintAll(root, token);
	}

	private async paintAll(root: HTMLElement, token: number): Promise<void> {
		// The old version awaited connectivity probes, model discovery and account lists for EVERY
		// provider before painting anything: one slow endpoint (or one rejection — Promise.all)
		// left the page permanently blank. Now the index paints synchronously from the catalog and
		// the statuses stream in; the expensive data is only loaded for the ONE provider whose
		// detail page is open.
		try {
			const [persistence, canEnableStore] = await Promise.all([
				this.agentService.getSecretsPersistence(),
				this.agentService.canEnableBasicPasswordStore(),
			]);
			if (token !== this.generation || !root.isConnected) { return; }
			if (persistence === 'in-memory') {
				this.paintSecretsWarning(root, canEnableStore);
			}
		} catch {
			if (token !== this.generation || !root.isConnected) { return; }
			// The warning is advisory; a broken secrets probe must not take the page down.
		}
		try {
			if (this.activeProviderId) {
				this.paintDetailPage(root, token);
			} else {
				this.paintIndex(root, token);
			}
		} catch (error) {
			// A blank page with no explanation was the exact bug this rewrite removes: whatever
			// breaks, the user gets the reason and a way to retry.
			this.ui.callout(root, {
				tone: 'error',
				icon: 'error',
				title: t('openide.providers.paintError'),
				text: error instanceof Error ? error.message : String(error),
				actions: [{ label: t('openide.providers.retry'), icon: 'sync', run: () => this.paint() }],
			});
		}
	}

	// ---- index ----

	private paintIndex(root: HTMLElement, token: number): void {
		const entries = this.agentService.listProviders();
		const statuses = this.statusCache;
		const activeId = this.agentService.getActiveProviderId();
		const model = this.agentService.getModel();

		const body = this.ui.section(root, {
			title: t('openide.providers.title'),
			description: t('openide.providers.desc'),
			keywords: ['proveedor', 'provider', 'modelo', 'api key', 'oauth', 'cuenta', 'anthropic', 'openai'],
		});

		if (!statuses) {
			this.paintIndexSkeleton(body, Math.min(6, Math.max(3, entries.length)));
		} else {
			const connected = entries.filter(entry => statuses.get(entry.id)?.connected);
			const rest = entries.filter(entry => !statuses.get(entry.id)?.connected);
			if (connected.length) {
				append(body, $('.openide-settings-provider-group', undefined, t('openide.providers.groupConnected')));
				for (const entry of connected) { this.paintIndexRow(body, entry, statuses.get(entry.id), activeId, model); }
			}
			if (rest.length) {
				append(body, $('.openide-settings-provider-group', undefined, connected.length
					? t('openide.providers.groupAvailable')
					: t('openide.providers.groupAll')));
				for (const entry of rest) { this.paintIndexRow(body, entry, statuses.get(entry.id), activeId, model); }
			}
			if (!connected.length) {
				this.ui.callout(root, {
					tone: 'warn',
					icon: 'plug',
					title: t('openide.providers.noActive'),
					text: t('openide.providers.noActiveText'),
				});
			}
			this.paintCustomProviderRow(body);
		}

		if (this.statusStale && !this.statusLoading) {
			void this.loadStatuses(token);
		}
	}

	/** One Apple-style directory row: logo · name + state subtitle · status dot · chevron. */
	private paintIndexRow(body: HTMLElement, entry: { id: string; label: string; company: string; auth: string; blurb?: string; defaultModel?: string }, status: { connected: boolean; hasKey: boolean } | undefined, activeId: string, model: string): void {
		const row = append(body, $('.openide-settings-provider-row'));
		row.setAttribute('data-openide-search', [entry.label, entry.company, entry.id, entry.auth, entry.blurb ?? ''].join(' ').toLowerCase());
		row.setAttribute('role', 'button');
		row.tabIndex = 0;
		row.appendChild(createProviderIcon(row.ownerDocument, entry.id, entry.label, 'openide-settings-provider-logo'));
		const copy = append(row, $('.openide-settings-provider-copy'));
		append(copy, $('.openide-settings-provider-name', undefined, entry.label));
		const isActive = status?.connected && entry.id === activeId;
		const subtitle = isActive
			? (model ? t('openide.providers.rowActiveModel', model) : t('openide.providers.rowActive'))
			: status?.connected
				? t('openide.providers.rowConnected')
				: this.authLabel(entry.auth);
		append(copy, $('.openide-settings-provider-sub', undefined, subtitle));
		const state = append(row, $('.openide-settings-provider-state'));
		const dot = append(state, $('span.openide-settings-provider-dot'));
		dot.classList.toggle('ok', !!status?.connected);
		dot.classList.toggle('accent', !!isActive);
		append(row, $('span.codicon.codicon-chevron-right.openide-settings-provider-chev'));
		const open = () => this.navigate?.(providerPageId(entry.id));
		this.renderStore.add(addDisposableListener(row, 'click', open));
		this.renderStore.add(addDisposableListener(row, 'keydown', event => {
			if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') { event.preventDefault(); open(); }
		}));
	}

	private authLabel(auth: string): string {
		switch (auth) {
			case 'oauth': return t('openide.providers.authOAuth');
			case 'apiKey': return t('openide.providers.authKey');
			default: return t('openide.providers.authNone');
		}
	}

	private paintCustomProviderRow(body: HTMLElement): void {
		const row = append(body, $('.openide-settings-provider-row.openide-settings-provider-add'));
		row.setAttribute('data-openide-search', 'proveedor personalizado custom provider endpoint baseurl');
		row.setAttribute('role', 'button');
		row.tabIndex = 0;
		const mark = append(row, $('span.openide-settings-provider-logo.openide-settings-provider-addmark'));
		append(mark, $('span.codicon.codicon-add'));
		const copy = append(row, $('.openide-settings-provider-copy'));
		append(copy, $('.openide-settings-provider-name', undefined, t('openide.providers.addCustom')));
		append(copy, $('.openide-settings-provider-sub', undefined, t('openide.providers.addCustomSub')));
		append(row, $('span.codicon.codicon-chevron-right.openide-settings-provider-chev'));
		const open = () => this.navigate?.('openideAgent/advanced');
		this.renderStore.add(addDisposableListener(row, 'click', open));
		this.renderStore.add(addDisposableListener(row, 'keydown', event => {
			if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') { event.preventDefault(); open(); }
		}));
	}

	private paintIndexSkeleton(body: HTMLElement, count: number): void {
		const skeleton = append(body, $('.openide-settings-skeleton'));
		for (let index = 0; index < count; index++) {
			const row = append(skeleton, $('.openide-settings-skeleton-row'));
			append(row, $('span.openide-settings-skeleton-icon'));
			const bar = append(row, $('span.openide-settings-skeleton-bar'));
			bar.style.width = `${[46, 30, 54, 38, 44, 26][index % 6]}%`;
		}
	}

	/** Cheap per-provider status: secret-store checks and a 1.5s-capped local probe. No model
	 *  discovery, no account lists — those belong to the detail page. */
	private async loadStatuses(token: number): Promise<void> {
		this.statusLoading = true;
		try {
			const entries = this.agentService.listProviders();
			const next = new Map<string, { connected: boolean; hasKey: boolean }>();
			await Promise.all(entries.map(async entry => {
				const connected = await this.agentService.isConnected(entry.id).catch(() => false);
				const hasKey = entry.auth === 'apiKey' ? await this.agentService.hasApiKey(entry.id).catch(() => false) : false;
				next.set(entry.id, { connected, hasKey });
			}));
			this.statusCache = next;
			this.statusStale = false;
		} finally {
			this.statusLoading = false;
		}
		if (token === this.generation) { this.paint(); }
	}

	// ---- detail page ----

	private paintDetailPage(root: HTMLElement, token: number): void {
		const id = this.activeProviderId!;
		const entry = this.agentService.listProviders().find(provider => provider.id === id);
		if (!entry) {
			this.ui.empty(root, {
				title: t('openide.providers.gone'),
				description: t('openide.providers.goneDesc'),
				actions: [{ label: t('openide.providers.back'), icon: 'arrow-left', run: () => this.navigate?.('openideAgent/providers') }],
			});
			return;
		}
		const cached = this.detailCache?.id === id ? this.detailCache.view : undefined;
		if (!cached) {
			const body = this.ui.section(root, { title: entry.label, keywords: [entry.id, entry.company] });
			this.paintIndexSkeleton(body, 3);
		} else {
			this.paintDetailSections(root, cached);
		}
		if ((!cached || this.detailStale) && !this.detailLoading) {
			void this.loadDetail(id, token);
		}
	}

	/** Loads the FULL view (models, accounts, usage support) for one provider only. */
	private async loadDetail(id: string, token: number): Promise<void> {
		this.detailLoading = true;
		try {
			const entry = this.agentService.listProviders().find(provider => provider.id === id);
			if (!entry) { return; }
			const connected = await this.agentService.isConnected(entry.id).catch(() => false);
			// Warms the models.dev registry (and the 5-min dynamic-models cache) BEFORE describing
			// models: `describeModel` is sync against the registry, and on a cold start it would
			// return bare ids without names, context or cost.
			await this.agentService.getConnectedModelGroups().catch(() => undefined);
			const resolvedModels = orderProviderModels(
				await this.agentService.resolveProviderModels(entry).catch(() => entry.defaultModel ? [entry.defaultModel] : []),
				entry.defaultModel ?? '',
			);
			const view: IProviderView = {
				id: entry.id,
				label: entry.label,
				company: entry.company,
				auth: entry.auth,
				blurb: entry.blurb ?? '',
				connected,
				hasKey: entry.auth === 'apiKey' ? await this.agentService.hasApiKey(entry.id).catch(() => false) : false,
				supportsUsage: connected && providerSupportsUsage(entry),
				accounts: entry.auth !== 'none' ? await this.agentService.listAccounts(entry.id).catch(() => []) : [],
				models: resolvedModels,
				modelInfos: resolvedModels.map(modelId => this.agentService.describeModel(entry.id, modelId)),
				defaultModel: entry.defaultModel ?? '',
				apiKeysUrl: entry.apiKeysUrl ?? '',
				oauthHint: entry.oauthHint ?? '',
				oauthHintUrl: entry.oauthHintUrl ?? '',
			};
			this.detailCache = { id, view };
			this.detailStale = false;
		} finally {
			this.detailLoading = false;
		}
		if (token === this.generation && this.activeProviderId === id) { this.paint(); }
	}

	/** The detail page: grouped-inset sections instead of one mega-row with everything inside. */
	private paintDetailSections(root: HTMLElement, view: IProviderView): void {
		const activeId = this.agentService.getActiveProviderId();
		const model = this.agentService.getModel();
		const isActive = view.id === activeId && view.connected;

		if (!view.connected) {
			// Not connected: connecting IS the page. One section, one primary action — the
			// opencode flow. Everything else (models greyed below) is preview.
			this.paintConnectSection(root, view);
		} else {
			// Estado — brand, live status and the one primary action.
			const statusBody = this.ui.section(root, {
				title: t('openide.providers.secState'),
				keywords: [view.id, view.company, 'estado', 'activo'],
			});
			const head = append(statusBody, $('.openide-settings-provider-head'));
			head.appendChild(createProviderIcon(head.ownerDocument, view.id, view.label, 'openide-settings-provider-logo'));
			const headCopy = append(head, $('.openide-settings-provider-copy'));
			append(headCopy, $('.openide-settings-provider-name', undefined, view.label));
			append(headCopy, $('.openide-settings-provider-sub', undefined, view.blurb || view.company));
			this.ui.status(head, this.statusFor(view, activeId));
			if (!isActive) {
				const actions = append(statusBody, $('.openide-settings-section-actions'));
				this.ui.button(actions, {
					label: t('openide.providers.use'),
					icon: 'check',
					primary: true,
					run: () => void this.activate(view, ''),
				});
			}

			// Authentication — only when there is something to manage here. A connected OAuth
			// provider with no flow in progress used to render an EMPTY section head; its actions
			// (reconnect / sign out) already live under the Session section.
			const showAuth = this.oauth?.providerId === view.id || view.auth === 'apiKey' || view.auth === 'none';
			if (showAuth) {
				const authBody = this.ui.section(root, {
					title: t('openide.providers.secAuth'),
					keywords: ['api key', 'oauth', 'login', 'conectar', view.id],
				});
				this.paintInto(authBody, redraw => {
					if (this.oauth?.providerId === view.id) {
						this.paintOAuth(authBody, view, redraw);
					}
					if (view.auth === 'apiKey') {
						this.paintKeyField(authBody, view, redraw);
						if (view.apiKeysUrl) {
							this.ui.button(authBody, {
								label: t('openide.providers.getKey'),
								icon: 'link-external',
								run: () => void this.openerService.open(URI.parse(view.apiKeysUrl)),
							});
						}
					}
					if (view.auth === 'none') {
						append(authBody, $('.openide-settings-field-desc', undefined, t('openide.providers.noAuthDesc')));
					}
				});
			}
		}

		// Accounts — the sessions saved for this provider, each named by whoever it belongs to.
		// Directly under the actions: which account is live is the first thing you check here.
		if (view.auth !== 'none' && view.connected) {
			const accountsBody = this.ui.section(root, {
				title: t('openide.providers.secAccounts'),
				keywords: ['cuenta', 'account', 'sesión'],
			});
			this.paintInto(accountsBody, redraw => this.paintAccounts(accountsBody, view, redraw));
		}

		// Session — reconnecting and signing out. It belongs with the accounts above it: same
		// subject, and the destructive action stays at the bottom of that group.
		if ((view.auth === 'oauth' && view.connected) || (view.auth === 'apiKey' && view.hasKey)) {
			const sessionBody = this.ui.section(root, {
				title: t('openide.providers.secSession'),
				keywords: ['cerrar sesión', 'borrar', 'sign out'],
			});
			const actions = append(sessionBody, $('.openide-settings-section-actions'));
			if (view.auth === 'oauth' && view.connected) {
				this.ui.button(actions, {
					label: t('openide.providers.reconnect'), icon: 'sync',
					run: () => this.startOAuth(view.id, { mode: 'default' }),
				});
				this.ui.button(actions, {
					label: t('openide.providers.signOut'), icon: 'sign-out', danger: true,
					confirm: t('openide.providers.signOutConfirm'),
					run: () => void this.agentService.signOut(view.id).then(() => { this.detailStale = true; this.paint(); }),
				});
			}
			if (view.auth === 'apiKey' && view.hasKey) {
				this.ui.button(actions, {
					label: t('openide.providers.clearKey'), icon: 'trash', danger: true,
					confirm: t('openide.providers.clearKeyConfirm'),
					run: () => void this.agentService.clearApiKey(view.id).then(() => { this.detailStale = true; this.paint(); }),
				});
			}
		}

		// Usage — plan and rate-limit windows, OAuth providers only.
		if (view.supportsUsage) {
			const usageBody = this.ui.section(root, {
				title: t('openide.providers.secUsage'),
				keywords: ['usage', 'límite', 'rate limit', 'cuota'],
			});
			this.paintUsage(usageBody, view);
			if (!this.usage.get(view.id)) {
				void this.loadUsage(view.id, false);
			}
		}

		// Models — the models.dev catalog, opencode-style: a real list you pick from, never a
		// blank field, ending in the button that types one the catalog does not publish.
		// LAST on purpose: it is the longest block on the page, and everything above it is what
		// you came here to act on — under a hundred model rows, the accounts were unreachable.
		// Disconnected providers preview their catalog greyed out.
		this.paintModelsSection(root, view, activeId, model);
	}

	/**
	 * The whole first screen of a DISCONNECTED provider: brand, what this provider is, and ONE
	 * primary action — "Conectar con X" for OAuth, key + "Conectar" for API keys. opencode's flow:
	 * nothing to hunt for, no dead steps between pasting a key and being connected.
	 */
	private paintConnectSection(root: HTMLElement, view: IProviderView): void {
		const body = this.ui.section(root, {
			title: t('openide.providers.secConnect'),
			keywords: ['conectar', 'login', 'api key', 'oauth', view.id, view.company],
		});
		const head = append(body, $('.openide-settings-provider-head'));
		head.appendChild(createProviderIcon(head.ownerDocument, view.id, view.label, 'openide-settings-provider-logo'));
		const headCopy = append(head, $('.openide-settings-provider-copy'));
		append(headCopy, $('.openide-settings-provider-name', undefined, view.label));
		append(headCopy, $('.openide-settings-provider-sub', undefined, view.blurb || view.company));
		this.ui.status(head, this.statusFor(view, this.agentService.getActiveProviderId()));

		const connectHost = append(body, $('.openide-settings-provider-connect'));
		this.paintInto(connectHost, redraw => {
			const host = connectHost;
			if (this.oauth?.providerId === view.id) {
				this.paintOAuth(host, view, redraw);
				return;
			}
			if (view.auth === 'oauth') {
				this.ui.button(host, {
					label: t('openide.providers.connectWith', view.label),
					icon: 'plug',
					primary: true,
					run: () => this.startOAuth(view.id, { mode: 'default' }),
				});
				if (view.oauthHint) {
					append(host, $('.openide-settings-field-desc', undefined, view.oauthHint));
				}
				return;
			}
			if (view.auth === 'apiKey') {
				this.paintKeyField(host, view, redraw);
				if (view.apiKeysUrl) {
					this.ui.button(host, {
						label: t('openide.providers.getKey'),
						icon: 'link-external',
						run: () => void this.openerService.open(URI.parse(view.apiKeysUrl)),
					});
				}
				return;
			}
			append(host, $('.openide-settings-field-desc', undefined, t('openide.providers.noAuthOffline')));
		});
	}

	/**
	 * The models.dev catalog as a list — the same registry opencode reads — with the provider's
	 * default pinned first and a check on the selection. Free-text model ids survive only as the
	 * LAST, deliberately quiet row: the escape hatch, not the flow.
	 */
	private paintModelsSection(root: HTMLElement, view: IProviderView, activeId: string, activeModel: string): void {
		if (!view.modelInfos.length) {
			return; // nothing the catalog or the endpoint can name: no section beats an empty one
		}
		const body = this.ui.section(root, {
			title: t('openide.providers.secModels'),
			description: view.connected ? undefined : t('openide.providers.modelsPreview'),
			keywords: ['modelo', 'model', ...view.models.slice(0, 12)],
		});
		const modelsHost = append(body, $('.openide-settings-provider-models'));
		this.paintInto(modelsHost, redraw => {
			const host = modelsHost;
			const isActiveProvider = view.connected && view.id === activeId;
			// '' means "the provider's default": same contract as setModel('').
			const selected = this.draftModel.get(view.id) ?? (isActiveProvider ? activeModel : '');
			const effectiveSelected = selected || view.defaultModel;

			const query = this.modelQuery.get(view.id) ?? '';
			if (view.modelInfos.length > PROVIDER_MODEL_SEARCH_THRESHOLD) {
				// Native `InputBox`, like the other two search fields in Settings. The hand-rolled
				// version was a bare `<input>` inside a decorated wrapper, which on focus drew TWO
				// rings — the wrapper's `:focus-within` border plus the input's own outline, which
				// its `outline: none` could not suppress because a workbench rule outranked it.
				const searchRow = append(host, $('.openide-settings-provider-modelsearch'));
				const search = this.renderStore.add(new InputBox(searchRow, undefined, {
					inputBoxStyles: openideInputBoxStyles,
					placeholder: t('openide.providers.modelSearch'),
					ariaLabel: t('openide.providers.modelSearch'),
				}));
				search.value = query;
				this.renderStore.add(search.onDidChange(value => {
					this.modelQuery.set(view.id, value);
					redraw();
					// redraw rebuilds the host; put the caret back where the user is typing.
					// eslint-disable-next-line no-restricted-syntax
					const next = host.querySelector<HTMLInputElement>('.openide-settings-provider-modelsearch input');
					next?.focus();
					next?.setSelectionRange(next.value.length, next.value.length);
				}));
			}

			const infos: IOpenidePickerModel[] = [...view.modelInfos];
			// A manually-typed model that the catalog does not publish still shows as a row, so the
			// selection is never invisible.
			if (effectiveSelected && !infos.some(info => info.id === effectiveSelected)) {
				infos.push(this.agentService.describeModel(view.id, effectiveSelected));
			}
			const visible = filterProviderModels(infos, query);
			if (!visible.length) {
				append(host, $('.openide-settings-field-desc', undefined, t('openide.providers.modelNoResults', query.trim())));
			}
			const list = append(host, $('.openide-settings-provider-modellist'));
			list.setAttribute('role', 'radiogroup');
			list.setAttribute('aria-label', t('openide.providers.secModels'));
			for (const info of visible) {
				this.paintModelRow(list, view, info, info.id === effectiveSelected, isActiveProvider, redraw);
			}

			if (view.connected && !isActiveProvider && this.draftModel.has(view.id)) {
				append(host, $('.openide-settings-field-desc', undefined, t('openide.providers.modelDraftHint')));
			}
			if (view.connected) {
				const other = append(host, $('button.openide-settings-provider-othermodel', { type: 'button' }));
				append(other, $('span.codicon.codicon-edit'));
				append(other, $('span', undefined, t('openide.providers.modelOther')));
				this.renderStore.add(addDisposableListener(other, 'click', () => void this.askCustomModel(view, redraw)));
			}
		});
	}

	/** One catalog row: check · name + mono id · context / cost badges. */
	private paintModelRow(list: HTMLElement, view: IProviderView, info: IOpenidePickerModel, selected: boolean, isActiveProvider: boolean, redraw: () => void): void {
		const row = append(list, $('.openide-settings-provider-model'));
		row.classList.toggle('selected', selected);
		row.classList.toggle('disabled', !view.connected);
		row.setAttribute('role', 'radio');
		row.setAttribute('aria-checked', String(selected));
		row.setAttribute('data-openide-search', `${info.id} ${info.name}`.toLowerCase());
		if (view.connected) { row.tabIndex = 0; }
		const check = append(row, $('span.openide-settings-provider-model-check'));
		if (selected) { append(check, $('span.codicon.codicon-check')); }
		const copy = append(row, $('.openide-settings-provider-model-copy'));
		const nameRow = append(copy, $('.openide-settings-provider-model-name'));
		append(nameRow, $('span', undefined, info.name));
		if (info.id === view.defaultModel) {
			append(nameRow, $('span.openide-settings-provider-model-default', undefined, t('openide.providers.modelDefaultBadge')));
		}
		if (info.id !== info.name) {
			append(copy, $('.openide-settings-provider-model-id', undefined, info.id));
		}
		const badges = append(row, $('.openide-settings-provider-model-badges'));
		if (info.context) {
			append(badges, $('span.openide-settings-provider-model-badge', undefined, t('openide.providers.modelContext', info.context)));
		}
		if (info.hasCost) {
			append(badges, $('span.openide-settings-provider-model-badge', undefined, `${info.costIn} / ${info.costOut}`));
		}
		if (!view.connected) { return; }
		const choose = () => void this.chooseModel(view, info.id, isActiveProvider, redraw);
		this.renderStore.add(addDisposableListener(row, 'click', choose));
		this.renderStore.add(addDisposableListener(row, 'keydown', event => {
			if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') { event.preventDefault(); choose(); }
		}));
	}

	/**
	 * Picking a model on the ACTIVE provider applies immediately — the selection IS the intent,
	 * making the user hunt for an "apply" button afterwards was the dead step this flow removes.
	 * On any other provider it stays a draft that "Usar este proveedor" applies atomically.
	 */
	private async chooseModel(view: IProviderView, modelId: string, isActiveProvider: boolean, redraw: () => void): Promise<void> {
		const value = modelId === view.defaultModel ? '' : modelId;
		if (isActiveProvider) {
			this.draftModel.delete(view.id);
			await this.agentService.setModel(value);
			this.paint();
			return;
		}
		this.draftModel.set(view.id, value);
		redraw();
	}

	/** Runs a painter with a `redraw` that repaints ONLY its own section body, so typing in an
	 *  input never rebuilds the whole page (and never races the page-level generation token). */
	private paintInto(host: HTMLElement, painter: (redraw: () => void) => void): void {
		const run = () => {
			clearNode(host);
			painter(run);
		};
		run();
	}

	/** Rebuilds the sub-pages from the provider list, which is synchronous — the previous version
	 *  published them from the async paint, so the sidebar showed no provider pages until the user
	 *  had already opened the providers page once.
	 *  Notifies only on a real change: this also runs on every credential event, and firing per
	 *  event would loop through the editor's re-render. */
	private refreshNavigation(): void {
		// `hidden`: the sub-pages must stay resolvable (breadcrumb "Proveedores de IA › OpenAI",
		// deep links) but the sidebar must not list fifteen providers — the index page is the
		// directory now.
		const next = this.agentService.listProviders().map(provider => ({ id: providerPageId(provider.id), label: provider.label, hidden: true }));
		const same = next.length === this._navigationChildren.length
			&& next.every((entry, index) => entry.id === this._navigationChildren[index].id && entry.label === this._navigationChildren[index].label);
		if (same) { return; }
		this._navigationChildren = next;
		this._onDidChangeNavigation.fire();
	}

	private paintSecretsWarning(root: HTMLElement, canEnableStore: boolean): void {
		this.ui.callout(root, {
			tone: 'warn',
			icon: 'warning',
			title: t('openide.providers.secretsTitle'),
			text: t('openide.providers.secretsText')
				+ (canEnableStore ? ' ' + t('openide.providers.secretsFix') : ''),
			actions: canEnableStore
				? [{
					label: this.enablingStore ? t('openide.providers.enabling') : t('openide.providers.enableStore'),
					icon: this.enablingStore ? 'loading' : 'save',
					primary: true,
					enabled: !this.enablingStore,
					run: () => { this.enablingStore = true; this.paint(); void this.agentService.enableBasicPasswordStore(); },
				}]
				: undefined,
		});
	}

	// ---- fila de proveedor ----

	private statusFor(view: IProviderView, activeId: string): ISectionStatus {
		if (view.id === activeId && view.connected) { return { tone: 'ok', label: t('openide.providers.stActive') }; }
		if (view.connected) { return { tone: 'ok', label: t('openide.providers.stConnected') }; }
		if (view.auth === 'none') { return { tone: 'neutral', label: t('openide.providers.stNoAuth') }; }
		return { tone: 'neutral', label: t('openide.providers.stDisconnected') };
	}

	// ---- API key ----

	private paintKeyField(host: HTMLElement, view: IProviderView, redraw: () => void): void {
		const draft = this.keyDraft.get(view.id) ?? '';
		this.ui.input(host, {
			label: 'API key',
			value: draft,
			password: true,
			placeholder: view.hasKey
				? t('openide.providers.keyReplace')
				: t('openide.providers.keyPaste', view.label),
			change: value => {
				const had = !!draft.trim();
				this.keyDraft.set(view.id, value);
				if (had !== !!value.trim()) { redraw(); }
			},
		});
		if (draft.trim()) {
			const busy = this.busyKey === view.id;
			// Not connected yet → the button IS the connect action. Replacing a key on a live
			// provider keeps the quieter wording.
			const label = busy
				? (view.connected ? t('openide.providers.saving') : t('openide.providers.connecting'))
				: (view.connected ? t('openide.providers.saveKey') : t('openide.providers.connectKey'));
			this.ui.button(host, {
				label,
				icon: busy ? 'loading' : (view.connected ? 'save' : 'plug'),
				primary: true,
				enabled: !busy,
				run: () => void this.saveKey(view, draft.trim(), 'default', undefined, redraw),
			});
		}
	}

	private async saveKey(view: IProviderView, key: string, mode: 'default' | 'new' | 'reauth', accountId: string | undefined, redraw: () => void): Promise<void> {
		this.busyKey = view.id;
		redraw();
		try {
			await this.agentService.ensureAccountTracked(view.id);
			if (mode === 'reauth' && accountId) { await this.agentService.switchAccount(view.id, accountId); }
			await this.agentService.setApiKey(view.id, key);
			const snapshotId = mode === 'new' ? undefined : (accountId ?? await this.agentService.getActiveAccountId(view.id));
			await this.agentService.snapshotAccount(view.id, { id: snapshotId });
			this.keyDraft.delete(view.id);
			// Saving the key IS connecting: probe right away and finish the job. If nothing else
			// is usable yet, this provider becomes the active one with its default model — the
			// opencode behavior; nobody saves a key to then go hunting for a second button.
			const connected = await this.agentService.isConnected(view.id).catch(() => false);
			if (connected) {
				const activeId = this.agentService.getActiveProviderId();
				const activeConnected = activeId && activeId !== view.id
					? await this.agentService.isConnected(activeId).catch(() => false)
					: activeId === view.id;
				if (!activeConnected) {
					await this.agentService.setActiveProvider(view.id);
					await this.agentService.setModel(this.draftModel.get(view.id) ?? '');
					this.draftModel.delete(view.id);
				}
				this.notificationService.notify({ severity: Severity.Info, message: t('openide.providers.keyConnected', view.label) });
			} else {
				this.notificationService.notify({ severity: Severity.Warning, message: t('openide.providers.keySavedNoAnswer', view.label) });
			}
			this.statusStale = true;
			this.detailStale = true;
		} catch (error) {
			this.fail(error);
		} finally {
			this.busyKey = undefined;
			this.paint();
		}
	}

	// ---- cuentas ----

	private paintAccounts(host: HTMLElement, view: IProviderView, redraw: () => void): void {
		// No field label: the section this paints into is already titled "Accounts", and printing
		// the word twice in a row is how the block read before the sections were reordered.
		if (!view.accounts.length) {
			append(host, $('.openide-settings-field-desc', undefined, t('openide.providers.accountsEmpty')));
		}
		for (const account of view.accounts) {
			const row = append(host, $('.openide-settings-account'));
			append(row, $('span.openide-settings-account-label', undefined, account.label));
			if (account.isActive) { this.ui.status(row, { tone: 'ok', label: t('openide.providers.accountActive') }); }
			if (!account.isActive) {
				this.ui.iconButton(row, {
					label: t('openide.providers.accountUse'), icon: 'check',
					run: () => void this.agentService.switchAccount(view.id, account.id).then(() => this.paint()),
				});
			}
			this.ui.iconButton(row, {
				label: t('openide.providers.accountReauth'), icon: 'sync',
				run: () => void this.reauthAccount(view, account.id, account.label, redraw),
			});
			this.ui.iconButton(row, {
				label: t('openide.providers.accountRemove'), icon: 'trash',
				run: () => void this.agentService.removeAccount(view.id, account.id).then(() => this.paint()),
			});
		}
		this.ui.button(host, {
			label: t('openide.providers.accountAdd'), icon: 'add',
			run: () => void this.addAccount(view, redraw),
		});
	}

	private async addAccount(view: IProviderView, redraw: () => void): Promise<void> {
		if (view.auth === 'oauth') { this.startOAuth(view.id, { mode: 'new' }); return; }
		const key = await this.askKey(t('openide.providers.newAccountKey'));
		if (key) { await this.saveKey(view, key, 'new', undefined, redraw); }
	}

	private async reauthAccount(view: IProviderView, accountId: string, label: string, redraw: () => void): Promise<void> {
		if (view.auth === 'oauth') { this.startOAuth(view.id, { mode: 'reauth', accountId, label }); return; }
		const key = await this.askKey(t('openide.providers.reauthKey', label));
		if (key) { await this.saveKey(view, key, 'reauth', accountId, redraw); }
	}

	private async askKey(prompt: string): Promise<string | undefined> {
		const value = await this.quickInputService.input({ prompt, password: true, ignoreFocusLost: true });
		return value?.trim() || undefined;
	}

	private async askCustomModel(view: IProviderView, redraw: () => void): Promise<void> {
		const value = await this.quickInputService.input({
			prompt: t('openide.providers.customModelPrompt', view.label),
			value: this.draftModel.get(view.id) ?? '',
			ignoreFocusLost: true,
		});
		if (value === undefined) { return; }
		const trimmed = value.trim();
		const isActiveProvider = view.connected && view.id === this.agentService.getActiveProviderId();
		if (isActiveProvider) {
			this.draftModel.delete(view.id);
			await this.agentService.setModel(trimmed === view.defaultModel ? '' : trimmed);
			this.paint();
			return;
		}
		this.draftModel.set(view.id, trimmed);
		redraw();
	}

	private async activate(view: IProviderView, fallbackModel: string): Promise<void> {
		const model = this.draftModel.get(view.id) ?? fallbackModel;
		await this.agentService.setActiveProvider(view.id);
		await this.agentService.setModel(model || '');
		this.draftModel.delete(view.id);
		this.paint();
	}

	// ---- usage ----

	private paintUsage(host: HTMLElement, view: IProviderView): void {
		const state = this.usage.get(view.id);
		append(host, $('.openide-settings-field-label', undefined, t('openide.providers.usage')));
		this.ui.button(host, {
			label: state?.loading ? t('openide.providers.usageLoading') : t('openide.providers.usageRefresh'),
			icon: state?.loading ? 'loading' : 'refresh',
			enabled: !state?.loading,
			run: () => void this.loadUsage(view.id, true),
		});
		if (!state || (!state.loaded && state.loading)) {
			append(host, $('.openide-settings-field-desc', undefined, t('openide.providers.usageWait')));
			return;
		}
		if (state.error) { this.ui.errorLine(host, state.error); return; }
		if (!state.windows.length) {
			append(host, $('.openide-settings-field-desc', undefined, t('openide.providers.usageNone')));
			return;
		}
		for (const window of state.windows) {
			const percent = typeof window.usedPercent === 'number' && isFinite(window.usedPercent) ? Math.round(window.usedPercent) : undefined;
			const reset = this.formatReset(window.resetsAt, window.resetDescription);
			this.ui.progress(host, {
				label: window.label || t('openide.providers.usageWindow'),
				detail: [percent !== undefined ? `${percent}%` : '', reset].filter(Boolean).join(' · '),
				percent,
			});
		}
	}

	private formatReset(resetsAt: number | undefined, description: string | undefined): string {
		if (description) { return description; }
		if (!resetsAt) { return ''; }
		const minutes = Math.max(0, Math.round((resetsAt - Date.now()) / 60000));
		if (minutes < 60) { return t('openide.providers.resetMinutes', minutes); }
		const hours = Math.round(minutes / 60);
		return hours < 24
			? t('openide.providers.resetHours', hours)
			: t('openide.providers.resetDays', Math.round(hours / 24));
	}

	private async loadUsage(providerId: string, force: boolean): Promise<void> {
		const previous = this.usage.get(providerId);
		this.usage.set(providerId, { loading: true, windows: previous?.windows ?? [], loaded: !!previous?.loaded });
		this.paint();
		try {
			const usage = await this.agentService.getProviderUsage(providerId, force);
			this.usage.set(providerId, {
				loading: false,
				loaded: true,
				error: usage?.error,
				windows: (usage?.windows ?? []).map(window => ({
					label: window.label,
					usedPercent: window.usedPercent ?? undefined,
					resetsAt: window.resetsAt ?? undefined,
					resetDescription: window.resetDescription ?? undefined,
				})),
			});
		} catch (error) {
			this.usage.set(providerId, { loading: false, loaded: true, windows: [], error: error instanceof Error ? error.message : String(error) });
		}
		this.paint();
	}

	// ---- OAuth inline ----

	private paintOAuth(host: HTMLElement, view: IProviderView, redraw: () => void): void {
		const oauth = this.oauth!;
		if (oauth.phase === 'start') {
			this.ui.callout(host, {
				icon: 'loading',
				title: t('openide.providers.oauthStart', view.label),
				text: t('openide.providers.oauthStartText'),
				actions: [{ label: t('openide.providers.cancel'), run: () => { this.cancelOAuth(); this.paint(); } }],
			});
			return;
		}
		if (oauth.phase === 'code') {
			const box = this.ui.callout(host, {
				icon: 'key',
				title: t('openide.providers.oauthCode'),
				text: t('openide.providers.oauthCodeText'),
			});
			this.ui.code(box, {
				value: oauth.code ?? '',
				actions: [
					{ label: t('openide.providers.copy'), icon: 'copy', run: () => void this.clipboardService.writeText(oauth.code ?? '') },
					...(oauth.url ? [{ label: t('openide.providers.reopen'), icon: 'link-external', run: () => void this.openerService.open(URI.parse(oauth.url!)) }] : []),
				],
			});
			append(box, $('.openide-settings-field-desc', undefined, t('openide.providers.oauthWaiting')));
			this.paintOAuthHint(box, view);
			return;
		}
		if (oauth.phase === 'paste') {
			const box = this.ui.callout(host, {
				icon: 'key',
				title: t('openide.providers.oauthPaste'),
				text: oauth.prompt || t('openide.providers.oauthPasteText'),
			});
			let pasted = '';
			const input = this.ui.input(box, {
				label: t('openide.providers.oauthCodeLabel'),
				placeholder: t('openide.providers.oauthCodePlaceholder'),
				change: value => { pasted = value; },
			});
			this.ui.button(box, {
				label: t('openide.providers.continue'), primary: true,
				run: () => { if (pasted.trim()) { oauth.pendingPaste?.complete(pasted.trim()); oauth.phase = 'start'; redraw(); } },
			});
			input.focus();
			this.paintOAuthHint(box, view);
			return;
		}
		const box = this.ui.callout(host, {
			tone: 'error',
			icon: 'error',
			title: t('openide.providers.oauthError', view.label),
			text: oauth.message || t('openide.providers.oauthErrorUnknown'),
			actions: [{ label: t('openide.providers.retry'), icon: 'sync', run: () => this.startOAuth(view.id, { mode: 'default' }) }],
		});
		this.paintOAuthHint(box, view);
	}

	/** Provider-specific notice (e.g. Codex requires enabling device-auth in ChatGPT). */
	private paintOAuthHint(box: HTMLElement, view: IProviderView): void {
		if (!view.oauthHint) { return; }
		append(box, $('.openide-settings-field-desc', undefined, view.oauthHint));
		if (view.oauthHintUrl) {
			this.ui.button(box, {
				label: t('openide.providers.openSettings'), icon: 'link-external',
				run: () => void this.openerService.open(URI.parse(view.oauthHintUrl)),
			});
		}
	}

	private startOAuth(providerId: string, options: { mode: 'default' | 'new' | 'reauth'; accountId?: string; label?: string }): void {
		this.cancelOAuth(); // una sesión por vez: la nueva corta el polling de la anterior
		const session: IOAuthState = { providerId, cancelled: false, phase: 'start' };
		this.oauth = session;
		// The OAuth panel lives in the Authentication section of the provider's own page; if the
		// login started from somewhere else, land the user there.
		if (this.activeProviderId !== providerId) { this.navigate?.(providerPageId(providerId)); }
		this.paint();

		const interaction: IOAuthInteraction = {
			showUserCode: (url, code) => {
				if (session.cancelled) { return; }
				session.phase = 'code';
				session.url = url;
				session.code = code;
				this.paint();
			},
			promptCode: prompt => {
				if (session.cancelled) { return Promise.resolve(undefined); }
				session.pendingPaste = new DeferredPromise<string | undefined>();
				session.phase = 'paste';
				session.prompt = prompt;
				this.paint();
				return session.pendingPaste.p;
			},
			get cancelled() { return session.cancelled; },
		};

		// Track the active account BEFORE overwriting it with the new login: that way "add account"
		// and "re-authenticate" never lose an already-connected session.
		this.agentService.ensureAccountTracked(providerId)
			.then(() => options.mode === 'reauth' && options.accountId ? this.agentService.switchAccount(providerId, options.accountId) : undefined)
			.then(() => this.agentService.signIn(providerId, interaction))
			.then(async ok => {
				if (session.cancelled) { return; }
				if (ok) {
					const snapshotId = options.mode === 'new' ? undefined : (options.accountId ?? await this.agentService.getActiveAccountId(providerId));
					await this.agentService.snapshotAccount(providerId, { id: snapshotId, label: options.label });
					this.oauth = undefined;
				} else {
					session.phase = 'error';
					session.message = t('openide.providers.oauthCancelled');
				}
				this.paint();
			}, error => {
				if (session.cancelled) { return; }
				session.phase = 'error';
				session.message = error instanceof Error ? error.message : String(error);
				this.paint();
			});
	}

	private cancelOAuth(): void {
		const session = this.oauth;
		if (session) {
			session.cancelled = true;
			session.pendingPaste?.complete(undefined);
			this.oauth = undefined;
		}
	}

	private fail(error: unknown): void {
		this.notificationService.notify({ severity: Severity.Error, message: error instanceof Error ? error.message : String(error) });
	}
}
