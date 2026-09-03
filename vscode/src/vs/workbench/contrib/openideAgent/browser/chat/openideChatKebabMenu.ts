/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { menuRow, menuSeparator, OpenideChatMenuPopover } from './openideChatMenuDom.js';
import { OpenideStringKey, t } from '../../common/openideStrings.js';

/**
 * The header's "more actions" popover, item for item the webview's `KEBAB_ITEMS`
 * (as the removed chat webview had it): fork, copy transcript, separator, and the project's two
 * views — the Project Map's nodes and the architecture map's diagram, which are one index read two
 * ways and therefore belong in the same block.
 */

interface IKebabItem {
	readonly separator?: boolean;
	readonly icon?: string;
	readonly label?: OpenideStringKey;
	readonly run?: (actions: IOpenideChatKebabActions) => void;
}

export interface IOpenideChatKebabActions {
	/** These act on the ACTIVE conversation; a no-op when there is none, as in the webview. */
	rename(): void;
	fork(): void;
	exportTranscript(): void;
	remove(): void;
	removeAll(): void;
	openProjectMap(): void;
}

/**
 * The ACTIVE conversation's actions, then the destructive ones, then the extra — VS Code's own
 * grouping for its chat view menu, minus "New conversation" and "History…": both now sit as their
 * own buttons two inches to the left in the same 35px row, and a kebab that repeats the buttons
 * beside it is the redundancy this header set out to remove.
 */
const ITEMS: readonly IKebabItem[] = [
	{ icon: 'edit', label: 'chat.menu.rename', run: actions => actions.rename() },
	{ icon: 'repo-forked', label: 'chat.menu.fork', run: actions => actions.fork() },
	{ icon: 'export', label: 'chat.menu.copyTranscript', run: actions => actions.exportTranscript() },
	{ separator: true },
	{ icon: 'trash', label: 'chat.menu.delete', run: actions => actions.remove() },
	{ icon: 'clear-all', label: 'chat.menu.deleteAll', run: actions => actions.removeAll() },
	{ separator: true },
	{ icon: 'type-hierarchy', label: 'chat.menu.projectMap', run: actions => actions.openProjectMap() },
];

export class OpenideChatKebabMenu extends OpenideChatMenuPopover {

	constructor(
		contextViewService: IContextViewService,
		private readonly actions: IOpenideChatKebabActions,
	) {
		super(contextViewService, {
			menuClass: 'openide-chat-kebab-menu',
			insetLeft: 0,
			insetRight: 6,
			alignment: AnchorAlignment.RIGHT,
			stretchToAnchor: false,
			anchorTo: 'trigger',
		});
	}

	protected override renderContent(content: HTMLElement, store: DisposableStore): void {
		for (const item of ITEMS) {
			if (item.separator) {
				append(content, menuSeparator());
				continue;
			}
			// Resolved on every open, so the menu follows `openide.language` without a rebuild.
			const { row } = menuRow(item.icon!, t(item.label!));
			store.add(addDisposableListener(row, 'click', event => {
				event.stopPropagation();
				this.close();
				item.run?.(this.actions);
			}));
			append(content, row);
		}
	}
}
