/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { $, getDomNodePagePosition, getWindow } from '../../../../browser/dom.js';
import { CONTEXT_VIEW_CLOSE_ANIMATION_DURATION_VARIABLE, CONTEXT_VIEW_MENU_MOTION_CLASS, ContextView, ContextViewDOMPosition, IDelegate } from '../../../../browser/ui/contextview/contextview.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('ContextView', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		sinon.restore();
	});

	test('theme motion animates a resize while retaining the native anchor', async () => {
		const container = $('.container');
		container.style.cssText = '--vscode-context-view-motion-duration:20ms;--vscode-context-view-motion-enter-duration:20ms';
		document.body.append(container);
		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);
		try {
			contextView.show({ getAnchor: () => ({ x: 100, y: 100, width: 20, height: 20 }), render: view => {
				view.style.minWidth = view.style.maxWidth = '100px'; view.style.height = '80px'; return null;
			} });
			const view = contextView.getViewElement();
			await Promise.all(view.getAnimations().map(animation => animation.finished));
			const before = view.getBoundingClientRect();
			view.style.height = '140px';
			contextView.layout();
			contextView.layout(); // Redundant picker/list layout must preserve the in-flight morph.
			assert.ok(view.getAnimations().length > 0);
			await Promise.all(view.getAnimations().map(animation => animation.finished));
			const after = view.getBoundingClientRect();
			assert.deepStrictEqual({ x: after.x, y: after.y, height: after.height }, { x: before.x, y: before.y, height: 140 });
		} finally { contextView.dispose(); container.remove(); }
	});

	test('shared close is inert and reopening disposes the previous view without hiding the new one', () => {
		const container = $('.container');
		container.style.cssText = '--vscode-context-view-motion-duration:20ms;--vscode-context-view-motion-enter-duration:20ms;--vscode-context-view-motion-exit-duration:20ms';
		document.body.append(container);
		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);
		let hides = 0; let disposed = 0;
		const delegate: IDelegate = { getAnchor: () => ({ x: 100, y: 100 }), onHide: () => hides++, render: view => {
			view.style.height = '80px'; return { dispose: () => disposed++ };
		} };
		try {
			contextView.show(delegate);
			const opacity = getWindow(container).getComputedStyle(contextView.getViewElement()).opacity;
			contextView.hide();
			assert.strictEqual(contextView.getViewElement().style.getPropertyValue('--vscode-context-view-motion-close-opacity'), opacity);
			assert.deepStrictEqual({ hides, disposed, inert: contextView.getViewElement().inert }, { hides: 1, disposed: 0, inert: true });
			contextView.show(delegate);
			assert.deepStrictEqual({ disposed, inert: contextView.getViewElement().inert, closing: contextView.getViewElement().classList.contains('context-view-shared-closing') }, { disposed: 1, inert: false, closing: false });
		} finally { contextView.dispose(); container.remove(); }
		assert.strictEqual(disposed, 2);
	});

	test('zero theme duration keeps immediate disposal and no animation', () => {
		const container = $('.container'); container.style.setProperty('--vscode-context-view-motion-duration', '0ms');
		document.body.append(container);
		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);
		let disposed = false;
		try {
			contextView.show({ getAnchor: () => ({ x: 0, y: 0 }), render: () => ({ dispose: () => { disposed = true; } }) });
			assert.strictEqual(contextView.getViewElement().getAnimations().length, 0);
			contextView.hide(); assert.strictEqual(disposed, true);
		} finally { contextView.dispose(); container.remove(); }
	});

	test('delegates receive real DOM event type and key for keyboard and outside click dismissal', () => {
		const container = $('.container'); document.body.append(container);
		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);
		const keys: string[] = []; let clicks = 0;
		try {
			contextView.show({ getAnchor: () => ({ x: 0, y: 0 }), render: () => null, onDOMEvent: event => {
				if (event.type === 'keydown') { keys.push((event as KeyboardEvent).key); }
				if (event.type === 'click') { clicks++; }
			} });
			contextView.getViewElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			assert.deepStrictEqual({ keys, clicks }, { keys: ['Escape'], clicks: 2 });
		} finally { contextView.dispose(); container.remove(); }
	});

	test('hide() is re-entrant safe and does not double-dispose render result (#319393)', () => {
		const container = $('.container');
		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);

		let disposeCount = 0;
		const delegate: IDelegate = {
			getAnchor: () => ({ x: 0, y: 0 }),
			render: () => ({
				dispose: () => {
					disposeCount++;
					if (disposeCount === 1) {
						// Simulate a re-entrant hide() call (e.g. via a blur event
						// fired while removing the rendered DOM node from the document).
						contextView.hide();
					}
				}
			})
		};

		contextView.show(delegate);

		assert.doesNotThrow(() => contextView.hide());
		assert.strictEqual(disposeCount, 1, 'render disposable must be disposed exactly once');

		contextView.dispose();
		container.remove();
	});

	test('shadow DOM host is layered with the context view', () => {
		const container = $('.container');
		const contextView = new ContextView(container, ContextViewDOMPosition.FIXED_SHADOW);
		const delegate: IDelegate = {
			getAnchor: () => ({ x: 0, y: 0 }),
			render: () => null,
			layer: 1
		};

		contextView.show(delegate);

		const shadowRootHost = container.getElementsByClassName('shadow-root-host')[0] as HTMLElement;
		assert.deepStrictEqual({
			position: shadowRootHost.style.position,
			top: shadowRootHost.style.top,
			left: shadowRootHost.style.left,
			width: shadowRootHost.style.width,
			height: shadowRootHost.style.height,
			zIndex: shadowRootHost.style.zIndex,
			contextViewZIndex: contextView.getViewElement().style.zIndex
		}, {
			position: 'fixed',
			top: '0px',
			left: '0px',
			width: '0px',
			height: '0px',
			zIndex: '2576',
			contextViewZIndex: '2576'
		});

		contextView.dispose();
		container.remove();
	});

	test('hide() delays render disposal for close animations', () => {
		const clock = sinon.useFakeTimers();
		const container = $('.container');
		container.classList.add('modern-ui', 'monaco-enable-motion');
		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);

		let disposeCount = 0;
		const delegate: IDelegate = {
			getAnchor: () => ({ x: 0, y: 0 }),
			render: () => ({
				dispose: () => {
					disposeCount++;
				}
			}),
			closeAnimation: {
				className: 'closing',
				duration: 100,
				requiredAncestorClasses: ['modern-ui', 'monaco-enable-motion']
			}
		};

		contextView.show(delegate);
		contextView.hide();
		contextView.hide();

		assert.deepStrictEqual({
			disposeCount,
			hasClosingClass: contextView.getViewElement().classList.contains('closing'),
			animationDuration: contextView.getViewElement().style.getPropertyValue(CONTEXT_VIEW_CLOSE_ANIMATION_DURATION_VARIABLE),
			inert: contextView.getViewElement().inert
		}, {
			disposeCount: 0,
			hasClosingClass: true,
			animationDuration: '100ms',
			inert: true
		});

		clock.tick(100);

		assert.deepStrictEqual({
			disposeCount,
			hasClosingClass: contextView.getViewElement().classList.contains('closing'),
			animationDuration: contextView.getViewElement().style.getPropertyValue(CONTEXT_VIEW_CLOSE_ANIMATION_DURATION_VARIABLE),
			inert: contextView.getViewElement().inert
		}, {
			disposeCount: 1,
			hasClosingClass: false,
			animationDuration: '',
			inert: false
		});

		contextView.dispose();
		assert.strictEqual(disposeCount, 1);
		container.remove();
	});

	test('positions absolute view when the container is position: static', () => {
		const host = $('.host');
		const spacer = $('.spacer');
		spacer.style.height = '60px';
		const container = $('.container');
		host.append(spacer, container);
		document.body.appendChild(host);

		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);
		contextView.show({
			getAnchor: () => ({ x: 100, y: 100, width: 1, height: 1 }),
			render: view => {
				view.style.width = '10px';
				view.style.height = '10px';
				return null;
			}
		});

		const position = getDomNodePagePosition(contextView.getViewElement());
		assert.deepStrictEqual({
			left: Math.round(position.left),
			top: Math.round(position.top)
		}, {
			left: 100,
			top: 101
		});

		contextView.dispose();
		host.remove();
	});

	test('positions absolute view in a bordered scrolling containing block', () => {
		const ancestor = $('.ancestor');
		ancestor.style.position = 'relative';
		ancestor.style.border = '10px solid transparent';
		ancestor.style.overflow = 'scroll';
		ancestor.style.width = '200px';
		ancestor.style.height = '200px';

		const container = $('.container');
		container.style.width = '500px';
		container.style.height = '500px';
		ancestor.appendChild(container);
		document.body.appendChild(ancestor);
		ancestor.scrollLeft = 30;
		ancestor.scrollTop = 40;

		const ancestorPosition = getDomNodePagePosition(ancestor);
		const anchor = {
			x: ancestorPosition.left + 100,
			y: ancestorPosition.top + 100,
			width: 1,
			height: 1
		};
		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);
		contextView.show({
			getAnchor: () => anchor,
			render: view => {
				view.style.width = '10px';
				view.style.height = '10px';
				return null;
			}
		});

		const position = getDomNodePagePosition(contextView.getViewElement());
		assert.deepStrictEqual({
			scrollLeft: ancestor.scrollLeft,
			scrollTop: ancestor.scrollTop,
			left: Math.round(position.left),
			top: Math.round(position.top)
		}, {
			scrollLeft: 30,
			scrollTop: 40,
			left: Math.round(anchor.x),
			top: Math.round(anchor.y + anchor.height)
		});

		contextView.dispose();
		ancestor.remove();
	});

	test('relayouts fixed view from the positioning origin', () => {
		const container = $('.container');
		document.body.appendChild(container);

		let anchorY = 100;
		const contextView = new ContextView(container, ContextViewDOMPosition.FIXED);
		contextView.show({
			getAnchor: () => ({ x: 100, y: anchorY, width: 1, height: 1 }),
			render: view => {
				view.textContent = 'x';
				view.style.width = '10px';
				view.style.height = '10px';
				return null;
			}
		});

		anchorY = 200;
		contextView.layout();

		const position = getDomNodePagePosition(contextView.getViewElement());
		assert.deepStrictEqual({
			left: Math.round(position.left),
			top: Math.round(position.top)
		}, {
			left: 100,
			top: 201
		});

		contextView.dispose();
		container.remove();
	});

	test('menu motion does not retain a containing block for submenus (#326248)', () => {
		const container = $('.container');
		container.classList.add('modern-ui', 'monaco-enable-motion');
		document.body.appendChild(container);

		const surface = $('.monaco-scrollable-element');
		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);
		contextView.show({
			getAnchor: () => ({ x: 0, y: 0 }),
			render: view => {
				view.appendChild(surface);
				return null;
			}
		});
		contextView.getViewElement().classList.add(CONTEXT_VIEW_MENU_MOTION_CLASS);

		const style = getWindow(surface).getComputedStyle(surface);
		assert.deepStrictEqual({
			animationFillMode: style.animationFillMode,
			willChange: style.willChange
		}, {
			animationFillMode: 'backwards',
			willChange: 'opacity'
		});

		contextView.dispose();
		container.remove();
	});
});
