/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, reset } from '../../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { FileKind } from '../../../../../../platform/files/common/files.js';
import { basenameForChat } from '../../../common/chat/openideChatToolMeta.js';
import '../media/openideChatFiles.css';

/**
 * The one row that shows "a file the agent touched".
 *
 * The webview paints this exact row TWICE, with two different sets of classes and two different
 * font sizes: `.part.edit-card .part-head` in the transcript (openideChatHtml.ts:341-347, 388-391)
 * and `.dock-file-row` in the dock tray (openideChatHtml.ts:945-952). Same grammar in both —
 * file icon, basename, ±N, trailing hover actions — so they drifted independently: the transcript
 * shows `+N` at 11.5px with the `nuevo` badge, the dock shows it at 11px with none, and a fix to
 * one never reached the other. Section 6.2 of the migration plan calls that out and asks for a
 * single primitive; this is it. The only surviving difference is the type scale, which the two
 * call sites set through `--oi-file-row-size` instead of forking the markup.
 *
 * It is deliberately NOT a diff viewer. The product decision (plan 6.2) is that the diff is
 * reviewed in the editor, so the row's job ends at "which file, how much, what can I do about it".
 */

export const OPENIDE_CHAT_FILE_ROW_CLASS = 'openide-chat-file-row';

export interface IOpenideChatFileStats {
	readonly added?: number;
	readonly removed?: number;
	/** Renders the `nuevo` badge. A created file is not "+N lines", it is a new file. */
	readonly created?: boolean;
}

export interface IOpenideChatFileRowAction {
	readonly icon: string;
	readonly tooltip: string;
	/** Tints the button on hover: `accept` green, `reject` red, absent stays neutral. */
	readonly tone?: 'accept' | 'reject';
	readonly run: () => void;
}

export interface IOpenideChatFileRowOptions {
	/** Extra class on the root, so the two call sites can key their own type scale off it. */
	readonly className?: string;
	/** Whole-row click. In both paintings this opens the file with its review attached. */
	readonly onClick?: () => void;
}

/**
 * Builds and keeps one file row up to date.
 *
 * Mutating an existing row rather than rebuilding it is not a micro-optimisation: the trailing
 * actions only appear on `:hover`, and replacing the node under the pointer makes the button the
 * user is about to click disappear between mousedown and mouseup.
 */
export class OpenideChatFileRow extends Disposable {

	readonly domNode: HTMLElement;

	private readonly _icon: HTMLElement;
	private readonly _name: HTMLElement;
	private readonly _stats: HTMLElement;
	private readonly _actions: HTMLElement;
	private readonly _actionStore = this._register(new DisposableStore());

	private _path = '';

	constructor(
		options: IOpenideChatFileRowOptions,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
	) {
		super();

		this.domNode = $(`div.${OPENIDE_CHAT_FILE_ROW_CLASS}${options.className ? `.${options.className}` : ''}`);
		this._icon = append(this.domNode, $('span.openide-chat-file-icon'));
		this._name = append(this.domNode, $('span.openide-chat-file-name'));
		this._stats = append(this.domNode, $('span.openide-chat-file-stats'));
		this._actions = append(this.domNode, $('span.openide-chat-file-actions'));
		// The icon theme keys TypeScript & co. on the LANGUAGE id, which is `unknown` until the
		// extension host registers languages after a restore. Re-resolving on change is what
		// turns the generic file glyph into the real one a second later.
		this._register(this._languageService.onDidChange(() => this._refreshIcon()));

		if (options.onClick) {
			const onClick = options.onClick;
			this.domNode.setAttribute('role', 'button');
			this.domNode.tabIndex = 0;
			this._register(addDisposableListener(this.domNode, 'click', () => onClick()));
			// Keyboard parity: the webview row is a div with a click handler and is unreachable
			// without a mouse. In the workbench that is an accessibility regression, not a port.
			this._register(addDisposableListener(this.domNode, 'keydown', (event: KeyboardEvent) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onClick();
				}
			}));
		}
	}

	get path(): string {
		return this._path;
	}

	setFile(path: string): void {
		if (this._path === path) {
			return;
		}
		this._path = path;
		// `URI.file('/' + path)` because the paths the agent reports are workspace-relative and the
		// icon theme only ever looks at the basename and the extension (openideChatView.ts:656 does
		// the same). Resolving the real URI would need a service the parts do not have, for nothing.
		this._refreshIcon();
		reset(this._name, basenameForChat(path));
		this._name.title = path;
	}

	/**
	 * Shimmers the filename while the write is still in flight (the webview's edit card at
	 * toolStart, Cursor's editing block): the card exists before the diff, and a still name on an
	 * unfinished write reads as a finished one.
	 */
	private _refreshIcon(): void {
		if (!this._path) {
			return;
		}
		this._icon.className = `openide-chat-file-icon ${getIconClasses(this._modelService, this._languageService, URI.file(`/${this._path}`), FileKind.FILE).join(' ')}`;
	}

	setPending(pending: boolean): void {
		this._name.classList.toggle('openide-chat-shimmer', pending);
	}

	setStats(stats: IOpenideChatFileStats): void {
		clearNode(this._stats);
		if (stats.created) {
			append(this._stats, $('span.openide-chat-file-badge', undefined, 'nuevo'));
		}
		if (stats.added) {
			append(this._stats, $('span.openide-chat-diff-added', undefined, `+${stats.added}`));
		}
		if (stats.removed) {
			// U+2212 MINUS SIGN, not a hyphen: the webview uses it so `+12` and `−12` line up in the
			// tabular-nums column. A hyphen is narrower and the two numbers visibly stagger.
			append(this._stats, $('span.openide-chat-diff-removed', undefined, `−${stats.removed}`));
		}
	}

	setActions(actions: readonly IOpenideChatFileRowAction[]): void {
		this._actionStore.clear();
		clearNode(this._actions);
		for (const action of actions) {
			const button = append(this._actions, $<HTMLButtonElement>('button.openide-chat-file-action', { type: 'button', title: action.tooltip }));
			button.setAttribute('aria-label', action.tooltip);
			if (action.tone) {
				button.classList.add(`openide-chat-file-action-${action.tone}`);
			}
			append(button, $(`span.codicon.codicon-${action.icon}`));
			this._actionStore.add(addDisposableListener(button, 'click', (event: MouseEvent) => {
				// Both paintings stop propagation here: the row itself opens the file, and an accept
				// that also opened an editor would fight the click that just resolved the row.
				event.preventDefault();
				event.stopPropagation();
				action.run();
			}));
		}
	}
}
