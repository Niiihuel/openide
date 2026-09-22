/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { appendSubagentTimeline, subagentTimelineEvent, subagentTimelineMessage } from '../../common/openideSubagentTranscript.js';
import { ISubagentTimelineEvent } from '../../common/openideSubagentTypes.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('OpenIDE complete subagent transcript', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('coalesces streamed blocks without dropping the first 500 steps', () => {
		let timeline: readonly ISubagentTimelineEvent[] = [];
		for (let i = 0; i < 510; i++) { timeline = appendSubagentTimeline(timeline, { type: 'toolStart', toolCallId: String(i), toolName: 'read' }, i); }
		timeline = appendSubagentTimeline(timeline, { type: 'reasoning', message: 'Review ' }, 511);
		timeline = appendSubagentTimeline(timeline, { type: 'reasoning', message: 'complete' }, 512);
		assert.strictEqual(timeline.length, 511);
		assert.strictEqual(timeline[0].toolCallId, '0');
		assert.strictEqual(timeline.at(-1)?.message, 'Review complete');
		assert.strictEqual(timeline.at(-1)?.sequence, 511);
	});
	test('retains full tool output, reasoning and created files for mirror restoration', () => {
		const result = subagentTimelineEvent({ type: 'toolResult', id: 'a', name: 'read', result: 'x'.repeat(5000), isError: false })!;
		assert.strictEqual(subagentTimelineMessage(result)?.content.length, 5000);
		assert.strictEqual(subagentTimelineMessage({ type: 'reasoning', message: 'Check changes' })?.reasoning, 'Check changes');
		const file = subagentTimelineEvent({ type: 'fileDiff', path: 'chat.ts', created: true, added: 2, removed: 0, diffLines: [{ t: 'add', x: 'new' }] })!;
		assert.deepStrictEqual(subagentTimelineMessage(file)?.fileDiff, { path: 'chat.ts', created: true, editAdded: 2, editRemoved: 0, diffLines: [{ t: 'add', x: 'new' }] });
	});
});
