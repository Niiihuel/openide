/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DomScrollableElement } from '../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../../base/common/scrollable.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { OpenideProjectMapCard } from '../../browser/projectMap/openideProjectMapCard.js';
import { OPENIDE_SURFACE_CSS } from '../../browser/openideSurfaceCss.js';
import '../../browser/projectMap/media/openideProjectMap.css';

suite('OpenIDE Project Map controls', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	let style: HTMLStyleElement;
	setup(() => {
		style = document.createElement('style');
		style.textContent = OPENIDE_SURFACE_CSS;
		document.head.appendChild(style);
		root = document.createElement('div');
		root.className = 'monaco-workbench openide-pmap';
		root.style.cssText = 'width:629px;height:600px;--vscode-editor-background:#181818;--vscode-foreground:#ddd;--vscode-focusBorder:#9df';
		document.body.appendChild(root);
	});
	teardown(() => { root.remove(); style.remove(); });

	function card(className = 'openide-pmap-search'): OpenideProjectMapCard {
		return store.add(new OpenideProjectMapCard(root, { className, title: 'Map' }, store.add(new InMemoryStorageService())));
	}

	test('typing and action keys do not collapse a card; header keys still do', () => {
		const target = card();
		const input = target.addHeadAction(document.createElement('input'));
		const action = target.addHeadAction(document.createElement('button'));
		for (const control of [input, action]) {
			for (const key of [13, 32]) {
				const event = new KeyboardEvent('keydown', { keyCode: key, bubbles: true, cancelable: true });
				control.dispatchEvent(event);
				assert.strictEqual(event.defaultPrevented, false);
				assert.strictEqual(target.collapsed, false);
			}
		}
		target.head.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 32, bubbles: true, cancelable: true }));
		assert.strictEqual(target.collapsed, true);
		target.head.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true, cancelable: true }));
		assert.strictEqual(target.collapsed, false);
	});

	test('shared control radius and icon size leave a long module list scrollable after folding', () => {
		const target = card('openide-pmap-modules');
		target.card.style.width = '280px';
		const list = document.createElement('div');
		list.className = 'openide-pmap-modules-list';
		for (let index = 0; index < 60; index++) {
			const row = document.createElement('button');
			row.className = 'openide-pmap-module oi-dock-row';
			row.textContent = `Module ${index}`;
			list.appendChild(row);
		}
		const scroll = store.add(new DomScrollableElement(list, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		target.body.appendChild(scroll.getDomNode());
		scroll.scanDomNode();
		assert.ok(list.clientHeight > 0);
		assert.ok(list.scrollHeight > list.clientHeight * 2);
		assert.strictEqual(getComputedStyle(target.head.querySelector('button')!).borderRadius, '7px');
		assert.strictEqual(getComputedStyle(target.head.querySelector('.codicon')!).fontSize, '16px');
		assert.strictEqual(getComputedStyle(target.card).borderRadius, '12px');
		target.setCollapsed(true, false);
		assert.strictEqual(getComputedStyle(target.body).display, 'none');
		target.setCollapsed(false, false);
		scroll.scanDomNode();
		scroll.setScrollPosition({ scrollTop: list.scrollHeight });
		assert.ok(scroll.getScrollPosition().scrollTop > 0);
		const finalRow = list.lastElementChild!.getBoundingClientRect();
		assert.ok(finalRow.bottom <= list.getBoundingClientRect().bottom + 1);
	});
});
