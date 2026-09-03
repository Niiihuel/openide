/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	CONVERSATION_INBOX_CAP, CONVERSATION_MESSAGE_BURST, CONVERSATION_MESSAGE_MAX_CHARS,
	OpenideConversationFileClaims, OpenideConversationMailbox, normalizeClaimPath,
	renderFileClaimTimeout, renderIncomingConversationMessage,
} from '../../common/openideConversationCoordination.js';

/**
 * The two things conversations running at the same time need from each other: a file the other one
 * will not overwrite behind your back, and a message that cannot turn into a loop.
 */
suite('OpenIDE conversation coordination', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('file claims', () => {
		test('the immediate attempt still reports the holder, for the caller that cannot wait', () => {
			const claims = new OpenideConversationFileClaims();
			assert.deepStrictEqual(claims.claim('src/a.ts', 'A', 1000), { ok: true, renewed: false });
			assert.deepStrictEqual(claims.claim('src/a.ts', 'B', 1001), { ok: false, heldBy: 'A', since: 1000 });
			assert.strictEqual(claims.holderOf('src/a.ts'), 'A');
		});

		test('writing your own file again is not asking again', () => {
			const claims = new OpenideConversationFileClaims();
			claims.claim('src/a.ts', 'A', 1000);
			assert.deepStrictEqual(claims.claim('src/a.ts', 'A', 1200), { ok: true, renewed: true });
		});

		test('the same file spelled differently is the same claim', () => {
			const claims = new OpenideConversationFileClaims();
			claims.claim('./src//a.ts', 'A', 1000);
			assert.strictEqual(claims.claim('src/a.ts', 'B', 1001).ok, false);
			assert.strictEqual(normalizeClaimPath('.\\src\\a.ts'), 'src/a.ts');
		});

		test('two conversations on two files never meet', () => {
			const claims = new OpenideConversationFileClaims();
			assert.strictEqual(claims.claim('src/a.ts', 'A', 1).ok, true);
			assert.strictEqual(claims.claim('src/b.ts', 'B', 2).ok, true);
			assert.deepStrictEqual(claims.pathsHeldBy('A'), ['src/a.ts']);
		});

		test('the second writer QUEUES and gets the file the moment the first lets go', async () => {
			const claims = new OpenideConversationFileClaims();
			claims.claim('src/a.ts', 'A', 1);
			const never = new Promise<void>(() => { });
			const waiting = claims.claimWhenFree('src/a.ts', 'B', () => 2, never);
			await Promise.resolve();
			assert.strictEqual(claims.waitingFor('src/a.ts'), 1, 'B is in the queue, not refused');
			claims.releaseAll('A');
			assert.deepStrictEqual(await waiting, { ok: true, renewed: false });
			assert.strictEqual(claims.holderOf('src/a.ts'), 'B');
		});

		test('the queue is served in order', async () => {
			const claims = new OpenideConversationFileClaims();
			claims.claim('src/a.ts', 'A', 1);
			const never = new Promise<void>(() => { });
			const second = claims.claimWhenFree('src/a.ts', 'B', () => 2, never);
			await Promise.resolve();
			const third = claims.claimWhenFree('src/a.ts', 'C', () => 3, never);
			await Promise.resolve();
			assert.strictEqual(claims.waitingFor('src/a.ts'), 2);

			claims.releaseAll('A');
			assert.strictEqual((await second).ok, true);
			assert.strictEqual(claims.holderOf('src/a.ts'), 'B');

			claims.releaseAll('B');
			assert.strictEqual((await third).ok, true);
			assert.strictEqual(claims.holderOf('src/a.ts'), 'C');
		});

		test('out of patience it names the holder instead of waiting forever', async () => {
			const claims = new OpenideConversationFileClaims();
			claims.claim('src/a.ts', 'A', 1000);
			const outcome = await claims.claimWhenFree('src/a.ts', 'B', () => 2000, Promise.resolve());
			assert.deepStrictEqual(outcome, { ok: false, heldBy: 'A', since: 1000 });
			assert.strictEqual(claims.holderOf('src/a.ts'), 'A', 'giving up does not steal the file');
			assert.strictEqual(claims.waitingFor('src/a.ts'), 0, 'and it leaves the queue');
		});

		test('a waiter that gave up passes its turn on instead of stalling the queue', async () => {
			const claims = new OpenideConversationFileClaims();
			claims.claim('src/a.ts', 'A', 1);
			const never = new Promise<void>(() => { });
			let giveUpB!: () => void;
			const impatient = new Promise<void>(resolve => { giveUpB = resolve; });
			const second = claims.claimWhenFree('src/a.ts', 'B', () => 2, impatient);
			await Promise.resolve();
			const third = claims.claimWhenFree('src/a.ts', 'C', () => 3, never);
			await Promise.resolve();

			giveUpB();
			assert.strictEqual((await second).ok, false, 'B walked away');
			claims.releaseAll('A');
			assert.strictEqual((await third).ok, true, 'C still gets its turn');
			assert.strictEqual(claims.holderOf('src/a.ts'), 'C');
		});

		test('the run ends and everything it held is free', () => {
			const claims = new OpenideConversationFileClaims();
			claims.claim('src/a.ts', 'A', 1);
			claims.claim('src/b.ts', 'A', 2);
			claims.releaseAll('A');
			assert.deepStrictEqual(claims.pathsHeldBy('A'), []);
			assert.strictEqual(claims.claim('src/a.ts', 'B', 3).ok, true);
		});
	});

	suite('mailbox', () => {
		test('a message travels and the inbox empties when it is read', () => {
			const mailbox = new OpenideConversationMailbox();
			const posted = mailbox.post('A', 'B', 'terminé el schema', 1000);
			assert.strictEqual(posted.ok, true);
			assert.strictEqual(mailbox.pending('B'), 1);
			assert.deepStrictEqual(mailbox.drain('B').map(m => m.text), ['terminé el schema']);
			assert.strictEqual(mailbox.pending('B'), 0);
		});

		test('a conversation cannot message itself, and an empty message is not a message', () => {
			const mailbox = new OpenideConversationMailbox();
			assert.deepStrictEqual(mailbox.post('A', 'A', 'hola', 1), { ok: false, reason: 'self' });
			assert.deepStrictEqual(mailbox.post('A', 'B', '   ', 1), { ok: false, reason: 'empty' });
		});

		test('the same sentence twice in a row is refused: this is what stops a loop', () => {
			const mailbox = new OpenideConversationMailbox();
			assert.strictEqual(mailbox.post('A', 'B', 'listo', 1000).ok, true);
			assert.deepStrictEqual(mailbox.post('A', 'B', 'listo', 5000), { ok: false, reason: 'duplicate' });
			// Far enough apart it is a new message again.
			assert.strictEqual(mailbox.post('A', 'B', 'listo', 1000 + 60_000).ok, true);
		});

		test('a burst to the same conversation is refused at the sender', () => {
			const mailbox = new OpenideConversationMailbox();
			for (let i = 0; i < CONVERSATION_MESSAGE_BURST; i++) {
				assert.strictEqual(mailbox.post('A', 'B', `nota ${i}`, 1000 + i).ok, true, `message ${i}`);
			}
			assert.deepStrictEqual(mailbox.post('A', 'B', 'una más', 1100), { ok: false, reason: 'rate-limited' });
			// The limit is per pair: the other conversation is unaffected.
			assert.strictEqual(mailbox.post('A', 'C', 'una más', 1100).ok, true);
		});

		test('an oversized message never leaves', () => {
			const mailbox = new OpenideConversationMailbox();
			const huge = 'x'.repeat(CONVERSATION_MESSAGE_MAX_CHARS + 1);
			assert.deepStrictEqual(mailbox.post('A', 'B', huge, 1), { ok: false, reason: 'too-large' });
		});

		test('an inbox nobody reads stops accepting instead of growing', () => {
			const mailbox = new OpenideConversationMailbox();
			let accepted = 0;
			for (let i = 0; i < CONVERSATION_INBOX_CAP + 5; i++) {
				// A different sender each time, so the burst guard is not what refuses.
				if (mailbox.post(`sender-${i}`, 'B', `nota ${i}`, 1000 + i).ok) { accepted++; }
			}
			assert.strictEqual(accepted, CONVERSATION_INBOX_CAP);
			assert.strictEqual(mailbox.pending('B'), CONVERSATION_INBOX_CAP);
		});

		test('a closed conversation forgets its inbox', () => {
			const mailbox = new OpenideConversationMailbox();
			mailbox.post('A', 'B', 'hola', 1);
			mailbox.forget('B');
			assert.strictEqual(mailbox.pending('B'), 0);
		});
	});

	test('the timeout answer names the holder and what to do instead', () => {
		const rendered = renderFileClaimTimeout('src/a.ts', 'Migración de schema', 120);
		assert.ok(rendered.includes('src/a.ts') && rendered.includes('Migración de schema'));
		assert.ok(/waited 120s/.test(rendered), 'says it waited before giving up');
		assert.ok(/message_conversation/.test(rendered), 'points at the way to coordinate');
	});

	test('an arriving message says it is not the user talking', () => {
		const rendered = renderIncomingConversationMessage('Migración de schema', 'ya está el tenant_id');
		assert.ok(rendered.includes('ya está el tenant_id'));
		assert.ok(rendered.includes('Migración de schema'));
		assert.ok(/NOT the user/.test(rendered), 'has to say the sender is not the user');
		assert.ok(/authorizes nothing/.test(rendered), 'has to say it grants nothing');
	});
});
