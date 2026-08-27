/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — policy, selection and health/cooldowns for subagent routing.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import {
	DEFAULT_SUBAGENT_ROUTING_POLICY,
	ISubagentRoutingAvailability,
	ISubagentRoutingDecision,
	ISubagentRoutingPolicy,
	ISubagentRoutingRequirements,
	ISubagentRoutingTarget,
	ISubagentTargetHealth,
	parseSubagentRoutingPolicy,
	scoreSubagentTargets,
	SubagentTargetHealthStatus,
	SubagentTaskProfile,
	SUBAGENT_ROUTING_PRESET_WEIGHTS,
	subagentTargetKey,
} from '../common/openideSubagentRouting.js';
import { IClassifiedProviderError } from '../common/openideErrorClassifier.js';

const HEALTH_STORAGE_KEY = 'openide.subagents.routing.health.v1';
const POLICY_SETTING = 'openide.subagents.routing.policy';
const ENABLED_SETTING = 'openide.subagents.routing.enabled';

export const ISubagentRoutingService = createDecorator<ISubagentRoutingService>('openideSubagentRoutingService');

export type SubagentRoutingAvailabilityBackend = (targets: readonly ISubagentRoutingTarget[]) => Promise<ReadonlyMap<string, ISubagentRoutingAvailability>>;

export interface ISubagentRoutingService {
	readonly _serviceBrand: undefined;
	isEnabled(): boolean;
	policy(): ISubagentRoutingPolicy;
	policyDiagnostics(): readonly string[];
	setAvailabilityBackend(backend: SubagentRoutingAvailabilityBackend): void;
	decide(profile: SubagentTaskProfile, requirements?: ISubagentRoutingRequirements, tried?: ReadonlySet<string>): Promise<ISubagentRoutingDecision>;
	listHealth(): readonly ISubagentTargetHealth[];
	healthFor(target: Pick<ISubagentRoutingTarget, 'providerId' | 'model'>): ISubagentTargetHealth | undefined;
	recordFailure(target: Pick<ISubagentRoutingTarget, 'providerId' | 'model'>, error: IClassifiedProviderError, now?: number): ISubagentTargetHealth;
	recordSuccess(target: Pick<ISubagentRoutingTarget, 'providerId' | 'model'>, now?: number): void;
	clearHealth(providerId?: string): void;
}

