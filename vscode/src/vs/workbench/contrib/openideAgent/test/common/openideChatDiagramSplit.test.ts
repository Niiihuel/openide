/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { IOpenideChatContent, IOpenideChatDiagramContent } from '../../common/chat/openideChatContent.js';
import { splitOpenideChatDiagrams, splitOpenOpenideChatDiagram } from '../../common/chat/openideChatDiagramSplit.js';
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

	test('a streaming fence is detected for the skeleton, with the prose split off', () => {
		// The presentation-only counterpart of "a fence still being typed is not drawn": the
		// markdown part swaps the raw streaming source for a skeleton, and needs to know where
		// the prose ends and which language opened.
		const open = splitOpenOpenideChatDiagram('Mirá:\n\n```archmap\n{"type":"archmap"');
		assert.deepStrictEqual(open, { prose: 'Mirá:\n\n', syntax: 'archmap' });
	});

	test('the skeleton split ignores closed fences and ordinary code blocks', () => {
		assert.strictEqual(splitOpenOpenideChatDiagram(`Listo:\n\n\`\`\`mermaid\n${GRAPH}\n\`\`\`\n`), undefined, 'closed fence: the real row takes over');
		assert.strictEqual(splitOpenOpenideChatDiagram('```ts\nconst a = 1;'), undefined, 'an open code block is not a diagram');
		const after = splitOpenOpenideChatDiagram(`\`\`\`ts\nconst a = 1;\n\`\`\`\n\n\`\`\`mermaid\n${GRAPH}`);
		assert.strictEqual(after?.syntax, 'mermaid');
		assert.ok(after?.prose.includes('const a = 1;'), 'the closed code block stays in the prose');
	});

	test('a fence whose info line is still arriving is held back, and claims nothing', () => {
		// The reported bug: `marked` runs with `fillInIncompleteTokens` while a turn streams, so a
		// dangling ```` ```flowm ```` was closed for us and rendered as an EMPTY grey box under the
		// answer — and providers pause exactly there, right before a long JSON body, so it sat on
		// screen for seconds looking like a broken widget.
		for (const partial of ['```', '```f', '```flowma']) {
			const open = splitOpenOpenideChatDiagram(`El flujo principal sería:\n\n${partial}`);
			assert.deepStrictEqual(open, { prose: 'El flujo principal sería:\n\n', syntax: '' }, `"${partial}" was not held back`);
		}
		// Held for ANY language, because which one it is is precisely what has not arrived yet.
		assert.deepStrictEqual(splitOpenOpenideChatDiagram('Corré:\n\n```bas'), { prose: 'Corré:\n\n', syntax: '' });
	});

	test('the newline resolves it: a diagram opens, anything else goes back to the prose', () => {
		assert.strictEqual(splitOpenOpenideChatDiagram('Mirá:\n\n```flowmap\n')?.syntax, 'flowmap');
		assert.strictEqual(splitOpenOpenideChatDiagram('Corré:\n\n```bash\n'), undefined, 'a shell fence is a code block again');
	});

	test('a closing fence arriving backtick by backtick is not mistaken for a new opener', () => {
		// `\`\`\`` at the end of a text is ambiguous, and reading it as an opener would blank the
		// diagram that just finished streaming. The closed fence is matched first, so it is not.
		const open = splitOpenOpenideChatDiagram(`Listo:\n\n\`\`\`mermaid\n${GRAPH}\n\`\`\``);
		assert.strictEqual(open, undefined);
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
