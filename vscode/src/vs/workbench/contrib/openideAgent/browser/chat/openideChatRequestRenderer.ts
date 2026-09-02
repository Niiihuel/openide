/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { $, addDisposableListener, append, reset } from '../../../../../base/browser/dom.js';
import { ITreeNode, ITreeRenderer } from '../../../../../base/browser/ui/tree/tree.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { FuzzyScore } from '../../../../../base/common/filters.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IOpenideChatItem, IOpenideChatRequestItem, isOpenideChatRequestItem } from '../../common/chat/openideChatItem.js';
import { OPENIDE_CHAT_REQUEST_TEMPLATE_ID } from './openideChatListDelegate.js';
import { applyTextClamp, createRewindIcon, renderCapabilityChips, renderImageStrip, stripCapabilityPrefixes, renderSnippetCards } from './openideChatRequestBubble.js';
// Type only: both rows report their height to the list through the same shape, and declaring a
// second identical interface would let the two drift apart silently.
import { IOpenideChatItemHeightChange } from './openideChatResponseRenderer.js';
import { t } from '../../common/openideStrings.js';
import { setupChatTooltip } from './openideChatHover.js';

/**
 * What the row needs from the widget. It is an interface and not a direct call into the controller
 * because the rollback is a WORKSPACE-MUTATING transaction: the renderer must not be able to reach
 * `IOpenideAgentService` on its own, it can only ask, and the widget decides.
 */
export interface IOpenideChatRequestRendererDelegate {
	/**
	 * Reverts the files of this exact turn and truncates the transcript from it.
	 * Resolves `false` when the rollback was rejected, which is the row's cue to re-arm its button.
	 */
	rollbackTo(element: IOpenideChatRequestItem): Promise<boolean>;
	/** Opens the turn for editing: the bubble itself is the affordance, as in Cursor. */
	edit(element: IOpenideChatRequestItem): void;
	/** Lines the bubble shows before clamping (`openide.chat.userMessage.clampLines`); 0 = never clamp. */
	clampLines?(): number;
}

export interface IOpenideChatRequestTemplate {
	readonly row: HTMLElement;
	readonly bubble: HTMLElement;
	readonly capabilities: HTMLElement;
	readonly snippets: HTMLElement;
	readonly text: HTMLElement;
	readonly images: HTMLElement;
	readonly rollback: HTMLButtonElement;
	/** Cleared on every render: listeners here close over the element being shown. */
	readonly elementDisposables: DisposableStore;
	readonly templateDisposables: DisposableStore;
	currentElement: IOpenideChatRequestItem | undefined;
}

/**
 * The user's turn.
 *
 * Rendered as plain text on purpose: the message is the user's own input, and running it back
 * through a markdown renderer would let a pasted snippet change how it looks compared to what was
 * typed. The bubble itself is a transcription of `.msg.user` in the webview — full width inside the
 * row, 1px border, 8px radius, `6px 10px` of padding — with the single action the webview has.
 */
export class OpenideChatRequestRenderer extends Disposable implements ITreeRenderer<IOpenideChatItem, FuzzyScore, IOpenideChatRequestTemplate> {

	readonly templateId: string = OPENIDE_CHAT_REQUEST_TEMPLATE_ID;

	private readonly _onDidChangeItemHeight = this._register(new Emitter<IOpenideChatItemHeightChange>());
	/** Fired when expanding a clamped message makes the row taller than the list measured it. */
	readonly onDidChangeItemHeight: Event<IOpenideChatItemHeightChange> = this._onDidChangeItemHeight.event;

	constructor(
		private readonly _delegate: IOpenideChatRequestRendererDelegate,
		@IHoverService private readonly _hoverService: IHoverService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
	}

