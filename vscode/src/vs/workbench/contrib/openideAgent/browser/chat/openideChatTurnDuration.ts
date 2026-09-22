/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from './../../common/openideStrings.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';

/** Shared compact duration used by the transcript and the native footer. */
export function formatOpenideChatDuration(elapsedMs: number): string {
	const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
	return seconds < 60
		? t('openide.duration.seconds', seconds)
		: t('openide.duration.minutes', Math.floor(seconds / 60), seconds % 60);
}

/** Settled duration in the transcript; the live thought line owns the running clock. */
export class OpenideChatTurnDuration extends Disposable {
	readonly domNode: HTMLElement;
	private item: IOpenideChatResponseItem | undefined;

	constructor(parent: HTMLElement) {
		super();
		this.domNode = append(parent, $('.openide-chat-turn-duration'));
		this.domNode.hidden = true;
	}

	update(item: IOpenideChatResponseItem): void { this.item = item; this.paint(); }

	private paint(): void {
		const item = this.item;
		this.domNode.hidden = !item?.isComplete || !item.startedAt || !item.completedAt;
		if (this.domNode.hidden || !item?.startedAt || !item.completedAt) { return; }
		const duration = formatOpenideChatDuration(item.completedAt - item.startedAt);
		const text = t('openide.duration.worked', duration);
		if (this.domNode.textContent !== text) { this.domNode.textContent = text; }
	}

	pause(): void { this.item = undefined; }
}
