/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IOpenideActivityDay } from '../../../browser/openideActivityCalendar.js';

export interface IOpenideGitHubActivity {
	readonly total: number;
	readonly days: readonly IOpenideActivityDay[];
}

interface ICalendarResponse {
	data?: { viewer?: { login: string; contributionsCollection: { contributionCalendar: {
		totalContributions: number;
		weeks: { contributionDays: { date: string; contributionCount: number; contributionLevel: string }[] }[];
	} } } };
	errors?: readonly { type?: string }[];
}

export class OpenideGitHubActivityError extends Error {
	constructor(readonly reason: 'session' | 'unavailable' | 'limited') { super(reason); }
}

/** Read-only, account-scoped activity. Never prompts for additional repository permissions. */
export class OpenideGitHubActivity extends Disposable {
	private cache: { login: string; time: number; value: IOpenideGitHubActivity } | undefined;
	private generation = 0;
	constructor(
		@IAuthenticationService private readonly authentication: IAuthenticationService,
		@IRequestService private readonly request: IRequestService,
	) {
		super();
		this._register(authentication.onDidChangeSessions(event => {
			if (event.providerId === 'github') { this.cache = undefined; this.generation++; }
		}));
	}

	async load(login: string, token: CancellationToken, refresh = false): Promise<IOpenideGitHubActivity> {
		const generation = this.generation;
		const check = () => {
			if (token.isCancellationRequested || this._store.isDisposed || generation !== this.generation) { throw new CancellationError(); }
		};
		check();
		if (!refresh && this.cache?.login === login && Date.now() - this.cache.time < 300_000) { return this.cache.value; }
		const sessions = await this.authentication.getSessions('github', undefined, { silent: true });
		check();
		const session = sessions.find(value => value.account.label.toLowerCase() === login.toLowerCase());
		if (!session) { throw new OpenideGitHubActivityError('session'); }
		const response = await this.request.request({
			type: 'POST', url: 'https://api.github.com/graphql', callSite: 'openide.profile.activity', timeout: 15_000,
			headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' },
			data: JSON.stringify({ query: '{ viewer { login contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } } } }' }),
		}, token);
		check();
		if (response.res.statusCode === 401) { throw new OpenideGitHubActivityError('session'); }
		if (response.res.statusCode === 403 || response.res.statusCode === 429) { throw new OpenideGitHubActivityError('limited'); }
		if (response.res.statusCode !== 200) { throw new OpenideGitHubActivityError('unavailable'); }
		const body = await asJson<ICalendarResponse>(response);
		check();
		const viewer = body?.data?.viewer;
		if (body?.errors?.length || !viewer || viewer.login.toLowerCase() !== login.toLowerCase()) { throw new OpenideGitHubActivityError('unavailable'); }
		const calendar = viewer.contributionsCollection?.contributionCalendar;
		const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
		if (!calendar || !Number.isSafeInteger(calendar.totalContributions) || calendar.totalContributions < 0 || !Array.isArray(calendar.weeks) || calendar.weeks.length > 54) { throw new OpenideGitHubActivityError('unavailable'); }
		const days = calendar.weeks.flatMap(week => week.contributionDays);
		if (!days.length || days.length > 371 || days.some(day => !day || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isSafeInteger(day.contributionCount) || day.contributionCount < 0 || !levels.includes(day.contributionLevel))) { throw new OpenideGitHubActivityError('unavailable'); }
		const value: IOpenideGitHubActivity = { total: calendar.totalContributions, days: days.map(day => ({ date: day.date, count: day.contributionCount, level: levels.indexOf(day.contributionLevel) })) };
		this.cache = { login, time: Date.now(), value };
		return value;
	}
}
