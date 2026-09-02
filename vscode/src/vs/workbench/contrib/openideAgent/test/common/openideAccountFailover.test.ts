/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	decideOpenideAccountFailover, IOpenideFailoverCandidate, IOpenideFailoverInput, openideFailoverCandidates,
} from '../../common/openideAccountFailover.js';

suite('OpenIDE account failover', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const spent: IOpenideFailoverCandidate = { accountId: 'a', label: 'a@x.com', usedPercent: 99 };
	const roomy: IOpenideFailoverCandidate = { accountId: 'b', label: 'b@x.com', usedPercent: 10 };

	function input(over: Partial<IOpenideFailoverInput> = {}): IOpenideFailoverInput {
		return {
			mode: 'auto', exhausted: true, activeAccountId: 'a', accounts: [spent, roomy],
			providerBusy: false, alreadySwitched: false, ...over,
		};
	}

	test('off does nothing, which is the default', () => {
		// The user still gets told why the run stopped; what `off` withholds is the ACTION, because
		// moving to another account spends a subscription nobody authorised in that moment.
		assert.deepStrictEqual(decideOpenideAccountFailover(input({ mode: 'off' })), { kind: 'stop', reason: 'off' });
	});

	test('a failure that is not the account\'s quota is left alone', () => {
		// A saturated shared pool and an expired token are also 429/401. Neither is fixed by paying
		// with a different account: one needs waiting, the other a login.
		assert.deepStrictEqual(
			decideOpenideAccountFailover(input({ exhausted: false })),
			{ kind: 'stop', reason: 'not-exhausted' },
		);
	});

	test('one account with room and nothing to weigh: move', () => {
		const decision = decideOpenideAccountFailover(input());
		assert.strictEqual(decision.kind, 'switch');
		assert.strictEqual(decision.kind === 'switch' && decision.to.accountId, 'b');
	});

	test('two accounts with room is a question, even on auto', () => {
		// Which subscription pays is the user's call, and auto was never a mandate to choose for them.
		const decision = decideOpenideAccountFailover(input({
			accounts: [spent, roomy, { accountId: 'c', label: 'c@x.com', usedPercent: 20 }],
		}));
		assert.strictEqual(decision.kind, 'ask');
		assert.deepStrictEqual(decision.kind === 'ask' && decision.candidates.map(c => c.accountId), ['b', 'c']);
	});

	test('a metered account is a question too, even when it is the only one', () => {
		const decision = decideOpenideAccountFailover(input({
			accounts: [spent, { ...roomy, paid: true }],
		}));
		assert.strictEqual(decision.kind, 'ask');
	});

	test('a run of the same provider in flight blocks the switch', () => {
		// Activating an account rewrites the provider's active credential, so switching now pulls it
		// out from under the run that is streaming on it.
		assert.deepStrictEqual(
			decideOpenideAccountFailover(input({ providerBusy: true })),
			{ kind: 'stop', reason: 'provider-busy' },
		);
	});

	test('one retry, never a walk down the account list', () => {
		assert.deepStrictEqual(
			decideOpenideAccountFailover(input({ alreadySwitched: true })),
			{ kind: 'stop', reason: 'already-switched' },
		);
	});

	test('every other account is spent too, so there is nowhere to go', () => {
		assert.deepStrictEqual(
			decideOpenideAccountFailover(input({ accounts: [spent, { accountId: 'b', label: 'b', usedPercent: 100 }] })),
			{ kind: 'stop', reason: 'no-candidate' },
		);
	});

	test('an account the roster knows nothing about is a candidate, ranked last', () => {
		// "No data" is not "no room", and the alternative to trying it is stopping for certain. But a
		// measured account with room is the better bet, so it goes first.
		const unknown: IOpenideFailoverCandidate = { accountId: 'z', label: 'z@x.com' };
		const candidates = openideFailoverCandidates(input({ accounts: [spent, unknown, roomy] }));
		assert.deepStrictEqual(candidates.map(c => c.accountId), ['b', 'z']);
	});

	test('the active account is never offered back to itself', () => {
		const candidates = openideFailoverCandidates(input({
			activeAccountId: 'b', accounts: [roomy, { accountId: 'c', label: 'c', usedPercent: 5 }],
		}));
		assert.deepStrictEqual(candidates.map(c => c.accountId), ['c']);
	});
});
