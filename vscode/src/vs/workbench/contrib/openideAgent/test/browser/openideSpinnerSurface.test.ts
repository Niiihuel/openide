/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OPENIDE_SURFACE_CSS } from '../../browser/openideSurfaceCss.js';
import '../../../../../base/browser/ui/codicons/codicon/codicon.css';
import '../../../../../base/browser/ui/codicons/codicon/codicon-modifiers.css';

suite('OpenIDE shared loading indicator', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('loading shares the Build ring without shrinking controls or rotating sync glyphs twice', () => {
		const document = mainWindow.document;
		const host = document.createElement('div');
		host.className = 'monaco-workbench openide-visual';
		const style = document.createElement('style');
		style.textContent = OPENIDE_SURFACE_CSS;
		const build = document.createElement('span');
		build.className = 'openide-chat-plan-spinner';
		const loading = document.createElement('button');
		loading.className = 'codicon codicon-loading codicon-modifier-spin';
		loading.style.width = '28px';
		loading.style.height = '28px';
		const tree = document.createElement('span');
		tree.className = 'codicon codicon-tree-item-loading';
		const sync = document.createElement('span');
		sync.className = 'codicon codicon-sync codicon-modifier-spin';
		host.append(style, build, loading, tree, sync);
		document.body.append(host);
		const ring = (element: HTMLElement) => mainWindow.getComputedStyle(element, '::before');
		try {
			const shape = (element: HTMLElement) => {
				const css = ring(element);
				return [css.width, css.height, css.borderTopStyle, css.borderTopWidth, css.animationName];
			};
			assert.deepStrictEqual(shape(loading), shape(build));
			assert.deepStrictEqual(shape(tree), shape(build));
			assert.strictEqual(mainWindow.getComputedStyle(loading).width, '28px', 'the native hit target remains owned by its control');
			assert.strictEqual(mainWindow.getComputedStyle(loading).animationName, 'none', 'only the ring rotates');
			assert.strictEqual(mainWindow.getComputedStyle(sync).animationName, 'codicon-spin', 'sync remains the semantic native glyph');
			assert.notStrictEqual(ring(sync).borderTopStyle, 'solid');
			if (!mainWindow.matchMedia('(prefers-reduced-motion: reduce)').matches) {
				assert.strictEqual(ring(loading).animationName, 'openide-spinner-turn');
			}
			host.classList.add('monaco-reduce-motion');
			assert.strictEqual(ring(loading).animationName, 'none');
			assert.strictEqual(ring(build).animationName, 'none');
			host.classList.remove('monaco-reduce-motion');
			loading.className = 'codicon codicon-check';
			assert.notStrictEqual(ring(loading).animationName, 'openide-spinner-turn', 'a completed operation leaves no active animation');
			host.classList.remove('openide-visual');
			assert.strictEqual(ring(tree).animationName, 'codicon-spin', 'the Workbench adapter is opt-in');
		} finally {
			host.remove();
		}
	});
});
