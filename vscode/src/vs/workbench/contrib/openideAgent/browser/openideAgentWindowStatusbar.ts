/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, clearNode, getWindow } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IStatusbarEntryContainer } from '../../../browser/parts/statusbar/statusbarPart.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { clampUsedPercent, tightestUsageWindow } from '../common/openideUsageSchedule.js';
import { t } from '../common/openideStrings.js';
import { OpenideChatWidget } from './chat/openideChatWidget.js';
import { resolveAgentWindowEnvironment } from './openideAgentWindowEnvironment.js';
import { createProviderIcon } from './openideProviderIcons.js';
import { IOpenideUsageMonitor } from './openideUsageMonitor.js';
import { OpenideUsagePopover } from './openideUsagePopover.js';

export interface IAgentWindowStatusbarActions {
	openEnvironment(): void;
	openTerminal(): void;
	openBrowser(): void;
}

/** Native status entries over the shared usage/terminal services; no extra polling or runtime. */
export class OpenideAgentWindowStatusbar extends Disposable {
	private readonly entries = new Map<string, IStatusbarEntryAccessor>();
	private readonly roster = $('span.openide-agent-footer-usage');
	private readonly popover: OpenideUsagePopover;
	private readonly commands = new Map<string, string>();

	constructor(
		private readonly container: IStatusbarEntryContainer,
		private readonly document: Document,
		private readonly source: OpenideChatWidget,
		actions: IAgentWindowStatusbarActions,
		@IOpenideUsageMonitor private readonly usage: IOpenideUsageMonitor,
		@IContextViewService context: IContextViewService,
		@ICommandService commands: ICommandService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@ITerminalService private readonly terminals: ITerminalService,
	) {
		super();
		this.popover = this._register(new OpenideUsagePopover(usage, context, commands));
		const handlers: Record<string, () => void> = { environment: actions.openEnvironment, terminal: actions.openTerminal, browser: actions.openBrowser, usage: () => this.showUsage(), refresh: () => { void usage.refresh('manual'); } };
		for (const [name, run] of Object.entries(handlers)) {
			const id = `openide.agent.footer.${getWindow(document.body).vscodeWindowId}.${name}`;
			this.commands.set(name, id);
			this._register(CommandsRegistry.registerCommand(id, run));
		}
		this._register(usage.onDidChange(() => this.render()));
		this._register(source.sessionStore.onDidChange(() => this.render()));
		this._register(terminals.onDidChangeInstances(() => this.render()));
		this._register(workspace.onDidChangeWorkspaceFolders(() => this.render()));
		this._register(addDisposableListener(getWindow(document.body), 'resize', () => this.render()));
		this.render();
	}

	private showUsage(): void {
		const anchor = this.document.getElementById('openide.agent.usage');
		if (anchor) { this.popover.show(anchor, ''); }
	}

	private update(id: string, entry: IStatusbarEntry, alignment: StatusbarAlignment, priority: number): void {
		const existing = this.entries.get(id);
		if (existing) { existing.update(entry); }
		else { this.entries.set(id, this.container.addEntry(entry, id, alignment, priority)); }
	}

	private render(): void {
		const width = getWindow(this.document.body).innerWidth;
		const compact = width < 1000;
		const snapshot = this.usage.getSnapshot();
		const roster = this.roster;
		clearNode(roster);
		const accounts = snapshot.enabled ? snapshot.accounts : [];
		// Keep the roster stable while quota ordering changes; overflow still opens the full roster.
		const sorted = [...accounts].sort((a, b) => a.entry.label.localeCompare(b.entry.label));
		const visible = sorted.slice(0, width < 700 ? 1 : compact ? 2 : 4);
		const descriptions: string[] = [];
		for (const account of visible) {
			const item = $('span');
			item.className = 'openide-agent-footer-account';
			item.append(createProviderIcon(this.document, account.entry.id, account.entry.label, 'openide-agent-footer-provider'));
			const percent = clampUsedPercent(tightestUsageWindow(account.usage)?.usedPercent);
			const remaining = account.usage?.credits?.remaining;
			const label = percent !== undefined ? `${percent}%` : remaining != null ? `$${remaining.toFixed(2)}` : '—';
			const value = $('span'); value.textContent = label;
			item.append(value);
			if (percent !== undefined && !compact) {
				const meter = $('span'); meter.className = 'openide-agent-footer-meter'; meter.setAttribute('aria-hidden', 'true');
				const fill = $('span.openide-usage-bar-fill'); fill.style.width = `${percent}%`; fill.classList.toggle('warn', percent >= 60 && percent < 80); fill.classList.toggle('danger', percent >= 80); meter.append(fill); item.append(meter);
			}
			item.classList.toggle('stale', account.staleness !== 'fresh');
			roster.append(item);
			descriptions.push(`${account.entry.label}: ${label}`);
		}
		if (sorted.length > visible.length) { const more = $('span'); more.textContent = `+${sorted.length - visible.length}`; roster.append(more); }
		const usageLabel = t('chatSurface.usage.title');
		if (!visible.length) { roster.textContent = usageLabel; }
		this.update('openide.agent.usage', { name: usageLabel, text: usageLabel, content: roster, ariaLabel: [usageLabel, ...descriptions].join('\n'), tooltip: [usageLabel, ...descriptions].join('\n'), command: this.commands.get('usage') }, StatusbarAlignment.LEFT, 100);
		this.update('openide.agent.footer.refresh', { name: t('chatSurface.usage.refresh'), text: snapshot.fetching ? '$(loading~spin)' : '$(loading)', ariaLabel: t('chatSurface.usage.refresh'), tooltip: t('chatSurface.usage.refresh'), command: snapshot.fetching ? undefined : this.commands.get('refresh') }, StatusbarAlignment.LEFT, 99);
		const session = this.source.sessionStore.metaOf(this.source.sessionStore.activeSessionId());
		const environment = resolveAgentWindowEnvironment(session, this.workspace.getWorkspace().folders, []);
		const project = environment.folder?.name || (environment.cwd ? basename(environment.cwd) : t('agentWindow.workspace'));
		const environmentLabel = t('agentWindow.environment');
		this.update('openide.agent.footer.environment', { name: environmentLabel, text: `$(folder)${compact ? '' : ` ${project}`}`, ariaLabel: `${environmentLabel}: ${project}`, tooltip: environment.cwd?.fsPath || environmentLabel, command: this.commands.get('environment') }, StatusbarAlignment.RIGHT, 90);
		const count = this.terminals.instances.filter(instance => !instance.isDisposed && !instance.shellLaunchConfig.hideFromUser).length;
		const terminalLabel = t('agentWindow.terminal');
		this.update('openide.agent.footer.terminal', { name: terminalLabel, text: `$(terminal) ${count}`, ariaLabel: `${terminalLabel}: ${count}`, tooltip: terminalLabel, command: this.commands.get('terminal') }, StatusbarAlignment.RIGHT, 89);
		const browserLabel = t('agentWindow.browser');
		this.update('openide.agent.footer.browser', { name: browserLabel, text: `$(globe)${compact ? '' : ` ${browserLabel}`}`, ariaLabel: browserLabel, tooltip: browserLabel, command: this.commands.get('browser') }, StatusbarAlignment.RIGHT, 88);
	}

	override dispose(): void {
		this.popover.closeForDocument(this.document);
		for (const entry of this.entries.values()) { entry.dispose(); }
		this.entries.clear();
		super.dispose();
	}
}
