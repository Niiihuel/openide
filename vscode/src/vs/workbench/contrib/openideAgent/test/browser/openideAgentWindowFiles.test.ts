/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { IExpression } from '../../../../../base/common/glob.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileChangesEvent, FileChangeType, IFileService, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService, Workspace, WorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { OpenideWorkspaceFilesDataSource } from '../../browser/openideAgentWindowFiles.js';

suite('OpenIDE agent workspace files', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(excludes: IExpression = {}) {
		const root = URI.file('/project');
		const folder = new WorkspaceFolder({ uri: root, name: 'Project', index: 0 });
		const workspace = new Workspace('files', [folder], false, null, () => false);
		const reads: string[] = [];
		const watches = new Map<string, Emitter<FileChangesEvent>>();
		const children: IFileStatWithMetadata[] = [];
		const files = upcastPartial<IFileService>({
			resolve: async resource => {
				reads.push(resource.path);
				return upcastPartial<IFileStatWithMetadata>({ resource, name: 'Project', isDirectory: true, children });
			},
			createWatcher: resource => {
				const key = resource.toString();
				const disposables = new DisposableStore();
				const event = disposables.add(new Emitter<FileChangesEvent>());
				watches.set(key, event);
				disposables.add(toDisposable(() => watches.delete(key)));
				return { onDidChange: event.event, dispose: () => disposables.dispose() };
			},
		});
		const configuration = new TestConfigurationService({ 'files.exclude': excludes });
		store.add(configuration.onDidChangeConfigurationEmitter);
		const model = store.add(new OpenideWorkspaceFilesDataSource(files, upcastPartial<IWorkspaceContextService>({ getWorkspaceFolder: () => folder }), configuration));
		const add = (name: string, directory = false) => children.push(upcastPartial<IFileStatWithMetadata>({ resource: joinPath(root, name), name, isDirectory: directory }));
		return { root, workspace, model, add, reads, watches };
	}

	test('roots are lazy, directories sort first, and files remain leaves', async () => {
		const f = fixture();
		f.add('z.ts'); f.add('src', true); f.add('a.ts');
		const roots = await f.model.getChildren(f.workspace);
		assert.deepStrictEqual({ names: roots.map(root => root.name), reads: f.reads, watches: f.watches.size }, { names: ['Project'], reads: [], watches: 0 });
		const children = await f.model.getChildren(roots[0]);
		assert.deepStrictEqual(children.map(child => [child.name, f.model.hasChildren(child)]), [['src', true], ['a.ts', false], ['z.ts', false]]);
		assert.deepStrictEqual(await f.model.getChildren(children[1]), []);
		assert.deepStrictEqual(f.reads, ['/project']);
	});

	test('workspace exclusions include sibling rules without hiding unrelated files', async () => {
		const f = fixture({ '**/.git': true, '**/*.js': { when: '$(basename).ts' } });
		f.add('.git', true); f.add('main.js'); f.add('main.ts'); f.add('other.js');
		const roots = await f.model.getChildren(f.workspace);
		assert.deepStrictEqual((await f.model.getChildren(roots[0])).map(child => child.name), ['main.ts', 'other.js']);
	});

	test('refresh reads current contents and correlated watchers are reused and disposed', async () => {
		const f = fixture();
		const roots = await f.model.getChildren(f.workspace);
		let changes = 0;
		store.add(f.model.onDidChange(() => changes++));
		await f.model.getChildren(roots[0]);
		f.add('added.ts');
		f.watches.get(f.root.toString())!.fire(new FileChangesEvent([{ resource: joinPath(f.root, 'added.ts'), type: FileChangeType.ADDED }], false));
		const children = await f.model.getChildren(roots[0]);
		assert.deepStrictEqual({ names: children.map(child => child.name), changes, watches: f.watches.size }, { names: ['added.ts'], changes: 1, watches: 1 });
		f.model.reset();
		assert.strictEqual(f.watches.size, 0);
		await f.model.getChildren(roots[0]);
		f.model.dispose();
		assert.strictEqual(f.watches.size, 0);
	});
});
