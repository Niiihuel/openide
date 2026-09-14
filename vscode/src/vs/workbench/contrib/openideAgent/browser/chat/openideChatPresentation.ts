/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideChatItem } from '../../common/chat/openideChatItem.js';

/** Content belongs to the shared runtime; row identities and measured heights belong to a view. */
export class OpenideChatPresentation {
	private conversationId: string | undefined;
	private rows = new Map<string, { source: IOpenideChatItem; view: IOpenideChatItem }>();

	items(conversationId: string, items: readonly IOpenideChatItem[]): readonly IOpenideChatItem[] {
		if (conversationId !== this.conversationId) { this.rows.clear(); this.conversationId = conversationId; }
		const prefix = `${conversationId}:`;
		const next = new Map<string, { source: IOpenideChatItem; view: IOpenideChatItem }>();
		const result = items.map(source => {
			const previous = this.rows.get(source.id);
			const view: IOpenideChatItem = previous?.source === source ? previous.view : {
				...source,
				id: prefix + source.id,
				dataId: prefix + source.dataId,
				parentId: source.parentId ? prefix + source.parentId : undefined,
				...(source.kind === 'response' ? { requestId: prefix + source.requestId } : {}),
				currentRenderedHeight: previous?.view.currentRenderedHeight,
			};
			next.set(source.id, { source, view });
			return view;
		});
		this.rows = next;
		return result;
	}
}
