/* Copyright (c) OpenIDE. Licensed under the MIT License. */
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildOpenideChatTranscript, reconcileOpenideChatTranscript } from '../../common/chat/openideChatTranscript.js';

suite('OpenIDE mirrored transcript snapshots', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const snapshot = (text: string) => buildOpenideChatTranscript([
		{ role: 'user', content: 'Read files', messageId: 'first' },
		{ role: 'assistant', content: 'Previous completed response' },
		{ role: 'user', content: 'Continue', messageId: 'second' },
		{ role: 'assistant', content: text },
	]);
	test('an in-place text change repaints only its response, even at equal length', () => {
		const previous = reconcileOpenideChatTranscript([], snapshot('Version A'), 1);
		previous[1].currentRenderedHeight = 123;
		const next = reconcileOpenideChatTranscript(previous, snapshot('Version B'), 2);
		assert.strictEqual(next.length, previous.length);
		for (let index = 0; index < next.length - 1; index++) { assert.strictEqual(next[index], previous[index]); }
		assert.strictEqual(next[1].currentRenderedHeight, 123);
		assert.notStrictEqual(next.at(-1)!.dataId, previous.at(-1)!.dataId);
		const unchanged = reconcileOpenideChatTranscript(next, snapshot('Version B'), 3);
		for (let index = 0; index < next.length; index++) { assert.strictEqual(unchanged[index], next[index]); }
	});
});
