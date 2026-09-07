/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows, language } from '../../../../base/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEncryptionService, PasswordStoreCLIOption } from '../../../../platform/encryption/common/encryptionService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IOpenideAgentHostService } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { ICredentialOrigin } from '../../../../platform/openideAgentHost/common/openideCredentialSources.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { asText } from '../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IJSONEditingService } from '../../../services/configuration/common/jsonEditing.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILLMProvider } from '../common/openideAgentTypes.js';
import { formatContextTokens, formatCostPerMillion, humanizeModelId } from '../common/openideModelDisplay.js';
import { IOpenideNativeServices } from '../common/openideNativeServices.js';
import { IOpenidePickerGroup, IOpenidePickerModel } from '../common/openidePickerModels.js';
import { modelIdsFromProviderResponse, modelModalitiesFromProviderResponse } from '../common/openideProviderCapabilities.js';
import { findProvider, IProviderEntry, resolveProviders } from '../common/openideProviderCatalog.js';
import { t } from '../common/openideStrings.js';
import { IProviderRateLimits, providerSupportsUsage, usageUnavailableReason } from '../common/openideUsage.js';
import { AnthropicProvider } from '../common/providers/anthropicProvider.js';
import { CodexProvider } from '../common/providers/codexProvider.js';
import { GeminiCloudCodeProvider } from '../common/providers/geminiCloudCodeProvider.js';
import { OpenAICompatibleProvider } from '../common/providers/openaiProvider.js';
import { OpenAIResponsesProvider } from '../common/providers/openaiResponsesProvider.js';
import { OpenideAuthManager, SECRET_APIKEY_PREFIX } from './openideAuth.js';
import { IModelCatalogStatus, IModelReasoning, IRegistryProvider, OpenideModelCatalog, providerCatalogId } from './openideModelCatalog.js';
import { IOAuthInteraction, OpenideOAuthManager, SECRET_OAUTH_PREFIX } from './openideOAuth.js';
import { IOpenidePickerPreferencesService } from './openidePickerPreferencesService.js';
import { IProviderAccountMeta, isPlaceholderAccountLabel, OpenideProviderAccountsService } from './openideProviderAccounts.js';
import { ISubagentRoutingService } from './openideSubagentRoutingService.js';
import { IOpenideUsageService } from './openideUsageService.js';

export const IOpenideProviderService = createDecorator<IOpenideProviderService>('openideProviderService');
export interface IOpenideProviderService {
	readonly _serviceBrand: undefined;
	customProviders(): unknown[] | undefined;
	listProviders(): IProviderEntry[];
	findProvider(providerId: string): IProviderEntry | undefined;
	modelForProvider(providerId: string): string;
	getActiveProviderId(): string;
	setActiveProvider(providerId: string): Promise<void>;
	getModel(): string;
	setModel(model: string): Promise<void>;
	getReasoningEfforts(): Readonly<Record<string, string>>;
	getReasoningEffort(providerId?: string, model?: string): string;
	setReasoningEffort(effort: string, providerId?: string, model?: string): Promise<void>;
	getModelReasoning(providerId?: string, model?: string): IModelReasoning | undefined;
	ensureModelCatalog(): Promise<void>;
	listRegistryProviders(): Promise<IRegistryProvider[]>;
	addRegistryProvider(id: string): Promise<void>;
	refreshModelCatalog(): Promise<IModelCatalogStatus>;
	credentialOrigin(providerId: string): Promise<ICredentialOrigin | undefined>;
	oauthElsewhere(providerId: string): Promise<{ readonly sourceId: string; readonly label: string }[]>;
	getModelCatalogStatus(): IModelCatalogStatus;
	setApiKey(providerId: string, key: string): Promise<void>;
	clearApiKey(providerId: string): Promise<void>;
	hasApiKey(providerId: string): Promise<boolean>;
	hasStoredApiKey(providerId: string): Promise<boolean>;
	signIn(providerId: string, interaction?: IOAuthInteraction): Promise<boolean>;
	isSignedIn(providerId: string): Promise<boolean>;
	signOut(providerId: string): Promise<void>;
	listAccounts(providerId: string): Promise<(IProviderAccountMeta & { isActive: boolean })[]>;
	getActiveAccountId(providerId: string): Promise<string | undefined>;
	ensureAccountTracked(providerId: string): Promise<void>;
	snapshotAccount(providerId: string, opts: { id?: string; label?: string }): Promise<void>;
	switchAccount(providerId: string, accountId: string): Promise<boolean>;
	removeAccount(providerId: string, accountId: string): Promise<void>;
	isConnected(providerId: string): Promise<boolean>;
	getProviderUsage(providerId: string, force?: boolean): Promise<IProviderRateLimits | undefined>;
	getSecretsPersistence(): Promise<'persisted' | 'in-memory' | 'unknown'>;
	canEnableBasicPasswordStore(): Promise<boolean>;
	enableBasicPasswordStore(): Promise<void>;
	resolveProviderModels(entry: IProviderEntry): Promise<string[]>;
	describeModel(providerId: string, modelId: string): IOpenidePickerModel;
	getConnectedModelGroups(selectedProviderId?: string, selectedModel?: string, includeEmpty?: boolean): Promise<IOpenidePickerGroup[]>;
	readonly onDidChange: Event<void>;
	/** Shared credential manager used by the run transport during facade migration. */
	readonly auth: OpenideAuthManager;
	readonly catalog: OpenideModelCatalog;
	readonly protocols: ReadonlyMap<string, ILLMProvider>;
}

