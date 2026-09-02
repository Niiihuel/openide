/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { OpenideDiffLine } from '../common/openideDiffPreview.js';
import { appendOpenideDiffLines } from './openideDiffLines.js';
import { OpenideFold } from './openideFold.js';
import './media/openideDiff.css';

export interface IOpenideDiffBlockInput {
	/** Workspace-relative path; only its extension matters, it picks the grammar. */
	readonly path: string;
	readonly lines: readonly OpenideDiffLine[];
	/** A created file diffs against nothing: its phantom empty "removed" line is dropped. */
	readonly created?: boolean;
}

/**
 * The inline diff block — the harness's own way of showing a change: a few rows at rest, a fade,
 * a chevron that only appears when there is more underneath, the workbench scrollbar over it.
 *
 * It used to be private to the transcript's edit card (`OpenideChatEditPart`), which meant the
 * Agent Changes view — the other place a change is shown — could not draw it and sent the reader
 * to a side-by-side editor tab instead. Same product, two ways of showing the same diff. This is
 * the single block both mount; the card and the sidebar row only decide WHEN to show it.
 *
 * DOM: `div.openide-diff-block.openide-fold[.has-diff][.open][.needs-expand]` holding the scrollable
 * `.openide-diff` from `appendOpenideDiffLines`, plus the fade and the chevron `OpenideFold`
 * mounts. State lives on the root's classes so the stylesheet reads the truth, not a copy of it.
 */
export class OpenideDiffBlock extends Disposable {

	readonly domNode: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	/** Fired when the block grew or shrank: hosts inside a virtual list re-measure on it. */
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private readonly _fold: OpenideFold;
	private readonly _tokens = this._register(new MutableDisposable<CancellationTokenSource>());
	/** The workbench scrollbar over the diff — the IDE's own, never Chromium's. */
	private readonly _scrollable = this._register(new MutableDisposable<DomScrollableElement>());
	private _rendered: readonly OpenideDiffLine[] | undefined;

	constructor(
		@ILanguageService private readonly _languageService: ILanguageService,
		@IHoverService hoverService: IHoverService,
	) {
		super();
		this.domNode = $('div.openide-diff-block');
		this._fold = this._register(new OpenideFold(this.domNode, hoverService, {
			// The rows, not the scrollable's box: the scrollable is already capped at the collapsed height.
			measure: () => {
				let height = 0;
				for (const row of this.domNode.querySelector('.openide-diff')?.children ?? []) {
					height += row.getBoundingClientRect().height;
				}
				return height;
			},
		}));
		this._register(this._fold.onDidChangeHeight(() => {
			this._scrollable.value?.scanDomNode();
			this._onDidChangeHeight.fire();
		}));
	}

	get hasDiff(): boolean {
		return this.domNode.classList.contains('has-diff');
	}

	get isOpen(): boolean {
		return this._fold.isOpen;
	}

	/**
	 * Paints a diff, or clears the block when there is none. Keyed on the identity of `lines`:
	 * the card streams updates, and re-tokenizing the same rows on every event is what made the
	 * old body flicker under the pointer.
	 */
	setDiff(input: IOpenideDiffBlockInput | undefined): void {
		const lines = input?.lines;
		if (lines === this._rendered) {
			return;
		}
		this._rendered = lines;
		this._tokens.value = undefined;
		this._scrollable.value = undefined;
		this.domNode.replaceChildren();
		this.domNode.classList.toggle('has-diff', !!lines?.length);
		if (!input || !lines?.length) {
			this._fold.mount();
			this._fold.reset();
			this._onDidChangeHeight.fire();
			return;
		}
		const tokens = new CancellationTokenSource();
		this._tokens.value = tokens;
		const diff = appendOpenideDiffLines(this.domNode, input.path, lines, !!input.created, this._languageService, tokens.token, () => this._scrollable.value?.scanDomNode());
		const scrollable = new DomScrollableElement(diff, {
			vertical: ScrollbarVisibility.Auto,
			horizontal: ScrollbarVisibility.Auto,
			useShadows: false,
			horizontalScrollbarSize: 8,
			verticalScrollbarSize: 8,
		});
		this._scrollable.value = scrollable;
		scrollable.getDomNode().classList.add('openide-diff-scroll');
		append(this.domNode, scrollable.getDomNode());
		this._fold.mount();
		this._fold.reset();
		this._onDidChangeHeight.fire();
	}

	toggleOpen(): void {
		this._fold.toggle();
	}

	setOpen(open: boolean): void {
		this._fold.setOpen(open);
	}
}
