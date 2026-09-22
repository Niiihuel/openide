/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getContentHeight, getContentWidth, getWindow } from '../../../../base/browser/dom.js';
import { Orientation } from '../../../../base/browser/ui/splitview/splitview.js';
import { Action, toAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { WorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ITerminalProfile, TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { OpenideEmptyState } from '../../../browser/openideEmptyState.js';
import { Direction, ICreateTerminalOptions, ITerminalGroupService, ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { SplitPaneContainer } from '../../terminal/browser/terminalGroup.js';
import { getIconId } from '../../terminal/browser/terminalIcon.js';
import { killTerminalIcon, newTerminalIcon } from '../../terminal/browser/terminalIcons.js';
import { TerminalCommandId } from '../../terminal/common/terminal.js';
import { TerminalContextKeys } from '../../terminal/common/terminalContextKey.js';
import { terminalStrings } from '../../terminal/common/terminalStrings.js';
import { t } from '../common/openideStrings.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { setupChatTooltip } from './chat/openideChatHover.js';

interface IBorrowedTerminal {
	readonly instance: ITerminalInstance;
	readonly wasForeground: boolean;
	readonly originalContainer: HTMLElement | null;
	readonly wasVisible: boolean;
}

/** A presentation of existing workbench terminals, with one PTY owner throughout window handoff. */
export class OpenideAgentWindowTerminal extends Disposable {
	readonly domNode: HTMLElement;
	private readonly tabs: HTMLElement;
	private readonly body: HTMLElement;
	private readonly terminalContext: IContextKeyService;
	private readonly splitContext: IContextKey<boolean>;
	private readonly killAction: Action;
	private readonly splitAction: Action;
	private readonly rows = this._register(new DisposableStore());
	private borrowed: IBorrowedTerminal | undefined;
	private readonly panes = new Map<number, IBorrowedTerminal>();
	private readonly paneListeners = this._register(new DisposableStore());
	private readonly splitView = this._register(new MutableDisposable<SplitPaneContainer>());
	private readonly emptyState = this._register(new MutableDisposable<OpenideEmptyState>());
	private creating: Promise<void> | undefined;
	private disposed = false;
	private visible = false;

	constructor(
		parent: HTMLElement,
		closePanel: () => void,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IHoverService private readonly hoverService: IHoverService,
		@ITerminalGroupService private readonly terminalGroupService: ITerminalGroupService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
	) {
		super();
		this.domNode = append(parent, $('.openide-agent-window-terminal'));
		const header = append(this.domNode, $('.openide-agent-window-terminal-header'));
		this.tabs = append(header, $('.openide-agent-window-terminal-tabs', { role: 'tablist', 'aria-label': t('agentWindow.terminal') }));
		const actions = append(header, $('.openide-agent-window-terminal-actions'));
		this.killAction = this._register(new Action(TerminalCommandId.Kill, t('agentWindow.terminalClose'), ThemeIcon.asClassName(killTerminalIcon), false, async () => {
			if (this.borrowed) { await this.terminalService.safeDisposeTerminal(this.borrowed.instance); }
		}));
		this.splitAction = this._register(new Action(TerminalCommandId.Split, terminalStrings.split.value, ThemeIcon.asClassName(Codicon.splitHorizontal), false, () => this.handleCommand(TerminalCommandId.Split)));
		const toolbar = this._register(this.instantiationService.createInstance(WorkbenchToolBar, actions, { ariaLabel: t('agentWindow.terminal') }));
		toolbar.setActions([
			toAction({ id: TerminalCommandId.New, label: t('agentWindow.terminalNew'), class: ThemeIcon.asClassName(newTerminalIcon), run: () => this.create() }),
			this.splitAction,
			this.killAction,
			toAction({ id: 'openide.agentWindow.terminal.hide', label: t('chat.header.close'), class: ThemeIcon.asClassName(Codicon.close), run: () => { this.hide(); closePanel(); } }),
		]);
		this.body = append(this.domNode, $('.openide-agent-window-terminal-body', { role: 'tabpanel' }));
		this.terminalContext = this._register(this.contextKeyService.createScoped(this.body));
		this.splitContext = TerminalContextKeys.splitTerminalActive.bindTo(this.terminalContext);
		this._register(this.terminalService.onDidChangeInstances(() => this.renderTabs()));
		this._register(this.terminalService.onAnyInstanceTitleChange(() => this.renderTabs()));
		this._register(this.terminalService.onAnyInstanceIconChange(() => this.renderTabs()));
		this._register(this.agentService.onDidChangeBackgroundTerminal(() => this.renderTabs()));
		this._register(this.terminalService.onDidDisposeInstance(instance => {
			if (this.panes.delete(instance.instanceId)) {
				this.splitView.value?.remove(instance);
				if (this.borrowed?.instance === instance) { this.borrowed = this.panes.values().next().value; }
				if (this.borrowed) { this.borrowed.instance.focus(true); }
				else { this.splitView.clear(); this.renderEmpty(); }
			}
			this.renderTabs();
		}));
		const observer = new (getWindow(parent).ResizeObserver)(() => this.layout());
		observer.observe(this.body);
		this._register({ dispose: () => observer.disconnect() });
		this.renderTabs();
		this.renderEmpty();
	}

	private available(): readonly ITerminalInstance[] {
		// CLI harnesses own their hidden terminal presentation; do not steal it from the chat.
		const background = new Set(this.agentService.backgroundTerminalInstanceIds);
		return this.terminalService.instances.filter(instance => !instance.isDisposed && (
			instance === this.borrowed?.instance || !instance.shellLaunchConfig.hideFromUser || background.has(instance.instanceId)
		));
	}

	private renderTabs(): void {
		if (this.disposed) { return; }
		this.splitContext.set(this.panes.size > 1);
		this.rows.clear();
		clearNode(this.tabs);
		this.splitAction.enabled = this.killAction.enabled = !!this.borrowed && !this.borrowed.instance.isDisposed;
		for (const instance of this.available()) {
			const active = instance === this.borrowed?.instance;
			const button = append(this.tabs, $<HTMLButtonElement>('button.oi-btn.ghost.openide-agent-window-terminal-tab', {
				type: 'button', role: 'tab', 'aria-selected': String(active),
			}));
			button.classList.toggle('active', active);
			append(button, $('span' + ThemeIcon.asCSSSelector({ id: this.instantiationService.invokeFunction(getIconId, instance) }), { 'aria-hidden': 'true' }));
			append(button, $('span', undefined, instance.title));
			this.rows.add(setupChatTooltip(this.hoverService, button, () => instance.title));
			this.rows.add(addDisposableListener(button, 'click', () => { void this.reveal(instance.instanceId).catch(onUnexpectedError); }));
		}
	}

	/** Selects an existing workbench instance; creates one only if no instance is available. */
	async reveal(instanceId?: number): Promise<void> {
		if (this.disposed) { return; }
		this.visible = true;
		const instance = instanceId === undefined
			? this.borrowed?.instance ?? this.available().find(candidate => candidate === this.terminalService.activeInstance) ?? this.available()[0]
			: this.available().find(candidate => candidate.instanceId === instanceId);
		if (!instance) {
			if (instanceId === undefined) { await this.create(); }
			return;
		}
		if (!this.panes.has(instance.instanceId)) {
			const group = this.terminalGroupService.getGroupForInstance(instance);
			const instances = group ? group.terminalInstances.filter(member => member === instance || !member.shellLaunchConfig.hideFromUser) : [instance];
			this.release();
			this.emptyState.clear();
			clearNode(this.body);
			this.splitView.value = new SplitPaneContainer(this.body, Orientation.HORIZONTAL);
			for (const member of instances) { this.borrow(member); }
		}
		this.borrowed = this.panes.get(instance.instanceId);
		this.renderTabs();
		this.layout();
		instance.focus(true);
	}

	/** Creates a normal workbench terminal, so it remains discoverable after this window closes. */
	create(options?: ICreateTerminalOptions): Promise<void> {
		if (this.disposed) { return Promise.resolve(); }
		this.visible = true;
		return this.creating ??= this.createTerminal(options).finally(() => { this.creating = undefined; });
	}

	private async createTerminal(options?: ICreateTerminalOptions): Promise<void> {
		const instance = await this.terminalService.createTerminal({ ...options, location: TerminalLocation.Panel });
		// A creation finishing after close belongs to the IDE; it must not be killed or attached here.
		if (!this.disposed && this.visible) { await this.reveal(instance.instanceId); }
	}

	layout(): void {
		const width = getContentWidth(this.body);
		const height = getContentHeight(this.body);
		if (width > 0 && height > 0) { this.splitView.value?.layout(width, height); }
	}

	focus(): void { this.borrowed?.instance.focus(true); }

	/** Returns the same process to the IDE when the island is hidden. */
	hide(): void {
		this.visible = false;
		this.release();
		this.renderTabs();
		this.renderEmpty();
	}

	private borrow(instance: ITerminalInstance): void {
		const wasForeground = this.terminalService.foregroundInstances.includes(instance);
		const entry = { instance, wasForeground, originalContainer: instance.domElement.parentElement, wasVisible: instance.isVisible };
		this.panes.set(instance.instanceId, entry);
		instance.setParentContextKeyService(this.terminalContext);
		if (wasForeground) { this.terminalService.moveToBackground(instance); }
		instance.detachFromElement();
		this.splitView.value!.split(instance, this.panes.size - 1);
		instance.setVisible(true);
		this.paneListeners.add(instance.onDidFocus(() => { this.borrowed = entry; this.renderTabs(); }));
	}

	private release(): void {
		const entries = [...this.panes.values()];
		this.borrowed = undefined;
		this.panes.clear();
		this.paneListeners.clear();
		this.splitView.clear();
		const restored: ITerminalInstance[] = [];
		const returning: Promise<void>[] = [];
		for (const entry of entries) {
			const { instance } = entry;
			if (instance.isDisposed) { continue; }
			instance.setVisible(false);
			instance.setParentContextKeyService(this.contextKeyService);
			instance.detachFromElement();
			if (entry.wasForeground) {
				restored.push(instance);
				returning.push(this.terminalService.showBackgroundTerminal(instance, true));
			} else if (entry.originalContainer?.isConnected) {
				instance.attachToElement(entry.originalContainer);
				instance.setVisible(entry.wasVisible);
			}
		}
		void Promise.all(returning).then(() => {
			const live = restored.filter(instance => !instance.isDisposed && this.terminalService.foregroundInstances.includes(instance));
			if (live.length > 1) { this.terminalGroupService.joinInstances(live); }
		}).catch(onUnexpectedError);
	}

	static supportsCommand(id: string): boolean {
		return terminalCommands.has(id);
	}

	/** Executes resolved workbench commands against this window's selected native terminal. */
	async handleCommand(id: string, ...args: unknown[]): Promise<boolean> {
		if (!OpenideAgentWindowTerminal.supportsCommand(id) || this.disposed) { return false; }
		const candidate = args[0];
		const options: ICreateTerminalOptions | undefined = candidate && typeof candidate === 'object'
			? ('profileName' in candidate ? { config: candidate as ITerminalProfile } : candidate as ICreateTerminalOptions)
			: undefined;
		switch (id) {
			case TerminalCommandId.New:
			case TerminalCommandId.NewInActiveWorkspace:
				await this.create(options); break;
			case TerminalCommandId.Focus:
				await this.reveal(); break;
			case TerminalCommandId.FocusTabs:
				(this.tabs.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus(); break;
			case TerminalCommandId.FocusNext:
			case TerminalCommandId.FocusPrevious: {
				const seen = new Set<unknown>();
				const all = this.available().filter(instance => {
					const group = this.panes.has(instance.instanceId) ? this.panes : this.terminalGroupService.getGroupForInstance(instance) ?? instance;
					if (seen.has(group)) { return false; }
					seen.add(group); return true;
				});
				const index = all.findIndex(instance => this.panes.has(instance.instanceId));
				if (all.length) {
					const next = index < 0 ? (id === TerminalCommandId.FocusNext ? 0 : all.length - 1) : (index + (id === TerminalCommandId.FocusNext ? 1 : all.length - 1)) % all.length;
					await this.reveal(all[next].instanceId);
				}
				break;
			}
			case TerminalCommandId.FocusNextPane:
			case TerminalCommandId.FocusPreviousPane: {
				const all = [...this.panes.values()];
				const index = all.indexOf(this.borrowed!);
				const next = all[(index + (id === TerminalCommandId.FocusNextPane ? 1 : all.length - 1)) % all.length];
				if (next) { this.borrowed = next; this.focus(); this.renderTabs(); }
				break;
			}
			case TerminalCommandId.Split:
			case TerminalCommandId.SplitActiveTab: {
				if (!this.borrowed) { await this.reveal(); }
				const parent = this.borrowed?.instance;
				if (!parent) { break; }
				const instance = await this.terminalService.createTerminal({ ...options, location: TerminalLocation.Panel, cwd: options?.cwd ?? await parent.getCwdResource() });
				if (!this.disposed && this.visible && this.panes.has(parent.instanceId)) {
					this.borrow(instance);
					this.borrowed = this.panes.get(instance.instanceId);
					this.layout(); this.focus(); this.renderTabs();
				}
				break;
			}
			case TerminalCommandId.Unsplit: {
				const selected = this.borrowed;
				if (selected && this.panes.size > 1) {
					this.panes.delete(selected.instance.instanceId);
					this.release();
					this.emptyState.clear();
					clearNode(this.body);
					this.splitView.value = new SplitPaneContainer(this.body, Orientation.HORIZONTAL);
					this.panes.set(selected.instance.instanceId, selected);
					this.borrowed = selected;
					selected.instance.detachFromElement();
					this.splitView.value.split(selected.instance, 0);
					selected.instance.setVisible(true);
					this.layout(); this.focus(); this.renderTabs();
				}
				break;
			}
			case TerminalCommandId.Kill:
				if (this.borrowed) { await this.terminalService.safeDisposeTerminal(this.borrowed.instance); } break;
			case TerminalCommandId.KillActiveTab:
				for (const entry of [...this.panes.values()]) { await this.terminalService.safeDisposeTerminal(entry.instance); } break;
			case TerminalCommandId.ResizePaneLeft:
			case TerminalCommandId.ResizePaneRight: {
				const index = [...this.panes.values()].indexOf(this.borrowed!);
				const charWidth = this.borrowed?.instance.xterm?.getFont().charWidth;
				if (index >= 0 && charWidth) { this.splitView.value?.resizePane(index, id === TerminalCommandId.ResizePaneLeft ? Direction.Left : Direction.Right, charWidth * 4); }
				break;
			}
			case TerminalCommandId.ScrollDownLine: this.borrowed?.instance.scrollDownLine(); break;
			case TerminalCommandId.ScrollDownPage: this.borrowed?.instance.scrollDownPage(); break;
			case TerminalCommandId.ScrollUpLine: this.borrowed?.instance.scrollUpLine(); break;
			case TerminalCommandId.ScrollUpPage: this.borrowed?.instance.scrollUpPage(); break;
			case TerminalCommandId.ScrollToTop: this.borrowed?.instance.scrollToTop(); break;
			case TerminalCommandId.ScrollToBottom: this.borrowed?.instance.scrollToBottom(); break;
			case TerminalCommandId.Clear:
				this.borrowed?.instance.clearBuffer(); break;
			case TerminalCommandId.SelectAll:
				this.borrowed?.instance.xterm?.raw.selectAll(); break;
			case TerminalCommandId.ClearSelection:
				this.borrowed?.instance.xterm?.raw.clearSelection(); break;
		}
		return true;
	}

	private renderEmpty(): void {
		if (this.disposed || this.borrowed) { return; }
		this.emptyState.clear();
		clearNode(this.body);
		this.emptyState.value = this.instantiationService.createInstance(OpenideEmptyState, this.body, {
			title: t('agentWindow.terminal'), description: t('agentWindow.terminalEmpty'),
			compact: true,
			actions: [{ label: t('agentWindow.terminalNew'), run: () => this.create(), commandId: TerminalCommandId.New }],
		});
		this.emptyState.value.domNode.classList.add('openide-agent-window-terminal-empty');
	}

	override dispose(): void {
		this.disposed = true;
		this.release();
		super.dispose();
	}
}

const terminalCommands: ReadonlySet<string> = new Set([
	TerminalCommandId.New, TerminalCommandId.NewInActiveWorkspace, TerminalCommandId.Focus, TerminalCommandId.FocusTabs,
	TerminalCommandId.FocusNext, TerminalCommandId.FocusPrevious, TerminalCommandId.FocusNextPane, TerminalCommandId.FocusPreviousPane,
	TerminalCommandId.Split, TerminalCommandId.SplitActiveTab, TerminalCommandId.Unsplit, TerminalCommandId.Kill, TerminalCommandId.KillActiveTab,
	TerminalCommandId.Clear, TerminalCommandId.SelectAll, TerminalCommandId.ClearSelection,
	TerminalCommandId.ResizePaneLeft, TerminalCommandId.ResizePaneRight,
	TerminalCommandId.ScrollDownLine, TerminalCommandId.ScrollDownPage, TerminalCommandId.ScrollUpLine, TerminalCommandId.ScrollUpPage,
	TerminalCommandId.ScrollToTop, TerminalCommandId.ScrollToBottom,
]);
