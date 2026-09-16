/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from './../../common/openideStrings.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';

/** Shared compact duration used by the transcript and the native footer. */
export function formatOpenideChatDuration(elapsedMs: number): string {
	const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
	return seconds < 60
		? t('openide.duration.seconds', seconds)
		: t('openide.duration.minutes', Math.floor(seconds / 60), seconds % 60);
}

/** One low-frequency text update per visible running turn; no transcript reconstruction. */
export class OpenideChatTurnDuration extends Disposable {
	readonly domNode: HTMLElement;
	private item: IOpenideChatResponseItem | undefined;
	private readonly tick = this._register(new RunOnceScheduler(() => this.paint(), 1000));

	constructor(parent: HTMLElement) {
		super();
		this.domNode = append(parent, $('.openide-chat-turn-duration'));
		this.domNode.hidden = true;
	}

	update(item: IOpenideChatResponseItem): void { this.item = item; this.paint(); }

	private paint(): void {
		this.tick.cancel();
		const item = this.item;
		this.domNode.hidden = !item?.startedAt || (item.isComplete && !item.completedAt);
		if (this.domNode.hidden || !item?.startedAt) { return; }
		const duration = formatOpenideChatDuration((item.completedAt ?? Date.now()) - item.startedAt);
		const text = item.isComplete
			? t('openide.duration.worked', duration)
			: t('openide.duration.working', duration);
		if (this.domNode.textContent !== text) { this.domNode.textContent = text; }
		if (!item.isComplete) { this.tick.schedule(); }
	}

	pause(): void { this.tick.cancel(); this.item = undefined; }
}
