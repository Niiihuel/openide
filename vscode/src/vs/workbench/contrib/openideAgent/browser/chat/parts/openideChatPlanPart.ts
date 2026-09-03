/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { AnchorPosition } from '../../../../../../base/browser/ui/contextview/contextview.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IOpenideChatContent, IOpenideChatPlanContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { OPENIDE_IDE_PLAN_APPROVE, OPENIDE_IDE_PLAN_REJECT } from '../../openideIdePlanReview.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setupChatTooltip } from '../openideChatHover.js';
import { appendKbd, PRIMARY_ENTER_HINT } from '../openideChatKbd.js';
import { createMenuContent, createMenuRow, OpenideComposerPopover } from '../openideComposerMenu.js';
import { setOpenideChatShimmer } from './openideChatActivityRow.js';
import { openOpenideChatPlan, rejectOpenideChatPlan, resolveOpenideChatPlanUri } from './openideChatPlanActions.js';
import { parseOpenideChatPlan, pendingTasksLabel } from './openideChatPlanParse.js';
import '../media/openideChatPlan.css';

export const OPENIDE_CHAT_PLAN_WRAP_CLASS = 'openide-chat-plan-wrap';

/** Same hint the plan editor prints on its Build button. */

/** Once the user has answered, the card stops offering the answer again. */
type PlanResolution = 'pending' | 'building' | 'rejected';

/**
 * The plan card: review and approve a saved plan without leaving the transcript.
 *
 * One card, four stacked blocks — label, title, description, tasks — and ONE row of actions under
 * them. The draft (`state === 'draft'`) paints the SAME shell with a skeleton where the description
 * goes, which is the point: when the plan closes, the finished card does not appear out of
 * nowhere, the one you were already reading fills in.
 *
 * Every affordance on the card leads to the plan editor. The card summarises — title, first
 * paragraph, checkboxes — and is not a markdown viewer: rendering the whole document inline would
 * put an unbounded block in a row of a `supportDynamicHeights` list, and the editor already
 * renders it. The file name is not printed either: the title's hover carries the path, and the
 * copy affordance the old head had is one click away in that editor.
 */
export class OpenideChatPlanPart extends OpenideChatContentPart {

	/** The chevron's menu: the secondary decisions Cursor keeps behind Build's dropdown. */
	private readonly _more: OpenideComposerPopover;

	readonly domNode: HTMLElement;

	private readonly _label: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _footer: HTMLElement;

	/**
	 * The draft's own nodes, kept alive between renders.
	 *
	 * A draft re-renders on every streamed delta, and rebuilding the skeleton threw its shimmer
	 * back to frame zero each time — the bars looked like they were animating at a few frames a
	 * second because they were being replaced faster than one sweep could finish. Only the title
	 * text actually changes while the plan streams, so only the title text is written.
	 */
	private _draftTitle: HTMLElement | undefined;

	/**
	 * Listeners of the nodes that body and footer throw away whenever they repaint.
	 *
	 * NOT the base class's `addDisposable`: the renderer parks its own height subscription there
	 * (openideChatResponseRenderer.ts:168-170), so clearing that store from inside a part would
	 * silently unsubscribe the list from this row's height changes.
	 */
	private readonly _bodyStore = this._register(new DisposableStore());
	private readonly _footerStore = this._register(new DisposableStore());

	private _content: IOpenideChatPlanContent;
	private _resolution: PlanResolution = 'pending';

	constructor(
		content: IOpenideChatPlanContent,
		_context: IOpenideChatContentPartContext,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
		@ICommandService private readonly _commandService: ICommandService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IFileService private readonly _fileService: IFileService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IContextViewService contextViewService: IContextViewService,
	) {
		super();
		this._more = this._register(new OpenideComposerPopover(contextViewService));

		this._content = content;
		this.domNode = $(`div.${OPENIDE_CHAT_PLAN_WRAP_CLASS}`);
		const card = append(this.domNode, $('div.openide-chat-plan-card'));

		// The label lives INSIDE the card, above the title, the way Cursor's "Created Plan" does:
		// outside the border it read as a transcript status line that happened to sit near a card.
		this._label = append(card, $('div.openide-chat-plan-label'));
		this._body = append(card, $('div.openide-chat-plan-body'));
		this._footer = append(card, $('div.openide-chat-plan-footer'));

		// A build launched from anywhere (this card, the plan editor's own button) must be reflected
		// here, or two surfaces for the same plan disagree about whether it is already running.
		this._register(this._agentService.onDidChangePlanBuild(event => this._onBuildStateChanged(event.resource)));

		this._syncResolutionFromService();
		this._render();
	}

	private get _planUri(): URI | undefined {
		return resolveOpenideChatPlanUri(this._contextService, this._content.planId);
	}

