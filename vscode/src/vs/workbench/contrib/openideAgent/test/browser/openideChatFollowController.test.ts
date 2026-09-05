/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OpenideChatFollowController } from '../../browser/chat/openideChatFollowController.js';
import { IAgentLocation } from '../../common/openideAgentTypes.js';

suite('OpenIDE ChatFollowController', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const location = (path: string): IAgentLocation => ({ kind: 'file', path, activity: 'edit', review: true });

	function create() {
		let enabled = true;
		const changed = store.add(new Emitter<boolean>());
		const calls: { location: IAgentLocation; token: CancellationToken; done: DeferredPromise<void> }[] = [];
		const follow = store.add(new OpenideChatFollowController({
			onDidChangePlanFollow: changed.event,
			isPlanFollowEnabled: () => enabled,
			followAgentLocation: (location, token = CancellationToken.None) => {
				const done = new DeferredPromise<void>();
				calls.push({ location, token, done });
				return done.p;
			},
		}));
		follow.setVisibleConversation('visible');
		const toggle = (value: boolean) => { enabled = value; changed.fire(value); };
		return { follow, calls, toggle };
	}

	async function flush(): Promise<void> {
		for (let i = 0; i < 10; i++) { await Promise.resolve(); }
	}

	test('Zen off never opens an editor, even when activity keeps arriving', () => {
		const { follow, calls, toggle } = create();
		toggle(false);
		follow.follow('visible', location('a.ts'));
		follow.follow('visible', location('b.ts'));
		assert.strictEqual(calls.length, 0);
	});

	test('a burst cancels the active highlight and follows only the latest queued file', async () => {
		const { follow, calls } = create();
		follow.follow('visible', location('a.ts'));
		follow.follow('visible', location('b.ts'));
		follow.follow('visible', location('c.ts'));
		assert.strictEqual(calls[0].token.isCancellationRequested, true);
		await calls[0].done.complete();
		await flush();
		assert.deepStrictEqual(calls.map(call => call.location), [location('a.ts'), location('c.ts')]);
		await calls[1].done.complete();
	});

	test('turning Zen off and back on cannot replay stale queued work', async () => {
		const { follow, calls, toggle } = create();
		follow.follow('visible', location('a.ts'));
		follow.follow('visible', location('b.ts'));
		toggle(false);
		toggle(true);
		await calls[0].done.complete();
		await flush();
		assert.deepStrictEqual({ calls: calls.length, cancelled: calls[0].token.isCancellationRequested }, { calls: 1, cancelled: true });
		follow.follow('visible', location('new.ts'));
		assert.strictEqual(calls.length, 2);
		await calls[1].done.complete();
	});

	test('background conversations do not move the visible editor', () => {
		const { follow, calls } = create();
		follow.follow('background', location('a.ts'));
		assert.strictEqual(calls.length, 0);
	});

	test('switching conversations cancels old navigation and discards its queue', async () => {
		const { follow, calls } = create();
		follow.follow('visible', location('a.ts'));
		follow.follow('visible', location('b.ts'));
		follow.setVisibleConversation('other');
		follow.follow('visible', location('c.ts'));
		await calls[0].done.complete();
		await flush();
		assert.deepStrictEqual({ calls: calls.length, cancelled: calls[0].token.isCancellationRequested }, { calls: 1, cancelled: true });
	});

	test('a failed editor open does not block newer activity', async () => {
		const { follow, calls } = create();
		follow.follow('visible', location('deleted.ts'));
		follow.follow('visible', location('current.ts'));
		await calls[0].done.error(new Error('File deleted'));
		await flush();
		assert.deepStrictEqual(calls.map(call => call.location), [location('deleted.ts'), location('current.ts')]);
		await calls[1].done.complete();
	});

	test('disposal cancels navigation and prevents later events from reopening files', async () => {
		const { follow, calls } = create();
		follow.follow('visible', location('a.ts'));
		follow.dispose();
		follow.follow('visible', location('b.ts'));
		await calls[0].done.complete();
		await flush();
		assert.deepStrictEqual({ calls: calls.length, cancelled: calls[0].token.isCancellationRequested }, { calls: 1, cancelled: true });
	});
});
