/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncLocalStorage } from 'node:async_hooks';
// eslint-disable-next-line local/code-import-patterns
import type { CDPSession, Frame, Locator, Page, Request } from 'playwright-core';
import { raceTimeout, RunOnceScheduler } from '../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { BrowserAgentAction, BrowserAgentEvent, BrowserAgentPoint, BrowserAgentTarget, BrowserAgentViewport } from '../common/browserAgentEvents.js';
import { IPlaywrightExecutionContext } from '../common/playwrightService.js';

type RuntimeKind = 'page' | 'frame' | 'frameLocator' | 'locator' | 'mouse' | 'keyboard' | 'touchscreen';
type ActionDetails = Pick<BrowserAgentEvent, 'point' | 'target' | 'sensitive' | 'scrollDelta' | 'url'>;
interface Execution extends IPlaywrightExecutionContext { readonly executionId: string; readonly executionSequence: number }
interface Navigation { readonly step: number; readonly execution: Execution }
interface ObservedAction extends Navigation { readonly action: BrowserAgentAction; readonly locator?: Locator; readonly position?: BrowserAgentPoint }

const locatorFactories = new Set(['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId', 'first', 'last', 'nth', 'filter', 'and', 'or', 'owner']);
const actions = new Map<string, BrowserAgentAction>([
	['goto', 'navigate'], ['reload', 'navigate'], ['goBack', 'navigate'], ['goForward', 'navigate'],
	['click', 'click'], ['tap', 'click'], ['dblclick', 'doubleClick'], ['down', 'click'],
	['fill', 'type'], ['type', 'type'], ['insertText', 'type'], ['pressSequentially', 'type'], ['clear', 'type'],
	['press', 'keypress'], ['up', 'keypress'], ['move', 'move'], ['wheel', 'scroll'],
	['scrollIntoViewIfNeeded', 'scroll'], ['hover', 'hover'], ['focus', 'focus'], ['screenshot', 'screenshot'],
	['check', 'click'], ['uncheck', 'click'], ['setChecked', 'click'], ['selectOption', 'click'],
]);

/**
 * Observes public Playwright APIs and emits serializable actions. The adapter owns no UI,
 * injects no drawing code into the page, and does not change input arguments or action timeouts.
 * Metadata reads are bounded and best effort: a failed highlight must never fail an action.
 */
export class PlaywrightBrowserAgentAdapter extends Disposable {
	readonly sessionId: string;
	private sequence = 0;
	private executionSequence = 0;
	private step = 0;
	private readonly execution = new AsyncLocalStorage<Execution>();
	private readonly active = new Set<Execution>();
	private readonly externalActions = new Map<string, Navigation>();
	private readonly proxies = new WeakMap<object, object>();
	private viewport: BrowserAgentViewport | undefined;
	private viewportRequest: Promise<BrowserAgentViewport | undefined> | undefined;
	private readonly targetRequests = new WeakMap<Locator, Promise<BrowserAgentTarget | undefined>>();
	private readonly targetBorders = new WeakMap<BrowserAgentTarget, BrowserAgentPoint>();
	private cursor: BrowserAgentPoint | undefined;
	private navigation: Navigation | undefined;
	private latestExecution: Execution | undefined;
	private latestAction: ObservedAction | undefined;
	private latestEvent: BrowserAgentEvent | undefined;
	private viewportReadAt = 0;
	private lastGeometry: string | undefined;
	private readonly resizeScheduler = this._register(new RunOnceScheduler(() => void this.refreshGeometry(), 80));
	private readonly geometryPoll = this._register(new RunOnceScheduler(() => void this.pollGeometry(), 300));
	private readonly instrumentedPage: Page;

	constructor(
		ownerSessionId: string,
		private readonly pageId: string,
		private readonly page: Page,
		private readonly publish: (event: BrowserAgentEvent) => void,
	) {
		super();
		this.sessionId = `${ownerSessionId}:${pageId}:${generateUuid()}`;
		this.instrumentedPage = this.wrap(page, 'page');
		const request = (request: Request) => this.onRequest(request);
		const navigated = (frame: Frame) => this.onNavigated(frame);
		const close = () => this.dispose();
		page.on('request', request);
		page.on('framenavigated', navigated);
		page.on('close', close);
		this._register(toDisposable(() => {
			page.off('request', request);
			page.off('framenavigated', navigated);
			page.off('close', close);
			this.execution.disable();
		}));
		void this.observeViewportResize();
	}

