/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IMarkerService } from '../../../../../platform/markers/common/markers.js';
import { IIdeToolRequest, IIdeToolResult } from '../../../../../platform/openideAgentHost/common/openideIdeServer.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { OpenideIdeServerService } from '../../browser/openideIdeServerService.js';
import { getOpenideCli } from '../../common/openideAgentCliCatalog.js';
import { IOpenideNativeServices } from '../../common/openideNativeServices.js';

suite('OpenIDE CLI presentation routing', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const auxiliary = 101;

	async function fixture(registerCatalog = true) {
		const requests = store.add(new Emitter<IIdeToolRequest>());
		const replies = new Map<string, DeferredPromise<IIdeToolResult>>();
		let counter = 0, available = true;
		const opens: string[] = [];
		const routed: (number | undefined)[] = [];
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IOpenideNativeServices, { host: {
			onDidChangeIdeDiscovery: Event.None, onDidRequestIdeTool: requests.event, onDidCancelIdeTool: Event.None,
			ideRespondTool: async (id: string, result: IIdeToolResult) => { await replies.get(id)!.complete(result); },
			ideSetExtraTools: async () => {}, ideServerStop: async () => {},
			ideServerStart: async () => ({ port: 12345, authToken: 'fixture', lockPath: '/tmp/fixture.lock' }),
		} } as unknown as IOpenideNativeServices);
		const primary = new class extends mock<IEditorService>() {
			override onDidActiveEditorChange = Event.None;
			override async openEditor() { opens.push('ide'); return undefined; }
		};
		const companion = new class extends mock<IEditorService>() {
			override onDidCloseEditor = Event.None;
			override async openEditor() { opens.push('agent'); return undefined; }
		};
		instantiation.stub(IEditorService, primary);
		const scratch = { resource: URI.parse('untitled:proposal'), isDirty: () => true, dispose: () => {} };
		const textFile = { untitled: { resolve: async () => scratch } };
		instantiation.stub(ITextFileService, textFile as unknown as ITextFileService);
		instantiation.stub(IMarkerService, {});
		instantiation.stub(IWorkspaceContextService, { onDidChangeWorkspaceFolders: Event.None, getWorkspace: () => ({ folders: [{ uri: URI.file('/fixture') }] }) } as unknown as IWorkspaceContextService);
		instantiation.stub(ICodeEditorService, { onCodeEditorAdd: Event.None });
		instantiation.stub(IPathService, { userHome: () => URI.file('/fixture') } as unknown as IPathService);
		instantiation.stub(IConfigurationService, { getValue: () => true, onDidChangeConfiguration: Event.None });
		instantiation.stub(ILogService, new NullLogService());
		instantiation.stub(IOpenideAgentService, { resolveEditorTarget: async windowId => available && windowId === auxiliary ? companion : undefined });
		const service = store.add(instantiation.createInstance(OpenideIdeServerService));
		if (registerCatalog) {
			service.bridgeAgentTools([{ name: 'fixture', description: '', parameters: { type: 'object', properties: {} } }], async (_name, _args, _token, windowId) => {
				routed.push(windowId); return { output: 'ok', isError: false };
			});
		}
		const endpoint = await service.mcpEndpointFor('agent-session', getOpenideCli('codex')!, undefined, '/fixture', auxiliary);
		function call(tool: string, args: unknown = {}, sessionId: string | undefined = 'agent-session') {
			const requestId = String(++counter), reply = new DeferredPromise<IIdeToolResult>();
			replies.set(requestId, reply);
			requests.fire({ requestId, connectionId: requestId, tool, args, sessionId });
			return reply.p;
		}
		return { endpoint, call, opens, routed, scratch, textFile, service, close: () => { available = false; } };
	}

	test('injected CLI file and native tools keep their launch presentation', async () => {
		const f = await fixture();
		assert.strictEqual(new URL(f.endpoint!.url).searchParams.get('openideSession'), 'agent-session');
		const opened = await f.call('openFile', { filePath: '/fixture/file.ts' });
		assert.ok(!opened.isError, JSON.stringify(opened));
		await f.call('fixture');
		assert.strictEqual(f.service.getSessionWindowId('agent-session'), auxiliary);
		f.service.setSessionWindowId('agent-session', auxiliary + 1);
		assert.strictEqual(f.service.getSessionWindowId('agent-session'), auxiliary + 1);
		f.service.setSessionWindowId('agent-session', auxiliary);
		assert.deepStrictEqual(f.opens, ['agent']);
		assert.deepStrictEqual(f.routed, [auxiliary]);
		const unknown = await f.call('openFile', { filePath: '/fixture/file.ts' }, 'unknown-session');
		assert.strictEqual(unknown.isError, true);
		f.close();
		const closed = await f.call('openFile', { filePath: '/fixture/file.ts' });
		assert.strictEqual(closed.isError, true);
		assert.deepStrictEqual(f.opens, ['agent'], 'missing presentation never falls back to IDE');
	});

	test('CLI file routing is available before the restored tool catalog is registered', async () => {
		const f = await fixture(false);
		const opened = await f.call('openFile', { filePath: '/fixture/file.ts' });
		assert.ok(!opened.isError, JSON.stringify(opened));
		assert.deepStrictEqual(f.opens, ['agent']);
	});

	test('closing the presentation while a diff buffer resolves does not open an IDE diff', async () => {
		const f = await fixture();
		const pending = new DeferredPromise<typeof f.scratch>();
		const started = new DeferredPromise<void>();
		f.textFile.untitled.resolve = () => { void started.complete(); return pending.p; };
		const result = f.call('openDiff', { old_file_path: '/fixture/a.ts', new_file_path: '/fixture/b.ts', new_file_contents: 'proposal' });
		await started.p;
		f.close();
		await pending.complete(f.scratch);
		assert.strictEqual((await result).isError, true);
		assert.deepStrictEqual(f.opens, []);
	});

	test('unscoped external IDE clients retain their normal file opening', async () => {
		const f = await fixture();
		await f.call('openFile', { filePath: '/fixture/file.ts' }, '');
		assert.deepStrictEqual(f.opens, ['ide']);
	});
});
