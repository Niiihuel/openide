/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { IOpenideChatContentPartContext } from '../../browser/chat/openideChatContentPart.js';
import { OpenideChatToolPart } from '../../browser/chat/parts/openideChatToolPart.js';
import { IOpenideChatToolContent } from '../../common/chat/openideChatContent.js';
import { createOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';

suite('OpenIDE tool authoring row', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const item = createOpenideChatResponseItem({ id: 'reply', requestId: 'request', content: [] });
	function create(content: IOpenideChatToolContent) {
		return store.add(new OpenideChatToolPart(content, upcastPartial<IOpenideChatContentPartContext>({ element: item }),
			upcastPartial<IHoverService>({ setupDelayedHoverAtMouse: () => Disposable.None }), upcastPartial<IOpenideAgentService>({})));
	}

	test('streamed authoring keeps the same row and exposes only the name until its result', () => {
		const content: IOpenideChatToolContent = { kind: 'tool', callId: 'skill', name: 'skill_save', state: 'running', argumentsJson: '{"name":"rtk","content":"private draft' };
		const part = create(content);
		const head = part.domNode.querySelector('.openide-chat-part-head');
		assert.strictEqual(part.domNode.querySelector('.openide-chat-part-verb')?.textContent, 'Saving skill rtk');
		assert.strictEqual(part.domNode.textContent?.includes('private draft'), false);
		part.tryUpdate({ ...content, argumentsJson: '{"name":"rtk","content":"private draft completed"}', state: 'success', resultText: 'OK: saved rtk.' }, item);
		assert.deepStrictEqual({ sameHead: part.domNode.querySelector('.openide-chat-part-head') === head, label: part.domNode.querySelector('.openide-chat-part-verb')?.textContent, shimmer: !!part.domNode.querySelector('.openide-chat-shimmer') }, { sameHead: true, label: 'Saved skill rtk', shimmer: false });
	});

	test('failed and cancelled writes retain their target without success wording', () => {
		const content: IOpenideChatToolContent = { kind: 'tool', callId: 'rule', name: 'rule_manage', state: 'running', argumentsJson: '{"action":"save","name":"rtk","scope":"global"}' };
		const part = create(content);
		part.tryUpdate({ ...content, state: 'error', resultText: 'Error: the rule could not be saved.' }, item);
		assert.deepStrictEqual({ label: part.domNode.querySelector('.openide-chat-part-verb')?.textContent, failed: part.domNode.classList.contains('openide-chat-part-error') }, { label: 'Could not save rule rtk · Global', failed: true });
		part.tryUpdate({ ...content, state: 'cancelled' }, item);
		assert.strictEqual(part.domNode.querySelector('.openide-chat-part-verb')?.textContent, 'Saving rule cancelled rtk · Global');
	});
});
