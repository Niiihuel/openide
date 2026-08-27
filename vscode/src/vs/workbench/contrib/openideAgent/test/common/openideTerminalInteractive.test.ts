/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isBackgroundTrayWorthy, shouldDetectAwaitingInput } from '../../browser/openideTools.js';
import {
	formatResetCountdown,
	normalizeAnthropicUsageJson,
	providerSupportsAnthropicUsage,
	usageBand,
} from '../../common/openideUsage.js';

suite('OpenIDE terminal interactive + usage', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detects awaiting-input only after min runtime + quiet after output', () => {
		const start = 1_000_000;
		// sin data → no
		assert.strictEqual(shouldDetectAwaitingInput({ now: start + 20_000, startTime: start, lastDataTime: 0 }), false);
		// data reciente (stream vivo) → no
		assert.strictEqual(shouldDetectAwaitingInput({
			now: start + 20_000,
			startTime: start,
			lastDataTime: start + 19_500,
		}), false);
		// short runtime even with silence → no
		assert.strictEqual(shouldDetectAwaitingInput({
			now: start + 8_000,
			startTime: start,
			lastDataTime: start + 100,
		}), false);
		// brief build pause (3s of silence at the 10s mark) → no (defaults 12s/6s)
		assert.strictEqual(shouldDetectAwaitingInput({
			now: start + 10_000,
			startTime: start,
			lastDataTime: start + 7_000,
		}), false);
		// runtime OK + silence OK → yes
		assert.strictEqual(shouldDetectAwaitingInput({
			now: start + 20_000,
			startTime: start,
			lastDataTime: start + 13_000,
		}), true);
	});

	test('background_persistent-worthy commands still qualify as tray-worthy for servers', () => {
		assert.strictEqual(isBackgroundTrayWorthy('npm run dev'), true);
		assert.strictEqual(isBackgroundTrayWorthy('git status'), false);
		assert.strictEqual(isBackgroundTrayWorthy('cat package.json'), false);
	});

	test('normalizes Anthropic oauth usage JSON into rate-limit windows', () => {
		const raw = {
			five_hour: { used_percent: 42.5, resets_at: 1_700_000_000 },
			seven_day: { usedPercent: 81, resetsAt: 1_700_100_000 },
		};
		const result = normalizeAnthropicUsageJson(raw, 'anthropic-oauth');
		assert.strictEqual(result.providerId, 'anthropic-oauth');
		assert.strictEqual(result.windows.length, 2);
		assert.strictEqual(result.windows[0].label, 'Session');
		assert.strictEqual(result.windows[0].usedPercent, 42.5);
		assert.strictEqual(result.windows[0].limitMinutes, 300);
		assert.ok(result.windows[0].resetsAt && result.windows[0].resetsAt > 1e12);
		assert.strictEqual(result.windows[1].label, 'Weekly');
		assert.strictEqual(result.windows[1].usedPercent, 81);
		assert.strictEqual(usageBand(result.windows[0].usedPercent), 'green');
		assert.strictEqual(usageBand(result.windows[1].usedPercent), 'red');
	});

	test('treats resets_in as relative seconds, not absolute timestamp', () => {
		const before = Date.now();
		const result = normalizeAnthropicUsageJson({
			five_hour: { used_percent: 10, resets_in: 3600 },
		});
		const after = Date.now();
		assert.strictEqual(result.windows.length, 1);
		const reset = result.windows[0].resetsAt!;
		assert.ok(reset >= before + 3600_000 - 50);
		assert.ok(reset <= after + 3600_000 + 50);
	});

	test('usage band thresholds and countdown formatting', () => {
		assert.strictEqual(usageBand(null), 'green');
		assert.strictEqual(usageBand(59.9), 'green');
		assert.strictEqual(usageBand(60), 'amber');
		assert.strictEqual(usageBand(80), 'red');
		const now = Date.UTC(2026, 0, 1, 12, 0, 0);
		assert.strictEqual(formatResetCountdown(now + 3 * 3600_000 + 54 * 60_000, now), 'Resets in 3h 54m');
		assert.strictEqual(formatResetCountdown(now + 90_000, now), 'Resets in 1m');
		assert.strictEqual(formatResetCountdown(null, now), null);
	});

	test('providerSupportsAnthropicUsage only for Anthropic OAuth endpoints', () => {
		assert.strictEqual(providerSupportsAnthropicUsage({ id: 'anthropic', auth: 'oauth', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }), true);
		assert.strictEqual(providerSupportsAnthropicUsage({ id: 'minimax-oauth', auth: 'oauth', protocol: 'anthropic', baseUrl: 'https://api.minimax.io/anthropic' }), false);
		assert.strictEqual(providerSupportsAnthropicUsage({ id: 'openai', auth: 'apiKey', protocol: 'openai' }), false);
		assert.strictEqual(providerSupportsAnthropicUsage({ id: 'copilot', auth: 'oauth', protocol: 'openai' }), false);
	});

});
