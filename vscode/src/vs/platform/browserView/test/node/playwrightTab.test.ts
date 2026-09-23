/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'node:events';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { AgentNetworkFilterService } from '../../../networkFilter/common/networkFilterService.js';
import { AgentNetworkDomainSettingId } from '../../../networkFilter/common/settings.js';
import { IPlaywrightActionScope } from '../../node/playwrightService.js';
import { PlaywrightTab } from '../../node/playwrightTab.js';

type PlaywrightPage = ConstructorParameters<typeof PlaywrightTab>[0];

class TestPage extends mock<PlaywrightPage>() {
	readonly events = new EventEmitter();

	constructor(private readonly currentUrl: string, private readonly pageErrorHistory: Error[] = []) {
		super();
	}

	override on(event: string, listener: (...args: never[]) => void): this {
		this.events.on(event, listener as (...args: unknown[]) => void);
		return this;
	}

	override off(event: string, listener: (...args: never[]) => void): this {
		this.events.off(event, listener as (...args: unknown[]) => void);
		return this;
	}

	override url(): string {
		return this.currentUrl;
	}

	override async consoleMessages() {
		return [];
	}

	override async pageErrors() {
		return this.pageErrorHistory;
	}

	override async title(): Promise<string> {
		return 'Private page';
	}

	override async ariaSnapshot(): Promise<string> {
		return 'Private page content';
	}
}

suite('PlaywrightTab', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('blocks agent access after Chromium normalizes an IPv4-mapped IPv6 URL', async () => {
		const url = 'http://[::ffff:7f00:1]:3000/private';
		const page = new TestPage(url);

		const configService = new TestConfigurationService();
		configService.setUserConfiguration(AgentNetworkDomainSettingId.NetworkFilter, true);
		configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, []);
		configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, []);
		const networkFilterService = disposables.add(new AgentNetworkFilterService(configService));
		const actionScope: IPlaywrightActionScope = { activeCalls: 0 };
		const tab = new PlaywrightTab(page, actionScope, networkFilterService);

		let actionRan = false;
		let actionBlocked = false;
		try {
			await tab.safeRunAgainstPage(async () => {
				actionRan = true;
			});
		} catch {
			actionBlocked = true;
		}
		const summary = await tab.getSummary();

		assert.deepStrictEqual({
			actionBlocked,
			actionRan,
			summary,
		}, {
			actionBlocked: true,
			actionRan: false,
			summary: networkFilterService.formatError(URI.parse(url)),
		});
	});

	test('bounds recent events and reports omitted and truncated evidence', async () => {
		const errors = Array.from({ length: 55 }, (_, index) => {
			const error = new Error(`event ${index + 1}`);
			error.stack = undefined;
			return error;
		});
		const longError = new Error(`event 56 ${'x'.repeat(1500)} TAIL`);
		longError.stack = undefined;
		errors.push(longError);

		const page = new TestPage('about:blank', errors);
		const networkFilterService = disposables.add(new AgentNetworkFilterService(new TestConfigurationService()));
		const tab = new PlaywrightTab(page, { activeCalls: 0 }, networkFilterService);
		const firstSummary = await tab.getSummary();
		const secondSummary = await tab.getSummary();

		const nextError = new Error('event after summary');
		nextError.stack = undefined;
		page.events.emit('pageerror', nextError);
		const thirdSummary = await tab.getSummary();

		const descriptions = (summary: string) => summary.split('\n')
			.filter(line => line.includes('(pageError)'))
			.map(line => line.slice(line.indexOf(') ') + 2));
		const firstDescriptions = descriptions(firstSummary);
		const longDescription = firstDescriptions.at(-1);
		assert.deepStrictEqual({
			omitted: firstSummary.match(/^Older events omitted: (\d+)$/m)?.[1],
			retained: firstDescriptions.length,
			oldest: firstDescriptions[0],
			newestLength: longDescription?.length,
			newestTruncated: longDescription?.endsWith('... [truncated]'),
			newestIncludesTail: longDescription?.includes('TAIL'),
			secondHasEvents: secondSummary.includes('Recent events:'),
			thirdDescriptions: descriptions(thirdSummary),
			thirdHasOmissions: thirdSummary.includes('Older events omitted:'),
		}, {
			omitted: '6',
			retained: 50,
			oldest: 'event 7',
			newestLength: 1000,
			newestTruncated: true,
			newestIncludesTail: false,
			secondHasEvents: false,
			thirdDescriptions: ['event after summary'],
			thirdHasOmissions: false,
		});
	});
});
