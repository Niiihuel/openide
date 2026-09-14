/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, getWindow, addDisposableListener, append, clearNode, reset } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { t } from '../../../common/openideStrings.js';
import { OpenideChatSessions } from '../../openideChatSessions.js';
import { RunOnceScheduler } from '../../../../../../base/common/async.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { createChatTray, IOpenideChatTray } from '../openideChatTray.js';
import { setupChatTooltip } from '../openideChatHover.js';
import { appendKbd } from '../openideChatKbd.js';
import { OpenideChatFileRow } from './openideChatFileRow.js';
import '../media/openideChatFiles.css';

/** One pending file, exactly as `IOpenideAgentService.onDidChangeFileDiff` reports it. */
export interface IOpenideChatFileDiffSummary {
	readonly path: string;
	readonly added: number;
	readonly removed: number;
}

/** Which way a file left the tray. Feeds the project-map learning signal, like the webview host. */
export interface IOpenideChatFilesResolved {
	readonly paths: readonly string[];
	readonly signal: 'keep' | 'revert';
}

const STOP_KEYBINDING = 'Ctrl+Shift+⌫';

/** Actionable pending files owned exclusively by the selected conversation. Shared-file
 * receipts remain reviewable through Changes without offering a cross-chat bulk rollback. */
export class OpenideChatFilesTray extends Disposable {

	readonly domNode: HTMLElement;
	private readonly _tray: IOpenideChatTray;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	/** The tray sits between transcript and composer, so appearing and going changes the layout. */
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private readonly _onDidRequestStop = this._register(new Emitter<void>());
	readonly onDidRequestStop: Event<void> = this._onDidRequestStop.event;

	private readonly _onDidResolveFiles = this._register(new Emitter<IOpenideChatFilesResolved>());
	readonly onDidResolveFiles: Event<IOpenideChatFilesResolved> = this._onDidResolveFiles.event;

	private readonly _count: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _stopButton: HTMLButtonElement;
	private readonly _undoAllButton: HTMLButtonElement;
	private readonly _keepAllButton: HTMLButtonElement;

	private readonly _rows = new Map<string, { row: OpenideChatFileRow; store: DisposableStore }>();
	private _expanded = false;
	private _busy = false;

	constructor(
		parent: HTMLElement,
		private readonly sessions: OpenideChatSessions,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();

		this._tray = this._register(createChatTray(parent, 'files', 'files'));
		this.domNode = this._tray.domNode;
		const { head, toggle } = this._tray;
		this._count = this._tray.label;
		this._register(addDisposableListener(toggle, 'click', () => this._toggle()));

		const actions = append(head, $('span.openide-chat-files-actions'));

		this._stopButton = this._createTextButton(actions, 'openide-chat-files-stop', t('chat.files.stop'), () => t('chat.part.filesStop'), () => this._onDidRequestStop.fire());
		appendKbd(this._stopButton, STOP_KEYBINDING).classList.add('openide-chat-files-kbd');
		this._undoAllButton = this._createTextButton(actions, 'openide-chat-files-bulk', t('chat.files.undoAll'), () => t('chat.part.filesUndoAll'), () => this._revertAll());
		this._keepAllButton = this._createTextButton(actions, 'openide-chat-files-bulk', t('chat.files.keepAll'), () => t('chat.part.filesKeepAll'), () => this._keepAll());
		this._createTextButton(actions, 'openide-chat-files-review', t('chat.files.review'), () => t('chat.part.filesReview'), () => this._reviewFirst());

		this._body = this._tray.body;
		this._register(this._tray.onDidChangeExpanded(expanded => {
			if (this._expanded === expanded) {
				return;
			}
			this._expanded = expanded;
			this._onDidChangeHeight.fire();
		}));
		this._tray.setExpanded(this._expanded);

		const refresh = this._register(new RunOnceScheduler(() => this._refresh(), 50));
		this._register(this._agentService.onDidChangeFileDiff(() => refresh.schedule()));
		this._register(sessions.onDidChange(() => this._refresh()));
		this._refresh();
	}

	private _refreshKey = '';
	private _refresh(): void {
		const id = this.sessions.activeSessionId();
		const diffs = id ? this._agentService.pendingFileDiffs(id) : [];
		const key = JSON.stringify([id, diffs]);
		if (key === this._refreshKey) { return; }
		this._refreshKey = key;
		const paths = new Set(diffs.map(diff => diff.path));
		for (const path of this._rows.keys()) { if (!paths.has(path)) { this._removeRow(path); } }
		for (const diff of diffs) { this.update(diff); }
		this._syncVisibility();
	}

	get isEmpty(): boolean {
		return this._rows.size === 0;
	}

	/**
	 * A run in flight replaces the bulk actions with Stop, because accepting half of a change set
	 * the agent is still writing produces a state no baseline describes.
	 */
	setBusy(busy: boolean): void {
		if (this._busy === busy) {
			return;
		}
		this._busy = busy;
		this._syncActions();
	}

	/** Repopulates from scratch: restore, and conversation switches. */
	reset(diffs: readonly IOpenideChatFileDiffSummary[]): void {
		for (const { store } of this._rows.values()) {
			store.dispose();
		}
		this._rows.clear();
		clearNode(this._body);
		for (const diff of diffs) {
			this.update(diff);
		}
		this._syncVisibility();
	}

