/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, clearNode } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IDialogService, IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService, toWorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { ISkillInfo } from '../../browser/openideAgentSkills.js';
import { OpenideSkillsSettingsSection } from '../../browser/openideSkillsSettingsSection.js';

suite('OpenIDE Skills Settings inventory', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const skills: ISkillInfo[] = [
		{ name: 'alpha', description: 'First skill', location: 'builtin', scope: 'global', disabled: false },
		{ name: 'beta', description: 'Second skill', location: 'builtin', scope: 'global', disabled: false },
		{ name: 'project', description: 'Workspace skill', location: 'builtin', scope: 'project', disabled: false },
	];
	async function flush(): Promise<void> {
		for (let index = 0; index < 10; index++) { await Promise.resolve(); }
	}
	function fixture(read = async () => skills) {
		let reads = 0;
		const host = document.body.appendChild($('.openide-settings-list'));
		store.add(toDisposable(() => host.remove()));
		const agent = new class extends mock<IOpenideAgentService>() {
			override async listSkills(): Promise<ISkillInfo[]> { reads++; return read(); }
		};
		const section = store.add(new OpenideSkillsSettingsSection(agent,
			new class extends mock<IContextViewService>() {},
			new class extends mock<IDialogService>() {},
			new class extends mock<IFileDialogService>() {},
			new class extends mock<IFileService>() {},
			new class extends mock<IQuickInputService>() {},
			new class extends mock<IWorkspaceContextService>() {
				override getWorkspace() { return { id: 'test', folders: [toWorkspaceFolder(URI.file('/workspace'))] }; }
			},
			new class extends mock<IEditorService>() {},
			new class extends mock<ICommandService>() {},
			new class extends mock<INotificationService>() {},
		));
		return {
			host, section, reads: () => reads,
			render(query: string, scope: 'user' | 'workspace' = 'user') {
				clearNode(host);
				section.render(host, { query, scope });
			},
			names: () => Array.from(host.querySelectorAll('.openide-settings-setting-title > .openide-settings-mono'), node => node.textContent),
		};
	}

	test('search filters the snapshot without rescanning all skill files', async () => {
		const f = fixture();
		f.render(''); await flush();
		f.render('al'); await flush();
		f.render('alpha'); await flush();
		assert.deepStrictEqual({ reads: f.reads(), names: f.names() }, { reads: 1, names: ['alpha'] });
		f.render(''); await flush();
		assert.deepStrictEqual({ reads: f.reads(), names: f.names() }, { reads: 1, names: ['alpha', 'beta'] });
		f.render('', 'workspace'); await flush();
		assert.deepStrictEqual({ reads: f.reads(), names: f.names() }, { reads: 2, names: ['project'] });
		f.render('', 'workspace'); await flush();
		assert.strictEqual(f.reads(), 3, 'activation or configuration repaint refreshes the inventory');
	});

	test('coalesces a pending discovery while only the search changes', async () => {
		const pending = new DeferredPromise<ISkillInfo[]>();
		const f = fixture(() => pending.p);
		f.render('');
		f.render('a');
		f.render('beta');
		await pending.complete(skills); await flush();
		assert.deepStrictEqual({ reads: f.reads(), names: f.names() }, { reads: 1, names: ['beta'] });
	});

	test('does not mount late discovery results after disposal', async () => {
		const pending = new DeferredPromise<ISkillInfo[]>();
		const f = fixture(() => pending.p);
		f.render('');
		f.section.dispose();
		await pending.complete(skills); await flush();
		assert.deepStrictEqual(f.names(), []);
	});
});
