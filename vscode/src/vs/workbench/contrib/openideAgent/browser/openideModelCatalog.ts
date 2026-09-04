/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — model catalog, mirroring how opencode consumes models.dev.
 *
 *  The registry is stored VERBATIM (`api.json` as published) in a cache file, exactly like
 *  opencode's `~/.cache/opencode/models.json`, and models resolve by EXACT `provider/model`
 *  match. No compaction, no renaming, no silent id rewriting: a field models.dev adds tomorrow
 *  is readable here without touching this file, and a miss is reported as a miss (with
 *  suggestions) instead of being guessed into the wrong model's limits.
 *
 *  The one exception is Antigravity, a gateway that mints ids models.dev does not publish
 *  (`gemini-3.6-flash-high`, `claude-opus-4-6-thinking`). Its translation table lives in
 *  `antigravityCatalogRef` and applies to that provider only — see the note there.
 *
 *  OpenIDE keeps no model list of its own: every hand-written table went stale (the Copilot
 *  entry listed 7 models while the registry published 33).
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { listenStream } from '../../../../base/common/stream.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IRequestService } from '../../../../platform/request/common/request.js';

/** One model exactly as models.dev publishes it. Field names mirror api.json on purpose. */
export interface IModelsDevModel {
	readonly id?: string;
	readonly name?: string;
	readonly family?: string;
	readonly description?: string;
	readonly attachment?: boolean;
	readonly reasoning?: boolean;
	readonly tool_call?: boolean;
	readonly temperature?: boolean;
	readonly structured_output?: boolean;
	readonly open_weights?: boolean;
	readonly experimental?: boolean;
	readonly knowledge?: string;
	readonly release_date?: string;
	readonly last_updated?: string;
	/** `deprecated` hides the model from the picker; `beta` is shown as-is. */
	readonly status?: string;
	readonly modalities?: { readonly input?: string[]; readonly output?: string[] };
	readonly limit?: { readonly context?: number; readonly input?: number; readonly output?: number };
	readonly cost?: { readonly input?: number; readonly output?: number; readonly cache_read?: number; readonly cache_write?: number };
	readonly reasoning_options?: ReadonlyArray<{ readonly type?: string; readonly values?: string[] }>;
}

export interface IModelsDevProvider {
	readonly id?: string;
	readonly name?: string;
	readonly doc?: string;
	readonly api?: string;
	readonly npm?: string;
	readonly env?: string[];
	readonly models?: Record<string, IModelsDevModel>;
}

export type ModelsDevCatalog = Record<string, IModelsDevProvider>;

/** Limits and capabilities of a model, as the agent loop needs them. */
export interface IModelLimits {
	readonly contextLimit?: number;
	readonly inputLimit?: number;
	readonly outputLimit?: number;
	readonly vision?: boolean;
	readonly reasoning?: boolean;
	/** `false` means the model cannot invoke client functions. */
	readonly toolCalling?: boolean;
}

/** Reasoning controls the model publishes (`reasoning_options`). */
export interface IModelReasoning {
	/** Effort levels accepted, in registry order. Empty when the model only exposes a toggle. */
	readonly efforts: readonly string[];
	/** `true` when thinking is on/off instead of graded. */
	readonly toggle: boolean;
}

/** Conservative internal budget for compaction when the provider publishes no limits.
 *  It is not presented as a confirmed model capability. */
export const DEFAULT_CONTEXT_LIMIT = 120000;

const CATALOG_URL = 'https://models.dev/api.json';
const CACHE_FILE = 'models.json';
/** opencode re-reads every 5 minutes because each CLI run is a fresh process. An IDE session is
 *  long-lived, so a few hours keeps the list current without re-downloading 4MB all day. */
const TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

/** OpenIDE provider → models.dev provider. Several OpenIDE entries share one registry provider
 *  (an API-key entry and its OAuth twin reach the same models). */
