/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import {
	formatOpenideChatTokens, IOpenideChatCapabilityCounts, IOpenideChatContextUsage, OPENIDE_CHAT_EMPTY_CAPABILITIES,
	openideChatContextCategories, openideChatContextPercent, openideChatContextSegments, openideChatContextTotal,
} from '../../common/chat/openideChatContextBreakdown.js';
import { t } from '../../common/openideStrings.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { PERMISSIONS, permissionLabel } from './openideChatModePicker.js';
import { createCodicon, createMenuContent, createMenuRow, createMenuSection, OpenideComposerPopover } from './openideComposerMenu.js';

/**
 * The row UNDER the composer card, transcribed from upstream's `.chat-secondary-toolbar`
 * (chat.css:1900) and the status/context-usage containers next to it:
 *
 *   [monitor] Local  |  [shield] <approval policy>                    (ring) 12%
 *
 * - `footerHost` is the left slot. It carries a static "Local" today; the session-type picker
 *   (harness / Claude Code / Codex over a terminal) mounts there — this file does not implement it.
 * - the approvals trigger is the permission policy that already lived behind the mode menu's
 *   submenu, surfaced as text + icon like upstream's "Default Approvals".
 * - the ring is upstream's `ChatContextUsageWidget` (SVG circle, 14px, stroke 4 on a 36 viewBox),
 *   and its click opens a port of `ChatContextUsageDetails` ("Session Info").
 */
/** Upstream's thresholds (`chatContextUsageDetails.ts`): amber at 75%, red at 90%. */
const CONTEXT_WARNING = 75;
const CONTEXT_ERROR = 90;
export class OpenideChatComposerFooter extends Disposable {

	readonly domNode: HTMLElement;
	/** Left slot for the session-type picker; carries a placeholder until something mounts. */
	readonly footerHost: HTMLElement;

	private readonly _permissionLabel: HTMLElement;
	private readonly _ringButton: HTMLButtonElement;
	private readonly _ringArc: SVGCircleElement;
	private readonly _ringPercent: HTMLElement;
	private readonly _permissionPopover: OpenideComposerPopover;
	private readonly _infoPopover: OpenideComposerPopover;
	private readonly _circumference: number;

	private _usage: IOpenideChatContextUsage = { input: 0, output: 0, used: 0, limit: 0 };
	private _capabilities: IOpenideChatCapabilityCounts = OPENIDE_CHAT_EMPTY_CAPABILITIES;

	constructor(
		parent: HTMLElement,
		private readonly agentService: IOpenideAgentService,
		contextViewService: IContextViewService,
		private readonly onCompact: () => void,
	) {
		super();
		const document = parent.ownerDocument;
		this.domNode = append(parent, $('.openide-chat-footer'));

		// ---- left slot
		// Empty by default: the "Local ▾" chip that used to live here was removed — the header's
		// view tabs already name the active agent and `+ ▾` already starts one of another kind, so
		// the chip was a third copy of the same fact. The slot stays for whatever mounts next, and
		// the separator hides itself while it is empty (`:empty + .openide-chat-footer-sep`).
		this.footerHost = append(this.domNode, $('.openide-chat-footer-left'));

		append(this.domNode, $('span.openide-chat-footer-sep'));

		// ---- approvals
		this._permissionPopover = this._register(new OpenideComposerPopover(contextViewService));
		const permission = append(this.domNode, $('button.openide-chat-footer-item.openide-chat-footer-button', { type: 'button' })) as HTMLButtonElement;
		permission.appendChild(createCodicon(document, 'shield'));
		this._permissionLabel = append(permission, $('span'));
		permission.appendChild(createCodicon(document, 'chevron-down', 'openide-composer-chevron'));
		permission.title = t('chat.footer.approvals.tip');
		this._register(addDisposableListener(permission, 'click', () => this._permissionPopover.toggle(permission, {
			className: 'openide-chat-footer-menu',
			render: (container, store) => this._renderPermissions(container, store),
		})));
		this._register(this.agentService.onDidChange(() => this._paintPermission()));
		this._paintPermission();

		append(this.domNode, $('span.openide-chat-footer-spacer'));

		// ---- context ring (upstream chatContextUsageWidget.ts: 36-unit viewBox, radius 14, stroke 4)
		this._infoPopover = this._register(new OpenideComposerPopover(contextViewService));
		this._ringButton = append(this.domNode, $('button.openide-chat-footer-item.openide-chat-footer-button.openide-chat-context-ring', { type: 'button' })) as HTMLButtonElement;
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 36 36');
		svg.classList.add('openide-chat-ring-svg');
		const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		bg.setAttribute('cx', '18'); bg.setAttribute('cy', '18'); bg.setAttribute('r', '14');
		bg.classList.add('openide-chat-ring-bg');
		svg.appendChild(bg);
		this._ringArc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		this._ringArc.setAttribute('cx', '18'); this._ringArc.setAttribute('cy', '18'); this._ringArc.setAttribute('r', '14');
		this._ringArc.classList.add('openide-chat-ring-arc');
		this._circumference = 2 * Math.PI * 14;
		this._ringArc.setAttribute('stroke-dasharray', String(this._circumference));
		this._ringArc.setAttribute('stroke-dashoffset', String(this._circumference));
		svg.appendChild(this._ringArc);
		this._ringButton.appendChild(svg);
		this._ringPercent = append(this._ringButton, $('span.openide-chat-ring-percent'));
		this._register(addDisposableListener(this._ringButton, 'click', () => this.toggleSessionInfo()));
		this._paintRing();
	}

