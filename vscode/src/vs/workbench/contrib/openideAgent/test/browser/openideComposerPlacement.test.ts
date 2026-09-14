/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AnchorAlignment, AnchorPosition, ContextView, ContextViewDOMPosition } from '../../../../../base/browser/ui/contextview/contextview.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { OpenideComposerPopover } from '../../browser/chat/openideComposerMenu.js';
import { OpenideChatMenuPopover } from '../../browser/chat/openideChatMenuDom.js';

suite('OpenIDE composer popover placement', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	for (const kind of ['composer', 'header'] as const) {
		test(`${kind} flips below without covering its sticky trigger and recomputes after resize`, () => {
			const document = mainWindow.document;
			const host = document.createElement('div');
			host.className = 'monaco-workbench monaco-reduce-motion';
			host.style.cssText = 'position:fixed;inset:0;--oi-scroll-inset:6px;--oi-motion-enter:0ms';
			document.body.appendChild(host);
			store.add(toDisposable(() => host.remove()));
			const anchor = document.createElement('button');
			anchor.style.cssText = 'position:absolute;left:80px;width:32px;height:24px';
			host.appendChild(anchor);
			const desiredHeight = Math.min(260, mainWindow.innerHeight * .3);
			const move = (top: number) => { anchor.style.top = `${top}px`; };
			// More than half of the menu fits above: the native ABOVE overlap heuristic used to
			// place this at top:0 even though its entire height comfortably fits below.
			move(desiredHeight * .75 + 20);
			const view = store.add(new ContextView(host, ContextViewDOMPosition.ABSOLUTE));
			const service = upcastPartial<IContextViewService>({
				showContextView: delegate => { view.show(delegate); return { close: () => view.hide(undefined, true) }; },
				layout: () => view.layout(),
				getContextViewElement: () => view.getViewElement(),
			});
			const body = document.createElement('div');
			body.style.cssText = `height:${desiredHeight}px;min-height:${desiredHeight}px;width:180px`;
			body.textContent = 'Menu content';
			let layout: () => void;
			if (kind === 'composer') {
				const popover = store.add(new OpenideComposerPopover(service));
				popover.show(anchor, { render: container => {
					const content = document.createElement('div');
					content.className = 'openide-menu-content';
					content.appendChild(body);
					container.appendChild(content);
				} });
				layout = () => popover.layout();
			} else {
				const popover = store.add(new class extends OpenideChatMenuPopover {
					constructor() { super(service, { menuClass: 'test-menu', insetLeft: 0, insetRight: 0, alignment: AnchorAlignment.LEFT, stretchToAnchor: false, anchorTo: 'trigger', position: AnchorPosition.ABOVE }); }
					protected override renderContent(content: HTMLElement, _store: DisposableStore): void { content.appendChild(body); }
					flush(): void { this.relayout(); }
				}());
				popover.toggle(anchor, anchor);
				layout = () => popover.flush();
			}
			layout();
			const below = () => assert.ok(view.getViewElement().getBoundingClientRect().top >= anchor.getBoundingClientRect().bottom + 7, 'Below keeps the trigger plus its 8px gap');
			const above = () => assert.ok(view.getViewElement().getBoundingClientRect().bottom <= anchor.getBoundingClientRect().top - 7, 'Above keeps the trigger plus its 8px gap');
			below();
			move(mainWindow.innerHeight - 40);
			layout();
			above();
			move(desiredHeight * .75 + 20);
			body.style.height = body.style.minHeight = '24px';
			layout();
			above();
			body.style.height = body.style.minHeight = `${desiredHeight}px`;
			layout();
			below();
			move(mainWindow.innerHeight / 2);
			body.style.height = body.style.minHeight = `${mainWindow.innerHeight * 2}px`;
			layout();
			above();
			assert.ok(view.getViewElement().getBoundingClientRect().top >= 11, 'An oversized list stays inside the viewport edge');
		});
	}
});