export function providerCatalogId(providerId: string): string | undefined {
	const id = providerId.toLowerCase();
	if (id === 'openai-codex' || id === 'openai') { return 'openai'; }
	if (id === 'copilot') { return 'github-copilot'; }
	if (id === 'xai-oauth' || id === 'xai') { return 'xai'; }
	if (id === 'gemini') { return 'google'; }
	if (id === 'openrouter') { return 'openrouter'; }
	if (id === 'zhipu') { return 'zai'; }
	if (id === 'zhipu-coding') { return 'zai-coding-plan'; }
	if (id === 'nvidia-nim') { return 'nvidia'; }
	if (id === 'moonshot') { return 'moonshotai'; }
	if (id === 'dashscope') { return 'alibaba'; }
	if (id === 'together') { return 'togetherai'; }
	if (id === 'fireworks') { return 'fireworks-ai'; }
	if (id === 'minimax-oauth') { return 'minimax'; }
	return ['anthropic', 'deepseek', 'groq', 'mistral', 'minimax', 'cerebras', 'cohere', 'perplexity', 'lmstudio', 'opencode'].includes(id) ? id : undefined;
}

/** models.dev provider whose model list can be offered as this provider's catalog.
 *
 *  Only two kinds of provider are excluded, and both because something else already knows better:
 *   - `antigravity-oauth`, which models.dev does not publish at all and whose own
 *     `fetchAvailableModels` returns exactly what the account may reach;
 *   - local runtimes, which serve whatever the user happened to pull, so `GET /models` is the
 *     only truth and a registry list would be fiction.
 *
 *  Subscription backends (Codex, SuperGrok, MiniMax) DO list their upstream catalog. They serve a
 *  subset of it, so a few entries may be rejected at run time — but the alternative, which this
 *  function used to do, was to offer a single model and hide the rest, and the run path already
 *  reports an unavailable model with an actionable error. */
export function listableCatalogId(providerId: string): string | undefined {
	const id = providerId.toLowerCase();
	if (id === 'antigravity-oauth') {
		return undefined;
	}
	if (id === 'ollama' || id === 'vllm' || id === 'llamacpp' || id === 'jan' || id === 'lmstudio') {
		return undefined;
	}
	return providerCatalogId(providerId);
}

/**
 * Antigravity is the only provider that needs id translation, and it needs it because the gateway
 * invents ids: it appends the effort to the model (`gemini-3.6-flash-high`), renames models
 * (`gemini-pro-agent`) and serves three vendors under one endpoint. models.dev publishes no
 * `antigravity` provider, so without this every Antigravity model would show no limits at all.
 *
 * This is deliberately NOT a general normalizer. Every other provider resolves by exact id —
 * `claude-sonnet-4-5-20250929`, `gpt-5.6-sol` and `grok-4.20-multi-agent-0309` are all published
 * verbatim by the registry — and rewriting ids globally would silently map a model onto another
 * model's limits.
 */
function antigravityCatalogRef(model: string): { provider: string; model: string } | undefined {
	const id = model.trim().toLowerCase()
		.replace(/-(?:extra-low|low|medium|high|thinking)$/, '');
	if (id.includes('claude')) {
		// The gateway writes Claude versions with dashes, the registry with dashes too.
		return { provider: 'anthropic', model: id };
	}
	if (id.includes('gpt')) {
		return { provider: 'openai', model: id };
	}
	if (id === 'gemini-pro-agent') { return { provider: 'google', model: 'gemini-3.1-pro' }; }
	if (id === 'gemini-3-flash-agent') { return { provider: 'google', model: 'gemini-3.5-flash' }; }
	return { provider: 'google', model: id };
}

/** Resolves an OpenIDE (providerId, model) onto a registry coordinate. */
function catalogRef(providerId: string, model: string): { provider: string; model: string } | undefined {
	if (providerId.toLowerCase() === 'antigravity-oauth') {
		return antigravityCatalogRef(model);
	}
	const provider = providerCatalogId(providerId);
	return provider ? { provider, model: model.trim() } : undefined;
}

