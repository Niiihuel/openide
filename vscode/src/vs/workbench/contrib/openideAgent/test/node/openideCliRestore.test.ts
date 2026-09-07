/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IWriteFileOptions, IFileOverwriteOptions } from '../../../../../platform/files/common/files.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { DiskFileSystemProvider } from '../../../../../platform/files/node/diskFileSystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IOpenideAgentHostService } from '../../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IWorkspaceContextService, Workspace, WorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { OpenideCliChangesService } from '../../browser/openideCliChangesService.js';
import { IOpenideNativeServices } from '../../common/openideNativeServices.js';
import { OpenideAgentRunStateService } from '../../common/openideAgentRunState.js';

suite('OpenIDE CLI snapshot restore (real Git and filesystem)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let cwd: string;
	let service: OpenideCliChangesService;
	let runState: OpenideAgentRunStateService;
	let dirty: boolean;
	let blockedLease: boolean;
	let beforeWrite: (() => Promise<void>) | undefined;
	let beforeRename: (() => Promise<void>) | undefined;
	let session: { id: string; cliId: 'claude'; cwd: string; title: string };
	const exec = promisify(execFile);
	const git = async (...args: string[]) => (await exec('git', args, { cwd })).stdout;
	const write = (path: string, content: string) => writeFile(join(cwd, path), content);
	const read = (path: string) => readFile(join(cwd, path), 'utf8');

	setup(async () => {
		cwd = await mkdtemp(join(tmpdir(), 'openide-cli-restore-'));
		dirty = false;
		blockedLease = false;
		beforeWrite = beforeRename = undefined;
		await git('init', '-q');
		// Pin fixture bytes instead of inheriting the runner's Git line-ending policy.
		await git('config', 'core.autocrlf', 'false');
		await git('config', 'core.eol', 'native');
		await git('config', 'user.name', 'Restore Fixture');
		await git('config', 'user.email', 'restore@example.invalid');
		await write('file.txt', 'committed\n');
		await git('add', '.');
		await git('commit', '-qm', 'baseline');
		const log = new NullLogService();
		const files = store.add(new class extends FileService {
			override async writeFile(resource: URI, buffer: VSBuffer, options?: IWriteFileOptions) {
				const inject = beforeWrite; beforeWrite = undefined;
				await inject?.();
				return super.writeFile(resource, buffer, options);
			}
		}(log));
		const provider = store.add(new class extends DiskFileSystemProvider {
			override async rename(from: URI, to: URI, options: IFileOverwriteOptions) {
				const inject = beforeRename; beforeRename = undefined;
				await inject?.();
				return super.rename(from, to, options);
			}
		}(log));
		store.add(files.registerProvider('file', provider));
		const host = new class extends mock<IOpenideAgentHostService>() {
			override async runGit(root: string, args: readonly string[]) {
				try { return { ok: true, stdout: (await exec('git', [...args], { cwd: root })).stdout }; }
				catch { return { ok: false, stdout: '' }; }
			}
			override async acquireRestoreLocks(): Promise<string | undefined> { return blockedLease ? undefined : 'fixture-lease'; }
			override async releaseRestoreLocks(): Promise<void> { }
		};
		const native = new class extends mock<IOpenideNativeServices>() { override readonly host = host; };
		const models = new class extends mock<ITextModelService>() { override registerTextModelContentProvider() { return Disposable.None; } };
		const workingCopies = new class extends mock<IWorkingCopyService>() { override isDirty() { return dirty; } };
		const context = new class extends mock<IWorkspaceContextService>() {
			override getWorkspace() { return new Workspace('fixture', [new WorkspaceFolder({ uri: URI.file(cwd), name: 'fixture', index: 0 })], false, null, () => false); }
		};
		runState = new OpenideAgentRunStateService();
		service = store.add(new OpenideCliChangesService(native, log, new class extends mock<IEditorService>() { }, new class extends mock<IModelService>() { }, new class extends mock<ILanguageService>() { }, models, files, workingCopies, context, runState));
		session = { id: 'fixture', cliId: 'claude', cwd, title: 'Fixture' };
	});

	teardown(async () => { await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

	async function begin(hooked = true, prepare = true) {
		if (prepare) { await service.prepareSession(session); }
		const changed = Event.toPromise(service.onDidChange);
		service.noteStatus(session, 'in-progress', hooked);
		await changed;
	}

	async function finish(path = 'file.txt', kind: 'updated' | 'added' | 'deleted' = 'updated', hooked = true, exited = true) {
		service.noteFileChange(path, kind);
		const finished = Event.toPromise(service.onDidFinishTurn);
		service.noteStatus(session, 'needs-input', hooked);
		await finished;
		if (exited) { service.noteExited(session.id); }
	}

	test('preserves tracked dirty work from before execution and restores an explicitly selected snapshot', async () => {
		await write('file.txt', 'user work before CLI\n');
		await begin();
		await write('file.txt', 'CLI work\n');
		await finish();
		assert.strictEqual((await service.rollback(session.id, 'file.txt')).status, 'conflict');
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'restored');
		assert.strictEqual(await read('file.txt'), 'user work before CLI\n');
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'unavailable');
	});

	test('refuses later edits and unsaved editor buffers', async () => {
		await begin(); await write('file.txt', 'CLI\n'); await finish();
		dirty = true;
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'conflict');
		dirty = false;
		await write('file.txt', 'later user work\n');
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'conflict');
		assert.strictEqual(await read('file.txt'), 'later user work\n');
	});

	test('does not restore Git-normalized bytes when the original working-tree bytes are unknown', async () => {
		await git('config', 'core.autocrlf', 'true');
		await begin(); await write('file.txt', 'CLI\n'); await finish();
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'unavailable');
		assert.strictEqual(await read('file.txt'), 'CLI\n');
	});

	test('captures existing untracked content instead of treating it as a creation', async () => {
		await write('untracked.txt', 'user draft');
		await begin(); await write('untracked.txt', 'CLI edit'); await finish('untracked.txt');
		assert.strictEqual((await service.rollback(session.id, 'untracked.txt', true)).status, 'restored');
		assert.strictEqual(await read('untracked.txt'), 'user draft');
	});

	test('restores a deletion and safely removes an unchanged creation', async () => {
		await begin(); await unlink(join(cwd, 'file.txt')); await finish('file.txt', 'deleted');
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'restored');
		await begin(); await write('new.txt', 'created'); await finish('new.txt', 'added');
		assert.strictEqual((await service.rollback(session.id, 'new.txt', true)).status, 'restored');
		await assert.rejects(read('new.txt'), { code: 'ENOENT' });
	});

	test('pins the initial Git commit even if HEAD changes during the turn', async () => {
		await begin(); await write('file.txt', 'new commit'); await git('commit', '-qam', 'during turn');
		await write('file.txt', 'final CLI edit'); await finish();
		assert.strictEqual(service.baselineOf(session.id, 'file.txt')?.content, 'committed\n');
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'restored');
		assert.strictEqual(await read('file.txt'), 'committed\n');
	});

	test('a failed exited CLI can restore its exact selected partial snapshot', async () => {
		await begin(); await write('file.txt', 'partial CLI edit'); service.noteFileChange('file.txt', 'updated');
		const finished = Event.toPromise(service.onDidFinishTurn);
		service.noteStatus(session, 'failed', true); service.noteExited(session.id); await finished;
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'restored');
		assert.strictEqual(await read('file.txt'), 'committed\n');
	});

	test('existing ignored files are never inferred to be newly created', async () => {
		await write('.gitignore', 'ignored.txt\n'); await write('ignored.txt', 'existing ignored work');
		await begin(); await write('ignored.txt', 'later ignored work'); await finish('ignored.txt');
		assert.strictEqual((await service.rollback(session.id, 'ignored.txt', true)).status, 'unavailable');
		assert.strictEqual(await read('ignored.txt'), 'later ignored work');
	});

	test('Git conversions make a lazy commit baseline review-only', async () => {
		await write('.gitattributes', '*.txt text eol=crlf\n');
		await git('add', '.gitattributes'); await git('commit', '-qm', 'attributes');
		await begin(); await write('file.txt', 'CLI'); await finish();
		assert.strictEqual(service.baselineOf(session.id, 'file.txt')?.exact, false);
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'unavailable');
		assert.strictEqual(await read('file.txt'), 'CLI');
	});

	test('late adoption has no exact before snapshot', async () => {
		await begin(true, false); await write('file.txt', 'already edited'); await finish();
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'unavailable');
		assert.strictEqual(await read('file.txt'), 'already edited');
	});

	test('heuristic silence cannot authorize restoration until the actual process exits', async () => {
		await begin(false); await write('file.txt', 'CLI'); await finish('file.txt', 'updated', false, false);
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'conflict');
		service.noteExited(session.id);
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'restored');
	});

	test('another active session and a denied cross-window lease prevent writes', async () => {
		await begin(); await write('file.txt', 'CLI'); await finish();
		service.noteStatus({ ...session, id: 'other' }, 'in-progress', false);
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'conflict');
		service.noteExited('other');
		service.forget('other');
		blockedLease = true;
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'unavailable');
		assert.strictEqual(await read('file.txt'), 'CLI');
	});

	test('native runs and live hooked CLIs also block selected restoration', async () => {
		await begin(); await write('file.txt', 'CLI'); await finish('file.txt', 'updated', true, false);
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'conflict');
		service.noteExited(session.id);
		runState.runsInFlightByProvider.set('fixture', 1);
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'conflict');
		assert.strictEqual(await read('file.txt'), 'CLI');
	});

	test('provider version validation preserves a write injected after preflight', async () => {
		await begin(); await write('file.txt', 'CLI'); await finish();
		beforeWrite = () => write('file.txt', 'concurrent content with a different size');
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'conflict');
		assert.strictEqual(await read('file.txt'), 'concurrent content with a different size');
	});

	test('quarantine preserves a concurrent write injected before a creation is removed', async () => {
		await begin(); await write('new.txt', 'CLI'); await finish('new.txt', 'added');
		beforeRename = () => write('new.txt', 'concurrent content');
		assert.strictEqual((await service.rollback(session.id, 'new.txt', true)).status, 'conflict');
		assert.strictEqual(await read('new.txt'), 'concurrent content');
	});

	test('symlink replacement is rejected even if target content matches the observed snapshot', async function () {
		if (process.platform === 'win32') { this.skip(); } // Creating symlinks requires privileges on Windows.
		await begin(); await write('file.txt', 'CLI'); await finish();
		await write('target.txt', 'CLI'); await unlink(join(cwd, 'file.txt')); await symlink('target.txt', join(cwd, 'file.txt'));
		assert.strictEqual((await service.rollback(session.id, 'file.txt', true)).status, 'conflict');
		assert.strictEqual(await read('target.txt'), 'CLI');
	});
});
