/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { BrowserAgentEvent } from '../../../../platform/browserView/common/browserAgentEvents.js';
import { BrowserAgentSessionModel } from '../../../../platform/browserView/common/browserAgentSessionModel.js';
import { IPlaywrightService } from '../../../../platform/browserView/common/playwrightService.js';
import { IBrowserAgentSessionService } from '../common/browserAgentSessionService.js';

export class BrowserAgentSessionService extends Disposable implements IBrowserAgentSessionService {
	declare readonly _serviceBrand: undefined;
	private readonly models = this._register(new DisposableMap<string, BrowserAgentSessionModel>());
	private readonly pages = new Map<string, string>();
	private readonly calls = new Map<string, string>();
	private readonly changed = this._register(new Emitter<BrowserAgentSessionModel>());
	readonly onDidChangeSession = this.changed.event;

	constructor(@IPlaywrightService playwright: IPlaywrightService) {
		super();
		this._register(playwright.onDidBrowserAgentEvent(event => this.acceptEvent(event)));
	}

	/** Public neutral entry point also supports recorded and synthetic event producers. */
	acceptEvent(event: BrowserAgentEvent): void {
		if (this._store.isDisposed) { return; }
		let model = this.models.get(event.sessionId);
		const created = !model;
		if (!model) {
			model = new BrowserAgentSessionModel(event.sessionId, event.timestamp);
			this.models.set(event.sessionId, model);
		}
		if (!model.acceptEvent(event)) {
			if (created) { this.models.deleteAndDispose(event.sessionId); }
			return;
		}
		if (event.pageId && !event.closed && (!this.pages.has(event.pageId)
			|| event.phase !== 'completed' && event.phase !== 'updated' && event.action !== 'success' && event.action !== 'error' && event.status !== 'idle' && event.status !== 'completed' && event.status !== 'error')) {
			this.pages.set(event.pageId, event.sessionId);
		}
		if (event.toolCallId) { this.calls.set(event.toolCallId, event.sessionId); }
		if (model.state.closed) {
			for (const [page, session] of this.pages) { if (session === event.sessionId) { this.pages.delete(page); } }
			for (const [call, session] of this.calls) { if (session === event.sessionId) { this.calls.delete(call); } }
			// Keep only the model's final snapshot as a tombstone, releasing its event/listener resources.
			// Late started events must never recreate a session that was explicitly closed.
			model.dispose();
		}
		this.changed.fire(model);
	}

	sessionForPage(pageId: string): BrowserAgentSessionModel | undefined { return this.getSession(this.pages.get(pageId) ?? ''); }
	sessionForToolCall(toolCallId: string): BrowserAgentSessionModel | undefined { return this.getSession(this.calls.get(toolCallId) ?? ''); }
	getSession(sessionId: string): BrowserAgentSessionModel | undefined { return this.models.get(sessionId); }
}