/** The models.dev catalog, verbatim. Pure: no network, no storage, no clock. */
/** A provider as the registry describes it — enough to reach it and to say what it is. */
export interface IRegistryProvider {
	readonly id: string;
	readonly name: string;
	/** Base URL of its OpenAI-compatible API. */
	readonly api: string;
	readonly doc?: string;
	/** Env vars the registry says carry its key — shown so the user knows which key this wants. */
	readonly env: readonly string[];
	readonly modelCount: number;
}

/** What the Providers page prints about the registry itself. */
export interface IModelCatalogStatus {
	/** Epoch ms of the copy in use, 0 when nothing has ever been downloaded. */
	readonly updatedAt: number;
	readonly providers: number;
	readonly models: number;
}

export class ModelRegistry {

	constructor(private readonly catalog: ModelsDevCatalog) { }

	get isEmpty(): boolean {
		return Object.keys(this.catalog).length === 0;
	}

	get raw(): ModelsDevCatalog {
		return this.catalog;
	}

	/** The registry entry for a model, or `undefined` when it publishes none. Exact match. */
	model(providerId: string, modelId: string): IModelsDevModel | undefined {
		const ref = catalogRef(providerId, modelId);
		if (!ref) {
			return undefined;
		}
		return this.catalog[ref.provider]?.models?.[ref.model];
	}

	limits(providerId: string, modelId: string): IModelLimits {
		const entry = this.model(providerId, modelId);
		if (!entry) {
			return {};
		}
		return {
			// `limit.input` is the usable prompt budget; `limit.context` also reserves output.
			contextLimit: entry.limit?.input ?? entry.limit?.context,
			inputLimit: entry.limit?.input,
			outputLimit: entry.limit?.output,
			vision: entry.modalities?.input?.includes('image') ?? false,
			reasoning: entry.reasoning === true,
			toolCalling: typeof entry.tool_call === 'boolean' ? entry.tool_call : undefined,
		};
	}

	/** Reasoning controls, or `undefined` when the model publishes none — which is also the
	 *  answer for an unknown model, so callers keep offering the full list. */
	reasoning(providerId: string, modelId: string): IModelReasoning | undefined {
		const options = this.model(providerId, modelId)?.reasoning_options;
		if (!options?.length) {
			return undefined;
		}
		let efforts: string[] = [];
		let toggle = false;
		for (const option of options) {
			if (option?.type === 'effort' && Array.isArray(option.values)) {
				const values = option.values.filter((v): v is string => typeof v === 'string' && v.length > 0);
				if (values.length) {
					efforts = values;
				}
			} else if (option?.type === 'toggle') {
				toggle = true;
			}
		}
		return efforts.length || toggle ? { efforts, toggle } : undefined;
	}

