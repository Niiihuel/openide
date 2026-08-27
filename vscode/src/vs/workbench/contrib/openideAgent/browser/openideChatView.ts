/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — ViewPane del chat (dock derecho / auxiliary bar).
 *
 *  Hosts the native chat widget (`chat/openideChatWidget.ts`) and owns the chrome that lives
 *  OUTSIDE the dock: the status-bar footer (model · usage · context), the "task finished" toast and
 *  the commands the workbench routes to the active pane. Everything the conversation needs —
 *  sending, streaming, rollback, plans, subagents — is the widget's and its controller's.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getWindow } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeColor } from '../../../../base/common/themables.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { FocusMode } from '../../../../platform/native/common/native.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { OpenideChatWidget } from './chat/openideChatWidget.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { IChatSessionUsage, OpenideChatSessions } from './openideChatSessions.js';
import { applyProviderIcon, createProviderIcon } from './openideProviderIcons.js';
import { getOpenideCli } from '../common/openideAgentCliCatalog.js';
import { IOpenideCliChangesService, IOpenideCliTurnFinished, OpenideCliChangesService } from './openideCliChangesService.js';
import { t } from '../common/openideStrings.js';
import { IOpenideUsageMonitor, IOpenideUsageStatusSummary } from './openideUsageMonitor.js';
import { OpenideUsagePopover } from './openideUsagePopover.js';

export class OpenideChatViewPane extends ViewPane {

	private _container: HTMLElement | undefined;
	private readonly _widget = this._register(new MutableDisposable<OpenideChatWidget>());
	/** Store de conversaciones (tabs + historial), persistido. */
	private _sessions: OpenideChatSessions | undefined;

