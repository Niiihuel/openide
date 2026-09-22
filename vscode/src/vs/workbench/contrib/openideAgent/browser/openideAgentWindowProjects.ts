/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { basename, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IWindowOpenable } from '../../../../platform/window/common/window.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspacesService, isRecentFolder } from '../../../../platform/workspaces/common/workspaces.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { t } from '../common/openideStrings.js';
import './chat/media/openideAgentWindowSearch.css';

interface ProjectPick extends IQuickPickItem {
	readonly resource: URI;
	readonly openable: IWindowOpenable;
	readonly remoteAuthority?: string;
}

/** Opens a project in the Agents surface without replacing the source IDE's workspace. */
export class OpenideAgentWindowProjects extends Disposable {
	private pending: Promise<void> | undefined;
	private readonly anchor: HTMLElement;
	private readonly cancellation = new CancellationTokenSource();

	constructor(
		private readonly window: CodeWindow,
		@IFileDialogService private readonly dialogs: IFileDialogService,
		@IHostService private readonly host: IHostService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IWorkspacesService private readonly workspaces: IWorkspacesService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
	) {
		super();
		this.anchor = $('.openide-agent-window-search-anchor', { 'aria-hidden': 'true' });
		window.document.body.appendChild(this.anchor);
		this._register(toDisposable(() => { this.cancellation.dispose(true); this.anchor.remove(); }));
	}

	/** Repeated clicks share the same selection/handoff; cancellation leaves both windows intact. */
	openFolder(): Promise<void> { return this.run(() => this.pickFolder()); }
	openRecent(): Promise<void> { return this.run(() => this.pickRecent()); }

	private run(action: () => Promise<void>): Promise<void> {
		if (this._store.isDisposed) { return Promise.resolve(); }
		return this.pending ??= action().finally(() => { this.pending = undefined; });
	}

	private async pickFolder(): Promise<void> {
		const defaultUri = this.workspace.getWorkspace().folders[0]?.uri ?? await this.dialogs.defaultFolderPath();
		if (this._store.isDisposed) { return; }
		await this.host.focus(this.window);
		if (this._store.isDisposed) { return; }
		const selected = await this.dialogs.showOpenDialog({
			title: t('agentWindow.menu.openProject'), openLabel: t('agentWindow.menu.openProject'),
			defaultUri, canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
		});
		if (selected?.[0]) { await this.open({ folderUri: selected[0] }, selected[0]); }
	}

	private async pickRecent(): Promise<void> {
		const recent = await this.workspaces.getRecentlyOpened();
		if (this._store.isDisposed) { return; }
		const picks: ProjectPick[] = recent.workspaces.map(entry => {
			const folder = isRecentFolder(entry);
			const resource = folder ? entry.folderUri : entry.workspace.configPath;
			return { label: entry.label || basename(resource), description: resource.scheme === 'file' ? resource.fsPath : resource.toString(true), resource,
				openable: folder ? { folderUri: resource } : { workspaceUri: resource }, remoteAuthority: entry.remoteAuthority };
		});
		await this.host.focus(this.window);
		if (this._store.isDisposed) { return; }
		const selected = await this.quickInput.pick(picks, {
			title: t('agentWindow.menu.openRecent'), matchOnDescription: true,
			anchor: this.anchor, anchorPosition: 'overlay', modal: true,
		}, this.cancellation.token);
		if (selected) { await this.open(selected.openable, selected.resource, selected.remoteAuthority); }
	}

	private async open(openable: IWindowOpenable, resource: URI, remoteAuthority?: string): Promise<void> {
		if (this._store.isDisposed) { return; }
		const current = this.workspace.getWorkspace();
		const same = 'workspaceUri' in openable ? isEqual(current.configuration ?? undefined, resource)
			: !current.configuration && current.folders.length === 1 && isEqual(current.folders[0].uri, resource);
		if (same) { await this.host.focus(this.window); return; }
		await this.host.openWindow([openable], {
			forceNewWindow: true,
			remoteAuthority: remoteAuthority ?? (resource.scheme === 'file' ? null : undefined),
			openideAgentWindow: { sourceWindowId: this.window.vscodeWindowId },
		});
	}
}
