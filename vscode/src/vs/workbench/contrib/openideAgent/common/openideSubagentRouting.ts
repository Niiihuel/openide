/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — contracts and pure model-routing engine for subagents.
 *--------------------------------------------------------------------------------------------*/

export const SUBAGENT_ROUTING_POLICY_VERSION = 1;

export type SubagentTaskProfile = 'planning' | 'debug' | 'implementation' | 'review' | 'simple-fix' | 'research' | 'general';
export type SubagentRoutingPreset = 'manual' | 'quality' | 'balanced' | 'savings';
export type SubagentTargetHealthStatus = 'available' | 'cooldown' | 'auth' | 'billing' | 'rate-limit' | 'model-not-found' | 'provider-unavailable';

export interface ISubagentRoutingTarget {
	readonly providerId: string;
	readonly model: string;
	readonly enabled: boolean;
	readonly quality?: number;
	readonly cost?: number;
	readonly latency?: number;
	readonly requiresReasoning?: boolean;
	readonly requiresVision?: boolean;
	readonly minimumContextTokens?: number;
	/** Allows custom targets whose models cannot be discovered through an API. */
	readonly allowUnknownModel?: boolean;
}

export interface ISubagentRoutingWeights {
	readonly quality: number;
	readonly cost: number;
	readonly latency: number;
}

export interface ISubagentRoutingProfilePolicy {
	readonly weights: ISubagentRoutingWeights;
	readonly targets: readonly ISubagentRoutingTarget[];
}

export interface ISubagentRoutingPolicy {
	readonly version: 1;
	readonly preset: SubagentRoutingPreset;
	readonly maxAttempts: number;
	readonly fallbackEnabled: boolean;
	readonly profiles: Readonly<Partial<Record<SubagentTaskProfile, ISubagentRoutingProfilePolicy>>>;
}

export interface ISubagentTargetHealth {
	readonly providerId: string;
	readonly model: string;
	readonly status: SubagentTargetHealthStatus;
	readonly reason?: string;
	readonly until?: number;
	readonly updatedAt: number;
}

export interface ISubagentRoutingAttempt {
	readonly providerId: string;
	readonly model: string;
	readonly attempt: number;
	readonly startedAt: number;
	readonly completedAt?: number;
	readonly outcome?: 'completed' | 'failed' | 'cancelled';
	readonly errorKind?: string;
	readonly errorReason?: string;
	readonly emittedOutput?: boolean;
	readonly producedSideEffects?: boolean;
}

export interface ISubagentRoutingCandidateDecision {
	readonly providerId: string;
	readonly model: string;
	readonly eligible: boolean;
	readonly score?: number;
	readonly reason?: string;
}

export interface ISubagentRoutingDecision {
	readonly profile: SubagentTaskProfile;
	readonly reason: string;
	readonly createdAt: number;
	readonly candidates: readonly ISubagentRoutingCandidateDecision[];
	readonly selected?: ISubagentRoutingTarget;
}

export interface ISubagentRoutingCapabilities {
	readonly reasoning?: boolean;
	readonly vision?: boolean;
	readonly contextLimit?: number;
	readonly toolCalling?: boolean;
}

export interface ISubagentRoutingAvailability {
	readonly connected: boolean;
	readonly knownModels?: readonly string[];
	readonly capabilities?: ISubagentRoutingCapabilities;
	readonly health?: ISubagentTargetHealth;
}

export interface ISubagentRoutingRequirements {
	readonly reasoning?: boolean;
	readonly vision?: boolean;
	readonly minimumContextTokens?: number;
}

export interface ISubagentTaskClassificationInput {
	readonly explicitProfile?: string;
	readonly origin?: 'review' | 'delegation' | 'manual' | 'legacy';
	readonly readonly?: boolean;
	readonly writable?: boolean;
	readonly tools?: readonly string[];
	readonly task: string;
}

export interface ISubagentPolicyParseResult {
	readonly policy: ISubagentRoutingPolicy;
	readonly diagnostics: readonly string[];
}

const PROFILES: readonly SubagentTaskProfile[] = ['planning', 'debug', 'implementation', 'review', 'simple-fix', 'research', 'general'];
const PRESETS: readonly SubagentRoutingPreset[] = ['manual', 'quality', 'balanced', 'savings'];
export const SUBAGENT_ROUTING_PRESET_WEIGHTS: Readonly<Record<SubagentRoutingPreset, ISubagentRoutingWeights>> = {
	manual: { quality: 0, cost: 0, latency: 0 },
	quality: { quality: 1, cost: 0.1, latency: 0.1 },
	balanced: { quality: 0.6, cost: 0.25, latency: 0.15 },
	savings: { quality: 0.25, cost: 0.6, latency: 0.15 },
};

