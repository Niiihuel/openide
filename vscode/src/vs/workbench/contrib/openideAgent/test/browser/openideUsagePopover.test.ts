/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IOpenideUsageAccount, IOpenideUsageMonitor } from '../../browser/openideUsageMonitor.js';
import { OpenideUsagePopover, shouldShowUsageAccount } from '../../browser/openideUsagePopover.js';

suite('OpenIDE usage popover window ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('uses anchor workbench and closes only when its owning document closes', () => {
		const document = mainWindow.document.implementation.createHTMLDocument('Auxiliary fixture');
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench';
		document.body.appendChild(workbench);
		const anchor = document.createElement('span');
		workbench.appendChild(anchor);
		let closes = 0;
		let container: HTMLElement | undefined;
		const popover = store.add(new OpenideUsagePopover(upcastPartial<IOpenideUsageMonitor>({}), upcastPartial<IContextViewService>({
			showContextView: (delegate, target) => {
				container = target;
				return { close: () => { closes++; delegate.onHide?.(); } };
			},
		}), upcastPartial<ICommandService>({})));
		popover.show(anchor, 'fixture');
		popover.closeForDocument(mainWindow.document);
		const wrongDocumentCloses = closes;
		popover.closeForDocument(document);
		popover.closeForDocument(document);
		assert.deepStrictEqual({ scoped: container === workbench, wrongDocumentCloses, closes }, { scoped: true, wrongDocumentCloses: 0, closes: 1 });
	});
});


suite('OpenIDE usage popover account visibility', () => {
	const account = (id: string, status: 'ok' | 'error' | 'unavailable', failureKind?: 'stale-token' | 'network'): IOpenideUsageAccount => upcastPartial<IOpenideUsageAccount>({
		entry: { id, label: id, company: id, protocol: 'openai', auth: 'oauth' },
		usage: { providerId: id, fetchedAt: Date.now(), windows: status === 'ok' ? [{ label: 'Week', usedPercent: 10, limitMinutes: 10_080, resetsAt: null, resetDescription: null }] : [], status, failureKind },
		fetching: false,
	});

	test('hides passive expired credentials but keeps the active account', () => {
		const expired = account('grok-cli', 'error', 'stale-token');
		assert.strictEqual(shouldShowUsageAccount(expired, 'codex'), false);
		assert.strictEqual(shouldShowUsageAccount(expired, 'grok-cli'), true);
	});

	test('keeps usable accounts and real background failures visible', () => {
		assert.strictEqual(shouldShowUsageAccount(account('codex', 'ok'), 'other'), true);
		assert.strictEqual(shouldShowUsageAccount(account('claude', 'error', 'network'), 'other'), true);
	});
});