	/** Every non-deprecated model published for this provider, alphabetically. Empty when the
	 *  provider has no 1:1 registry counterpart. */
	/**
	 * Every provider the registry publishes that OpenIDE could actually reach: it names an `api`
	 * (the base URL) and serves at least one model that is not deprecated.
	 *
	 * models.dev publishes 213 providers; the product ships 31 curated entries. The rest are not
	 * missing capability — they are the same OpenAI-compatible protocol behind a different URL,
	 * which is exactly the shape this catalog was built for ("few protocols, many providers as
	 * data"). Handing that list to the UI is what turns them from "write the JSON yourself" into
	 * something the user can find.
	 */
	providers(): IRegistryProvider[] {
		const out: IRegistryProvider[] = [];
		for (const [id, provider] of Object.entries(this.catalog)) {
			const api = provider?.api;
			if (!id || typeof api !== 'string' || !api.startsWith('http')) {
				continue;
			}
			const models = Object.entries(provider.models ?? {}).filter(([, model]) => model?.status !== 'deprecated');
			if (!models.length) {
				continue;
			}
			out.push({ id, name: provider.name || id, api, doc: provider.doc, env: [...(provider.env ?? [])], modelCount: models.length });
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	modelsFor(providerId: string): string[] {
		const provider = listableCatalogId(providerId);
		const models = provider ? this.catalog[provider]?.models : undefined;
		if (!models) {
			return [];
		}
		return Object.entries(models)
			.filter(([, entry]) => entry?.status !== 'deprecated')
			.map(([id]) => id)
			.sort((a, b) => a.localeCompare(b));
	}

	/** Closest published ids for a model that did not resolve — opencode answers a lookup miss
	 *  with "Did you mean: …" rather than silently substituting a model. */
	suggestions(providerId: string, modelId: string, limit = 3): string[] {
		const ref = catalogRef(providerId, modelId);
		const models = ref ? this.catalog[ref.provider]?.models : undefined;
		if (!models || !ref) {
			return [];
		}
		const needle = ref.model.toLowerCase();
		return Object.keys(models)
			.map(id => ({ id, score: similarity(needle, id.toLowerCase()) }))
			.filter(candidate => candidate.score > 0.45)
			.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
			.slice(0, limit)
			.map(candidate => candidate.id);
	}
}

/** Dice coefficient over character bigrams — enough to power "did you mean" without pulling a
 *  fuzzy-search dependency into the workbench. */
function similarity(a: string, b: string): number {
	if (a === b) { return 1; }
	if (a.length < 2 || b.length < 2) { return 0; }
	const pairs = new Map<string, number>();
	for (let i = 0; i < a.length - 1; i++) {
		const pair = a.slice(i, i + 2);
		pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
	}
	let hits = 0;
	for (let i = 0; i < b.length - 1; i++) {
		const pair = b.slice(i, i + 2);
		const count = pairs.get(pair) ?? 0;
		if (count > 0) {
			pairs.set(pair, count - 1);
			hits++;
		}
	}
	return (2 * hits) / (a.length - 1 + b.length - 1);
}

/** Validates that a payload looks like models.dev's api.json before it replaces the cache. */
export function parseModelsDevCatalog(payload: unknown): ModelRegistry {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return new ModelRegistry({});
	}
	const catalog: ModelsDevCatalog = {};
	for (const [providerId, provider] of Object.entries(payload as Record<string, unknown>)) {
		if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
			continue;
		}
		const models = (provider as IModelsDevProvider).models;
		if (!models || typeof models !== 'object' || Array.isArray(models)) {
			continue;
		}
		catalog[providerId] = provider as IModelsDevProvider;
	}
	return new ModelRegistry(catalog);
}

function readAll(stream: VSBufferReadableStream): Promise<string> {
	return new Promise<string>(resolve => {
		let buf = '';
		listenStream(stream, {
			onData: (c: VSBuffer) => { buf += c.toString(); },
			onError: () => resolve(buf),
			onEnd: () => resolve(buf),
		});
	});
}

export class OpenideModelCatalog {

	private registry: ModelRegistry | undefined;
	private fetchedAt = 0;
	private refreshing: Promise<void> | undefined;
	private loading: Promise<void> | undefined;
	private readonly cacheFile: URI;

	constructor(
		private readonly requestService: IRequestService,
		private readonly fileService: IFileService,
		cacheHome: URI,
	) {
		this.cacheFile = joinPath(cacheHome, 'openide', CACHE_FILE);
	}

	/** Synchronous lookup against the loaded registry. It never fails; an empty result means
	 *  "unknown", which callers must not read as "unsupported". */
	lookup(model: string, providerId = ''): IModelLimits {
		return this.registry?.limits(providerId, model) ?? {};
	}

	contextLimitFor(model: string, providerId = ''): number | undefined {
		return this.lookup(model, providerId).contextLimit;
	}

	reasoningFor(model: string, providerId = ''): IModelReasoning | undefined {
		return this.registry?.reasoning(providerId, model);
	}

	/** Full registry entry, for the picker's detail panel (name, cost, modalities). */
	metadataFor(model: string, providerId = ''): IModelsDevModel | undefined {
		return this.registry?.model(providerId, model);
	}

	modelsFor(providerId: string): string[] {
		return this.registry?.modelsFor(providerId) ?? [];
	}