export class SubagentRoutingService implements ISubagentRoutingService {
	declare readonly _serviceBrand: undefined;
	private readonly health = new Map<string, ISubagentTargetHealth>();
	private availabilityBackend: SubagentRoutingAvailabilityBackend | undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
	) { this.loadHealth(); }

	isEnabled(): boolean { return this.configurationService.getValue<boolean>(ENABLED_SETTING) === true; }

	private parsedPolicy() {
		const configured = this.configurationService.getValue<unknown>(POLICY_SETTING);
		const parsed = configured === undefined ? { policy: DEFAULT_SUBAGENT_ROUTING_POLICY, diagnostics: [] as string[] } : parseSubagentRoutingPolicy(configured);
		const rawPreset = this.configurationService.getValue<unknown>('openide.subagents.routing.preset');
		const preset = rawPreset === 'manual' || rawPreset === 'quality' || rawPreset === 'balanced' || rawPreset === 'savings' ? rawPreset : parsed.policy.preset;
		const maxAttempts = Number(this.configurationService.getValue('openide.subagents.routing.maxAttempts'));
		// Explicit weights from a manual policy are authoritative. For automatic presets,
		// apply the override only when the external selector really changed preset.
		const overridePresetWeights = parsed.policy.preset !== 'manual' && preset !== 'manual' && preset !== parsed.policy.preset;
		const profiles = overridePresetWeights
			? Object.fromEntries(Object.entries(parsed.policy.profiles).map(([profile, value]) => [profile, value ? { ...value, weights: SUBAGENT_ROUTING_PRESET_WEIGHTS[preset] } : value]))
			: parsed.policy.profiles;
		return { ...parsed, policy: { ...parsed.policy, preset, profiles, ...(Number.isFinite(maxAttempts) ? { maxAttempts: Math.max(1, Math.min(10, Math.floor(maxAttempts))) } : {}) } };
	}

	policy(): ISubagentRoutingPolicy { return this.parsedPolicy().policy; }
	policyDiagnostics(): readonly string[] { return this.parsedPolicy().diagnostics; }
	setAvailabilityBackend(backend: SubagentRoutingAvailabilityBackend): void { this.availabilityBackend = backend; }

	async decide(profile: SubagentTaskProfile, requirements: ISubagentRoutingRequirements = {}, tried: ReadonlySet<string> = new Set()): Promise<ISubagentRoutingDecision> {
		const now = Date.now();
		const policy = this.policy();
		const configured = policy.profiles[profile] ?? policy.profiles.general;
		const availability = this.availabilityBackend && configured ? await this.availabilityBackend(configured.targets) : new Map<string, ISubagentRoutingAvailability>();
		const enriched = new Map<string, ISubagentRoutingAvailability>();
		for (const [key, value] of availability) {
			enriched.set(key, { ...value, health: this.activeHealth(this.health.get(key), now) });
		}
		return scoreSubagentTargets(profile, policy, enriched, requirements, tried, now);
	}

	listHealth(): readonly ISubagentTargetHealth[] {
		const now = Date.now();
		return Object.freeze([...this.health.values()].map(item => this.activeHealth(item, now)).filter((item): item is ISubagentTargetHealth => !!item).sort((a, b) => b.updatedAt - a.updatedAt));
	}

	healthFor(target: Pick<ISubagentRoutingTarget, 'providerId' | 'model'>): ISubagentTargetHealth | undefined {
		return this.activeHealth(this.health.get(subagentTargetKey(target)), Date.now());
	}

	recordFailure(target: Pick<ISubagentRoutingTarget, 'providerId' | 'model'>, error: IClassifiedProviderError, now = Date.now()): ISubagentTargetHealth {
		const status = this.healthStatus(error);
		const until = this.cooldownUntil(error, now);
		const health: ISubagentTargetHealth = { providerId: target.providerId, model: target.model, status, reason: error.reason, ...(until ? { until } : {}), updatedAt: now };
		this.health.set(subagentTargetKey(target), health); this.persistHealth();
		return health;
	}

	recordSuccess(target: Pick<ISubagentRoutingTarget, 'providerId' | 'model'>, now = Date.now()): void {
		this.health.set(subagentTargetKey(target), { providerId: target.providerId, model: target.model, status: 'available', updatedAt: now });
		this.persistHealth();
	}

	clearHealth(providerId?: string): void {
		if (!providerId) { this.health.clear(); }
		else { for (const [key, item] of this.health) { if (item.providerId === providerId) { this.health.delete(key); } } }
		this.persistHealth();
	}

	private activeHealth(health: ISubagentTargetHealth | undefined, now: number): ISubagentTargetHealth | undefined {
		if (!health) { return undefined; }
		if (health.until && health.until <= now) { return { ...health, status: 'available', reason: undefined, until: undefined, updatedAt: now }; }
		return health;
	}

	private healthStatus(error: IClassifiedProviderError): SubagentTargetHealthStatus {
		if (error.kind === 'auth') { return 'auth'; }
		if (error.kind === 'billing') { return 'billing'; }
		if (error.kind === 'rate-limit') { return 'rate-limit'; }
		if (error.reason === 'model-not-found' || error.reason === 'model-retired') { return 'model-not-found'; }
		if (error.reason === 'provider-unavailable' || error.reason === 'project-not-found') { return 'provider-unavailable'; }
		return 'cooldown';
	}

	private cooldownUntil(error: IClassifiedProviderError, now: number): number | undefined {
		if (error.kind === 'auth' || error.kind === 'billing' || error.reason === 'project-not-found') { return undefined; }
		if (error.reason === 'model-not-found' || error.reason === 'model-retired' || error.reason === 'provider-unavailable') { return now + 24 * 60 * 60_000; }
		if (error.kind === 'rate-limit') { return now + (error.retryAfterMs ?? 5 * 60_000); }
		return now + 60_000;
	}

	private loadHealth(): void {
		const raw = this.storageService.get(HEALTH_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) { return; }
		try {
			const parsed = JSON.parse(raw);
			for (const candidate of Array.isArray(parsed?.targets) ? parsed.targets : []) {
				if (candidate && typeof candidate.providerId === 'string' && typeof candidate.model === 'string' && typeof candidate.updatedAt === 'number') {
					this.health.set(subagentTargetKey(candidate), candidate as ISubagentTargetHealth);
				}
			}
		} catch { /* storage corrupto: health vacío */ }
	}

	private persistHealth(): void {
		const targets = [...this.health.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 300);
		this.storageService.store(HEALTH_STORAGE_KEY, JSON.stringify({ targets }), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
