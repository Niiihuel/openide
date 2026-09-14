/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { OpenideChatPresentation } from '../../browser/chat/openideChatPresentation.js';
import { advanceOpenideChatResponseItem, createOpenideChatRequestItem, createOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';

suite('OpenIDE shared chat presentation', () => {
	test('views own independent heights while sharing immutable content and preserving local measurement on updates', () => {
		const wide = new OpenideChatPresentation();
		const narrow = new OpenideChatPresentation();
		const source = createOpenideChatResponseItem({ id: 'response_1', requestId: 'request' });
		const first = wide.items('conversation', [source])[0];
		const second = narrow.items('conversation', [source])[0];
		first.currentRenderedHeight = 80;
		second.currentRenderedHeight = 200;
		assert.deepStrictEqual([source.currentRenderedHeight, first.currentRenderedHeight, second.currentRenderedHeight], [undefined, 80, 200]);
		const updated = advanceOpenideChatResponseItem(source, { isComplete: true });
		assert.deepStrictEqual([wide.items('conversation', [updated])[0].currentRenderedHeight, narrow.items('conversation', [updated])[0].currentRenderedHeight], [80, 200]);
		assert.strictEqual(wide.items('conversation', [updated])[0], wide.items('conversation', [updated])[0]);
	});

	test('different conversations cannot collide in list diff identities or inherit another conversation height', () => {
		const view = new OpenideChatPresentation();
		const request = createOpenideChatRequestItem({ id: 'request', text: 'Prompt' });
		const response = createOpenideChatResponseItem({ id: 'response_1', requestId: 'request' });
		const first = view.items('first', [request, response]);
		first[1].currentRenderedHeight = 300;
		const second = view.items('second', [request, response]);
		assert.notStrictEqual(first[1].dataId, second[1].dataId);
		assert.deepStrictEqual({ id: second[0].id, request: second[1].kind === 'response' ? second[1].requestId : '', height: second[1].currentRenderedHeight }, { id: 'second:request', request: 'second:request', height: undefined });
	});
});
