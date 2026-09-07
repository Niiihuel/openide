/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenideAgentHostService } from '../../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IMarker, IMarkerService, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { OpenideToolRegistry } from '../../browser/openideTools.js';
import { IOpenideToolExecution } from '../../common/openideToolExecutor.js';

suite('OpenIDE tool bodies respect the assigned workspace', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	async function fixture() {
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider('file', store.add(new InMemoryFileSystemProvider())));
		const main = URI.file('/main');
		const lease = URI.file('/lease');
		await files.writeFile(URI.joinPath(main, 'a.txt'), VSBuffer.fromString('main original'));
		await files.writeFile(URI.joinPath(lease, 'a.txt'), VSBuffer.fromString('lease original'));
		const queries: URI[][] = [];
		const queryBuilder = {
			file: (folders: URI[]) => { queries.push(folders); return {}; },
			text: (_pattern: unknown, folders: URI[]) => { queries.push(folders); return {}; },
		};
		const searchResults = [main, lease].map(root => ({ resource: URI.joinPath(root, 'a.txt') }));
		const markers = [main, lease].map(root => upcastPartial<IMarker>({ resource: URI.joinPath(root, 'a.txt'), severity: MarkerSeverity.Error, message: root === main ? 'MAIN DIAGNOSTIC' : 'LEASE DIAGNOSTIC', startLineNumber: 1, startColumn: 1 }));
		const textFiles = upcastPartial<ITextFileService>({
			isDirty: () => false,
			getEncodedReadable: (async (_resource: URI, value: string) => VSBuffer.fromString(value)) as ITextFileService['getEncodedReadable'],
			files: upcastPartial<ITextFileService['files']>({ get: () => undefined }),
		});
		const registry = store.add(new OpenideToolRegistry(files,
			upcastPartial<IWorkspaceContextService>({ getWorkspace: () => ({ folders: [{ uri: main }] }) as ReturnType<IWorkspaceContextService['getWorkspace']> }),
			upcastPartial<ISearchService>({ fileSearch: async () => ({ results: searchResults, messages: [] }), textSearch: async () => ({ results: searchResults, messages: [] }) }),
			{ createInstance: () => queryBuilder } as unknown as IInstantiationService,
			upcastPartial<ITerminalService>({}), upcastPartial<IMarkerService>({ read: () => markers }),
			upcastPartial<ITextModelService>({ createModelReference: async () => { throw new Error('No language server in this fixture'); } }),
			upcastPartial<IModelService>({ getModel: () => null }), textFiles,
			upcastPartial<IOpenideAgentHostService>({ validateWorkspacePath: async request => { assert.deepStrictEqual(request.roots, [lease.fsPath]); } }),
			new TestConfigurationService(),
		));
		// These tests exercise real tool bodies, independently of the executor's separate policy tests.
		const call = (name: string, args: object) => registry.getTool(name)!.invoke(args, CancellationToken.None, { workspaceRoot: lease, conversationId: 'child' });
		return { files, main, lease, queries, call, registry };
	}

	test('read/edit/write/rename/delete target the lease while the main workspace remains intact', async () => {
		const { files, main, lease, call } = await fixture();
		assert.match(await call('read_file', { path: 'a.txt' }), /source: disk.*\nlease original/s);
		await call('edit_file', { path: 'a.txt', old_string: 'original', new_string: 'edited' });
		assert.strictEqual((await files.readFile(URI.joinPath(lease, 'a.txt'))).value.toString(), 'lease edited');
		await call('write_file', { path: 'a.txt', content: 'lease replacement' });
		await call('rename_file', { from: 'a.txt', to: 'b.txt' });
		assert.strictEqual((await files.readFile(URI.joinPath(lease, 'b.txt'))).value.toString(), 'lease replacement');
		await call('delete_file', { path: 'b.txt' });
		assert.strictEqual(await files.exists(URI.joinPath(lease, 'b.txt')), false);
		assert.strictEqual((await files.readFile(URI.joinPath(main, 'a.txt'))).value.toString(), 'main original');
	});

	test('rejects absolute and relative escapes and scopes queries, returned matches and diagnostics', async () => {
		const { lease, queries, call } = await fixture();
		assert.match(await call('read_file', { path: '/main/a.txt' }), /^Error:/);
		assert.match(await call('write_file', { path: '../main/a.txt', content: 'bad' }), /^Error:/);
		assert.match(await call('rename_file', { from: 'a.txt', to: '/main/stolen.txt' }), /^Error:/);
		assert.strictEqual(await call('find_files', { pattern: '*.txt' }), 'a.txt');
		assert.strictEqual(await call('search_text', { query: 'original' }), 'a.txt');
		assert.deepStrictEqual(queries, [[lease], [lease]]);
		const diagnostics = await call('get_diagnostics', {});
		assert.match(diagnostics, /LEASE DIAGNOSTIC/);
		assert.doesNotMatch(diagnostics, /MAIN DIAGNOSTIC/);
	});

	test('registry dispatch validates arguments and nested permissions before effects and binds observations to the run', async () => {
		const { files, lease, registry } = await fixture();
		let approvals = 0;
		const execution: IOpenideToolExecution = { runId: 'run-a', origin: 'native', authorize: async () => { approvals++; return true; } };
		const invoke = (name: string, args: object, run = execution) => registry.invoke(name, JSON.stringify(args), CancellationToken.None, { workspaceRoot: lease, conversationId: 'same-conversation', execution: run });
		assert.match(await invoke('write_file', { path: 'a.txt' }), /invalid arguments/);
		assert.strictEqual(approvals, 0);
		assert.match(await invoke('write_file', { path: 'a.txt', content: 'blind replacement' }), /Read this file/);
		await invoke('read_file', { path: 'a.txt' });
		assert.match(await invoke('write_file', { path: 'a.txt', content: 'foreign replacement' }, { ...execution, runId: 'run-b' }), /Read this file/);
		registry.registerTool({
			def: { name: 'nested_write_fixture', description: 'A nested invocation', parameters: { type: 'object', properties: {} } }, risk: 'safe',
			invoke: (_args, token, context) => registry.invoke('write_file', JSON.stringify({ path: 'a.txt', content: 'nested replacement' }), token, context),
		});
		assert.match(await invoke('nested_write_fixture', {}, { ...execution, allowedRisks: new Set(['safe']) }), /outside the execution permissions/);
		assert.strictEqual((await files.readFile(URI.joinPath(lease, 'a.txt'))).value.toString(), 'lease original');
		assert.match(await invoke('write_file', { path: 'a.txt', content: 'observed replacement' }), /^OK:/);
		assert.strictEqual((await files.readFile(URI.joinPath(lease, 'a.txt'))).value.toString(), 'observed replacement');
	});
});
