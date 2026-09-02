/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import {
	appendOpenideChatExploreEntry, countOpenideChatExploreEntries, createOpenideChatExploreContent,
	createOpenideChatExploreEntry, formatExploredLabel, openideChatExploreLabel, settleOpenideChatExploreEntry,
} from '../../common/chat/openideChatExploreGroup.js';
import {
	basenameForChat, compactExploreDetail, getOpenideToolMeta, isOpenidePlanPath, lineSpanTarget,
	OPENIDE_TOOL_META, routeToolCall, toolDetailFor, toolVisualKind,
} from '../../common/chat/openideChatToolMeta.js';

/**
 * The icons the user is missing.
 *
 * This catalog lived inside the webview's JavaScript string, where nothing could import it and
 * nothing could test it — which is exactly why the native transcript shows a bullet instead of a
 * codicon. These asserts exist so the table cannot silently lose an entry again.
 */
suite('OpenIDE chat tool catalog', () => {

	test('every entry declares an icon, a verb and a past tense', () => {
		for (const [name, meta] of Object.entries(OPENIDE_TOOL_META)) {
			assert.ok(meta.icon, `${name} has no icon`);
			assert.ok(meta.verb, `${name} has no verb`);
			assert.ok(meta.done, `${name} has no past tense`);
			assert.strictEqual(meta.icon.startsWith('codicon-'), false, `${name} must store the bare codicon id`);
		}
	});

	test('the catalog still covers the whole built-in surface', () => {
		// A dropped entry degrades that tool to a nameless generic row, which is the exact symptom
		// this file exists to prevent. The count is the cheapest tripwire.
		assert.strictEqual(Object.keys(OPENIDE_TOOL_META).length, 61);
		assert.strictEqual(OPENIDE_TOOL_META['read_file'].icon, 'file');
		assert.strictEqual(OPENIDE_TOOL_META['run_command'].icon, 'terminal');
		assert.strictEqual(OPENIDE_TOOL_META['delegate_task'].icon, 'run-all');
		// The five the webview's table never had: without them these built-ins render their raw
		// name as the verb, which is the fallback meant for MCP and dynamic tools only.
		for (const name of ['terminal_send', 'delete_file', 'rename_file', 'web_search', 'web_fetch']) {
			assert.notStrictEqual(OPENIDE_TOOL_META[name], undefined, `${name} is missing from the catalog`);
			assert.notStrictEqual(OPENIDE_TOOL_META[name].verb, name, `${name} still falls back to its raw name`);
		}
	});

	test('the tools the registry adds at runtime are in it too', () => {
		// These are registered in browser/openideAgentService.ts rather than declared next to the
		// file tools, which is exactly why they were all missing: nothing ever walked that list.
		// A tool that is not here renders its raw snake_case name beside the generic wrench — the
		// `batch_read` row the user reported.
		const runtime = [
			'batch_read', 'mcp_call', 'skill_view', 'skill_save', 'subagent_save', 'rule_manage',
			'plan_save', 'list_conversations', 'message_conversation', 'canvas_write', 'canvas_read',
			'canvas_list', 'canvas_open', 'codebase_search', 'codebase_explore', 'codebase_callers',
			'memory_graph_status', 'project_map_query', 'memory_graph_impact', 'memory_graph_path',
			'memory_graph_related_tests', 'codebase_save_priority', 'git_status', 'git_preflight',
			'git_commit', 'git_checkpoint', 'workflow_configure', 'git_configure', 'browser_open',
			'await_subagent', 'cancel_subagent', 'suggest_mode', 'memory', 'review_changes',
		];
		for (const name of runtime) {
			assert.notStrictEqual(OPENIDE_TOOL_META[name], undefined, `${name} is missing from the catalog`);
			assert.notStrictEqual(OPENIDE_TOOL_META[name].verb, name, `${name} still falls back to its raw name`);
		}
	});

	test('a read-only lookup folds into the phase; anything that acts keeps its row', () => {
		// This is the classification the live line depends on: an explore tool is spoken by the
		// turn's single animated line and lands in the counted group, while a tool that changes
		// something stays a row of the record.
		for (const name of ['batch_read', 'project_map_query', 'memory_graph_impact', 'canvas_read', 'list_conversations']) {
			assert.strictEqual(routeToolCall(name, '{}'), 'explore', `${name} should fold into the phase`);
		}
		for (const name of ['canvas_write', 'rule_manage', 'mcp_call', 'subagent_save', 'git_configure']) {
			assert.strictEqual(routeToolCall(name, '{}'), 'tool', `${name} should keep its own row`);
		}
	});

	test('an array argument is a list of names, or a count — never [object Object]', () => {
		// `String([{...}])` is `[object Object]`, and that is what a batched read used to be labelled
		// with the moment the catalog gained a key for it.
		const batch = JSON.stringify({ operations: [{ tool: 'read_file', arguments: {} }, { tool: 'search_text', arguments: {} }, { tool: 'read_file', arguments: {} }] });
		assert.strictEqual(toolDetailFor(OPENIDE_TOOL_META['batch_read'], batch), '3 files');
		const targets = JSON.stringify({ targets: ['src/a.ts', 'src/b.ts'] });
		assert.strictEqual(toolDetailFor(OPENIDE_TOOL_META['memory_graph_impact'], targets), 'src/a.ts, src/b.ts');
		assert.strictEqual(toolDetailFor(OPENIDE_TOOL_META['batch_read'], JSON.stringify({ operations: [] })), '');
	});

	test('terminal_send never names what was typed', () => {
		// The payload of an interactive answer can be a password: the tool's own approvalInfo hides
		// it for that reason, and the transcript row must not undo that by echoing the argument.
		assert.strictEqual(OPENIDE_TOOL_META['terminal_send'].key, '');
		assert.strictEqual(toolDetailFor(OPENIDE_TOOL_META['terminal_send'], JSON.stringify({ text: 'hunter2' })), '');
	});

	test('an unknown tool keeps its own name instead of a generic label', () => {
		// "Running tool" hides which integration is touching the user's machine.
		const meta = getOpenideToolMeta('mcp_github_create_issue');
		assert.strictEqual(meta.verb, 'mcp_github_create_issue');
		assert.strictEqual(meta.icon, 'plug');
		assert.deepStrictEqual(toolVisualKind('mcp_github_create_issue'), { id: 'mcp', label: 'MCP', icon: 'plug' });
		assert.strictEqual(toolVisualKind('skill_view').id, 'skill');
		assert.strictEqual(toolVisualKind('git_status').id, 'tool');
	});

	test('the target survives half-written arguments', () => {
		// toolCallDelta streams incomplete JSON precisely while the model types the path, which is
		// when showing it matters most.
		const meta = getOpenideToolMeta('edit_file');
		assert.strictEqual(toolDetailFor(meta, '{"path":"src/a.ts","content":"x'), 'src/a.ts');
		assert.strictEqual(toolDetailFor(meta, '{"path":"src/a.ts"}'), 'src/a.ts');
	});

	test('a path keeps its full form for openDiff and shortens only for the label', () => {
		const meta = getOpenideToolMeta('read_file');
		assert.strictEqual(toolDetailFor(meta, '{"path":"docs/DESIGN.md","start_line":10,"end_line":20}'), 'docs/DESIGN.md L10-20');
		assert.strictEqual(compactExploreDetail(meta, 'docs/DESIGN.md L10-20'), 'DESIGN.md L10-20');
		assert.strictEqual(basenameForChat('docs/DESIGN.md'), 'DESIGN.md');
		assert.strictEqual(basenameForChat('C:\\a\\b.ts'), 'b.ts');
	});

	test('lineSpan rewrites the row with the range that actually came back', () => {
		const meta = getOpenideToolMeta('read_file');
		assert.strictEqual(lineSpanTarget(meta, '{"path":"a.ts","start_line":5}', 'x\ny\nz'), 'a.ts L5-7');
		// Tools that do not declare lineSpan must never be rewritten, whatever they return.
		assert.strictEqual(lineSpanTarget(getOpenideToolMeta('search_text'), '{"query":"a"}', 'x\ny'), undefined);
		assert.strictEqual(lineSpanTarget(meta, '{"path":"a.ts"}', 'Error: nope'), undefined);
	});

	test('routing decides which card a call becomes', () => {
		assert.strictEqual(routeToolCall('update_todos', '{}'), 'silent');
		assert.strictEqual(routeToolCall('ask_user', '{}'), 'silent');
		assert.strictEqual(routeToolCall('delegate_task', '{}'), 'delegation');
		assert.strictEqual(routeToolCall('run_command', '{"command":"ls"}'), 'terminal');
		assert.strictEqual(routeToolCall('run_command', '{"command":"ls","background_persistent":true}'), 'silent');
		assert.strictEqual(routeToolCall('edit_file', '{"path":"src/a.ts"}'), 'edit');
		assert.strictEqual(routeToolCall('edit_file', '{"path":".openide/plans/x.md"}'), 'planUpdate');
		assert.strictEqual(routeToolCall('read_file', '{"path":"a.ts"}'), 'explore');
		assert.strictEqual(routeToolCall('git_status', '{}'), 'tool');
	});

	test('plan paths are recognised on both separators', () => {
		assert.strictEqual(isOpenidePlanPath('.openide/plans/x.md'), true);
		assert.strictEqual(isOpenidePlanPath('repo\\.openide\\plans\\x.md'), true);
		assert.strictEqual(isOpenidePlanPath('.openide/plans/nested/x.md'), false);
		assert.strictEqual(isOpenidePlanPath('src/a.ts'), false);
	});
});

