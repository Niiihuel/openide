/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the account-usage popover, transcribed from Orca's UsageRosterPanel
 *  (its status-bar roster panel): one block per account
 *  with logo · name · plan on the first line, the tightest reset on the right, then the windows as
 *  label + bar + percentage, "updated N ago" next to the refresh button, and two navigation rows
 *  at the bottom. It only SUBSCRIBES: the numbers, the polling and the backoff live in
 *  IOpenideUsageMonitor.
 *
 *  The SURFACE is not its own. It is the product's popover — the `.openide-menu` family every
 *  native picker in the composer and the header already draws (chat/media/openideChatMenus.css):
 *  same background, border, radius, shadow, section label and row anatomy. What stays here is only
 *  what the roster actually invents — the account block and the usage bars — expressed with the
 *  `--oi-*` tokens of openideSurfaceCss.ts. This popover used to carry a private copy of the
 *  surface (its own border, its own shadow, its own row hover, `rgba(128,128,128,.14)` hairlines
 *  hardcoded) which is exactly the drift the shared stylesheet exists to prevent.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, isHTMLElement } from '../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { AnchorPosition } from '../../../../base/common/layout.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextViewService, IOpenContextView } from '../../../../platform/contextview/browser/contextView.js';
import { IRateLimitWindow, usageStatusOf } from '../common/openideUsage.js';
import { clampUsedPercent, formatUsageCredits, formatUsageReset, formatUsageUpdatedAgo, tightestUsageWindow, usageWindowTitle } from '../common/openideUsageSchedule.js';
import { menuIcon, menuRow } from './chat/openideChatMenuDom.js';
import { createProviderIcon } from './openideProviderIcons.js';
import { applyOpenideSurfaceCss } from './openideSurfaceStyle.js';
import { IOpenideUsageAccount, IOpenideUsageMonitor, IOpenideUsageSnapshot } from './openideUsageMonitor.js';
import { t } from '../common/openideStrings.js';

export class OpenideUsagePopover extends Disposable {

