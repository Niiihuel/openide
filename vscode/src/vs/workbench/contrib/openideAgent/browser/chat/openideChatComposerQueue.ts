/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Action } from '../../../../../base/common/actions.js';
import { AnchorAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/path.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { AgentMode, IChatCapabilityMention, IChatImage } from '../../common/openideAgentTypes.js';
import { IComposerReference, linkLabel } from './openideChatComposerChips.js';
import { IComposerSnippet } from '../../common/chat/openideChatSnippet.js';
import { createChatTray, IOpenideChatTray } from './openideChatTray.js';
import { setupChatTooltip } from './openideChatHover.js';
import { t } from '../../common/openideStrings.js';

/** The webview's ceiling per conversation. */
export const QUEUE_LIMIT = 20;
/** A function, not a const: a module-level `t()` would resolve once at load, before the
 *  language is known. Same shape as `queueDisabledMessage` in the composer. */
export const queueFullMessage = () => t('service.chat.queue.full');
/** Messages typed before a conversation exists are keyed the way the webview keyed them. */
const PENDING_KEY = '__pending__';
const STORAGE_KEY = 'openide.chat.composerQueues';

/** One queued message: everything the composer held when the user pressed Send while busy. */
export interface IComposerQueueEntry {
	/** The text as typed (before `composerPayload`), so Edit puts it back verbatim. */
	readonly inputText: string;
	readonly images: readonly IChatImage[];
	readonly references: readonly IComposerReference[];
	readonly capabilities: readonly IChatCapabilityMention[];
	readonly links: readonly string[];
	/** Optional: queues persisted before snippets existed come back without the field. */
	readonly snippets?: readonly IComposerSnippet[];
	readonly mode: AgentMode;
	readonly providerId: string;
	readonly modelId: string;
}

export interface IComposerQueueAction {
	readonly entry: IComposerQueueEntry;
}

function entryLabel(entry: IComposerQueueEntry): string {
	const labels = entry.capabilities.map(capability => `/${capability.name}`).join(' ');
	const text = [labels, entry.inputText.trim()].filter(Boolean).join(' ');
	return text
		|| entry.links.map(linkLabel).join(', ')
		|| entry.references.map(reference => basename(reference.path)).join(', ')
		|| t('chatSurface.queue.image');
}

/**
 * The message queue of the composer: what the user typed while a run was in flight.
 *
 * Transcribed from the webview's queue (the removed chat webview, 6337): per conversation,
 * persisted so a reload does not lose what was never sent, drained one entry at a time when the
 * run ends. It owns the tray under the input card; the composer owns the drain, because the drain
 * is a submit.
 */
export class OpenideChatComposerQueue extends Disposable {

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private readonly _onDidRequestEdit = this._register(new Emitter<IComposerQueueAction>());
	/** The entry left the queue and should be put back into the composer. */
	readonly onDidRequestEdit: Event<IComposerQueueAction> = this._onDidRequestEdit.event;

	private readonly _onDidRequestSendNow = this._register(new Emitter<IComposerQueueAction>());
	/** The entry left the queue and should be sent, cancelling the run in flight. */
	readonly onDidRequestSendNow: Event<IComposerQueueAction> = this._onDidRequestSendNow.event;

	private readonly _onDidRequestOpenInSideChat = this._register(new Emitter<IComposerQueueAction>());
	/** The entry left the queue and should start a separate conversation. */
	readonly onDidRequestOpenInSideChat: Event<IComposerQueueAction> = this._onDidRequestOpenInSideChat.event;

	private readonly _onDidRequestDisableQueueing = this._register(new Emitter<IComposerQueueAction>());
	/** Queueing should be disabled and this entry restored to the composer. */
	readonly onDidRequestDisableQueueing: Event<IComposerQueueAction> = this._onDidRequestDisableQueueing.event;

	readonly domNode: HTMLElement;
	private readonly _tray: IOpenideChatTray;
	private readonly _body: HTMLElement;
	private readonly _count: HTMLElement;
	private readonly _rowStore = this._register(new DisposableStore());
	private _expanded = false;
	private _source: OpenideChatComposerQueue | undefined;
	private readonly _onDidChange = this._register(new Emitter<void>());
	private _queues: Record<string, IComposerQueueEntry[]> = {};
	private _conversationId: string | undefined;

	constructor(
		host: HTMLElement,
		private readonly storageService: IStorageService,
		private readonly hoverService: IHoverService,
		private readonly menuService?: IContextMenuService,
	) {
		super();
		this._queues = this._load();
		this._tray = this._register(createChatTray(host, 'queue', 'list-selection'));
		this.domNode = this._tray.domNode;
		const { toggle } = this._tray;
		this._count = this._tray.label;
		this._register(addDisposableListener(toggle, 'click', () => {
			this._expanded = !this._expanded;
			this._render();
		}));
		this._body = this._tray.body;
		this._register(this._tray.onDidChangeExpanded(expanded => {
			if (this._expanded === expanded) {
				return;
			}
			this._expanded = expanded;
			this._render();
		}));
		this._tray.setExpanded(this._expanded);
		this._render();
	}

	/** Shares pending messages while each surface keeps its own tray geometry. */
	shareWith(source: OpenideChatComposerQueue): void {
		this._source = source;
		this._queues = source._queues;
		this._register(source._onDidChange.event(() => this._render()));
		this._render();
	}

	get length(): number {
		return this._active().length;
	}

	/**
	 * Switches the visible queue. A queue typed before the conversation existed (the pending key)
	 * is adopted by the first conversation that shows up, which is what the webview did on `tabs`
	 *.
	 */
	setConversation(id: string | undefined): void {
		if (id && this._queues[PENDING_KEY]?.length && !this._queues[id]?.length) {
			this._queues[id] = this._queues[PENDING_KEY];
			delete this._queues[PENDING_KEY];
			this._persist();
		}
		this._conversationId = id;
		this._render();
	}

	/** Returns false when the conversation's queue is full. */
	push(entry: IComposerQueueEntry): boolean {
		const queue = this._active();
		if (queue.length >= QUEUE_LIMIT) {
			return false;
		}
		queue.push(entry);
		this._persist();
		this._render();
		return true;
	}

	/** Takes the next entry to send, or undefined when the queue is empty. */
	shift(): IComposerQueueEntry | undefined {
		const queue = this._active();
		const entry = queue.shift();
		if (entry) {
			this._persist();
			this._render();
		}
		return entry;
	}

	private _key(): string {
		return this._conversationId || PENDING_KEY;
	}

	private _active(): IComposerQueueEntry[] {
		const key = this._key();
		if (!this._queues[key]) { this._queues[key] = []; }
		return this._queues[key];
	}

	private _removeAt(index: number): IComposerQueueEntry | undefined {
		const queue = this._active();
		const [entry] = queue.splice(index, 1);
		this._persist();
		this._render();
		return entry;
	}

	private _load(): Record<string, IComposerQueueEntry[]> {
		try {
			const raw = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
			const parsed = raw ? JSON.parse(raw) : {};
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch {
			return {};
		}
	}

	private _persist(): void {
		if (this._source) { this._source._persist(); this._source._render(); return; }
		for (const key of Object.keys(this._queues)) {
			if (!this._queues[key].length) { delete this._queues[key]; }
		}
		if (Object.keys(this._queues).length) {
			this.storageService.store(STORAGE_KEY, JSON.stringify(this._queues), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(STORAGE_KEY, StorageScope.WORKSPACE);
		}
		this._onDidChange.fire();
	}

	private _render(): void {
		const queue = this._queues[this._key()] ?? [];
		this._rowStore.clear();
		clearNode(this._body);
		const hidden = !queue.length;
		const wasHidden = this.domNode.classList.contains('hidden');
		this.domNode.classList.toggle('hidden', hidden);
		this._count.textContent = queue.length === 1
			? t('chatSurface.queue.one')
			: t('chatSurface.queue.many', queue.length);
		this._tray.setExpanded(this._expanded);
		this._tray.head.hidden = queue.length <= 1;
		// The next request stays visible, even when the remainder is folded.
		if (!hidden) {
			(this._expanded ? queue : queue.slice(0, 1)).forEach((entry, index) => {
				const row = append(this._body, $('div.openide-chat-queue-row'));
				append(row, $('span.codicon.codicon-list-selection', { 'aria-hidden': 'true' }));
				const main = append(row, $('span.openide-chat-queue-main'));
				const image = entry.images[0];
				if (image) {
					const src = image.data ? `data:${image.mimeType};base64,${image.data}` : image.assetUri ? FileAccess.uriToBrowserUri(URI.parse(image.assetUri)).toString(true) : undefined;
					if (src) { append(main, $('img.openide-chat-queue-thumb', { src, alt: '' })); }
				}
				const text = append(main, $('span.openide-chat-queue-text'));
				const label = entryLabel(entry);
				text.textContent = label;
				// The row ellipsises, so the tip is the message the user queued, in full.
				this._rowStore.add(setupChatTooltip(this.hoverService, text, () => label, { aria: false }));
				if (entry.mode === 'plan') {
					append(main, $('span.openide-chat-queue-intent')).textContent = t('chat.queue.afterPlan');
				}
				const actions = append(row, $('span.openide-chat-queue-actions'));
				const edit = () => {
					const removed = this._removeAt(index);
					if (removed) { this._onDidRequestEdit.fire({ entry: removed }); }
				};
				const openInSideChat = () => {
					const removed = this._removeAt(index);
					if (removed) { this._onDidRequestOpenInSideChat.fire({ entry: removed }); }
				};
				const disableQueueing = () => {
					const removed = this._removeAt(index);
					if (removed) { this._onDidRequestDisableQueueing.fire({ entry: removed }); }
				};
				const send = this._action(actions, 'arrow-up', () => t(entry.mode === 'plan' ? 'chat.queue.nowPlan' : 'chat.queue.now'), () => {
					const removed = this._removeAt(index);
					if (removed) { this._onDidRequestSendNow.fire({ entry: removed }); }
				});
				send.classList.add('openide-chat-queue-send');
				append(send, $('span.openide-chat-queue-send-label', undefined, t('chat.queue.steer')));
				this._action(actions, 'trash', () => t('chat.queue.remove'), () => this._removeAt(index));
				if (this.menuService) {
					const more = this._action(actions, 'ellipsis', () => t('chat.header.more'), () => {
						const menuActions = [
							new Action('openide.queue.edit', t('chat.queue.editMessage'), 'codicon codicon-edit', true, async () => edit()),
							new Action('openide.queue.openInSideChat', t('chat.queue.openInSideChat'), 'codicon codicon-comment-discussion', true, async () => openInSideChat()),
							new Action('openide.queue.disable', t('chat.queue.disable'), 'codicon codicon-list-filter', true, async () => disableQueueing()),
						];
						this.menuService!.showContextMenu({ getAnchor: () => more, getActions: () => menuActions, anchorAlignment: AnchorAlignment.RIGHT, domForShadowRoot: more, useWindowContainerForShadowRoot: true, onHide: cancelled => { menuActions.forEach(action => action.dispose()); if (cancelled && more.isConnected) { more.focus(); } } });
					});
				} else { this._action(actions, 'edit', () => t('chat.queue.edit'), edit); }
			});
		}
		if (wasHidden !== hidden || !hidden) {
			this._onDidChangeHeight.fire();
		}
	}

	private _action(parent: HTMLElement, icon: string, title: () => string, run: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.openide-chat-queue-btn.oi-dock-action', { type: 'button' }));
		this._rowStore.add(setupChatTooltip(this.hoverService, button, title));
		append(button, $(`span.codicon.codicon-${icon}`));
		this._rowStore.add(addDisposableListener(button, 'click', event => {
			event.stopPropagation();
			run();
		}));
		return button;
	}
}
