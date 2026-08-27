/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import {
	OPENIDE_CHAT_CLAMP_LINES_DEFAULT, OPENIDE_CHAT_FONT_SIZE_DEFAULT,
	resolveChatAutoScroll, resolveChatClampLines, resolveChatDensity, resolveChatFontSize,
} from '../../common/chat/openideChatConfig.js';

/**
 * The resolvers are the single normalization point for `openide.chat.*`: whatever garbage lands in
 * settings.json (strings, NaN, out-of-range numbers), the chat must degrade to its defaults instead
 * of painting with `--openide-chat-font-size: NaNpx`.
 */
suite('OpenIDE ChatConfig resolvers', () => {

	test('font size clamps to the schema range and rounds', () => {
		assert.strictEqual(resolveChatFontSize(undefined), OPENIDE_CHAT_FONT_SIZE_DEFAULT);
		assert.strictEqual(resolveChatFontSize('grande'), OPENIDE_CHAT_FONT_SIZE_DEFAULT);
		assert.strictEqual(resolveChatFontSize(NaN), OPENIDE_CHAT_FONT_SIZE_DEFAULT);
		assert.strictEqual(resolveChatFontSize(5), 11);
		assert.strictEqual(resolveChatFontSize(99), 18);
		assert.strictEqual(resolveChatFontSize(14.6), 15);
	});

	test('density only admits the two declared values', () => {
		assert.strictEqual(resolveChatDensity('compact'), 'compact');
		assert.strictEqual(resolveChatDensity('comfortable'), 'comfortable');
		assert.strictEqual(resolveChatDensity('cozy'), 'comfortable');
		assert.strictEqual(resolveChatDensity(undefined), 'comfortable');
	});

	test('clamp lines: 0 disables, range enforced, garbage falls to default', () => {
		assert.strictEqual(resolveChatClampLines(0), 0);
		assert.strictEqual(resolveChatClampLines(-4), 0);
		assert.strictEqual(resolveChatClampLines(50), 12);
		assert.strictEqual(resolveChatClampLines(undefined), OPENIDE_CHAT_CLAMP_LINES_DEFAULT);
		assert.strictEqual(resolveChatClampLines('tres'), OPENIDE_CHAT_CLAMP_LINES_DEFAULT);
	});

	test('autoScroll defaults to whenAtBottom for anything unknown', () => {
		assert.strictEqual(resolveChatAutoScroll('always'), 'always');
		assert.strictEqual(resolveChatAutoScroll('whenAtBottom'), 'whenAtBottom');
		assert.strictEqual(resolveChatAutoScroll(true), 'whenAtBottom');
		assert.strictEqual(resolveChatAutoScroll(undefined), 'whenAtBottom');
	});
});
