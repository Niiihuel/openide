/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType, getWindow } from '../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { CDPEvent, CDPResponse, CDPTargetInfo } from '../../../../platform/browserView/common/cdp/types.js';
import { IBrowserViewCDPService } from '../common/browserView.js';

export interface IBrowserAgentFrame {
	readonly dataUrl: string;
	readonly width: number;
	readonly height: number;
	readonly pageScaleFactor: number;
	readonly offsetTop: number;
	readonly scrollX: number;
	readonly scrollY: number;
}

export interface IBrowserAgentInputPoint {
	readonly x: number;
	readonly y: number;
}

interface IScreencastFrame {
	readonly data: string;
	readonly sessionId: number;
	readonly metadata: {
		readonly deviceWidth: number;
		readonly deviceHeight: number;
		readonly pageScaleFactor: number;
		readonly offsetTop: number;
		readonly scrollOffsetX: number;
		readonly scrollOffsetY: number;
	};
}

interface IPendingCommand {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timer: IDisposable;
}

/**
 * Presents frames from the existing native browser in a Workbench DOM surface.
 * A separate CDP group preserves the automation runtime's connection and page.
 * The renderer can paint its native overlay above these frames without creating
 * another WebView or changing the page's DOM.
 */
export class BrowserAgentFrameBridge extends Disposable {
	private readonly frameEmitter = this._register(new Emitter<IBrowserAgentFrame>());
	readonly onDidFrame = this.frameEmitter.event;
	private readonly errorEmitter = this._register(new Emitter<Error>());
	readonly onDidError = this.errorEmitter.event;
	private readonly connectionStore = this._register(new DisposableStore());
	private readonly inputBindings = this._register(new DisposableStore());
	private readonly pending = new Map<number, IPendingCommand>();
	private groupId: string | undefined;
	private sessionId: string | undefined;
	private commandId = 0;
	private closed = false;
	private startPromise: Promise<void> | undefined;

	constructor(
		private readonly browserId: string,
		private readonly cdpService: IBrowserViewCDPService,
	) {
		super();
	}

	start(): Promise<void> {
		return this.startPromise ??= this.connect();
	}

