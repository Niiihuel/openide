/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ActionBar } from '../../../../../base/browser/ui/actionbar/actionbar.js';
import { toAction } from '../../../../../base/common/actions.js';
import { DEFAULT_PANE_HEADER_SIZE, Pane, PaneView, setGlobalPaneHeaderSize } from '../../../../../base/browser/ui/splitview/paneview.js';
import { FONT, updateSidebarSize } from '../../../../../base/common/font.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import '../../browser/media/paneHeaders.css';

class HeaderMetricsPane extends Pane {
	bodyHeight = 0;
	constructor() {
		super({ title: 'Graph', minimumBodySize: 20, maximumBodySize: 1000, expanded: true });
		this.render();
	}
	protected renderHeader(container: HTMLElement): void {
		container.classList.add('actions-always-visible');
		const title = document.createElement('span');
		title.className = 'title';
		title.textContent = 'OPENIDE-WEB';
		container.appendChild(title);
		const actions = document.createElement('div');
		actions.className = 'actions';
		container.appendChild(actions);
		const bar = this._register(new ActionBar(actions));
		bar.push(['new-file', 'new-folder', 'refresh', 'collapse-all'].map(id => toAction({ id, label: id, class: `codicon codicon-${id}`, run: () => { } })), { icon: true, label: false });
	}
	protected renderBody(container: HTMLElement): void {
		container.style.position = 'relative';
		const row = document.createElement('div');
		row.className = 'monaco-list-row';
		row.style.cssText = 'position:absolute;top:0;height:22px;width:100%';
		row.textContent = 'First file';
		container.appendChild(row);
	}
	protected layoutBody(height: number): void { this.bodyHeight = height; }
}

suite('OpenIDE pane header metrics', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let container: HTMLElement;
	let originalFontSize: number;

	setup(() => {
		originalFontSize = FONT.sidebarSize;
		setGlobalPaneHeaderSize(28);
		container = document.createElement('div');
		container.className = 'monaco-workbench openide-visual modern-ui floating-panels';
		container.style.cssText = 'position:absolute;width:300px;height:200px;--oi-canvas:#181818';
		document.body.appendChild(container);
	});
	teardown(() => {
		container.remove();
		updateSidebarSize(originalFontSize);
		setGlobalPaneHeaderSize(DEFAULT_PANE_HEADER_SIZE);
	});

	for (const part of ['sidebar', 'auxiliarybar', 'panel']) {
		for (const fontSize of [13, 16]) {
			test(`${part} header matches reserved size at font ${fontSize}`, () => {
				updateSidebarSize(fontSize);
				container.style.setProperty('--vscode-workbench-sidebar-font-size', `${fontSize}px`);
				const dock = document.createElement('div');
				dock.className = `part ${part}`;
				container.appendChild(dock);
				const view = store.add(new PaneView(dock));
				const pane = store.add(new HeaderMetricsPane());
				view.addPane(pane, 200);
				view.layout(200, 300);
				const header = pane.element.querySelector<HTMLElement>('.pane-header')!;
				const expected = 28 * fontSize / 13;
				assert.ok(Math.abs(header.getBoundingClientRect().height - expected) < 0.02, `Rendered ${header.getBoundingClientRect().height}, reserved ${expected}`);
				assert.ok(Math.abs(pane.bodyHeight - (view.getPaneSize(pane) - expected)) < 0.02);
				assert.match(getComputedStyle(header).boxShadow, /0px 2px/);
				assert.match(getComputedStyle(header).boxShadow, /0px -2px/);
				const headerRect = header.getBoundingClientRect();
				const rowRect = pane.element.querySelector('.monaco-list-row')!.getBoundingClientRect();
				assert.ok(Math.abs(rowRect.top - headerRect.bottom) < 0.02, 'virtual row still starts at its original body offset');
				for (const action of header.querySelectorAll('.action-label.codicon')) {
					const actionRect = action.getBoundingClientRect();
					assert.ok(actionRect.top >= headerRect.top, 'action remains inside header');
					assert.ok(rowRect.top - actionRect.bottom >= 5.9, `Actions need breathing room before row: ${rowRect.top - actionRect.bottom}`);
				}

				pane.setExpanded(false);
				view.layout(200, 300);
				assert.ok(Math.abs(view.getPaneSize(pane) - expected) < 0.02);
				assert.strictEqual(header.getAttribute('aria-expanded'), 'false');
			});
		}
	}
});