	/**
	 * Public because the ring is not the only way in: the status bar shows the same number and its
	 * `openide.agent.showContext` command has to land somewhere. It used to open a separate panel
	 * over the composer that said the same thing in a second layout; now both doors lead here.
	 */
	toggleSessionInfo(): void {
		this._infoPopover.toggle(this._ringButton, {
			className: 'openide-chat-session-info-menu',
			width: 300,
			render: (container, store) => this._renderSessionInfo(container, store),
		});
	}

	setUsage(usage: IOpenideChatContextUsage, capabilities: IOpenideChatCapabilityCounts): void {
		this._usage = usage;
		this._capabilities = capabilities;
		this._paintRing();
		if (this._infoPopover.isOpen && this._infoPopover.container) {
			this._renderSessionInfo(this._infoPopover.container, new DisposableStore());
		}
	}

	private _paintPermission(): void {
		this._permissionLabel.textContent = permissionLabel(this.agentService.getPermissionMode());
	}

	private _renderPermissions(container: HTMLElement, store: DisposableStore): void {
		const document = container.ownerDocument;
		const content = createMenuContent(document);
		container.appendChild(content);
		content.appendChild(createMenuSection(document, t('chat.footer.approvals')));
		const current = this.agentService.getPermissionMode() || 'ask';
		for (const entry of PERMISSIONS) {
			const row = createMenuRow(document, { icon: entry.id === current ? 'check' : entry.icon, label: entry.label, tooltip: entry.description });
			store.add(addDisposableListener(row, 'click', () => {
				this._permissionPopover.close();
				void this.agentService.setPermissionMode(entry.id);
			}));
			content.appendChild(row);
		}
	}

	private _paintRing(): void {
		const percent = openideChatContextPercent(this._usage);
		const offset = this._circumference * (1 - Math.max(0, Math.min(100, percent)) / 100);
		this._ringArc.setAttribute('stroke-dashoffset', String(offset));
		this._ringPercent.textContent = `${percent}%`;
		this._ringButton.classList.toggle('warning', percent >= 80 && percent < 95);
		this._ringButton.classList.toggle('error', percent >= 95);
		this._ringButton.title = t('chat.footer.context.tip');
	}