export const DEFAULT_SUBAGENT_ROUTING_POLICY: ISubagentRoutingPolicy = Object.freeze({
	version: SUBAGENT_ROUTING_POLICY_VERSION,
	preset: 'balanced',
	maxAttempts: 3,
	fallbackEnabled: true,
	profiles: Object.freeze({}),
});

export function subagentTargetKey(target: Pick<ISubagentRoutingTarget, 'providerId' | 'model'>): string {
	return `${target.providerId}\u0000${target.model}`;
}

function finiteScore(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function parseTarget(value: unknown, diagnostics: string[], path: string): ISubagentRoutingTarget | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) { diagnostics.push(`${path} debe ser un objeto.`); return undefined; }
	const raw = value as Record<string, unknown>;
	const providerId = typeof raw.providerId === 'string' ? raw.providerId.trim() : '';
	const model = typeof raw.model === 'string' ? raw.model.trim() : '';
	if (!providerId || !model) { diagnostics.push(`${path} necesita providerId y model.`); return undefined; }
	return {
		providerId, model, enabled: raw.enabled !== false,
		...(finiteScore(raw.quality) !== undefined ? { quality: finiteScore(raw.quality) } : {}),
		...(finiteScore(raw.cost) !== undefined ? { cost: finiteScore(raw.cost) } : {}),
		...(finiteScore(raw.latency) !== undefined ? { latency: finiteScore(raw.latency) } : {}),
		...(raw.requiresReasoning === true ? { requiresReasoning: true } : {}),
		...(raw.requiresVision === true ? { requiresVision: true } : {}),
		...(typeof raw.minimumContextTokens === 'number' && Number.isFinite(raw.minimumContextTokens) ? { minimumContextTokens: Math.max(0, Math.floor(raw.minimumContextTokens)) } : {}),
		...(raw.allowUnknownModel === true ? { allowUnknownModel: true } : {}),
	};
}

export function parseSubagentRoutingPolicy(value: unknown): ISubagentPolicyParseResult {
	const diagnostics: string[] = [];
	if (!value || typeof value !== 'object' || Array.isArray(value)) { return { policy: DEFAULT_SUBAGENT_ROUTING_POLICY, diagnostics: value === undefined ? [] : ['La policy debe ser un objeto.'] }; }
	const raw = value as Record<string, unknown>;
	if (raw.version !== undefined && raw.version !== 1) { diagnostics.push(`Versión de policy no soportada: ${String(raw.version)}.`); }
	const preset = PRESETS.includes(raw.preset as SubagentRoutingPreset) ? raw.preset as SubagentRoutingPreset : 'balanced';
	if (raw.preset !== undefined && !PRESETS.includes(raw.preset as SubagentRoutingPreset)) { diagnostics.push(`Preset inválido: ${String(raw.preset)}.`); }
	const profiles: Partial<Record<SubagentTaskProfile, ISubagentRoutingProfilePolicy>> = {};
	const rawProfiles = raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles) ? raw.profiles as Record<string, unknown> : {};
	for (const profile of PROFILES) {
		const candidate = rawProfiles[profile];
		if (candidate === undefined) { continue; }
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) { diagnostics.push(`profiles.${profile} debe ser un objeto.`); continue; }
		const record = candidate as Record<string, unknown>;
		const base = SUBAGENT_ROUTING_PRESET_WEIGHTS[preset];
		const rawWeights = record.weights && typeof record.weights === 'object' ? record.weights as Record<string, unknown> : {};
		const weights = {
			quality: finiteScore(rawWeights.quality) ?? base.quality,
			cost: finiteScore(rawWeights.cost) ?? base.cost,
			latency: finiteScore(rawWeights.latency) ?? base.latency,
		};
		const targets: ISubagentRoutingTarget[] = [];
		const seen = new Set<string>();
		for (const [index, item] of (Array.isArray(record.targets) ? record.targets : []).entries()) {
			const target = parseTarget(item, diagnostics, `profiles.${profile}.targets[${index}]`);
			if (!target) { continue; }
			const key = subagentTargetKey(target);
			if (seen.has(key)) { diagnostics.push(`Target duplicado en ${profile}: ${target.providerId}/${target.model}.`); continue; }
			seen.add(key); targets.push(target);
		}
		profiles[profile] = { weights, targets };
	}
	return {
		policy: {
			version: 1, preset,
			maxAttempts: typeof raw.maxAttempts === 'number' && Number.isFinite(raw.maxAttempts) ? Math.max(1, Math.min(10, Math.floor(raw.maxAttempts))) : 3,
			fallbackEnabled: raw.fallbackEnabled !== false,
			profiles,
		},
		diagnostics,
	};
}

