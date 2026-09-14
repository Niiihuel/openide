/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { setupOverflowFade } from './chat/openideChatHover.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService, IModalEditorPart } from '../../../services/editor/common/editorGroupsService.js';
import { registerEditorWindowTarget } from '../../../services/editor/browser/editorService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';

/** Opens real workbench editor inputs in the owning agent window's native modal part. */
export class OpenideAgentWindowEditors extends Disposable {
	private part: IModalEditorPart | undefined;
	private settingsPart: IModalEditorPart | undefined;
	private settingsService: IEditorService | undefined;
	private settingsCreating: Promise<IEditorService> | undefined;
	private readonly settingsStore = this._register(new DisposableStore());
	private dockHost: HTMLElement | undefined;
	private revealDock: (() => void) | undefined;
	private dockToolbar: HTMLElement | undefined;
	private toolbarHome: HTMLElement | undefined;
	private toolbarHost: HTMLElement | undefined;
	private addTabMenuId: string | undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;

	configureDock(host: HTMLElement, reveal: () => void, toolbar?: HTMLElement, addTabMenuId?: string): void {
		this.dockHost = host;
		this.revealDock = reveal;
		this.dockToolbar = toolbar;
		this.addTabMenuId = addTabMenuId;
		this.toolbarHome = toolbar?.parentElement ?? undefined;
	}

	/** Keep native tab sizing, focus, drag and overflow; install controls in its measured toolbar. */
	private syncToolbar(): void {
		if (!this.dockToolbar || !this.toolbarHome) { return; }
		const target = this.part?.embedded
			? (this.part.modalElement as HTMLElement).querySelector<HTMLElement>('.editor-group-container.active > .title .editor-actions')
				?? (this.part.modalElement as HTMLElement).querySelector<HTMLElement>('.editor-group-container > .title .editor-actions')
			: undefined;
		if (target !== this.toolbarHost) {
			this.toolbarHost?.classList.remove('openide-workspace-actions-host');
			this.toolbarHost = target ?? undefined;
			target?.classList.add('openide-workspace-actions-host');
		}
		const host = target ?? this.toolbarHome;
		if (this.dockToolbar.parentElement !== host) { host.appendChild(this.dockToolbar); }
	}

	get tabs(): readonly EditorInput[] { return this.scopedEditorService?.editors ?? []; }
	get isModal(): boolean { return !!this.part && !this.part.embedded; }
	get activeEditor(): EditorInput | undefined { return this.scopedEditorService?.activeEditor; }

	dock(): void {
		if (!this.part || !this.dockHost) { return; }
		this.part.setEmbeddedContainer(this.dockHost);
		this.part.setEmbeddedVisible(true);
		this.syncToolbar();
		this.revealDock?.();
		this.changed.fire();
	}

	showModal(): void {
		if (!this.part) { return; }
		this.part.setEmbeddedVisible(true);
		this.part.setEmbeddedContainer(undefined);
		this.syncToolbar();
		this.part.activeGroup.focus();
		this.changed.fire();
	}

	setDockVisible(visible: boolean): void {
		if (this.part?.embedded) { this.part.setEmbeddedVisible(visible); }
	}


	async activate(input: EditorInput): Promise<void> {
		if (!this.scopedEditorService) { return; }
		this.dock();
		await this.scopedEditorService.openEditor(input, { pinned: true });
	}

	async closeTab(input: EditorInput): Promise<void> {
		const group = this.part?.groups.find(group => group.contains(input));
		await group?.closeEditor(input);
	}
	private scopedEditorService: IEditorService | undefined;
	private creating: Promise<IEditorService> | undefined;
	private closing = false;
	private readonly editorStore = this._register(new DisposableStore());

	constructor(
		private readonly targetWindowId: number,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService,
		@IAuxiliaryWindowService auxiliaryWindowService: IAuxiliaryWindowService,
	) {
		super();
		this._register(registerEditorWindowTarget(targetWindowId, async modal => { const service = await this.getEditorService(); if (modal) { this.showModal(); } return service; }));
		const auxiliary = auxiliaryWindowService.getWindow(targetWindowId);
		if (auxiliary) { this._register(auxiliary.onBeforeUnload(event => event.join(() => this.prepareClose()))); }
	}

	private async prepareClose(): Promise<boolean> {
		this.closing = true;
		try {
			await this.creating;
			const closed = await this.close();
			if (!closed) { this.closing = false; }
			return closed;
		} catch (error) { this.closing = false; throw error; }
	}

	getEditorService(): Promise<IEditorService> {
		if (this.closing || this._store.isDisposed) { return Promise.reject(new Error('The agent editor window has closed')); }
		if (this.scopedEditorService) {
			// Resolving the service is also used by actions inside an expanded editor.
			// Keep that presentation; only an explicit dock action should collapse it.
			if (this.part?.embedded) { this.dock(); }
			return Promise.resolve(this.scopedEditorService);
		}
		return this.creating ??= (async () => {
			await this.settingsCreating;
			return this.create();
		})().finally(() => { this.creating = undefined; });
	}

