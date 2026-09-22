/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'node:events';
// eslint-disable-next-line local/code-import-patterns
import type { BrowserContext, CDPSession, Frame, Locator, Mouse, Page, Request } from 'playwright-core';
import { DeferredPromise } from '../../../../base/common/async.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BrowserAgentEvent } from '../../common/browserAgentEvents.js';
import { PlaywrightBrowserAgentAdapter } from '../../node/playwrightBrowserAgentAdapter.js';

class TestLocator extends mock<Locator>() {
	box = { x: 80, y: 40, width: 100, height: 30 };
	info = { label: 'Search', sensitive: false, border: { x: 0, y: 0 } };
	metadataGate: DeferredPromise<typeof this.info> | undefined;
	metadataReads = 0;
	readonly pointerCalls: { method: string; options?: { position?: { x: number; y: number } } }[] = [];
	input = '';
	failure: Error | undefined;
	onClick: (() => void) | undefined;
	override async boundingBox() { return this.box; }
	override evaluateAll: Locator['evaluateAll'] = async () => { this.metadataReads++; return (this.metadataGate ? await this.metadataGate.p : this.info) as never; };
	override first(): Locator { return this; }
	override async click(options?: Parameters<Locator['click']>[0]): Promise<void> {
		this.pointerCalls.push({ method: 'click', options });
		if (this.failure) { throw this.failure; }
		this.onClick?.();
	}
	override async dblclick(options?: Parameters<Locator['dblclick']>[0]): Promise<void> { this.pointerCalls.push({ method: 'dblclick', options }); }
	override async setChecked(_checked: boolean, options?: Parameters<Locator['setChecked']>[1]): Promise<void> { this.pointerCalls.push({ method: 'setChecked', options }); }
	override async fill(value: string): Promise<void> { this.input = value; }
	override async hover(options?: Parameters<Locator['hover']>[0]): Promise<void> { this.pointerCalls.push({ method: 'hover', options }); }
}

class TestPage extends mock<Page>() {
	readonly events = new EventEmitter();
	readonly resizeEvents = new EventEmitter();
	readonly element = new TestLocator();
	currentUrl = 'http://localhost:3000/';
	viewport = { width: 1000, height: 600, deviceScaleFactor: 2 };
	viewportGate: DeferredPromise<{ width: number; height: number; deviceScaleFactor: number }> | undefined;
	viewportReads = 0;
	private readonly cdp = new class extends mock<CDPSession>() {
		constructor(private readonly events: EventEmitter) { super(); }
		override on(event: string, listener: (...args: never[]) => void): this { this.events.on(event, listener as (...args: unknown[]) => void); return this; }
		override off(event: string, listener: (...args: never[]) => void): this { this.events.off(event, listener as (...args: unknown[]) => void); return this; }
		override send: CDPSession['send'] = async () => ({}) as never;
		override async detach(): Promise<void> { }
	}(this.resizeEvents);
	private readonly browserContext = new class extends mock<BrowserContext>() {
		constructor(private readonly cdp: CDPSession) { super(); }
		override async newCDPSession(): Promise<CDPSession> { return this.cdp; }
	}(this.cdp);
	readonly rootFrame = new class extends mock<Frame>() {
		constructor(private readonly element: TestLocator) { super(); }
		override url() { return 'http://localhost:3000/next?token=hidden'; }
		override locator(): Locator { return this.element; }
		override async hover(_selector: string, options?: Parameters<Frame['hover']>[1]): Promise<void> { await this.element.hover(options); }
	}(this.element);
	override readonly mouse = new class extends mock<Mouse>() {
		override async move(): Promise<void> { }
		override async click(): Promise<void> { }
		override async dblclick(): Promise<void> { }
		override async down(): Promise<void> { }
		override async wheel(): Promise<void> { }
	};
	override on(event: string, listener: (...args: never[]) => void): this { this.events.on(event, listener as (...args: unknown[]) => void); return this; }
	override off(event: string, listener: (...args: never[]) => void): this { this.events.off(event, listener as (...args: unknown[]) => void); return this; }
	override evaluate: Page['evaluate'] = async () => { this.viewportReads++; return (this.viewportGate ? await this.viewportGate.p : this.viewport) as never; };
	override context(): BrowserContext { return this.browserContext; }
	override viewportSize() { return { width: 1000, height: 600 }; }
	override url() { return this.currentUrl; }
	override mainFrame(): Frame { return this.rootFrame; }
	override locator(): Locator { return this.element; }
	override getByRole(): Locator { return this.element; }
	override async click(_selector: string, options?: Parameters<Page['click']>[1]): Promise<void> { await this.element.click(options); }
	override async goto(url: string) { this.currentUrl = url; return null; }
}