export function classifySubagentTask(input: ISubagentTaskClassificationInput): { profile: SubagentTaskProfile; reason: string } {
	if (PROFILES.includes(input.explicitProfile as SubagentTaskProfile)) { return { profile: input.explicitProfile as SubagentTaskProfile, reason: 'perfil explícito de la definición' }; }
	if (input.origin === 'review') { return { profile: 'review', reason: 'origen review_changes' }; }
	if (input.writable || input.readonly === false) { return { profile: 'implementation', reason: 'subagente con escritura' }; }
	const task = input.task.toLowerCase();
	if (/\b(debug|depur|diagnostic|root cause|causa ra[ií]z|reproduc|stack trace|falla|error)\b/.test(task)) { return { profile: 'debug', reason: 'señales de diagnóstico en la tarea' }; }
	if (/\b(plan|planific|arquitect|diseñ|design|contrato|migraci)/.test(task)) { return { profile: 'planning', reason: 'señales de planificación en la tarea' }; }
	if (/\b(review|revis|audit|regresi|vulnerab|seguridad)\b/.test(task)) { return { profile: 'review', reason: 'señales de revisión en la tarea' }; }
	if (/\b(correg|fix|typo|ajuste simple|cambio menor)\b/.test(task) && task.length < 800) { return { profile: 'simple-fix', reason: 'corrección acotada' }; }
	if (input.readonly === true || /\b(investig|explor|busc|analiz|research)\b/.test(task)) { return { profile: 'research', reason: 'subagente de investigación' }; }
	return { profile: 'general', reason: 'sin señales específicas' };
}

function rejectReason(target: ISubagentRoutingTarget, availability: ISubagentRoutingAvailability | undefined, requirements: ISubagentRoutingRequirements, now: number): string | undefined {
	if (!target.enabled) { return 'deshabilitado'; }
	if (!availability?.connected) { return 'provider desconectado'; }
	if (availability.health && availability.health.status !== 'available' && (!availability.health.until || availability.health.until > now)) { return `health: ${availability.health.status}`; }
	if (availability.knownModels !== undefined && !target.allowUnknownModel && !availability.knownModels.includes(target.model)) { return 'modelo no disponible'; }
	const caps = availability.capabilities;
	if (caps?.toolCalling === false) { return 'modelo sin function calling'; }
	if ((requirements.reasoning || target.requiresReasoning) && caps?.reasoning !== true) { return 'requiere reasoning'; }
	if ((requirements.vision || target.requiresVision) && caps?.vision !== true) { return 'requiere visión'; }
	const minimum = Math.max(requirements.minimumContextTokens ?? 0, target.minimumContextTokens ?? 0);
	if (minimum && (caps?.contextLimit ?? 0) < minimum) { return `contexto menor a ${minimum}`; }
	return undefined;
}

export function scoreSubagentTargets(
	profile: SubagentTaskProfile,
	policy: ISubagentRoutingPolicy,
	availability: ReadonlyMap<string, ISubagentRoutingAvailability>,
	requirements: ISubagentRoutingRequirements = {},
	tried: ReadonlySet<string> = new Set(),
	now = Date.now(),
): ISubagentRoutingDecision {
	const configured = policy.profiles[profile] ?? policy.profiles.general;
	if (!configured) { return { profile, reason: 'perfil sin targets configurados', createdAt: now, candidates: [] }; }
	const candidates = configured.targets.map((target, index) => {
		const key = subagentTargetKey(target);
		const reason = tried.has(key) ? 'ya intentado' : rejectReason(target, availability.get(key), requirements, now);
		const quality = target.quality ?? 0;
		const cost = target.cost ?? 0;
		const latency = target.latency ?? 0;
		const score = configured.weights.quality * quality - configured.weights.cost * cost - configured.weights.latency * latency - index * 1e-9;
		const decision: ISubagentRoutingCandidateDecision = { providerId: target.providerId, model: target.model, eligible: !reason, ...(!reason ? { score } : { reason }) };
		return { target, decision };
	});
	const selected = candidates.filter(item => item.decision.eligible).sort((a, b) => (b.decision.score ?? 0) - (a.decision.score ?? 0))[0]?.target;
	return { profile, reason: selected ? 'mejor score elegible' : 'sin targets elegibles', createdAt: now, candidates: candidates.map(item => item.decision), selected };
}
