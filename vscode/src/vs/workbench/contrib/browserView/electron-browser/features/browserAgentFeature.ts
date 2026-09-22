/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../../base/browser/dom.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { BrowserAgentSessionModel } from '../../../../../platform/browserView/common/browserAgentSessionModel.js';
import { createBrowserAgentViewportTransform } from '../../../../../platform/browserView/common/browserAgentCoordinates.js';
import { BrowserAgentOverlay } from '../../browser/browserAgentOverlay.js';
import { IBrowserAgentSessionService } from '../../common/browserAgentSessionService.js';
import { IBrowserViewCDPService, IBrowserViewModel } from '../../common/browserView.js';
import { BrowserAgentFrameBridge, IBrowserAgentFrame } from '../browserAgentFrameBridge.js';
import { BrowserEditor, BrowserEditorContribution, BrowserWidgetLocation, IBrowserEditorWidget } from '../browserEditor.js';
import { WebContentsViewRendererFeature } from './webContentsViewRendererFeature.js';
import '../media/browserAgentSurface.css';

/**
 * The existing WebContentsView paints above Workbench DOM. While an agent session is
 * open and visible, a CDP screencast of that same page allows native DOM feedback and
 * input. Keep this surface through action completion, pauses and errors so its cursor
 * remains visible between actions. No new browser/WebView is created; closing or
 * cancelling the session, hiding the pane, disabling feedback or losing the capture
 * connection restores the regular native surface.
 */
class BrowserAgentFeature extends BrowserEditorContribution {
	private readonly surface = $('.browser-agent-surface', { tabindex: '0', role: 'region', 'aria-label': localize('browser.agent.viewport', "Browser controlled by agent") });
	private readonly image = $<HTMLImageElement>('img.browser-agent-frame-image', { alt: '', draggable: 'false' });
	private readonly presentation = this._register(new MutableDisposable<DisposableStore>());
	private container: HTMLElement | undefined;
	private model: IBrowserViewModel | undefined;
	private session: BrowserAgentSessionModel | undefined;
	private visible = false;
	private rect: DOMRect | undefined;
	private width = 0;
	private height = 0;
	private failedExecution: { sessionId: string; executionId: string | undefined } | undefined;
	private latestFrame: IBrowserAgentFrame | undefined;
	private ready = false;
	private generation = 0;
	private frame: number | undefined;