	/** CDP is used only by the runtime adapter; no protocol object crosses the event boundary. */
	private async observeViewportResize(): Promise<void> {
		let session: CDPSession | undefined;
		const resize = () => {
			// The visual session remains open between executions. Idle geometry is event-driven;
			// only active executions need the polling fallback used by hidden Chromium views.
			if (this.latestEvent && !this._store.isDisposed) { this.resizeScheduler.schedule(); }
		};
		this._register(toDisposable(() => {
			session?.off('Page.frameResized', resize);
			void session?.detach().catch(() => { });
		}));
		try {
			session = await this.page.context().newCDPSession(this.page);
			if (this._store.isDisposed) {
				await session.detach();
				return;
			}
			session.on('Page.frameResized', resize);
			await session.send('Page.enable');
		} catch {
			// Alternative runtimes or closing pages can lack CDP. Actions still carry fresh viewport metadata.
		}
	}

	private async refreshGeometry(): Promise<void> {
		const execution = this.latestExecution;
		const previous = this.latestEvent;
		if (!execution || !previous || previous.executionId !== execution.executionId || this._store.isDisposed) { return; }
		const current = this.latestAction?.execution === execution ? this.latestAction : undefined;
		await this.refreshViewport();
		const target = current?.locator ? await this.readTarget(current.locator) : undefined;
		if (execution !== this.latestExecution || previous !== this.latestEvent || this._store.isDisposed) { return; }
		const point = target ? this.targetPoint(target, current?.position) : undefined;
		const geometry = JSON.stringify({ viewport: this.viewport, target, point });
		if (geometry === this.lastGeometry) { return; }
		this.lastGeometry = geometry;
		if (point) { this.cursor = point; }
		const running = this.active.has(execution);
		this.emit({ action: running && current ? current.action : previous.action, phase: 'updated',
			status: running ? 'running' : previous.status, step: running && current ? current.step : previous.step,
			...(current?.locator ? { target: target ?? null, point } : {}),
		}, execution);
	}

	private async pollGeometry(): Promise<void> {
		try {
			await this.refreshGeometry();
		} finally {
			// Some embedded Chromium surfaces do not publish frameResized while hidden for a screencast.
			if (this.active.size && !this._store.isDisposed) { this.geometryPoll.schedule(); }
		}
	}

	/** Keeps observation alive across a deferred tool result until its actual execution settles. */
	async run<T>(callback: (page: Page) => T | Promise<T>, context?: IPlaywrightExecutionContext): Promise<T> {
		if (this._store.isDisposed) {
			throw new Error('Browser agent session is closed');
		}
		const execution: Execution = { ...context, executionId: context?.executionId ?? generateUuid(), executionSequence: ++this.executionSequence };
		this.latestExecution = execution;
		this.active.add(execution);
		this.geometryPoll.schedule();
		return this.execution.run(execution, async () => {
			await this.refreshViewport();
			this.emit({ action: 'wait', phase: 'started', status: 'running', target: null }, execution);
			try {
				const result = await callback(this.instrumentedPage);
				this.emit({ action: 'success', phase: 'completed', status: 'completed' }, execution);
				return result;
			} catch (error) {
				// Runtime errors can contain the typed value, selector and entire source. Do not forward them.
				this.emit({ action: 'error', phase: 'completed', status: 'error' }, execution);
				throw error;
			} finally {
				this.active.delete(execution);
				if (!this.active.size) { this.geometryPoll.cancel(); this.resizeScheduler.cancel(); }
				if (this.navigation?.execution === execution) { this.navigation = undefined; }
			}
		});
	}

	/** Native capture uses the same observable boundary without changing how the image is captured. */
	async reportAction(action: 'screenshot', phase: 'started' | 'completed' | 'error', context: IPlaywrightExecutionContext): Promise<void> {
		if (this._store.isDisposed || !context.executionId) { return; }
		if (phase === 'started') {
			const existing = this.externalActions.get(context.executionId);
			if (existing) { return; }
			const execution: Execution = { ...context, executionId: context.executionId, executionSequence: ++this.executionSequence };
			const entry = { step: ++this.step, execution };
			this.externalActions.set(execution.executionId, entry);
			this.latestExecution = execution;
			this.active.add(execution);
			await this.refreshViewport();
			this.emit({ action, phase, status: 'running', step: entry.step, target: null }, execution);
			return;
		}
		const entry = this.externalActions.get(context.executionId);
		if (entry) {
			this.externalActions.delete(context.executionId);
			this.active.delete(entry.execution);
			this.emit({ action: phase === 'error' ? 'error' : action, phase: 'completed', status: phase === 'error' ? 'error' : 'completed', step: entry.step, target: null }, entry.execution);
		}
	}

