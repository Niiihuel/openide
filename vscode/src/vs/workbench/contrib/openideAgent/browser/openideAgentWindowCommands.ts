/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getActiveWindow } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { CodeWindow, mainWindow } from '../../../../base/browser/window.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { agentWindowShortcuts } from '../common/openideAgentWindowShortcuts.js';
import { t } from '../common/openideStrings.js';
import { ResultKind } from '../../../../platform/keybinding/common/keybindingResolver.js';

// Register before the native resolver is first built, like other workbench contributions.
// The context is set only by input in the agent window; ordinary editor windows keep their keys.
const agentWindowFocused = ContextKeyExpr.greater('openideAgentWindowId', 0);
for (const shortcut of agentWindowShortcuts) {
	KeybindingsRegistry.registerKeybindingRule({ id: shortcut.id, primary: shortcut.primary, when: agentWindowFocused, weight: KeybindingWeight.WorkbenchContrib + 50 });
	MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: shortcut.id, title: t('openide.agentWindow.command', t(shortcut.label)), precondition: agentWindowFocused }, when: agentWindowFocused });
}

export type AgentWindowCommand = (...args: unknown[]) => unknown;

/** Routes workbench commands to the companion while retaining native keybinding resolution. */
export class OpenideAgentWindowCommands extends Disposable {
	constructor(
		window: CodeWindow,
		handlers: ReadonlyMap<string, AgentWindowCommand>,
		canHandle: (id: string) => boolean,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeys: IContextKeyService,
	) {
		super();
		// Native menus/quick input can invoke a command after their focus has moved.
		// Track actual input from both windows rather than treating main-window fallback as intent.
		let lastInputWindow: Window | undefined;
		let dispatching = false;
		const focused = contextKeys.createKey<number>('openideAgentWindowId', 0);
		this._register(toDisposable(() => { if (focused.get() === window.vscodeWindowId) { focused.reset(); } }));
		this._register(addDisposableListener(window, 'blur', () => { if (focused.get() === window.vscodeWindowId) { focused.reset(); } }));

		for (const target of [mainWindow, window]) {
			for (const event of ['pointerdown', 'focusin', 'keydown', 'focus']) {
				this._register(addDisposableListener(target, event, () => { lastInputWindow = target; focused.set(target === window ? window.vscodeWindowId : 0); }, true));
			}
		}
		for (const [id, handler] of handlers) {
			const original = CommandsRegistry.getCommand(id);
			this._register(CommandsRegistry.registerCommand(id, (accessor, ...args) => {
				const activeWindow = getActiveWindow();
				const origin = activeWindow.document.hasFocus() ? activeWindow : lastInputWindow ?? activeWindow;
				if ((dispatching || origin === window) && canHandle(id)) { return handler(...args); }
				return original?.handler(accessor, ...args);
			}));
		}
		this._register(addDisposableListener(window, 'keydown', event => {
			if (event.defaultPrevented || event.isComposing) { return; }
			const keyboard = new StandardKeyboardEvent(event);
			const target = event.target as HTMLElement;
			const resolved = keybindingService.softDispatch(keyboard, target);
			if (resolved.kind !== ResultKind.KbFound || resolved.isBubble || !resolved.commandId || !canHandle(resolved.commandId)) { return; }
			const handler = handlers.get(resolved.commandId);
			if (!handler) { return; }
			// Resolve first: custom shortcuts and chord prefixes keep their standard semantics.
			dispatching = true;
			try { keybindingService.dispatchEvent(keyboard, target); }
			finally { dispatching = false; }
			keyboard.preventDefault(); keyboard.stopPropagation();
		}, true));
	}
}
