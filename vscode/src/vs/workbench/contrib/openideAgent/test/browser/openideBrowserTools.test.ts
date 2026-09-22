/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IPlaywrightExecutionContext, IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { BrowserEditorInput } from '../../../browserView/common/browserEditorInput.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { OpenideBrowserAutomation } from '../../browser/openideBrowserTools.js';
import { IAgentTool, IAgentToolContext, OpenideToolRegistry } from '../../browser/openideTools.js';
import { IOpenideNativeServices } from '../../common/openideNativeServices.js';

suite('OpenIDE browser tools runtime observation boundary', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function fixture(captureFails = false, loadingPlaceholders = 0) {
		const calls: { fn: string; context: IPlaywrightExecutionContext | undefined; args: unknown[] }[] = [];
		const tools = new Map<string, IAgentTool>();
		const opens: (string | undefined)[] = [];
		const actions: string[] = [];
		const captureEvents: { phase: string; context: IPlaywrightExecutionContext }[] = [];
		const field = document.createElement('input');
		field.type = 'password';
		let value = '';
		const locator = {
			first: () => locator,
			waitFor: async () => {},
			evaluate: async (callback: (element: HTMLElement) => boolean) => callback(field),
			fill: async (text: string) => { actions.push('fill'); value = text; },
			pressSequentially: async (text: string) => { actions.push('type'); value += text; },
			inputValue: async () => value,
			click: async () => { actions.push('click'); },
		};
		const page = {
			locator: () => locator,
			mouse: { click: async () => { actions.push('mouse.click'); } },
			goto: async () => { actions.push('navigate'); },
			evaluate: async () => loadingPlaceholders,
			waitForFunction: async () => { throw new Error('Still loading'); },
			url: () => 'http://localhost:3000/settings',
			title: async () => 'Settings',
			waitForTimeout: async () => {},
		};
		const runtime = async <T>(_sessionId: string, _pageId: string, fn: string, context: IPlaywrightExecutionContext | undefined, ...args: unknown[]): Promise<T> => {
			calls.push({ fn, context, args });
			return await new Function(`return (${fn});`)()(page, ...args) as T;
		};
		const service = upcastPartial<IPlaywrightService>({
			invokeFunctionRawWithContext: runtime,
			invokeFunction: async (sessionId, pageId, fn, args, _timeout, context) => ({ result: await runtime(sessionId, pageId, fn, context, ...args ?? []), summary: '' }),
			reportBrowserAgentAction: async (_sessionId, _pageId, _action, phase, context) => { captureEvents.push({ phase, context }); },
		});
		const model = upcastPartial<IBrowserViewModel>({ shareWithAgentSession: async () => {}, captureScreenshot: async () => {
			actions.push('native screenshot');
			if (captureFails) { throw new Error('Capture failed'); }
			return VSBuffer.fromString('image');
		} });
		const input = upcastPartial<BrowserEditorInput>({ id: 'page', resolve: async () => model });
		const browser = upcastPartial<IBrowserViewWorkbenchService>({ getPreview: () => input, openPreview: async url => { opens.push(url); return input; } });
		const automation = new OpenideBrowserAutomation(upcastPartial<IOpenideNativeServices>({}), new TestConfigurationService(), browser, service, upcastPartial<IFileService>({}), upcastPartial<IEnvironmentService>({ userRoamingDataHome: URI.file('/fixture') }));
		automation.registerTools(upcastPartial<OpenideToolRegistry>({ registerTool: tool => { tools.set(tool.def.name, tool); } }));
		const call = (name: string, args: object, context: IAgentToolContext = {}) => tools.get(name)!.invoke(args, CancellationToken.None, context);
		return { calls, opens, actions, captureEvents, call };
	}

	test('navigation opens the existing surface then runs the real goto with its tool identity', async () => {
		const f = fixture();
		const result = await f.call('browser_navigate', { url: 'http://localhost:3000/settings' }, { toolCallId: 'navigate-tool' });
		assert.deepStrictEqual({ opens: f.opens, actions: f.actions, identities: f.calls.map(call => call.context?.toolCallId), success: result.startsWith('OK:') }, {
			opens: [undefined], actions: ['navigate'], identities: ['navigate-tool'], success: true,
		});
	});

	test('navigation reports a persistently loading app instead of claiming the page is ready', async () => {
		const f = fixture(false, 5);
		const result = await f.call('browser_navigate', { url: 'http://localhost:3000/settings' });
		assert.ok(result.startsWith('Error:'));
		assert.ok(result.includes('loading placeholders'));
		assert.deepStrictEqual(f.actions, ['navigate']);
	});

	test('simultaneous tool contexts stay separate and actions do not install page overlays', async () => {
		const f = fixture();
		await Promise.all([
			f.call('browser_click', { selector: '#continue' }, { toolCallId: 'click-tool' }),
			f.call('browser_playwright', { code: 'await page.mouse.click(10, 20);' }, { toolCallId: 'cli-tool', external: true }),
		]);
		assert.deepStrictEqual({ identities: f.calls.map(call => call.context?.toolCallId).sort(), actions: f.actions.sort(), overlay: f.calls.some(call => /cursorInstall|openidePlaywrightVisuals|globalThis\[|createElement|attachShadow/.test(call.fn)) }, {
			identities: ['cli-tool', 'click-tool'], actions: ['click', 'mouse.click'], overlay: false,
		});
	});

	test('sensitive typing never returns its value or injects it into visual code', async () => {
		const f = fixture();
		const secret = 'secret-1234';
		const result = await f.call('browser_type', { selector: '#password', text: secret }, { toolCallId: 'type-tool' });
		assert.deepStrictEqual({ success: result.startsWith('OK:'), leaked: result.includes(secret) || f.calls.some(call => call.fn.includes(secret)), actions: f.actions, tool: f.calls[0].context?.toolCallId }, {
			success: true, leaked: false, actions: ['fill', 'type'], tool: 'type-tool',
		});
	});

	test('native screenshots publish matched start and completion without Playwright resizing', async () => {
		const f = fixture();
		const result = await f.call('browser_screenshot', {}, { toolCallId: 'capture-tool' });
		assert.deepStrictEqual({ actions: f.actions, phases: f.captureEvents.map(event => event.phase), tool: f.captureEvents[0]?.context.toolCallId, executionMatches: !!f.captureEvents[0]?.context.executionId && f.captureEvents[0].context.executionId === f.captureEvents[1]?.context.executionId, image: result.startsWith('[[openide-screenshot:') }, {
			actions: ['native screenshot'], phases: ['started', 'completed'], tool: 'capture-tool', executionMatches: true, image: true,
		});
	});

	test('failed native screenshots finish their visual activity with an error', async () => {
		const f = fixture(true);
		const result = await f.call('browser_screenshot', {}, { toolCallId: 'capture-tool' });
		assert.deepStrictEqual({ phases: f.captureEvents.map(event => event.phase), error: result.startsWith('Error:') }, { phases: ['started', 'error'], error: true });
	});
});