	private emit(event: Omit<BrowserAgentEvent, 'sessionId' | 'pageId' | 'sequence' | 'timestamp'>, execution = this.execution.getStore()): void {
		if (this._store.isDisposed) {
			return;
		}
		const next: BrowserAgentEvent = {
			...event, sessionId: this.sessionId, pageId: this.pageId,
			sequence: ++this.sequence, timestamp: Date.now(), viewport: this.viewport,
			toolCallId: execution?.toolCallId, executionId: execution?.executionId, executionSequence: execution?.executionSequence,
		};
		if (execution === this.latestExecution) { this.latestEvent = next; }
		this.publish(next);
	}

	private wrap<T extends object>(target: T, kind: RuntimeKind): T {
		const cached = this.proxies.get(target);
		if (cached) {
			return cached as T;
		}
		const methods = new Map<PropertyKey, unknown>();
		const proxy: T = new Proxy(target, {
			get: (object, key) => {
				const value = Reflect.get(object, key, object);
				if (typeof key !== 'string' || key.startsWith('_')) {
					return value;
				}
				if (methods.has(key)) {
					return methods.get(key);
				}
				if (kind === 'page' && (key === 'mouse' || key === 'keyboard' || key === 'touchscreen')) {
					const nested = this.wrap(value as object, key);
					methods.set(key, nested);
					return nested;
				}
				if (typeof value !== 'function') {
					return value;
				}
				const method = (...args: unknown[]) => {
					const invoke = () => Reflect.apply(value, object, args);
					const action = this.actionFor(kind, key);
					if (action && this.execution.getStore() && !this._store.isDisposed) {
						return this.perform(action, kind, key, object, args, invoke);
					}
					const result = invoke();
					if (locatorFactories.has(key)) {
						return this.wrap(result as object, 'locator');
					}
					if (key === 'frameLocator' || (kind === 'locator' && key === 'contentFrame')) {
						return result && this.wrap(result as object, 'frameLocator');
					}
					if (key === 'mainFrame' || key === 'frame') {
						return result && this.wrap(result as object, 'frame');
					}
					if (key === 'page' && result === this.page) {
						return this.instrumentedPage;
					}
					if (key === 'frames' || key === 'childFrames') {
						return (result as object[]).map(frame => this.wrap(frame, 'frame'));
					}
					if (kind === 'locator' && key === 'all') {
						return (result as Promise<Locator[]>).then(locators => locators.map(locator => this.wrap(locator, 'locator')));
					}
					return result === object ? proxy : result;
				};
				methods.set(key, method);
				return method;
			},
		});
		this.proxies.set(target, proxy);
		return proxy;
	}

	private actionFor(kind: RuntimeKind, method: string): BrowserAgentAction | undefined {
		if (kind === 'frameLocator') {
			return undefined;
		}
		if (method.startsWith('waitFor')) {
			return 'wait';
		}
		if (method === 'down' || method === 'up') {
			return kind === 'mouse' ? (method === 'down' ? 'click' : undefined) : 'keypress';
		}
		return actions.get(method);
	}