	/** Every reachable provider in the registry. Empty until `ensureFresh` has loaded a copy. */
	providers(): IRegistryProvider[] {
		return this.registry?.providers() ?? [];
	}

	/**
	 * The env var names this provider's key is published under. models.dev ships them for all 213
	 * providers, which is what lets the credential chain read the environment with no code per
	 * provider — the registry is the data.
	 */
	envNamesFor(registryId: string): readonly string[] {
		return this.registry?.raw[registryId]?.env ?? [];
	}

	/** Every name any provider uses, so the machine is read once instead of per provider. */
	allEnvNames(): readonly string[] {
		const names = new Set<string>();
		for (const provider of Object.values(this.registry?.raw ?? {})) {
			for (const name of provider?.env ?? []) { names.add(name); }
		}
		return [...names];
	}

	status(): IModelCatalogStatus {
		const providers = this.providers();
		return {
			updatedAt: this.fetchedAt,
			providers: providers.length,
			models: providers.reduce((total, provider) => total + provider.modelCount, 0),
		};
	}

	/**
	 * Downloads the registry now, ignoring the TTL. The Providers page is where someone goes when
	 * a model they just read about is missing, and until this existed the only answer was to wait
	 * up to six hours. Throws so the caller can say what went wrong instead of silently doing
	 * nothing — unlike `ensureFresh`, whose whole job is to never take a surface down.
	 */
	async refreshNow(): Promise<void> {
		if (this.refreshing) {
			return this.refreshing;
		}
		this.refreshing = this.refresh().finally(() => { this.refreshing = undefined; });
		return this.refreshing;
	}

	suggestionsFor(model: string, providerId = ''): string[] {
		return this.registry?.suggestions(providerId, model) ?? [];
	}

	/** Loads the cached catalog and refreshes it when stale. Never throws: with no cache and no
	 *  network the catalog simply answers nothing and callers fall back to live discovery. */
	async ensureFresh(): Promise<void> {
		if (!this.registry && !this.loading) {
			this.loading = this.loadFromCache().catch(() => { /* sin cache: se busca en red */ });
		}
		if (this.loading) {
			await this.loading;
			this.loading = undefined;
		}
		if ((Date.now() - this.fetchedAt) < TTL_MS && this.registry) {
			return;
		}
		if (!this.refreshing) {
			this.refreshing = this.refresh().catch(() => { /* sin red: seguimos con lo cacheado */ }).finally(() => {
				this.refreshing = undefined;
			});
		}
		return this.refreshing;
	}

	private async loadFromCache(): Promise<void> {
		const stat = await this.fileService.stat(this.cacheFile);
		const content = await this.fileService.readFile(this.cacheFile);
		const registry = parseModelsDevCatalog(JSON.parse(content.value.toString()));
		if (!registry.isEmpty) {
			this.registry = registry;
			this.fetchedAt = stat.mtime ?? 0;
		}
	}

	private async refresh(): Promise<void> {
		const ctx = await this.requestService.request({
			type: 'GET',
			callSite: 'openideAgent',
			url: CATALOG_URL,
			timeout: REQUEST_TIMEOUT_MS,
		}, CancellationToken.None);
		const status = ctx.res.statusCode ?? 0;
		if (status < 200 || status >= 300) {
			throw new Error(`HTTP ${status}`);
		}
		const body = await readAll(ctx.stream);
		const registry = parseModelsDevCatalog(JSON.parse(body));
		if (registry.isEmpty) {
			// Keeping the previous cache beats replacing it with nothing: a bad deploy upstream
			// would otherwise empty every picker until the next refresh.
			throw new Error('catálogo vacío');
		}
		this.registry = registry;
		this.fetchedAt = Date.now();
		// Written verbatim, like opencode's own cache: whatever the registry publishes is what a
		// later OpenIDE reads, with no field lost to a transformation done at write time.
		await this.fileService.writeFile(this.cacheFile, VSBuffer.fromString(body));
	}
}