	/**
	 * Upstream `ChatContextUsageDetails` ("Session Info"), transcribed block for block: header,
	 * session cost, the context-window quota with its bar, the category breakdown, the quality
	 * warning past 75% and the actions bar at the bottom.
	 *
	 * Two deliberate differences, both because the data is ours and not Copilot's:
	 *  - "session cost" is stated in TOKENS. We have no price, and upstream hides that section
	 *    entirely when it has no cost — a row of tokens is the honest equivalent, not an invention.
	 *  - upstream's "Reserved for response" stripe is NOT drawn: no provider we speak to reports a
	 *    reserved-output figure, and a striped band sized from a guess would be a lie in a panel
	 *    whose whole job is to be exact.
	 *
	 * What we add over upstream, because we have it and it is actionable: the per-segment counts
	 * (how many tools / MCP servers / skills are behind that percentage) and an "unclassified"
	 * remainder so the rows actually add up to the ring.
	 */
	private _renderSessionInfo(container: HTMLElement, store: DisposableStore): void {
		clearNode(container);
		const root = append(container, $('.openide-chat-session-info'));
		append(root, $('div.openide-chat-si-header', undefined, t('chat.session.info')));

		// Session cost (tokens: entrada · salida)
		const cost = append(root, $('.openide-chat-si-cost'));
		const costRow = append(cost, $('.openide-chat-si-row'));
		append(costRow, $('span.openide-chat-si-label', undefined, t('chat.session.cost')));
		append(costRow, $('span.openide-chat-si-value', undefined, t('chat.session.cost.tokens', formatOpenideChatTokens(this._usage.input || 0), formatOpenideChatTokens(this._usage.output || 0))));

		// Context window
		append(root, $('div.openide-chat-si-header', undefined, t('chat.session.context')));
		const quota = append(root, $('.openide-chat-si-quota'));
		const percent = openideChatContextPercent(this._usage);
		quota.classList.toggle('warning', percent >= CONTEXT_WARNING && percent < CONTEXT_ERROR);
		quota.classList.toggle('error', percent >= CONTEXT_ERROR);
		const total = openideChatContextTotal(this._usage);
		const limit = this._usage.limit;
		const label = append(quota, $('.openide-chat-si-quota-label'));
		append(label, $('span', undefined, limit ? `${formatOpenideChatTokens(total)} / ${formatOpenideChatTokens(limit)} tokens` : `${formatOpenideChatTokens(total)} tokens`));
		append(label, $('span.openide-chat-si-quota-value', undefined, `${percent}%`));
		const bar = append(quota, $('.openide-chat-si-bar'));
		const fill = append(bar, $('.openide-chat-si-bit'));
		fill.style.width = `${percent}%`;
		if (percent >= CONTEXT_WARNING) {
			append(root, $('div.openide-chat-si-description', undefined, t('chat.session.warning')));
		}

		this._renderBreakdown(root, percent);

		// Actions — upstream's `.actions-section`: a full-width secondary button bar.
		const actions = append(root, $('.openide-chat-si-actions'));
		const compact = store.add(new Button(actions, { ...defaultButtonStyles, secondary: true }));
		compact.label = t('chat.session.compact');
		compact.element.title = t('chat.session.compact.tip');
		store.add(compact.onDidClick(() => {
			this._infoPopover.close();
			this.onCompact();
		}));
	}

	/**
	 * Upstream's `renderTokenDetails`. The grouping, the 0.05% cut and the remainder row live in
	 * `openideChatContextCategories` (pure, tested); this only paints what it returns.
	 */
	private _renderBreakdown(root: HTMLElement, contextPercent: number): void {
		const categories = openideChatContextCategories(openideChatContextSegments(this._usage, this._capabilities), contextPercent);
		if (!categories.length) {
			return;
		}
		const titles = { system: t('chat.session.system'), user: t('chat.session.user'), other: t('chat.session.other') };
		const details = append(root, $('.openide-chat-si-details'));
		for (const category of categories) {
			const block = append(details, $('.openide-chat-si-category'));
			append(block, $('div.openide-chat-si-category-header', undefined, titles[category.id]));
			for (const row of category.rows) {
				const line = append(block, $('.openide-chat-si-detail'));
				const name = append(line, $('span.openide-chat-si-label', undefined, category.id === 'other' ? t('chat.session.unclassified') : row.label));
				if (row.count) {
					append(name, $('span.openide-chat-si-count', undefined, ` · ${row.count}`));
				}
				append(line, $('span.openide-chat-si-value', undefined, `${row.percent.toFixed(1)}%`));
			}
		}
	}
}
