/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CachedListVirtualDelegate } from '../../../../../base/browser/ui/list/list.js';
import { IOpenideChatItem, isOpenideChatRequestItem } from '../../common/chat/openideChatItem.js';

/**
 * Template ids live here rather than on the renderers because the delegate has to answer
 * `getTemplateId` before any renderer is constructed, and the two renderers (request row and
 * response row) are written independently. A shared constant is the only way both sides agree
 * without importing each other.
 */
export const OPENIDE_CHAT_REQUEST_TEMPLATE_ID = 'openideChatRequest';
export const OPENIDE_CHAT_RESPONSE_TEMPLATE_ID = 'openideChatResponse';

/**
 * First-paint guesses only, used until the row has been measured once. They are deliberately on
 * the low side: overestimating makes the list reserve space it then has to give back, which reads
 * as the transcript collapsing upwards right after a row appears.
 */
export const OPENIDE_CHAT_DEFAULT_REQUEST_HEIGHT = 48;
export const OPENIDE_CHAT_DEFAULT_RESPONSE_HEIGHT = 120;

export interface IOpenideChatListDelegateOptions {
	readonly requestHeight?: number;
	readonly responseHeight?: number;
}

/**
 * Virtual delegate for the native transcript.
 *
 * Adapted from `ChatListDelegate` (contrib/chat/browser/widget/chatListRenderer.ts:3347, VS Code
 * 1.121.1) with one behavioural inversion that matters. Upstream's comment says
 * `currentRenderedHeight` is "not load-bearing" because its view models are stable objects, so the
 * `WeakMap` in `CachedListVirtualDelegate` almost always answers first. Our items are immutable
 * snapshots: every streamed delta produces a NEW object, so the cache misses on every single
 * frame and `estimateHeight` is the only thing standing between the user and a transcript that
 * re-measures from the default height on each token.
 *
 * Contract for whoever writes the renderers: after rendering a row you MUST write the measured
 * height back into `item.currentRenderedHeight` (the only mutable field on the item, precisely for
 * this). `advanceOpenideChatResponseItem` carries it into the next snapshot, so the estimate stays
 * accurate across the whole stream.
 */
export class OpenideChatListDelegate extends CachedListVirtualDelegate<IOpenideChatItem> {

	private readonly requestHeight: number;
	private readonly responseHeight: number;

	constructor(options: IOpenideChatListDelegateOptions = {}) {
		super();
		this.requestHeight = options.requestHeight ?? OPENIDE_CHAT_DEFAULT_REQUEST_HEIGHT;
		this.responseHeight = options.responseHeight ?? OPENIDE_CHAT_DEFAULT_RESPONSE_HEIGHT;
	}

	protected estimateHeight(element: IOpenideChatItem): number {
		const carried = element.currentRenderedHeight;
		if (typeof carried === 'number' && carried > 0) {
			return carried;
		}
		return isOpenideChatRequestItem(element) ? this.requestHeight : this.responseHeight;
	}

	getTemplateId(element: IOpenideChatItem): string {
		return isOpenideChatRequestItem(element)
			? OPENIDE_CHAT_REQUEST_TEMPLATE_ID
			: OPENIDE_CHAT_RESPONSE_TEMPLATE_ID;
	}

	/**
	 * Both rows are dynamic. A row that reports a fixed height is never measured by the list view,
	 * which would freeze a streaming response at whatever `estimateHeight` guessed for it.
	 */
	hasDynamicHeight(_element: IOpenideChatItem): boolean {
		return true;
	}

	/**
	 * Mirrors the measurement into the item so the estimate survives the next snapshot. The base
	 * class already stores it in its `WeakMap`, but that map is keyed by object identity and our
	 * items are replaced wholesale on every reducer step.
	 */
	override setDynamicHeight(element: IOpenideChatItem, height: number): void {
		super.setDynamicHeight(element, height);
		if (height > 0) {
			element.currentRenderedHeight = height;
		}
	}
}
