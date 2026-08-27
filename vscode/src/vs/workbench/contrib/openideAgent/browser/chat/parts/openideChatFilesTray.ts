/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, reset } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
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

const STOP_KEYBINDING = 'Ctrl+Shift+Backspace';

/**
 * The turn's changed files: the webview's `files-tray` (openideChatHtml.ts:4406-4483) on workbench
 * DOM.
 *
 * It is not a content part and it is not per-turn state, which is the one thing about it that is
 * easy to get wrong. What it shows is the set of files with a PENDING snapshot — files the agent
 * changed and the user has not accepted or reverted yet — and that set survives runs, restarts and
 * conversation switches (`pendingFileDiffs()` restores it from workspace storage). Modelling it as
 * a row inside the transcript would tie a workspace-wide, still-actionable state to a turn that
 * has already scrolled away.
 *
 * Its rows are the same `OpenideChatFileRow` the edit card uses; the only difference is the type
 * scale and the two hover actions. That is the unification section 6.2 asks for.
 */
export class OpenideChatFilesTray extends Disposable {

	readonly domNode: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	/** The tray sits between transcript and composer, so appearing and going changes the layout. */
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private readonly _onDidRequestStop = this._register(new Emitter<void>());
	readonly onDidRequestStop: Event<void> = this._onDidRequestStop.event;

	private readonly _onDidResolveFiles = this._register(new Emitter<IOpenideChatFilesResolved>());
	readonly onDidResolveFiles: Event<IOpenideChatFilesResolved> = this._onDidResolveFiles.event;

	private readonly _count: HTMLElement;
	private readonly _chevron: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _stopButton: HTMLButtonElement;
	private readonly _undoAllButton: HTMLButtonElement;
	private readonly _keepAllButton: HTMLButtonElement;

	private readonly _rows = new Map<string, { row: OpenideChatFileRow; store: DisposableStore }>();
	private _expanded = true;
	private _busy = false;

	constructor(
		parent: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this.domNode = append(parent, $('div.openide-chat-files-tray.hidden'));
		const head = append(this.domNode, $('div.openide-chat-files-head'));

		const toggle = append(head, $<HTMLButtonElement>('button.openide-chat-files-toggle', { type: 'button' }));
		this._chevron = append(toggle, $('span.codicon.codicon-chevron-down'));
		this._count = append(toggle, $('span.openide-chat-files-count'));
		this._register(addDisposableListener(toggle, 'click', () => this._toggle()));

		append(head, $('span.openide-chat-files-spacer'));
		const actions = append(head, $('span.openide-chat-files-actions'));

		this._stopButton = this._createTextButton(actions, 'openide-chat-files-stop', 'Stop', 'Stop', () => this._onDidRequestStop.fire());
		append(this._stopButton, $('span.openide-chat-files-kbd', undefined, STOP_KEYBINDING));
		this._undoAllButton = this._createTextButton(actions, 'openide-chat-files-bulk', 'Undo All', 'Deshacer todos los cambios', () => this._revertAll());
		this._keepAllButton = this._createTextButton(actions, 'openide-chat-files-bulk', 'Keep All', 'Conservar todos los cambios', () => this._keepAll());
		this._createTextButton(actions, 'openide-chat-files-review', 'Review', 'Revisar cambios en el editor', () => this._reviewFirst());

		this._body = append(this.domNode, $('div.openide-chat-files-body'));

		this._register(this._agentService.onDidChangeFileDiff(diff => this.update(diff)));
		// The snapshot outlives the window: without this the tray is empty after a reload even
		// though the workspace still has unaccepted changes waiting in it.
		this.reset(this._agentService.pendingFileDiffs());
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
	 * file with nothing left to accept (openideChatHtml.ts:4407-4413).
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
				{ icon: 'close', tooltip: 'Reject', tone: 'reject', run: () => this._resolve(diff.path, 'revert') },
				{ icon: 'check', tooltip: 'Accept', tone: 'accept', run: () => this._resolve(diff.path, 'keep') },
			]);
			append(this._body, row.domNode);
			entry = { row, store };
			this._rows.set(diff.path, entry);
		}
		entry.row.setStats({ added: diff.added, removed: diff.removed });
		this._syncVisibility();
	}

	private _createTextButton(parent: HTMLElement, className: string, label: string, tooltip: string, run: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>(`button.${className}`, { type: 'button', title: tooltip }));
		button.setAttribute('aria-label', tooltip);
		append(button, $('span', undefined, label));
		this._register(addDisposableListener(button, 'click', (event: MouseEvent) => {
			event.stopPropagation();
			run();
		}));
		return button;
	}

	private _toggle(): void {
		this._expanded = !this._expanded;
		this._chevron.className = `codicon codicon-${this._expanded ? 'chevron-down' : 'chevron-right'}`;
		this._body.classList.toggle('hidden', !this._expanded);
		this._onDidChangeHeight.fire();
	}

	private _openReview(path: string): void {
		this._agentService.openDiff(path).catch(error => this._reportError(error));
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
	private _resolve(path: string, signal: 'keep' | 'revert'): void {
		const operation = signal === 'keep' ? this._agentService.keepEdit(path) : this._agentService.revertEdit(path);
		operation.catch(error => this._reportError(error));
		this._onDidResolveFiles.fire({ paths: [path], signal });
		this._removeRow(path);
		this._syncVisibility();
	}

	/**
	 * ONE `keepEdits` call, not N `keepEdit`s: the service deletes the snapshots as a transaction
	 * and forces the flush before resolving, so a restart in the middle cannot leave half the files
	 * accepted and half still pending (openideChatHtml.ts:4500-4510 makes the same point).
	 */
	private _keepAll(): void {
		const paths = [...this._rows.keys()];
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
		reset(this._count, empty ? '' : `${this._rows.size} ${this._rows.size === 1 ? 'File' : 'Files'}`);
		this._syncActions();
		this._onDidChangeHeight.fire();
	}

	private _syncActions(): void {
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
