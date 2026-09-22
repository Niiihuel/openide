/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CodeWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IOpenEmptyWindowOptions, IOpenWindowOptions, IWindowOpenable } from '../../../../../platform/window/common/window.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspacesService } from '../../../../../platform/workspaces/common/workspaces.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { OpenideAgentWindowProjects } from '../../browser/openideAgentWindowProjects.js';

suite('OpenIDE Agents project selection', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const original = URI.file('/projects/ide');
	const destination = URI.file('/projects/agent');

	function fixture(selection: () => Promise<URI[] | undefined>, open?: () => Promise<void>) {
		let dialogs = 0;
		const requests: { openables: IWindowOpenable[]; options?: IOpenWindowOptions }[] = [];
		const host = upcastPartial<IHostService>({ focus: async () => {}, openWindow: async (openables?: IWindowOpenable[] | IOpenEmptyWindowOptions, options?: IOpenWindowOptions) => {
			assert.ok(Array.isArray(openables));
			requests.push({ openables, options }); await open?.();
		} });
		const projects = store.add(new OpenideAgentWindowProjects(
			upcastPartial<CodeWindow>({ vscodeWindowId: 42, document }),
			upcastPartial<IFileDialogService>({ showOpenDialog: async options => {
				dialogs++;
				assert.deepStrictEqual({ files: options.canSelectFiles, folders: options.canSelectFolders, many: options.canSelectMany, defaultUri: options.defaultUri }, { files: false, folders: true, many: false, defaultUri: original });
				return selection();
			} }), host,
			upcastPartial<IWorkspaceContextService>({ getWorkspace: () => ({ id: 'ide-workspace', folders: [{ uri: original, name: 'ide', index: 0, toResource: relative => URI.joinPath(original, relative) }] }) }),
			upcastPartial<IWorkspacesService>({ getRecentlyOpened: async () => ({ workspaces: [{ workspace: { id: 'recent', configPath: URI.file('/projects/recent.code-workspace') } }], files: [{ fileUri: URI.file('/projects/unrelated.txt') }] }) }),
			upcastPartial<IQuickInputService>({ pick: async picks => (await picks)[0] }),
		));
		return { projects, requests, dialogs: () => dialogs };
	}

	test('opens the selected folder through an explicit Agents handoff, preserving the IDE workspace', async () => {
		const f = fixture(async () => [destination]);
		await f.projects.openFolder();
		assert.deepStrictEqual(f.requests, [{ openables: [{ folderUri: destination }], options: { forceNewWindow: true, remoteAuthority: null, openideAgentWindow: { sourceWindowId: 42 } } }]);
	});

	test('cancellation and selecting the current project do not open or reload any window', async () => {
		const cancelled = fixture(async () => undefined);
		const same = fixture(async () => [original]);
		await cancelled.projects.openFolder(); await same.projects.openFolder();
		assert.deepStrictEqual([cancelled.requests, same.requests], [[], []]);
	});

	test('coalesces repeated clicks until the destination is ready', async () => {
		const ready = new DeferredPromise<void>();
		const f = fixture(async () => [destination], () => ready.p);
		const first = f.projects.openFolder();
		const second = f.projects.openFolder();
		assert.strictEqual(first, second);
		await ready.complete(); await first;
		assert.deepStrictEqual({ dialogs: f.dialogs(), opens: f.requests.length }, { dialogs: 1, opens: 1 });
	});

	test('a picker resolving after the Agents window closes cannot create another window', async () => {
		const selected = new DeferredPromise<URI[] | undefined>();
		const f = fixture(() => selected.p);
		const pending = f.projects.openFolder();
		await Promise.resolve();
		f.projects.dispose();
		await selected.complete([destination]); await pending;
		assert.deepStrictEqual(f.requests, []);
	});

	test('recent workspaces use the same scoped handoff and retain the workspace file', async () => {
		const f = fixture(async () => undefined);
		await f.projects.openRecent();
		assert.strictEqual(f.requests.length, 1);
		assert.strictEqual(f.requests[0].openables.length, 1);
		const openable = f.requests[0].openables[0];
		assert.ok('workspaceUri' in openable);
		assert.strictEqual(openable.workspaceUri.toString(), URI.file('/projects/recent.code-workspace').toString());
		assert.deepStrictEqual(f.requests[0].options, { forceNewWindow: true, remoteAuthority: null, openideAgentWindow: { sourceWindowId: 42 } });
	});
});
