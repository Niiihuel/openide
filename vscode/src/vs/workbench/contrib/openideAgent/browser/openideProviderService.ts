/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout, raceCancellationError } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows, language } from '../../../../base/common/platform.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
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
import { ICredential, IFastModeCapability, ILLMProvider } from '../common/openideAgentTypes.js';
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
/** An explicit, non-generating connection check. Never includes credentials or response bodies. */
export interface IProviderConnectionCheck {
	readonly status: 'available' | 'unverified' | 'missing-credentials' | 'auth-error' | 'endpoint-error' | 'unreachable';
	readonly checkedAt: number;
	readonly models?: readonly string[];
	readonly statusCode?: number;
}

interface IProviderModelDiscovery extends IProviderConnectionCheck {
	readonly modalities?: ReturnType<typeof modelModalitiesFromProviderResponse>;
}

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
	getFastModeCapability(providerId?: string, model?: string): IFastModeCapability;
	getFastMode(providerId?: string, model?: string): boolean;
	setFastMode(enabled: boolean, providerId?: string, model?: string): Promise<void>;
	getReasoningEfforts(): Readonly<Record<string, string>>;
	getReasoningEffort(providerId?: string, model?: string): string;
	setReasoningEffort(effort: string, providerId?: string, model?: string): Promise<void>;
	getModelReasoning(providerId?: string, model?: string): IModelReasoning | undefined;
	ensureModelCatalog(): Promise<void>;
	listRegistryProviders(): Promise<IRegistryProvider[]>;
	addRegistryProvider(id: string): Promise<void>;
	addCustomProvider(entry: IProviderEntry, apiKey?: string): Promise<void>;
	updateCustomProvider(entry: IProviderEntry, apiKey?: string): Promise<void>;
	checkProviderConnection(entryOrId: IProviderEntry | string, apiKey?: string): Promise<IProviderConnectionCheck>;
	refreshProviderConnections(): void;
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
	private readonly connectionRequests = this._register(new DisposableStore());
	private discoveryGeneration = 0;
	private connectionRequestId = 0;
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
				if (e.affectsConfiguration('openide.agent.customProviders')) { this.invalidateConnections(); }
				this._onDidChange.fire();
			}
		}));

		// Credentials can change in another window; refresh connected catalogs there as well.
		this._register(this.secretStorage.onDidChangeSecret(key => {
			const prefix = [SECRET_APIKEY_PREFIX, SECRET_OAUTH_PREFIX].find(prefix => key.startsWith(prefix));
			if (!prefix) { return; }
			this.invalidateProvider(key.slice(prefix.length));
			this._onDidChange.fire();
		}));

		this.migrateProviderSettings();
		this.migrateReasoningEffort();
	}

	/** Short cache of the ping to local providers (avoids hammering the server on every refresh). */
	private readonly localProbeCache = new Map<string, { signature: string; at: number; ok: boolean }>();
	private readonly localProbes = new Map<string, { signature: string; id: number; promise: Promise<boolean> }>();

	/** Successful discovery lasts 30 minutes; failed discovery backs off briefly, without polling. */
	private readonly dynamicModelsCache = new Map<string, { signature: string; models: string[]; fetchedAt: number; ttl: number; modalities?: ReturnType<typeof modelModalitiesFromProviderResponse> }>();
	private readonly pendingModels = new Map<string, { signature: string; id: number; promise: Promise<string[]> }>();

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

	private static readonly STORAGE_FAST_MODE = 'openide.agent.fastModeByModel';

	getFastModeCapability(providerId?: string, model?: string): IFastModeCapability {
		const id = providerId ?? this.getActiveProviderId();
		const entry = this.findProvider(id);
		const target = model || this.modelForProvider(id) || entry?.defaultModel || '';
		return entry && target ? this.protocols.get(entry.protocol)?.getFastModeCapability?.(target, id, entry.baseUrl) ?? { supported: false } : { supported: false };
	}

	private fastModes(): Record<string, boolean> {
		try {
			const value: unknown = JSON.parse(this.storageService.get(OpenideProviderService.STORAGE_FAST_MODE, StorageScope.APPLICATION) || '{}');
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				return Object.fromEntries(Object.entries(value).filter(([, enabled]) => enabled === true));
			}
		} catch { /* Invalid storage must never opt a user into a paid tier. */ }
		return {};
	}

	getFastMode(providerId?: string, model?: string): boolean {
		const key = this.effortTarget(providerId, model);
		return !!key && this.getFastModeCapability(providerId, model).supported && this.fastModes()[key] === true;
	}

	async setFastMode(enabled: boolean, providerId?: string, model?: string): Promise<void> {
		const key = this.effortTarget(providerId, model);
		if (!key || (enabled && !this.getFastModeCapability(providerId, model).supported)) { return; }
		const modes = this.fastModes();
		if (enabled) { modes[key] = true; } else { delete modes[key]; }
		this.storageService.store(OpenideProviderService.STORAGE_FAST_MODE, JSON.stringify(modes), StorageScope.APPLICATION, StorageTarget.MACHINE);
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
			dynamicModels: true,
			// The registry's `doc` is where the key is minted, so it belongs in the link slot, not
			// in the blurb — a bare URL printed as the row's description is not a description.
			apiKeysUrl: provider.doc,
		});
		await this.configurationService.updateValue('openide.agent.customProviders', custom);
	}

	async addCustomProvider(entry: IProviderEntry, apiKey?: string): Promise<void> {
		if (this.listProviders().some(provider => provider.id.toLowerCase() === entry.id.toLowerCase())) {
			throw new Error(t('openide.duplicateProvider'));
		}
		const current = this.customProviders();
		await this.storeCustomProvider(entry, [...(Array.isArray(current) ? current : []), entry], apiKey);
	}

	async updateCustomProvider(entry: IProviderEntry, apiKey?: string): Promise<void> {
		const current = this.customProviders();
		const custom = Array.isArray(current) ? [...current] : [];
		const index = custom.findIndex(raw => !!raw && typeof raw === 'object' && (raw as { id?: string }).id === entry.id);
		if (index < 0) { throw new Error(t('openide.missingCustomProvider')); }
		const updates = Object.fromEntries(Object.entries(entry).filter(([key, value]) => value !== undefined || key === 'defaultModel'));
		custom[index] = { ...custom[index] as object, ...updates };
		await this.storeCustomProvider(entry, custom, apiKey);
	}

	private async storeCustomProvider(entry: IProviderEntry, custom: unknown[], apiKey?: string): Promise<void> {
		const key = SECRET_APIKEY_PREFIX + entry.id;
		const previous = apiKey === undefined ? undefined : await this.secretStorage.get(key);
		if (apiKey !== undefined) { await this.auth.setApiKey(entry.id, apiKey); }
		try {
			await this.configurationService.updateValue('openide.agent.customProviders', custom, ConfigurationTarget.USER);
		} catch (error) {
			if (apiKey !== undefined) {
				if (previous === undefined) { await this.secretStorage.delete(key); }
				else { await this.secretStorage.set(key, previous); }
			}
			throw error;
		}
		this.invalidateProvider(entry.id);
		this._onDidChange.fire();
	}

	private invalidateProvider(providerId: string): void {
		this.dynamicModelsCache.delete(providerId);
		this.pendingModels.delete(providerId);
		this.localProbeCache.delete(providerId);
		this.localProbes.delete(providerId);
	}

	private invalidateConnections(): void {
		this.discoveryGeneration++;
		this.dynamicModelsCache.clear();
		this.pendingModels.clear();
		this.localProbeCache.clear();
		this.localProbes.clear();
	}

	refreshProviderConnections(): void {
		this.invalidateConnections();
		this.auth.forgetExternalCredentials();
		this._onDidChange.fire();
	}

	async refreshModelCatalog(): Promise<IModelCatalogStatus> {
		try {
			await this.catalog.refreshNow();
		} finally {
			// Provider discovery must refresh even when the public registry is unavailable.
			this.refreshProviderConnections();
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
		this.invalidateProvider(providerId);
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
			// An explicitly manual connection need not implement /models. Like a stored API key,
			// this means configured for use; the separate connection check still reports unverified.
			if (entry.custom && entry.dynamicModels === false && entry.defaultModel?.trim() && entry.baseUrl) {
				try {
					const url = new URL(entry.baseUrl);
					if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) { return true; }
				} catch { /* malformed manual endpoint is not usable */ }
			}
			// Local (Ollama/LM Studio/llama.cpp): "connected" = the server is listening.
			return this.probeLocalProvider(entry);
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

	private connectionSignature(entry: IProviderEntry): string {
		return JSON.stringify([entry.protocol, entry.auth, entry.baseUrl, entry.dynamicModels, entry.defaultModel, entry.extraHeaders]);
	}

	/** Bound both the request and response body, even if a transport ignores cancellation. */
	private async withConnectionTimeout<T>(operation: (token: CancellationToken) => Promise<T>, timeoutMs = 8_000): Promise<T> {
		const lifetime = this.connectionRequests.add(new DisposableStore());
		const cts = new CancellationTokenSource();
		lifetime.add(toDisposable(() => cts.dispose(true)));
		lifetime.add(disposableTimeout(() => cts.cancel(), timeoutMs));
		try {
			return await raceCancellationError(operation(cts.token), cts.token);
		} finally {
			this.connectionRequests.delete(lifetime);
		}
	}

	/** Checks a draft or saved connection without writing credentials or generating tokens. */
	async checkProviderConnection(entryOrId: IProviderEntry | string, apiKey?: string): Promise<IProviderConnectionCheck> {
		const entry = typeof entryOrId === 'string' ? this.findProvider(entryOrId) : entryOrId;
		if (!entry) { return { status: 'unverified', checkedAt: Date.now() }; }
		const { modalities: _modalities, ...result } = await this.discoverProviderModels(entry, apiKey);
		return result;
	}

	private async discoverProviderModels(entry: IProviderEntry, apiKey?: string, timeoutMs?: number): Promise<IProviderModelDiscovery> {
		try {
			return await this.withConnectionTimeout<IProviderModelDiscovery>(async token => {
				let credential: ICredential;
				try {
					if (apiKey !== undefined && entry.auth === 'apiKey') {
						const key = apiKey.trim();
						if (!key || /[\s\x00-\x1f\x7f]/.test(key)) { return { status: 'missing-credentials', checkedAt: Date.now() }; }
						credential = { kind: 'apiKey', value: key };
					} else {
						credential = await this.auth.resolveCredential(entry);
					}
				} catch {
					return { status: 'missing-credentials', checkedAt: Date.now() };
				}
				if (token.isCancellationRequested) { return { status: 'unreachable', checkedAt: Date.now() }; }
				const adapter = this.protocols.get(entry.protocol);
				if (adapter?.listModels) {
					const models = [...new Set(await adapter.listModels({ credential, providerId: entry.id, baseUrl: entry.baseUrl, extraHeaders: entry.extraHeaders, cloudCodeMetadata: entry.cloudCodeMetadata }, token))]
						.filter(id => typeof id === 'string' && id.length > 0).sort((a, b) => a.localeCompare(b));
					return { status: 'available', checkedAt: Date.now(), models };
				}
				if (!entry.baseUrl) { return { status: 'unverified', checkedAt: Date.now() }; }
				const base = entry.baseUrl.replace(/\/+$/, '');
				const url = `${base}${entry.protocol === 'anthropic' ? '/v1/models' : '/models'}`;
				const headers: Record<string, string> = { ...(entry.extraHeaders ?? {}) };
				const bearer = credential.kind === 'apiKey' ? credential.value : credential.token;
				if (entry.protocol === 'anthropic') {
					headers['anthropic-version'] = '2023-06-01';
					if (credential.kind === 'apiKey' && bearer) { headers['x-api-key'] = bearer; }
					else if (bearer) { headers['Authorization'] = `Bearer ${bearer}`; }
				} else if (bearer) { headers['Authorization'] = `Bearer ${bearer}`; }
				const ctx = await this.netRequests.request({ type: 'GET', url, headers, callSite: 'openideAgentModels' }, token);
				const statusCode = ctx.res.statusCode ?? 0;
				if (statusCode === 401 || statusCode === 403) { return { status: 'auth-error', checkedAt: Date.now(), statusCode }; }
				if (statusCode === 404 || statusCode === 405) { return { status: 'unverified', checkedAt: Date.now(), statusCode }; }
				if (statusCode < 200 || statusCode >= 300) { return { status: 'endpoint-error', checkedAt: Date.now(), statusCode }; }
				let discovery: unknown;
				try { discovery = JSON.parse(await asText(ctx) || ''); } catch { return { status: 'unverified', checkedAt: Date.now(), statusCode }; }
				const record = discovery && typeof discovery === 'object' ? discovery as Record<string, unknown> : undefined;
				if (!record || (!Array.isArray(record.data) && !Array.isArray(record.models) && (!record.models || typeof record.models !== 'object'))) {
					return { status: 'unverified', checkedAt: Date.now(), statusCode };
				}
				return { status: 'available', checkedAt: Date.now(), statusCode, models: modelIdsFromProviderResponse(discovery), modalities: modelModalitiesFromProviderResponse(discovery) };
			}, timeoutMs);
		} catch {
			// Network errors may contain URLs, request headers or server bodies. Expose only a kind.
			return { status: 'unreachable', checkedAt: Date.now() };
		}
	}

	/** A listening web server is not necessarily a usable model endpoint. Share simultaneous probes. */
	private async probeLocalProvider(entry: IProviderEntry): Promise<boolean> {
		const signature = this.connectionSignature(entry);
		const cached = this.localProbeCache.get(entry.id);
		if (cached?.signature === signature && Date.now() - cached.at < 5_000) { return cached.ok; }
		const pending = this.localProbes.get(entry.id);
		if (pending?.signature === signature) { return pending.promise; }
		const generation = this.discoveryGeneration;
		const id = ++this.connectionRequestId;
		const promise = (async () => {
			const result = await this.discoverProviderModels(entry, undefined, 1_500);
			const current = generation === this.discoveryGeneration && this.localProbes.get(entry.id)?.id === id;
			const ok = result.status === 'available';
			if (current) { this.localProbeCache.set(entry.id, { signature, at: Date.now(), ok }); }
			return current && ok;
		})();
		this.localProbes.set(entry.id, { signature, id, promise });
		try { return await promise; }
		finally { if (this.localProbes.get(entry.id)?.promise === promise) { this.localProbes.delete(entry.id); } }
	}

	/** Live models win; registry/defaults remain available when discovery cannot answer. */
	async resolveProviderModels(entry: IProviderEntry): Promise<string[]> {
		await this.catalog.ensureFresh();
		// The Codex subscription endpoint can omit a model that the user has already selected
		// (for example while the account-scoped catalogue catches up with a rollout). The picker
		// deliberately keeps that selection visible. Build and the turn runner must see the same
		// choice; the actual response endpoint remains the authority on whether it can run.
		const withSelectedCodexModel = (models: string[]): string[] => {
			const selected = entry.protocol === 'codex' ? this.modelForProvider(entry.id) : '';
			return selected && !models.includes(selected) ? [...models, selected] : models;
		};
		const fallback = (): string[] => {
			const known = this.catalog.modelsFor(entry.id);
			if (known.length) { return withSelectedCodexModel(entry.defaultModel && !known.includes(entry.defaultModel) ? [entry.defaultModel, ...known] : known); }
			return withSelectedCodexModel(entry.defaultModel ? [entry.defaultModel] : []);
		};
		const adapter = this.protocols.get(entry.protocol);
		const genericDiscovery = !!entry.baseUrl && (entry.dynamicModels === true || (!entry.custom && (entry.protocol === 'openai' || entry.protocol === 'openai-responses')));
		if (!adapter?.listModels && !genericDiscovery) { return fallback(); }
		const signature = this.connectionSignature(entry);
		const cached = this.dynamicModelsCache.get(entry.id);
		if (cached?.signature === signature && Date.now() - cached.fetchedAt < cached.ttl) { return withSelectedCodexModel([...cached.models]); }
		const pending = this.pendingModels.get(entry.id);
		if (pending?.signature === signature) { return withSelectedCodexModel([...await pending.promise]); }
		const generation = this.discoveryGeneration;
		const id = ++this.connectionRequestId;
		const promise = (async () => {
			const discovery = await this.discoverProviderModels(entry);
			const models = discovery.status === 'available' ? [...(discovery.models ?? [])] : fallback();
			if (generation === this.discoveryGeneration && this.pendingModels.get(entry.id)?.id === id) {
				this.dynamicModelsCache.set(entry.id, { signature, models, fetchedAt: Date.now(), ttl: discovery.status === 'available' ? 30 * 60_000 : 5_000, modalities: discovery.modalities });
				return withSelectedCodexModel([...models]);
			}
			return fallback();
		})();
		this.pendingModels.set(entry.id, { signature, id, promise });
		try { return await promise; }
		finally { if (this.pendingModels.get(entry.id)?.promise === promise) { this.pendingModels.delete(entry.id); } }
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
				// Keep a persisted/manual value visible even if discovery changes. For Codex the
				// resolver already includes the selected model so Build and runtime agree with the picker.
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
