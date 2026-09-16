/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { AnchorAlignment, AnchorPosition } from '../../../../base/browser/ui/contextview/contextview.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { basename, isEqualOrParent, joinPath, resolvePath } from '../../../../base/common/resources.js';
import { isWindows } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { ISCMRepository, ISCMService } from '../../scm/common/scm.js';
import { getOpenideCli } from '../common/openideAgentCliCatalog.js';
import { t } from '../common/openideStrings.js';
import { menuEmpty, menuRow, menuSection, menuSeparator, OpenideChatMenuPopover } from './chat/openideChatMenuDom.js';
import { IChatSessionMeta } from './openideChatSessions.js';
import { createContextRow } from './openideAgentWindowContextControls.js';
import './media/openideAgentWindowEnvironment.css';

export interface IAgentWindowEnvironmentActions {
	readonly openFiles: (resource: URI) => void | Promise<void>;
	readonly openTerminal: (cwd: URI) => void | Promise<void>;
	readonly openProject: () => void | Promise<void>;
}

/** Uses the conversation directory, never the previously selected native chat's workspace. */
export function resolveAgentWindowEnvironment(session: IChatSessionMeta | undefined, folders: readonly IWorkspaceFolder[], repositories: readonly ISCMRepository[]) {
	const cwd = session?.cwd ? URI.file(session.cwd) : folders[0]?.uri;
	const folder = cwd ? folders.filter(entry => isEqualOrParent(cwd, entry.uri, isWindows)).sort((a, b) => b.uri.path.length - a.uri.path.length)[0] : undefined;
	const repository = cwd ? repositories.filter(entry => entry.provider.rootUri && isEqualOrParent(cwd, entry.provider.rootUri, isWindows)).sort((a, b) => b.provider.rootUri!.path.length - a.provider.rootUri!.path.length)[0] : undefined;
	return { cwd, folder, repository, harness: session?.cliId ? getOpenideCli(session.cliId)?.name : undefined };
}

/** A .git indirection alone can also be a submodule; commondir distinguishes linked worktrees. */
export async function resolveAgentWindowWorktree(root: URI, files: IFileService): Promise<URI | undefined> {
	try {
		const marker = await files.readFile(joinPath(root, '.git'), { limits: { size: 4096 } });
		const gitdir = /^gitdir:\s*(.+)\s*$/m.exec(marker.value.toString())?.[1]?.trim();
		if (!gitdir) { return undefined; }
		const directory = resolvePath(root, gitdir);
		const common = (await files.readFile(joinPath(directory, 'commondir'), { limits: { size: 4096 } })).value.toString().trim();
		const commonDirectory = common ? resolvePath(directory, common) : undefined;
		return commonDirectory && await files.exists(commonDirectory) ? commonDirectory : undefined;
	} catch { return undefined; }
}

class EnvironmentPopover extends OpenideChatMenuPopover {
	constructor(context: IContextViewService, private readonly render: (content: HTMLElement, store: DisposableStore, relayout: () => void) => void) {
		super(context, { menuClass: 'openide-agent-window-environment-menu', insetLeft: 0, insetRight: 0, alignment: AnchorAlignment.RIGHT, stretchToAnchor: false, anchorTo: 'trigger', position: AnchorPosition.BELOW });
	}
	protected override renderContent(content: HTMLElement, store: DisposableStore): void { this.render(content, store, () => this.relayout()); }
}

/** Compact environment entry points and the native shared popover for the actual session target. */
export class OpenideAgentWindowEnvironment extends Disposable {
	private readonly project: HTMLButtonElement;
	private readonly location: HTMLButtonElement;
	private readonly menu: EnvironmentPopover;
	private sessionIdentity = '';

