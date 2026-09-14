/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OPENIDE_SURFACE_CSS } from '../../browser/openideSurfaceCss.js';
import '../../../modernUI/browser/media/openideWorkbench.css';

suite('OpenIDE native scroll surfaces', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('context menus use the themed skin without overriding custom scroll owners or reserving empty gutters', () => {
		const host = mainWindow.document.createElement('div');
		host.className = 'monaco-workbench openide-visual vs-dark';
		host.style.cssText = 'position:absolute;left:0;top:0;width:300px;--vscode-scrollbarSlider-background:rgba(121,121,121,.4)';
		const style = mainWindow.document.createElement('style');
		// A menu stylesheet can load after the shared skin. Its standard thin property must not
		// bypass the themed WebKit thumb/button rules, as happened in the Advanced model view.
		style.textContent = `${OPENIDE_SURFACE_CSS}
			.openide-scroll-test { width:160px; height:80px; overflow:auto; }
			.openide-menu-content { scrollbar-width:thin; }
			.openide-scroll-test.custom-scroll-owner { scrollbar-width:none; }
			.openide-scroll-test.custom-scroll-owner::-webkit-scrollbar { display:none; }
			.openide-scroll-test.monaco-scrollable-element { overflow:hidden; }
		`;
		const context = mainWindow.document.createElement('div');
		context.className = 'context-view';
		const menu = mainWindow.document.createElement('div');
		menu.className = 'openide-scroll-test openide-menu-content';
		const content = mainWindow.document.createElement('div');
		content.style.height = '300px';
		menu.append(content);
		context.append(menu);
		const empty = mainWindow.document.createElement('div');
		empty.className = 'openide-scroll-test';
		empty.textContent = 'Short';
		const hidden = menu.cloneNode(true) as HTMLElement;
		hidden.className = 'openide-scroll-test custom-scroll-owner';
		const virtual = menu.cloneNode(true) as HTMLElement;
		virtual.className = 'openide-scroll-test monaco-scrollable-element';
		host.append(style, context, empty, hidden, virtual);
		mainWindow.document.body.append(host);
		try {
			assert.strictEqual(menu.closest('.openide-chat-native'), null);
			assert.strictEqual(mainWindow.getComputedStyle(menu).scrollbarWidth, 'auto');
			assert.strictEqual(mainWindow.getComputedStyle(menu).colorScheme, 'dark');
			assert.strictEqual(mainWindow.getComputedStyle(menu, '::-webkit-scrollbar').width, '12px');
			assert.strictEqual(mainWindow.getComputedStyle(menu, '::-webkit-scrollbar-button').display, 'none');
			// Chromium snaps borders to device pixels at fractional display scaling. Compare
			// with a native 3px border rather than assuming the resolved width stays integral.
			const borderReference = mainWindow.document.createElement('div');
			borderReference.style.border = '3px solid transparent';
			host.appendChild(borderReference);
			assert.strictEqual(mainWindow.getComputedStyle(menu, '::-webkit-scrollbar-thumb').borderLeftWidth, mainWindow.getComputedStyle(borderReference).borderLeftWidth);
			assert.strictEqual(empty.clientWidth, empty.offsetWidth, 'no stable gutter for content that fits');
			assert.strictEqual(mainWindow.getComputedStyle(hidden).scrollbarWidth, 'none');
			assert.strictEqual(mainWindow.getComputedStyle(virtual).overflowY, 'hidden', 'Monaco retains the only scroll owner');
			host.classList.replace('vs-dark', 'vs');
			host.style.setProperty('--vscode-scrollbarSlider-background', 'rgba(0, 0, 0, 0.3)');
			assert.strictEqual(mainWindow.getComputedStyle(menu).colorScheme, 'light');
			assert.strictEqual(mainWindow.getComputedStyle(menu, '::-webkit-scrollbar-thumb').backgroundColor, 'rgba(0, 0, 0, 0.3)');
		} finally {
			host.remove();
		}
	});
	test('native diff overview uses the shared thumb without resizing its hit area or change rulers', () => {
		const host = mainWindow.document.createElement('div');
		host.className = 'monaco-workbench';
		host.style.cssText = '--oi-radius-circle:9999px;--vscode-scrollbarSlider-background:rgba(121,121,121,.4)';
		const style = mainWindow.document.createElement('style');
		style.textContent = `${OPENIDE_SURFACE_CSS}
			.monaco-diff-editor .diffViewport { background:var(--vscode-scrollbarSlider-background); }
		`;
		host.innerHTML = '<div class="monaco-diff-editor"><div class="diffOverview" style="position:relative;width:30px;height:200px"><div class="diffViewport" style="position:absolute;width:30px;top:40px;height:80px"></div><canvas class="diffOverviewRuler" width="15" height="200"></canvas></div></div>';
		host.append(style);
		mainWindow.document.body.append(host);
		try {
			const viewport = host.querySelector<HTMLElement>('.diffViewport')!;
			const thumb = mainWindow.getComputedStyle(viewport, '::after');
			assert.strictEqual(mainWindow.getComputedStyle(viewport).backgroundColor, 'rgba(0, 0, 0, 0)');
			assert.strictEqual(thumb.width, '6px');
			assert.strictEqual(thumb.borderRadius, '9999px');
			assert.strictEqual(thumb.backgroundColor, 'rgba(121, 121, 121, 0.4)');
			assert.strictEqual(viewport.offsetWidth, 30, 'native drag hit area is unchanged');
			assert.strictEqual(viewport.offsetHeight, 80);
			assert.strictEqual(viewport.offsetTop, 40);
			assert.strictEqual(host.querySelector('canvas')!.width, 15, 'change markers keep their native ruler');
			host.style.setProperty('--vscode-scrollbarSlider-background', 'rgba(0,0,0,.3)');
			assert.strictEqual(mainWindow.getComputedStyle(viewport, '::after').backgroundColor, 'rgba(0, 0, 0, 0.3)');
		} finally { host.remove(); }
	});

});
