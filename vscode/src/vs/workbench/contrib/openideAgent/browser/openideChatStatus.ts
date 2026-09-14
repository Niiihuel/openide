/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getActiveWindow, getWindow, getWindowById } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { FocusMode } from '../../../../platform/native/common/native.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IStatusbarEntryContainer } from '../../../browser/parts/statusbar/statusbarPart.js';
import { OpenideChatWidget } from './chat/openideChatWidget.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { applyProviderIcon, createProviderIcon } from './openideProviderIcons.js';
import { getOpenideCli } from '../common/openideAgentCliCatalog.js';
import { IOpenideCliChangesService, IOpenideCliTurnFinished, OpenideCliChangesService } from './openideCliChangesService.js';
import { t } from '../common/openideStrings.js';
import { IOpenideUsageMonitor, IOpenideUsageStatusSummary } from './openideUsageMonitor.js';
import { OpenideUsagePopover } from './openideUsagePopover.js';
import { IOpenideIdeServerService, OpenideIdeServerService } from './openideIdeServerService.js';

/** Shared execution chrome, independent of whether the IDE chat has been revealed. */
export class OpenideChatStatus extends Disposable {
	// Footer (status bar): the provider call to action and the account quota, and nothing else. The
	// conversation's context used to have a `# 84K` entry here too; it moved out because the dock
	// already carries that number twice (the composer's ring, and its Session Info popover), and of
	// the three the status bar was the one detached from the conversation it was describing.
	private readonly _statusEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly _usageEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly _usagePopover: OpenideUsagePopover;
	private _statusBrandIcon: HTMLElement | undefined;
	private _usageBrandIcon: HTMLElement | undefined;
	private _usageSummary: IOpenideUsageStatusSummary | undefined;
	private _busy = false;
	private _statusModel = '';
	private _statusProvider = '';
	private _statusProviderId = '';
	private _statusConnected = false;
	private _statusGeneration = 0;
	private _statusSnapshot: IStatusbarEntry | undefined;
	private readonly _statusbarMirrors = new Set<() => void>();

	constructor(
		widget: OpenideChatWidget,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextViewService contextViewService: IContextViewService,
		@IOpenideCliChangesService cliChanges: OpenideCliChangesService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IHostService private readonly hostService: IHostService,
		@IAccessibilitySignalService private readonly accessibilitySignalService: IAccessibilitySignalService,
		@IOpenideUsageMonitor private readonly usageMonitor: IOpenideUsageMonitor,
		@IOpenideIdeServerService private readonly ideServer: OpenideIdeServerService,
	) {
		super();
		this._usagePopover = this._register(new OpenideUsagePopover(usageMonitor, contextViewService, commandService));
		this._busy = widget.controller.isBusy;
		this._register(widget.onDidChangeBusy(busy => { this._busy = busy; this.updateStatusbar(); }));
		this._register(cliChanges.onDidFinishTurn(event => void this.notifyCliTurnComplete(event)));
		this._register(widget.onDidFinishRun(({ hadError, conversationId }) => {
			this.usageMonitor.notifyTurnFinished(this._statusProviderId);
			const sessions = widget.sessionStore;
			const title = conversationId === sessions.activeSessionId() ? undefined : sessions.metaOf(conversationId)?.title;
			void this.notifyTaskComplete(hadError, title ? t('cliChanges.finished', title) : undefined, undefined, widget.controller.getRunWindowId(conversationId)).catch(() => {});
		}));
		this._register(usageMonitor.onDidChange(() => {
			this._usageSummary = usageMonitor.getStatusSummary(this._statusProviderId);
			this.updateStatusbar();
		}));
		this._register(agentService.onDidChange(() => void this.refreshStatus()));
		void this.refreshStatus();
	}
	/** Reuses execution status with a separate native entry and icon in each window. */
	registerStatusbarMirror(container: IStatusbarEntryContainer, document: Document, focusChat: () => void): IDisposable {
		const store = new DisposableStore();
		const windowId = getWindow(document).vscodeWindowId;
		const focusCommand = `openide.agent.focusCompanion.${windowId}`;
		store.add(CommandsRegistry.registerCommand(focusCommand, () => focusChat()));
		const status = store.add(new MutableDisposable<IStatusbarEntryAccessor>());
		const statusIcon = createProviderIcon(document, this._statusProviderId, this._statusProvider, 'openide-status-provider-icon');
		store.add(addDisposableListener(statusIcon, 'click', () => {
			if (this._statusConnected || this._busy) { focusChat(); }
			else { void this.commandService.executeCommand('openide.agent.openProviders'); }
		}));
		const paint = () => {
			applyProviderIcon(statusIcon, this._statusProviderId, this._statusProvider);
			statusIcon.hidden = !this._statusConnected && !this._busy;
			if (this._statusSnapshot) {
				const entry = { ...this._statusSnapshot, content: statusIcon, command: this._statusConnected || this._busy ? focusCommand : this._statusSnapshot.command };
				if (status.value) { status.value.update(entry); }
				else { status.value = container.addEntry(entry, 'openide.agent.status', StatusbarAlignment.RIGHT, 101); }
			} else { status.clear(); }

		};
		this._statusbarMirrors.add(paint);
		store.add(toDisposable(() => { this._statusbarMirrors.delete(paint); this._usagePopover.closeForDocument(document); }));
		paint();
		return store;
	}
	showUsagePopover(): void {
		const document = getActiveWindow().document;
		const anchor = document.getElementById('openide.agent.usage');
		if (anchor) {
			this._usagePopover.show(anchor, this._statusProviderId);
		}
	}
	// ---- status bar -------------------------------------------------------------------------