	constructor(
		parent: HTMLElement,
		private readonly selectedSession: () => IChatSessionMeta | undefined,
		private readonly actions: IAgentWindowEnvironmentActions,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@ISCMService private readonly scm: ISCMService,
		@IContextViewService context: IContextViewService,
		@IHoverService hover: IHoverService,
		@ILabelService private readonly labels: ILabelService,
		@IClipboardService private readonly clipboard: IClipboardService,
		@IFileService private readonly files: IFileService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super();
		this.menu = this._register(new EnvironmentPopover(context, (content, store, relayout) => this.renderMenu(content, store, relayout)));
		this.project = createContextRow(parent, t('agentWindow.workspace'), 'folder', () => this.menu.toggle(parent, this.project), this._store, hover);
		this.location = createContextRow(parent, t('agentWindow.local'), 'device-desktop', () => this.menu.toggle(parent, this.location), this._store, hover);
		for (const row of [this.project, this.location]) {
			row.setAttribute('aria-haspopup', 'dialog');
			append(row, $('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));
		}
		this._register(workspace.onDidChangeWorkspaceFolders(() => this.refresh()));
		this._register(scm.onDidAddRepository(() => this.refresh()));
		this._register(scm.onDidRemoveRepository(() => this.refresh()));
		this.refresh();
	}

	refresh(): void {
		const session = this.selectedSession();
		const environment = resolveAgentWindowEnvironment(session, this.workspace.getWorkspace().folders, [...this.scm.repositories]);
		const identity = `${session?.id ?? ''}:${environment.cwd?.toString() ?? ''}`;
		if (identity !== this.sessionIdentity) { this.menu.close(); this.sessionIdentity = identity; }
		const project = environment.folder?.name ?? (environment.cwd ? basename(environment.cwd) : t('agentWindow.noProject'));
		this.project.querySelector('.openide-agent-window-row-label')!.textContent = project;
		this.project.setAttribute('aria-label', environment.cwd ? this.labels.getUriLabel(environment.cwd) : project);
		const projectIcon = this.project.querySelector<HTMLElement>(':scope > .codicon');
		projectIcon?.classList.toggle('codicon-folder', !!environment.cwd);
		projectIcon?.classList.toggle('codicon-folder-opened', !environment.cwd);
		const location = environment.cwd && environment.cwd.scheme !== 'file' ? environment.cwd.authority || environment.cwd.scheme : t('agentWindow.local');
		const caption = environment.harness ? `${location} · ${environment.harness}` : location;
		this.location.hidden = !environment.cwd;
		this.location.querySelector('.openide-agent-window-row-label')!.textContent = caption;
		this.location.setAttribute('aria-label', caption);
	}

	private renderMenu(content: HTMLElement, store: DisposableStore, relayout: () => void): void {
		const environment = resolveAgentWindowEnvironment(this.selectedSession(), this.workspace.getWorkspace().folders, [...this.scm.repositories]);
		content.setAttribute('role', 'dialog');
		content.setAttribute('aria-label', t('agentWindow.environment'));
		append(content, menuSection(t('agentWindow.environment')));
		const details = append(content, $('dl.openide-agent-window-environment-details'));
		const detail = (label: string, value: string): HTMLElement => { append(details, $('dt', undefined, label)); return append(details, $('dd', undefined, value)); };
		const action = (icon: string, label: string, callback: () => void | Promise<void>): void => {
			const { row } = menuRow(icon, label);
			row.setAttribute('aria-label', label);
			store.add(addDisposableListener(row, 'click', () => {
				this.menu.close();
				void Promise.resolve().then(callback).catch(error => this.notifications.error(error));
			}));
			append(content, row);
		};
		const cwd = environment.cwd;
		if (!cwd) {
			append(content, menuEmpty(t('agentWindow.environment.noFolder')));
			append(content, menuSeparator());
			action('folder-opened', t('agentWindow.menu.openProject'), this.actions.openProject);
			return;
		}
		detail(t('agentWindow.environment.location'), cwd.scheme === 'file' ? t('agentWindow.local') : cwd.authority || cwd.scheme);
		detail(t('agentWindow.environment.directory'), this.labels.getUriLabel(cwd));
		detail(t('agentWindow.environment.harness'), environment.harness ?? 'OpenIDE');
		if (environment.repository?.provider.rootUri) {
			const root = environment.repository.provider.rootUri;
			detail(t('agentWindow.environment.repository'), this.labels.getUriLabel(root));
			const branchLabel = append(details, $('dt', undefined, t('agentWindow.branch')));
			const branchValue = append(details, $('dd'));
			store.add(autorun(reader => {
				const branch = environment.repository!.provider.historyProvider.read(reader)?.historyItemRef.read(reader);
				branchLabel.hidden = branchValue.hidden = !branch;
				branchValue.textContent = branch?.name ?? '';
				relayout();
			}));
			void resolveAgentWindowWorktree(root, this.files).then(common => {
				if (store.isDisposed || !common) { return; }
				detail(t('agentWindow.environment.worktree'), this.labels.getUriLabel(root));
				detail(t('agentWindow.environment.sharedGit'), this.labels.getUriLabel(common));
				relayout();
			});
		}
		append(content, menuSeparator());
		action('files', t('agentWindow.environment.openFiles'), () => this.actions.openFiles(cwd));
		action('terminal', t('agentWindow.environment.openTerminal'), () => this.actions.openTerminal(cwd));
		action('copy', t('agentWindow.environment.copyPath'), () => this.clipboard.writeText(cwd.scheme === 'file' ? cwd.fsPath : cwd.toString(true)));
	}
}