	private _syncResolutionFromService(): void {
		const uri = this._planUri;
		if (uri && this._resolution !== 'rejected' && this._agentService.isPlanBuildRunning(uri)) {
			this._resolution = 'building';
		}
	}

	private _onBuildStateChanged(resource: URI): void {
		const uri = this._planUri;
		if (!uri || uri.toString() !== resource.toString() || this._resolution === 'rejected') {
			return;
		}
		this._resolution = this._agentService.isPlanBuildRunning(uri) ? 'building' : this._resolution;
		this._renderFooter();
		this._onDidChangeHeight.fire();
	}

	private _render(): void {
		const draft = this._content.state === 'draft';

		// Three labels, one per origin: still streaming, ours and finished, or written by an
		// external agent — whose plan we did not "create", so the card only says what it is.
		this._label.textContent = draft
			? t('chat.plan.labelDraft')
			: this._content.external ? t('chat.plan.label') : t('chat.plan.labelCreated');
		setOpenideChatShimmer(this._label, draft);

		this._renderBody(draft);
		this._renderFooter();
	}

	private _renderBody(draft: boolean): void {
		const parsed = parseOpenideChatPlan(this._content.body.value);
		// The title arrives before the body does, so the draft shows the real one and fakes only
		// what it does not have yet.
		const titleText = parsed.title || this._content.title || t('chat.plan.label');

		if (draft) {
			// Built once and then only written to. Recreating these nodes is what restarted the
			// skeleton's animation on every delta.
			if (!this._draftTitle) {
				clearNode(this._body);
				this._bodyStore.clear();
				this._draftTitle = this._appendTitle();
				const skeleton = append(this._body, $('div.openide-chat-plan-sk.openide-chat-sk'));
				for (const width of ['w90', 'w76', 'w55']) {
					append(skeleton, $(`div.openide-chat-sk-line.openide-chat-sk-${width}`));
				}
			}
			if (this._draftTitle.textContent !== titleText) {
				this._draftTitle.textContent = titleText;
			}
			return;
		}

		clearNode(this._body);
		this._bodyStore.clear();
		this._draftTitle = undefined;
		this._appendTitle().textContent = titleText;

		if (parsed.desc) {
			const desc = append(this._body, $('div.openide-chat-plan-desc'));
			desc.textContent = parsed.desc;
		}

		if (!parsed.tasks.length) {
			return;
		}
		const box = append(this._body, $('div.openide-chat-plan-tasks'));
		const boxHead = append(box, $('div.openide-chat-plan-tasks-head'));
		boxHead.textContent = pendingTasksLabel(parsed.tasks);
		for (const task of parsed.tasks) {
			const row = append(box, $(`div.openide-chat-plan-task${task.done ? '.openide-chat-plan-task-done' : ''}`));
			append(row, $(`span.codicon.codicon-${task.done ? 'pass-filled' : 'circle-large-outline'}`));
			const text = append(row, $('span.openide-chat-plan-task-text'));
			text.textContent = task.text;
		}
	}

	/**
	 * The title is the card's one link to the file: clicking it opens the plan (from the FIRST
	 * delta, draft included — the editor is already showing that same plan being written, so the
	 * link is never a dead end) and its hover completes it with the path the card was built from.
	 * That path is data the card already stands for, not an accessible name of its own.
	 */
	private _appendTitle(): HTMLElement {
		const title = append(this._body, $('div.openide-chat-plan-title'));
		this._bodyStore.add(setupChatTooltip(this._hoverService, title, () => this._content.planId, { aria: false }));
		this._bodyStore.add(addDisposableListener(title, 'click', () => this._open()));
		return title;
	}

