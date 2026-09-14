/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { ISCMRepository, ISCMService } from '../../../scm/common/scm.js';
import { OpenideAgentWindowEnvironment, resolveAgentWindowEnvironment, resolveAgentWindowWorktree } from '../../browser/openideAgentWindowEnvironment.js';
import { IChatSessionMeta } from '../../browser/openideChatSessions.js';

suite('OpenIDE agent window environment', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const folder = (path: string): IWorkspaceFolder => upcastPartial<IWorkspaceFolder>({ name: path.split('/').pop()!, uri: URI.file(path) });
	const repository = (path: string): ISCMRepository => upcastPartial<ISCMRepository>({ provider: { rootUri: URI.file(path) } as ISCMRepository['provider'] });
	const session = (cwd: string): IChatSessionMeta => upcastPartial<IChatSessionMeta>({ id: 'cli', kind: 'cli', cliId: 'codex', cwd });

	test('nested CLI cwd selects its deepest workspace and SCM repository', () => {
		const folders = [folder('/project'), folder('/project/nested')];
		const repositories = [repository('/project'), repository('/project/nested')];
		const environment = resolveAgentWindowEnvironment(session('/project/nested/src'), folders, repositories);
		assert.strictEqual(environment.folder, folders[1]);
		assert.strictEqual(environment.repository, repositories[1]);
		assert.strictEqual(environment.cwd?.fsPath, '/project/nested/src');
		assert.strictEqual(environment.harness, 'Codex');
	});

	test('external conversation never inherits an unrelated first workspace repository', () => {
		const environment = resolveAgentWindowEnvironment(session('/worktrees/feature'), [folder('/project')], [repository('/project')]);
		assert.strictEqual(environment.folder, undefined);
		assert.strictEqual(environment.repository, undefined);
		assert.strictEqual(environment.cwd?.fsPath, '/worktrees/feature');
	});

	function files(entries: Record<string, string>) {
		return upcastPartial<IFileService>({
			readFile: async resource => { const value = entries[resource.path]; if (value === undefined) { throw new Error('Missing'); } return { resource, name: '', mtime: 0, ctime: 0, etag: '', size: value.length, readonly: false, locked: false, executable: false, value: VSBuffer.fromString(value) }; },
			exists: async resource => Object.hasOwn(entries, resource.path),
		});
	}

	test('linked worktree requires valid shared Git directory and resolves relative metadata', async () => {
		const result = await resolveAgentWindowWorktree(URI.file('/worktrees/feature'), files({
			'/worktrees/feature/.git': 'gitdir: ../../project/.git/worktrees/feature\n',
			'/project/.git/worktrees/feature/commondir': '../..\n',
			'/project/.git': '',
		}));
		assert.strictEqual(result?.fsPath, '/project/.git');
	});

	test('submodule gitdir and unreadable metadata are not presented as linked worktrees', async () => {
		assert.strictEqual(await resolveAgentWindowWorktree(URI.file('/project/submodule'), files({ '/project/submodule/.git': 'gitdir: ../.git/modules/submodule' })), undefined);
		assert.strictEqual(await resolveAgentWindowWorktree(URI.file('/project'), files({})), undefined);
	});

	test('native popover actions use selected cwd and close before dispatch', async () => {
		const parent = mainWindow.document.createElement('div');
		const popup = mainWindow.document.createElement('div');
		let renderStore = store.add(new DisposableStore());
		let closed = 0;
		let copied = '';
		const opened: string[] = [];
		const errors: unknown[] = [];
		const context = upcastPartial<IContextViewService>({
			showContextView: delegate => { renderStore = store.add(delegate.render(popup) as DisposableStore); return { close: () => { closed++; renderStore.dispose(); popup.replaceChildren(); delegate.onHide?.(); } }; },
			layout: () => {},
		});
		store.add(new OpenideAgentWindowEnvironment(parent, () => session('/session/cwd'), {
			openFiles: resource => { assert.ok(closed); opened.push(`files:${resource.fsPath}`); },
			openTerminal: resource => { assert.ok(closed); opened.push(`terminal:${resource.fsPath}`); },
		}, upcastPartial<IWorkspaceContextService>({ getWorkspace: () => ({ id: 'workspace', folders: [folder('/project')] }), onDidChangeWorkspaceFolders: Event.None }),
		upcastPartial<ISCMService>({ repositories: [], onDidAddRepository: Event.None, onDidRemoveRepository: Event.None }), context, NullHoverService,
		upcastPartial<ILabelService>({ getUriLabel: resource => resource.fsPath }), upcastPartial<IClipboardService>({ writeText: async value => { copied = value; } }), files({}),
		upcastPartial<INotificationService>({ error: error => { errors.push(error); } })));
		for (const label of ['Browse files', 'Open terminal here', 'Copy path']) {
			parent.querySelector<HTMLButtonElement>('button')!.click();
			assert.ok(popup.textContent?.includes('/session/cwd'));
			popup.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
			await Promise.resolve();
		}
		assert.deepStrictEqual(opened, ['files:/session/cwd', 'terminal:/session/cwd']);
		assert.strictEqual(copied, '/session/cwd');
		assert.deepStrictEqual(errors, []);
	});
});
