/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append } from '../../../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../../../base/browser/ui/contextview/contextview.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IClipboardService } from '../../../../../../platform/clipboard/common/clipboardService.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { menuRow, menuSection, menuSeparator, OpenideChatMenuPopover } from '../openideChatMenuDom.js';

/**
 * The ⋯ popover of the embedded terminal card — item for item `buildTermMenu`
 *: copy the command, send the terminal to the IDE panel, then the
 * Auto-Run section with the three permission modes and a check on the active one.
 *
 * "Enviar al panel" is pinned by test/common/openideTerminalInteractive.test.ts, which asserts the
 * webview ships both that label and the `termToPanel` message. The native card answers the same
 * intent through `revealAgentTerminalToPanel` instead of a postMessage.
 */

/** `PERMISSIONS` (the removed chat webview): id, row label, codicon, tooltip. */
const PERMISSIONS: readonly (readonly [string, string, string, string])[] = [
	['ask', 'Preguntar siempre', 'shield', 'Cada edición y comando pide aprobación (lo más seguro).'],
	['auto-edit', 'Auto-aprobar ediciones', 'edit', 'Las ediciones de archivo se aplican solas; la terminal sigue preguntando.'],
	['auto-all', 'Auto-aprobar todo', 'zap', 'Todo se ejecuta sin preguntar, salvo lo peligroso y los archivos sensibles.'],
];

export class OpenideChatTerminalMenu extends OpenideChatMenuPopover {

	constructor(
		contextViewService: IContextViewService,
		private readonly _command: () => string,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
	) {
		super(contextViewService, {
			// The webview anchors this menu with `top: calc(100% + 4px); right: 0` on the ⋯ button's
			// wrapper, which is a below-and-right-aligned popover once expressed as an anchor rect.
			menuClass: 'openide-chat-term-menu',
			insetLeft: 0,
			insetRight: 0,
			anchorTo: 'trigger',
			alignment: AnchorAlignment.RIGHT,
			stretchToAnchor: false,
		});
	}

	protected override renderContent(content: HTMLElement, store: DisposableStore): void {
		const copy = menuRow('copy', 'Copiar comando');
		store.add(addDisposableListener(copy.row, 'click', event => {
			event.stopPropagation();
			this.close();
			void this._clipboardService.writeText(this._command());
		}));
		append(content, copy.row);

		// Moves the agent's hidden terminal into the IDE dock. It stays alive and takes focus there,
		// which is the escape hatch when the inline stdin line is not enough (curses UIs, pagers).
		const toPanel = menuRow('terminal', 'Enviar al panel');
		toPanel.row.title = 'Mostrar esta terminal en el panel del IDE';
		store.add(addDisposableListener(toPanel.row, 'click', event => {
			event.stopPropagation();
			this.close();
			void this._agentService.revealAgentTerminalToPanel();
		}));
		append(content, toPanel.row);

		append(content, menuSeparator());
		append(content, menuSection('Auto-Run'));

		const current = this._agentService.getPermissionMode() || 'ask';
		for (const [mode, label, icon, tooltip] of PERMISSIONS) {
			const { row } = menuRow(mode === current ? 'check' : icon, label);
			// The description is a tooltip and not a second line: in a narrow auxiliary bar it wrapped
			// into three lines and pushed the rows apart, which is why the webview moved it here too.
			row.title = tooltip;
			store.add(addDisposableListener(row, 'click', event => {
				event.stopPropagation();
				this.close();
				void this._agentService.setPermissionMode(mode);
			}));
			append(content, row);
		}
	}
}