	constructor(
		editor: BrowserEditor,
		@IBrowserAgentSessionService private readonly sessions: IBrowserAgentSessionService,
		@IBrowserViewCDPService private readonly cdp: IBrowserViewCDPService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@ILogService private readonly log: ILogService,
		@IClipboardService private readonly clipboard: IClipboardService,
	) {
		super(editor);
		this.surface.hidden = true;
		this.surface.appendChild(this.image);
		this._register(sessions.onDidChangeSession(session => {
			if (session.state.currentAction?.pageId === this.model?.id || session === this.session) { this.refresh(); }
		}));
		this._register(configuration.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('openide.agent.browserTools.showCursor')) { this.failedExecution = undefined; this.refresh(); }
		}));
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [{ location: BrowserWidgetLocation.ContentArea, element: this.surface, order: 150 }];
	}
	override onContainerCreated(container: HTMLElement): void { this.container = container; this.afterContainerLayout(); }
	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.stop(); this.failedExecution = undefined; this.model = model;
		store.add(toDisposable(() => this.stop()));
		this.refresh();
	}
	override onModelDetached(): void { this.stop(); this.failedExecution = undefined; this.model = undefined; }
	override onPaneVisibilityChanged(visible: boolean): void { this.visible = visible; this.refresh(); }
	override afterContainerLayout(): void {
		// One read per Workbench layout, never per cursor frame or high-frequency mouse event.
		this.rect = this.container?.getBoundingClientRect();
		this.width = this.container?.clientWidth ?? 0;
		this.height = this.container?.clientHeight ?? 0;
	}
	override tryFocus(): boolean {
		if (!this.ready) { return false; }
		this.surface.focus(); return true;
	}

	private refresh(): void {
		const session = this.model ? this.sessions.sessionForPage(this.model.id) : undefined;
		if (!this.visible || !session || session.state.closed || session.state.cancelled || this.configuration.getValue('openide.agent.browserTools.showCursor') === false) {
			this.stop(true); return;
		}
		if (this.failedExecution?.sessionId === session.sessionId && this.failedExecution.executionId === session.state.currentAction?.executionId) { return; }
		if (session !== this.session) {
			this.stop();
			this.start(session);
		}
	}

	private start(session: BrowserAgentSessionModel): void {
		if (!this.model) { return; }
		const generation = ++this.generation;
		const store = this.presentation.value = new DisposableStore();
		this.session = session;
		this.surface.dataset.sessionId = session.sessionId;
		const overlay = store.add(new BrowserAgentOverlay(this.surface, session));
		const bridge = store.add(new BrowserAgentFrameBridge(this.model.id, this.cdp));
		store.add(bridge.bindInput(this.surface, (x, y) => {
			const viewport = session.state.viewport;
			const rect = this.rect;
			if (!this.ready || !viewport || !rect) { return undefined; }
			const transform = createBrowserAgentViewportTransform(viewport, { width: this.width, height: this.height });
			const localX = x - rect.left; const localY = y - rect.top;
			const content = transform.contentRect;
			if (!transform.scaleX || !transform.scaleY || localX < content.x || localY < content.y || localX > content.x + content.width || localY > content.y + content.height) { return undefined; }
			return { x: (localX - content.x) / transform.scaleX, y: (localY - content.y) / transform.scaleY };
		}, () => this.clipboard.readText()));
		store.add(bridge.onDidFrame(frame => {
			this.latestFrame = frame;
			if (this.frame !== undefined) { return; }
			this.frame = this.editor.window.requestAnimationFrame(() => {
				this.frame = undefined;
				if (generation !== this.generation || !this.latestFrame) { return; }
				this.image.src = this.latestFrame.dataUrl;
			});
		}));
		store.add(addDisposableListener(this.image, 'load', () => {
			if (generation !== this.generation || !this.visible) { return; }
			this.ready = true;
			this.surface.hidden = false;
			overlay.layout(this.width, this.height);
			this.renderer()?.setAgentRendering(true);
		}));
		store.add(bridge.onDidError(error => this.failed(error, generation)));
		const browser = this.model;
		store.add(browser.onDidChangeLoadingState(event => {
			if (event.loading || !this.ready || generation !== this.generation || browser.visible) { return; }
			// Chromium creates a new rendering pipeline on navigation. A hidden native
			// view needs its existing capture wake-up path before RAF/actionability
			// checks resume; changing background throttling alone does not wake it.
			// captureScreenshot already performs this synchronously without painting
			// the native view over the Workbench surface. Keep this scoped to the
			// active presentation and leave normal background tabs untouched.
			void browser.captureScreenshot({ quality: 30 }).catch(error => {
				if (generation === this.generation) { this.failed(error, generation); }
			});
		}));
		store.add(toDisposable(() => {
			if (this.frame !== undefined) { this.editor.window.cancelAnimationFrame(this.frame); this.frame = undefined; }
			this.latestFrame = undefined;
		}));
		void bridge.start().catch(error => this.failed(error, generation));
	}

	private renderer(): WebContentsViewRendererFeature | undefined { return this.editor.getContribution(WebContentsViewRendererFeature); }
	private failed(error: unknown, generation: number): void {
		if (generation !== this.generation) { return; }
		if (this.session) { this.failedExecution = { sessionId: this.session.sessionId, executionId: this.session.state.currentAction?.executionId }; }
		this.log.warn('Browser agent visual surface unavailable; keeping the native browser interactive', error);
		this.stop(true);
	}
	private stop(restoreFocus = false): void {
		const shouldRestoreFocus = restoreFocus && this.visible && this.surface.contains(this.editor.window.document.activeElement);
		this.generation++;
		this.presentation.clear();
		this.ready = false; this.session = undefined;
		this.surface.hidden = true;
		delete this.surface.dataset.sessionId;
		this.image.removeAttribute('src');
		this.renderer()?.setAgentRendering(false);
		if (shouldRestoreFocus) { this.renderer()?.tryFocus(); }
	}
	override dispose(): void { this.stop(); super.dispose(); }
}

BrowserEditor.registerContribution(BrowserAgentFeature);
