/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
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
		readonly fire: (diff: IOpenideChatFileDiffSummary) => void;
		readonly kept: string[];
		readonly reverted: string[];
	}

	function createTray(pending: readonly IOpenideChatFileDiffSummary[] = []): { tray: OpenideChatFilesTray; stub: IStub } {
		const emitter = store.add(new Emitter<IOpenideChatFileDiffSummary>());
		const kept: string[] = [];
		const reverted: string[] = [];
		const service = {
			onDidChangeFileDiff: emitter.event,
			pendingFileDiffs: () => pending,
			keepEdit: async (path: string) => { kept.push(path); },
			keepEdits: async (paths: readonly string[]) => { kept.push(...paths); },
			revertEdit: async (path: string) => { reverted.push(path); },
			openDiff: async () => { },
		} as unknown as IOpenideAgentService;
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IOpenideAgentService, service);
		instantiationService.stub(IHoverService, NullHoverService);
		const tray = store.add(instantiationService.createInstance(OpenideChatFilesTray, $('div')));
		return { tray, stub: { service, fire: diff => emitter.fire(diff), kept, reverted } };
	}

	const rows = (tray: OpenideChatFilesTray) => tray.domNode.querySelectorAll('.openide-chat-files-row');
	const isHidden = (tray: OpenideChatFilesTray) => tray.domNode.classList.contains('hidden');

	test('an idle chat shows no tray at all', () => {
		const { tray } = createTray();
		assert.strictEqual(tray.isEmpty, true);
		assert.strictEqual(isHidden(tray), true);
	});

	test('one edited file puts one row on screen', () => {
		const { tray, stub } = createTray();
		stub.fire({ path: 'src/app.ts', added: 12, removed: 3 });
		assert.strictEqual(isHidden(tray), false);
		assert.strictEqual(rows(tray).length, 1);
	});

	test('a second edit of the SAME file updates the row instead of adding one', () => {
		// The agent loop fires once per write, and it reports the counts accumulated against the
		// baseline. Two writes to one file are one pending file, not two.
		const { tray, stub } = createTray();
		stub.fire({ path: 'src/app.ts', added: 12, removed: 3 });
		stub.fire({ path: 'src/app.ts', added: 20, removed: 4 });
		assert.strictEqual(rows(tray).length, 1);
	});

	test('0/0 is how a file leaves: kept or undone somewhere else', () => {
		const { tray, stub } = createTray();
		stub.fire({ path: 'src/app.ts', added: 12, removed: 3 });
		stub.fire({ path: 'src/other.ts', added: 1, removed: 0 });
		assert.strictEqual(rows(tray).length, 2);
		stub.fire({ path: 'src/app.ts', added: 0, removed: 0 });
		assert.strictEqual(rows(tray).length, 1);
		stub.fire({ path: 'src/other.ts', added: 0, removed: 0 });
		assert.strictEqual(tray.isEmpty, true);
		assert.strictEqual(isHidden(tray), true);
	});

	test('the tray survives the window: it restores from the snapshot on construction', () => {
		// Unaccepted changes are workspace state, not turn state. After a reload the transcript is
		// gone and the files are still waiting.
		const { tray } = createTray([{ path: 'src/restored.ts', added: 5, removed: 1 }]);
		assert.strictEqual(rows(tray).length, 1);
		assert.strictEqual(isHidden(tray), false);
	});
});