	// Footer (status bar): estado │ modelo │ usage │ ████░░░░░░ 45K/200K. It lives here and not in
	// the dock — the user wants it next to the notifications.
	private readonly _statusEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly _usageEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly _ctxEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
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
	private _ctx: IChatSessionUsage = { input: 0, output: 0, used: 0, limit: 0 };

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextViewService contextViewService: IContextViewService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@ICommandService private readonly commandService: ICommandService,
		@IStorageService private readonly storageService: IStorageService,
		@IOpenideCliChangesService private readonly cliChanges: OpenideCliChangesService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IHostService private readonly hostService: IHostService,
		@IAccessibilitySignalService private readonly accessibilitySignalService: IAccessibilitySignalService,
		@IOpenideUsageMonitor private readonly usageMonitor: IOpenideUsageMonitor,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._usagePopover = this._register(new OpenideUsagePopover(usageMonitor, contextViewService, commandService));
		// The monitor owns polling, focus refresh and backoff (Orca's service); the footer only
		// repaints when its snapshot changes.
		this._register(this.usageMonitor.onDidChange(() => {
			this._usageSummary = this.usageMonitor.getStatusSummary(this._statusProviderId);
			this.updateStatusbar();
		}));
		this._register(this.agentService.onDidChange(() => void this.refreshStatus()));
		void this.refreshStatus();
	}

	private sessions(): OpenideChatSessions {
		if (!this._sessions) {
			this._sessions = new OpenideChatSessions(this.storageService);
		}
		return this._sessions;
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._container = container;
		container.style.position = 'relative';
		if (this._widget.value) {
			return;
		}
		const widget = this.instantiationService.createInstance(OpenideChatWidget, container, this.sessions());
		this._widget.value = widget;
		this._register(this.onDidChangeBodyVisibility(visible => this._widget.value?.setVisible(visible)));
		// The footer and the "task finished" toast are host chrome: the widget reports, the pane paints.
		this._register(widget.onDidChangeBusy(busy => {
			this._busy = busy;
			this.updateStatusbar();
		}));
		this._register(this.cliChanges.onDidFinishTurn(event => void this.notifyCliTurnComplete(event)));
		this._register(widget.onDidFinishRun(({ hadError }) => {
			// The provider just counted a turn: the quota windows moved (Orca ingests the
			// statusline on every turn; we refetch right after).
			this.usageMonitor.notifyTurnFinished(this._statusProviderId);
			this.notifyTaskComplete(hadError).catch(() => { /* best-effort */ });
		}));
		this._register(widget.onDidChangeUsage(usage => {
			this._ctx = { ...usage, limit: usage.limit || this._ctx.limit };
			this.updateStatusbar();
		}));
		this._ctx = { ...widget.usage, limit: widget.usage.limit || this._ctx.limit };
		this.updateStatusbar();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._container) {
			this._container.style.height = `${height}px`;
			this._container.style.width = `${width}px`;
		}
		this._widget.value?.layout(height, width);
	}

	override focus(): void {
		super.focus();
		this._widget.value?.focus();
	}

	// ---- commands routed to the pane --------------------------------------------------------

	/** "Uso de contexto": the panel explaining the number in the status bar. */
	showContextPanel(): void {
		this._widget.value?.showContextPanel();
	}

	showUsagePopover(): void {
		const document = this._container ? getWindow(this._container).document : undefined;
		const anchor = document?.getElementById('openide.agent.usage');
		if (anchor) {
			this._usagePopover.show(anchor, this._statusProviderId);
		}
	}

	/** Restart: creates a new conversation (new tab) and activates it. Triggered by "New chat". */
	newChat(): void {
		this._widget.value?.newSession();
	}

	/**
	 * Fills the composer without sending. The visual style editor uses it to hand over the CSS it
	 * already decided: the user should read the request and press Send themselves, because carrying
	 * a style into the source touches files.
	 */
	injectPrompt(text: string): void {
		this._widget.value?.injectCanvasPrompt(text, false);
	}

	/** Fork of the active conversation (an independent branch with the inherited context). */
	forkChat(): void {
		this._widget.value?.forkActiveSession();
	}

	/** Brings an explicit Canvas choice to the composer without starting a turn behind the user's back. */
	injectCanvasChoice(choice: { choiceId: string; label: string; canvas?: string }): void {
		const label = String(choice?.label ?? '').trim().slice(0, 1000);
		if (!label) { return; }
		this._widget.value?.injectCanvasChoice(label);
		this.focus();
	}

	/** Prompt triggered by a canvas button: fills the composer and, unless told otherwise, sends it. */
	injectCanvasPrompt(request: { prompt: string; send: boolean; canvas?: string }): void {
		const prompt = String(request?.prompt ?? '').trim().slice(0, 4000);
		if (!prompt) { return; }
		this._widget.value?.injectCanvasPrompt(prompt, request.send !== false);
		this.focus();
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
		const usage = this._widget.value?.usage;
		this._ctx = { ...(usage ?? this._ctx), limit: this.agentService.getContextLimit() };
		this._usageSummary = this.usageMonitor.getStatusSummary(id);
		this.updateStatusbar();
	}

	/** Compact, like the tray badges: 840 · 8.4K · 84K · 1.2M. */
	private static formatTokens(n: number): string {
		if (n >= 1_000_000) { return `${Math.round(n / 100_000) / 10}M`; }
		if (n >= 10_000) { return `${Math.round(n / 1000)}K`; }
		if (n >= 1000) { return `${Math.round(n / 100) / 10}K`; }
		return String(n || 0);
	}

	/** Native footer: status/model, account quota and conversation context are separate indicators. */
	private updateStatusbar(): void {
		const model = this._statusModel || this._statusProvider || '—';
		const statusDocument = this._container ? getWindow(this._container).document : document;
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
			text: this._busy ? '$(loading~spin) Trabajando…' : model,
			ariaLabel: this._busy ? 'OpenIDE Agent: trabajando' : `OpenIDE Agent: ${model}`,
			tooltip: `OpenIDE Agent — ${this._statusProvider || 'sin proveedor'}${this._statusModel ? `\n${this._statusModel}` : ''}`,
			command: 'workbench.view.openideChat.view.focus',
			content: this._statusBrandIcon,
		} : {
			name: 'OpenIDE Agent',
			text: '$(plug) Conectar proveedor de IA',
			ariaLabel: 'OpenIDE Agent: sin proveedor conectado',
			tooltip: 'No hay proveedor de IA conectado — abrí la página de proveedores para conectar una cuenta o API key.',
			command: 'openide.agent.openProviders',
			content: this._statusBrandIcon,
		};
		// The model already lives in the composer chip: the status bar only keeps the "connect a
		// provider" call to action and the working spinner.
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

		// With no provider connected there is NO context bar: showing "0/1050K" for a model that
		// cannot answer is noise. The limit is recomputed on connect/model change.
		if (!this._statusConnected && !this._busy) {
			this._ctxEntry.clear();
			return;
		}

		const total = this._ctx.used || (this._ctx.input + this._ctx.output);
		const limit = this._ctx.limit;
		const pct = limit ? Math.min(100, Math.round(total / limit * 100)) : 0;
		// `# 84K`: the number alone; limit, percentage and the caveat go to the tooltip.
		const label = OpenideChatViewPane.formatTokens(total);
		const color: ThemeColor = pct >= 95 ? { id: 'errorForeground' }
			: pct > 80 ? { id: 'editorError.foreground' }
				: pct >= 50 ? { id: 'editorWarning.foreground' }
					: { id: 'charts.green' };
		const ctx: IStatusbarEntry = {
			name: 'OpenIDE Agent: contexto',
			text: `$(symbol-numeric) ${label}`,
			ariaLabel: 'Uso de contexto del agente',
			tooltip: limit
				? `Contexto: ${total.toLocaleString()} / ${limit.toLocaleString()} tokens (${pct}%)`
				: `Contexto usado: ${total.toLocaleString()} tokens. El proveedor no publica un límite verificable para este modelo.`,
			command: 'openide.agent.showContext',
			color: limit && pct >= 50 ? color : undefined,
		};
		if (this._ctxEntry.value) {
			this._ctxEntry.value.update(ctx);
		} else {
			this._ctxEntry.value = this.statusbarService.addEntry(ctx, 'openide.agent.context', StatusbarAlignment.RIGHT, 100.5);
		}
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
		await this.notifyTaskComplete(event.failed, t('cliChanges.finished', name), body);
	}

	private async notifyTaskComplete(hadError: boolean, title?: string, body?: string): Promise<void> {
		if (!this.configurationService.getValue('openide.agent.notifications.enabled')) {
			return;
		}
		if (!this.configurationService.getValue('openide.agent.notifications.onTaskComplete')) {
			return;
		}
		if (!this._container) {
			return;
		}
		const targetWindow = getWindow(this._container);
		const suppressWhenFocused = this.configurationService.getValue('openide.agent.notifications.suppressWhenFocused') !== false;
		const isFocused = targetWindow.document.hasFocus();
		if (suppressWhenFocused && isFocused) {
			return;
		}
		if (this.configurationService.getValue('openide.agent.notifications.sound') !== false) {
			void this.accessibilitySignalService.playSignal(hadError ? AccessibilitySignal.taskFailed : AccessibilitySignal.taskCompleted);
		}
		if (!isFocused) {
			await this.hostService.focus(targetWindow, { mode: FocusMode.Notify });
		}
		await this.hostService.showToast({
			title: title ?? (hadError ? 'Agente IA: la tarea falló' : 'Agente IA: tarea terminada'),
			body: body ?? 'Volvé al chat para ver la respuesta.',
		}, CancellationToken.None);
	}

	override dispose(): void {
		super.dispose();
	}
}
