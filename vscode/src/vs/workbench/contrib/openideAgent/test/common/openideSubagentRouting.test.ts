/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import {
	classifySubagentTask,
	parseSubagentRoutingPolicy,
	scoreSubagentTargets,
	subagentTargetKey,
} from '../../common/openideSubagentRouting.js';

suite('OpenIDE subagent routing', () => {
	test('parses versioned policies and rejects duplicate targets', () => {
		const parsed = parseSubagentRoutingPolicy({
			version: 1,
			preset: 'balanced',
			maxAttempts: 99,
			profiles: {
				planning: {
					weights: { quality: 0.8, cost: 0.1, latency: 0.1 },
					targets: [
						{ providerId: 'gpt', model: 'sol', enabled: true, quality: 1, cost: 0.7 },
						{ providerId: 'gpt', model: 'sol', enabled: true },
					],
				},
			},
		});
		assert.strictEqual(parsed.policy.version, 1);
		assert.strictEqual(parsed.policy.maxAttempts, 10);
		assert.strictEqual(parsed.policy.profiles.planning?.targets.length, 1);
		assert.ok(parsed.diagnostics.some(item => item.includes('duplicado')));
	});

	test('classifies explicit, review, writable and heuristic tasks deterministically', () => {
		assert.strictEqual(classifySubagentTask({ explicitProfile: 'simple-fix', task: 'anything' }).profile, 'simple-fix');
		assert.strictEqual(classifySubagentTask({ origin: 'review', task: 'anything' }).profile, 'review');
		assert.strictEqual(classifySubagentTask({ writable: true, task: 'anything' }).profile, 'implementation');
		assert.strictEqual(classifySubagentTask({ readonly: true, task: 'Diagnosticá la causa raíz del error' }).profile, 'debug');
		assert.strictEqual(classifySubagentTask({ readonly: true, task: 'Diseñá la arquitectura' }).profile, 'planning');
		assert.strictEqual(classifySubagentTask({ readonly: true, task: 'Investigá usos del símbolo' }).profile, 'research');
	});

	test('filters disconnected, cooldown, unknown and incapable targets before stable scoring', () => {
		const { policy } = parseSubagentRoutingPolicy({
			version: 1,
			profiles: {
				planning: {
					weights: { quality: 1, cost: 0.5, latency: 0 },
					targets: [
						{ providerId: 'gpt', model: 'sol', enabled: true, quality: 1, cost: 0.4 },
						{ providerId: 'terra', model: 'writer', enabled: true, quality: 0.8, cost: 0.1 },
						{ providerId: 'luna', model: 'cheap', enabled: true, quality: 0.6, cost: 0 },
					],
				},
			},
		});
		const availability = new Map([
			[subagentTargetKey({ providerId: 'gpt', model: 'sol' }), { connected: true, knownModels: ['sol'], capabilities: { reasoning: true, contextLimit: 200_000 } }],
			[subagentTargetKey({ providerId: 'terra', model: 'writer' }), { connected: true, knownModels: ['writer'], capabilities: { reasoning: false, contextLimit: 200_000, toolCalling: false } }],
			[subagentTargetKey({ providerId: 'luna', model: 'cheap' }), { connected: false }],
		]);
		const decision = scoreSubagentTargets('planning', policy, availability, { reasoning: true, minimumContextTokens: 100_000 });
		assert.deepStrictEqual(decision.selected && [decision.selected.providerId, decision.selected.model], ['gpt', 'sol']);
		assert.strictEqual(decision.candidates.find(item => item.providerId === 'terra')?.reason, 'modelo sin function calling');
		assert.strictEqual(decision.candidates.find(item => item.providerId === 'luna')?.reason, 'provider desconectado');
	});

	test('never selects a tried target and uses manual order as a stable tie break', () => {
		const { policy } = parseSubagentRoutingPolicy({ version: 1, preset: 'manual', profiles: { general: { targets: [
			{ providerId: 'first', model: 'same', enabled: true },
			{ providerId: 'second', model: 'same', enabled: true },
		] } } });
		const availability = new Map([
			[subagentTargetKey({ providerId: 'first', model: 'same' }), { connected: true, knownModels: ['same'] }],
			[subagentTargetKey({ providerId: 'second', model: 'same' }), { connected: true, knownModels: ['same'] }],
		]);
		assert.strictEqual(scoreSubagentTargets('general', policy, availability).selected?.providerId, 'first');
		const tried = new Set([subagentTargetKey({ providerId: 'first', model: 'same' })]);
		assert.strictEqual(scoreSubagentTargets('general', policy, availability, {}, tried).selected?.providerId, 'second');
	});
});
