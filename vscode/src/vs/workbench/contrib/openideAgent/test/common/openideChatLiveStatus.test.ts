/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
import assert from 'assert';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { IOpenideChatContent } from '../../common/chat/openideChatContent.js';
import { isOpenideChatLiveTail, openideChatLiveStatusLabel } from '../../common/chat/openideChatLiveStatus.js';
import { t } from '../../common/openideStrings.js';

function markdown(text: string): IOpenideChatContent {
	return { kind: 'markdown', value: { value: text } as IMarkdownString };
}

function tool(name: string, state: 'running' | 'success', argumentsJson = '{}'): IOpenideChatContent {
	return { kind: 'tool', callId: `c-${name}`, name, argumentsJson, state };
}

function explore(...entries: { tool: string; target: string; state: 'running' | 'success' }[]): IOpenideChatContent {
	return {
		kind: 'explore',
		id: 'e1',
		entries: entries.map((entry, i) => ({ callId: `c${i}`, tool: entry.tool, target: entry.target, state: entry.state })),
		isComplete: entries.every(entry => entry.state !== 'running'),
	};
}

function subagent(title: string, status: 'running' | 'success', total = 1): IOpenideChatContent {
	return { kind: 'subagent', runId: 'r1', index: 0, total, title, status, tail: [] } as unknown as IOpenideChatContent;
}

/**
 * The wording of the ONE live line.
 *
 * The steps of a running turn are no longer rows growing under each other — they are this single
 * line, swapped in place. These asserts are the half of that which does not need a DOM: which step
 * the line is speaking for, and when it has to keep quiet because something below it is already
 * moving.
 */
suite('OpenIDE chat live status', () => {

	/** Asserts the text AND whether it is a real step, which is what the pacing keys off. */
	function assertStatus(actual: ReturnType<typeof openideChatLiveStatusLabel>, text: string, idle: boolean): void {
		assert.deepStrictEqual(actual, { text, idle });
	}

	test('a turn with nothing in it yet says it is thinking, and knows it is filler', () => {
		assertStatus(openideChatLiveStatusLabel([], false), t('chat.working.thinking'), true);
	});

	test('a finished turn has no live line at all', () => {
		assert.strictEqual(openideChatLiveStatusLabel([tool('read_file', 'running')], true), undefined);
	});

	test('a running call is named in the present tense, by basename', () => {
		const content = [tool('read_file', 'running', JSON.stringify({ path: 'src/vs/workbench/openideChatWidget.ts' }))];
		assertStatus(openideChatLiveStatusLabel(content, false), 'Read openideChatWidget.ts', false);
	});

	test('a settled call hands the line back to the generic wait', () => {
		assertStatus(openideChatLiveStatusLabel([tool('read_file', 'success')], false), t('chat.working.next'), true);
	});

	test('an exploration phase speaks for its newest running entry', () => {
		const content = [explore(
			{ tool: 'read_file', target: 'a.ts', state: 'success' },
			{ tool: 'search_text', target: 'needle', state: 'running' },
		)];
		assertStatus(openideChatLiveStatusLabel(content, false), 'Searched needle', false);
	});

	test('a settled exploration phase does not keep announcing itself', () => {
		const content = [explore({ tool: 'read_file', target: 'a.ts', state: 'success' })];
		assertStatus(openideChatLiveStatusLabel(content, false), t('chat.working.next'), true);
	});

	test('a shimmering fallback line becomes the live line itself', () => {
		const content: IOpenideChatContent[] = [{ kind: 'progress', text: 'Compactando el contexto' }];
		assertStatus(openideChatLiveStatusLabel(content, false), 'Compactando el contexto', false);
	});

	test('a settled fallback line stays a row and says nothing here', () => {
		const content: IOpenideChatContent[] = [{ kind: 'progress', text: 'Contexto compactado', shimmer: false }];
		assertStatus(openideChatLiveStatusLabel(content, false), t('chat.working.next'), true);
	});

	test('streaming prose is left to speak for itself', () => {
		// Two shimmering things saying the same "still working" is the noise this rule prevents.
		assert.strictEqual(openideChatLiveStatusLabel([markdown('hello')], false), undefined);
	});

	test('only the tail is consulted: an earlier running call is already on screen', () => {
		const content = [tool('read_file', 'running'), markdown('hello')];
		assert.strictEqual(openideChatLiveStatusLabel(content, false), undefined);
	});

	test('a running specialist puts the delegation on the line, named', () => {
		assertStatus(openideChatLiveStatusLabel([subagent('explore', 'running')], false), t('chat.working.delegating', 'explore'), false);
	});

	test('a fan-out is counted, not named after whichever specialist came last', () => {
		assertStatus(openideChatLiveStatusLabel([subagent('explore', 'running', 3)], false), t('chat.working.delegatingMany', '3'), false);
	});

	test('a finished specialist hands the line back to the generic wait', () => {
		assertStatus(openideChatLiveStatusLabel([subagent('explore', 'success')], false), t('chat.working.next'), true);
	});

	test('the live step is the last content of an unfinished turn, and only it', () => {
		const content = [tool('read_file', 'success'), tool('search_text', 'running')];
		assert.strictEqual(isOpenideChatLiveTail(content, 1, false), true);
		assert.strictEqual(isOpenideChatLiveTail(content, 0, false), false);
		// A finished turn hides nothing: every step is the record now.
		assert.strictEqual(isOpenideChatLiveTail(content, 1, true), false);
	});
});
