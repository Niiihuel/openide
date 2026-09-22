/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OpenideAgentWindowContextTabs } from '../../browser/openideAgentWindowContextTabs.js';

suite('OpenIDE conversation context tabs', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	test('keyboard navigation preserves panel contents and each conversation selection', () => {
		const parent = mainWindow.document.createElement('div');
		const tabs = store.add(new OpenideAgentWindowContextTabs(parent));
		tabs.setSession('first');
		const buttons = [...parent.querySelectorAll<HTMLButtonElement>('[role=tab]')];
		const field = mainWindow.document.createElement('input');
		field.value = 'kept draft'; tabs.panel('context').append(field);
		buttons[0].dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		tabs.setSession('second');
		assert.deepStrictEqual(buttons.map(button => button.getAttribute('aria-selected')), ['true', 'false', 'false']);
		tabs.setSession('first');
		assert.deepStrictEqual({ selected: buttons.map(button => button.getAttribute('aria-selected')), visible: !tabs.panel('context').hidden, inactiveInert: tabs.panel('changes').inert, text: field.value }, { selected: ['false', 'false', 'true'], visible: true, inactiveInert: true, text: 'kept draft' });
		buttons[2].dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		assert.strictEqual(buttons[0].tabIndex, 0);
	});
});
