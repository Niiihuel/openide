/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { FileChangesEvent, FileChangeType, IWriteFileOptions } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IOpenideAgentHostService } from '../../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IOpenideGoalUpdate } from '../../../../../platform/openideAgentHost/common/openideGoal.js';
import { OpenideGoalStore } from '../../../../../platform/openideAgentHost/node/openideGoalStore.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService, IWorkspaceFoldersChangeEvent, Workspace, WorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { IResourceDiffEditorInput, isResourceDiffEditorInput } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IWorkingCopy } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IOpenideGoalSnapshotService } from '../../browser/openideGoalSnapshot.js';
import { IOpenideGoalDriver, OpenideGoalService } from '../../browser/openideGoalService.js';
import { IOpenideNativeServices } from '../../common/openideNativeServices.js';

suite('OpenIDE goal supervisor (real durable store)', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let root: string;
	let store: OpenideGoalStore;
	let service: OpenideGoalService;
	let files: FileService;
	let changes: Emitter<FileChangesEvent>;
	let workingCopyChange: Emitter<IWorkingCopy>;
	let dirtyCopies: IWorkingCopy[];
	let approveRevision: boolean;
	let openedDiff: IResourceDiffEditorInput | undefined;
	let limitInput: string | undefined;
	let workspaceChange: Emitter<IWorkspaceFoldersChangeEvent>;
	let replaceWorkspace: () => void;
	let afterCreate: (() => void) | undefined;
	let beforeUpdate: ((request: IOpenideGoalUpdate) => Promise<void>) | undefined;
	let afterWrite: ((resource: URI, text: string) => void) | undefined;
	const project = URI.file('/goal-test');
	const changed = (path = 'source.ts') => changes.fire(new FileChangesEvent([{ type: FileChangeType.UPDATED, resource: URI.joinPath(project, path) }], false));
	const latest = () => store.get('session');
	const create = (criteria = ['Regression suite passes :: npm test'], maxTurns = 1) => service.create('session', 'Resolve the reported regression', criteria, undefined, maxTurns);
	const driver = (check: IOpenideGoalDriver['check'] = async () => ({ exitCode: 0, output: 'passed' })): IOpenideGoalDriver => ({ run: async () => ({ report: 'Implemented and checked the repair' }), check });

	setup(async () => {
		root = await mkdtemp(join(tmpdir(), 'openide-goal-supervisor-'));
		store = new OpenideGoalStore(root);
		beforeUpdate = undefined; afterWrite = undefined; approveRevision = false; limitInput = undefined; afterCreate = undefined; openedDiff = undefined;
		changes = disposables.add(new Emitter<FileChangesEvent>());
		workingCopyChange = disposables.add(new Emitter<IWorkingCopy>()); dirtyCopies = [];
		files = disposables.add(new class extends FileService {
			override readonly onDidFilesChange = changes.event;
			override async writeFile(resource: URI, buffer: VSBuffer, options?: IWriteFileOptions) {
				const result = await super.writeFile(resource, buffer, options);
				afterWrite?.(resource, buffer.toString());
				return result;
			}
		}(new NullLogService()));
		disposables.add(files.registerProvider('file', disposables.add(new InMemoryFileSystemProvider())));
		let folder = new WorkspaceFolder({ uri: project, index: 0, name: 'goal-test' });
		let workspace = new Workspace('goal-test', [folder], false, null, () => false);
		workspaceChange = disposables.add(new Emitter<IWorkspaceFoldersChangeEvent>());
		replaceWorkspace = () => { const previous = folder; folder = new WorkspaceFolder({ uri: URI.file('/replacement'), index: 0, name: 'replacement' }); workspace = new Workspace('replacement', [folder], false, null, () => false); workspaceChange.fire({ added: [folder], removed: [previous], changed: [] }); };
		const host = upcastPartial<IOpenideAgentHostService>({
			validateWorkspacePath: async () => undefined,
			goalGet: sessionId => store.get(sessionId),
			goalCreate: async request => { const goal = await store.create(request); afterCreate?.(); return goal; },
			goalUpdate: async (sessionId, request) => { await beforeUpdate?.(request); return store.update(sessionId, request); },
			goalVerify: (sessionId, request) => store.verify(sessionId, request),
		});
		service = disposables.add(new OpenideGoalService(
			upcastPartial<IOpenideNativeServices>({ available: true, host }),
			upcastPartial<IWorkspaceContextService>({ getWorkspace: () => workspace, getWorkspaceFolder: resource => resource.path.startsWith(folder.uri.path + '/') ? folder : null, onDidChangeWorkspaceFolders: workspaceChange.event }),
			files, upcastPartial<IEditorService>({ openEditor: async input => { if (isResourceDiffEditorInput(input)) { openedDiff = input; } return undefined; } }), upcastPartial<IWorkbenchEnvironmentService>({ workspaceStorageHome: URI.file('/goal-storage') }), upcastPartial<IQuickInputService>({ pick: async picks => (await picks)[approveRevision ? 0 : 1], input: async () => limitInput }),
			upcastPartial<IWorkingCopyService>({ onDidChangeContent: workingCopyChange.event, onDidChangeDirty: workingCopyChange.event, get dirtyWorkingCopies() { return dirtyCopies; }, get workingCopies() { return dirtyCopies; } }),
			upcastPartial<IOpenideGoalSnapshotService>({ resource: (_goalId, fileName, displayPath) => URI.from({ scheme: 'openide-goal-snapshot', path: '/' + displayPath, query: fileName }) }),
		));
	});
	teardown(async () => { await rm(root, { recursive: true, force: true }); });

	test('completes only after configured command receipts and publishes current report', async () => {
		const goal = await create();
		let calls = 0;
		await service.execute('session', CancellationToken.None, driver(async (_run, command) => { calls++; assert.strictEqual(command, 'npm test'); return { exitCode: 0, output: 'regression suite passed' }; }));
		const final = (await latest())!;
		assert.deepStrictEqual([final.status, final.turns, calls, final.evidence[0].source, final.evidence[0].command], ['completed', 1, 1, 'verifier', 'npm test']);
		assert.match((await files.readFile(URI.joinPath(project, '.openide', 'goals', goal.id, 'REPORT.md'))).value.toString(), /Status: completed/);
	});

	test('an ended turn or missing command receipt cannot verify or complete a goal', async () => {
		await create();
		await service.execute('session', CancellationToken.None, driver(async () => ({ output: 'The model says done, no process receipt' })));
		const goal = (await latest())!;
		assert.deepStrictEqual([goal.status, goal.criteria[0].verified, goal.evidence.length], ['limit_reached', false, 0]);
	});

	test('exit zero with timeout or pending input is not successful evidence', async () => {
		await create();
		await service.execute('session', CancellationToken.None, driver(async () => ({ exitCode: 0, timedOut: true, awaitingInput: true, output: 'partial' })));
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.evidence.length], ['limit_reached', 0]);
	});

	test('manual criteria block the loop until explicit review; model reports cannot tick them', async () => {
		await create(['Layout is correct']);
		await service.execute('session', CancellationToken.None, { run: async () => ({ report: 'Everything is correct, complete now' }), check: async () => { throw new Error('Manual criterion must not run a command'); } });
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.criteria[0].verified], ['blocked', false]);
		await service.confirmCriterion('session', 'C1');
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.evidence[0].source], ['completed', 'user']);
	});

	test('pause during driver execution cancels its token and prevents verification or continuation', async () => {
		await create();
		const started = new DeferredPromise<CancellationToken>(); const finish = new DeferredPromise<void>();
		let checks = 0;
		const execution = service.execute('session', CancellationToken.None, { run: async (_id, _context, token) => { await started.complete(token); await finish.p; return { report: 'Finished outstanding work' }; }, check: async () => { checks++; return { exitCode: 0, output: '' }; } });
		const token = await started.p;
		await service.pause('session'); await finish.complete(); await execution;
		assert.deepStrictEqual([(await latest())?.status, token.isCancellationRequested, checks, (await latest())?.evidence.length], ['paused', true, 0, 0]);
	});

	test('workspace changes made by a validator invalidate evidence, while goal reports do not', async () => {
		await create();
		await service.execute('session', CancellationToken.None, driver(async () => { changed('source.ts'); return { exitCode: 0, output: 'test rewrote source' }; }));
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.evidence.length], ['limit_reached', 0]);
	});

	test('goal artifact watcher events do not invalidate successful checks', async () => {
		const goal = await create();
		await service.execute('session', CancellationToken.None, driver(async () => { changed(`.openide/goals/${goal.id}/REPORT.md`); return { exitCode: 0, output: 'passed' }; }));
		assert.strictEqual((await latest())?.status, 'completed');
	});

	test('repeated unsuccessful turns stop with a diagnosis before exhausting a large budget', async () => {
		await create(['Suite passes :: npm test'], 10);
		let runs = 0;
		await service.execute('session', CancellationToken.None, { run: async () => { runs++; return { report: 'Same unresolved failure' }; }, check: async () => ({ exitCode: 1, output: 'same error' }) });
		assert.deepStrictEqual([(await latest())?.status, runs, (await latest())?.evidence.length], ['blocked', 3, 0]);
		assert.match((await latest())!.reason, /without new progress/);
	});

	test('concurrent execute requests never create a second goal driver', async () => {
		await create();
		const started = new DeferredPromise<void>(); const finish = new DeferredPromise<void>();
		let runs = 0;
		const controlled: IOpenideGoalDriver = { run: async () => { runs++; await started.complete(); await finish.p; return { report: 'One executor' }; }, check: driver().check };
		const first = service.execute('session', CancellationToken.None, controlled);
		await started.p;
		await assert.rejects(service.execute('session', CancellationToken.None, controlled), /active executor/);
		await finish.complete(); await first;
		assert.deepStrictEqual([runs, (await latest())?.turns, (await latest())?.status], [1, 1, 'completed']);
	});

	test('driver failure becomes failed without synthesizing verification', async () => {
		await create();
		await assert.rejects(service.execute('session', CancellationToken.None, { run: async () => { throw new Error('Transport disconnected'); }, check: driver().check }), /Transport disconnected/);
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.evidence.length], ['failed', 0]);
	});

	test('a stale CAS does not overwrite a concurrent pause or run another driver turn', async () => {
		await create();
		let runs = 0;
		beforeUpdate = async request => {
			if (request.action !== 'startTurn') { return; }
			beforeUpdate = undefined;
			const current = (await latest())!;
			await store.update('session', { goalId: current.id, expectedVersion: current.version, action: 'pause' });
		};
		await assert.rejects(service.execute('session', CancellationToken.None, { run: async () => { runs++; return { report: 'unexpected' }; }, check: driver().check }), /changed/);
		assert.deepStrictEqual([(await latest())?.status, runs], ['paused', 0]);
	});

	test('changing GOAL.md during a turn blocks verification of the unreviewed contract', async () => {
		const goal = await create();
		let checks = 0;
		await service.execute('session', CancellationToken.None, {
			run: async () => { await files.writeFile(URI.joinPath(project, '.openide', 'goals', goal.id, 'GOAL.md'), VSBuffer.fromString('A different contract')); return { report: 'Changed the criteria' }; },
			check: async () => { checks++; return { exitCode: 0, output: 'passed' }; },
		});
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.evidence.length, checks], ['blocked', 0, 0]);
	});

	test('pausing during a configured check discards its later success receipt', async () => {
		await create();
		const started = new DeferredPromise<CancellationToken>(); const finish = new DeferredPromise<void>();
		const execution = service.execute('session', CancellationToken.None, driver(async (_id, _command, token) => { await started.complete(token); await finish.p; return { exitCode: 0, output: 'late success' }; }));
		const token = await started.p;
		await service.pause('session'); await finish.complete(); await execution;
		assert.deepStrictEqual([(await latest())?.status, token.isCancellationRequested, (await latest())?.evidence.length], ['paused', true, 0]);
	});

	test('a workspace change during the manual review report also prevents completion', async () => {
		await create(['Layout is correct']);
		await service.execute('session', CancellationToken.None, driver());
		afterWrite = (_resource, content) => {
			if (!content.includes('Goal review completed.')) { return; }
			afterWrite = undefined; changed('view.ts');
		};
		await service.confirmCriterion('session', 'C1');
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.criteria[0].verified], ['blocked', false]);
	});

	test('workspace changes arriving during the final report prevent completion with stale evidence', async () => {
		await create();
		afterWrite = (_resource, content) => {
			if (!content.includes('All acceptance criteria have current evidence')) { return; }
			afterWrite = undefined; changed('source.ts');
		};
		await service.execute('session', CancellationToken.None, driver());
		assert.notStrictEqual((await latest())?.status, 'completed');
		assert.strictEqual((await latest())?.criteria[0].verified, false);
	});
	test('turn-limited goals resume only after an explicit larger user budget', async () => {
		await create();
		await service.execute('session', CancellationToken.None, driver(async () => ({ exitCode: 1, output: 'failed' })));
		assert.strictEqual((await latest())?.status, 'limit_reached');
		limitInput = '2'; await service.resume('session');
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.maxTurns, (await latest())?.turns], ['active', 2, 1]);
	});

	test('accepting edited Markdown creates a new contract revision before resuming', async () => {
		const goal = await create(); await service.pause('session');
		const path = URI.joinPath(project, '.openide', 'goals', goal.id, 'GOAL.md');
		const original = (await files.readFile(path)).value.toString();
		await files.writeFile(path, VSBuffer.fromString(original.replace('Resolve the reported regression', 'Repair the integration contract').replace('Command: npm test', 'Command: npm test -- --integration')));
		approveRevision = true; await service.resume('session');
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.revision, (await latest())?.criteria[0].command], ['active', 2, 'npm test -- --integration']);
		assert.match((await files.readFile(path)).value.toString(), /revision: 2/);
	});

	test('declining an edited contract keeps the accepted revision paused', async () => {
		const goal = await create(); await service.pause('session');
		const path = URI.joinPath(project, '.openide', 'goals', goal.id, 'GOAL.md');
		await files.writeFile(path, VSBuffer.fromString((await files.readFile(path)).value.toString().replace('Resolve the reported regression', 'Another objective')));
		approveRevision = false; await service.resume('session');
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.revision, (await latest())?.objective], ['paused', 1, 'Resolve the reported regression']);
	});

	test('preexisting unsaved source buffers cannot be certified by a passing disk command', async () => {
		await create();
		dirtyCopies = [upcastPartial<IWorkingCopy>({ resource: URI.joinPath(project, 'source.ts'), isDirty: () => true })];
		await service.execute('session', CancellationToken.None, driver());
		assert.notStrictEqual((await latest())?.status, 'completed');
		assert.strictEqual((await latest())?.evidence.length, 0);
	});

	test('an unsaved buffer edit during verification invalidates the disk command receipt', async () => {
		await create();
		await service.execute('session', CancellationToken.None, driver(async () => {
			const copy = upcastPartial<IWorkingCopy>({ resource: URI.joinPath(project, 'source.ts'), isDirty: () => true });
			dirtyCopies = [copy]; workingCopyChange.fire(copy);
			return { exitCode: 0, output: 'disk files passed but editor differs' };
		}));
		assert.notStrictEqual((await latest())?.status, 'completed');
		assert.strictEqual((await latest())?.evidence.length, 0);
	});

	test('an unsaved GOAL contract blocks verification of the older disk contract', async () => {
		const goal = await create();
		dirtyCopies = [upcastPartial<IWorkingCopy>({ resource: URI.joinPath(project, '.openide', 'goals', goal.id, 'GOAL.md'), isDirty: () => true })];
		await service.execute('session', CancellationToken.None, driver());
		assert.notStrictEqual((await latest())?.status, 'completed');
		assert.strictEqual((await latest())?.evidence.length, 0);
	});

	test('live owned background work prevents completion until the user stops it and resumes', async () => {
		await create(['Suite passes :: npm test'], 2);
		let pending = true;
		const controlled = { ...driver(), pendingWork: () => pending ? 'A background test worker is still running.' : undefined };
		await service.execute('session', CancellationToken.None, controlled);
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.reason], ['blocked', 'A background test worker is still running.']);
		pending = false; await service.resume('session');
		await service.execute('session', CancellationToken.None, controlled);
		assert.strictEqual((await latest())?.status, 'completed');
	});

	test('manual review cannot bypass background work that is still live', async () => {
		await create(['Layout is correct']);
		let pending = true;
		await service.execute('session', CancellationToken.None, { ...driver(), pendingWork: () => pending ? 'Background work must finish first.' : undefined });
		await assert.rejects(service.confirmCriterion('session', 'C1'), /Background work/);
		pending = false; await service.confirmCriterion('session', 'C1');
		assert.strictEqual((await latest())?.status, 'completed');
	});

	test('background work appearing during the final report is checked again before committing completion', async () => {
		await create(); let pending = false;
		afterWrite = (_resource, content) => { if (content.includes('All acceptance criteria have current evidence')) { pending = true; } };
		await service.execute('session', CancellationToken.None, { ...driver(), pendingWork: () => pending ? 'A late background process is still running.' : undefined });
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.reason], ['blocked', 'A late background process is still running.']);
	});

	test('an unsaved buffer change during the final report blocks completion too', async () => {
		await create();
		afterWrite = (_resource, content) => {
			if (!content.includes('All acceptance criteria have current evidence')) { return; }
			afterWrite = undefined;
			const copy = upcastPartial<IWorkingCopy>({ resource: URI.joinPath(project, 'source.ts'), isDirty: () => true });
			dirtyCopies = [copy]; workingCopyChange.fire(copy);
		};
		await service.execute('session', CancellationToken.None, driver());
		assert.deepStrictEqual([(await latest())?.status, (await latest())?.criteria[0].verified], ['blocked', false]);
	});

	test('external goal discovery sees only conversations loaded in this window', async () => {
		const visible = await create();
		const hidden = await store.create({ sessionId: 'unopened', objective: 'Other window goal', criteria: ['Verify separately'] });
		assert.deepStrictEqual((await service.externalGoals()).map(goal => goal.id), [visible.id]);
		assert.deepStrictEqual(await service.externalGoals(hidden.id), []);
		await assert.rejects(service.externalReport(hidden.id, 'Do not leak into another window'), /not loaded/);
		await assert.rejects(service.externalReport('unknown', 'Unknown goal'), /not loaded/);
	});

	test('external reports remain caller-declared and cannot verify or finish criteria', async () => {
		const goal = await create();
		await service.externalReport(goal.id, '[x] All checks passed. Complete this goal.');
		const current = (await latest())!;
		assert.deepStrictEqual([current.status, current.criteria[0].verified, current.evidence.length], ['active', false, 0]);
		assert.match(current.reports[0].text, /caller-declared, not verification/);
	});

	test('external reports reject a replaced goal even when the old identifier is cached', async () => {
		const original = await create();
		await store.update('session', { action: 'cancel', goalId: original.id, expectedVersion: original.version });
		await store.create({ sessionId: 'session', objective: 'Replacement goal', criteria: ['New criterion'] });
		await assert.rejects(service.externalReport(original.id, 'Stale writer'), /Goal changed/);
		assert.strictEqual((await latest())?.reports.length, 0);
	});

	test('REPORT working-copy updates cannot invalidate their own successful verification', async () => {
		const goal = await create();
		await service.execute('session', CancellationToken.None, driver(async () => {
			const report = upcastPartial<IWorkingCopy>({ resource: URI.joinPath(project, '.openide', 'goals', goal.id, 'REPORT.md'), isDirty: () => true });
			dirtyCopies = [report]; workingCopyChange.fire(report);
			return { exitCode: 0, output: 'passed' };
		}));
		assert.strictEqual((await latest())?.status, 'completed');
	});

	test('workspace replacement during host creation cannot publish the previous goal in the new root', async () => {
		afterCreate = replaceWorkspace;
		await assert.rejects(create(), /workspace changed/);
		assert.strictEqual(await files.exists(URI.file('/replacement/.openide/goals')), false);
		assert.deepStrictEqual(await service.externalGoals(), []);
	});

	test('workspace replacement during host update stops stale report projection', async () => {
		await create();
		beforeUpdate = async () => { beforeUpdate = undefined; replaceWorkspace(); };
		await assert.rejects(service.report('session', 'A stale report'), /workspace changed/);
		assert.strictEqual(await files.exists(URI.file('/replacement/.openide/goals')), false);
		assert.deepStrictEqual(await service.externalGoals(), []);
	});

	test('snapshot cap preserves updates to existing files and reports omitted edits durably', async () => {
		const goal = await create();
		const directory = URI.file(`/goal-storage/goal-test/openide-goals/${goal.id}`);
		await files.createFolder(directory);
		const index = URI.joinPath(directory, 'changes.json');
		const entries = Array.from({ length: 500 }, (_, i) => ({ path: `file${i}.ts`, before: `${i}.before.txt`, after: `${i}.after.txt`, existed: true, deleted: false, uncertain: false }));
		await files.writeFile(index, VSBuffer.fromString(JSON.stringify(entries)));
		await files.writeFile(URI.joinPath(directory, '0.before.txt'), VSBuffer.fromString('baseline'));
		await files.writeFile(URI.joinPath(directory, '0.after.txt'), VSBuffer.fromString('before'));
		await service.execute('session', CancellationToken.None, {
			run: async runId => {
				await service.recordChange('session', { runId, path: 'file0.ts', operation: 'modify', beforeContent: 'before', afterContent: 'updated' });
				await service.recordChange('session', { runId, path: 'extra.ts', operation: 'create', afterContent: 'omitted' });
				await service.recordChange('session', { runId, path: 'file0.ts', operation: 'modify', beforeContent: 'updated', afterContent: 'latest' });
				return { report: 'Captured updates', stop: true };
			}, check: driver().check,
		});
		assert.strictEqual((await files.readFile(URI.joinPath(directory, '0.after.txt'))).value.toString(), 'latest');
		assert.strictEqual(JSON.parse((await files.readFile(index)).value.toString()).length, 500);
		assert.deepStrictEqual(JSON.parse((await files.readFile(URI.joinPath(directory, 'capture-limits.json'))).value.toString()), { omittedEdits: 1, files: [{ path: 'extra.ts', reason: 'Goal reached the 500-file snapshot limit' }], truncated: false });
		assert.match((await latest())!.reports.map(report => report.text).join('\n'), /capture is incomplete/);
	});

	test('an oversized later edit marks an existing snapshot uncertain instead of presenting stale content as current', async () => {
		const goal = await create();
		await service.execute('session', CancellationToken.None, {
			run: async runId => {
				await service.recordChange('session', { runId, path: 'large.ts', operation: 'modify', beforeContent: 'before', afterContent: 'small' });
				await service.recordChange('session', { runId, path: 'large.ts', operation: 'modify', beforeContent: 'small', afterContent: 'x'.repeat(2 * 1024 * 1024 + 1) });
				return { report: 'Large edit', stop: true };
			}, check: driver().check,
		});
		const directory = URI.file(`/goal-storage/goal-test/openide-goals/${goal.id}`);
		const entries: { uncertain: boolean }[] = JSON.parse((await files.readFile(URI.joinPath(directory, 'changes.json'))).value.toString());
		assert.strictEqual(entries[0].uncertain, true);
		assert.strictEqual(JSON.parse((await files.readFile(URI.joinPath(directory, 'capture-limits.json'))).value.toString()).omittedEdits, 1);
	});

	test('Goal Changes opens two virtual readonly snapshots rather than editable private files', async () => {
		const goal = await create();
		const directory = URI.file(`/goal-storage/goal-test/openide-goals/${goal.id}`);
		await files.createFolder(directory);
		await files.writeFile(URI.joinPath(directory, 'changes.json'), VSBuffer.fromString(JSON.stringify([{ path: 'src/file.ts', before: 'file.before.txt', after: 'file.after.txt', uncertain: false }])));
		await files.writeFile(URI.joinPath(directory, 'file.before.txt'), VSBuffer.fromString('before'));
		await files.writeFile(URI.joinPath(directory, 'file.after.txt'), VSBuffer.fromString('after'));
		approveRevision = true;
		await service.openChanges('session');
		assert.deepStrictEqual([openedDiff?.original.resource?.scheme, openedDiff?.modified.resource?.scheme], ['openide-goal-snapshot', 'openide-goal-snapshot']);
		assert.strictEqual((await files.readFile(URI.joinPath(directory, 'file.after.txt'))).value.toString(), 'after');
	});

});
