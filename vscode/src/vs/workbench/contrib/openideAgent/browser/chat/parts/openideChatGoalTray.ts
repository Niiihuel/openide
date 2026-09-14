/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from './../../../common/openideStrings.js';
import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { setupChatTooltip } from '../openideChatHover.js';
import { IDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IOpenideGoal } from '../../../../../../platform/openideAgentHost/common/openideGoal.js';
import { IQuickInputService } from '../../../../../../platform/quickinput/common/quickInput.js';
import { IOpenideGoalService } from '../../openideGoalService.js';
import { IOpenideChatTrayExpansion, registerChatTrayExpansion } from '../openideChatTray.js';
import '../media/openideChatGoal.css';

/** Durable goal projection. State belongs to the service; this tray only issues explicit user actions. */
export class OpenideChatGoalTray extends Disposable {
	readonly domNode: HTMLElement;
	private readonly content: HTMLElement;
	private readonly announcement: HTMLElement;
	private announcementKey = '';
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this.changed.event;
	private readonly rows = this._register(new DisposableStore());
	private sessionId = '';
	private cli = false;
	private cliSupported = false;
	private cliSupportReason: string | undefined;
	private generation = 0;
	private expanded = false;
	private readonly expansion: IOpenideChatTrayExpansion;
	private goal: IOpenideGoal | undefined;
	private creating = false;

