/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { OpenideChatHeader } from '../../browser/chat/openideChatHeader.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { t } from '../../common/openideStrings.js';

suite('OpenIDE Chat Header maximize', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('button and external layout changes use the matching icon and accessible action', () => {
		const changed = store.add(new Emitter<void>());
		let maximized = false;
		const commands: string[] = [];
		const commandService = new class extends mock<ICommandService>() {
			override async executeCommand<T>(id: string): Promise<T> {
				commands.push(id);
				maximized = !maximized;
				changed.fire();
				return undefined as T;
			}
		};
		const host = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(host);
		store.add(toDisposable(() => host.remove()));
		const storage = store.add(new TestStorageService());
		const sessions = new OpenideChatSessions(storage);
		sessions.ensureActive();
		store.add(new OpenideChatHeader(host, sessions,
			upcastPartial<IContextViewService>({}), commandService,
			upcastPartial<IQuickInputService>({}), upcastPartial<IDialogService>({}),
			upcastPartial<IOpenideAgentService>({ resolveExecutables: async () => new Map() }),
			storage, NullHoverService,
			upcastPartial<IWorkbenchLayoutService>({ isAuxiliaryBarMaximized: () => maximized, onDidChangeAuxiliaryBarMaximized: changed.event })));
		const button = host.querySelector<HTMLButtonElement>('.openide-chat-head-maximize')!;
		const state = () => ({ icon: button.querySelector('svg')?.getAttribute('data-icon'), label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed') });
		assert.deepStrictEqual(state(), { icon: 'arrows-angle-expand', label: t('chat.header.maximize'), pressed: 'false' });
		button.click();
		assert.deepStrictEqual({ commands, ...state() }, { commands: ['workbench.action.toggleMaximizedAuxiliaryBar'], icon: 'arrows-angle-contract', label: t('chat.header.restore'), pressed: 'true' });
		maximized = false;
		changed.fire();
		assert.deepStrictEqual(state(), { icon: 'arrows-angle-expand', label: t('chat.header.maximize'), pressed: 'false' });
	});
});
