/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { $, append, EventType, getWindow } from '../../../../browser/dom.js';
import { ActionViewItem } from '../../../../browser/ui/actionbar/actionViewItems.js';
import { BaseMenuActionViewItem, getMenuWidgetCSS, Menu, unthemedMenuStyles } from '../../../../browser/ui/menu/menu.js';
import { Action, Separator, SubmenuAction } from '../../../../common/actions.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('Menu', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		sinon.restore();
	});

	test('custom menu item keeps its icon separate from text and refreshes icon classes', () => {
		const host = append(document.body, $('div'));
		disposables.add(toDisposable(() => host.remove()));
		const action = disposables.add(new Action('review', 'Review changes', 'codicon codicon-diff'));
		const fallback = disposables.add(new Action('plain', 'Plain item'));
		let calls = 0;
		disposables.add(new Menu(host, [action, fallback], {
			actionViewItemProvider: (item, options) => {
				calls++;
				return item === action ? new BaseMenuActionViewItem(undefined, item, options, unthemedMenuStyles) : undefined;
			}
		}, unthemedMenuStyles));
		const label = host.querySelector<HTMLElement>('.action-label.codicon')!;
		assert.strictEqual(calls, 2);
		assert.strictEqual(label.textContent, 'Review changes');
		assert.strictEqual(label.style.getPropertyValue('--menu-item-icon-content'), 'var(--vscode-icon-diff-content)');
		action.class = 'codicon codicon-files';
		assert.strictEqual(label.classList.contains('codicon-diff'), false);
		assert.strictEqual(label.classList.contains('codicon-files'), true);
		assert.strictEqual(host.querySelectorAll('.action-menu-item').length, 2, 'undefined provider uses the default item');
	});

	test('toolbar overflow uses menu rows and preserves submenus and separators', async () => {
		const host = append(document.body, $('div'));
		disposables.add(toDisposable(() => host.remove()));
		let runs = 0;
		const action = disposables.add(new Action('browser.action', 'Browser Action', 'codicon codicon-globe', true, async () => { runs++; }));
		const child = disposables.add(new Action('browser.child', 'Child Action'));
		const rejectedItems: sinon.SinonSpy[] = [];
		const menu = disposables.add(new Menu(host, [action, new Separator(), new SubmenuAction('submenu', 'Browser Tools', [child])], {
			actionViewItemProvider: item => {
				const toolbarItem = new ActionViewItem(undefined, item, { icon: true, label: false });
				rejectedItems.push(sinon.spy(toolbarItem, 'dispose'));
				return toolbarItem;
			}
		}, unthemedMenuStyles));
		const items = Array.from(host.querySelectorAll<HTMLElement>('.action-menu-item:not(.separator)'));
		assert.deepStrictEqual({
			labels: items.map(item => item.textContent?.trim()),
			positions: items.map(item => item.getAttribute('aria-posinset')),
			sizes: items.map(item => item.getAttribute('aria-setsize')),
			submenu: items[1].getAttribute('aria-haspopup'),
			separators: host.querySelectorAll('.action-label.separator').length,
			disposed: rejectedItems.map(spy => spy.callCount),
		}, {
			labels: ['Browser Action', 'Browser Tools'], positions: ['1', '2'], sizes: ['2', '2'],
			submenu: 'true', separators: 1, disposed: [1],
		});
		menu.trigger(0);
		await Promise.resolve();
		assert.strictEqual(runs, 1);
	});

	// A menu positioned under a resting pointer can receive synthetic pointer events,
	// so hover must react only when the pointer coordinates actually change.
	test('stationary mouse does not change focus (#110594, #148158)', () => {
		const host = append(document.body, $('div'));
		disposables.add(toDisposable(() => host.remove()));
		const menu = disposables.add(new Menu(host, [
			disposables.add(new Action('first', 'First')),
			disposables.add(new Action('second', 'Second'))
		], {}, unthemedMenuStyles));
		const actionItems = Array.from(host.querySelectorAll<HTMLElement>('.action-item'));
		const getFocusedActions = () => actionItems.map((_, index) => menu.isFocused(index));

		menu.focus(true);
		const focusStates = [getFocusedActions()];

		actionItems[1].dispatchEvent(new MouseEvent(EventType.MOUSE_OVER, { bubbles: true }));
		focusStates.push(getFocusedActions());

		actionItems[1].dispatchEvent(new MouseEvent(EventType.MOUSE_MOVE, { bubbles: true }));
		focusStates.push(getFocusedActions());

		actionItems[1].dispatchEvent(new MouseEvent(EventType.MOUSE_MOVE, { bubbles: true, movementX: 1 }));
		focusStates.push(getFocusedActions());

		actionItems[1].dispatchEvent(new MouseEvent(EventType.MOUSE_MOVE, { bubbles: true, movementX: 1 }));
		focusStates.push(getFocusedActions());

		actionItems[0].dispatchEvent(new MouseEvent(EventType.MOUSE_MOVE, { bubbles: true, movementX: -1 }));
		focusStates.push(getFocusedActions());

		assert.deepStrictEqual(focusStates, [
			[true, false],
			[true, false],
			[true, false],
			[false, true],
			[false, true],
			[true, false]
		]);
	});

	test('stationary mouse does not open submenu (#110594, #148158)', () => {
		const clock = sinon.useFakeTimers();
		const host = append(document.body, $('div'));
		disposables.add(toDisposable(() => host.remove()));
		const submenu = new SubmenuAction('submenu', 'Submenu', [
			disposables.add(new Action('child', 'Child'))
		]);
		disposables.add(new Menu(host, [submenu], {}, unthemedMenuStyles));
		const submenuAction = host.querySelector<HTMLElement>('.action-item')!;
		const submenuItem = submenuAction.querySelector<HTMLElement>('.action-menu-item')!;

		submenuAction.dispatchEvent(new MouseEvent(EventType.MOUSE_OVER, { bubbles: true }));
		clock.tick(250);
		const expandedAfterMouseOver = submenuItem.getAttribute('aria-expanded');

		submenuAction.dispatchEvent(new MouseEvent(EventType.MOUSE_MOVE, { bubbles: true }));
		clock.tick(250);
		const expandedAfterStationaryMouseMove = submenuItem.getAttribute('aria-expanded');

		submenuAction.dispatchEvent(new MouseEvent(EventType.MOUSE_MOVE, { bubbles: true, movementY: 1 }));
		clock.tick(250);

		assert.deepStrictEqual({
			expandedAfterMouseOver,
			expandedAfterStationaryMouseMove,
			expandedAfterMouseMove: submenuItem.getAttribute('aria-expanded')
		}, {
			expandedAfterMouseOver: 'false',
			expandedAfterStationaryMouseMove: 'false',
			expandedAfterMouseMove: 'true'
		});
	});

	test('high contrast selection outline does not apply to nested submenu items (#327543)', () => {
		const host = append(document.body, $('div'));
		disposables.add(toDisposable(() => host.remove()));
		const shadowRoot = host.attachShadow({ mode: 'open' });

		const style = shadowRoot.appendChild($('style'));
		style.textContent = getMenuWidgetCSS(unthemedMenuStyles, true);

		const themeRoot = shadowRoot.appendChild($('.hc-black'));
		themeRoot.style.setProperty('--vscode-menu-selectionBorder', 'yellow');
		const actionBar = append(append(themeRoot, $('.monaco-menu')), $('.monaco-action-bar.vertical'));
		const focusedAction = append(actionBar, $('.action-item.focused'));
		const focusedMenuItem = append(focusedAction, $('a.action-menu-item'));

		const submenuActionBar = append(append(append(focusedAction, $('.monaco-submenu')), $('.monaco-menu')), $('.monaco-action-bar.vertical'));
		const nestedMenuItem = append(append(submenuActionBar, $('.action-item')), $('a.action-menu-item'));

		const window = getWindow(host);
		assert.deepStrictEqual({
			focused: window.getComputedStyle(focusedMenuItem).outlineStyle,
			nested: window.getComputedStyle(nestedMenuItem).outlineStyle,
		}, {
			focused: 'solid',
			nested: 'none',
		});
	});
});
