/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IAgentLocation } from '../../common/openideAgentTypes.js';
import { IOpenideAgentService } from '../openideAgentService.js';

/** Follows the latest activity of the visible conversation while Zen is enabled. */
export class OpenideChatFollowController extends Disposable {
	private visibleId: string | undefined;
	private pending: { location: IAgentLocation; targetWindowId?: number } | undefined;
	private active: CancellationTokenSource | undefined;
	private draining = false;

	constructor(private readonly agent: Pick<IOpenideAgentService, 'isPlanFollowEnabled' | 'onDidChangePlanFollow' | 'followAgentLocation'>) {
		super();
		this._register(agent.onDidChangePlanFollow(() => this.cancel()));
	}

	setVisibleConversation(id: string | undefined): void {
		if (this.visibleId === id) { return; }
		this.cancel();
		this.visibleId = id;
	}

	follow(conversationId: string, location: IAgentLocation, targetWindowId?: number): void {
		if (this._store.isDisposed || !this.agent.isPlanFollowEnabled() || conversationId !== this.visibleId) { return; }
		this.pending = { location, targetWindowId };
		// New activity interrupts the old highlight, and replaces any queued location.
		this.active?.cancel();
		void this.drain();
	}

	private async drain(): Promise<void> {
		if (this.draining) { return; }
		this.draining = true;
		try {
			while (this.pending && !this._store.isDisposed && this.agent.isPlanFollowEnabled()) {
				const { location, targetWindowId } = this.pending;
				this.pending = undefined;
				const cancellation = this.active = new CancellationTokenSource();
				try {
					await this.agent.followAgentLocation(location, cancellation.token, targetWindowId);
				} catch {
					// A deleted file or closed editor must not prevent following the next activity.
				} finally {
					cancellation.dispose();
					if (this.active === cancellation) { this.active = undefined; }
				}
			}
		} finally {
			this.draining = false;
		}
	}

	private cancel(): void {
		this.pending = undefined;
		this.active?.cancel();
	}

	override dispose(): void {
		this.cancel();
		super.dispose();
	}
}
