/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/path.js';
import { localize } from '../../../../../nls.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { AgentMode, IChatCapabilityMention, IChatImage } from '../../common/openideAgentTypes.js';
import { IComposerReference, linkLabel } from './openideChatComposerChips.js';
import { t } from '../../common/openideStrings.js';

/** The webview's ceiling per conversation (openideChatHtml.ts:4113). */
export const QUEUE_LIMIT = 20;
export const QUEUE_FULL_MESSAGE = 'La cola de esta conversación llegó a 20 mensajes. Enviá, editá o quitá uno antes de agregar otro.';
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
		|| localize('openide.chat.queue.image', "(imagen)");
}

/**
 * The message queue of the composer: what the user typed while a run was in flight.
 *
 * Transcribed from the webview's queue (openideChatHtml.ts:4073-4207, 6337): per conversation,
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

	readonly domNode: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _count: HTMLElement;
	private readonly _chevron: HTMLElement;
	private readonly _rowStore = this._register(new DisposableStore());
	private _expanded = true;
	private _queues: Record<string, IComposerQueueEntry[]> = {};
	private _conversationId: string | undefined;

	constructor(
		host: HTMLElement,
		private readonly storageService: IStorageService,
	) {
		super();
		this._queues = this._load();
		this.domNode = append(host, $('div.openide-chat-queue-tray.hidden'));
		const head = append(this.domNode, $('div.openide-chat-queue-head'));
		const toggle = append(head, $<HTMLButtonElement>('button.openide-chat-queue-toggle', { type: 'button' }));
		this._chevron = append(toggle, $('span.codicon.codicon-chevron-down'));
		this._count = append(toggle, $('span.openide-chat-queue-count'));
		this._register(addDisposableListener(toggle, 'click', () => {
			this._expanded = !this._expanded;
			this._render();
		}));
		this._body = append(this.domNode, $('div.openide-chat-queue-body'));
		this._render();
	}

	get length(): number {
		return this._active().length;
	}

	/**
	 * Switches the visible queue. A queue typed before the conversation existed (the pending key)
	 * is adopted by the first conversation that shows up, which is what the webview did on `tabs`
	 * (openideChatHtml.ts:6337-6348).
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
		for (const key of Object.keys(this._queues)) {
			if (!this._queues[key].length) { delete this._queues[key]; }
		}
		if (Object.keys(this._queues).length) {
			this.storageService.store(STORAGE_KEY, JSON.stringify(this._queues), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(STORAGE_KEY, StorageScope.WORKSPACE);
		}
	}

	private _render(): void {
		const queue = this._queues[this._key()] ?? [];
		this._rowStore.clear();
		clearNode(this._body);
		const hidden = !queue.length;
		const wasHidden = this.domNode.classList.contains('hidden');
		this.domNode.classList.toggle('hidden', hidden);
		this._count.textContent = queue.length === 1
			? localize('openide.chat.queue.one', "1 pendiente")
			: localize('openide.chat.queue.many', "{0} pendientes", queue.length);
		this._chevron.className = `codicon codicon-${this._expanded ? 'chevron-down' : 'chevron-right'}`;
		this._body.classList.toggle('hidden', !this._expanded);
		if (!hidden && this._expanded) {
			queue.forEach((entry, index) => {
				const row = append(this._body, $('div.openide-chat-queue-row'));
				append(row, $('span.codicon.codicon-circle-large-outline'));
				const main = append(row, $('span.openide-chat-queue-main'));
				const text = append(main, $('span.openide-chat-queue-text'));
				text.textContent = entryLabel(entry);
				text.title = text.textContent;
				if (entry.mode === 'plan') {
					append(main, $('span.openide-chat-queue-intent')).textContent = t('chat.queue.afterPlan');
				}
				const actions = append(row, $('span.openide-chat-queue-actions'));
				this._action(actions, 'edit', localize('openide.chat.queue.edit', "Editar"), () => {
					const removed = this._removeAt(index);
					if (removed) { this._onDidRequestEdit.fire({ entry: removed }); }
				});
				this._action(actions, entry.mode === 'plan' ? 'replace-all' : 'arrow-up',
					entry.mode === 'plan' ? localize('openide.chat.queue.nowPlan', "Reemplazar el plan actual y enviar ahora") : localize('openide.chat.queue.now', "Enviar ahora"),
					() => {
						const removed = this._removeAt(index);
						if (removed) { this._onDidRequestSendNow.fire({ entry: removed }); }
					});
				this._action(actions, 'trash', localize('openide.chat.queue.remove', "Quitar"), () => this._removeAt(index));
			});
		}
		if (wasHidden !== hidden || !hidden) {
			this._onDidChangeHeight.fire();
		}
	}

	private _action(parent: HTMLElement, icon: string, title: string, run: () => void): void {
		const button = append(parent, $<HTMLButtonElement>('button.openide-chat-queue-btn', { type: 'button', title }));
		button.setAttribute('aria-label', title);
		append(button, $(`span.codicon.codicon-${icon}`));
		this._rowStore.add(addDisposableListener(button, 'click', event => {
			event.stopPropagation();
			run();
		}));
	}
}