	/** Provider, model, connection and context limit for the footer. */
	private async refreshStatus(): Promise<void> {
		const generation = ++this._statusGeneration;
		const id = this.agentService.getActiveProviderId();
		const entry = this.agentService.findProvider(id);
		const model = this.agentService.getModel() || entry?.defaultModel || '';
		let connected = false;
		try { connected = await this.agentService.isConnected(id); } catch { connected = false; }
		if (generation !== this._statusGeneration) { return; }
		this._statusProvider = entry ? entry.label : id;
		if (this._statusProviderId !== id) { this._usageSummary = undefined; }
		this._statusProviderId = id;
		this._statusModel = model;
		this._statusConnected = connected;
		this._usageSummary = this.usageMonitor.getStatusSummary(id);
		this.updateStatusbar();
	}

	/** Native footer: the "connect a provider" call to action and the account quota. */
	private updateStatusbar(): void {
		const model = this._statusModel || this._statusProvider || '—';
		const statusDocument = mainWindow.document;
		if (!this._statusBrandIcon) {
			this._statusBrandIcon = createProviderIcon(statusDocument, this._statusProviderId, this._statusProvider, 'openide-status-provider-icon');
			this._register(addDisposableListener(this._statusBrandIcon, 'click', () => void this.commandService.executeCommand(
				this._statusConnected || this._busy ? 'workbench.view.openideChat.view.focus' : 'openide.agent.openProviders'
			)));
		}
		applyProviderIcon(this._statusBrandIcon, this._statusProviderId, this._statusProvider);
		this._statusBrandIcon.hidden = !this._statusConnected && !this._busy;
		// With no provider connected → an honest CTA that opens the providers page (rather than
		// showing a default model that cannot answer).
		const status: IStatusbarEntry = this._statusConnected || this._busy ? {
			name: 'OpenIDE Agent',
			text: this._busy ? `$(loading~spin) ${t('chatSurface.status.working')}` : model,
			ariaLabel: this._busy ? t('chatSurface.status.workingAria') : `OpenIDE Agent: ${model}`,
			tooltip: `OpenIDE Agent — ${this._statusProvider || t('chatSurface.status.noProviderShort')}${this._statusModel ? `\n${this._statusModel}` : ''}`,
			command: 'workbench.view.openideChat.view.focus',
			content: this._statusBrandIcon,
		} : {
			name: 'OpenIDE Agent',
			text: `$(plug) ${t('chatSurface.status.connect')}`,
			ariaLabel: t('chatSurface.status.connectAria'),
			tooltip: t('chatSurface.status.connectTooltip'),
			command: 'openide.agent.openProviders',
			content: this._statusBrandIcon,
		};
		// The model already lives in the composer chip: the status bar only keeps the "connect a
		// provider" call to action and the working spinner.
		this._statusSnapshot = this._statusConnected && !this._busy ? undefined : status;
		if (this._statusConnected && !this._busy) {
			this._statusEntry.clear();
		} else if (this._statusEntry.value) {
			this._statusEntry.value.update(status);
		} else {
			this._statusEntry.value = this.statusbarService.addEntry(status, 'openide.agent.status', StatusbarAlignment.RIGHT, 101);
		}

		if (this._statusConnected || this._busy) {
			if (!this._usageBrandIcon) {
				this._usageBrandIcon = createProviderIcon(statusDocument, this._usageSummary?.providerId || this._statusProviderId, '', 'openide-status-provider-icon');
				this._register(addDisposableListener(this._usageBrandIcon, 'click', () => void this.commandService.executeCommand('openide.agent.showUsage')));
			}
			applyProviderIcon(this._usageBrandIcon, this._usageSummary?.providerId || this._statusProviderId);
			// No data → the brand mark alone, dimmed: it still opens the popover, which says why.
			this._usageBrandIcon.classList.toggle('dimmed', !this._usageSummary);
			const usage: IStatusbarEntry = {
				name: 'OpenIDE Agent: usage',
				text: this._usageSummary?.text ?? '',
				ariaLabel: 'Usage y límites de las cuentas de IA',
				tooltip: this._usageSummary?.tooltip ?? 'Sin datos de uso para esta cuenta — abrí el panel para ver el motivo.',
				command: 'openide.agent.showUsage',
				content: this._usageBrandIcon,
			};
			if (this._usageEntry.value) {
				this._usageEntry.value.update(usage);
			} else {
				this._usageEntry.value = this.statusbarService.addEntry(usage, 'openide.agent.usage', StatusbarAlignment.RIGHT, 100.75);
			}
		} else {
			this._usageEntry.clear();
		}
		for (const paint of this._statusbarMirrors) { paint(); }

		// There is no context indicator down here any more. The dock says the same thing better:
		// the composer's ring shows the percentage where you are typing, and its Session Info
		// popover breaks it down into cost, window and "Compact conversation" — a `# 84K` in the
		// far corner of the window was the third place the same number appeared, and the only one
		// detached from the conversation it belongs to. `openide.agent.showContext` still opens
		// that popover, so the command and its keybinding keep working.
	}


