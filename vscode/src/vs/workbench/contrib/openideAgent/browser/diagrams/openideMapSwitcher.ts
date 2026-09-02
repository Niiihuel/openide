/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the project VIEW switcher: the popover that turns the identity card into a way of
 *  moving between the two pictures of the same project instead of a label saying where you are.
 *
 *  There are exactly two, and they are two readings of ONE index: the Project Map draws every file
 *  as a node, and the architecture map folds those files into modules and draws the dependencies
 *  between them. Neither is a file, so the switcher lists views, not documents.
 *
 *  It is the workbench's context view dressed in the `.openide-menu` family, like every other
 *  native popover in the fork — no surface of its own.
 *--------------------------------------------------------------------------------------------*/

import { append } from '../../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { t } from '../../common/openideStrings.js';
import { menuRow, menuSection, OpenideChatMenuPopover } from '../chat/openideChatMenuDom.js';

interface IProjectView {
	readonly command: string;
	readonly icon: string;
	readonly label: string;
	readonly detail: string;
	/** True for the view the popover is opening from. */
	readonly here: boolean;
}

export class OpenideProjectViewSwitcher extends OpenideChatMenuPopover {

	constructor(
		contextViewService: IContextViewService,
		private readonly commandService: { executeCommand(id: string): Promise<unknown> },
	) {
		super(contextViewService, {
			menuClass: 'openide-map-switcher-menu',
			insetLeft: 0,
			insetRight: 0,
			alignment: AnchorAlignment.LEFT,
			// As wide as the card it drops out of, so it reads as the card opening.
			stretchToAnchor: true,
			anchorTo: 'header',
		});
	}

	protected renderContent(content: HTMLElement, _store: DisposableStore): void {
		const views: IProjectView[] = [
			{ command: 'openide.archmap.project', icon: 'circuit-board', label: t('archmap.project.title'), detail: t('map.type.archmap'), here: true },
			{ command: 'openide.memory.open', icon: 'type-hierarchy', label: t('archmap.view.nodes'), detail: t('archmap.view.nodesDetail'), here: false },
		];
		append(content, menuSection(t('archmap.switcher.section')));
		for (const view of views) {
			const { row } = menuRow(view.icon, view.label);
			row.title = view.detail;
			if (view.here) {
				// Marked the way every menu in the fork marks it — tinted, never a checkmark, and NOT
				// disabled: hover has to keep winning over the active row.
				row.classList.add('openide-menu-active');
			}
			// Plain listeners on nodes the popover owns: the context view drops the whole container
			// on close, and these go with it.
			row.addEventListener('click', () => {
				this.close();
				if (!view.here) {
					void this.commandService.executeCommand(view.command);
				}
			});
			append(content, row);
		}
	}
}
