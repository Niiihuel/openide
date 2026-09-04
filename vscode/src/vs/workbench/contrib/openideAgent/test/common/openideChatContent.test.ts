/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import {
	hasOpenideChatStage1Part,
	IOpenideChatContent,
	isOpenideChatBlockingContent,
	isOpenideChatContent,
	isOpenideChatContentOfKind,
	isOpenideChatMarkdownContent,
	isOpenideChatProgressContent,
	isOpenideChatThinkingContent,
	isOpenideChatToolContent,
	OPENIDE_CHAT_CONTENT_KINDS,
	OpenideChatContentKind,
} from '../../common/chat/openideChatContent.js';

/**
 * The contract every other chat file is typed on. If a kind is added to the union without being
 * added to OPENIDE_CHAT_CONTENT_KINDS, isOpenideChatContent silently rejects it and the reducer
 * loses rows with no error — so the sample map below is exhaustive by construction.
 */
suite('OpenIDE chat content', () => {

	const md = (value: string) => ({ value, isTrusted: false, supportHtml: false });

	/** One minimal sample per kind. The Record type breaks the build if a kind is missing. */
	const samples: Record<OpenideChatContentKind, IOpenideChatContent> = {
		markdown: { kind: 'markdown', value: md('hola') },
		accountChoice: { kind: 'accountChoice', requestId: 'q1', spentLabel: 'a@x.com', candidates: [{ accountId: 'b', label: 'b@x.com' }] },
		thinking: { kind: 'thinking', text: 'pensando', isComplete: false },
		tool: { kind: 'tool', callId: 'c1', name: 'read_file', argumentsJson: '{}', state: 'running' },
		explore: { kind: 'explore', id: 'e1', entries: [], isComplete: false },
		edit: { kind: 'edit', diff: { path: 'a.ts' }, added: 2, removed: 1 },
		terminal: { kind: 'terminal', callId: 'c2', command: 'ls', background: false, output: '', state: 'running' },
		confirmation: { kind: 'confirmation', requestId: 'r1', tool: 'run_command', title: 'rm', risk: 'exec' },
		decision: { kind: 'decision', tool: 'run_command', decision: 'deny' },
		ask: { kind: 'ask', requestId: 'r2', questions: [], isComplete: false },
		todos: { kind: 'todos', items: [] },
		plan: { kind: 'plan', planId: 'p1', body: md('# plan'), state: 'draft' },
		planUpdate: { kind: 'planUpdate', path: '.openide/plans/x.md' },
		subagent: { kind: 'subagent', runId: 's1', index: 0, total: 1, title: 'x', status: 'running', timeline: [] },
		delegation: { kind: 'delegation', delegationId: 'd1', total: 2, status: 'running' },
		diagram: { kind: 'diagram', syntax: 'flowchart', source: 'A-->B' },
		notice: { kind: 'notice', severity: 'error', message: 'boom', action: 'connect' },
		compaction: { kind: 'compaction', status: 'completed', origin: 'automatic' },
		canvas: { kind: 'canvas', canvasId: 'k1', title: 'canvas' },
		modeSuggestion: { kind: 'modeSuggestion', requestId: 'r3', mode: 'plan', reason: 'complejo' },
		screenshot: { kind: 'screenshot', callId: 'c3', image: { mimeType: 'image/png', data: 'AAA' } },
		video: { kind: 'video', callId: 'c4', video: { label: 'login', dir: '/r', videoPath: '/r/flow.webm', sheetPath: '/r/sheet.jpg', durationMs: 1200, width: 640, height: 480, steps: [] } },
		progress: { kind: 'progress', text: '· read_file', sourceEvent: 'toolStart' },
	};

	test('the exported kind list covers the whole union', () => {
		assert.deepStrictEqual([...OPENIDE_CHAT_CONTENT_KINDS].sort(), Object.keys(samples).sort());
		assert.strictEqual(new Set(OPENIDE_CHAT_CONTENT_KINDS).size, OPENIDE_CHAT_CONTENT_KINDS.length);
	});

	test('isOpenideChatContent accepts every kind and nothing else', () => {
		for (const content of Object.values(samples)) {
			assert.strictEqual(isOpenideChatContent(content), true, content.kind);
		}
		for (const bogus of [undefined, null, 'markdown', 42, {}, { kind: 'markdownContent' }, []]) {
			assert.strictEqual(isOpenideChatContent(bogus), false, JSON.stringify(bogus) ?? 'undefined');
		}
	});

	test('isOpenideChatContentOfKind narrows to exactly one sample', () => {
		for (const kind of OPENIDE_CHAT_CONTENT_KINDS) {
			const matches = Object.values(samples).filter(content => isOpenideChatContentOfKind(content, kind));
			assert.deepStrictEqual(matches, [samples[kind]]);
		}
	});

	test('the named guards agree with their kind', () => {
		assert.strictEqual(isOpenideChatMarkdownContent(samples.markdown), true);
		assert.strictEqual(isOpenideChatMarkdownContent(samples.progress), false);
		assert.strictEqual(isOpenideChatProgressContent(samples.progress), true);
		assert.strictEqual(isOpenideChatProgressContent(samples.markdown), false);
		assert.strictEqual(isOpenideChatToolContent(samples.tool), true);
		assert.strictEqual(isOpenideChatToolContent(samples.explore), false);
		assert.strictEqual(isOpenideChatThinkingContent(samples.thinking), true);
		assert.strictEqual(isOpenideChatThinkingContent(samples.tool), false);
	});

	test('blocking content is exactly the three request/response protocols', () => {
		const blocking = Object.values(samples).filter(isOpenideChatBlockingContent).map(c => c.kind).sort();
		assert.deepStrictEqual(blocking, ['ask', 'confirmation', 'modeSuggestion']);
	});

	test('Stage 1 renders markdown plus the generic fallback, nothing else', () => {
		const rendered = Object.values(samples).filter(hasOpenideChatStage1Part).map(c => c.kind).sort();
		assert.deepStrictEqual(rendered, ['markdown', 'progress']);
	});
});
