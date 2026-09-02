/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { $, addDisposableListener, append, getWindow, reset } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IOpenideChatRequestItem } from '../../common/chat/openideChatItem.js';
import { t } from '../../common/openideStrings.js';
import { setupChatTooltip } from './openideChatHover.js';
import { applyTextClamp, createRewindIcon, renderCapabilityChips, renderImageStrip, stripCapabilityPrefixes } from './openideChatRequestBubble.js';
import './media/openideChatPinned.css';

export interface IOpenideChatPinnedRequestDelegate {
	/** Same contract as the row's button: reverts the turn's files and truncates the transcript. */
	rollbackTo(element: IOpenideChatRequestItem): Promise<boolean>;
	/** Opens the turn for editing where the pinned bubble stands. */
	edit(element: IOpenideChatRequestItem): void;
	/** Lines the bubble shows before clamping; the pinned copy clamps exactly like the row. */
	clampLines(): number;
	/** Whether a click may open the turn for editing right now (false while a run is live). */
	canEdit(): boolean;
}

/**
 * The request that owns the part of the conversation on screen, held at the top of the transcript.
 *
 * Cursor keeps the user's message in view while its reply scrolls under it, and a click on that
 * message turns it into a composer to edit and resend from that point. The transcript here is a
 * virtualised list, so the row itself cannot be made sticky: this is a SEPARATE element, laid over
 * the top of the list host, that the widget feeds with whichever request row has just scrolled past
 * the top edge (`OpenideChatListWidget.findScrolledPastRequest`).
 *
 * It has to pass for the row itself, which rules two things: the copy is built with the SAME
 * markup, clamp and paddings as the row (any difference in height or wrapping shows as the bubble
 * "jumping" the moment it sticks), and it appears with no animation at all — a fade-in on a thing
 * that was already on screen reads as a flicker. What sells the illusion is the opaque ground and
 * the short fade under it, so the covered row dissolves instead of being cut.
 *
 * Editing happens in this same overlay, not in the row: the widget mounts a second composer into
 * `editHost`, so the editor has every control the main composer has and it survives the list
 * recycling the row underneath. Escape or a click anywhere outside cancel it, like Cursor; there is
 * no bar and no close button.
 */
export class OpenideChatPinnedRequest extends Disposable {

	private readonly _onDidCancelEdit = this._register(new Emitter<void>());
	/** Escape in the editor, or a click outside it. The widget tears the edit down. */
	readonly onDidCancelEdit: Event<void> = this._onDidCancelEdit.event;

	readonly domNode: HTMLElement;
	private readonly _bubble: HTMLElement;
	private readonly _capabilities: HTMLElement;
	private readonly _text: HTMLElement;
	private readonly _images: HTMLElement;
	private readonly _rollback: HTMLButtonElement;
	private readonly _editHost: HTMLElement;
	private readonly _elementDisposables = this._register(new DisposableStore());
	private readonly _outsideClick = this._register(new MutableDisposable());

	private _element: IOpenideChatRequestItem | undefined;
	private _editing = false;

	/** The request on show, pinned or being edited. */
	get element(): IOpenideChatRequestItem | undefined { return this._element; }
	get isEditing(): boolean { return this._editing; }
	/** Where the widget mounts the edit composer. Empty until the first edit. */
	get editHost(): HTMLElement { return this._editHost; }

