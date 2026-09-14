/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { $ } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { createChatTray } from '../../browser/chat/openideChatTray.js';
import { IOpenideChatFileDiffSummary, OpenideChatFilesTray } from '../../browser/chat/parts/openideChatFilesTray.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';

/**
 * The tray over the composer that had stopped appearing for the one case it exists for: the agent
 * edits a file, and the user needs somewhere to keep or undo it that is not a transcript row which
 * has already scrolled away.
 *
 * It went quiet without breaking. Its only input is `onDidChangeFileDiff`, and the only code that
 * fired it was the inline review, which reports a pending TRANSITION — but the agent's edit loop
 * marks the file pending first, so by the time the review recomputed there was no transition left
 * and it said nothing. Every assert here is against the event, not against the review, because the
 * event is the contract: whoever changed a file says so, and the tray draws it.
 */
suite('OpenIDE ChatFilesTray', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface IStub {
		readonly service: IOpenideAgentService;
		readonly fire: (diff: IOpenideChatFileDiffSummary) => Promise<void>;
		readonly select: (id: string) => void;
		readonly kept: string[];
		readonly reverted: string[];
	}

	function createTray(pending: readonly IOpenideChatFileDiffSummary[] = [], other: readonly IOpenideChatFileDiffSummary[] = []): { tray: OpenideChatFilesTray; stub: IStub } {
		const emitter = store.add(new Emitter<IOpenideChatFileDiffSummary>());
		let active = 'chat';
		const selected = store.add(new Emitter<void>());
		const kept: string[] = [];
		const reverted: string[] = [];
		const service = {
			onDidChangeFileDiff: emitter.event,
			pendingFileDiffs: (id: string) => id === 'chat' ? pending : other,
			keepEdit: async (path: string) => { kept.push(path); },
			keepEdits: async (paths: readonly string[]) => { kept.push(...paths); },
			revertEdit: async (path: string) => { reverted.push(path); },
			openDiff: async () => { },
		} as unknown as IOpenideAgentService;
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IOpenideAgentService, service);
		instantiationService.stub(IHoverService, NullHoverService);
		const tray = store.add(instantiationService.createInstance(OpenideChatFilesTray, $('div'), { activeSessionId: () => active, onDidChange: selected.event } as OpenideChatSessions));
		return { tray, stub: { service, select: id => { active = id; selected.fire(); }, fire: async diff => { pending = [...pending.filter(file => file.path !== diff.path), ...(diff.added || diff.removed ? [diff] : [])]; emitter.fire(diff); await timeout(75); }, kept, reverted } };
	}

	const rows = (tray: OpenideChatFilesTray) => tray.domNode.querySelectorAll('.openide-chat-files-row');
	const isHidden = (tray: OpenideChatFilesTray) => tray.domNode.classList.contains('hidden');

	test('an idle chat shows no tray at all', () => {
		const { tray } = createTray();
		assert.strictEqual(tray.isEmpty, true);
		assert.strictEqual(isHidden(tray), true);
	});

	test('one edited file puts one row on screen', async () => {
		const { tray, stub } = createTray();
		await stub.fire({ path: 'src/app.ts', added: 12, removed: 3 });
		assert.strictEqual(isHidden(tray), false);
		assert.strictEqual(rows(tray).length, 1);
	});

	test('a second edit of the SAME file updates the row instead of adding one', async () => {
		// The agent loop fires once per write, and it reports the counts accumulated against the
		// baseline. Two writes to one file are one pending file, not two.
		const { tray, stub } = createTray();
		await stub.fire({ path: 'src/app.ts', added: 12, removed: 3 });
		await stub.fire({ path: 'src/app.ts', added: 20, removed: 4 });
		assert.strictEqual(rows(tray).length, 1);
	});

	test('0/0 is how a file leaves: kept or undone somewhere else', async () => {
		const { tray, stub } = createTray();
		await stub.fire({ path: 'src/app.ts', added: 12, removed: 3 });
		await stub.fire({ path: 'src/other.ts', added: 1, removed: 0 });
		assert.strictEqual(rows(tray).length, 2);
		await stub.fire({ path: 'src/app.ts', added: 0, removed: 0 });
		assert.strictEqual(rows(tray).length, 1);
		await stub.fire({ path: 'src/other.ts', added: 0, removed: 0 });
		assert.strictEqual(tray.isEmpty, true);
		assert.strictEqual(isHidden(tray), true);
	});

	test('busy prevents resolving current and newly arriving edits until the turn settles', async () => {
		const { tray, stub } = createTray([{ path: 'src/first.ts', added: 5, removed: 1 }]);
		tray.setBusy(true);
		await stub.fire({ path: 'src/second.ts', added: 2, removed: 0 });
		const actions = Array.from(tray.domNode.querySelectorAll<HTMLButtonElement>('.openide-chat-file-action'));
		assert.strictEqual(actions.length, 4);
		for (const action of actions) {
			assert.strictEqual(action.disabled, true);
			action.click();
		}
		assert.deepStrictEqual(stub.kept, []);
		assert.deepStrictEqual(stub.reverted, []);
		assert.strictEqual(rows(tray).length, 2);
		tray.setBusy(false);
		assert.strictEqual(actions.every(action => !action.disabled), true);
		tray.domNode.querySelector<HTMLButtonElement>('.openide-chat-file-action-accept')!.click();
		assert.deepStrictEqual(stub.kept, ['src/first.ts']);
		assert.strictEqual(rows(tray).length, 1);
	});

	test('switching chats replaces pending files and ignores the other chat’s background edits', async () => {
		const { tray, stub } = createTray([{ path: 'a.ts', added: 1, removed: 0 }], [{ path: 'b.ts', added: 2, removed: 0 }]);
		stub.select('other');
		assert.strictEqual(rows(tray).length, 1);
		assert.ok(tray.domNode.textContent!.includes('b.ts'));
		await stub.fire({ path: 'a.ts', added: 3, removed: 0 });
		assert.ok(!tray.domNode.textContent!.includes('a.ts'));
		tray.domNode.querySelector<HTMLButtonElement>('.openide-chat-file-action-accept')!.click();
		assert.deepStrictEqual(stub.kept, ['b.ts']);
		stub.select('chat');
		assert.ok(tray.domNode.textContent!.includes('a.ts'));
		assert.ok(!tray.domNode.textContent!.includes('b.ts'));
	});

	test('the tray survives the window: it restores from the snapshot on construction', () => {
		// Unaccepted changes are workspace state, not turn state. After a reload the transcript is
		// gone and the files are still waiting.
		const { tray } = createTray([{ path: 'src/restored.ts', added: 5, removed: 1 }]);
		assert.strictEqual(rows(tray).length, 1);
		assert.strictEqual(isHidden(tray), false);
	});
	test('peer expansion updates file owner state without losing restored pending edits', () => {
		const pending = [{ path: 'src/restored.ts', added: 5, removed: 1 }];
		const { tray } = createTray(pending);
		const peer = store.add(createChatTray(tray.domNode.parentElement!, 'queue', 'list-ordered'));
		const toggle = tray.domNode.querySelector<HTMLButtonElement>('.openide-chat-tray-toggle')!;
		let heights = 0;
		store.add(tray.onDidChangeHeight(() => heights++));
		toggle.click();
		const before = heights;
		peer.setExpanded(true);
		assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
		assert.ok(heights > before);
		tray.reset(pending);
		assert.strictEqual(rows(tray).length, 1);
		assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
		assert.strictEqual(peer.toggle.getAttribute('aria-expanded'), 'true');
		toggle.click();
		assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
		assert.strictEqual(peer.toggle.getAttribute('aria-expanded'), 'false');
	});

});