	// ---- task finished ----------------------------------------------------------------------

	/**
	 * A hosted CLI finished a reply.
	 *
	 * Routed through the SAME path as the native agent's completion — the same settings, the same
	 * sound, the same focus behaviour — because from the user's side there is no difference worth
	 * configuring twice: an agent finished while they were looking elsewhere. Only the wording
	 * differs, and it says which agent and how many files, since a CLI can be one of several
	 * running at once.
	 */
	private async notifyCliTurnComplete(event: IOpenideCliTurnFinished): Promise<void> {
		const cli = getOpenideCli(event.cliId);
		const name = cli?.name ?? event.cliId;
		const body = event.failed
			? t('cliChanges.finishedFailed', name)
			: event.files
				? t('cliChanges.finishedFiles', event.title, String(event.files))
				: t('cliChanges.finishedNone', event.title);
		await this.notifyTaskComplete(event.failed, t('cliChanges.finished', name), body, this.ideServer.getSessionWindowId(event.sessionId));
	}

	private async notifyTaskComplete(hadError: boolean, title?: string, body?: string, targetWindowId?: number): Promise<void> {
		if (!this.configurationService.getValue('openide.agent.notifications.enabled')) {
			return;
		}
		if (!this.configurationService.getValue('openide.agent.notifications.onTaskComplete')) {
			return;
		}
		const targetWindow = getWindowById(targetWindowId ?? mainWindow.vscodeWindowId)?.window;
		const suppressWhenFocused = this.configurationService.getValue('openide.agent.notifications.suppressWhenFocused') !== false;
		// The IDE and its agent window share this notification owner.
		const isFocused = this.hostService.hasFocus;
		if (suppressWhenFocused && isFocused) {
			return;
		}
		if (this.configurationService.getValue('openide.agent.notifications.sound') !== false) {
			void this.accessibilitySignalService.playSignal(hadError ? AccessibilitySignal.taskFailed : AccessibilitySignal.taskCompleted);
		}
		if (!isFocused && targetWindow) {
			await this.hostService.focus(targetWindow, { mode: FocusMode.Notify });
		}
		await this.hostService.showToast({
			title: title ?? (hadError ? 'Agente IA: la tarea falló' : 'Agente IA: tarea terminada'),
			body: body ?? 'Volvé al chat para ver la respuesta.',
		}, CancellationToken.None);
	}

}
