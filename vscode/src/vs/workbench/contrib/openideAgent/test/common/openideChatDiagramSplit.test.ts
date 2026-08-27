/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { IOpenideChatContent, IOpenideChatDiagramContent } from '../../common/chat/openideChatContent.js';
import { splitOpenideChatDiagrams } from '../../common/chat/openideChatDiagramSplit.js';
import { isOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { applyAgentEvents } from '../../common/chat/openideChatReducer.js';
import { createOpenideChatReducerState } from '../../common/chat/openideChatReducerState.js';
import { buildOpenideChatTranscript } from '../../common/chat/openideChatTranscript.js';
import { AgentLoopEvent } from '../../common/openideAgentTypes.js';

/**
 * The diagram nobody could see.
 *
 * `IOpenideChatDiagramContent` and `OpenideChatDiagramPart` existed, the renderer mapped the kind,
 * and no code path ever built one — every ```mermaid fence went into the markdown block and came
 * out as a code block. These asserts are about the split that closes that gap, and about the two
 * things it must NOT do: draw half a graph while it streams, and frame an ordinary code fence.
 */
suite('OpenIDE chat diagram fences', () => {

	const NOW = 1_000;
	const GRAPH = 'graph TD\nA-->B';

	function stream(deltas: readonly string[]): readonly IOpenideChatContent[] {
		const events: AgentLoopEvent[] = deltas.map(delta => ({ type: 'text', delta }));
		const state = applyAgentEvents(createOpenideChatReducerState(), events, { now: NOW }).state;
		const item = state.items.at(-1);
		return item && isOpenideChatResponseItem(item) ? item.content : [];
	}

	test('a closed fence becomes its own row', () => {
		const content = stream([`Mirá:\n\n\`\`\`mermaid\n${GRAPH}\n\`\`\`\n`]);
		assert.deepStrictEqual(content.map(entry => entry.kind), ['markdown', 'diagram', 'markdown']);
		const diagram = content[1] as IOpenideChatDiagramContent;
		assert.strictEqual(diagram.syntax, 'mermaid');
		assert.strictEqual(diagram.source.trim(), GRAPH);
	});

	test('all three fence languages are diagrams and nothing else is', () => {
		for (const language of ['mermaid', 'flowchart', 'diagram', 'MERMAID']) {
			const segments = splitOpenideChatDiagrams(`\`\`\`${language}\n${GRAPH}\n\`\`\``);
			assert.strictEqual(segments[0].kind, 'diagram', `${language} should draw`);
		}
		for (const language of ['ts', 'bash', 'json', '']) {
			const segments = splitOpenideChatDiagrams(`\`\`\`${language}\nconst a = 1;\n\`\`\``);
			assert.strictEqual(segments.length, 1);
			assert.strictEqual(segments[0].kind, 'markdown', `${language} must stay a code block`);
		}
	});

	test('a fence still being typed is not drawn', () => {
		// Half a graph parses to a different, wrong picture on nearly every delta, and re-laying out
		// a graph is the most expensive thing a content part does.
		const content = stream(['```mermaid\ngraph TD\n', 'A-->']);
		assert.deepStrictEqual(content.map(entry => entry.kind), ['markdown']);
	});

	test('the picture appears on the delta that closes the fence, exactly once', () => {
		const content = stream(['Diagrama:\n\n```mermaid\n', 'graph TD\nA-->B\n', '```', '\ny listo.']);
		assert.deepStrictEqual(content.map(entry => entry.kind), ['markdown', 'diagram', 'markdown']);
		assert.strictEqual((content[2] as { value: { value: string } }).value.value, '\ny listo.');
	});

	test('prose after the fence keeps streaming into one paragraph', () => {
		// The trailing block stays OPEN, or every token after a diagram would start its own row.
		const content = stream(['```mermaid\ngraph TD\nA-->B\n```\n', 'Eso ', 'es ', 'todo.']);
		assert.deepStrictEqual(content.map(entry => entry.kind), ['diagram', 'markdown']);
		assert.strictEqual((content[1] as { value: { value: string } }).value.value, '\nEso es todo.');
	});

	test('a message that opens with a fence leaves no empty paragraph above it', () => {
		const content = stream([`\`\`\`mermaid\n${GRAPH}\n\`\`\``]);
		assert.deepStrictEqual(content.map(entry => entry.kind), ['diagram']);
	});

	test('two diagrams in one message are two rows', () => {
		const content = stream([`\`\`\`mermaid\n${GRAPH}\n\`\`\`\nmedio\n\`\`\`mermaid\ngraph LR\nC-->D\n\`\`\``]);
		assert.deepStrictEqual(content.map(entry => entry.kind), ['diagram', 'markdown', 'diagram']);
	});

	test('the closing fence is found even when its backticks arrive one at a time', () => {
		// The scan is guarded on the delta carrying a backtick. Splitting the closing fence across
		// three deltas is the case that guard has to keep exact.
		const content = stream(['```mermaid\ngraph TD\nA-->B\n', '`', '`', '`']);
		assert.deepStrictEqual(content.map(entry => entry.kind), ['diagram']);
	});

	test('a code block before a diagram stays with the prose', () => {
		const segments = splitOpenideChatDiagrams('```ts\nconst a = 1;\n```\n\n```mermaid\ngraph TD\nA-->B\n```');
		assert.deepStrictEqual(segments.map(segment => segment.kind), ['markdown', 'diagram']);
		assert.ok((segments[0] as { value: string }).value.includes('const a = 1;'));
	});

	test('a reloaded conversation shows the picture, not the source', () => {
		// Restore pushes the stored assistant text straight into a markdown block; without the same
		// split there, a diagram survived only until the window was reloaded.
		const items = buildOpenideChatTranscript([
			{ role: 'user', content: 'diagramame esto' },
			{ role: 'assistant', content: `Listo:\n\n\`\`\`mermaid\n${GRAPH}\n\`\`\`` },
		], { now: NOW });
		const reply = items.at(-1);
		assert.ok(reply && isOpenideChatResponseItem(reply));
		assert.deepStrictEqual(reply.content.map(entry => entry.kind), ['markdown', 'diagram']);
	});
});
