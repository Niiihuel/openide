/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { browserViewIsolatedWorldId, IElementData, IBrowserViewTheme } from '../common/browserView.js';
import type { BrowserView } from './browserView.js';

interface IActiveSelection extends IDisposable { }

export interface IElementHandle extends IDisposable {
	addToChat(): Promise<void>;
	getData(): Promise<IElementData>;
	highlight(): Promise<void>;
	hideHighlight(): Promise<void>;
}

/** Well-known element identities understood by the browser preload. */
export const enum BrowserViewInspectElementId {
	Active = 'active',
	ContextMenuTarget = 'context-menu-target',
}

/**
 * Manages visual element inspection without attaching Electron's exclusive debugger transport.
 * Keeping this path preload-backed is deliberate: Chromium DevTools can then remain embedded and
 * fully functional while the OpenIDE visual inspector is available in the same browser editor.
 */
export class BrowserViewElementInspector extends Disposable {
	private readonly _onDidSelectElement = this._register(new Emitter<IElementData>());
	readonly onDidSelectElement: Event<IElementData> = this._onDidSelectElement.event;

	private readonly _onDidChangeElementSelectionActive = this._register(new Emitter<boolean>());
	readonly onDidChangeElementSelectionActive: Event<boolean> = this._onDidChangeElementSelectionActive.event;

	private _elementSelectionActive = false;
	get isElementSelectionActive(): boolean { return this._elementSelectionActive; }

	private readonly _activeSelection = this._register(new MutableDisposable<IActiveSelection>());
	private _theme: IBrowserViewTheme = {};

	constructor(private readonly browser: BrowserView) {
		super();
		this._registerListeners();
	}

	private _registerListeners(): void {
		const webContents = this.browser.webContents;
		const onPicked = async (_event: unknown, elementId: string, selectionRect?: { x: number; y: number; width: number; height: number }) => {
			if (!elementId) {
				return;
			}
			this._activeSelection.clear();
			const data = await this._getElementData(elementId).catch(() => undefined);
			if (data) {
				this._onDidSelectElement.fire({ ...data, selectionRect, url: this.browser.getURL() });
			}
		};
		webContents.ipc.on('vscode:browserView:elementPicked', onPicked);
		this._register({ dispose: () => webContents.ipc.removeListener('vscode:browserView:elementPicked', onPicked) });

		const onPickStopped = () => this._activeSelection.clear();
		webContents.ipc.on('vscode:browserView:elementPickStopped', onPickStopped);
		this._register({ dispose: () => webContents.ipc.removeListener('vscode:browserView:elementPickStopped', onPickStopped) });

		const onNavigated = () => this._activeSelection.clear();
		webContents.on('did-navigate', onNavigated);
		this._register({ dispose: () => webContents.removeListener('did-navigate', onNavigated) });

		const onIpcMessage = (event: Electron.IpcMainEvent, channel: string) => {
			if (channel === 'vscode:browserView:preloadReady' && event.senderFrame === webContents.mainFrame) {
				this.setTheme(this._theme);
			}
		};
		webContents.on('ipc-message', onIpcMessage);
		this._register({ dispose: () => webContents.removeListener('ipc-message', onIpcMessage) });
	}

	setTheme(theme: IBrowserViewTheme): void {
		this._theme = theme;
		void this._execute(`window.browserViewAPI?.setTheme?.(${JSON.stringify(theme)})`).catch(() => { });
	}

	async toggleElementSelection(enabled?: boolean): Promise<void> {
		const newEnabled = enabled ?? !this._elementSelectionActive;
		if (newEnabled === this._elementSelectionActive) {
			return;
		}
		if (!newEnabled) {
			this._activeSelection.clear();
			return;
		}

		const selection: IActiveSelection = {
			dispose: () => {
				if (this._activeSelection.value === selection) {
					this._elementSelectionActive = false;
					this._onDidChangeElementSelectionActive.fire(false);
					this._activeSelection.clearAndLeak();
					void this._execute('window.browserViewAPI?.pickElement?.stop?.()').catch(() => { });
				}
			}
		};
		this._activeSelection.value = selection;

		try {
			const started = await this._execute('window.browserViewAPI?.pickElement?.start?.() ?? false');
			if (!started) {
				throw new Error('Preload element picker not available');
			}
			if (this._activeSelection.value === selection) {
				this._elementSelectionActive = true;
				this._onDidChangeElementSelectionActive.fire(true);
			}
		} catch {
			this._activeSelection.clear();
		}
	}

	async getElementHandle(id: string): Promise<IElementHandle | undefined> {
		if (!await this._getElementData(id)) {
			return undefined;
		}
		let disposed = false;
		return {
			getData: async () => {
				const data = await this._getElementData(id);
				if (!data) { throw new Error('The inspected element is no longer available.'); }
				return data;
			},
			addToChat: async () => {
				const data = await this._getElementData(id);
				if (data) { this._onDidSelectElement.fire({ ...data, url: this.browser.getURL() }); }
			},
			highlight: async () => { await this._execute(`window.browserViewAPI?.highlightElement?.(${JSON.stringify(id)})`); },
			hideHighlight: async () => { await this._execute('window.browserViewAPI?.hideHighlight?.()'); },
			dispose: () => {
				if (!disposed) {
					disposed = true;
					void this._execute('window.browserViewAPI?.hideHighlight?.()').catch(() => { });
				}
			}
		};
	}

	async setElementStyle(elementId: string, property: string, value: string): Promise<IElementData> {
		if (!elementId) {
			throw new Error('Invalid inspected element identity.');
		}
		if (!/^(?:--[\w-]+|-?[a-zA-Z_][\w-]*)$/.test(property)) {
			throw new Error(`Invalid CSS property: ${property}`);
		}
		const data = await this._execute(`window.browserViewAPI?.setElementStyle?.(${JSON.stringify(elementId)}, ${JSON.stringify(property)}, ${JSON.stringify(value)})`) as IElementData | undefined;
		if (!data) {
			throw new Error('The inspected element is no longer available.');
		}
		return data;
	}

	async getVisualViewportScale(): Promise<number> {
		try {
			const scale = Number(await this._execute('window.visualViewport?.scale ?? 1'));
			return Number.isFinite(scale) && scale > 0 ? scale : 1;
		} catch {
			return 1;
		}
	}

	private async _getElementData(elementId: string): Promise<IElementData | undefined> {
		return this._execute(`window.browserViewAPI?.getElementData?.(${JSON.stringify(elementId)})`) as Promise<IElementData | undefined>;
	}

	private _execute(code: string): Promise<unknown> {
		return this.browser.webContents.executeJavaScriptInIsolatedWorld(browserViewIsolatedWorldId, [{ code }]);
	}
}
