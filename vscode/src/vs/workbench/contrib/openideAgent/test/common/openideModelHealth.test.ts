/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { classifyProviderError } from '../../common/openideErrorClassifier.js';
import {
	describeCooldown,
	IModelTarget,
	isModelCoolingDown,
	isModelHealthSignal,
	MODEL_COOLDOWN_LADDER_MS,
	planModelRun,
	recordModelFailure,
	recordModelSuccess,
} from '../../common/openideModelHealth.js';
import { getOpenideLanguage, setOpenideLanguage, t } from '../../common/openideStrings.js';
import { ISubagentTargetHealth, subagentTargetKey } from '../../common/openideSubagentRouting.js';

const FREE: IModelTarget = { providerId: 'openrouter', model: 'z-ai/glm-5.2:free' };
const PAID: IModelTarget = { providerId: 'openrouter', model: 'z-ai/glm-5.2' };
const RATE_LIMITED = classifyProviderError('HTTP 429 {"error":{"metadata":{"retry_after_seconds":5}}}');

suite('OpenIDE model health', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('trusts the provider once, then stops trusting it', () => {
		const now = 1_000_000;
		const first = recordModelFailure(undefined, FREE, RATE_LIMITED, now);
		assert.strictEqual(first.status, 'rate-limit');
		assert.strictEqual(first.failures, 1);
		assert.strictEqual(first.until, now + 5_000, 'the first failure waits exactly what was asked');

		// The 5s it asked for went by and it failed again: the suggestion has been proven wrong. The
		// streak has to survive the expired wait, which is the only reason it is worth keeping.
		const second = recordModelFailure(first, FREE, RATE_LIMITED, now + 20_000);
		assert.strictEqual(second.failures, 2, 'an expired cooldown does not reset the streak');
		assert.strictEqual(second.until, now + 20_000 + MODEL_COOLDOWN_LADDER_MS[0]);
		const third = recordModelFailure(second, FREE, RATE_LIMITED, now + 20_000);
		assert.strictEqual(third.until, now + 20_000 + MODEL_COOLDOWN_LADDER_MS[1]);

		// Hours later it is a new incident, and the provider gets the benefit of the doubt again.
		const muchLater = recordModelFailure(third, FREE, RATE_LIMITED, now + 4 * 60 * 60_000);
		assert.strictEqual(muchLater.failures, 1);

		// A different kind of failure says nothing about the previous streak.
		const notFound = recordModelFailure(third, FREE, classifyProviderError('HTTP 404: model not found'), now + 20_000);
		assert.strictEqual(notFound.failures, 1);

		// An answer clears everything: a model that came back is trusted at once.
		const healthy = recordModelSuccess(FREE, now);
		assert.strictEqual(healthy.status, 'available');
		assert.strictEqual(healthy.failures, 0);
		assert.strictEqual(isModelCoolingDown(healthy, now), false);
	});

	test('a wait that expired is not a cooldown, and auth never is one', () => {
		const now = 1_000_000;
		const cooling = recordModelFailure(undefined, FREE, RATE_LIMITED, now);
		assert.strictEqual(isModelCoolingDown(cooling, now + 4_000), true);
		assert.strictEqual(isModelCoolingDown(cooling, now + 6_000), false, 'an expired deadline reads as available');

		// Waiting does not fix a credential, and a stale auth record must not lock the user out of
		// their own model: it is recorded, it does not block.
		const auth = recordModelFailure(undefined, FREE, classifyProviderError('HTTP 401 unauthorized'), now);
		assert.strictEqual(auth.status, 'auth');
		assert.strictEqual(auth.until, undefined);
		assert.strictEqual(isModelCoolingDown(auth, now), false);
	});

	test('only failures that describe the target are recorded', () => {
		assert.strictEqual(isModelHealthSignal(RATE_LIMITED), true);
		assert.strictEqual(isModelHealthSignal(classifyProviderError('HTTP 503 internal server error')), true);
		assert.strictEqual(isModelHealthSignal(classifyProviderError('maximum context length exceeded')), false);
		assert.strictEqual(isModelHealthSignal(classifyProviderError('la tool tiró una excepción rarísima')), false);
	});

	test('a cooling model is stepped over for the turn, never replaced', () => {
		const now = 1_000_000;
		const health = new Map<string, ISubagentTargetHealth>([
			[subagentTargetKey(FREE), recordModelFailure(undefined, FREE, RATE_LIMITED, now)],
		]);
		const lookup = (target: IModelTarget) => health.get(subagentTargetKey(target));

		const redirected = planModelRun(FREE, [PAID], lookup, now);
		assert.deepStrictEqual(redirected.target, PAID);
		assert.deepStrictEqual(redirected.redirectedFrom?.target, FREE);

		// Once the wait is over the intended model gets its turn back without anyone clearing anything.
		assert.deepStrictEqual(planModelRun(FREE, [PAID], lookup, now + 6_000).target, FREE);

		// Nothing healthy to fall to: run the intended one anyway. A stale cooldown must never be
		// able to refuse a turn outright.
		health.set(subagentTargetKey(PAID), recordModelFailure(undefined, PAID, RATE_LIMITED, now));
		const noWayOut = planModelRun(FREE, [PAID], lookup, now);
		assert.deepStrictEqual(noWayOut.target, FREE);
		assert.strictEqual(noWayOut.redirectedFrom, undefined);

		// An empty chain is the same story.
		assert.deepStrictEqual(planModelRun(FREE, [], lookup, now).target, FREE);
	});

	test('says the wait the way a person would, in both languages', () => {
		const now = 0;
		const before = getOpenideLanguage();
		try {
			setOpenideLanguage('es');
			assert.strictEqual(describeCooldown(5_000, now), '5 segundos');
			assert.strictEqual(describeCooldown(120_000, now), '2 minutos');
			// Upstream's own ladder: under 90 minutes it stays in minutes rather than jumping to hours.
			assert.strictEqual(describeCooldown(3_900_000, now), '65 minutos');
			assert.strictEqual(describeCooldown(7_500_000, now), '2 h 5 min');
			assert.strictEqual(describeCooldown(7_200_000, now), '2 horas');
			setOpenideLanguage('en');
			assert.strictEqual(describeCooldown(5_000, now), '5 seconds');
			assert.strictEqual(describeCooldown(7_200_000, now), '2 hours');
			assert.strictEqual(describeCooldown(3_900_000, now), t('cooldown.minutes', 65));
		} finally {
			setOpenideLanguage(before);
		}
	});
});
