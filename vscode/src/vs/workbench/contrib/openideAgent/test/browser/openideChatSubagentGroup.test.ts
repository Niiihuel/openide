/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { OpenideChatActivityGroups } from '../../browser/chat/openideChatActivityGroups.js';
import { IOpenideChatContentPart, IOpenideChatContentPartContext } from '../../browser/chat/openideChatContentPart.js';
import { OpenideChatDelegationPart } from '../../browser/chat/parts/openideChatDelegationPart.js';
import { IOpenideChatSubagentAction, onDidRequestOpenideChatSubagentAction, OpenideChatSubagentPart } from '../../browser/chat/parts/openideChatSubagentPart.js';
import { IOpenideChatContent, IOpenideChatSubagentContent } from '../../common/chat/openideChatContent.js';
import { createOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { t } from '../../common/openideStrings.js';
import '../../browser/chat/media/openideChatNative.css';

suite('OpenIDE compact subagent activity', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const item = createOpenideChatResponseItem({ id: 'reply', requestId: 'request', content: [], isComplete: false });
	const context = upcastPartial<IOpenideChatContentPartContext>({ element: item });
	function worker(id: string, title: string, status: IOpenideChatSubagentContent['status'] = 'running'): IOpenideChatSubagentContent {
		return { kind: 'subagent', runId: id, index: 0, total: 1, title, status, timeline: [] };
	}
	function fixture(content: IOpenideChatContent[]) {
		const host = mainWindow.document.createElement('div');
		host.className = 'openide-chat-native';
		host.style.cssText = 'width:320px;position:fixed;top:0;left:0';
		mainWindow.document.body.append(host);
		store.add(toDisposable(() => host.remove()));
		const groups = store.add(new OpenideChatActivityGroups(host));
		const parts: IOpenideChatContentPart[] = [];
		const makePart = (entry: IOpenideChatContent) => {
			if (entry.kind === 'subagent') { return store.add(new OpenideChatSubagentPart(entry, context, NullHoverService)); }
			if (entry.kind === 'delegation') { return store.add(new OpenideChatDelegationPart(entry, context)); }
			const node = mainWindow.document.createElement('p'); node.textContent = 'Intervening prose';
			return { domNode: node, dispose() { node.remove(); }, hasSameContent: () => true };
		};
		for (const entry of content) { const part = makePart(entry); parts.push(part); host.append(part.domNode); }
		const render = () => groups.render(content, parts, false, false);
		render();
		return { host, groups, parts, render, append(entry: IOpenideChatContent) { content.push(entry); const part = makePart(entry); parts.push(part); host.append(part.domNode); render(); } };
	}

	test('consecutive workers share one quiet row and preserve existing avatars when another arrives', () => {
		const f = fixture([worker('a', 'Android inputs')]);
		const summary = f.host.querySelector('summary')!;
		const firstIcon = summary.querySelector('.openide-subagent-avatar');
		f.append(worker('b', 'Android surfaces'));
		assert.strictEqual(f.host.querySelectorAll('summary').length, 1);
		assert.strictEqual(summary.querySelector('.openide-subagent-avatar'), firstIcon);
		assert.strictEqual(summary.querySelectorAll('.openide-subagent-avatar').length, 2);
		assert.ok(summary.textContent?.includes(t('chat.subagents.delegating', 2)));
		assert.strictEqual(f.host.querySelector('details')!.open, false);
		assert.ok(summary.getBoundingClientRect().right <= f.host.getBoundingClientRect().right + 1);
	});

	test('collapsed streaming keeps the DOM still and unfolds the latest status without losing identity', () => {
		const content: IOpenideChatContent[] = [worker('a', 'Review inputs'), worker('b', 'Review surfaces')];
		const f = fixture(content);
		const group = f.host.querySelector('details')!;
		const summary = group.querySelector('summary')!;
		const icon = summary.querySelector('.openide-subagent-avatar');
		const part = f.parts[1] as OpenideChatSubagentPart;
		let heightChanges = 0; store.add(part.onDidChangeHeight(() => heightChanges++));
		const observer = new mainWindow.MutationObserver(() => {}); observer.observe(part.domNode, { subtree: true, attributes: true, childList: true, characterData: true });
		store.add(toDisposable(() => observer.disconnect()));
		for (let i = 0; i < 50; i++) {
			const next = { ...worker('b', 'Review surfaces'), timeline: [{ sequence: i, timestamp: i, type: 'progress' as const, message: `Chunk ${i}` }] };
			content[1] = next; part.tryUpdate(next, item); f.render();
		}
		assert.deepStrictEqual({ mutations: observer.takeRecords().length, heightChanges }, { mutations: 0, heightChanges: 0 });
		content[1] = worker('b', 'Review surfaces', 'failed'); part.tryUpdate(content[1], item); f.render();
		assert.ok(summary.textContent?.includes(t('chat.subagents.failed', 1)));
		assert.strictEqual(summary.querySelector('.openide-subagent-avatar'), icon);
		group.open = true; group.dispatchEvent(new mainWindow.Event('toggle'));
		assert.ok(part.domNode.classList.contains('openide-chat-part-error'));
		assert.strictEqual(group.querySelectorAll(':scope > .openide-chat-work-group-body > .openide-chat-sub').length, 2);
		assert.strictEqual(f.host.querySelector('details'), group);
	});

	test('never groups across prose or a different delegation and supports legacy envelopes', () => {
		const f = fixture([
			{ kind: 'delegation', delegationId: 'batch', total: 2, status: 'running' },
			{ ...worker('a', 'First'), parentId: 'batch' }, { ...worker('b', 'Second'), parentId: 'batch' },
			upcastPartial<IOpenideChatContent>({ kind: 'markdown' }), worker('c', 'Third'),
			{ ...worker('d', 'Separate'), parentId: 'other' },
		]);
		assert.deepStrictEqual([...f.host.children].map(node => node.tagName), ['DETAILS', 'P', 'DETAILS', 'DETAILS']);
		const first = f.host.querySelector('details')!;
		assert.strictEqual(mainWindow.getComputedStyle(first.querySelector('.openide-chat-delegation')!).display, 'none');
		assert.strictEqual(first.querySelectorAll('.openide-chat-sub').length, 2);
	});

	test('expanded history keeps all steps, full outputs and stable streaming blocks', () => {
		const content = { ...worker('a', 'Build UI'), timeline: [
			{ sequence: 1, timestamp: 1, type: 'reasoning' as const, message: 'Check layout' },
			{ sequence: 2, timestamp: 2, type: 'toolStart' as const, toolCallId: 'write', toolName: 'write_file' },
			{ sequence: 3, timestamp: 3, type: 'fileChange' as const, fileDiff: { path: 'chat.ts', created: true, editAdded: 1, diffLines: [{ t: 'add' as const, x: 'export const chat = true;' }] } },
			{ sequence: 4, timestamp: 4, type: 'toolResult' as const, toolCallId: 'write', message: 'output '.repeat(200) },
			{ sequence: 5, timestamp: 5, type: 'text' as const, message: 'Done' },
		] };
		const part = store.add(new OpenideChatSubagentPart(content, context, NullHoverService));
		part.domNode.querySelector<HTMLButtonElement>('.openide-chat-sub-chevron')!.click();
		const body = part.domNode.querySelector('.openide-chat-sub-tail')!;
		assert.strictEqual(body.children.length, 5);
		assert.ok(body.textContent?.includes('+export const chat = true;'));
		assert.ok(body.textContent?.includes('output '.repeat(200)));
		const reasoning = body.querySelector('details')!; reasoning.open = true;
		const last = body.lastElementChild!;
		const next = { ...content, timeline: [...content.timeline.slice(0, -1), { ...content.timeline[4], message: 'Next' }] };
		assert.strictEqual(part.hasSameContent(next, [], item), false);
		part.tryUpdate(next, item);
		assert.strictEqual(body.lastElementChild, last);
		assert.strictEqual(last.textContent, 'Next');
		assert.strictEqual(body.querySelector('details'), reasoning);
		assert.strictEqual(reasoning.open, true);
	});

	test('actions identify their owning window and keyboard use on a child control never opens the chat', () => {
		const f = fixture([worker('a', 'Open worker')]);
		const group = f.host.querySelector('details')!; group.open = true; group.dispatchEvent(new mainWindow.Event('toggle'));
		const head = f.host.querySelector<HTMLElement>('.openide-chat-part-head')!;
		const actions: IOpenideChatSubagentAction[] = []; store.add(onDidRequestOpenideChatSubagentAction(action => actions.push(action)));
		const stop = head.querySelector<HTMLButtonElement>('.openide-chat-sub-action')!;
		stop.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		stop.click(); head.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.deepStrictEqual(actions.map(action => [action.runId, action.action, action.sourceWindow === mainWindow]), [['a', 'cancel', true], ['a', 'open', true]]);
	});
});