	private async create(): Promise<IEditorService> {
		const part = await this.editorGroupsService.createModalEditorPart({ targetWindowId: this.targetWindowId, maximized: true, nested: true, dockable: true, tabsBarAddTabMenuId: this.addTabMenuId });
		if (this._store.isDisposed) {
			await part.close();
			throw new Error('The agent editor window has closed');
		}
		(part.modalElement as HTMLElement).classList.add('openide-agent-editor-surface');
		this.part = part;
		const labels = new Map<HTMLElement, ReturnType<typeof setupOverflowFade>>();
		const titleObservers = new Map<HTMLElement, MutationObserver>();
		const updateLabels = () => {
			this.syncToolbar();
			for (const [label, disposable] of labels) {
				if (!label.isConnected) { disposable.dispose(); labels.delete(label); }
			}
			for (const [title, observer] of titleObservers) {
				if (!title.isConnected) { observer.disconnect(); titleObservers.delete(title); }
			}
			for (const title of (part.modalElement as HTMLElement).querySelectorAll<HTMLElement>('.editor-group-container > .title')) {
				if (!titleObservers.has(title)) {
					const observer = new MutationObserver(scheduleLabels);
					observer.observe(title, { childList: true, subtree: true });
					titleObservers.set(title, observer);
				}
			}
			for (const label of (part.modalElement as HTMLElement).querySelectorAll<HTMLElement>('.editor-group-container > .title .openide-subagent-tab-label .monaco-icon-label-container')) {
				if (!labels.has(label)) { labels.set(label, setupOverflowFade(label)); }
			}
		};
		// Watch native tab headers only. Streaming editor bodies never trigger label scans.
		const labelRefresh = this.editorStore.add(new RunOnceScheduler(updateLabels, 0));
		const scheduleLabels = () => { if (!labelRefresh.isScheduled()) { labelRefresh.schedule(); } };
		this.editorStore.add(part.onDidAddGroup(scheduleLabels));
		this.editorStore.add(part.onDidRemoveGroup(scheduleLabels));
		this.editorStore.add(toDisposable(() => { for (const observer of titleObservers.values()) { observer.disconnect(); } titleObservers.clear(); for (const disposable of labels.values()) { disposable.dispose(); } labels.clear(); }));
		scheduleLabels();
		if (this.dockHost) { part.setEmbeddedContainer(this.dockHost); this.revealDock?.(); }
		this.scopedEditorService = this.editorService.createScoped(part, this.editorStore, { openEditorsInContainer: true });
		this.editorStore.add(this.scopedEditorService.onDidEditorsChange(() => { scheduleLabels(); this.changed.fire(); }));
		this.editorStore.add(this.scopedEditorService.onDidActiveEditorChange(() => { this.syncToolbar(); scheduleLabels(); this.changed.fire(); }));
		this.editorStore.add(part.onWillDispose(() => {
			this.part = undefined;
			this.syncToolbar();
			this.scopedEditorService = undefined;
			this.editorStore.clear();
			this.changed.fire();
		}));
		return this.scopedEditorService;
	}

	async openSettings(input: EditorInput) {
		const service = this.settingsService ?? await (this.settingsCreating ??= this.createSettingsSurface().finally(() => { this.settingsCreating = undefined; }));
		return service.openEditor(input, { pinned: true });
	}

	private async createSettingsSurface(): Promise<IEditorService> {
		// Wait for an existing creation without opening or revealing the workspace panel.
		await this.creating;
		const part = await this.editorGroupsService.createModalEditorPart({ targetWindowId: this.targetWindowId, maximized: true, nested: true });
		if (this.closing || this._store.isDisposed) { await part.close(); throw new Error('The agent editor window has closed'); }
		this.settingsPart = part;
		(part.modalElement as HTMLElement).classList.add('openide-agent-settings-surface');
		const service = this.settingsService = this.editorService.createScoped(part, this.settingsStore, { openEditorsInContainer: true });
		this.settingsStore.add(part.onWillDispose(() => {
			this.settingsPart = undefined;
			this.settingsService = undefined;
			this.settingsStore.clear();
		}));
		return service;
	}

	async getGroup(): Promise<IEditorGroup> {
		await this.getEditorService();
		return this.part!.activeGroup;
	}

	async openEditor(input: IUntypedEditorInput | EditorInput, options?: IEditorOptions) {
		const service = await this.getEditorService();
		return input instanceof EditorInput ? service.openEditor(input, options) : service.openEditor(input);
	}

	async close(): Promise<boolean> {
		await this.settingsCreating;
		if (this.settingsPart && !await this.settingsPart.close()) { return false; }
		return this.part ? this.part.close() : true;
	}

	override dispose(): void {
		// Normal close has already run the native save/revert/cancel workflow before unload.
		// Runtime shutdown must never relocate this window's presentation into the IDE.
		this.closing = true;
		super.dispose();
	}
}