	constructor(
		parent: HTMLElement,
		private readonly continueGoal: (sessionId: string, objective: string) => Promise<boolean>,
		@IOpenideGoalService private readonly service: IOpenideGoalService,
		@IQuickInputService private readonly input: IQuickInputService,
		@IDialogService private readonly dialogs: IDialogService,
		@INotificationService private readonly notifications: INotificationService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();
		this.domNode = append(parent, $('section.openide-chat-goal-tray.hidden', { 'aria-label': t('goal.tray') }));
		this.content = append(this.domNode, $('div'));
		this.announcement = append(this.domNode, $('div.monaco-sr-only', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }));
		this.expansion = this._register(registerChatTrayExpansion(parent, expanded => {
			this.expanded = expanded;
			this.render(expanded);
		}));
		this._register(service.onDidChange(event => {
			if (event.sessionId !== this.sessionId) { return; }
			this.generation++;
			this.goal = event.goal;
			this.render();
		}));
	}

	/** Generation guard prevents a slower previous conversation from repainting this one. */
	async setSession(sessionId: string | undefined, cli: boolean, cliSupported = false): Promise<void> {
		this.sessionId = sessionId ?? '';
		this.cli = cli;
		this.cliSupported = cliSupported;
		this.cliSupportReason = undefined;
		this.goal = undefined;
		const generation = ++this.generation;
		this.render();
		if (!sessionId) { return; }
		try {
			const goal = await this.service.get(sessionId);
			if (generation !== this.generation || this._store.isDisposed) { return; }
			this.goal = goal;
			this.render();
		} catch (error) {
			if (generation === this.generation) { this.notifications.error(error instanceof Error ? error : String(error)); }
		}
	}

	setCliSupport(sessionId: string, supported: boolean, reason?: string): void {
		if (sessionId !== this.sessionId) { return; }
		this.cliSupported = supported;
		this.cliSupportReason = reason;
		this.render();
	}

	/** Cancelled input has no effects. The session is captured before either input opens. */
	async createGoal(seed = '', planPath?: string): Promise<boolean> {
		if (this.creating || !this.sessionId) { return false; }
		this.creating = true;
		const sessionId = this.sessionId;
		try {
			const objective = await this.input.input({
				title: t('goal.create'), value: seed,
				prompt: t('goal.objective'),
				validateInput: async value => value.trim() ? undefined : t('goal.required'),
			});
			if (!objective?.trim()) { return false; }
			const criteria = await this.input.input({
				title: t('goal.criteria'),
				prompt: t('goal.criteriaPrompt'),
				placeHolder: t('goal.criteriaExample'),
				validateInput: async value => value.split(';;').some(item => item.trim()) ? undefined : t('goal.criteriaRequired'),
			});
			if (!criteria?.trim()) { return false; }
			const turns = await this.input.input({
				title: t('goal.turnLimit'), value: '20',
				prompt: t('goal.turnLimitPrompt'),
				validateInput: async value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100 ? undefined : t('goal.turnLimitValid'),
			});
			if (!turns) { return false; }
			const goal = await this.service.create(sessionId, objective.trim(), criteria.split(';;').map(item => item.trim()).filter(Boolean), planPath, Number(turns));
			const started = await this.continueGoal(sessionId, goal.objective);
			if (!started) { await this.service.pause(sessionId); }
			return true;
		} finally {
			this.creating = false;
		}
	}

	private async confirmCriterion(sessionId: string, id: string, text: string): Promise<void> {
		const result = await this.dialogs.confirm({
			message: t('goal.confirm'),
			detail: t('goal.confirmDetail', text),
			primaryButton: t('goal.reviewed'),
		});
		if (result.confirmed) { await this.service.confirmCriterion(sessionId, id); }
	}

	private render(animateExpansion = false): void {
		const focused = this.domNode.contains(this.domNode.ownerDocument.activeElement)
			? (this.domNode.ownerDocument.activeElement as HTMLElement).dataset.goalAction : undefined;
		this.rows.clear();
		clearNode(this.content);
		const goal = this.goal;
		this.domNode.classList.toggle('hidden', !goal);
		if (!goal) { this.changed.fire(); return; }
		const verified = goal.criteria.filter(criterion => criterion.verified).length;
		const announcementKey = `${goal.id}:${goal.status}:${verified}:${goal.criteria.length}`;
		if (announcementKey !== this.announcementKey) {
			this.announcementKey = announcementKey;
			this.announcement.textContent = t('goal.announcement', this.status(goal.status), verified, goal.criteria.length);
		}
		const sessionId = this.sessionId;
		const heading = append(this.content, $('div.openide-chat-goal-heading'));
		const toggle = this.button(heading, 'toggle', t('goal.heading', this.status(goal.status)), async () => { this.expansion.setExpanded(!this.expanded); });
		toggle.classList.add('openide-chat-goal-toggle');
		toggle.setAttribute('aria-expanded', String(this.expanded));
		append(heading, $('span.openide-chat-goal-count', undefined, t('goal.count', goal.criteria.filter(criterion => criterion.verified).length, goal.criteria.length)));
		append(this.content, $('div.openide-chat-goal-objective', undefined, goal.objective));
		if (this.expanded) {
			const body = append(this.content, $('div.openide-chat-goal-body'));
			body.classList.toggle('openide-chat-tray-reveal', animateExpansion);
			if (goal.reason) { append(body, $('div.openide-chat-goal-detail', undefined, goal.reason)); }
			append(body, $('div.openide-chat-goal-detail', undefined, t('goal.turns', goal.turns, goal.maxTurns)));
			if (this.cli) {
				append(body, $('div.openide-chat-goal-detail', undefined, this.cliSupported ? t('goal.cliReady') : t('goal.cli')));
				if (this.cliSupportReason) { append(body, $('div.openide-chat-goal-detail', undefined, this.cliSupportReason)); }
			}
			for (const criterion of goal.criteria) {
				const row = append(body, $('div.openide-chat-goal-criterion'));
				append(row, $('span', undefined, `${criterion.verified ? '✓' : '○'} ${criterion.text}`));
				if (!criterion.verified && !criterion.command && goal.status !== 'cancelled' && goal.status !== 'completed') {
					this.button(row, `criterion-${criterion.id}`, t('goal.review'), () => this.confirmCriterion(sessionId, criterion.id, criterion.text));
				}
			}
			const currentEvidenceIds = new Set(goal.criteria.filter(criterion => criterion.verified).flatMap(criterion => criterion.evidenceIds));
			for (const evidence of goal.evidence.filter(item => item.revision === goal.revision && currentEvidenceIds.has(item.id)).slice(-5)) {
				append(body, $('div.openide-chat-goal-detail', undefined, t('goal.evidence', evidence.summary)));
			}
			const latest = goal.reports.at(-1);
			if (latest) { append(body, $('div.openide-chat-goal-detail', undefined, latest.text)); }
			const actions = append(body, $('div.openide-chat-goal-actions'));
			this.button(actions, 'goal', 'GOAL.md', () => this.service.openDocument(sessionId, 'goal'));
			this.button(actions, 'report', 'REPORT.md', () => this.service.openDocument(sessionId, 'report'));
			this.button(actions, 'changes', t('goal.changes'), () => this.service.openChanges(sessionId));
			if (goal.status === 'active') {
				this.button(actions, 'pause', t('goal.pause'), () => this.service.pause(sessionId));
				append(body, $('div.openide-chat-goal-detail', undefined, t('goal.pauseDetail')));
			} else if (goal.status !== 'completed' && goal.status !== 'cancelled') {
				const resume = this.button(actions, 'resume', t('goal.resume'), async () => {
					await this.service.resume(sessionId);
					const resumed = await this.service.get(sessionId);
					if (resumed?.status !== 'active') { return; }
					const started = await this.continueGoal(sessionId, resumed.objective);
					if (!started) { await this.service.pause(sessionId); }
				});
				resume.disabled = this.cli && !this.cliSupported;
			}
			if (goal.status !== 'completed' && goal.status !== 'cancelled') {
				this.button(actions, 'cancel', t('goal.cancel'), () => this.service.cancel(sessionId));
			}
		}
		if (focused) {
			for (const button of this.domNode.querySelectorAll<HTMLButtonElement>('button')) {
				if (button.dataset.goalAction === focused) { button.focus({ preventScroll: true }); break; }
			}
		}
		this.changed.fire();
	}

	private button(parent: HTMLElement, id: string, label: string, action: () => Promise<void>): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button', { type: 'button' }, label));
		button.dataset.goalAction = id;
		this.rows.add(setupChatTooltip(this.hoverService, button, () => label));
		this.rows.add(addDisposableListener(button, 'click', () => {
			button.disabled = true;
			void action().catch(error => this.notifications.error(error instanceof Error ? error : String(error))).finally(() => { button.disabled = false; });
		}));
		return button;
	}

	private status(status: IOpenideGoal['status']): string {
		switch (status) {
			case 'active': return t('goal.active');
			case 'paused': return t('goal.paused');
			case 'blocked': return t('goal.blocked');
			case 'interrupted': return t('goal.interrupted');
			case 'limit_reached': return t('goal.limit');
			case 'failed': return t('goal.failed');
			case 'completed': return t('goal.completed');
			case 'cancelled': return t('goal.cancelled');
		}
	}
}
