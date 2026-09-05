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
 *  All the logic already lives in IOpenideAgentService — here we only draw and call. The page is
 *  drawn with the settings editor's own anatomy (`card()` / `cardRow()` in the renderer): the
 *  index is one card per group with a row per provider, and every block of the detail page is a
 *  captioned card. A grid of tiles and an inset list of its own used to live here; two designs
 *  on one page is how the webview story started.
 *
 *  OAuth is INLINE in the provider's card: showing the code and waiting for authorization inside
 *  the card that asked for it makes its origin visible, which a separate modal loses.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { AnchorPosition } from '../../../../base/common/layout.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISubagentRoutingService } from './openideSubagentRoutingService.js';
import { IFallbackStep, parseFallbackChain } from '../common/openideFallback.js';
import { describeCooldown, isModelCoolingDown } from '../common/openideModelHealth.js';
import { IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import type { IOpenideSettingsNavigationEntry } from '../../openideSettings/common/openideSettingsTypes.js';
import { ISectionFilter, ISectionStatus, OpenideSectionRenderer } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import { filterProviderModels, orderProviderModels, PROVIDER_MODEL_SEARCH_THRESHOLD } from '../common/openideProviderModels.js';
import { providerSupportsUsage } from '../common/openideUsage.js';
import { IOpenideAgentService, IOpenidePickerModel } from './openideAgentService.js';
import { IOAuthInteraction } from './openideOAuth.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { openideInputBoxStyles } from './openideControlStyles.js';
import { createProviderIcon } from './openideProviderIcons.js';
import { IRegistryProvider } from './openideModelCatalog.js';
import { ICredentialOrigin } from '../../../../platform/openideAgentHost/common/openideCredentialSources.js';
import { createMenuContent, createMenuRow, IMenuRowOptions, OpenideComposerPopover } from './chat/openideComposerMenu.js';
import { t } from '../common/openideStrings.js';

interface IProviderView {
	readonly id: string;
	readonly label: string;
	readonly company: string;
	readonly auth: string;
	readonly blurb: string;
	readonly connected: boolean;
	/** A usable key exists ANYWHERE in the chain — store, environment, another tool. */
	readonly hasKey: boolean;
	/** The key is OpenIDE's own, so it is OpenIDE's to delete. */
	readonly hasStoredKey: boolean;
	readonly origin?: ICredentialOrigin;
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

type ProviderStatus = { connected: boolean; hasKey: boolean; origin?: ICredentialOrigin };
type ProviderEntry = { id: string; label: string; company: string; auth: string; blurb?: string; defaultModel?: string };

/** Nav id of a provider's own page. Kept next to the parser so the two never drift. */
export function providerPageId(providerId: string): string { return 'openideAgent/providers/' + providerId; }
export function providerIdFromPage(category: string | undefined): string | undefined {
	const prefix = 'openideAgent/providers/';
	return category && category.startsWith(prefix) ? category.slice(prefix.length) : undefined;
}

/**
 * Where a credential came from, in words, or nothing when it is the one the user pasted here.
 *
 * Silence is deliberate for the store: naming the ordinary case on every row would be noise. The
 * two that ARE worth a word are the ones nobody would guess — an env var, or another tool.
 */
function describeOrigin(origin: ICredentialOrigin | undefined): string | undefined {
	if (!origin || origin.kind === 'store') {
		return undefined;
	}
	return origin.kind === 'env'
		? t('openide.providers.fromEnv', origin.label ?? '')
		: t('openide.providers.fromSource', origin.label ?? origin.detail ?? '');
}

/** "hace 4 minutos" / "4 minutes ago", coarse on purpose: nobody needs the seconds of a 6h TTL. */
function describeAge(at: number): string {
	const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
	if (minutes < 1) { return t('openide.providers.ageNow'); }
	if (minutes < 60) { return t('openide.providers.ageMinutes', String(minutes)); }
	const hours = Math.round(minutes / 60);
	if (hours < 24) { return t('openide.providers.ageHours', String(hours)); }
	return t('openide.providers.ageDays', String(Math.round(hours / 24)));
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
	/** The account row's "more" menu: the same popover the composer's pickers open. */
	private readonly popover = this._register(new OpenideComposerPopover(this.contextViewService));
	private root: HTMLElement | undefined;
	private generation = 0;

	private oauth: IOAuthState | undefined;
	/** Index status per provider (connected / key saved). `undefined` = never loaded (skeleton). */
	private statusCache: Map<string, ProviderStatus> | undefined;
	private statusLoading = false;
	private statusStale = true;
	/** models.dev providers with no entry of their own yet. Loaded once and streamed in, like the
	 *  statuses: the index must paint before a 4MB registry has been read. */
	private registryCache: readonly IRegistryProvider[] | undefined;
	private registryLoading = false;
	/** Detail view of the ONE provider page being shown. The index never pays for models/accounts. */
	private detailCache: { id: string; view: IProviderView } | undefined;
	private detailLoading = false;
	private detailStale = true;
	/** Bumped by every invalidation. Both loads read it before their awaits and compare after, so a
	 *  change that lands MID-LOAD is not swallowed by the load that was already in flight — while
	 *  one is running the paint path skips starting another, so whoever finishes must not declare
	 *  data fresh that went stale under it. */
	private invalidation = 0;
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
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISubagentRoutingService private readonly routing: ISubagentRoutingService,
	) {
		super();
		// Credentials and config can change from outside (the palette wizard, another Settings).
		// The caches go stale instead of being dropped: the page repaints with the data it has and
		// the fresh load swaps it in when it lands — no skeleton flash on every credential event.
		this._register(this.agentService.onDidChange(() => {
			this.statusStale = true;
			this.detailStale = true;
			this.invalidation++;
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
		this.popover.close();
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

		// The h1 above ("AI Providers") is the editor's; the page opens on its one-line explanation.
		append(root, $('.openide-settings-provider-intro', undefined, t('openide.providers.desc')));

		if (!statuses) {
			this.paintIndexSkeleton(root, Math.min(6, Math.max(3, entries.length)));
		} else {
			const connected = entries.filter(entry => statuses.get(entry.id)?.connected);
			const rest = entries.filter(entry => !statuses.get(entry.id)?.connected);

			if (!connected.length) {
				this.ui.callout(root, {
					tone: 'warn',
					icon: 'plug',
					title: t('openide.providers.noActive'),
					text: t('openide.providers.noActiveText'),
				});
			} else if (activeId && !statuses.get(activeId)?.connected) {
				// Others are connected but the one the chat will actually call is not: a signed-out
				// session or a deleted key. Without this the index looked healthy and the chat failed.
				const active = entries.find(entry => entry.id === activeId);
				this.ui.callout(root, {
					tone: 'warn',
					icon: 'debug-disconnect',
					title: t('openide.providers.activeDisconnected', active?.label ?? activeId),
					text: t('openide.providers.activeDisconnectedText'),
					actions: active ? [{ label: t('openide.providers.rowConnect'), icon: 'plug', primary: true, run: () => this.navigate?.(providerPageId(active.id)) }] : undefined,
				});
			}

			// The filter comes before the groups so that narrowing happens where the eye already is.
			// `rows` is collected while painting rather than queried afterwards: a row knows its own
			// haystack, and re-deriving it from the DOM on every keystroke is how the two drift.
			const rows: HTMLElement[] = [];
			const groups: HTMLElement[] = [];
			// Built detached and appended last: the empty state belongs BELOW the cards, but the
			// filter's callback has to close over it, and a closure cannot capture what does not
			// exist yet.
			const noMatch = $('.openide-settings-provider-nomatch.hidden');
			const filter = this.ui.filter(root, {
				placeholder: t('openide.providers.filter'),
				clearLabel: t('openide.providers.filterClear'),
				change: query => this.applyFilter(query, rows, groups, filter, noMatch),
			});
			filter.element.classList.add('openide-settings-provider-filter');

			const paintGroup = (caption: string, list: readonly ProviderEntry[], withCustom: boolean) => {
				const card = this.ui.card(root, { caption, keywords: ['proveedor', 'provider', 'modelo', 'api key', 'oauth', 'cuenta'] });
				// card → group → section: the section is what the filter hides, caption included.
				groups.push(card.parentElement!.parentElement!);
				for (const entry of list) {
					rows.push(this.paintProviderRow(card, entry, statuses.get(entry.id), activeId));
				}
				// The custom-provider row closes the "available" card: it IS one more thing you can
				// connect, and parking it below the card made it read as an unrelated footer.
				if (withCustom) { rows.push(this.paintCustomProviderRow(card)); }
			};

			if (connected.length) {
				paintGroup(t('openide.providers.groupConnected'), connected, false);
			}
			paintGroup(connected.length ? t('openide.providers.groupAvailable') : t('openide.providers.groupAll'), rest, true);
			this.paintRegistryGroup(root, rows, groups, token);
			append(root, noMatch);
		}

		this.paintCatalogFooter(root);
		this.paintFallbackChain(root);

		if (this.statusStale && !this.statusLoading) {
			void this.loadStatuses(token);
		}
	}

	/**
	 * The rest of models.dev: every provider the registry publishes that has no entry of its own.
	 *
	 * They are the SAME OpenAI-compatible protocol behind another URL — the catalog was designed
	 * for exactly that ("few protocols, many providers as data"). Until now reaching one meant
	 * writing a `customProviders` object by hand, with a base URL you had to already know; here
	 * they are a row you can find with the page's own filter, and connecting one writes that
	 * object for you.
	 */
	private paintRegistryGroup(root: HTMLElement, rows: HTMLElement[], groups: HTMLElement[], token: number): void {
		const list = this.registryCache;
		if (!list) {
			if (!this.registryLoading) { void this.loadRegistry(token); }
			return;
		}
		if (!list.length) {
			return;
		}
		const card = this.ui.card(root, {
			caption: t('openide.providers.groupRegistry', String(list.length)),
			footer: t('openide.providers.groupRegistryDesc'),
			keywords: ['models.dev', 'registry', 'registro', 'catalogo', 'provider', 'proveedor'],
		});
		groups.push(card.parentElement!.parentElement!);
		for (const provider of list) {
			const logo = createProviderIcon(card.ownerDocument, provider.id, provider.name, 'openide-settings-provider-logo');
			const value = this.ui.cardRow(card, {
				leading: logo,
				label: provider.name,
				description: t('openide.providers.registryModels', String(provider.modelCount)),
				keywords: [provider.id, 'models.dev', provider.api],
				run: () => void this.connectRegistryProvider(provider),
			});
			const row = value.parentElement!;
			row.classList.add('openide-settings-provider-row');
			row.setAttribute('data-openide-filter', [provider.name, provider.id, provider.api].join(' ').toLowerCase());
			this.ui.button(value, { label: t('openide.providers.registryAdd'), ghost: true, run: () => void this.connectRegistryProvider(provider) });
			rows.push(row);
		}
	}

	/** Writes the custom entry and lands on the provider's own page, where the key is pasted. */
	private async connectRegistryProvider(provider: IRegistryProvider): Promise<void> {
		try {
			await this.agentService.addRegistryProvider(provider.id);
			this.navigate?.(providerPageId(provider.id));
		} catch (error) {
			this.notificationService.error(error instanceof Error ? error.message : String(error));
		}
	}

	private async loadRegistry(token: number): Promise<void> {
		this.registryLoading = true;
		try {
			this.registryCache = await this.agentService.listRegistryProviders();
		} catch {
			// No registry (offline, first run): the group simply does not appear.
			this.registryCache = [];
		} finally {
			this.registryLoading = false;
		}
		if (token === this.generation) { this.paint(); }
	}

	/**
	 * What the model catalog knows and when it last learned it, with a way to ask again.
	 *
	 * The registry refreshes itself on a 6h TTL, evaluated only when something asks for models. A
	 * model published this morning therefore shows up whenever that timer happens to lapse — and
	 * this page, where someone comes precisely because a model is missing, had no way to say so or
	 * to force it.
	 */
	private paintCatalogFooter(root: HTMLElement): void {
		const status = this.agentService.getModelCatalogStatus();
		const card = this.ui.card(root, {
			caption: t('openide.providers.catalogTitle'),
			footer: t('openide.providers.catalogDesc'),
			keywords: ['models.dev', 'catalogo', 'catalog', 'modelos', 'actualizar', 'refresh'],
		});
		const value = this.ui.cardRow(card, {
			icon: 'database',
			label: status.updatedAt
				? t('openide.providers.catalogCount', String(status.providers), String(status.models))
				: t('openide.providers.catalogEmpty'),
			description: status.updatedAt ? t('openide.providers.catalogAge', describeAge(status.updatedAt)) : undefined,
		});
		const button = this.ui.button(value, {
			label: t('openide.providers.catalogRefresh'),
			icon: 'sync',
			ghost: true,
			run: async () => {
				button.enabled = false;
				try {
					await this.agentService.refreshModelCatalog();
					// The registry changed under it: the list of "the rest" has to be built again.
					this.registryCache = undefined;
					this.paint();
				} catch (error) {
					button.enabled = true;
					this.notificationService.error(t('openide.providers.catalogFailed', error instanceof Error ? error.message : String(error)));
				}
			},
		});
	}

	/**
	 * One provider row: logo · name over its state · the live mark on the right.
	 *
	 * Connected providers carry the product's green dot, and the one the agent is USING adds the
	 * "Active" pill; the rest carry a ghost "Connect". The whole row opens the provider's page, so
	 * the button is a shortcut to the same place, not a second destination.
	 */
	private paintProviderRow(card: HTMLElement, entry: ProviderEntry, status: ProviderStatus | undefined, activeId: string): HTMLElement {
		const isActive = !!status?.connected && entry.id === activeId;
		// Connected or not: that is the whole state of a provider on this page. It used to also
		// say "Active", twice — a pill AND the subtitle — for the one the chat happens to be
		// pointed at, next to a green dot, inside a card already captioned "Connected". Four marks
		// for two facts. Which model the chat will use is the composer's job, and it says so
		// permanently; here the only useful extra is where a credential came from, because that is
		// the one thing nobody can guess.
		const source = describeOrigin(status?.origin);
		const subtitle = status?.connected
			? (source ? `${t('openide.providers.rowConnected')} · ${source}` : t('openide.providers.rowConnected'))
			: this.authLabel(entry.auth);
		const open = () => this.navigate?.(providerPageId(entry.id));
		const logo = createProviderIcon(card.ownerDocument, entry.id, entry.label, 'openide-settings-provider-logo');
		const value = this.ui.cardRow(card, {
			leading: logo,
			label: entry.label,
			description: subtitle,
			// The wide haystack is for Settings-wide search, which should also reach this row from
			// a phrase that only appears in the blurb.
			keywords: [entry.company, entry.id, entry.auth, entry.blurb ?? ''],
			run: open,
		});
		const row = value.parentElement!;
		row.classList.add('openide-settings-provider-row');
		// The narrow haystack is what the page's own filter reads first: the name, who makes it,
		// and the words printed on the row itself. Half the catalogue's description says
		// "OpenAI-compatible", so searching the blurbs made "open" answer with Cohere and vLLM.
		// `authLabel` and not the raw `auth`: the raw value is `apiKey`, so someone typing the two
		// words shown on the row matched nothing.
		row.setAttribute('data-openide-filter', [entry.label, entry.company, entry.id, this.authLabel(entry.auth)].join(' ').toLowerCase());
		row.classList.toggle('active', isActive);
		row.classList.toggle('connected', !!status?.connected);
		if (isActive) { row.setAttribute('aria-current', 'true'); }

		if (status?.connected) {
			append(value, $('span.openide-settings-provider-dot.ok', { title: t('openide.providers.stConnected') }));
		} else {
			// Filled, in the product's amber: connecting is THE action of an available provider (Cursor
			// paints it the same way), and a ghost label read as a hint rather than a button.
			this.ui.button(value, { label: t('openide.providers.rowConnect'), primary: true, run: open });
		}
		return row;
	}

	/** The last row of "Available": bring your own endpoint. It filters like any other. */
	private paintCustomProviderRow(card: HTMLElement): HTMLElement {
		const mark = $('span.openide-settings-provider-addmark');
		append(mark, $('span.codicon.codicon-add'));
		const value = this.ui.cardRow(card, {
			leading: mark,
			label: t('openide.providers.addCustom'),
			description: t('openide.providers.addCustomSub'),
			keywords: ['proveedor personalizado', 'custom provider', 'endpoint', 'baseurl'],
			icon: 'chevron-right',
			run: () => this.navigate?.('openideAgent/advanced'),
		});
		const row = value.parentElement!;
		row.classList.add('openide-settings-provider-row', 'openide-settings-provider-add');
		row.setAttribute('data-openide-filter', 'proveedor personalizado custom provider');
		return row;
	}

	/**
	 * Hides the rows that do not match, and any card left with nothing in it.
	 *
	 * Hiding and not removing: the query changes on every keystroke, and a row that was taken out
	 * of the DOM would have to be rebuilt -- with its icon, its listeners and its live status --
	 * the moment a character is deleted. `hidden` costs one attribute.
	 *
	 * Names first, everything else only if names found nobody: that keeps "open" meaning OpenAI and
	 * OpenRouter, while "api key" and "oauth" -- which appear in no provider's name -- still answer.
	 */
	private applyFilter(query: string, rows: readonly HTMLElement[], groups: readonly HTMLElement[], filter: ISectionFilter, noMatch: HTMLElement): void {
		const matches = (attribute: string) => rows.filter(row => (row.getAttribute(attribute) ?? '').includes(query));
		const hits = new Set(query ? (matches('data-openide-filter').length ? matches('data-openide-filter') : matches('data-openide-search')) : rows);
		let shown = 0;
		const firstVisible = new Set<HTMLElement>();
		for (const row of rows) {
			const match = hits.has(row);
			row.classList.toggle('hidden', !match);
			row.classList.remove('first-visible');
			if (match) { shown++; }
			// The first row a card shows gives up its hairline (openideSettings.css): the hairline
			// is a border-top on every row but the first CHILD, and hiding that child would leave
			// the next one drawing a line right under the card's own edge.
			if (match && !firstVisible.has(row.parentElement!)) {
				firstVisible.add(row.parentElement!);
				if (row.previousElementSibling) { row.classList.add('first-visible'); }
			}
		}
		for (const group of groups) {
			group.classList.toggle('hidden', !rows.some(row => group.contains(row) && !row.classList.contains('hidden')));
		}
		filter.setCount(query ? t('openide.providers.filterCount', String(shown), String(rows.length)) : undefined);
		noMatch.classList.toggle('hidden', shown > 0);
		if (!shown) {
			clearNode(noMatch);
			append(noMatch, $('.openide-settings-empty-title', undefined, t('openide.providers.noMatch', query)));
			append(noMatch, $('.openide-settings-empty-desc', undefined, t('openide.providers.noMatchText')));
		}
	}

	private authLabel(auth: string): string {
		switch (auth) {
			case 'oauth': return t('openide.providers.authOAuth');
			case 'apiKey': return t('openide.providers.authKey');
			default: return t('openide.providers.authNone');
		}
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
		const invalidation = this.invalidation;
		try {
			const entries = this.agentService.listProviders();
			const next = new Map<string, ProviderStatus>();
			await Promise.all(entries.map(async entry => {
				const connected = await this.agentService.isConnected(entry.id).catch(() => false);
				const hasKey = entry.auth === 'apiKey' ? await this.agentService.hasApiKey(entry.id).catch(() => false) : false;
				// Where the key comes from, not just whether there is one: a provider can now be
				// connected because of the environment or another tool, and a row that does not say
				// so leaves "why is it using THAT key?" unanswerable.
				const origin = hasKey ? await this.agentService.credentialOrigin(entry.id).catch(() => undefined) : undefined;
				next.set(entry.id, { connected, hasKey, origin });
			}));
			this.statusCache = next;
			this.statusStale = this.invalidation !== invalidation;
		} finally {
			this.statusLoading = false;
		}
		// Same dead end as `loadDetail`: re-run rather than wait for a paint that will not come.
		if (this.statusStale) {
			return this.loadStatuses(this.generation);
		}
		if (token === this.generation) { this.paint(); }
	}

	// ---- fallback chain ----

	/**
	 * The ordered list of models a failing turn walks down, editable without touching JSON.
	 *
	 * It lives on the INDEX and not on a provider page because a chain crosses providers: the point
	 * of the second step is usually that the first provider is the one having a bad day. Rows carry
	 * their own health, so a step that is cooling down says so here instead of only in the chat.
	 */
	private paintFallbackChain(root: HTMLElement): void {
		const chain = this.fallbackChain();
		const card = this.ui.card(root, {
			caption: t('openide.chain.title'),
			footer: chain.length ? t('openide.chain.desc') : t('openide.chain.empty'),
			keywords: ['fallback', 'respaldo', 'cadena', 'chain', 'failover', 'rate limit', 'cooldown'],
		});
		chain.forEach((step, index) => {
			const entry = this.agentService.findProvider(step.providerId);
			const model = step.model ?? entry?.defaultModel ?? '';
			const name = model ? this.agentService.describeModel(step.providerId, model).name || model : '';
			const health = model ? this.routing.healthFor({ providerId: step.providerId, model }) : undefined;
			const cooling = isModelCoolingDown(health, Date.now());
			const value = this.ui.cardRow(card, {
				leading: entry ? createProviderIcon(card.ownerDocument, entry.id, entry.label, 'openide-settings-provider-logo') : undefined,
				label: t('openide.chain.step', index + 1, name || step.providerId),
				description: !entry
					? t('openide.chain.gone')
					: cooling && health?.until
						? `${entry.label} · ${t('openide.chain.cooling', describeCooldown(health.until, Date.now()))}`
						: entry.label,
				keywords: [step.providerId, model],
			});
			value.parentElement!.classList.add('openide-settings-provider-row');
			if (index > 0) {
				this.ui.iconButton(value, { label: t('openide.chain.up'), icon: 'arrow-up', run: () => void this.moveChainStep(index, -1) });
			}
			if (index < chain.length - 1) {
				this.ui.iconButton(value, { label: t('openide.chain.down'), icon: 'arrow-down', run: () => void this.moveChainStep(index, 1) });
			}
			this.ui.iconButton(value, { label: t('openide.chain.remove'), icon: 'trash', run: () => void this.writeChain(chain.filter((_, i) => i !== index)) });
		});
		this.ui.cardRow(card, {
			label: t('openide.chain.add'), icon: 'add',
			run: () => void this.addChainStep(),
		});
	}

	private fallbackChain(): IFallbackStep[] {
		return parseFallbackChain(
			this.configurationService.getValue<unknown>('openide.agent.fallbackChain'),
			this.configurationService.getValue<unknown>('openide.agent.fallbackProviders'),
		);
	}

	private async writeChain(chain: readonly IFallbackStep[]): Promise<void> {
		// Written as the schema declares it — objects, never the bare "provider/model" string the
		// parser also accepts — so hand-editing the file afterwards sees what the settings UI shows.
		await this.configurationService.updateValue(
			'openide.agent.fallbackChain',
			chain.map(step => (step.model ? { providerId: step.providerId, model: step.model } : { providerId: step.providerId })),
		);
		this.paint();
	}

	private async moveChainStep(index: number, delta: number): Promise<void> {
		const chain = this.fallbackChain();
		const target = index + delta;
		if (target < 0 || target >= chain.length) {
			return;
		}
		const next = [...chain];
		[next[index], next[target]] = [next[target], next[index]];
		await this.writeChain(next);
	}

	/** Picks the next step from the models the connected providers actually publish. */
	private async addChainStep(): Promise<void> {
		const groups = await this.agentService.getConnectedModelGroups();
		const chain = this.fallbackChain();
		const taken = new Set(chain.map(step => `${step.providerId}/${step.model ?? ''}`));
		type ChainPick = IQuickPickItem & { readonly step: IFallbackStep };
		const items: (ChainPick | IQuickPickSeparator)[] = [];
		for (const group of groups) {
			items.push({ type: 'separator', label: group.label });
			for (const model of group.models) {
				items.push({
					label: model.name || model.id,
					description: model.context || undefined,
					detail: taken.has(`${group.id}/${model.id}`) ? t('openide.chain.already') : undefined,
					step: { providerId: group.id, model: model.id },
				});
			}
		}
		const picked = await this.quickInputService.pick(items, { placeHolder: t('openide.chain.pick'), matchOnDescription: true });
		if (!picked || taken.has(`${picked.step.providerId}/${picked.step.model ?? ''}`)) {
			return;
		}
		await this.writeChain([...chain, picked.step]);
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
		this.paintBack(root);
		const cached = this.detailCache?.id === id ? this.detailCache.view : undefined;
		if (!cached) {
			this.paintIndexSkeleton(root, 3);
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
		const invalidation = this.invalidation;
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
				hasStoredKey: entry.auth === 'apiKey' ? await this.agentService.hasStoredApiKey(entry.id).catch(() => false) : false,
				origin: entry.auth === 'apiKey' ? await this.agentService.credentialOrigin(entry.id).catch(() => undefined) : undefined,
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
			this.detailStale = this.invalidation !== invalidation;
		} finally {
			this.detailLoading = false;
		}
		// Something invalidated this WHILE it was in flight — saving a key, finishing a login.
		// Re-run: the view just computed is already out of date, and nothing else is going to ask.
		// `paint` only starts a load when one is not already running, and one was; the paint that
		// follows a load is gated on the generation token, which a repaint in between has moved
		// past. That dead end is why the chip kept saying "not connected" under a notification
		// that said the opposite.
		if (this.detailStale && this.activeProviderId === id) {
			return this.loadDetail(id, this.generation);
		}
		if (token === this.generation && this.activeProviderId === id) { this.paint(); }
	}

	/** The ghost "Back" over the page: the sidebar does not list provider pages, so this is the
	 *  one visible way out besides the breadcrumb. */
	private paintBack(root: HTMLElement): void {
		const back = append(root, $('.openide-settings-provider-back'));
		this.ui.button(back, {
			label: t('openide.providers.backShort'),
			icon: 'chevron-left',
			ghost: true,
			run: () => this.navigate?.('openideAgent/providers'),
		});
	}

	/** The detail page: a head strip, then one captioned card per block. */
	private paintDetailSections(root: HTMLElement, view: IProviderView): void {
		const activeId = this.agentService.getActiveProviderId();
		const model = this.agentService.getModel();
		const isActive = view.id === activeId && view.connected;

		this.paintDetailHead(root, view, activeId, isActive);

		if (!view.connected && !view.accounts.length) {
			// Not connected: connecting IS the page. One card, one primary action — the opencode
			// flow. Everything else (models greyed below) is preview.
			this.paintConnectCard(root, view);
		} else if (view.connected && (view.auth === 'apiKey' || this.oauth?.providerId === view.id)) {
			// A connected OAuth provider with no flow in progress has nothing to manage here: its
			// actions (reconnect / sign out) live under Session, its identity under Accounts.
			this.paintAuthCard(root, view);
		}

		if (view.auth !== 'none' && (view.connected || view.accounts.length > 0)) {
			this.paintAccountsCard(root, view);
		}

		this.paintModelsCard(root, view, activeId, model);

		if (view.supportsUsage) {
			this.paintUsageCard(root, view);
			if (!this.usage.get(view.id)) {
				void this.loadUsage(view.id, false);
			}
		}

		if ((view.auth === 'oauth' && view.connected) || (view.auth === 'apiKey' && view.hasKey)) {
			this.paintSessionCard(root, view);
		}
	}

	/**
	 * Identity + live state + the one primary action, on a single strip: logo, name, what the
	 * provider is, the status pill, and "Use this provider" when it is connected but not the one
	 * in use. A provider that should answer without credentials (a local server, a stored key)
	 * but does not gets "Check again" instead — the probe is capped, and a server that was just
	 * started deserves a second look without a page reload.
	 */
	private paintDetailHead(root: HTMLElement, view: IProviderView, activeId: string, isActive: boolean): void {
		const head = append(root, $('.openide-settings-provider-head'));
		head.appendChild(createProviderIcon(head.ownerDocument, view.id, view.label, 'openide-settings-provider-logo'));
		const copy = append(head, $('.openide-settings-provider-copy'));
		append(copy, $('.openide-settings-provider-name', undefined, view.label));
		append(copy, $('.openide-settings-provider-sub', undefined, view.blurb || view.company));
		const status = this.statusFor(view, activeId);
		this.pill(head, status.label, status.tone === 'ok' ? 'ok' : undefined);
		const actions = append(head, $('.openide-settings-section-actions'));
		// No "Use this provider" here. This page answers one question — connected or not — and the
		// composer's model chip already answers the other one, permanently and where the work
		// happens: picking a model IS picking its provider. A second way to set it only created a
		// state the page then had to display ("Active"), which was the redundancy we just removed.
		if (!view.connected && (view.auth === 'none' || (view.auth === 'apiKey' && view.hasKey))) {
			this.ui.button(actions, {
				label: t('openide.providers.retryProbe'),
				icon: 'sync',
				ghost: true,
				run: () => this.recheck(),
			});
		}
	}

	/** Drops both caches' freshness and repaints: the next paint re-probes the provider. */
	private recheck(): void {
		this.statusStale = true;
		this.detailStale = true;
		this.invalidation++;
		this.paint();
	}

	/**
	 * The whole first screen of a DISCONNECTED provider: ONE primary action — "Sign in" for OAuth,
	 * key + "Connect" for API keys. opencode's flow: nothing to hunt for, no dead steps between
	 * pasting a key and being connected.
	 */
	private paintConnectCard(root: HTMLElement, view: IProviderView): void {
		const card = this.ui.card(root, {
			caption: t('openide.providers.secConnect'),
			footer: view.auth === 'none'
				? t('openide.providers.noAuthOffline')
				: view.auth === 'oauth' && view.oauthHint ? view.oauthHint : undefined,
			keywords: ['conectar', 'login', 'api key', 'oauth', view.id, view.company],
		});
		this.paintInto(card, redraw => {
			if (this.oauth?.providerId === view.id) {
				this.paintOAuthRows(card, view, redraw);
				return;
			}
			if (view.auth === 'oauth') {
				const value = this.ui.cardRow(card, {
					label: t('openide.providers.connectWith', view.label),
					description: this.authLabel('oauth'),
					keywords: ['sign in', 'iniciar sesión'],
				});
				this.ui.button(value, {
					label: t('openide.providers.signIn'),
					icon: 'sign-in',
					primary: true,
					run: () => this.startOAuth(view.id, { mode: 'default' }),
				});
				this.paintOAuthHintRow(card, view);
				return;
			}
			if (view.auth === 'apiKey') {
				this.paintKeyRow(card, view, redraw);
				this.paintGetKeyRow(card, view);
				return;
			}
			this.ui.cardRow(card, {
				label: t('openide.providers.retryProbe'),
				icon: 'sync',
				run: () => this.recheck(),
			});
		});
	}

	/** Authentication on a CONNECTED provider: replace the key, or the OAuth flow in progress. */
	private paintAuthCard(root: HTMLElement, view: IProviderView): void {
		const card = this.ui.card(root, {
			caption: t('openide.providers.secAuth'),
			keywords: ['api key', 'oauth', 'login', 'conectar', view.id],
		});
		this.paintInto(card, redraw => {
			if (this.oauth?.providerId === view.id) {
				this.paintOAuthRows(card, view, redraw);
			}
			if (view.auth === 'apiKey') {
				this.paintKeyRow(card, view, redraw);
				this.paintGetKeyRow(card, view);
			}
		});
	}

	private paintGetKeyRow(card: HTMLElement, view: IProviderView): void {
		if (!view.apiKeysUrl) { return; }
		this.ui.cardRow(card, {
			label: t('openide.providers.getKey'),
			description: view.apiKeysUrl,
			icon: 'link-external',
			keywords: ['api key', view.id],
			run: () => void this.openerService.open(URI.parse(view.apiKeysUrl)),
		});
	}

	/** Provider-specific notice with a link (e.g. Codex requires enabling device-auth in ChatGPT).
	 *  The sentence itself is the card's footer; this is the row that opens the page it names. */
	private paintOAuthHintRow(card: HTMLElement, view: IProviderView): void {
		if (!view.oauthHint || !view.oauthHintUrl) { return; }
		this.ui.cardRow(card, {
			label: t('openide.providers.openSettings'),
			description: view.oauthHintUrl,
			icon: 'link-external',
			run: () => void this.openerService.open(URI.parse(view.oauthHintUrl)),
		});
	}

	// ---- API key ----

	/**
	 * The key row: label and state on the left, the password field and the one button on the
	 * right. Typing never redraws — the button follows the field's emptiness on its own — and Enter
	 * submits, so pasting a key and pressing Enter is the whole flow.
	 */
	private paintKeyRow(card: HTMLElement, view: IProviderView, redraw: () => void): void {
		const draft = this.keyDraft.get(view.id) ?? '';
		const busy = this.busyKey === view.id;
		const value = this.ui.cardRow(card, {
			label: 'API key',
			description: view.hasKey ? t('openide.providers.keyStored') : t('openide.providers.keyPaste', view.label),
			keywords: ['api key', 'clave', view.id],
		});
		const input = this.renderStore.add(new InputBox(value, undefined, {
			inputBoxStyles: openideInputBoxStyles,
			placeholder: view.hasKey ? t('openide.providers.keyReplace') : t('openide.providers.keyPaste', view.label),
			ariaLabel: 'API key',
			type: 'password',
		}));
		input.value = draft;
		input.setEnabled(!busy);
		// Not connected yet → the button IS the connect action. Replacing a key on a live provider
		// keeps the quieter wording.
		const button = this.ui.button(value, {
			label: busy
				? (view.connected ? t('openide.providers.saving') : t('openide.providers.connecting'))
				: (view.connected ? t('openide.providers.saveKey') : t('openide.providers.connectKey')),
			icon: busy ? 'loading~spin' : (view.connected ? 'save' : 'plug'),
			primary: true,
			enabled: !busy && !!draft.trim(),
			run: () => void this.saveKey(view, input.value.trim(), 'default', undefined, redraw),
		});
		this.renderStore.add(input.onDidChange(next => {
			this.keyDraft.set(view.id, next);
			button.enabled = !busy && !!next.trim();
		}));
		this.renderStore.add(addDisposableListener(input.inputElement, 'keydown', event => {
			if ((event as KeyboardEvent).key === 'Enter' && button.enabled) { event.preventDefault(); void this.saveKey(view, input.value.trim(), 'default', undefined, redraw); }
		}));
	}

	private async saveKey(view: IProviderView, key: string, mode: 'default' | 'new' | 'reauth', accountId: string | undefined, redraw: () => void): Promise<void> {
		if (!key) { return; }
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
		} catch (error) {
			this.fail(error);
		} finally {
			this.busyKey = undefined;
			// Saving a key changes what every probe on this page measured: re-run them rather than
			// redraw the old answers. Same door as the OAuth path, so the two cannot drift.
			this.recheck();
		}
	}

	// ---- accounts ----

	/**
	 * The sessions saved for this provider, each named by whoever it belongs to: the initial in a
	 * chip, the mail, a "Default" pill on the one the agent uses, and a ⋯ menu with everything
	 * else (set default / re-authenticate / sign out). Three icon buttons per row made every row
	 * look like a toolbar; one menu keeps the list a list.
	 */
	private paintAccountsCard(root: HTMLElement, view: IProviderView): void {
		const card = this.ui.card(root, {
			caption: t('openide.providers.secAccounts'),
			footer: view.accounts.length ? undefined : t('openide.providers.accountsEmpty'),
			keywords: ['cuenta', 'account', 'sesión', 'cerrar sesión', 'sign out'],
		});
		this.paintInto(card, redraw => {
			for (const account of view.accounts) {
				const avatar = $('span.openide-settings-provider-avatar', undefined, this.initialOf(account.label));
				const value = this.ui.cardRow(card, {
					leading: avatar,
					label: account.label,
					keywords: ['cuenta', 'account'],
				});
				if (account.isActive) { this.pill(value, t('openide.providers.accountDefault'), 'ok'); }
				const more = this.ui.iconButton(value, {
					label: t('openide.providers.accountMenu'),
					icon: 'ellipsis',
					run: () => this.openAccountMenu(more, view, account, redraw),
				});
			}
			this.ui.cardRow(card, {
				label: t('openide.providers.accountAdd'), icon: 'add',
				run: () => void this.addAccount(view, redraw),
			});
		});
	}

	private initialOf(label: string): string {
		const trimmed = label.trim();
		return trimmed ? trimmed[0] : '?';
	}

	private openAccountMenu(anchor: HTMLElement, view: IProviderView, account: { id: string; label: string; isActive?: boolean }, redraw: () => void): void {
		this.popover.toggle(anchor, {
			anchorPosition: AnchorPosition.BELOW,
			anchorAlignment: AnchorAlignment.RIGHT,
			width: 220,
			render: (container, store) => {
				const content = createMenuContent(container.ownerDocument);
				container.appendChild(content);
				const item = (options: IMenuRowOptions, run: () => void) => {
					const row = createMenuRow(container.ownerDocument, options);
					store.add(addDisposableListener(row, 'click', () => { this.popover.close(); run(); }));
					content.appendChild(row);
				};
				if (!account.isActive) {
					item({ icon: 'check', label: t('openide.providers.accountSetDefault') },
						() => void this.agentService.switchAccount(view.id, account.id).then(() => this.paint()));
				}
				item({ icon: 'sync', label: t('openide.providers.accountReauth') },
					() => void this.reauthAccount(view, account.id, account.label, redraw));
				item({ icon: view.auth === 'oauth' ? 'sign-out' : 'trash', label: view.auth === 'oauth' ? t('openide.providers.signOut') : t('openide.providers.accountRemove') },
					() => void this.agentService.removeAccount(view.id, account.id).then(() => this.paint()));
			},
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

	// ---- session ----

	/** Reconnect / sign out / clear key: whatever ends the current credential for this provider. */
	private paintSessionCard(root: HTMLElement, view: IProviderView): void {
		const card = this.ui.card(root, {
			caption: t('openide.providers.secSession'),
			keywords: ['cerrar sesión', 'borrar', 'sign out', 'reconectar', 'reconnect'],
		});
		if (view.auth === 'oauth' && view.connected) {
			this.ui.cardRow(card, {
				label: t('openide.providers.reconnect'), icon: 'sync',
				run: () => this.startOAuth(view.id, { mode: 'default' }),
			});
			this.ui.cardRow(card, {
				label: t('openide.providers.signOut'), icon: 'sign-out', danger: true,
				confirm: t('openide.providers.signOutConfirm'),
				run: () => void this.agentService.signOut(view.id).then(() => { this.detailStale = true; this.paint(); }),
			});
		}
		// `hasStoredKey`, NOT `hasKey`: since the credential chain landed, a provider can be
		// connected on a key that lives in the environment or in another tool. Offering "delete
		// the key" for one OpenIDE does not own would be a button that deletes nothing and leaves
		// the provider still connected. What it gets instead is where the key comes from.
		if (view.auth === 'apiKey' && view.hasStoredKey) {
			this.ui.cardRow(card, {
				label: t('openide.providers.clearKey'), icon: 'trash', danger: true,
				confirm: t('openide.providers.clearKeyConfirm'),
				run: () => void this.agentService.clearApiKey(view.id).then(() => { this.detailStale = true; this.paint(); }),
			});
		} else if (view.auth === 'apiKey' && view.hasKey && view.origin && view.origin.kind !== 'store') {
			this.ui.cardRow(card, {
				icon: view.origin.kind === 'env' ? 'terminal' : 'plug',
				label: describeOrigin(view.origin) ?? '',
				description: t('openide.providers.originHint'),
			});
		}
	}

	// ---- models ----

	/**
	 * The models.dev catalog as rows — the same registry opencode reads — with the provider's
	 * default pinned first and a check closing the chosen row. The search sits ABOVE the card and
	 * outside the repainted host, so typing filters the rows without ever losing the caret.
	 * Free-text model ids survive only as the LAST, deliberately quiet row: the escape hatch, not
	 * the flow.
	 */
	private paintModelsCard(root: HTMLElement, view: IProviderView, activeId: string, activeModel: string): void {
		if (!view.modelInfos.length) {
			return; // nothing the catalog or the endpoint can name: no card beats an empty one
		}
		const isActiveProvider = view.connected && view.id === activeId;
		const card = this.ui.card(root, {
			caption: t('openide.providers.secModels'),
			footer: !view.connected
				? t('openide.providers.modelsPreview')
				: !isActiveProvider && this.draftModel.has(view.id)
					? t('openide.providers.modelDraftHint')
					: t('openide.providers.modelsSummary', view.modelInfos.length),
			keywords: ['modelo', 'model', ...view.models.slice(0, 12)],
		});
		card.setAttribute('role', 'radiogroup');
		card.setAttribute('aria-label', t('openide.providers.secModels'));

		let redrawList: (() => void) | undefined;
		if (view.modelInfos.length > PROVIDER_MODEL_SEARCH_THRESHOLD) {
			const group = card.parentElement!;
			const search = this.ui.filter(group, {
				placeholder: t('openide.providers.modelSearch'),
				value: this.modelQuery.get(view.id) ?? '',
				change: query => { this.modelQuery.set(view.id, query); redrawList?.(); },
			});
			search.element.classList.add('openide-settings-provider-modelsearch');
			group.insertBefore(search.element, card);
		}

		this.paintInto(card, redraw => {
			redrawList = redraw;
			// '' means "the provider's default": same contract as setModel('').
			const selected = this.draftModel.get(view.id) ?? (isActiveProvider ? activeModel : '');
			const effectiveSelected = selected || view.defaultModel;
			const query = this.modelQuery.get(view.id) ?? '';

			const infos: IOpenidePickerModel[] = [...view.modelInfos];
			// A manually-typed model that the catalog does not publish still shows as a row, so the
			// selection is never invisible.
			if (effectiveSelected && !infos.some(info => info.id === effectiveSelected)) {
				infos.push(this.agentService.describeModel(view.id, effectiveSelected));
			}
			const visible = filterProviderModels(infos, query);
			if (!visible.length) {
				this.ui.cardRow(card, { label: t('openide.providers.modelNoResults', query.trim()) });
				this.ui.cardRow(card, {
					label: t('openide.providers.catalogRefresh'), icon: 'refresh',
					run: async () => {
						try { await this.agentService.refreshModelCatalog(); }
						catch (error) { this.fail(error); }
						finally { this.recheck(); }
					},
				});
			}
			for (const info of visible) {
				this.paintModelRow(card, view, info, info.id === effectiveSelected, isActiveProvider, redraw);
			}
			if (view.connected) {
				this.ui.cardRow(card, {
					label: t('openide.providers.modelOther'), icon: 'edit',
					run: () => void this.askCustomModel(view, redraw),
				});
			}
		});
	}

	/** One catalog row: name over its mono id · default / context / cost pills · the check. */
	private paintModelRow(card: HTMLElement, view: IProviderView, info: IOpenidePickerModel, selected: boolean, isActiveProvider: boolean, redraw: () => void): void {
		const value = this.ui.cardRow(card, {
			label: info.name,
			description: info.id !== info.name ? info.id : undefined,
			mono: true,
			keywords: [info.id, info.name],
			run: view.connected ? () => void this.chooseModel(view, info.id, isActiveProvider, redraw) : undefined,
		});
		const row = value.parentElement!;
		row.classList.add('openide-settings-provider-model');
		row.classList.toggle('selected', selected);
		row.classList.toggle('disabled', !view.connected);
		row.setAttribute('role', 'radio');
		row.setAttribute('aria-checked', String(selected));
		if (info.id === view.defaultModel) {
			this.pill(value, t('openide.providers.modelDefaultBadge'));
		}
		if (info.context) {
			this.pill(value, t('openide.providers.modelContext', info.context));
		}
		if (info.hasCost) {
			this.pill(value, `${info.costIn} / ${info.costOut}`);
		}
		const check = append(value, $('span.openide-settings-provider-model-check'));
		if (selected) { append(check, $('span.codicon.codicon-check')); }
	}

	/**
	 * Picking a model on the ACTIVE provider applies immediately — the selection IS the intent,
	 * making the user hunt for an "apply" button afterwards was the dead step this flow removes.
	 * On any other provider it stays a draft that "Use this provider" applies atomically.
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
		// The whole page and not the list: the card's footer says the draft is pending, and the
		// footer lives outside the repainted host.
		this.paint();
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
		this.paint();
	}

	/** Runs a painter with a `redraw` that repaints ONLY its own card, so typing in an input never
	 *  rebuilds the whole page (and never races the page-level generation token). */
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
		// `hidden`: the sub-pages must stay resolvable (breadcrumb "AI Providers › OpenAI", deep
		// links) but the sidebar must not list fifteen providers — the index page is the directory.
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
					icon: this.enablingStore ? 'loading~spin' : 'save',
					primary: true,
					enabled: !this.enablingStore,
					run: () => { this.enablingStore = true; this.paint(); void this.agentService.enableBasicPasswordStore(); },
				}]
				: undefined,
		});
	}

	private statusFor(view: IProviderView, activeId: string): ISectionStatus {
		if (view.id === activeId && view.connected) { return { tone: 'ok', label: t('openide.providers.stActive') }; }
		if (view.connected) { return { tone: 'ok', label: t('openide.providers.stConnected') }; }
		if (view.auth === 'none') { return { tone: 'neutral', label: t('openide.providers.stNoAuth') }; }
		return { tone: 'neutral', label: t('openide.providers.stDisconnected') };
	}

	/** The product's pill (openideSurfaceCss.ts): live state beside a row's controls. */
	private pill(parent: HTMLElement, label: string, tone?: 'ok' | 'warn' | 'error'): HTMLElement {
		return append(parent, $(`span.oi-pill${tone ? '.' + tone : ''}`, undefined, label));
	}

	// ---- usage ----

	/** One row per rate-limit window with its meter, then the refresh action as the last row. The
	 *  "still loading" / "nothing to show" sentences are the card's FOOTER, not rows: they
	 *  describe the card, they are not items in it. */
	private paintUsageCard(root: HTMLElement, view: IProviderView): void {
		const state = this.usage.get(view.id);
		const card = this.ui.card(root, {
			caption: t('openide.providers.secUsage'),
			footer: this.usageFooter(view),
			keywords: ['usage', 'límite', 'rate limit', 'cuota'],
		});
		if (state?.error) {
			this.ui.cardRow(card, { label: t('openide.providers.usageWindow'), description: state.error, icon: 'error' });
		}
		for (const window of state?.windows ?? []) {
			const percent = typeof window.usedPercent === 'number' && isFinite(window.usedPercent) ? Math.round(window.usedPercent) : undefined;
			const value = this.ui.cardRow(card, { label: window.label || t('openide.providers.usageWindow') });
			this.ui.progress(value, {
				label: percent !== undefined ? `${percent}%` : '',
				detail: this.formatReset(window.resetsAt, window.resetDescription),
				percent,
			});
		}
		this.ui.cardRow(card, {
			label: state?.loading ? t('openide.providers.usageLoading') : t('openide.providers.usageRefresh'),
			icon: 'refresh',
			busy: !!state?.loading,
			run: state?.loading ? undefined : () => void this.loadUsage(view.id, true),
		});
	}

	/** What the usage card says under itself when it has no windows to show. */
	private usageFooter(view: IProviderView): string | undefined {
		const state = this.usage.get(view.id);
		if (!state || (!state.loaded && state.loading)) { return t('openide.providers.usageWait'); }
		if (state.error || state.windows.length) { return undefined; }
		return t('openide.providers.usageNone');
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

	/**
	 * The login in progress, as rows of the card that started it: one state per row, the spinner
	 * in the row's glyph slot, and the way out (Cancel) beside it. The device code is a mono value
	 * you read and type somewhere else, with copy / reopen beside it.
	 */
	private paintOAuthRows(card: HTMLElement, view: IProviderView, redraw: () => void): void {
		const oauth = this.oauth!;
		const cancel = (host: HTMLElement) => this.ui.button(host, {
			label: t('openide.providers.cancel'),
			ghost: true,
			run: () => { this.cancelOAuth(); this.paint(); },
		});
		if (oauth.phase === 'start') {
			const value = this.ui.cardRow(card, {
				label: t('openide.providers.oauthStart', view.label),
				description: t('openide.providers.oauthStartText'),
				busy: true,
			});
			cancel(value);
			return;
		}
		if (oauth.phase === 'code') {
			const value = this.ui.cardRow(card, {
				label: t('openide.providers.oauthCode'),
				description: t('openide.providers.oauthCodeText'),
			});
			const code = append(value, $('.openide-settings-code'));
			append(code, $('span.openide-settings-code-value', undefined, oauth.code ?? ''));
			this.ui.iconButton(code, { label: t('openide.providers.copy'), icon: 'copy', run: () => void this.clipboardService.writeText(oauth.code ?? '') });
			if (oauth.url) {
				this.ui.iconButton(code, { label: t('openide.providers.reopen'), icon: 'link-external', run: () => void this.openerService.open(URI.parse(oauth.url!)) });
			}
			const waiting = this.ui.cardRow(card, { label: t('openide.providers.oauthWaiting'), busy: true });
			cancel(waiting);
			this.paintOAuthHintRow(card, view);
			return;
		}
		if (oauth.phase === 'paste') {
			const value = this.ui.cardRow(card, {
				label: t('openide.providers.oauthPaste'),
				description: oauth.prompt || t('openide.providers.oauthPasteText'),
			});
			const input = this.renderStore.add(new InputBox(value, undefined, {
				inputBoxStyles: openideInputBoxStyles,
				placeholder: t('openide.providers.oauthCodePlaceholder'),
				ariaLabel: t('openide.providers.oauthCodeLabel'),
			}));
			const submit = () => {
				const pasted = input.value.trim();
				if (pasted) { oauth.pendingPaste?.complete(pasted); oauth.phase = 'start'; redraw(); }
			};
			this.ui.button(value, { label: t('openide.providers.continue'), primary: true, run: submit });
			this.renderStore.add(addDisposableListener(input.inputElement, 'keydown', event => {
				if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); submit(); }
			}));
			cancel(value);
			input.focus();
			this.paintOAuthHintRow(card, view);
			return;
		}
		const value = this.ui.cardRow(card, {
			label: t('openide.providers.oauthError', view.label),
			description: oauth.message || t('openide.providers.oauthErrorUnknown'),
			icon: 'error',
			danger: true,
		});
		this.ui.button(value, { label: t('openide.providers.retry'), icon: 'sync', primary: true, run: () => this.startOAuth(view.id, { mode: 'default' }) });
		cancel(value);
		this.paintOAuthHintRow(card, view);
	}

	private startOAuth(providerId: string, options: { mode: 'default' | 'new' | 'reauth'; accountId?: string; label?: string }): void {
		this.cancelOAuth(); // one session at a time: the new one stops the previous one's polling
		const session: IOAuthState = { providerId, cancelled: false, phase: 'start' };
		this.oauth = session;
		// The OAuth rows live in the Connect / Authentication card of the provider's own page; if
		// the login started from somewhere else, land the user there.
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
					// `recheck` and not `paint`: a repaint alone redraws from the CACHED probes,
					// which still say "not connected" — the login just changed the very thing they
					// measured. This is why the chip only flipped after touching something else.
					this.recheck();
					return;
				}
				session.phase = 'error';
				session.message = t('openide.providers.oauthCancelled');
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