suite('OpenIDE chat explore group', () => {

	function group(...entries: readonly (readonly [string, string])[]) {
		let content = createOpenideChatExploreContent('explore_1');
		for (const [callId, tool] of entries) {
			content = appendOpenideChatExploreEntry(content, createOpenideChatExploreEntry(callId, tool, '{}'));
		}
		return content;
	}

	test('the header shimmers as Exploring until nothing is in flight', () => {
		const content = group(['c1', 'read_file'], ['c2', 'search_text']);
		assert.strictEqual(openideChatExploreLabel(content), 'Exploring');
		const half = settleOpenideChatExploreEntry(content, 'c1', 'success');
		assert.strictEqual(openideChatExploreLabel(half), 'Exploring');
		const done = settleOpenideChatExploreEntry(half, 'c2', 'success');
		assert.strictEqual(openideChatExploreLabel(done), 'Explored 1 file, 1 search');
		assert.strictEqual(done.isComplete, true);
	});

	test('the counter reads the entries, so it can never disagree with the block', () => {
		const counts = countOpenideChatExploreEntries(group(['c1', 'read_file'], ['c2', 'get_diagnostics'], ['c3', 'memory']).entries);
		assert.deepStrictEqual(counts, { files: 2, searches: 0, other: 1 });
		assert.strictEqual(formatExploredLabel(group().entries), 'Explored 0 items');
		assert.strictEqual(formatExploredLabel(group(['c1', 'read_file']).entries), 'Explored 1 file');
	});

	test('a repeated call id replaces its entry instead of double counting', () => {
		// Restore replays history over a live group; counting the same read twice would inflate the
		// header the user reads as "how much did it look at".
		const content = appendOpenideChatExploreEntry(group(['c1', 'read_file']), createOpenideChatExploreEntry('c1', 'read_file', '{"path":"a.ts"}'));
		assert.strictEqual(content.entries.length, 1);
	});
});
