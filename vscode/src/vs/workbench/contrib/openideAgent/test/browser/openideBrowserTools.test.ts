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
import { IFileService, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { BrowserEditorInput } from '../../../browserView/common/browserEditorInput.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { OpenideBrowserAutomation } from '../../browser/openideBrowserTools.js';
import { IAgentTool, IAgentToolContext, OpenideToolRegistry } from '../../browser/openideTools.js';
import { IOpenideNativeServices } from '../../common/openideNativeServices.js';

suite('OpenIDE browser tools runtime observation boundary', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function fixture(captureFails = false, loadingPlaceholders = 0, ambiguousSelectors: readonly string[] = []) {
		const calls: { fn: string; context: IPlaywrightExecutionContext | undefined; args: unknown[] }[] = [];
		const tools = new Map<string, IAgentTool>();
		const opens: (string | undefined)[] = [];
		const actions: string[] = [];
		const captureEvents: { phase: string; context: IPlaywrightExecutionContext }[] = [];
		const debugCalls: string[] = [];
		const writtenFiles: { path: string; content: string }[] = [];
		const field = document.createElement('input');
		field.type = 'password';
		let value = '';
		const locator = {
			first: () => locator,
			waitFor: async () => {},
			evaluate: async <T>(callback: (element: HTMLElement) => T): Promise<T> => callback(field),
			fill: async (text: string) => { actions.push('fill'); value = text; },
			pressSequentially: async (text: string) => { actions.push('type'); value += text; },
			inputValue: async () => value,
			click: async () => { actions.push('click'); },
			scrollIntoViewIfNeeded: async () => {},
			boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }),
		};
		const ambiguousLocator = {
			...locator,
			first: () => locator,
			waitFor: async () => { throw new Error('strict mode violation: selector resolved to 2 elements'); },
			click: async () => { throw new Error('strict mode violation: selector resolved to 2 elements'); },
		};
		const page = {
			locator: (selector: string) => ambiguousSelectors.includes(selector) ? ambiguousLocator : locator,
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
			startDebugCapture: async (_sessionId, pageId) => { debugCalls.push(`start:${pageId}`); return { active: true, startedAt: 1_000, requestCount: 0, consoleCount: 0, droppedRequestCount: 0, droppedConsoleCount: 0 }; },
			getDebugCaptureStatus: async (_sessionId, pageId) => { debugCalls.push(`status:${pageId}`); return { active: true, startedAt: 1_000, requestCount: 1, consoleCount: 1, droppedRequestCount: 0, droppedConsoleCount: 0 }; },
			stopDebugCapture: async (_sessionId, pageId) => {
				debugCalls.push(`stop:${pageId}`);
				return {
					active: false, startedAt: 1_000, stoppedAt: 2_000, durationMs: 1_000,
					requestCount: 1, consoleCount: 1, droppedRequestCount: 0, droppedConsoleCount: 0,
					requests: [{ timestamp: 1_100, method: 'POST', url: 'http://localhost:3000/api/save', status: 500 }],
					console: [{ timestamp: 1_200, type: 'error', text: 'Save failed' }],
				};
			},
		});
		const model = upcastPartial<IBrowserViewModel>({ shareWithAgentSession: async () => {}, captureScreenshot: async () => {
			actions.push('native screenshot');
			if (captureFails) { throw new Error('Capture failed'); }
			return VSBuffer.fromString('image');
		} });
		const input = upcastPartial<BrowserEditorInput>({ id: 'page', resolve: async () => model });
		const browser = upcastPartial<IBrowserViewWorkbenchService>({ getPreview: () => input, openPreview: async url => { opens.push(url); return input; } });
		const files = upcastPartial<IFileService>({
			createFolder: async () => upcastPartial<IFileStatWithMetadata>({}),
			writeFile: async (resource, content) => {
				writtenFiles.push({ path: resource.fsPath, content: (content as VSBuffer).toString() });
				return upcastPartial<IFileStatWithMetadata>({});
			},
		});
		const automation = new OpenideBrowserAutomation(upcastPartial<IOpenideNativeServices>({}), new TestConfigurationService(), browser, service, files, upcastPartial<IEnvironmentService>({ userRoamingDataHome: URI.file('/fixture') }));
		automation.registerTools(upcastPartial<OpenideToolRegistry>({ registerTool: tool => { tools.set(tool.def.name, tool); } }));
		const call = (name: string, args: object, context: IAgentToolContext = {}) => tools.get(name)!.invoke(args, CancellationToken.None, context);
		return { calls, opens, actions, captureEvents, debugCalls, writtenFiles, call };
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

	test('ambiguous selectors do not click, type, capture, or read an arbitrary element', async () => {
		const f = fixture(false, 0, ['.duplicate']);
		const results = await Promise.all([
			f.call('browser_click', { selector: '.duplicate' }),
			f.call('browser_type', { selector: '.duplicate', text: 'unsafe' }),
			f.call('browser_screenshot', { selector: '.duplicate' }),
			f.call('browser_read_dom', { selector: '.duplicate' }),
		]);
		assert.deepStrictEqual({
			strictErrors: results.map(result => result.startsWith('Error: strict mode violation')),
			actions: f.actions,
			captureEvents: f.captureEvents,
		}, {
			strictErrors: [true, true, true, true],
			actions: [],
			captureEvents: [],
		});
	});

	test('debug capture runs across tools and saves a bounded local report', async () => {
		const f = fixture();
		const started = await f.call('browser_debug_start', {});
		const status = await f.call('browser_debug_status', {});
		const stopped = await f.call('browser_debug_stop', {});
		assert.deepStrictEqual({
			started: started.includes('capture active'),
			status: status.includes('1 requests, 1 console messages'),
			stopped: stopped.includes('500 POST http://localhost:3000/api/save') && stopped.includes('Save failed'),
			debugCalls: f.debugCalls,
			reportPath: f.writtenFiles[0]?.path.startsWith('/fixture/openideAgent/browser-debug/'),
			report: f.writtenFiles[0] && JSON.parse(f.writtenFiles[0].content),
		}, {
			started: true,
			status: true,
			stopped: true,
			debugCalls: ['start:page', 'status:page', 'stop:page'],
			reportPath: true,
			report: {
				active: false, startedAt: 1_000, stoppedAt: 2_000, durationMs: 1_000,
				requestCount: 1, consoleCount: 1, droppedRequestCount: 0, droppedConsoleCount: 0,
				requests: [{ timestamp: 1_100, method: 'POST', url: 'http://localhost:3000/api/save', status: 500 }],
				console: [{ timestamp: 1_200, type: 'error', text: 'Save failed' }],
			},
		});
	});

	test('debug capture can be discarded without writing a report', async () => {
		const f = fixture();
		await f.call('browser_debug_start', {});
		const result = await f.call('browser_debug_discard', {});
		assert.deepStrictEqual({ result, debugCalls: f.debugCalls, writtenFiles: f.writtenFiles }, {
			result: 'Browser debug capture stopped and discarded.',
			debugCalls: ['start:page', 'stop:page'],
			writtenFiles: [],
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