	private contextView: IOpenContextView | undefined;
	private list: HTMLElement | undefined;
	private scrollable: DomScrollableElement | undefined;
	private updated: HTMLElement | undefined;
	private refreshButton: HTMLButtonElement | undefined;
	private activeProviderId = '';
	private tick: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly monitor: IOpenideUsageMonitor,
		private readonly contextViewService: IContextViewService,
		private readonly commandService: ICommandService,
	) {
		super();
	}

	show(anchor: HTMLElement, activeProviderId: string): void {
		if (this.contextView) {
			this.contextView.close();
			return;
		}
		this.activeProviderId = activeProviderId;
		this.contextView = this.contextViewService.showContextView({
			getAnchor: () => anchor,
			anchorAlignment: AnchorAlignment.RIGHT,
			anchorPosition: AnchorPosition.ABOVE,
			// The context view's own dismissal tests the workbench CONTAINER, not the view
			// (contextview.ts:283), so every click inside the IDE counted as "inside" and the roster
			// stayed open over whatever the user clicked next. Same handler the composer's pickers
			// carry; the anchor is excluded so its own click toggles instead of racing this close.
			onDOMEvent: event => this.onDOMEvent(event, anchor),
			render: container => this.render(container),
			onHide: () => {
				this.contextView = undefined;
				this.list = undefined;
				this.scrollable = undefined;
				this.updated = undefined;
				this.refreshButton = undefined;
				if (this.tick) { clearInterval(this.tick); this.tick = undefined; }
			},
		});
	}

	private render(container: HTMLElement): DisposableStore {
		const store = new DisposableStore();
		// The `--oi-*` tokens live in a stylesheet a surface installs on demand. The roster can be
		// opened from the status bar with the chat dock never having been opened, so it cannot
		// assume somebody else already asked for them. Idempotent by design.
		applyOpenideSurfaceCss();
		// The context view forces `width: initial` inline on its container, so the sized surface
		// has to be a child of it, not the container itself.
		const host = container;
		container = append(host, $('.openide-menu.openide-usage-menu'));
		container.setAttribute('role', 'dialog');
		container.setAttribute('aria-label', localize('openide.usage.title', "Uso"));

		// `.openide-menu-section` is the family's small muted heading; the freshness line and the
		// refresh action ride in it instead of in a header of this popover's own invention.
		const header = append(container, $('.openide-menu-section.openide-usage-header'));
		append(header, $('span.openide-usage-header-title', undefined, localize('openide.usage.title', "Uso")));
		this.updated = append(header, $('span.openide-usage-updated'));
		this.refreshButton = append(header, $('button.openide-usage-refresh', { type: 'button', title: localize('openide.usage.refresh', "Actualizar ahora") })) as HTMLButtonElement;
		append(this.refreshButton, menuIcon('refresh'));
		store.add(addDisposableListener(this.refreshButton, 'click', () => void this.monitor.refresh('manual')));

		this.list = $('.openide-usage-list');
		this.scrollable = store.add(new DomScrollableElement(this.list, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false, verticalScrollbarSize: 8 }));
		this.scrollable.getDomNode().classList.add('openide-usage-scroll');
		append(container, this.scrollable.getDomNode());

		// The two navigation rows ARE menu rows: same height, same hover, same icon gutter as every
		// other popover in the product. Only the trailing chevron is added on top.
		const footer = append(container, $('.openide-usage-footer'));
		const addFooterAction = (icon: string, label: string, command: string): void => {
			const { row } = menuRow(icon, label);
			append(row, menuIcon('chevron-right')).classList.add('openide-usage-footer-chevron');
			append(footer, row);
			store.add(addDisposableListener(row, 'click', () => {
				this.contextView?.close();
				void this.commandService.executeCommand(command);
			}));
		};
		addFooterAction('graph', localize('openide.usage.details', "Detalles de uso"), 'openide.agent.openProviders');
		addFooterAction('account', localize('openide.usage.accounts', "Administrar cuentas…"), 'openide.agent.openProviders');

		// Live while open: the monitor switches to its visible cadence and every change repaints.
		store.add(this.monitor.holdVisible());
		store.add(this.monitor.onDidChange(snapshot => this.renderSnapshot(snapshot)));
		this.renderSnapshot(this.monitor.getSnapshot());
		// "hace 12 s" has to move on its own; the numbers do not change, the clock does.
		this.tick = setInterval(() => this.renderUpdated(this.monitor.getSnapshot()), 5_000);
		return store;
	}

	/** Escape and click-outside, the same contract the rest of the `.openide-menu` family honours. */
	private onDOMEvent(event: Event, anchor: HTMLElement): void {
		if (event.type === 'keydown') {
			if ((event as KeyboardEvent).key === 'Escape') { this.contextView?.close(); }
			return;
		}
		if (event.type !== 'click') { return; }
		const target = event.target;
		if (isHTMLElement(target) && (this.contextViewService.getContextViewElement().contains(target) || anchor.contains(target))) {
			return;
		}
		this.contextView?.close();
	}

	private renderUpdated(snapshot: IOpenideUsageSnapshot): void {
		if (!this.updated) { return; }
		this.updated.textContent = snapshot.fetching
			? localize('openide.usage.updating', "actualizando…")
			: snapshot.updatedAt
				? localize('openide.usage.updatedAgo', "actualizado {0}", formatUsageUpdatedAgo(snapshot.updatedAt))
				: '';
		this.refreshButton?.classList.toggle('loading', snapshot.fetching);
		this.refreshButton?.toggleAttribute('disabled', snapshot.fetching);
	}

	private renderSnapshot(snapshot: IOpenideUsageSnapshot): void {
		if (!this.list) { return; }
		this.renderUpdated(snapshot);
		clearNode(this.list);
		if (!snapshot.enabled) {
			append(this.list, $('.openide-menu-empty.openide-usage-empty', undefined, t('usage.disabled')));
		} else if (!snapshot.accounts.length) {
			append(this.list, $('.openide-menu-empty.openide-usage-empty', undefined, snapshot.fetching
				? localize('openide.usage.loading', "Consultando las cuentas…")
				: localize('openide.usage.noAccounts', "No hay cuentas conectadas.")));
		} else {
			for (const account of snapshot.accounts) {
				this.list.appendChild(this.renderAccount(account));
			}
		}
		this.scrollable?.scanDomNode();
		// Anchored by measuring at render time, when the list was still "Consultando…": re-anchor
		// with the final height (a no-op when closed).
		if (this.contextView) { this.contextViewService.layout(); }
	}

	private renderAccount(account: IOpenideUsageAccount): HTMLElement {
		const row = $('.openide-usage-account');
		row.classList.toggle('active', account.entry.id === this.activeProviderId);
		row.classList.toggle('stale', account.staleness === 'stale');
		const usage = account.usage;
		const status = usageStatusOf(usage);

		const heading = append(row, $('.openide-usage-account-heading'));
		// Flat brand mark, no chip behind it: the roster reads as a list, not as a grid of cards.
		heading.appendChild(createProviderIcon(row.ownerDocument, account.entry.id, account.entry.label, 'openide-usage-provider-logo'));
		const name = append(heading, $('span.openide-usage-account-name'));
		append(name, $('strong', undefined, account.entry.label));
		if (usage?.plan) {
			append(name, $('span.openide-usage-plan', undefined, ` · ${usage.plan}`));
		}
		if (account.alsoFrom.length) {
			// The folded rows are named, not hidden: the user connected that CLI and has to be able
			// to see that its quota is this row, rather than wonder where it went.
			const also = append(name, $('span.openide-usage-plan.openide-usage-also', undefined, ` · ${t('usage.alsoFrom', account.alsoFrom.join(', '))}`));
			also.title = t('usage.alsoFromTitle', account.alsoFrom.join(', '));
		}
		const tightest = tightestUsageWindow(usage);
		if (account.fetching) {
			append(heading, $('span.openide-usage-account-trailing')).appendChild($('span.codicon.codicon-loading.codicon-modifier-spin'));
		}

		if (status === 'ok' && usage) {
			const windows = append(row, $('.openide-usage-windows'));
			for (const window of usage.windows) { windows.appendChild(this.renderWindow(window)); }
			if (tightest) {
				const reset = formatUsageReset(tightest.resetsAt);
				if (reset) { append(windows, $('.openide-usage-reset', undefined, reset)); }
			}
			if (usage.credits) {
				const credits = usage.credits;
				const line = append(windows, $('.openide-usage-metric.openide-usage-credits'));
				append(line, $('span.openide-usage-window-label', undefined, localize('openide.usage.balance', "Saldo")));
				const text = credits.remaining != null
					? formatUsageCredits(credits.remaining, credits.currency) + (credits.total != null ? ` / ${formatUsageCredits(credits.total, credits.currency)}` : '')
					: credits.used != null ? localize('openide.usage.spent', "{0} gastados", formatUsageCredits(credits.used, credits.currency)) : '—';
				append(line, $('span.openide-usage-credits-value', undefined, text));
			}
			if (account.staleness === 'stale') {
				append(row, $('.openide-usage-note', undefined, t('usage.stale')));
			}
			if (usage.error) {
				// A good snapshot kept over a failing refetch: say both (Orca keeps stale over blank).
				append(row, $('.openide-usage-note.error', undefined, usage.error));
			}
		} else if (status === 'unavailable') {
			append(row, $('.openide-usage-note', undefined, `${localize('openide.usage.noData', "Sin datos de uso")} · ${usage?.error ?? ''}`));
		} else if (usage) {
			const note = append(row, $('.openide-usage-note.error', undefined, usage.error ?? t('usage.failed')));
			if (usage.retryAt && usage.retryAt > Date.now()) {
				note.textContent += ` · ${localize('openide.usage.retry', "reintenta {0}", formatUsageReset(usage.retryAt)?.replace('se reinicia', '') ?? '')}`;
			}
		} else if (!account.fetching) {
			append(row, $('.openide-usage-note', undefined, t('usage.pending')));
		}
		return row;
	}

	private renderWindow(window: IRateLimitWindow): HTMLElement {
		const metric = $('.openide-usage-metric');
		const label = append(metric, $('span.openide-usage-window-label', undefined, usageWindowTitle(window)));
		label.title = window.label;
		const percent = clampUsedPercent(window.usedPercent);
		const bar = append(metric, $('span.openide-usage-bar'));
		const fill = append(bar, $('span.openide-usage-bar-fill'));
		fill.style.width = `${percent ?? 0}%`;
		fill.classList.toggle('warn', (percent ?? 0) >= 60 && (percent ?? 0) < 80);
		fill.classList.toggle('danger', (percent ?? 0) >= 80);
		append(metric, $('span.openide-usage-percent', undefined, percent === undefined ? '—' : `${percent}%`));
		return metric;
	}

	override dispose(): void {
		this.contextView?.close();
		super.dispose();
	}
}
