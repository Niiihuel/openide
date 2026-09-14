/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { AnchorPosition } from '../../../../../../base/common/layout.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { createMenuContent, createMenuRow, OpenideComposerPopover } from '../openideComposerMenu.js';
import { IOpenideChatConfirmationContent, IOpenideChatContent } from '../../../common/chat/openideChatContent.js';
import { ToolApprovalDecision } from '../../../common/openideAgentTypes.js';
import { getOpenideToolMeta, toolVisualKind } from '../../../common/chat/openideChatToolMeta.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatConfirmation.css';
import { t } from '../../../common/openideStrings.js';

/** Inline approval with a bounded review area and an explicit permission scope. */
export class OpenideChatConfirmationPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _actions: HTMLElement;
	private readonly _status: HTMLElement;
	private readonly _requestId: string;
	private readonly _scopePopover: OpenideComposerPopover;
	private _decision: ToolApprovalDecision | undefined;

	constructor(
		content: IOpenideChatConfirmationContent,
		_context: IOpenideChatContentPartContext,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
		@IContextViewService contextViewService: IContextViewService,
	) {
		super();
		this._scopePopover = this._register(new OpenideComposerPopover(contextViewService));
		this._requestId = content.requestId;
		this._decision = content.decision;

		const kind = toolVisualKind(content.tool);
		this.domNode = $(`.openide-chat-approval.tool-kind-${kind.id}`);
		this.domNode.setAttribute('role', 'group');
		this.domNode.setAttribute('aria-label', content.title);
		// These controls live inside a tree. Let their native keyboard behavior run without
		// letting the tree consume Enter, Space or the scope menu's navigation keys.
		for (const eventName of ['keydown', 'keyup']) {
			this._register(addDisposableListener(this.domNode, eventName, event => {
				if (!event.ctrlKey && !event.metaKey && !event.altKey
					&& ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'].includes(event.key)) {
					event.stopPropagation();
				}
			}));
		}

		const head = append(this.domNode, $('.openide-chat-approval-head'));
		const icon = append(head, $(`span.codicon.codicon-${getOpenideToolMeta(content.tool).icon}`));
		icon.setAttribute('aria-hidden', 'true');
		append(head, $('span.openide-chat-approval-title')).textContent = content.title;

		// Keep the decisions outside the scroll region so a long command cannot hide them.
		const body = append(this.domNode, $('.openide-chat-approval-body'));
		body.tabIndex = 0;
		body.setAttribute('role', 'group');
		body.setAttribute('aria-label', t('chatSurface.approval.review'));
		if (content.detail && content.detail.trim() !== content.command?.trim()) {
			append(body, $('.openide-chat-approval-description')).textContent = content.detail;
		}
		if (content.command) {
			append(body, $('code.openide-chat-approval-cmd')).textContent = content.command;
		}

		this._actions = append(this.domNode, $('.openide-chat-approval-actions'));
		this._status = append(this.domNode, $('.openide-chat-approval-status'));
		this._status.setAttribute('role', 'status');
		this._status.setAttribute('aria-live', 'polite');
		this._status.tabIndex = -1;

		this._renderActions(content);
		this._renderDecision(content.decision, false);
	}

	private _renderActions(content: IOpenideChatConfirmationContent): void {
		const scope = append(this._actions, $('button.oi-btn.ghost.openide-chat-approval-scope-trigger', {
			type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
			'aria-label': t('chatSurface.approval.scope'),
		})) as HTMLButtonElement;
		const scopeText = append(scope, $('span.openide-chat-approval-scope-label'));
		append(scope, $('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));
		let selected: ToolApprovalDecision = 'once';
		const options: { label: string; decision: ToolApprovalDecision }[] = [
			{ label: t('chatSurface.approval.scopeOnce'), decision: 'once' },
			{ label: t('chatSurface.approval.scopeSession'), decision: 'session' },
		];
		if (!content.sensitive) { options.push({ label: t('chatSurface.approval.scopeAlways'), decision: 'always' }); }
		scopeText.textContent = options[0].label;
		const buttons = append(this._actions, $('.openide-chat-approval-buttons'));
		const choice = (label: string, decision: () => ToolApprovalDecision, extraClass: string) => {
			const button = append(buttons, $(`button.openide-chat-abtn${extraClass}`)) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = label;
			this._register(this._onClick(button, decision));
		};
		choice(t('chatSurface.approval.deny'), () => 'deny', '.deny');
		choice(t('chatSurface.approval.allow'), () => {
			// Only the offered scopes can be selected; sensitive actions never persist a grant.
			return selected === 'session' ? 'session' : selected === 'always' && !content.sensitive ? 'always' : 'once';
		}, '.primary');
		const hint = append(this._actions, $('.openide-chat-approval-scope-hint'));
		hint.hidden = true;
		hint.setAttribute('aria-live', 'polite');
		this._register(addDisposableListener(scope, 'click', () => {
			if (this._decision) { return; }
			this._scopePopover.toggle(scope, {
				anchorPosition: AnchorPosition.BELOW,
				render: (container, store) => {
					container.setAttribute('aria-label', t('chatSurface.approval.scope'));
					store.add(toDisposable(() => container.removeAttribute('aria-label')));
					const menu = append(container, createMenuContent(container.ownerDocument));
					for (const option of options) {
						const row = append(menu, createMenuRow(container.ownerDocument, { label: option.label, active: selected === option.decision }));
						row.setAttribute('role', 'menuitemradio');
						row.setAttribute('aria-label', option.label);
						row.setAttribute('aria-checked', String(selected === option.decision));
						store.add(addDisposableListener(row, 'click', () => {
							selected = option.decision;
							scopeText.textContent = option.label;
							const remembered = selected !== 'once';
							const description = remembered
								? content.risk === 'exec' && content.command
									? t('chatSurface.approval.scopeCommandHint')
									: t('chatSurface.approval.scopeToolHint')
								: '';
							hint.hidden = !remembered;
							hint.textContent = description;
							scope.setAttribute('aria-description', description);
							this._scopePopover.close();
							scope.focus();
							this._onDidChangeHeight.fire();
						}));
					}
				},
			});
		}));
	}

	private _onClick(button: HTMLButtonElement, decision: () => ToolApprovalDecision) {
		const listener = () => {
			if (this._decision) { return; }
			const answer = decision();
			this._decision = answer;
			const hadFocus = this._actions.contains(this.domNode.ownerDocument.activeElement);
			this._agentService.resolveApproval(this._requestId, answer);
			this._renderDecision(answer);
			if (hadFocus) { this._status.focus(); }
		};
		button.addEventListener('click', listener);
		return { dispose: () => button.removeEventListener('click', listener) };
	}

	/** Keep the authorization in the transcript and notify the list when the card shrinks. */
	private _renderDecision(decision: IOpenideChatConfirmationContent['decision'], notify = true): void {
		this.domNode.classList.toggle('decided', !!decision);
		this._actions.classList.toggle('hidden', !!decision);
		clearNode(this._status);
		if (!decision) {
			if (notify) { this._onDidChangeHeight.fire(); }
			return;
		}
		this._scopePopover.close();
		const denied = decision === 'deny';
		const icon = append(this._status, $(`span.codicon.codicon-${denied ? 'close' : 'check'}`));
		icon.setAttribute('aria-hidden', 'true');
		const text = append(this._status, $('span'));
		text.textContent = denied
			? t('chatSurface.approval.denied')
			: decision === 'always'
				? t('chatSurface.approval.allowedAlways')
				: decision === 'session'
					? t('chat.approval.allowedSession')
					: t('chatSurface.approval.allowed');
		this._status.classList.toggle('denied', denied);
		if (notify) { this._onDidChangeHeight.fire(); }
	}

	hasSameContent(other: IOpenideChatContent): boolean {
		if (other.kind !== 'confirmation' || other.requestId !== this._requestId) { return false; }
		// A pending transcript snapshot can arrive between the click and the resolved event.
		// Keep the local answer latched so that snapshot cannot reopen this request.
		this._decision = other.decision ?? this._decision;
		this._renderDecision(this._decision);
		return true;
	}
}
