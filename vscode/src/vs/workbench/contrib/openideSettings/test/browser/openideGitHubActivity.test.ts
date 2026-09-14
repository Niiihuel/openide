/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { VSBuffer, bufferToStream } from '../../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { OpenideActivityCalendar } from '../../../../browser/openideActivityCalendar.js';
import { OpenideGitHubActivity, OpenideGitHubActivityError } from '../../browser/openideGitHubActivity.js';

suite('OpenIDE GitHub activity', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		let requests = 0;
		let signedIn = true;
		let status = 200;
		let viewer = 'octocat';
		const changes = store.add(new Emitter<{ providerId: string; label: string; event: { added: []; removed: []; changed: [] } }>());
		const data = { totalContributions: 2, weeks: [{ contributionDays: [{ date: '2026-09-12', contributionCount: 2, contributionLevel: 'SECOND_QUARTILE' }] }] };
		const activity = store.add(new OpenideGitHubActivity(upcastPartial<IAuthenticationService>({
			onDidChangeSessions: changes.event,
			getSessions: async (provider, scopes, options) => {
				assert.deepStrictEqual({ provider, scopes, options }, { provider: 'github', scopes: undefined, options: { silent: true } });
				return signedIn ? [{ id: 'test', accessToken: 'fixture-token', scopes: ['read:user'], account: { id: '1', label: 'octocat' } }] : [];
			},
		}), upcastPartial<IRequestService>({ request: async options => {
			requests++;
			assert.deepStrictEqual({ url: options.url, type: options.type }, { url: 'https://api.github.com/graphql', type: 'POST' });
			return { res: { statusCode: status, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify({ data: { viewer: { login: viewer, contributionsCollection: { contributionCalendar: data } } } }))) };
		} })));
		return { activity, data, requests: () => requests, signOut: () => { signedIn = false; changes.fire({ providerId: 'github', label: 'GitHub', event: { added: [], removed: [], changed: [] } }); }, status: (value: number) => status = value, viewer: (value: string) => viewer = value };
	}

	test('uses authenticated calendar, caches repeated reads and refreshes explicitly', async () => {
		const f = fixture();
		const value = await f.activity.load('octocat', CancellationToken.None);
		await f.activity.load('octocat', CancellationToken.None);
		assert.strictEqual(f.requests(), 1);
		await f.activity.load('octocat', CancellationToken.None, true);
		assert.deepStrictEqual({ value, requests: f.requests() }, { value: { total: 2, days: [{ date: '2026-09-12', count: 2, level: 2 }] }, requests: 2 });
	});

	test('sign out invalidates cache and never returns another account activity', async () => {
		const f = fixture();
		await f.activity.load('octocat', CancellationToken.None);
		f.signOut();
		await assert.rejects(f.activity.load('octocat', CancellationToken.None), error => error instanceof OpenideGitHubActivityError && error.reason === 'session');
		assert.strictEqual(f.requests(), 1);
		const other = fixture(); other.viewer('someone-else');
		await assert.rejects(other.activity.load('octocat', CancellationToken.None), OpenideGitHubActivityError);
	});

	test('rate limits and zero activity are distinct states', async () => {
		const f = fixture(); f.status(403);
		await assert.rejects(f.activity.load('octocat', CancellationToken.None), error => error instanceof OpenideGitHubActivityError && error.reason === 'limited');
		f.status(200); f.data.totalContributions = 0;
		f.data.weeks[0].contributionDays[0].contributionCount = 0;
		f.data.weeks[0].contributionDays[0].contributionLevel = 'NONE';
		assert.strictEqual((await f.activity.load('octocat', CancellationToken.None)).total, 0);
	});

	test('cancellation while resolving authentication prevents the network request', async () => {
		const ready = new DeferredPromise<void>();
		let requests = 0;
		const auth = upcastPartial<IAuthenticationService>({ onDidChangeSessions: () => ({ dispose() {} }), getSessions: async () => { await ready.p; return []; } });
		const activity = store.add(new OpenideGitHubActivity(auth, upcastPartial<IRequestService>({ request: async () => { requests++; throw new Error('unexpected request'); } })));
		const cancellation = new CancellationTokenSource();
		const pending = activity.load('octocat', cancellation.token);
		cancellation.cancel(); await ready.complete();
		await assert.rejects(pending, /Canceled/);
		cancellation.dispose();
		assert.strictEqual(requests, 0);
	});

	test('calendar is one tab stop with keyboard day and week navigation, including leap day', () => {
		const parent = mainWindow.document.createElement('div');
		mainWindow.document.body.append(parent);
		try {
			const days = Array.from({ length: 10 }, (_, index) => ({ date: new Date(Date.UTC(2024, 1, 25 + index)).toISOString().slice(0, 10), count: index, level: index % 5 }));
			const calendar = store.add(new OpenideActivityCalendar(parent, days, { label: 'Activity', locale: 'en', less: 'Less', more: 'More', describe: (day, date) => `${day.count} contributions on ${date}` }, NullHoverService));
			const cells = [...calendar.domNode.querySelectorAll<HTMLElement>('.openide-activity-calendar-days .openide-activity-calendar-day')];
			cells[9].focus();
			cells[9].dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
			assert.strictEqual(mainWindow.document.activeElement, cells[2]);
			cells[2].dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
			assert.strictEqual(mainWindow.document.activeElement, cells[3]);
			assert.strictEqual(calendar.domNode.querySelectorAll('[tabindex="0"]').length, 1);
			assert.match(cells[4].getAttribute('aria-label')!, /February 29/);
			cells[0].focus();
			assert.strictEqual(calendar.domNode.querySelectorAll('[tabindex="0"]').length, 1, 'pointer or programmatic focus updates the roving tab stop');
		} finally { parent.remove(); }
	});
});
