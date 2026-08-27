/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — base for EditorPanes hosting their own webview. As of 2026-08 the ONLY surviving
 *  user is the Canvas editor: it executes agent-authored transpiled TSX, and a child iframe
 *  embedded in the workbench inherits the workbench CSP (`require-trusted-types-for 'script'` +
 *  a locked `script-src`), so `srcdoc`/`blob:` inline scripts never run. IWebviewService serves
 *  the frame from a separate origin with its OWN CSP header — the sandbox untrusted code needs.
 *  Plan/Diagram/Subagent render only trusted DOM and were migrated to native panes.
 *
 *  It uses IOverlayWebview (persistent layer + claim/release) instead of IWebviewElement.mountTo:
 *  editor panes are UNMOUNTED from the DOM when switching tabs, and an unmounted iframe reloads
 *  blank on return (nobody re-injects the HTML). The overlay lives in a layer that is never
 *  unmounted and follows the anchor via CSS anchor positioning; the content survives the tabs.
 *--------------------------------------------------------------------------------------------*/

import { Dimension, isHTMLElement } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from '../../webview/browser/webview.js';

export abstract class OpenideOverlayWebviewEditor extends EditorPane {

	protected container: HTMLElement | undefined;
	private readonly _webview = this._register(new MutableDisposable<IOverlayWebview>());
	private _creating: Promise<void> | undefined;

	constructor(
		id: string,
		group: IEditorGroup,
		telemetryService: ITelemetryService,
		themeService: IThemeService,
		storageService: IStorageService,
		private readonly _webviewService: IWebviewService,
		private readonly _layoutService: IWorkbenchLayoutService,
		private readonly _editorGroupsService: IEditorGroupsService,
	) {
		super(id, group, telemetryService, themeService, storageService);
	}

	/** Webview viewType (debug/telemetry) — e.g. 'openideProviders'. */
	protected abstract readonly viewType: string;
	protected abstract readonly webviewTitle: string;
	/** Initial HTML: set ONCE; later state travels through messages. */
	protected abstract buildHtml(): Promise<string> | string;
	protected abstract onMessage(msg: any): void;

	protected get webview(): IOverlayWebview | undefined {
		return this._webview.value;
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = parent;
		parent.style.position = 'relative';
		parent.style.overflow = 'hidden';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this.ensureWebview();
		this.claimWebview();
	}

	private async ensureWebview(): Promise<void> {
		if (this._webview.value) {
			return;
		}
		if (!this._creating) {
			this._creating = (async () => {
				const html = await this.buildHtml();
				const webview = this._webviewService.createWebviewOverlay({
					origin: generateUuid(),
					providedViewType: this.viewType,
					title: this.webviewTitle,
					options: { purpose: WebviewContentPurpose.WebviewView, enableFindWidget: false, tryRestoreScrollPosition: false },
					contentOptions: { allowScripts: true },
					extension: undefined,
				});
				this._webview.value = webview;
				this._register(webview.onMessage(e => {
					const msg: any = e.message;
					if (msg) {
						this.onMessage(msg);
					}
				}));
				webview.setHtml(html);
			})();
		}
		await this._creating;
	}

	private claimWebview(): void {
		const webview = this._webview.value;
		if (webview && this.container) {
			webview.claim(this, this.window, undefined);
			// The clipping container depends on where the editor lives: in a NORMAL editor it is
			// the EDITOR_PART; in the native MODAL (Providers/Diagram) the overlay must clip
			// against the modal, not against the editor behind it (otherwise it ends up blank/behind the
			// modal). Mismo criterio que webviewEditor.ts nativo.
			const modalElement = this._editorGroupsService.activeModalEditorPart?.modalElement;
			const isModal = isHTMLElement(modalElement) && modalElement.contains(this.container);
			const clip = isModal ? undefined : this._layoutService.getContainer(this.window, Parts.EDITOR_PART);
			webview.setAnchorElement(this.container, clip);
		}
	}

	protected override setEditorVisible(visible: boolean): void {
		if (visible) {
			this.claimWebview();
		} else {
			this._webview.value?.release(this);
		}
		super.setEditorVisible(visible);
	}

	override clearInput(): void {
		this._webview.value?.release(this);
		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.height = `${dimension.height}px`;
			this.container.style.width = `${dimension.width}px`;
		}
	}

	override focus(): void {
		super.focus();
		this._webview.value?.focus();
	}
}