/** Provider connections, credentials and model discovery. No chat or turn lifecycle dependencies. */
export class OpenideProviderService extends Disposable implements IOpenideProviderService {
	declare readonly _serviceBrand: undefined;
	readonly protocols = new Map<string, ILLMProvider>();
	readonly auth: OpenideAuthManager;
	readonly catalog: OpenideModelCatalog;
	private readonly oauth: OpenideOAuthManager;
	private readonly accounts: OpenideProviderAccountsService;
	private readonly agentHost: IOpenideAgentHostService;
	private readonly netRequests: IOpenideNativeServices['requests'];
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		@IOpenideNativeServices nativeServices: IOpenideNativeServices,
		@ISecretStorageService private readonly secretStorage: ISecretStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IOpenerService openerService: IOpenerService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IFileService fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IEncryptionService private readonly encryptionService: IEncryptionService,
		@IJSONEditingService private readonly jsonEditingService: IJSONEditingService,
		@IHostService private readonly hostService: IHostService,
		@IOpenideUsageService private readonly usageService: IOpenideUsageService,
		@ISubagentRoutingService private readonly subagentRouting: ISubagentRoutingService,
		@IOpenidePickerPreferencesService private readonly pickerPreferences: IOpenidePickerPreferencesService,
	) {
		super();
		const netRequests = this.netRequests = nativeServices.requests;
		const hostForOAuth = this.agentHost = nativeServices.host;
		this.catalog = new OpenideModelCatalog(netRequests, fileService, environmentService.cacheHome);
		this.protocols.set('anthropic', new AnthropicProvider(netRequests));
		this.protocols.set('openai', new OpenAICompatibleProvider(netRequests));
		this.protocols.set('openai-responses', new OpenAIResponsesProvider(netRequests));
		this.protocols.set('codex', new CodexProvider(netRequests));
		this.protocols.set('gemini-cloudcode', new GeminiCloudCodeProvider(netRequests, () => this.configurationService.getValue<string>('openide.agent.googleCloudProject')));
		this.oauth = new OpenideOAuthManager(netRequests, this.secretStorage, openerService, quickInputService, {
			start: opts => hostForOAuth.oauthLoopbackStart(opts),
			wait: (id, ms) => hostForOAuth.oauthLoopbackWait(id, ms),
			cancel: id => hostForOAuth.oauthLoopbackCancel(id),
		});
		this.auth = new OpenideAuthManager(this.secretStorage, this.oauth);
		// The chain's two inputs: what models.dev says a provider's key is called, and how to read
		// the machine. Wired here because this is the only object that owns both the catalog and
		// the channel to main — the auth manager stays a credential manager.
		this.auth.useRegistry(
			providerId => {
				const registryId = providerCatalogId(providerId) ?? providerId;
				return { registryId, envNames: this.catalog.envNamesFor(registryId) };
			},
			() => this.catalog.allEnvNames(),
			envNames => this.agentHost.readCredentialSources(envNames),
		);
		this.accounts = new OpenideProviderAccountsService(this.secretStorage);
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('openide.agent')) {
				this._onDidChange.fire();
			}
		}));

		// Credentials can change in another window; refresh connected catalogs there as well.
		this._register(this.secretStorage.onDidChangeSecret(key => {
			const prefix = [SECRET_APIKEY_PREFIX, SECRET_OAUTH_PREFIX].find(prefix => key.startsWith(prefix));
			if (!prefix) { return; }
			this.dynamicModelsCache.delete(key.slice(prefix.length));
			this._onDidChange.fire();
		}));

		this.migrateProviderSettings();
		this.migrateReasoningEffort();
	}

	/** Short cache of the ping to local providers (avoids hammering the server on every refresh). */
	private readonly localProbeCache = new Map<string, { at: number; ok: boolean }>();

	/** Cache of GET /models for providers with dynamicModels (TTL 5 min). */
	/** Live `GET /models` per provider, for the life of the window. See `resolveProviderModels`. */
	private readonly dynamicModelsCache = new Map<string, { models: string[]; fetchedAt: number; modalities?: ReturnType<typeof modelModalitiesFromProviderResponse> }>();

	customProviders(): unknown[] | undefined {
		return this.configurationService.getValue<unknown[]>('openide.agent.customProviders');
	}

	listProviders(): IProviderEntry[] {
		return resolveProviders(this.customProviders());
	}

	findProvider(providerId: string): IProviderEntry | undefined {
		return findProvider(this.customProviders(), providerId);
	}

	// Proveedor/modelo activos viven en IStorageService (no en settings.json): se configuran
	// from the "AI Providers" page / the native model picker, not from Settings.
	private static readonly STORAGE_PROVIDER = 'openide.agent.activeProvider';

	/** Legacy key (a single global model). Kept only to migrate previous builds. */
	private static readonly STORAGE_MODEL = 'openide.agent.activeModel';

	/** Each provider remembers its own model. This avoids dragging, say, a GLM over to Claude. */
	private static readonly STORAGE_MODELS_BY_PROVIDER = 'openide.agent.activeModelsByProvider';

	private modelsByProvider(): Record<string, string> {
		const raw = this.storageService.get(OpenideProviderService.STORAGE_MODELS_BY_PROVIDER, StorageScope.APPLICATION);
		if (!raw) {
			return {};
		}
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
		} catch {
			return {};
		}
	}

	modelForProvider(providerId: string): string {
		if (!providerId) {
			return '';
		}
		const value = this.modelsByProvider()[providerId];
		return typeof value === 'string' ? value : '';
	}

	/** One-time migration: old settings.json values move to storage and are cleaned up. */
	private migrateProviderSettings(): void {
		const legacyProvider = this.configurationService.getValue<string>('openide.agent.provider');
		if (legacyProvider && this.storageService.get(OpenideProviderService.STORAGE_PROVIDER, StorageScope.APPLICATION) === undefined) {
			this.storageService.store(OpenideProviderService.STORAGE_PROVIDER, legacyProvider, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		const legacyModel = this.configurationService.getValue<string>('openide.agent.model');
		const storedLegacyModel = this.storageService.get(OpenideProviderService.STORAGE_MODEL, StorageScope.APPLICATION);
		const activeProvider = this.storageService.get(OpenideProviderService.STORAGE_PROVIDER, StorageScope.APPLICATION) || legacyProvider || '';
		const modelToMigrate = storedLegacyModel || legacyModel || '';
		if (activeProvider && modelToMigrate) {
			const models = this.modelsByProvider();
			if (typeof models[activeProvider] !== 'string') {
				models[activeProvider] = modelToMigrate;
				this.storageService.store(OpenideProviderService.STORAGE_MODELS_BY_PROVIDER, JSON.stringify(models), StorageScope.APPLICATION, StorageTarget.MACHINE);
			}
		}
		// Best-effort cleanup of settings.json (the keys are no longer registered).
		if (legacyProvider !== undefined) {
			this.configurationService.updateValue('openide.agent.provider', undefined).catch(() => { });
		}
		if (legacyModel !== undefined) {
			this.configurationService.updateValue('openide.agent.model', undefined).catch(() => { });
		}
	}

	getActiveProviderId(): string {
		// '' = sin proveedor — la UI (chat/status bar) ofrece conectar; runMessages lo reporta accionable.
		return this.storageService.get(OpenideProviderService.STORAGE_PROVIDER, StorageScope.APPLICATION) || '';
	}

	async setActiveProvider(providerId: string): Promise<void> {
		this.storageService.store(OpenideProviderService.STORAGE_PROVIDER, providerId, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	getModel(): string {
		return this.modelForProvider(this.getActiveProviderId());
	}

	async setModel(model: string): Promise<void> {
		const providerId = this.getActiveProviderId();
		if (!providerId) {
			return;
		}
		const models = this.modelsByProvider();
		models[providerId] = model;
		this.storageService.store(OpenideProviderService.STORAGE_MODELS_BY_PROVIDER, JSON.stringify(models), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	/** @deprecated The session-wide effort. Read once, by the migration, and then removed. */
	private static readonly STORAGE_EFFORT = 'openide.agent.reasoningEffort';

	private static readonly STORAGE_EFFORT_BY_MODEL = 'openide.agent.reasoningEffortByModel';

	/** Parsed once per distinct stored value. The picker reads this for every row it builds, on
	 *  every keystroke in its search box, and a `JSON.parse` per model is a parse per model. */
	private _efforts: { raw: string | undefined; value: Record<string, string> } | undefined;

	private effortsByModel(): Record<string, string> {
		const raw = this.storageService.get(OpenideProviderService.STORAGE_EFFORT_BY_MODEL, StorageScope.APPLICATION);
		const cached = this._efforts;
		// `cached &&` and not `cached?.raw === raw`: with nothing stored, `raw` is `undefined` too,
		// and the optional form is true on the very first call — when there is no cache to return.
		if (cached && cached.raw === raw) {
			return cached.value;
		}
		let value: Record<string, string> = {};
		try {
			const parsed = raw ? JSON.parse(raw) : {};
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { value = parsed as Record<string, string>; }
		} catch {
			value = {};
		}
		// Keyed on the RAW string, so a write from this window or from another one invalidates it
		// without anyone having to remember to.
		this._efforts = { raw, value };
		return value;
	}

	getReasoningEfforts(): Readonly<Record<string, string>> {
		return this.effortsByModel();
	}

	/** `<providerId>/<modelId>`, the same key the model picker builds its rows around. */
	private effortKey(providerId: string, model: string): string {
		return `${providerId}/${model}`;
	}

	/**
	 * Which model an effort call is about. Empty arguments mean the active one, and an active
	 * provider with no explicit model means that provider's default — the same resolution
	 * `getModelReasoning` does, so the level and the levels on offer always describe one model.
	 */
	private effortTarget(providerId?: string, model?: string): string {
		const provider = providerId ?? this.getActiveProviderId();
		if (!provider) {
			return '';
		}
		const target = model || (providerId ? this.modelForProvider(providerId) : this.getModel()) || this.findProvider(provider)?.defaultModel || '';
		return target ? this.effortKey(provider, target) : '';
	}

	/** '' = the model's default · 'none' off · minimal/low/medium/high/xhigh (with limits independent of the model). */
	getReasoningEffort(providerId?: string, model?: string): string {
		const key = this.effortTarget(providerId, model);
		return key ? this.effortsByModel()[key] || '' : '';
	}

	async setReasoningEffort(effort: string, providerId?: string, model?: string): Promise<void> {
		const key = this.effortTarget(providerId, model);
		if (!key) {
			return;
		}
		// Copied: `effortsByModel` hands back the cached object, and mutating that in place would
		// leave the cache agreeing with a `raw` string it no longer matches.
		const efforts = { ...this.effortsByModel() };
		// '' is the model's own default, which is the absence of a choice, not a choice of nothing:
		// stored as an entry it would pin the map at one row per model the user ever looked at.
		if (effort) { efforts[key] = effort; } else { delete efforts[key]; }
		this.storageService.store(OpenideProviderService.STORAGE_EFFORT_BY_MODEL, JSON.stringify(efforts), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	/**
	 * The effort used to be ONE value for the whole session. It becomes the entry of the model that
	 * was active when this build first ran, and the legacy key goes: carrying it as a fallback for
	 * every OTHER model would silently apply a level chosen for one model to models that never had
	 * it, which is the confusion the per-model store exists to end.
	 */
	private migrateReasoningEffort(): void {
		const legacy = this.storageService.get(OpenideProviderService.STORAGE_EFFORT, StorageScope.APPLICATION);
		if (legacy === undefined) {
			return;
		}
		this.storageService.remove(OpenideProviderService.STORAGE_EFFORT, StorageScope.APPLICATION);
		const key = legacy ? this.effortTarget() : '';
		if (!key) {
			return;
		}
		const efforts = { ...this.effortsByModel() };
		if (efforts[key] !== undefined) {
			return;
		}
		efforts[key] = legacy;
		this.storageService.store(OpenideProviderService.STORAGE_EFFORT_BY_MODEL, JSON.stringify(efforts), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	getModelReasoning(providerId = this.getActiveProviderId(), model?: string): IModelReasoning | undefined {
		const entry = this.findProvider(providerId);
		const target = model || this.getModel() || entry?.defaultModel || '';
		return target ? this.catalog.reasoningFor(target, providerId) : undefined;
	}

	ensureModelCatalog(): Promise<void> {
		return this.catalog.ensureFresh();
	}

	async listRegistryProviders(): Promise<IRegistryProvider[]> {
		await this.catalog.ensureFresh();
		// Anything already in the catalog — built-in or custom — is offered by its own row, with
		// its OAuth, its headers and its blurb. This list is only what has no entry yet.
		const known = new Set(this.listProviders().map(entry => entry.id.toLowerCase()));
		return this.catalog.providers().filter(provider => !known.has(provider.id.toLowerCase()));
	}

	async addRegistryProvider(id: string): Promise<void> {
		const provider = this.catalog.providers().find(entry => entry.id === id);
		if (!provider) {
			throw new Error(`models.dev does not publish a provider called ${id}.`);
		}
		if (this.findProvider(provider.id)) {
			return;
		}
		const current = this.customProviders();
		const custom = Array.isArray(current) ? [...current] : [];
		// `protocol: 'openai'` because that is what the registry's `api` speaks — every entry it
		// publishes with a base URL is an OpenAI-compatible endpoint. `auth: 'apiKey'` and not the
		// default, or `normalizeCustom` would still call it apiKey but the local runtimes among
		// them would ask for a key they do not want; the ones with no `env` declare none.
		custom.push({
			id: provider.id,
			label: provider.name,
			company: provider.name,
			protocol: 'openai',
			baseUrl: provider.api,
			auth: provider.env.length ? 'apiKey' : 'none',
			// The registry's `doc` is where the key is minted, so it belongs in the link slot, not
			// in the blurb — a bare URL printed as the row's description is not a description.
			apiKeysUrl: provider.doc,
		});
		await this.configurationService.updateValue('openide.agent.customProviders', custom);
	}

	async refreshModelCatalog(): Promise<IModelCatalogStatus> {
		try {
			await this.catalog.refreshNow();
		} finally {
			// Provider discovery must refresh even when the public registry is unavailable.
			this.dynamicModelsCache.clear();
			this.auth.forgetExternalCredentials();
			this._onDidChange.fire();
		}
		return this.catalog.status();
	}

	/** Where the credential a provider will actually use comes from (store / env / another tool). */
	credentialOrigin(providerId: string): Promise<ICredentialOrigin | undefined> {
		return this.auth.credentialOrigin(providerId);
	}

	/** Providers a tool on this machine has connected over OAuth — a hint, never a credential. */
	oauthElsewhere(providerId: string): Promise<{ readonly sourceId: string; readonly label: string }[]> {
		return this.auth.oauthElsewhere(providerId);
	}

	getModelCatalogStatus(): IModelCatalogStatus {
		return this.catalog.status();
	}

	async setApiKey(providerId: string, key: string): Promise<void> {
		await this.auth.setApiKey(providerId, key);
		this.resetProviderRuntime(providerId);
		this.subagentRouting.clearHealth(providerId);
		if (!this.getActiveProviderId()) {
			this.storageService.store(OpenideProviderService.STORAGE_PROVIDER, providerId, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		this._onDidChange.fire();
	}

	async clearApiKey(providerId: string): Promise<void> {
		await this.auth.clearApiKey(providerId);
		this.resetProviderRuntime(providerId);
		this._onDidChange.fire();
	}

	hasApiKey(providerId: string): Promise<boolean> {
		return this.auth.hasApiKey(providerId);
	}

	hasStoredApiKey(providerId: string): Promise<boolean> {
		return this.auth.hasStoredApiKey(providerId);
	}

	async signIn(providerId: string, interaction?: IOAuthInteraction): Promise<boolean> {
		const entry = findProvider(this.customProviders(), providerId);
		if (!entry) {
			throw new Error(`Provider desconocido: "${providerId}".`);
		}
		const ok = await this.oauth.signIn(entry, interaction);
		if (ok) {
			this.resetProviderRuntime(providerId);
			this.subagentRouting.clearHealth(providerId);
			if (!this.getActiveProviderId()) {
				this.storageService.store(OpenideProviderService.STORAGE_PROVIDER, providerId, StorageScope.APPLICATION, StorageTarget.MACHINE);
			}
			this._onDidChange.fire();
		}
		return ok;
	}

	isSignedIn(providerId: string): Promise<boolean> {
		return this.oauth.isSignedIn(providerId);
	}

	async signOut(providerId: string): Promise<void> {
		await this.oauth.signOut(providerId);
		this.resetProviderRuntime(providerId);
		this._onDidChange.fire();
	}

	/** Key of the long-standing ACTIVE credential (the one openideAuth/openideOAuth read and write
	 *  unchanged) — it is the only piece OpenideProviderAccountsService needs to know in order to
	 *  copy/restore accounts without understanding the content (an opaque string). */
	private accountBaseKey(providerId: string): string | undefined {
		const entry = findProvider(this.customProviders(), providerId);
		if (!entry || entry.auth === 'none') {
			return undefined;
		}
		return entry.auth === 'oauth' ? SECRET_OAUTH_PREFIX + providerId : SECRET_APIKEY_PREFIX + providerId;
	}

	async listAccounts(providerId: string): Promise<(IProviderAccountMeta & { isActive: boolean })[]> {
		const [accounts, activeId] = await Promise.all([this.accounts.list(providerId), this.accounts.getActiveId(providerId)]);
		// Sessions saved before the provider's identity was read — or before it was stored at all —
		// are sitting on a number. The active one is the only account whose credential is loaded,
		// so it is the only one we can still name; do it here, once, and persist it.
		const active = accounts.find(account => account.id === activeId);
		if (active && isPlaceholderAccountLabel(active.label)) {
			const identity = await this.oauth.identity(providerId).catch(() => undefined);
			if (identity && await this.accounts.rename(providerId, active.id, identity)) {
				return (await this.accounts.list(providerId)).map(account => ({ ...account, isActive: account.id === activeId }));
			}
		}
		return accounts.map(account => ({ ...account, isActive: account.id === activeId }));
	}

	getActiveAccountId(providerId: string): Promise<string | undefined> {
		return this.accounts.getActiveId(providerId);
	}

	/** Tracks the current active credential as an account when there is none yet (transparent
	 *  migration of sessions connected before this feature). Call it before any connection or
	 *  re-authentication flow. */
	async ensureAccountTracked(providerId: string): Promise<void> {
		const baseKey = this.accountBaseKey(providerId);
		if (baseKey && await this.accounts.ensureActiveTracked(providerId, baseKey)) {
			this._onDidChange.fire();
		}
	}

	/** Saves the CURRENT active credential (just connected or re-authenticated) as a new account
	 *  (no `opts.id`) or updates an existing one (`opts.id` present), and marks it active. With no
	 *  label given it asks the provider who just signed in, so the account arrives named. */
	async snapshotAccount(providerId: string, opts: { id?: string; label?: string }): Promise<void> {
		const baseKey = this.accountBaseKey(providerId);
		if (baseKey) {
			const label = opts.label || await this.oauth.identity(providerId).catch(() => undefined);
			if (await this.accounts.snapshot(providerId, baseKey, { ...opts, label })) {
				this._onDidChange.fire();
			}
		}
	}

	async switchAccount(providerId: string, accountId: string): Promise<boolean> {
		const baseKey = this.accountBaseKey(providerId);
		if (!baseKey) {
			return false;
		}
		const ok = await this.accounts.activate(providerId, baseKey, accountId);
		if (ok) {
			this.resetProviderRuntime(providerId);
			this.subagentRouting.clearHealth(providerId);
			this._onDidChange.fire();
		}
		return ok;
	}

	async removeAccount(providerId: string, accountId: string): Promise<void> {
		const baseKey = this.accountBaseKey(providerId);
		if (!baseKey) {
			return;
		}
		const wasActive = (await this.accounts.getActiveId(providerId)) === accountId;
		await this.accounts.remove(providerId, baseKey, accountId);
		if (wasActive) {
			this.resetProviderRuntime(providerId);
			this.subagentRouting.clearHealth(providerId);
		}
		this._onDidChange.fire();
	}

	private resetProviderRuntime(providerId: string): void {
		this.dynamicModelsCache.delete(providerId);
		const entry = findProvider(this.customProviders(), providerId);
		if (entry) {
			this.protocols.get(entry.protocol)?.resetSessionState?.();
		}
	}

	async isConnected(providerId: string): Promise<boolean> {
		const entry = findProvider(this.customProviders(), providerId);
		if (!entry) {
			return false;
		}
		if (entry.auth === 'none') {
			// Local (Ollama/LM Studio/llama.cpp): "connected" = the server is listening.
			return this.probeLocalProvider(entry.id, entry.baseUrl ?? '');
		}
		if (entry.auth === 'oauth') {
			return this.oauth.isSignedIn(providerId);
		}
		return this.auth.hasApiKey(providerId);
	}

	/**
	 * Provider OAuth usage. Resolves the bearer through AuthManager (never returns it)
	 * y delega el fetch+cache a OpenideUsageService.
	 */
	async getProviderUsage(providerId: string, force = false): Promise<IProviderRateLimits | undefined> {
		if (!this.configurationService.getValue<boolean>('openide.agent.usage.enabled')) {
			return undefined;
		}
		const entry = findProvider(this.customProviders(), providerId);
		if (!entry) {
			return undefined;
		}
		if (!(await this.isConnected(providerId))) {
			return undefined;
		}
		// Connected but without an endpoint: the honest reason, so the popover never says a generic
		// "unavailable" (Orca's `usage-unavailable` failure kind).
		if (!providerSupportsUsage(entry)) {
			return { providerId, fetchedAt: Date.now(), windows: [], status: 'unavailable', failureKind: 'usage-unavailable', error: usageUnavailableReason(entry) };
		}
		try {
			const cred = await this.auth.resolveCredential(entry);
			if (entry.id === 'openrouter') {
				return cred.kind === 'apiKey'
					? await this.usageService.fetchOpenRouterCredits(providerId, cred.value, { force })
					: undefined;
			}
			if (cred.kind !== 'oauth' || !cred.token) {
				return { providerId, fetchedAt: Date.now(), windows: [], status: 'error', failureKind: 'missing-credentials', error: t('agentSurface.usage.oauthNoToken') };
			}
			if (entry.id === 'openai-codex') {
				return await this.usageService.fetchCodexOAuthUsage(providerId, cred.token, { force });
			}
			if (entry.id === 'xai-oauth') {
				return await this.usageService.fetchGrokOAuthUsage(providerId, cred.token, { force });
			}
			if (entry.id === 'antigravity-oauth') {
				// The chat provider onboards the account and learns its managed project on the first
				// turn; the quota endpoint needs that same project. The user's setting wins when set.
				const cloudCode = this.protocols.get('gemini-cloudcode');
				const resolved = cloudCode instanceof GeminiCloudCodeProvider ? cloudCode.resolvedProjectId : undefined;
				const projectOverride = String(this.configurationService.getValue('openide.agent.googleCloudProject') ?? '').trim() || resolved || '';
				return await this.usageService.fetchGeminiQuota(providerId, cred.token, { force, projectOverride });
			}
			return await this.usageService.fetchAnthropicOAuthUsage(providerId, cred.token, { force });
		} catch {
			return {
				providerId,
				fetchedAt: Date.now(),
				windows: [],
				status: 'error',
				failureKind: 'missing-credentials',
				error: t('agentSurface.usage.credentialFailed'),
			};
		}
	}

	async getSecretsPersistence(): Promise<'persisted' | 'in-memory' | 'unknown'> {
		// Force SecretStorage init (type starts as 'unknown' until the first get/set).
		try {
			await this.secretStorage.get('openide.agent._probe');
		} catch { /* ignore */ }
		const t = this.secretStorage.type;
		return t === 'persisted' || t === 'in-memory' ? t : 'unknown';
	}

	async canEnableBasicPasswordStore(): Promise<boolean> {
		// password-store=basic / plain-text encryption solo aplica en Linux (Win/mac usan DPAPI/Keychain).
		if (!isLinux || isWindows || isMacintosh) {
			return false;
		}
		return (await this.getSecretsPersistence()) === 'in-memory';
	}

	async enableBasicPasswordStore(): Promise<void> {
		if (!(await this.canEnableBasicPasswordStore())) {
			throw new Error(t('agentSurface.secrets.basicStoreLinuxOnly'));
		}
		// Same fix as VS Code's native dialog on Linux without a keyring: password-store=basic
		// in argv.json + plain-text encryption in this session, then reload so main picks it up.
		await this.encryptionService.setUsePlainTextEncryption();
		await this.jsonEditingService.write(
			this.environmentService.argvResource,
			[{ path: ['password-store'], value: PasswordStoreCLIOption.basic }],
			true,
		);
		await this.hostService.reload();
	}

	/** Ping with a short timeout to a local provider's baseUrl. Any HTTP response (even 404)
	 *  counts as alive; only a connection failure counts as down. */
	private async probeLocalProvider(providerId: string, baseUrl: string): Promise<boolean> {
		if (!baseUrl) {
			return true; // sin URL no hay qué probar (no bloquear providers custom raros)
		}
		const cached = this.localProbeCache.get(providerId);
		if (cached && Date.now() - cached.at < 5_000) {
			return cached.ok;
		}
		let ok = false;
		const cts = new CancellationTokenSource();
		const timer = setTimeout(() => cts.cancel(), 1_500);
		try {
			const url = `${baseUrl.replace(/\/+$/, '')}/models`;
			const ctx = await this.netRequests.request({ type: 'GET', url, callSite: 'openideAgentLocalProbe' }, cts.token);
			ok = typeof ctx.res.statusCode === 'number';
		} catch {
			ok = false;
		} finally {
			clearTimeout(timer);
			cts.dispose();
		}
		this.localProbeCache.set(providerId, { at: Date.now(), ok });
		return ok;
	}

	/** Model list for a provider, from the freshest source that answers:
	 *   1. the provider's own endpoint — the only one that knows what THIS account can reach;
	 *   2. models.dev, for providers whose catalog is public and 1:1 with a registry entry;
	 *   3. `defaultModel`, so the picker is never empty on a cold offline start.
	 *  OpenIDE keeps no model list of its own — see openideModelCatalog.ts. */
	async resolveProviderModels(entry: IProviderEntry): Promise<string[]> {
		// Warms the registry for the surfaces that call this without going through the picker
		// (settings pages, subagent config). getConnectedModelGroups awaits it before painting.
		await this.catalog.ensureFresh();
		const fallback = (): string[] => {
			const known = this.catalog.modelsFor(entry.id);
			if (known.length) {
				// The persisted default may predate the registry's current naming; keeping it
				// visible avoids a silent switch on a list the user did not ask to change.
				return entry.defaultModel && !known.includes(entry.defaultModel) ? [entry.defaultModel, ...known] : known;
			}
			return entry.defaultModel ? [entry.defaultModel] : [];
		};
		const adapter = this.protocols.get(entry.protocol);
		// OpenAI-compatible built-ins usually publish GET /models. Custom providers are only probed
		// when explicitly asked, so a manual list is not turned into an error.
		const genericDiscovery = !!entry.baseUrl && (entry.dynamicModels === true || (!entry.custom && (entry.protocol === 'openai' || entry.protocol === 'openai-responses')));
		if (!adapter?.listModels && !genericDiscovery) {
			return fallback();
		}
		// Refresh on demand after 30 minutes: long-lived IDE sessions must discover releases
		// without a restart. No background polling; explicit refresh and account changes invalidate.
		const cached = this.dynamicModelsCache.get(entry.id);
		if (cached && Date.now() - cached.fetchedAt < 30 * 60 * 1000) {
			return cached.models;
		}
		try {
			const credential = await this.auth.resolveCredential(entry);
			if (adapter?.listModels) {
				const ids = [...await adapter.listModels({ credential, providerId: entry.id, baseUrl: entry.baseUrl, extraHeaders: entry.extraHeaders, cloudCodeMetadata: entry.cloudCodeMetadata }, CancellationToken.None)]
					.filter(id => typeof id === 'string' && id.length > 0)
					.sort((a, b) => a.localeCompare(b));
				if (ids.length) {
					this.dynamicModelsCache.set(entry.id, { models: ids, fetchedAt: Date.now() });
					return ids;
				}
			}
			if (!genericDiscovery || !entry.baseUrl) {
				return fallback();
			}
			const url = `${entry.baseUrl.replace(/\/+$/, '')}/models`;
			const headers: Record<string, string> = { ...(entry.extraHeaders ?? {}) };
			const bearer = credential.kind === 'apiKey' ? credential.value : credential.kind === 'oauth' ? credential.token : '';
			if (bearer) {
				headers['Authorization'] = `Bearer ${bearer}`;
			}
			const ctx = await this.netRequests.request({ type: 'GET', url, headers, callSite: 'openideAgentModels' }, CancellationToken.None);
			const status = ctx.res.statusCode ?? 0;
			if (status < 200 || status >= 300) {
				throw new Error(`HTTP ${status}`);
			}
			const text = await asText(ctx);
			if (!text) {
				throw new Error('empty body');
			}
			const discovery: unknown = JSON.parse(text);
			const ids = modelIdsFromProviderResponse(discovery);
			if (ids.length) {
				this.dynamicModelsCache.set(entry.id, { models: ids, fetchedAt: Date.now(), modalities: modelModalitiesFromProviderResponse(discovery) });
				return ids;
			}
		} catch { /* sin red o API caída: fallback estático */ }
		return fallback();
	}

	/** Everything the picker renders for one model. Built here rather than in the webview so the
	 *  formatting is testable and the registry never has to cross the postMessage boundary. */
	describeModel(providerId: string, modelId: string): IOpenidePickerModel {
		const meta = this.catalog.metadataFor(modelId, providerId);
		const liveModalities = this.dynamicModelsCache.get(providerId)?.modalities?.get(modelId);
		const reasoning = this.catalog.reasoningFor(modelId, providerId);
		const locale = language || 'en';
		return {
			id: modelId,
			name: meta?.name?.trim() || humanizeModelId(modelId) || modelId,
			context: formatContextTokens(meta?.limit?.context ?? meta?.limit?.input, locale),
			toolCall: meta?.tool_call === true,
			reasoning: meta?.reasoning === true,
			input: [...(liveModalities?.input ?? meta?.modalities?.input ?? [])],
			output: [...(liveModalities?.output ?? meta?.modalities?.output ?? [])],
			costIn: formatCostPerMillion(meta?.cost?.input, locale),
			costOut: formatCostPerMillion(meta?.cost?.output, locale),
			// No cost published (subscriptions, local runtimes) must not render as "— / —".
			hasCost: typeof meta?.cost?.input === 'number' || typeof meta?.cost?.output === 'number',
			efforts: [...(reasoning?.efforts ?? [])],
			toggle: reasoning?.toggle === true,
		};
	}

	async getConnectedModelGroups(selectedProviderId = this.getActiveProviderId(), selectedModel = this.getModel(), includeEmpty = false): Promise<IOpenidePickerGroup[]> {
		await this.catalog.ensureFresh();
		const providers = this.listProviders();
		const groups: IOpenidePickerGroup[] = [];
		await Promise.all(providers.map(async provider => {
			try {
				if (!(await this.isConnected(provider.id))) { return; }
				const ids = [...await this.resolveProviderModels(provider)];
				// Same as the historical composer: the persisted/manual value stays visible even when
				// discovery changes. Build revalidates it before running and gives an actionable error if stale.
				if (provider.id === selectedProviderId && selectedModel && !ids.includes(selectedModel)) { ids.push(selectedModel); }
				if (ids.length || includeEmpty) {
					groups.push({
						id: provider.id,
						label: provider.label,
						defaultModel: provider.defaultModel || '',
						models: ids.map(id => this.describeModel(provider.id, id)),
					});
				}
			} catch { /* provider desconectado o discovery fallido */ }
		}));
		const order = this.pickerPreferences.getProviderOrder();
		// Explicit user order first (drag in the picker), then the catalog's own order for the rest.
		groups.sort((a, b) => {
			const rankA = order.indexOf(a.id), rankB = order.indexOf(b.id);
			if (rankA !== rankB) { return (rankA < 0 ? Number.MAX_SAFE_INTEGER : rankA) - (rankB < 0 ? Number.MAX_SAFE_INTEGER : rankB); }
			return providers.findIndex(provider => provider.id === a.id) - providers.findIndex(provider => provider.id === b.id);
		});
		return groups;
	}
}

registerSingleton(IOpenideProviderService, OpenideProviderService, InstantiationType.Delayed);