	/**
	 * The footer is rebuilt rather than toggled because approving replaces the buttons with a status
	 * line, and leaving a hidden Build button in the DOM is how a resolved card gets approved twice
	 * by a stray Enter.
	 *
	 * Whatever the state, the actions are ONE right-aligned row: "Ver plan" and the secondary
	 * action as ghost buttons, the primary one filled. The user's report on the previous layout
	 * was exactly that the buttons stacked — a link in the body, buttons in the footer.
	 */
	private _renderFooter(): void {
		clearNode(this._footer);
		// The listeners of the buttons the footer just dropped: keeping them alive would fire
		// callbacks against detached nodes for the rest of the session.
		this._footerStore.clear();

		// The base class always survives: the modifier is what changes, and rewriting `className`
		// wholesale is how a footer ends up styled by nothing at all.
		if (this._content.state === 'draft') {
			this._footer.className = 'openide-chat-plan-footer hidden';
			return;
		}

		if (this._resolution === 'rejected') {
			this._footer.className = 'openide-chat-plan-footer openide-chat-plan-actions openide-chat-plan-status';
			this._footer.textContent = t('chat.plan.rejected');
			return;
		}

		this._footer.className = 'openide-chat-plan-footer openide-chat-plan-actions';
		this._appendGhost(t('ide.planReview.view'), () => this._open());

		// A plan an EXTERNAL agent wrote: it is parked on the answer, and "Build" here would run
		// OUR agent on somebody else's plan. Whoever asked is the one who executes, so the card
		// drives that agent's decision instead — the same commands the review notification uses,
		// so the two surfaces can never disagree about what was decided.
		if (this._content.external) {
			this._appendGhost(t('ide.planReview.reject'), () => {
				this._resolution = 'rejected';
				void this._commandService.executeCommand(OPENIDE_IDE_PLAN_REJECT, this._content.planId);
				this._render();
			});
			const approve = this._appendPrimary('check', t('ide.planReview.approve'));
			this._footerStore.add(addDisposableListener(approve, 'click', () => {
				void this._commandService.executeCommand(OPENIDE_IDE_PLAN_APPROVE, this._content.planId);
			}));
			return;
		}

		if (this._resolution === 'building') {
			const building = append(this._footer, $('span.openide-chat-plan-build.openide-chat-plan-build-status'));
			append(building, $('span')).textContent = t('chat.plan.building');
			append(building, $('span.openide-chat-plan-spinner'));
			return;
		}

		// Cursor's row: "View Plan" and a split Build — the word, the shortcut in a quieter tone, and
		// a chevron holding the secondary decision. No play glyph: it read as a media control.
		const split = append(this._footer, $('span.oi-split.openide-chat-plan-split'));
		const build = append(split, $<HTMLButtonElement>('button.oi-split-main', { type: 'button' }));
		append(build, $('span')).textContent = t('chat.plan.build');
		appendKbd(build, PRIMARY_ENTER_HINT);
		this._footerStore.add(addDisposableListener(build, 'click', () => this._build()));
		const more = append(split, $<HTMLButtonElement>('button.oi-split-more', { type: 'button' }));
		append(more, $('span.codicon.codicon-chevron-down'));
		this._footerStore.add(setupChatTooltip(this._hoverService, more, () => t('chat.plan.moreActions')));
		this._footerStore.add(addDisposableListener(more, 'click', () => this._more.toggle(split, {
			anchorPosition: AnchorPosition.BELOW,
			render: (container, store) => {
				const content = createMenuContent(container.ownerDocument);
				container.appendChild(content);
				const reject = createMenuRow(container.ownerDocument, { icon: 'close', label: t('chat.plan.reject') });
				store.add(addDisposableListener(reject, 'click', () => { this._more.close(); this._reject(); }));
				content.appendChild(reject);
			},
		})));
	}

	private _appendGhost(label: string, run: () => void): HTMLButtonElement {
		const button = append(this._footer, $<HTMLButtonElement>('button.openide-chat-plan-ghost', { type: 'button' }));
		button.textContent = label;
		this._footerStore.add(addDisposableListener(button, 'click', run));
		return button;
	}

	private _appendPrimary(icon: string | undefined, label: string): HTMLButtonElement {
		const button = append(this._footer, $<HTMLButtonElement>('button.openide-chat-plan-build', { type: 'button' }));
		if (icon) {
			append(button, $(`span.codicon.codicon-${icon}`));
		}
		append(button, $('span')).textContent = label;
		return button;
	}

	private _open(): void {
		const uri = this._planUri;
		if (uri) {
			openOpenideChatPlan(this._commandService, uri);
		}
	}

	private _build(): void {
		const uri = this._planUri;
		if (!uri) {
			return;
		}
		// Optimistic, and on purpose: `buildPlan` writes frontmatter and then asks the chat to launch
		// the run, so the busy event can be several awaits away. Leaving Build enabled in between is
		// how the same plan gets approved twice.
		this._resolution = 'building';
		this._renderFooter();
		this._onDidChangeHeight.fire();
		this._agentService.buildPlan(uri).catch(error => {
			this._resolution = 'pending';
			this._renderFooter();
			this._onDidChangeHeight.fire();
			this._notificationService.error(error instanceof Error ? error.message : String(error));
		});
	}

	private _reject(): void {
		const uri = this._planUri;
		this._resolution = 'rejected';
		this._renderFooter();
		this._onDidChangeHeight.fire();
		if (uri) {
			void rejectOpenideChatPlan(this._fileService, uri);
		}
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'plan')) {
			return false;
		}
		return other.planId === this._content.planId
			&& other.state === this._content.state
			&& other.title === this._content.title
			&& other.body.value === this._content.body.value;
	}

	/**
	 * Absorbs the growing draft and the draft → final promotion.
	 *
	 * Recreating the part on promotion would be visible: the skeleton would blink out and a new card
	 * would drop in, which is exactly the seam the shared draft shell was written to avoid. A
	 * different `planId` is a different plan and does get its own card.
	 */
	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'plan') || other.planId !== this._content.planId) {
			return false;
		}
		this._content = other;
		this._syncResolutionFromService();
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}
