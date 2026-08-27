/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// NOT `import { strict as assert }`: the browser harness shims 'assert' with a default export that
// has neither a `strict` named export nor a `.strict` property, so that form throws at module
// evaluation and the runner skips the whole file as "BAD" — silently, still reporting the run
// green. The default export plus explicit `strictEqual`/`deepStrictEqual` is what upstream's own
// tests use, and it is the only form that runs here.
import assert from 'assert';
import {
	formatOpenideChatTokens, IOpenideChatContextUsage, openideChatContextCategories, openideChatContextPercent,
	openideChatContextSegments, openideChatContextTotal,
} from '../../common/chat/openideChatContextBreakdown.js';
import { IContextBreakdown } from '../../common/openideAgentTypes.js';

/**
 * The numbers behind "Uso de contexto".
 *
 * They lived interleaved with the panel's HTML string in the webview, which is why the one thing
 * worth checking about a usage panel — that its figures are right — could not be checked at all.
 */
suite('OpenIDE chat context breakdown', () => {

	const BREAKDOWN: IContextBreakdown = {
		system: 2_000, memory: 0, skills: 500, tools: 4_000, mcp: 1_000,
		mentions: 0, images: 0, subagents: 0, conversation: 12_500,
	};
	const CAPABILITIES = { tools: 26, mcp: 4, skills: 7 };

	function usage(overrides: Partial<IOpenideChatContextUsage> = {}): IOpenideChatContextUsage {
		return { input: 18_000, output: 2_000, used: 20_000, limit: 200_000, breakdown: BREAKDOWN, ...overrides };
	}

	test('the model-reported total wins over input plus output', () => {
		// Prompt caching makes input+output drift far above the real occupancy on a long thread.
		assert.strictEqual(openideChatContextTotal(usage({ used: 20_000, input: 900_000, output: 5 })), 20_000);
		// …and it is only the fallback when nothing was reported.
		assert.strictEqual(openideChatContextTotal(usage({ used: 0, input: 700, output: 300 })), 1_000);
	});

	test('the percentage is clamped and survives a missing limit', () => {
		assert.strictEqual(openideChatContextPercent(usage()), 10);
		assert.strictEqual(openideChatContextPercent(usage({ used: 400_000 })), 100, 'an under-reported limit must not exceed 100');
		assert.strictEqual(openideChatContextPercent(usage({ limit: 0 })), 0, 'no limit means no percentage, not a division by zero');
	});

	test('segments are sized against the LIMIT, never against the total', () => {
		// Against the total, an empty conversation would paint a full bar and hide the one fact the
		// panel exists to show.
		const segments = openideChatContextSegments(usage(), CAPABILITIES);
		const tools = segments.find(segment => segment.id === 'tools');
		assert.strictEqual(tools?.percent, 2, '4000 of 200000 is 2%');
		assert.strictEqual(tools?.tokens, 4_000);
	});

	test('empty segments are kept only when their absence is information', () => {
		const ids = openideChatContextSegments(usage(), CAPABILITIES).map(segment => segment.id);
		// system/tools/mcp/skills/conversation are shown at zero — "no MCP server loaded" is a fact.
		assert.deepStrictEqual(ids, ['system', 'tools', 'mcp', 'skills', 'conversation']);
		// memory, mentions, images and subagents at zero are noise, and they are gone.
		assert.strictEqual(ids.includes('memory'), false);
	});

	test('only the three actionable segments carry a count', () => {
		const segments = openideChatContextSegments(usage(), CAPABILITIES);
		const counted = segments.filter(segment => segment.count !== undefined);
		assert.deepStrictEqual(counted.map(segment => [segment.id, segment.count]), [['tools', 26], ['mcp', 4], ['skills', 7]]);
		assert.strictEqual(segments.find(segment => segment.id === 'conversation')?.count, undefined);
	});

	test('no bar without both a breakdown and a limit', () => {
		// The panel falls back to a single fill plus the capability counts; a segmented bar with no
		// limit to divide by would be nine arbitrary widths.
		assert.deepStrictEqual(openideChatContextSegments(usage({ breakdown: undefined }), CAPABILITIES), []);
		assert.deepStrictEqual(openideChatContextSegments(usage({ limit: 0 }), CAPABILITIES), []);
	});

	test('the breakdown is read through a defaulting lookup, not assumed complete', () => {
		// Conversations persisted before a field existed come back without it.
		const partial = { system: 1_000 } as unknown as IContextBreakdown;
		const segments = openideChatContextSegments(usage({ breakdown: partial }), CAPABILITIES);
		assert.strictEqual(segments.find(segment => segment.id === 'conversation')?.tokens, 0);
	});

	test('the panel groups segments the way upstream groups them', () => {
		const categories = openideChatContextCategories(openideChatContextSegments(usage(), CAPABILITIES), 10);
		// No "other": the segments already account for 10.1% of a window the ring rounds to 10%.
		assert.deepStrictEqual(categories.map(category => category.id), ['system', 'user']);
		// System keeps the catalogue order, and the counts ride along so the row can say "· 26".
		assert.deepStrictEqual(categories[0].rows.map(row => [row.label, row.percent, row.count]), [
			['System prompt', 1, undefined],
			['Herramientas', 2, 26],
			['MCP', 0.5, 4],
			['Skills', 0.3, 7],
		]);
		assert.deepStrictEqual(categories[1].rows.map(row => [row.label, row.percent]), [['Conversación', 6.3]]);
	});

	test('the rows add up to the ring: the remainder is stated, never hidden', () => {
		// 10% on the ring, 10.1% classified → nothing left over, and no "0.0%" row for the rounding.
		const exact = openideChatContextCategories(openideChatContextSegments(usage(), CAPABILITIES), 10.1);
		assert.strictEqual(exact.at(-1)?.id, 'user');
		// A model that reports a total above its own breakdown leaves context nobody claimed.
		const withRest = openideChatContextCategories(openideChatContextSegments(usage(), CAPABILITIES), 25);
		assert.deepStrictEqual(withRest.at(-1), { id: 'other', rows: [{ label: 'unclassified', percent: 14.9 }] });
	});

	test('rows that would round to 0.0% are dropped, and an empty breakdown draws nothing', () => {
		const tiny = { ...BREAKDOWN, skills: 40, mcp: 0 };
		const rows = openideChatContextCategories(openideChatContextSegments(usage({ breakdown: tiny }), CAPABILITIES), 10)[0].rows;
		assert.strictEqual(rows.some(row => row.label === 'Skills'), false, '40 / 200_000 = 0.02%');
		assert.strictEqual(rows.some(row => row.label === 'MCP'), false);
		// No limit means no percentages at all, so there is nothing to group — not even a remainder.
		assert.deepStrictEqual(openideChatContextCategories(openideChatContextSegments(usage({ limit: 0 }), CAPABILITIES), 0), []);
	});

	test('legend figures are compact, and only above a thousand', () => {
		assert.strictEqual(formatOpenideChatTokens(0), '0');
		assert.strictEqual(formatOpenideChatTokens(840), '840');
		assert.strictEqual(formatOpenideChatTokens(1_000), '1K');
		assert.strictEqual(formatOpenideChatTokens(12_450), '12.5K');
		assert.strictEqual(formatOpenideChatTokens(200_000), '200K');
	});
});