	/**
	 * `added === 0 && removed === 0` means the file was resolved somewhere else — per-block Keep or
	 * Undo in the editor's inline review. The row has to go, or the tray keeps offering actions on a
	 * file with nothing left to accept (the removed chat webview).
	 */
	update(diff: IOpenideChatFileDiffSummary): void {
		if (!diff.added && !diff.removed) {
			this._removeRow(diff.path);
			this._syncVisibility();
			return;
		}
		let entry = this._rows.get(diff.path);
		if (!entry) {
			const store = new DisposableStore();
			const row = store.add(this._instantiationService.createInstance(OpenideChatFileRow, {
				className: 'openide-chat-files-row',
				onClick: () => this._openReview(diff.path),
			}));
			row.setFile(diff.path);
			row.setActions([
				{ icon: 'close', tooltip: () => t('chat.part.fileRevert'), tone: 'reject', run: () => this._resolve(diff.path, 'revert') },
				{ icon: 'check', tooltip: () => t('chat.part.fileKeep'), tone: 'accept', run: () => this._resolve(diff.path, 'keep') },
			]);
			append(this._body, row.domNode);
			entry = { row, store };
			this._rows.set(diff.path, entry);
		}
		entry.row.setStats({ added: diff.added, removed: diff.removed });
		this._syncVisibility();
	}

	private _createTextButton(parent: HTMLElement, className: string, label: string, tooltip: () => string, run: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>(`button.${className}`, { type: 'button' }));
		this._register(setupChatTooltip(this._hoverService, button, tooltip));
		append(button, $('span', undefined, label));
		this._register(addDisposableListener(button, 'click', (event: MouseEvent) => {
			event.stopPropagation();
			run();
		}));
		return button;
	}

	private _toggle(): void {
		this._expanded = !this._expanded;
		this._tray.setExpanded(this._expanded);
		this._onDidChangeHeight.fire();
	}

	private _openReview(path: string): void {
		if (!this._ownsPending(path)) { this._refresh(); return; }
		this._agentService.openDiff(path, undefined, getWindow(this._tray.domNode).vscodeWindowId).catch(error => this._reportError(error));
	}

	private _reviewFirst(): void {
		// First pending file, like the webview: Review is "take me to the changes", and the review
		// attaches to whatever the user then navigates to anyway.
		const first = this._rows.keys().next();
		if (!first.done) {
			this._openReview(first.value);
		}
	}

	/**
	 * The row disappears before the promise settles, on purpose. The agent service's accept path
	 * flushes a snapshot asynchronously, and a row that lingers invites a second click that
	 * accepts an already-forgotten baseline.
	 */
	private _ownsPending(path: string): boolean {
		const id = this.sessions.activeSessionId();
		return !!id && this._agentService.pendingFileDiffs(id).some(file => file.path === path);
	}

	private _resolve(path: string, signal: 'keep' | 'revert'): void {
		if (this._busy || !this._ownsPending(path)) { this._refresh(); return; }
		const operation = signal === 'keep' ? this._agentService.keepEdit(path) : this._agentService.revertEdit(path);
		operation.catch(error => this._reportError(error));
		this._onDidResolveFiles.fire({ paths: [path], signal });
		this._removeRow(path);
		this._syncVisibility();
	}

	/**
	 * ONE `keepEdits` call, not N `keepEdit`s: the service deletes the snapshots as a transaction
	 * and forces the flush before resolving, so a restart in the middle cannot leave half the files
	 * accepted and half still pending (the removed chat webview makes the same point).
	 */
	private _keepAll(): void {
		if (this._busy) { return; }
		const paths = [...this._rows.keys()].filter(path => this._ownsPending(path));
		if (!paths.length) {
			return;
		}
		this._agentService.keepEdits(paths).catch(error => this._reportError(error));
		this._onDidResolveFiles.fire({ paths, signal: 'keep' });
		for (const path of paths) {
			this._removeRow(path);
		}
		this._syncVisibility();
	}

	/** Revert has no batch entry point in the service, so it stays per-file like the webview. */
	private _revertAll(): void {
		for (const path of [...this._rows.keys()]) {
			this._resolve(path, 'revert');
		}
	}

	private _removeRow(path: string): void {
		const entry = this._rows.get(path);
		if (!entry) {
			return;
		}
		entry.row.domNode.remove();
		entry.store.dispose();
		this._rows.delete(path);
	}

	private _syncVisibility(): void {
		const empty = this.isEmpty;
		this.domNode.classList.toggle('hidden', empty);
		reset(this._count, empty ? '' : this._rows.size === 1 ? t('chat.files.one') : t('chat.files.many', this._rows.size));
		this._syncActions();
		this._onDidChangeHeight.fire();
	}

	private _syncActions(): void {
		for (const { row } of this._rows.values()) { row.setActionsEnabled(!this._busy); }
		this._undoAllButton.disabled = this._busy;
		this._keepAllButton.disabled = this._busy;
		this._stopButton.classList.toggle('hidden', !this._busy);
		this._undoAllButton.classList.toggle('hidden', this._busy);
		this._keepAllButton.classList.toggle('hidden', this._busy);
	}

	private _reportError(error: unknown): void {
		this._notificationService.error(error instanceof Error ? error.message : String(error));
	}

	override dispose(): void {
		for (const { store } of this._rows.values()) {
			store.dispose();
		}
		this._rows.clear();
		super.dispose();
	}
}