	private async connect(): Promise<void> {
		if (this.closed) {
			throw new Error('Browser frame bridge is closed');
		}
		const groupId = await this.cdpService.createSessionGroup(this.browserId);
		if (this.closed) {
			await this.cdpService.destroySessionGroup(groupId);
			return;
		}
		this.groupId = groupId;
		this.connectionStore.add(this.cdpService.onCDPMessage(groupId)(message => this.acceptMessage(message)));
		this.connectionStore.add(this.cdpService.onDidDestroy(groupId)(() => {
			if (!this.closed) {
				this.errorEmitter.fire(new Error('Browser frame connection closed'));
				this.dispose();
			}
		}));
		try {
			const { targetInfos } = await this.sendCommand<{ targetInfos: CDPTargetInfo[] }>('Target.getTargets');
			const target = targetInfos.find(candidate => candidate.vscodeBrowserViewId === this.browserId)
				?? targetInfos.find(candidate => candidate.type === 'page');
			if (!target) {
				throw new Error('Browser frame target is unavailable');
			}
			const attached = await this.sendCommand<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
			this.sessionId = attached.sessionId;
			await this.sendCommand('Page.enable', {}, this.sessionId);
			await this.sendCommand('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 }, this.sessionId);
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	private acceptMessage(message: CDPResponse | CDPEvent): void {
		if (this.closed) {
			return;
		}
		if ('id' in message) {
			const pending = this.pending.get(message.id);
			if (pending) {
				this.pending.delete(message.id);
				pending.timer.dispose();
				if (message.error) {
					pending.reject(new Error(message.error.message));
				} else {
					pending.resolve(message.result);
				}
			}
			return;
		}
		if (message.method !== 'Page.screencastFrame' || message.sessionId !== this.sessionId) {
			return;
		}
		const frame = message.params as IScreencastFrame;
		// Acknowledge even unusable frames so the browser never stalls its producer.
		this.runInput(this.sendCommand('Page.screencastFrameAck', { sessionId: frame.sessionId }, this.sessionId));
		const metadata = frame.metadata;
		if (!frame.data || !metadata || !(metadata.deviceWidth > 0) || !(metadata.deviceHeight > 0)) {
			return;
		}
		this.frameEmitter.fire({
			dataUrl: `data:image/jpeg;base64,${frame.data}`,
			width: metadata.deviceWidth,
			height: metadata.deviceHeight,
			pageScaleFactor: metadata.pageScaleFactor || 1,
			offsetTop: metadata.offsetTop || 0,
			scrollX: metadata.scrollOffsetX || 0,
			scrollY: metadata.scrollOffsetY || 0,
		});
	}

	private sendCommand<T = object>(method: string, params: object = {}, sessionId?: string): Promise<T> {
		const groupId = this.groupId;
		if (this.closed || !groupId) {
			return Promise.reject(new Error('Browser frame bridge is closed'));
		}
		const id = ++this.commandId;
		return new Promise<T>((resolve, reject) => {
			const timer = disposableTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Browser frame command timed out: ${method}`));
			}, 5000);
			this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
			void this.cdpService.sendCDPMessage(groupId, { id, method, params, sessionId }).catch(error => {
				const pending = this.pending.get(id);
				if (pending) {
					this.pending.delete(id);
					pending.timer.dispose();
					pending.reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
		});
	}

	private runInput(promise: Promise<object>): void {
		void promise.catch(error => {
			if (!this.closed) {
				this.errorEmitter.fire(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	dispatchMouse(type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', point: IBrowserAgentInputPoint, button: 'left' | 'middle' | 'right' | 'none' = 'none', buttons = 0, clickCount = 0, modifiers = 0): void {
		if (this.sessionId && !this.closed) {
			this.runInput(this.sendCommand('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button, buttons, clickCount, modifiers }, this.sessionId));
		}
	}

	dispatchWheel(point: IBrowserAgentInputPoint, deltaX: number, deltaY: number, modifiers = 0): void {
		if (this.sessionId && !this.closed) {
			this.runInput(this.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX, deltaY, modifiers }, this.sessionId));
		}
	}

	dispatchKey(type: 'keyDown' | 'keyUp', event: Pick<KeyboardEvent, 'key' | 'code' | 'keyCode' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat'>): void {
		if (!this.sessionId || this.closed) {
			return;
		}
		const text = type === 'keyDown' && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey ? event.key : undefined;
		this.runInput(this.sendCommand('Input.dispatchKeyEvent', {
			type: type === 'keyDown' && !text ? 'rawKeyDown' : type,
			key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode, nativeVirtualKeyCode: event.keyCode,
			text, unmodifiedText: text, autoRepeat: event.repeat, modifiers: this.modifiers(event),
		}, this.sessionId));
	}

	insertText(text: string): void {
		if (this.sessionId && !this.closed && text) {
			this.runInput(this.sendCommand('Input.insertText', { text }, this.sessionId));
		}
	}

	/** Returns the listeners owned by this surface, without retaining a replaced surface. */
	bindInput(surface: HTMLElement, mapPoint: (clientX: number, clientY: number) => IBrowserAgentInputPoint | undefined, readClipboard?: () => Promise<string>): IDisposable {
		const store = this.inputBindings.add(new DisposableStore());
		store.add(toDisposable(() => this.inputBindings.deleteAndLeak(store)));
		const targetWindow = getWindow(surface);
		const moveFrame = store.add(new MutableDisposable<IDisposable>());
		let lastMove: MouseEvent | undefined;
		let lastPoint: IBrowserAgentInputPoint | undefined;
		const pressed = new Map<number, MouseEvent>();
		const keys = new Map<string, KeyboardEvent>();
		const buttonName = (button: number) => button === 1 ? 'middle' : button === 2 ? 'right' : 'left';
		const buttons = () => [...pressed.keys()].reduce((mask, button) => mask | (button === 0 ? 1 : button === 1 ? 4 : 2), 0);
		const releaseMouse = (event: MouseEvent) => {
			if (!pressed.delete(event.button)) { return; }
			const point = mapPoint(event.clientX, event.clientY) ?? lastPoint;
			if (point) { this.dispatchMouse('mouseReleased', point, buttonName(event.button), buttons(), event.detail, this.modifiers(event)); }
		};
		const releaseAll = () => {
			moveFrame.clear();
			lastMove = undefined;
			for (const [button, event] of pressed) {
				pressed.delete(button);
				if (lastPoint) { this.dispatchMouse('mouseReleased', lastPoint, buttonName(button), buttons(), event.detail); }
			}
			for (const event of keys.values()) { this.dispatchKey('keyUp', event); }
			keys.clear();
		};
		const scheduleMove = (event: MouseEvent) => {
			lastMove = event;
			if (!moveFrame.value) {
				const handle = targetWindow.requestAnimationFrame(() => {
					moveFrame.clear();
					if (lastMove) {
						const point = mapPoint(lastMove.clientX, lastMove.clientY) ?? (pressed.size ? lastPoint : undefined);
						if (point) {
							lastPoint = point;
							this.dispatchMouse('mouseMoved', point, pressed.size ? buttonName(pressed.keys().next().value!) : 'none', buttons(), 0, this.modifiers(lastMove));
						}
						lastMove = undefined;
					}
				});
				moveFrame.value = toDisposable(() => targetWindow.cancelAnimationFrame(handle));
			}
		};
		store.add(addDisposableListener(surface, EventType.MOUSE_MOVE, (event: MouseEvent) => scheduleMove(event)));
		// Capture releases outside the mirror as well; otherwise a dragged page keeps a stuck button.
		store.add(addDisposableListener(targetWindow, EventType.MOUSE_MOVE, (event: MouseEvent) => {
			if (pressed.size) { scheduleMove(event); }
		}, true));
		store.add(addDisposableListener(targetWindow, EventType.MOUSE_UP, (event: MouseEvent) => releaseMouse(event), true));
		store.add(addDisposableListener(surface, EventType.MOUSE_DOWN, (event: MouseEvent) => {
			const point = mapPoint(event.clientX, event.clientY);
			if (!point) { return; }
			event.preventDefault();
			surface.focus();
			lastPoint = point;
			pressed.set(event.button, event);
			this.dispatchMouse('mousePressed', point, buttonName(event.button), buttons(), event.detail, this.modifiers(event));
		}));
		store.add(addDisposableListener(surface, EventType.MOUSE_UP, (event: MouseEvent) => releaseMouse(event)));
		store.add(addDisposableListener(targetWindow, EventType.BLUR, releaseAll));
		store.add(addDisposableListener(surface, EventType.BLUR, releaseAll));
		store.add(addDisposableListener(surface, EventType.CONTEXT_MENU, (event: MouseEvent) => event.preventDefault()));
		store.add(addDisposableListener(surface, EventType.MOUSE_WHEEL, (event: WheelEvent) => {
			const point = mapPoint(event.clientX, event.clientY);
			if (point) {
				event.preventDefault();
				const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1;
				this.dispatchWheel(point, event.deltaX * multiplier, event.deltaY * multiplier, this.modifiers(event));
			}
		}, { passive: false }));
		store.add(addDisposableListener(surface, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.isComposing) { return; }
			const key = event.key.toLowerCase();
			if (readClipboard && ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'v' || event.shiftKey && event.key === 'Insert')) {
				event.preventDefault(); event.stopPropagation();
				void readClipboard().then(text => {
					if (!store.isDisposed && surface.ownerDocument.activeElement === surface) { this.insertText(text); }
				}).catch(() => { /* Clipboard access failure must not tear down the browser surface. */ });
				return;
			}
			// Let Workbench commands (command palette, close editor, etc.) retain their normal bindings.
			const editingKey = ['a', 'c', 'x', 'v', 'z', 'y', 'backspace', 'delete', 'insert', 'home', 'end', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'control', 'meta', 'shift', 'alt'].includes(key);
			if ((event.ctrlKey || event.metaKey) && !editingKey || /^F\d+$/.test(event.key)) { return; }
			event.preventDefault(); event.stopPropagation();
			keys.set(event.code || event.key, event);
			this.dispatchKey('keyDown', event);
		}));
		store.add(addDisposableListener(surface, EventType.KEY_UP, (event: KeyboardEvent) => {
			if (!event.isComposing && keys.delete(event.code || event.key)) { event.preventDefault(); event.stopPropagation(); this.dispatchKey('keyUp', event); }
		}));
		store.add(addDisposableListener(surface, 'compositionend', (event: CompositionEvent) => this.insertText(event.data)));
		store.add(addDisposableListener(surface, 'paste', (event: ClipboardEvent) => {
			const text = event.clipboardData?.getData('text/plain');
			if (text) { event.preventDefault(); this.insertText(text); }
		}));
		store.add(toDisposable(releaseAll));
		return store;
	}

	private modifiers(event: Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): number {
		return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
	}

	override dispose(): void {
		if (this.closed) { return; }
		// Release page input before marking the transport closed, even when the caller disposes us first.
		this.inputBindings.clear();
		this.closed = true;
		const groupId = this.groupId;
		const sessionId = this.sessionId;
		this.groupId = undefined;
		this.sessionId = undefined;
		for (const pending of this.pending.values()) {
			pending.timer.dispose();
			pending.reject(new Error('Browser frame bridge is closed'));
		}
		this.pending.clear();
		super.dispose();
		if (groupId) {
			void (async () => {
				try {
					if (sessionId) {
						await this.cdpService.sendCDPMessage(groupId, { id: ++this.commandId, method: 'Page.stopScreencast', sessionId });
						await this.cdpService.sendCDPMessage(groupId, { id: ++this.commandId, method: 'Target.detachFromTarget', params: { sessionId } });
					}
				} finally {
					await this.cdpService.destroySessionGroup(groupId);
				}
			})().catch(() => { /* The browser may already have closed its connection. */ });
		}
	}
}