suite('PlaywrightBrowserAgentAdapter', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(pageId = 'page', onEvent?: (event: BrowserAgentEvent) => void) {
		const page = new TestPage();
		const events: BrowserAgentEvent[] = [];
		const adapter = disposables.add(new PlaywrightBrowserAgentAdapter('owner', pageId, page, event => { events.push(event); onEvent?.(event); }));
		return { page, events, adapter };
	}

	test('observes actions and locator chains without leaking typed values or URL credentials', async () => {
		const { adapter, page, events } = fixture();
		await adapter.run(async page => {
			await page.goto('https://name:password@localhost:3000/settings?token=secret#fragment');
			await page.getByRole('textbox').first().click();
			await page.getByRole('textbox').fill('private input');
			await page.mouse.wheel(0, 120);
		}, { toolCallId: 'tool', executionId: 'execution' });
		assert.deepStrictEqual({
			actions: events.filter(event => event.phase === 'started').map(event => event.action),
			input: page.element.input,
			target: events.find(event => event.action === 'click')?.target,
			point: events.find(event => event.action === 'click')?.point,
			viewport: events[0].viewport,
			url: events.find(event => event.action === 'navigate')?.url,
			correlated: events.every(event => event.toolCallId === 'tool' && event.executionId === 'execution' && event.pageId === 'page'),
			secretLeaked: /private input|password|secret|fragment/.test(JSON.stringify(events)),
			status: events.at(-1)?.status,
		}, {
			actions: ['wait', 'navigate', 'click', 'type', 'scroll'], input: 'private input',
			target: { x: 80, y: 40, width: 100, height: 30, label: 'Search', sensitive: false },
			point: { x: 130, y: 55 }, viewport: { width: 1000, height: 600, deviceScaleFactor: 2 },
			url: 'https://localhost:3000/settings', correlated: true, secretLeaked: false, status: 'completed',
		});
	});

	test('positions pointer actions relative to the padding box without changing runtime options', async () => {
		const { adapter, page, events } = fixture();
		page.element.info.border = { x: 4, y: 6 };
		const options = { position: { x: 7.125, y: 9.375 }, timeout: 123 };
		await adapter.run(async observed => {
			await observed.locator('input').click(options);
			await observed.locator('input').dblclick(options);
			await observed.locator('input').hover(options);
			await observed.locator('input').setChecked(true, options);
			await observed.click('input', options);
			await observed.mainFrame().hover('input', options);
		});
		assert.deepStrictEqual({
			points: events.filter(event => event.target).map(event => event.point),
			methods: page.element.pointerCalls.map(call => call.method),
			optionsPreserved: page.element.pointerCalls.every(call => call.options === options),
			borderLeaked: JSON.stringify(events).includes('border'),
		}, {
			points: Array.from({ length: 12 }, () => ({ x: 91.12, y: 55.37 })),
			methods: ['click', 'dblclick', 'hover', 'setChecked', 'click', 'hover'],
			optionsPreserved: true, borderLeaked: false,
		});
	});

	test('keeps the requested hotspot after auto-scroll and geometry updates', async () => {
		const updated = new DeferredPromise<void>();
		const { adapter, page, events } = fixture('page', event => {
			if (event.action === 'click' && event.phase === 'updated') { updated.complete(); }
		});
		page.element.box = { x: 80, y: 1400, width: 100, height: 30 };
		page.element.info.border = { x: 3, y: 5 };
		page.element.onClick = () => { page.element.box = { x: 80, y: 200, width: 100, height: 30 }; };
		await adapter.run(async observed => {
			await observed.locator('input').click({ position: { x: 8, y: 10 } });
			await updated.p;
			await observed.mouse.wheel(0, 120);
		});
		assert.deepStrictEqual(events.filter(event => event.action === 'click' || (event.action === 'scroll' && event.phase === 'started')).map(event => ({
			action: event.action, phase: event.phase, point: event.point,
		})), [
			{ action: 'click', phase: 'started', point: { x: 91, y: 1415 } },
			{ action: 'click', phase: 'completed', point: { x: 91, y: 215 } },
			{ action: 'click', phase: 'updated', point: { x: 91, y: 215 } },
			{ action: 'scroll', phase: 'started', point: { x: 91, y: 215 } },
		]);
	});

	test('keeps runtime failure in the tool result and emits only safe error state', async () => {
		const { adapter, page, events } = fixture();
		page.element.failure = new Error('Call log fill("sk-secret-token")');
		await assert.rejects(adapter.run(observed => observed.locator('input').click()), /sk-secret-token/);
		assert.deepStrictEqual({ status: events.at(-1)?.status, leaked: JSON.stringify(events).includes('sk-secret-token') }, { status: 'error', leaked: false });
	});

	test('refreshes completed geometry on resize without restarting or polling the idle execution', async () => {
		const updated = new DeferredPromise<void>();
		const { adapter, page, events } = fixture('page', event => {
			if (event.phase === 'updated' && event.status === 'completed') { updated.complete(); }
		});
		await adapter.run(observed => observed.locator('input').click(), { executionId: 'completed' });
		page.viewport = { width: 700, height: 450, deviceScaleFactor: 2 };
		page.element.box = { x: 20, y: 60, width: 300, height: 40 };
		page.resizeEvents.emit('Page.frameResized');
		await updated.p;
		const reads = page.viewportReads;
		await new Promise(resolve => setTimeout(resolve, 350));
		assert.deepStrictEqual({
			last: { action: events.at(-1)?.action, status: events.at(-1)?.status, viewport: events.at(-1)?.viewport, point: events.at(-1)?.point, executionId: events.at(-1)?.executionId },
			idleReads: page.viewportReads - reads,
		}, {
			last: { action: 'success', status: 'completed', viewport: page.viewport, point: { x: 170, y: 80 }, executionId: 'completed' },
			idleReads: 0,
		});
		adapter.dispose();
		assert.deepStrictEqual(page.resizeEvents.eventNames(), []);
	});

	test('reports mouse.down at the last mouse position', async () => {
		const { adapter, events } = fixture();
		await adapter.run(async observed => {
			await observed.mouse.move(25, 30);
			await observed.mouse.down();
		});
		assert.deepStrictEqual(events.filter(event => event.action === 'click').map(event => event.point), [{ x: 25, y: 30 }, { x: 25, y: 30 }]);
	});

	test('does not lose context when two invocations finish in reverse order', async () => {
		const { adapter, events } = fixture();
		const firstStarted = new DeferredPromise<void>();
		const releaseFirst = new DeferredPromise<void>();
		const first = adapter.run(async page => {
			firstStarted.complete();
			await releaseFirst.p;
			await page.mouse.click(1, 2);
		}, { toolCallId: 'first' });
		await firstStarted.p;
		await adapter.run(page => page.mouse.click(3, 4), { toolCallId: 'second' });
		releaseFirst.complete();
		await first;
		assert.deepStrictEqual(events.filter(event => event.action === 'click' && event.phase === 'started').map(event => ({ tool: event.toolCallId, point: event.point, execution: event.executionSequence })), [
			{ tool: 'second', point: { x: 3, y: 4 }, execution: 2 }, { tool: 'first', point: { x: 1, y: 2 }, execution: 1 },
		]);
		assert.ok(events.every((event, i) => !i || event.sequence > events[i - 1].sequence));
	});

	test('observes click navigation without adding user browsing to the session', async () => {
		const { adapter, page, events } = fixture();
		const request = new class extends mock<Request>() {
			override isNavigationRequest() { return true; }
			override frame() { return page.rootFrame; }
			override url() { return 'http://localhost:3000/next?token=hidden'; }
		};
		page.element.onClick = () => {
			page.currentUrl = page.rootFrame.url();
			page.events.emit('request', request);
			page.events.emit('framenavigated', page.rootFrame);
		};
		await adapter.run(observed => observed.getByRole('button').click());
		const count = events.length;
		page.events.emit('request', request);
		page.events.emit('framenavigated', page.rootFrame);
		assert.deepStrictEqual({
			actions: events.filter(event => event.action === 'navigate').map(event => event.phase), userObserved: events.length > count,
			navigatedClickTarget: events.find(event => event.action === 'click' && event.phase === 'completed')?.target,
		}, { actions: ['started', 'completed'], userObserved: false, navigatedClickTarget: null });
	});

	test('disposes listeners, fences late completion and keeps other sessions alive', async () => {
		const first = fixture('first');
		const second = fixture('second');
		const started = new DeferredPromise<void>();
		const release = new DeferredPromise<void>();
		const run = first.adapter.run(async () => { started.complete(); await release.p; });
		await started.p;
		first.adapter.dispose();
		const count = first.events.length;
		release.complete();
		await run;
		await second.adapter.run(page => page.mouse.move(25, 30));
		assert.deepStrictEqual({
			listeners: first.page.events.eventNames(), closed: first.events.at(-1)?.closed,
			lateEvents: first.events.length - count, otherStatus: second.events.at(-1)?.status,
		}, { listeners: [], closed: true, lateEvents: 0, otherStatus: 'completed' });
		await assert.rejects(first.adapter.run(async () => undefined), /closed/);
	});

	test('preserves public object identities and never intercepts private runtime methods', async () => {
		const { adapter } = fixture();
		await adapter.run(async page => {
			assert.strictEqual(page.mouse, page.mouse);
			assert.strictEqual(page.locator('input'), page.locator('input'));
			assert.strictEqual(page.locator('input').click, page.locator('input').click);
		});
	});

	test('reports native capture with one stable step and ignores duplicate or closed completions', async () => {
		const { adapter, events } = fixture();
		const context = { executionId: 'capture', toolCallId: 'capture-tool' };
		await adapter.reportAction('screenshot', 'started', context);
		await adapter.reportAction('screenshot', 'started', context);
		await adapter.reportAction('screenshot', 'completed', context);
		await adapter.reportAction('screenshot', 'completed', context);
		assert.deepStrictEqual(events.map(event => ({ action: event.action, phase: event.phase, step: event.step, status: event.status, tool: event.toolCallId })), [
			{ action: 'screenshot', phase: 'started', step: 1, status: 'running', tool: 'capture-tool' },
			{ action: 'screenshot', phase: 'completed', step: 1, status: 'completed', tool: 'capture-tool' },
		]);
		const failure = { executionId: 'failed-capture', toolCallId: 'capture-tool' };
		await adapter.reportAction('screenshot', 'started', failure);
		await adapter.reportAction('screenshot', 'error', failure);
		assert.deepStrictEqual({ action: events.at(-1)?.action, status: events.at(-1)?.status, execution: events.at(-1)?.executionSequence }, { action: 'error', status: 'error', execution: 2 });
		adapter.dispose();
		const count = events.length;
		await adapter.reportAction('screenshot', 'error', context);
		assert.strictEqual(events.length, count);
	});

	test('bounds pending metadata reads while a modal blocks the page', async () => {
		const { adapter, page } = fixture();
		page.viewportGate = new DeferredPromise();
		page.element.metadataGate = new DeferredPromise();
		const release = new DeferredPromise<void>();
		const run = adapter.run(async observed => { await observed.locator('input').hover(); await release.p; });
		await new Promise(resolve => setTimeout(resolve, 950));
		assert.deepStrictEqual({ viewportReads: page.viewportReads, metadataReads: page.element.metadataReads }, { viewportReads: 1, metadataReads: 1 });
		page.viewportGate.complete({ width: 1000, height: 600, deviceScaleFactor: 2 });
		page.element.metadataGate.complete(page.element.info);
		release.complete();
		await run;
	});
});