	private async perform(action: BrowserAgentAction, kind: RuntimeKind, method: string, target: object, args: unknown[], invoke: () => unknown): Promise<unknown> {
		const step = ++this.step;
		const execution = this.execution.getStore()!;
		if (Date.now() - this.viewportReadAt > 250) {
			await this.refreshViewport();
		}
		const locator = this.targetLocator(action, kind, target, args);
		const position = this.actionPosition(kind, method, args);
		const details = await this.details(action, kind, args, locator, position);
		this.latestAction = { action, step, execution, locator, position };
		this.lastGeometry = JSON.stringify({ viewport: this.viewport, target: details.target ?? undefined, point: details.point });
		if (details.point) {
			this.cursor = details.point;
		}
		if (action === 'navigate') {
			this.navigation = { step, execution };
		}
		this.emit({ action, phase: 'started', status: 'running', step, ...details }, execution);
		const previousUrl = this.page.url();
		try {
			const result = await invoke();
			const navigated = previousUrl !== this.page.url();
			if (navigated && this.latestAction?.step === step) {
				this.latestAction = { action: 'navigate', step, execution };
			}
			if (action === 'navigate') {
				await this.refreshViewport();
			}
			// Click may have auto-scrolled, or changed layout; report its final real target bounds.
			const after = !navigated && locator && action !== 'type' && action !== 'keypress' && action !== 'wait'
				? await this.readTarget(locator) : undefined;
			const point = after ? this.targetPoint(after, position) : details.point;
			if (point && this.latestAction?.step === step) { this.cursor = point; }
			this.emit({ action, phase: 'completed', status: 'running', step, ...details,
				...(after ? { target: after, point } : {}),
				...(action === 'navigate' || navigated ? { url: safeUrl(this.page.url()), target: null } : {}),
			}, execution);
			return result;
		} catch (error) {
			this.emit({ action: 'error', phase: 'completed', status: 'error', step, ...details }, execution);
			throw error;
		} finally {
			if (action === 'navigate' && this.navigation?.step === step) {
				this.navigation = undefined;
			}
		}
	}

	private targetLocator(action: BrowserAgentAction, kind: RuntimeKind, target: object, args: unknown[]): Locator | undefined {
		if (kind === 'locator') {
			return target as Locator;
		}
		if ((kind === 'page' || kind === 'frame') && ['click', 'doubleClick', 'type', 'keypress', 'hover', 'focus', 'scroll'].includes(action) && typeof args[0] === 'string') {
			return (target as Page | Frame).locator(args[0]);
		}
		if (kind === 'keyboard') {
			return this.page.locator(':focus');
		}
		return undefined;
	}

	private actionPosition(kind: RuntimeKind, method: string, args: unknown[]): BrowserAgentPoint | undefined {
		if (kind !== 'locator' && kind !== 'page' && kind !== 'frame') { return undefined; }
		if (!['click', 'dblclick', 'hover', 'tap', 'check', 'uncheck', 'setChecked'].includes(method)) { return undefined; }
		const options = args[(kind === 'locator' ? 0 : 1) + (method === 'setChecked' ? 1 : 0)];
		if (!options || typeof options !== 'object' || !('position' in options)) { return undefined; }
		const position = options.position;
		if (!position || typeof position !== 'object' || !('x' in position) || !('y' in position)) { return undefined; }
		return typeof position.x === 'number' && Number.isFinite(position.x) && typeof position.y === 'number' && Number.isFinite(position.y)
			? { x: position.x, y: position.y } : undefined;
	}

	private async details(action: BrowserAgentAction, kind: RuntimeKind, args: unknown[], locator?: Locator, position?: BrowserAgentPoint): Promise<ActionDetails> {
		const target = locator ? await this.readTarget(locator) : undefined;
		let point = target ? this.targetPoint(target, position) : undefined;
		if ((kind === 'mouse' || kind === 'touchscreen') && action !== 'scroll') {
			point = typeof args[0] === 'number' && typeof args[1] === 'number' ? { x: args[0], y: args[1] } : this.cursor;
		}
		if (action === 'scroll') {
			point ??= this.cursor ?? (this.viewport ? { x: this.viewport.width * 0.8, y: this.viewport.height * 0.6 } : undefined);
		}
		return {
			point, target: target ?? null, sensitive: target?.sensitive,
			...(action === 'navigate' ? { url: safeUrl(typeof args[0] === 'string' ? args[0] : this.page.url()) } : {}),
			...(kind === 'mouse' && action === 'scroll' ? { scrollDelta: { x: Number(args[0]) || 0, y: Number(args[1]) || 0 } } : {}),
		};
	}

	private targetPoint(target: BrowserAgentTarget, position?: BrowserAgentPoint): BrowserAgentPoint | undefined {
		if (!position) { return { x: target.x + target.width / 2, y: target.y + target.height / 2 }; }
		const border = this.targetBorders.get(target);
		if (!border) { return undefined; }
		// Playwright positions are CSS pixels from the padding box, with its final point
		// truncated to two decimals. boundingBox already includes the parent-frame offset.
		return {
			x: Math.trunc((target.x + border.x + position.x) * 100) / 100,
			y: Math.trunc((target.y + border.y + position.y) * 100) / 100,
		};
	}

