/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ActionViewItem } from '../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Action } from '../../../../../base/common/actions.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OPENIDE_SURFACE_CSS } from '../../browser/openideSurfaceCss.js';
import '../../../../browser/parts/panel/media/panelpart.css';

suite('OpenIDE expand icon adapter', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('native panel action switches expand/contract while Fit Graph stays unchanged', () => {
		const document = mainWindow.document;
		const host = document.createElement('div');
		host.className = 'monaco-workbench openide-visual';
		const style = document.createElement('style');
		style.textContent = OPENIDE_SURFACE_CSS;
		const panel = document.createElement('div');
		panel.className = 'part basepanel right';
		const toolbar = document.createElement('div');
		toolbar.className = 'global-actions';
		panel.append(toolbar);
		host.append(style, panel);
		document.body.append(host);
		store.add(toDisposable(() => host.remove()));
		const action = store.add(new Action('test.maximize', 'Maximize', 'codicon codicon-panel-maximize', true));
		action.checked = false;
		const viewItem = store.add(new ActionViewItem(null, action, { icon: true, label: false }));
		viewItem.render(toolbar);
		const label = toolbar.querySelector<HTMLElement>('.codicon-panel-maximize')!;
		const icon = () => mainWindow.getComputedStyle(label, '::before');
		const expandMask = icon().maskImage;
		assert.ok(expandMask.includes('data:image/svg+xml'));
		assert.deepStrictEqual([icon().width, icon().maskSize, icon().transform], ['14px', '12px 12px', 'none']);
		action.checked = true;
		assert.strictEqual(label.getAttribute('aria-pressed'), 'true');
		assert.notStrictEqual(icon().maskImage, expandMask, 'the native checked state selects contract');
		action.checked = false;
		assert.strictEqual(icon().maskImage, expandMask);
		const fit = document.createElement('span');
		fit.className = 'codicon codicon-screen-full openide-icon-fit';
		toolbar.append(fit);
		assert.strictEqual(mainWindow.getComputedStyle(fit, '::before').maskImage, 'none');
	});
});
