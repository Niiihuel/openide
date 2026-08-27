/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IClipboardService } from '../../../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IOpenideChatContent, IOpenideChatPlanContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { OPENIDE_IDE_PLAN_APPROVE, OPENIDE_IDE_PLAN_REJECT } from '../../openideIdePlanReview.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { basenameForChat } from '../../../common/chat/openideChatToolMeta.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setOpenideChatShimmer } from './openideChatActivityRow.js';
import { openOpenideChatPlan, rejectOpenideChatPlan, resolveOpenideChatPlanUri } from './openideChatPlanActions.js';
import { parseOpenideChatPlan, pendingTasksLabel } from './openideChatPlanParse.js';
import '../media/openideChatPlan.css';

export const OPENIDE_CHAT_PLAN_WRAP_CLASS = 'openide-chat-plan-wrap';

/** Same hint the webview prints on the Build button (openideChatHtml.ts:3924). */
const BUILD_SHORTCUT = isMacintosh ? '⌘↩' : 'Ctrl+↩';

/** Once the user has answered, the card stops offering the answer again. */
type PlanResolution = 'pending' | 'building' | 'rejected';

/**
 * The plan card: review and approve a saved plan without leaving the transcript.
 *
 * Transcribed from the webview's `renderPlanCard` (openideChatHtml.ts:3857-3930) and, for
 * `state === 'draft'`, from `renderPlanDraft` (:3829-3853). Both paint the SAME shell
 * (`.plan-wrap` → label → `.plan-card` → head + body), which is the point: when the plan closes,
 * the finished card does not appear out of nowhere, the one you were already reading fills in.
 *
 * The card summarises — title, first paragraph, checkboxes — and every affordance on it leads to
 * the plan editor. It is not a markdown viewer: rendering the whole document inline would put an
 * unbounded block in a row of a `supportDynamicHeights` list, and the editor already renders it.
 */
