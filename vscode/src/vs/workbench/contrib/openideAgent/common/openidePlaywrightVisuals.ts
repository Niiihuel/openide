/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Serialized into the Playwright sandbox. Instrument public actions before they execute,
 * rather than following trusted DOM events (which also include the user's own mouse).
 * All dependencies are local because this function crosses the process boundary as source.
 */
export function openidePlaywrightVisuals(page: any, cursorScript: string): { page: any; dispose: () => Promise<void> } {
	const proxies = new WeakMap<object, any>();
	const labels: Record<string, string> = {
		click: 'Click', dblclick: 'Double click', tap: 'Tap', hover: 'Hover',
		fill: 'Typing', type: 'Typing', pressSequentially: 'Typing', insertText: 'Typing',
		press: 'Press key', check: 'Check', uncheck: 'Uncheck', setChecked: 'Toggle',
		selectOption: 'Select option', dragTo: 'Drag', move: 'Move pointer', down: 'Press', up: 'Release',
		wheel: 'Scroll', scrollIntoViewIfNeeded: 'Scroll to element',
		goto: 'Navigate', goBack: 'Go back', goForward: 'Go forward', reload: 'Reload',
		screenshot: 'Capture screenshot', evaluate: 'Inspect page',
	};
	const typing = new Set(['fill', 'type', 'pressSequentially', 'insertText']);
	const clicking = new Set(['click', 'dblclick', 'tap', 'check', 'uncheck', 'setChecked', 'down']);
	const factories = new Set(['locator', 'filter', 'first', 'last', 'nth', 'frameLocator', 'contentFrame', 'and', 'or']);
	const install = async () => { if (cursorScript) { await page.evaluate(cursorScript).catch(() => {}); } };
	const paint = async (method: string, args: unknown[] = []) => {
		if (!cursorScript) { return; }
		await page.evaluate(async ({ method, args }: any) => {
			const cursor = (globalThis as any).__openideAgentCursor;
			if (cursor) { await cursor[method](...args); }
		}, { method, args }).catch(() => {});
	};
	const wrap = (target: any, kind: string): any => {
		if (!target || typeof target !== 'object') { return target; }
		if (proxies.has(target)) { return proxies.get(target); }
		const proxy = new Proxy(target, {
			get(object, prop) {
				const value = Reflect.get(object, prop, object);
				if (prop === 'mouse' || prop === 'keyboard') { return wrap(value, prop); }
				if (typeof prop !== 'string' || typeof value !== 'function') { return value; }
				if (factories.has(prop) || prop.startsWith('getBy')) {
					return (...args: any[]) => wrap(Reflect.apply(value, object, args), prop === 'frameLocator' ? 'frame' : 'locator');
				}
				if (!labels[prop]) { return value.bind(object); }
				return async (...args: any[]) => {
					// Trial actions must not look like completed clicks.
					if (!cursorScript || args.some(arg => arg && typeof arg === 'object' && arg.trial === true)) {
						return Reflect.apply(value, object, args);
					}
					await install();
					await paint('label', [labels[prop]]);
					let locator = kind === 'locator' ? object : undefined;
					if (kind === 'page' && typeof args[0] === 'string' && (clicking.has(prop) || typing.has(prop) || prop === 'hover' || prop === 'selectOption' || prop === 'press')) {
						locator = page.locator(args[0]);
					}
					// Only decorate a resolved single target. Playwright retains responsibility for
					// strictness, actionability and the actual result; decoration cannot fail a flow.
					try {
						if (locator && prop !== 'evaluate' && prop !== 'screenshot') {
							if (await locator.count() === 1) {
								await locator.scrollIntoViewIfNeeded({ timeout: 700 });
								const rect = await locator.boundingBox({ timeout: 700 });
								if (rect) {
									await paint('highlight', [rect]);
									await paint('moveTo', [rect.x + rect.width / 2, rect.y + rect.height / 2, labels[prop]]);
								}
							}
						} else if (kind === 'mouse' && ['move', 'click', 'dblclick'].includes(prop)) {
							await paint('moveTo', [args[0], args[1], labels[prop]]);
						}
					} catch { /* Visual feedback never replaces the actual Playwright action. */ }
					if (clicking.has(prop)) { await paint('press'); }
					if (typing.has(prop)) { await paint('typing', [true]); }
					try {
						const result = await Reflect.apply(value, object, args);
						if (['goto', 'goBack', 'goForward', 'reload'].includes(prop)) { await install(); }
						return result;
					} catch (error) {
						await paint('fail', ['Action failed']);
						throw error;
					} finally {
						if (typing.has(prop)) { await paint('typing', [false]); }
						await paint('clearHighlight');
					}
				};
			}
		});
		proxies.set(target, proxy);
		return proxy;
	};
	return {
		page: wrap(page, 'page'),
		dispose: async () => { await paint('finish'); },
	};
}