	constructor(
		host: HTMLElement,
		private readonly _delegate: IOpenideChatPinnedRequestDelegate,
		@IHoverService private readonly _hoverService: IHoverService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
		this.domNode = append(host, $('.openide-chat-pinned'));

		// The row's markup, node for node (openideChatRequestRenderer.ts): same classes, same order,
		// so the stylesheet lays both out identically.
		this._bubble = append(this.domNode, $('.openide-chat-request-bubble'));
		this._capabilities = append(this._bubble, $('.openide-chat-request-capabilities.hidden'));
		this._text = append(this._bubble, $('.openide-chat-request-text'));
		this._images = append(this._bubble, $('.openide-chat-request-images.hidden'));
		const actions = append(this._bubble, $('.openide-chat-request-actions'));
		this._rollback = append(actions, $('button.openide-chat-request-action', { type: 'button' })) as HTMLButtonElement;
		this._register(setupChatTooltip(this._hoverService, this._rollback, () => t('chat.request.rollback')));
		this._rollback.appendChild(createRewindIcon(host.ownerDocument));
		this._register(addDisposableListener(this._rollback, 'click', event => {
			event.stopPropagation();
			const element = this._element;
			if (!element || this._rollback.disabled) {
				return;
			}
			this._rollback.disabled = true;
			void this._delegate.rollbackTo(element).then(committed => {
				if (!committed) { this._rollback.disabled = false; }
			}, () => { this._rollback.disabled = false; });
		}));
		this._register(setupChatTooltip(this._hoverService, this._text, () => t('chat.request.edit'), { aria: false }));
		this._register(addDisposableListener(this._bubble, 'click', event => {
			if ((event.target as HTMLElement).closest('button, a, img, .openide-chat-request-image')) {
				return;
			}
			if (!this._element) {
				return;
			}
			// Cursor: while the reply is still coming, a click on the pinned message opens it OUT
			// — full text, full-size images — instead of refusing with a notice; editing is what a
			// click does once the run has settled.
			if (!this._delegate.canEdit()) {
				this.domNode.classList.toggle('expanded');
				return;
			}
			this._delegate.edit(this._element);
		}));

		this._editHost = append(this.domNode, $('.openide-chat-pinned-edit.hidden'));
		this._register(addDisposableListener(this._editHost, 'keydown', event => {
			// Only an Escape nobody else claimed: the composer's own menus close on it first and
			// stop it from getting here.
			if (new StandardKeyboardEvent(event).equals(KeyCode.Escape)) {
				event.preventDefault();
				this._onDidCancelEdit.fire();
			}
		}));
	}

	/** Pins `element`. A no-op while editing: the editor owns the overlay. */
	show(element: IOpenideChatRequestItem): void {
		if (this._editing) {
			return;
		}
		if (this._element?.id !== element.id) {
			this._renderBubble(element);
		}
		this._element = element;
		this._rollback.disabled = false;
		this.domNode.classList.add('visible');
	}

	hide(): void {
		if (this._editing) {
			return;
		}
		this._element = undefined;
		this.domNode.classList.remove('visible');
	}

	beginEdit(element: IOpenideChatRequestItem): void {
		this._editing = true;
		this._element = element;
		this._bubble.classList.add('hidden');
		this._editHost.classList.remove('hidden');
		this.domNode.classList.add('visible', 'editing');
		// A press anywhere else ends the edit, as in Cursor. Capturing, on the window's document,
		// so it sees the press before a list row or the composer below swallows it. The context
		// view is the one place outside the overlay that still belongs to the editor: its menus
		// (mode, model, permissions) render there.
		const document = getWindow(this.domNode).document;
		this._outsideClick.value = addDisposableListener(document, 'mousedown', event => {
			const target = event.target as HTMLElement | null;
			if (!target || this.domNode.contains(target) || target.closest('.context-view')) {
				return;
			}
			this._onDidCancelEdit.fire();
		}, true);
	}

	endEdit(): void {
		if (!this._editing) {
			return;
		}
		this._outsideClick.clear();
		this._editing = false;
		this._editHost.classList.add('hidden');
		this._bubble.classList.remove('hidden');
		this.domNode.classList.remove('editing');
		this._element = undefined;
		this.domNode.classList.remove('visible');
	}

	private _renderBubble(element: IOpenideChatRequestItem): void {
		this._elementDisposables.clear();
		renderCapabilityChips(this._capabilities, element.capabilities, this._hoverService, this._elementDisposables);
		reset(this._text, stripCapabilityPrefixes(element.displayText ?? element.text, element.capabilities));
		renderImageStrip(this._images, element.images, this._elementDisposables, this._commandService);
		this.domNode.classList.remove('expanded');
		// The clamp is measured against the text's `scrollHeight`, which needs the node laid out:
		// the overlay is in the document, so it is — `hidden` on the bubble is only set while editing.
		applyTextClamp(this._text, this._elementDisposables, () => { }, this._delegate.clampLines(), false);
	}
}
