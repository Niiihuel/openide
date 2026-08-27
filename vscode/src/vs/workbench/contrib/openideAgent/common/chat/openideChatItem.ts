/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentMode, IChatCapabilityMention, IChatImage } from '../openideAgentTypes.js';
import { IOpenideChatContent } from './openideChatContent.js';

export interface IOpenideChatItemBase {
	/** Stable across the whole conversation: focus, scroll anchoring and rollback key off it. */
	readonly id: string;
	/**
	 * Changes whenever the row must repaint. The list's diffIdentityProvider returns this string,
	 * so a dataId that does NOT move during streaming leaves the response frozen on screen with
	 * no error at all — the single most likely silent failure of the native transcript.
	 */
	readonly dataId: string;
	/**
	 * Written by the renderer, read by the list to avoid re-measuring. Not readonly and not part
	 * of dataId: a height change must never force a re-render, that is what causes layout loops.
	 */
	currentRenderedHeight: number | undefined;
	/** False while the turn is still streaming. Drives the caret and the disabled send button. */
	readonly isComplete: boolean;
	/**
	 * Reserved for nesting, NOT used in Stage 1. Pinning the user turn while its tool rows scroll
	 * would need the tree's sticky scroll, and findStickyState only ever pins ANCESTORS (it walks
	 * up via getParentNode, abstractTree.ts:1456-1469). A flat list therefore cannot pin a turn.
	 * Stage 1 ships flat like VS Code's chat; keeping the field here means switching to a nested
	 * tree later is a change in the reducer, not in the contract every content part is typed on.
	 */
	readonly parentId?: string;
}

/** The user's message row. */
export interface IOpenideChatRequestItem extends IOpenideChatItemBase {
	readonly kind: 'request';
	/** IChatMessage.messageId: identifies the file transaction this turn produced, for rollback. */
	readonly messageId?: string;
	/** What the model received (already expanded when it came from a /command). */
	readonly text: string;
	/** What the user typed, when it differs from `text`. The transcript shows this one. */
	readonly displayText?: string;
	readonly images?: readonly IChatImage[];
	readonly capabilities?: readonly IChatCapabilityMention[];
	/** Captured at accept time: editing and rollback must not follow the current global selector. */
	readonly mode?: AgentMode;
	readonly providerId?: string;
	readonly modelId?: string;
}

/** The assistant's reply row: an ordered list of renderable content parts. */
export interface IOpenideChatResponseItem extends IOpenideChatItemBase {
	readonly kind: 'response';
	/** Id of the request item this reply answers; also the future parentId when nesting lands. */
	readonly requestId: string;
	readonly content: readonly IOpenideChatContent[];
	/** Monotonic per item. Bumped on every reducer step and folded into dataId. */
	readonly version: number;
	readonly isCanceled?: boolean;
	readonly errorMessage?: string;
}

export type IOpenideChatItem = IOpenideChatRequestItem | IOpenideChatResponseItem;

export function isOpenideChatRequestItem(item: IOpenideChatItem): item is IOpenideChatRequestItem {
	return item.kind === 'request';
}

export function isOpenideChatResponseItem(item: IOpenideChatItem): item is IOpenideChatResponseItem {
	return item.kind === 'response';
}

/**
 * The `_done` suffix exists because the terminating event carries no content of its own: without
 * it the last delta and the completed turn share a dataId and the caret never clears.
 */
export function computeOpenideChatDataId(id: string, version: number, isComplete: boolean): string {
	return `${id}_${version}${isComplete ? '_done' : ''}`;
}

export interface IOpenideChatRequestItemInit extends Omit<IOpenideChatRequestItem, 'kind' | 'dataId' | 'currentRenderedHeight' | 'isComplete'> {
	readonly isComplete?: boolean;
	readonly version?: number;
}

/**
 * A request is immutable once sent, so its version only moves when the row itself changes
 * (edit-and-resend, or the reply completing and unlocking the row's actions).
 */
export function createOpenideChatRequestItem(init: IOpenideChatRequestItemInit): IOpenideChatRequestItem {
	const isComplete = init.isComplete ?? true;
	return {
		...init,
		kind: 'request',
		dataId: computeOpenideChatDataId(init.id, init.version ?? 0, isComplete),
		currentRenderedHeight: undefined,
		isComplete,
	};
}

export interface IOpenideChatResponseItemInit extends Omit<IOpenideChatResponseItem, 'kind' | 'dataId' | 'currentRenderedHeight' | 'isComplete' | 'version' | 'content'> {
	readonly content?: readonly IOpenideChatContent[];
	readonly isComplete?: boolean;
	readonly version?: number;
}

export function createOpenideChatResponseItem(init: IOpenideChatResponseItemInit): IOpenideChatResponseItem {
	const isComplete = init.isComplete ?? false;
	const version = init.version ?? 0;
	return {
		...init,
		kind: 'response',
		content: init.content ?? [],
		version,
		dataId: computeOpenideChatDataId(init.id, version, isComplete),
		currentRenderedHeight: undefined,
		isComplete,
	};
}

export interface IOpenideChatResponseUpdate {
	readonly content?: readonly IOpenideChatContent[];
	readonly isComplete?: boolean;
	readonly isCanceled?: boolean;
	readonly errorMessage?: string;
}

/**
 * Produces the next immutable snapshot of a reply. The measured height is carried over on
 * purpose: dropping it makes the list re-measure a row it already knows, and the transcript
 * visibly jumps on every streamed token.
 */
export function advanceOpenideChatResponseItem(item: IOpenideChatResponseItem, update: IOpenideChatResponseUpdate): IOpenideChatResponseItem {
	const version = item.version + 1;
	const isComplete = update.isComplete ?? item.isComplete;
	return {
		...item,
		content: update.content ?? item.content,
		version,
		dataId: computeOpenideChatDataId(item.id, version, isComplete),
		currentRenderedHeight: item.currentRenderedHeight,
		isComplete,
		isCanceled: update.isCanceled ?? item.isCanceled,
		errorMessage: update.errorMessage ?? item.errorMessage,
	};
}