export class OpenideChatPlanPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _label: HTMLElement;
	private readonly _file: HTMLElement;
	private readonly _copy: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _footer: HTMLElement;

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
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._content = content;
		this.domNode = $(`div.${OPENIDE_CHAT_PLAN_WRAP_CLASS}`);
		this._label = append(this.domNode, $('div.openide-chat-plan-label'));
		const card = append(this.domNode, $('div.openide-chat-plan-card'));

		const head = append(card, $('div.openide-chat-plan-head'));
		append(head, $('span.codicon.codicon-list-tree'));
		this._file = append(head, $('span.openide-chat-plan-file'));
		this._copy = append(head, $('button.openide-chat-plan-icobtn'));
		this._copy.setAttribute('type', 'button');
		this._copy.title = 'Copiar el plan';
		append(this._copy, $('span.codicon.codicon-copy'));

		this._body = append(card, $('div.openide-chat-plan-body'));
		this._footer = append(card, $('div.openide-chat-plan-footer'));

		// The filename is openable from the FIRST delta, draft included: the editor is already
		// showing that same plan being written, so the link is never a dead end.
		this._register(addDisposableListener(this._file, 'click', () => this._open()));
		this._register(addDisposableListener(this._copy, 'click', () => this._copyMarkdown()));
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
		const path = this._content.planId;

		this._label.textContent = draft ? 'Creando plan' : 'Plan preparado';
		setOpenideChatShimmer(this._label, draft);

		this._file.textContent = basenameForChat(path);
		this._file.title = path;
		this._copy.classList.toggle('hidden', draft);

		this._renderBody(draft);
		this._renderFooter();
	}

	private _renderBody(draft: boolean): void {
		clearNode(this._body);
		this._bodyStore.clear();
		const parsed = parseOpenideChatPlan(this._content.body.value);

		const title = append(this._body, $('div.openide-chat-plan-title'));
		// The title arrives before the body does, so the draft shows the real one and fakes only
		// what it does not have yet.
		title.textContent = parsed.title || this._content.title || 'Plan';

		if (draft) {
			const skeleton = append(this._body, $('div.openide-chat-plan-sk'));
			for (const width of ['w90', 'w76', 'w55']) {
				append(skeleton, $(`div.openide-chat-plan-sk-line.openide-chat-plan-sk-${width}`));
			}
			return;
		}

		if (parsed.desc) {
			const desc = append(this._body, $('div.openide-chat-plan-desc'));
			desc.textContent = parsed.desc;
		}

		const readLink = append(this._body, $('button.openide-chat-plan-readlink'));
		readLink.setAttribute('type', 'button');
		readLink.textContent = 'Leer plan detallado';
		this._bodyStore.add(addDisposableListener(readLink, 'click', () => this._open()));

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
	 * The footer is rebuilt rather than toggled because approving replaces the buttons with a status
	 * line — the webview's `planStatusLine` (openideChatHtml.ts:3778-3791) — and leaving a hidden
	 * Build button in the DOM is how a resolved card gets approved twice by a stray Enter.
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
			this._footer.className = 'openide-chat-plan-footer openide-chat-plan-status';
			this._footer.textContent = 'Rechazado';
			return;
		}

		this._footer.className = 'openide-chat-plan-footer openide-chat-plan-actions';

		// A plan an EXTERNAL agent wrote: it is parked on the answer, and "Build" here would run
		// OUR agent on somebody else's plan. Whoever asked is the one who executes, so the card
		// drives that agent's decision instead — the same commands the review notification uses,
		// so the two surfaces can never disagree about what was decided.
		if (this._content.external) {
			const view = append(this._footer, $('button.openide-chat-plan-reject'));
			view.setAttribute('type', 'button');
			view.textContent = t('ide.planReview.view');
			this._footerStore.add(addDisposableListener(view, 'click', () => this._open()));
			append(this._footer, $('span.openide-chat-plan-sp'));
			const discard = append(this._footer, $('button.openide-chat-plan-reject'));
			discard.setAttribute('type', 'button');
			discard.textContent = t('ide.planReview.reject');
			this._footerStore.add(addDisposableListener(discard, 'click', () => {
				this._resolution = 'rejected';
				void this._commandService.executeCommand(OPENIDE_IDE_PLAN_REJECT, this._content.planId);
				this._render();
			}));
			const approve = append(this._footer, $('button.openide-chat-plan-build'));
			approve.setAttribute('type', 'button');
			append(approve, $('span.codicon.codicon-check'));
			append(approve, $('span')).textContent = t('ide.planReview.approve');
			this._footerStore.add(addDisposableListener(approve, 'click', () => {
				void this._commandService.executeCommand(OPENIDE_IDE_PLAN_APPROVE, this._content.planId);
			}));
			return;
		}

		if (this._resolution === 'building') {
			const view = append(this._footer, $('button.openide-chat-plan-reject'));
			view.setAttribute('type', 'button');
			view.textContent = 'Ver plan';
			this._footerStore.add(addDisposableListener(view, 'click', () => this._open()));
			append(this._footer, $('span.openide-chat-plan-sp'));
			const building = append(this._footer, $('span.openide-chat-plan-build.openide-chat-plan-build-status'));
			append(building, $('span')).textContent = 'Building';
			append(building, $('span.openide-chat-plan-spinner'));
			return;
		}

		append(this._footer, $('span.openide-chat-plan-sp'));
		const reject = append(this._footer, $('button.openide-chat-plan-reject'));
		reject.setAttribute('type', 'button');
		reject.textContent = 'Rechazar';
		this._footerStore.add(addDisposableListener(reject, 'click', () => this._reject()));

		const build = append(this._footer, $('button.openide-chat-plan-build'));
		build.setAttribute('type', 'button');
		append(build, $('span.codicon.codicon-play'));
		append(build, $('span')).textContent = 'Build';
		append(build, $('span.openide-chat-plan-kbd')).textContent = BUILD_SHORTCUT;
		this._footerStore.add(addDisposableListener(build, 'click', () => this._build()));
	}

	private _open(): void {
		const uri = this._planUri;
		if (uri) {
			openOpenideChatPlan(this._commandService, uri);
		}
	}

	private _copyMarkdown(): void {
		// Fire and forget, like the webview's `navigator.clipboard.writeText` inside a try/catch: a
		// failed copy is not worth a modal, and the plan is one click away in the editor.
		this._clipboardService.writeText(this._content.body.value).then(undefined, () => { });
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
	 * would drop in, which is exactly the seam `renderPlanDraft` was written to avoid. A different
	 * `planId` is a different plan and does get its own card.
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
