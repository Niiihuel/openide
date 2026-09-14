/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { append } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { basenameOrAuthority } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { isCancellationError, onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { IQuickInputService, IQuickPick, IQuickPickItem, QuickPickInput } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { onDidChangeOpenideLanguage, t } from '../common/openideStrings.js';
import { OpenideChatSessions } from './openideChatSessions.js';
import { sessionProjectContext } from './chat/openideChatSessionsPane.js';
import { createOpenideElement } from './openideDom.js';
import './chat/media/openideAgentWindowSearch.css';

export interface IOpenideAgentWindowSearchActions {
	openSession(id: string): void | Promise<void>;
	newChat(): void | Promise<void>;
	openFolder(): void | Promise<void>;
	searchFiles(): void | Promise<void>;
	openFile(resource: URI): void | Promise<void>;
}

interface ISearchItem extends IQuickPickItem {
	readonly run: () => void | Promise<void>;
}

/** Uses the workbench's real keyboard-accessible picker, anchored to its owning auxiliary window. */
export class OpenideAgentWindowSearch extends Disposable {
	private readonly anchor: HTMLElement;
	private readonly pickerStore = this._register(new DisposableStore());
	private picker: IQuickPick<ISearchItem, { useSeparators: true }> | undefined;
	private mode: 'sessions' | 'files' = 'sessions';
	private readonly queryBuilder: QueryBuilder;

	constructor(
		container: HTMLElement,
		private readonly sessions: OpenideChatSessions,
		private readonly actions: IOpenideAgentWindowSearchActions,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ISearchService private readonly searchService: ISearchService,
		@ILabelService private readonly labelService: ILabelService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
	) {
		super();
		this.queryBuilder = instantiationService.createInstance(QueryBuilder);
		this.anchor = append(container, createOpenideElement(container.ownerDocument, 'div'));
		this.anchor.className = 'openide-agent-window-search-anchor';
		this.anchor.setAttribute('aria-hidden', 'true');
		this._register(toDisposable(() => this.anchor.remove()));
		this._register(this.sessions.onDidChange(() => this.refresh()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.refresh()));
		this._register(onDidChangeOpenideLanguage(() => this.refresh()));
	}

	show(): void {
		if (this.picker && this.mode === 'sessions') { this.quickInputService.focus(); return; }
		const picker = this.createPicker('sessions');
		picker.matchOnDescription = true;
		this.refresh();
		picker.show();
	}

	showFiles(): void {
		if (this.picker && this.mode === 'files') { this.quickInputService.focus(); return; }
		const picker = this.createPicker('files');
		picker.placeholder = t('agentWindow.searchFilesPlaceholder');
		picker.ariaLabel = t('agentWindow.searchFiles');
		// QueryBuilder/SearchService own fuzzy ranking and workspace exclusions.
		picker.matchOnLabel = false;
		picker.matchOnDescription = false;
		let request: CancellationTokenSource | undefined;
		const search = async () => {
			request?.dispose(true);
			const current = request = new CancellationTokenSource();
			picker.busy = true;
			try {
				const result = await this.searchService.fileSearch(this.queryBuilder.file(this.workspaceContextService.getWorkspace().folders, {
					filePattern: picker.value,
					maxResults: 100,
					sortByScore: true,
				}), current.token);
				if (current.token.isCancellationRequested || picker !== this.picker) { return; }
				picker.items = result.results.map(({ resource }) => ({
					id: resource.toString(),
					label: basenameOrAuthority(resource),
					description: this.labelService.getUriLabel(resource, { relative: true }),
					iconClasses: getIconClasses(this.modelService, this.languageService, resource),
					run: () => this.actions.openFile(resource),
				}));
			} catch (error) {
				if (!current.token.isCancellationRequested && !isCancellationError(error)) { onUnexpectedError(error); }
			} finally {
				if (!current.token.isCancellationRequested && picker === this.picker) { picker.busy = false; }
			}
		};
		const scheduler = this.pickerStore.add(new RunOnceScheduler(() => void search(), 120));
		this.pickerStore.add(toDisposable(() => request?.dispose(true)));
		this.pickerStore.add(picker.onDidChangeValue(() => {
			request?.cancel();
			scheduler.schedule();
		}));
		picker.show();
		void search();
	}

	private createPicker(mode: 'sessions' | 'files'): IQuickPick<ISearchItem, { useSeparators: true }> {
		this.picker?.hide();
		const previousFocus = this.anchor.ownerDocument.activeElement as HTMLElement | null;
		const picker = this.pickerStore.add(this.quickInputService.createQuickPick<ISearchItem>({ useSeparators: true }));
		this.mode = mode;
		this.picker = picker;
		picker.anchor = this.anchor;
		picker.anchorPosition = 'overlay';
		picker.modal = true;
		picker.sortByLabel = false;
		this.pickerStore.add(picker.onDidAccept(() => {
			const item = picker.selectedItems[0];
			if (!item) { return; }
			picker.hide();
			Promise.resolve().then(() => item.run()).catch(onUnexpectedError);
		}));
		this.pickerStore.add(picker.onDidHide(() => {
			if (previousFocus?.isConnected && previousFocus.ownerDocument === this.anchor.ownerDocument) { previousFocus.focus(); }
			this.picker = undefined;
			this.pickerStore.clear();
		}));
		return picker;
	}

	private refresh(): void {
		const picker = this.picker;
		if (!picker || this.mode !== 'sessions') { return; }
		picker.placeholder = t('agentWindow.searchPlaceholder');
		picker.ariaLabel = t('agentWindow.search');
		const activeId = picker.activeItems[0]?.id;
		const folders = this.workspaceContextService.getWorkspace().folders;
		const items: QuickPickInput<ISearchItem>[] = [
			{ type: 'separator', label: t('agentWindow.searchRecent'), buttons: [] },
			...this.sessions.listAll().filter(session => !session.subagentRunId && (!session.empty || session.pinned)).map(session => ({
				id: session.id,
				label: session.title || t('chat.header.newTitle'),
				description: [sessionProjectContext(session, folders).label, session.archived ? t('sessions.filter.archived') : undefined].filter(Boolean).join(' · '),
				run: () => this.actions.openSession(session.id),
			})),
			{ type: 'separator', label: t('agentWindow.searchActions'), buttons: [] },
			{ id: 'new', label: t('chat.header.newTitle'), keybinding: this.keybindingService.lookupKeybinding('workbench.action.files.newUntitledFile'), run: () => this.actions.newChat() },
			{ id: 'folder', label: t('agentWindow.searchOpenFolder'), keybinding: this.keybindingService.lookupKeybinding('workbench.action.files.openFolder'), run: () => this.actions.openFolder() },
			{ id: 'files', label: t('agentWindow.searchFiles'), keybinding: this.keybindingService.lookupKeybinding('workbench.action.quickOpen'), run: () => this.actions.searchFiles() },
		];
		picker.items = items;
		const active = items.find((item): item is ISearchItem => item.type !== 'separator' && item.id === activeId);
		if (active) { picker.activeItems = [active]; }
	}

	override dispose(): void {
		this.picker?.hide();
		super.dispose();
	}
}