	renderTemplate(container: HTMLElement): IOpenideChatRequestTemplate {
		const templateDisposables = new DisposableStore();
		const elementDisposables = templateDisposables.add(new DisposableStore());
		const row = append(container, $('.openide-chat-row.openide-chat-row-request'));
		const bubble = append(row, $('.openide-chat-request-bubble'));
		const capabilities = append(bubble, $('.openide-chat-request-capabilities.hidden'));
		const snippets = append(bubble, $('.openide-chat-request-snippets.hidden'));
		const text = append(bubble, $('.openide-chat-request-text'));
		const images = append(bubble, $('.openide-chat-request-images.hidden'));
		const actions = append(bubble, $('.openide-chat-request-actions'));

		const rollback = append(actions, $('button.openide-chat-request-action')) as HTMLButtonElement;
		rollback.type = 'button';
		// Rejection copy and tooltip are the webview's, word for word (the removed chat webview,
		// 2728-2730): the button is not a generic "undo", it says what it does to the files. It is
		// the workbench hover and not a `title=`, so the tip is themed and reads the language late;
		// it goes on the TEMPLATE store because the button outlives every row recycled through it.
		templateDisposables.add(setupChatTooltip(this._hoverService, rollback, () => t('chat.request.rollback')));
		rollback.appendChild(createRewindIcon(container.ownerDocument));

		const template: IOpenideChatRequestTemplate = {
			row, bubble, capabilities, snippets, text, images, rollback,
			elementDisposables, templateDisposables, currentElement: undefined,
		};
		// Bound once on the template, not per element: the button outlives every render, and a
		// listener re-added on each one would fire as many times as the row has been recycled.
		templateDisposables.add(addDisposableListener(rollback, 'click', event => {
			// The bubble itself opens the inline editor; stopping here keeps the two affordances
			// from firing together.
			event.stopPropagation();
			this._onRollbackClicked(template);
		}));
		// The whole bubble opens the turn for editing (Cursor). Buttons, links and the attached
		// images keep their own meaning.
		templateDisposables.add(setupChatTooltip(this._hoverService, text, () => t('chat.request.edit'), { aria: false }));
		templateDisposables.add(addDisposableListener(bubble, 'click', event => {
			if ((event.target as HTMLElement).closest('button, a, img')) {
				return;
			}
			if (template.currentElement) {
				this._delegate.edit(template.currentElement);
			}
		}));
		return template;
	}

	renderElement(node: ITreeNode<IOpenideChatItem, FuzzyScore>, _index: number, template: IOpenideChatRequestTemplate): void {
		const element = node.element;
		if (!isOpenideChatRequestItem(element)) {
			return;
		}
		template.elementDisposables.clear();
		template.currentElement = element;
		// A recycled template may arrive with the button still disabled from the row it showed
		// before; the state belongs to the click, not to the DOM node.
		template.rollback.disabled = false;

		renderCapabilityChips(template.capabilities, element.capabilities, this._hoverService, template.elementDisposables);
		renderSnippetCards(template.snippets, element.snippets, this._hoverService, template.elementDisposables);

		// `displayText` is what the user typed; `text` is what the model received after a
		// `/command` expanded. Showing the expansion would make the transcript unreadable.
		const body = stripCapabilityPrefixes(element.displayText ?? element.text, element.capabilities);
		reset(template.text, body);

		renderImageStrip(template.images, element.images, template.elementDisposables, this._commandService);
		applyTextClamp(template.text, template.elementDisposables, () => this._fireItemHeightChange(template), this._delegate.clampLines?.() ?? 3, false);
	}

	/**
	 * Arms the transaction and hands it to the widget.
	 *
	 * The button is disabled synchronously, before the await: a rollback reverts files, and a
	 * double click would queue a second transaction against a transcript the first one is already
	 * truncating. It is re-armed only when the operation was rejected AND the row still shows the
	 * same turn — a committed rollback removes this row altogether.
	 */
	private _onRollbackClicked(template: IOpenideChatRequestTemplate): void {
		const element = template.currentElement;
		if (!element || template.rollback.disabled) {
			return;
		}
		template.rollback.disabled = true;
		void this._delegate.rollbackTo(element).then(committed => {
			if (!committed && template.currentElement?.id === element.id) {
				template.rollback.disabled = false;
			}
		}, () => {
			if (template.currentElement?.id === element.id) {
				template.rollback.disabled = false;
			}
		});
	}

	/**
	 * Reports the row's real height back to the list. Same two guards as the response row: nothing
	 * is announced for a row that is no longer in the DOM, and the item's own field is updated so
	 * the delegate's estimate does not fall back to the default on the next pass.
	 */
	private _fireItemHeightChange(template: IOpenideChatRequestTemplate): void {
		const element = template.currentElement;
		if (!element || !template.row.isConnected) {
			return;
		}
		const height = Math.ceil(template.row.getBoundingClientRect().height);
		if (!height || height === element.currentRenderedHeight) {
			return;
		}
		element.currentRenderedHeight = height;
		this._onDidChangeItemHeight.fire({ element, height });
	}

	disposeElement(_node: ITreeNode<IOpenideChatItem, FuzzyScore>, _index: number, template: IOpenideChatRequestTemplate): void {
		template.elementDisposables.clear();
		template.currentElement = undefined;
	}

	disposeTemplate(template: IOpenideChatRequestTemplate): void {
		template.templateDisposables.dispose();
	}
}