	private async readTarget(locator: Locator): Promise<BrowserAgentTarget | undefined> {
		try {
			let request = this.targetRequests.get(locator);
			if (!request) {
				request = (async () => {
					const [bounds, metadata] = await Promise.allSettled([
						locator.boundingBox({ timeout: 100 }),
						locator.evaluateAll(elements => {
							const element = elements[0];
							if (!element) { return undefined; }
							const type = element.getAttribute('type') ?? '';
							const hints = ['name', 'id', 'autocomplete', 'aria-label'].map(name => element.getAttribute(name) ?? '').join(' ');
							const sensitive = type.toLowerCase() === 'password' || /password|passwd|secret|token|credential|api.?key|credit.?card|cc-number|one-time-code/i.test(hints);
							const labels = 'labels' in element ? (element as HTMLInputElement).labels : undefined;
							const label = sensitive ? undefined : element.getAttribute('aria-label')
								|| Array.from(labels ?? []).map(label => label.textContent ?? '').join(' ')
								|| element.getAttribute('placeholder')
								|| (/^(BUTTON|A|SUMMARY)$/.test(element.tagName) ? element.textContent : undefined);
							const style = element.ownerDocument.defaultView?.getComputedStyle(element);
							const border = { x: parseInt(style?.borderLeftWidth ?? '', 10) || 0, y: parseInt(style?.borderTopWidth ?? '', 10) || 0 };
							return { sensitive, label: label?.replace(/\s+/g, ' ').trim().slice(0, 100), border };
						}),
					]);
					const box = bounds.status === 'fulfilled' ? bounds.value : undefined;
					const info = metadata.status === 'fulfilled' ? metadata.value : undefined;
					if (!box) { return undefined; }
					const { border, ...metadataInfo } = info ?? {};
					const target = { ...box, ...metadataInfo };
					if (border) { this.targetBorders.set(target, border); }
					return target;
				})();
				this.targetRequests.set(locator, request);
				const requests = this.targetRequests;
				void request.then(() => requests.delete(locator), () => requests.delete(locator));
			}
			return await raceTimeout(request, 150);
		} catch {
			return undefined;
		}
	}

	private async refreshViewport(): Promise<void> {
		this.viewportReadAt = Date.now();
		try {
			if (!this.viewportRequest) {
				const request = this.page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio })).catch(() => undefined);
				this.viewportRequest = request;
				void request.then(() => { if (this.viewportRequest === request) { this.viewportRequest = undefined; } });
			}
			const viewport = await raceTimeout(this.viewportRequest, 150);
			if (viewport && viewport.width > 0 && viewport.height > 0) {
				this.viewport = viewport;
			} else {
				this.viewport = this.page.viewportSize() ?? this.viewport;
			}
		} catch {
			this.viewport = this.page.viewportSize() ?? this.viewport;
		}
	}

	private onRequest(request: Request): void {
		const execution = this.latestExecution;
		if (!execution || !this.active.has(execution) || this.navigation || !request.isNavigationRequest()) {
			return;
		}
		try {
			if (request.frame() !== this.page.mainFrame()) { return; }
		} catch { return; }
		const step = ++this.step;
		this.navigation = { step, execution };
		this.emit({ action: 'navigate', phase: 'started', status: 'running', step, target: null, url: safeUrl(request.url()) }, execution);
	}

	private onNavigated(frame: Frame): void {
		const navigation = this.navigation;
		if (!navigation || frame !== this.page.mainFrame()) {
			return;
		}
		this.navigation = undefined;
		this.emit({ action: 'navigate', phase: 'completed', status: 'running', step: navigation.step, target: null, url: safeUrl(frame.url()) }, navigation.execution);
		void this.refreshViewport();
	}

	override dispose(): void {
		if (!this._store.isDisposed) {
			this.emit({ action: 'wait', phase: 'completed', status: 'idle', closed: true, target: null }, this.latestExecution);
			this.active.clear();
			this.externalActions.clear();
		}
		super.dispose();
	}
}

/** The address displayed by the HUD omits credentials, query values and fragments. */
function safeUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			return `${url.origin}${url.pathname}`;
		}
		return url.protocol === 'about:' ? value : undefined;
	} catch {
		return undefined;
	}
}
