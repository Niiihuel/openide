/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { FileChangesEvent, FileChangeType, IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ICodebaseMemoryChange } from '../../../../../platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { ICodebaseMemoryService } from '../../browser/openideCodebaseMemoryService.js';
import { OpenideCodebaseMemoryWatcher } from '../../browser/openideCodebaseMemoryWatcher.js';

suite('OpenIDE Goal graph watcher', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	test('goal document saves and deletions reach incremental indexing without a full rebuild', async () => {
		const instantiation = store.add(new TestInstantiationService());
		const changed = store.add(new Emitter<FileChangesEvent>());
		const indexed = new DeferredPromise<ICodebaseMemoryChange[]>();
		instantiation.stub(IFileService, {
			onDidFilesChange: changed.event, watch: () => Disposable.None,
		});
		instantiation.stub(IFileService, 'stat', async () => ({ size: 4, isDirectory: false }));
		instantiation.stub(IFileService, 'readFile', async () => ({ value: VSBuffer.fromString('Goal') }));
		instantiation.stub(IWorkspaceContextService, { onDidChangeWorkspaceFolders: Event.None });
		instantiation.stub(IWorkspaceContextService, 'getWorkspace', () => ({ folders: [{ uri: URI.file('/repo') }] }));
		instantiation.stub(IConfigurationService, { onDidChangeConfiguration: Event.None });
		instantiation.stub(IConfigurationService, 'getValue', () => true);
		instantiation.stub(IWorkspaceTrustManagementService, { onDidChangeTrust: Event.None, isWorkspaceTrusted: () => true });
		instantiation.stub(ICodebaseMemoryService, { indexIncremental: async (changes: ICodebaseMemoryChange[]) => {
			await indexed.complete(changes);
			return { phase: 'idle', processed: changes.length, total: changes.length };
		} });
		store.add(instantiation.createInstance(OpenideCodebaseMemoryWatcher));
		changed.fire(new FileChangesEvent([
			{ resource: URI.file('/repo/.openide/goals/id/GOAL.md'), type: FileChangeType.ADDED },
			{ resource: URI.file('/repo/.openide/goals/id/REPORT.md'), type: FileChangeType.DELETED },
			{ resource: URI.file('/outside/.openide/goals/id/GOAL.md'), type: FileChangeType.ADDED },
		], false));
		const changes = await indexed.p;
		assert.deepStrictEqual(changes.sort((a, b) => a.uri.localeCompare(b.uri)), [
			{ uri: URI.file('/repo/.openide/goals/id/GOAL.md').toString(), content: 'Goal' },
			{ uri: URI.file('/repo/.openide/goals/id/REPORT.md').toString(), deleted: true },
		]);
	});
});
