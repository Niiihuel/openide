/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { IMouseWheelEvent } from '../../../../../base/browser/mouseEvent.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { IListAccessibilityProvider } from '../../../../../base/browser/ui/list/listWidget.js';
import { IObjectTreeElement, ITreeContextMenuEvent, ITreeRenderer } from '../../../../../base/browser/ui/tree/tree.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { FuzzyScore } from '../../../../../base/common/filters.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ScrollEvent } from '../../../../../base/common/scrollable.js';
import { localize } from '../../../../../nls.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { WorkbenchObjectTree } from '../../../../../platform/list/browser/listService.js';
import { asCssVariable, editorBackground, foreground } from '../../../../../platform/theme/common/colorRegistry.js';
import { isOpenideChatMarkdownContent, isOpenideChatProgressContent } from '../../common/chat/openideChatContent.js';
import { IOpenideChatItem, isOpenideChatRequestItem, isOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { IOpenideChatListDelegateOptions, OpenideChatListDelegate } from './openideChatListDelegate.js';

export interface IOpenideChatListStyles {
	/** Fed to every list state override so focus/hover/selection are invisible in the transcript. */
	readonly listBackground?: string;
	readonly listForeground?: string;
}

export interface IOpenideChatListWidgetOptions {
	/** Built by the caller: this widget owns the tree, not the row templates. */
	readonly renderers: readonly ITreeRenderer<IOpenideChatItem, FuzzyScore, unknown>[];
	readonly delegateOptions?: IOpenideChatListDelegateOptions;
	readonly styles?: IOpenideChatListStyles;
}

/** Number of pixels of slack allowed before the list stops counting as "at the bottom". */
const AT_BOTTOM_TOLERANCE = 2;

/**
 * Large enough that `reveal` always lands past the end of the last row, however tall it grew
 * mid-stream. Same trick as upstream's chat list.
 */
const REVEAL_END_OFFSET = 1e6;

class OpenideChatListAccessibilityProvider implements IListAccessibilityProvider<IOpenideChatItem> {

	getWidgetAriaLabel(): string {
		return localize('openide.chat.list.widget', "OpenIDE chat transcript");
	}

	/** Only the two kinds Stage 1 renders speak; the rest degrade to the turn's prose. */
	getAriaLabel(element: IOpenideChatItem): string {
		if (isOpenideChatRequestItem(element)) {
			return localize('openide.chat.list.request', "You: {0}", element.displayText ?? element.text);
		}
		const spoken = element.content
			.map(content => isOpenideChatMarkdownContent(content) ? content.value.value
				: isOpenideChatProgressContent(content) ? content.text : '')
			.filter(text => text.length > 0)
			.join('\n');
		return localize('openide.chat.list.response', "Assistant: {0}", spoken);
	}
}

/**
 * The virtualized transcript.
 *
 * Configuration ported from `ChatListWidget` (contrib/chat/browser/widget/chatListWidget.ts:363-400,
 * 544-570, 655-658; VS Code 1.121.1). It is intentionally the only place in the native chat that
 * knows about `WorkbenchObjectTree`: everything above it speaks `IOpenideChatItem`.
 */
export class OpenideChatListWidget extends Disposable {

	private readonly _onDidScroll = this._register(new Emitter<ScrollEvent>());
	readonly onDidScroll: Event<ScrollEvent> = this._onDidScroll.event;

	private readonly _onDidChangeContentHeight = this._register(new Emitter<number>());
	readonly onDidChangeContentHeight: Event<number> = this._onDidChangeContentHeight.event;

	private readonly _onDidChangeFollowTail = this._register(new Emitter<boolean>());
	/** Fires when the transcript attaches to or detaches from the tail. */
	readonly onDidChangeFollowTail: Event<boolean> = this._onDidChangeFollowTail.event;

	private readonly _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus: Event<void> = this._onDidFocus.event;

	private readonly _onContextMenu = this._register(new Emitter<ITreeContextMenuEvent<IOpenideChatItem | null>>());
	/** Raised as-is: the menu itself belongs to the controller, which owns the actions. */
	readonly onContextMenu: Event<ITreeContextMenuEvent<IOpenideChatItem | null>> = this._onContextMenu.event;

	private readonly _container: HTMLElement;
	private readonly _tree: WorkbenchObjectTree<IOpenideChatItem, FuzzyScore>;
	private readonly _scrollDownButton: Button;

	private _items: readonly IOpenideChatItem[] = [];
	private _lastItem: IOpenideChatItem | undefined;
	private _visible = true;
	private _followTail = true;
	private _suppressAutoScroll = false;
	/**
	 * Set while this widget is itself mutating the tree. Growing content fires a scroll event with
	 * an unchanged `scrollTop`, and reading that as "the user scrolled up" would detach the tail on
	 * every streamed token.
	 */
	private _mutating = false;
	private _visibleChangeCount = 0;
	private _refreshEpoch = 0;

	get domNode(): HTMLElement { return this._container; }
	get contentHeight(): number { return this._tree.contentHeight; }
	get renderHeight(): number { return this._tree.renderHeight; }
	get scrollHeight(): number { return this._tree.scrollHeight; }
	get scrollTop(): number { return this._tree.scrollTop; }
	set scrollTop(value: number) { this._tree.scrollTop = value; }
	get lastItem(): IOpenideChatItem | undefined { return this._lastItem; }
	get isFollowingTail(): boolean { return this._followTail; }

	get isScrolledToBottom(): boolean {
		return this._tree.scrollTop + this._tree.renderHeight >= this._tree.scrollHeight - AT_BOTTOM_TOLERANCE;
	}

	constructor(
		parent: HTMLElement,
		options: IOpenideChatListWidgetOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this._container = append(parent, $('.openide-chat-list'));

		const scopedInstantiationService = this._register(instantiationService.createChild(
			new ServiceCollection([IContextKeyService, contextKeyService])
		));

		const styles = options.styles ?? {};
		this._tree = this._register(scopedInstantiationService.createInstance(
			WorkbenchObjectTree<IOpenideChatItem, FuzzyScore>,
			'OpenideChatList',
			this._container,
			new OpenideChatListDelegate(options.delegateOptions),
			options.renderers.slice(),
			{
				identityProvider: { getId: (element: IOpenideChatItem) => element.id },
				// R3: `supportDynamicHeights` and `horizontalScrolling` cannot both be on —
				// listView.ts:382-384 throws. Rows never widen the list, so anything that can
				// overflow (code blocks, tables, diagrams) has to scroll inside its own container.
				horizontalScrolling: false,
				supportDynamicHeights: true,
				alwaysConsumeMouseWheel: false,
				hideTwistiesOfChildlessElements: true,
				// Rows draw their own text: a list-imposed line height clips multi-line markdown.
				setRowLineHeight: false,
				accessibilityProvider: new OpenideChatListAccessibilityProvider(),
				overrideStyles: {
					listFocusBackground: styles.listBackground,
					listInactiveFocusBackground: styles.listBackground,
					listActiveSelectionBackground: styles.listBackground,
					listFocusAndSelectionBackground: styles.listBackground,
					listInactiveSelectionBackground: styles.listBackground,
					listHoverBackground: styles.listBackground,
					listBackground: styles.listBackground,
					listFocusForeground: styles.listForeground,
					listHoverForeground: styles.listForeground,
					listInactiveFocusForeground: styles.listForeground,
					listInactiveSelectionForeground: styles.listForeground,
					listActiveSelectionForeground: styles.listForeground,
					listFocusAndSelectionForeground: styles.listForeground,
					listActiveSelectionIconForeground: undefined,
					listInactiveSelectionIconForeground: undefined,
				},
			}
		));

		// The webview's `#jumpDown` is INVERTED — `background: var(--vscode-foreground); color:
		// var(--vscode-editor-background)` — and `Button` writes its colours as inline styles, which
		// no stylesheet can override. So the palette is handed to the widget instead of to CSS.
		this._scrollDownButton = this._register(new Button(this._container, {
			buttonBackground: asCssVariable(foreground),
			buttonForeground: asCssVariable(editorBackground),
			buttonHoverBackground: asCssVariable(foreground),
			buttonSecondaryBackground: undefined,
			buttonSecondaryForeground: undefined,
			buttonSecondaryHoverBackground: undefined,
			buttonSeparator: undefined,
			supportIcons: true,
			title: localize('openide.chat.list.scrollDown', "Go to the end of the conversation"),
		}));
		this._scrollDownButton.element.classList.add('openide-chat-scroll-down');
		// `arrow-down`, not `chevron-down`: the webview's `#jumpDown` uses the arrow, and the two
		// glyphs read differently at 14px inside a filled circle.
		this._scrollDownButton.label = `$(${Codicon.arrowDown.id})`;
		this._register(this._scrollDownButton.onDidClick(() => {
			this.setFollowTail(true);
			this.scrollToEnd();
		}));

		this._register(this._tree.onDidScroll(event => {
			if (!this._mutating) {
				this.setFollowTail(this.isScrolledToBottom);
			}
			this._onDidScroll.fire(event);
			this.updateScrollDownButton();
		}));
		this._register(this._tree.onDidChangeContentHeight(height => this._onDidChangeContentHeight.fire(height)));
		this._register(this._tree.onDidFocus(() => this._onDidFocus.fire()));
		this._register(this._tree.onContextMenu(event => this._onContextMenu.fire(event)));

		this.updateScrollDownButton();
	}

	/**
	 * The single repaint trigger of the transcript (R4).
	 *
	 * `setChildren` compares the string this returns against the previous render and only rebuilds
	 * the rows whose value moved. `dataId` already folds the item's version and its `_done` flag,
	 * so under normal streaming it changes on every delta — the extra terms below cover the two
	 * ways a row can need a repaint without the reducer having advanced a version.
	 *
	 * The failure mode when this is wrong is the reason it is written out longhand instead of
	 * inline: nothing throws, nothing logs, the response simply stops updating on screen while the
	 * model keeps streaming underneath.
	 *
	 * `currentRenderedHeight` is deliberately NOT part of the identity. Feeding a measured height
	 * back in would re-render the row that just reported it, which is the layout loop.
	 */
	private computeDiffIdentity(element: IOpenideChatItem): string {
		const parts = [element.dataId, `r${this._refreshEpoch}`];
		if (isOpenideChatResponseItem(element)) {
			// Belt and braces: a reducer path that appends content without bumping `version` would
			// otherwise be invisible here, and invisible is exactly the problem.
			parts.push(`c${element.content.length}`);
			parts.push(element.isCanceled ? 'x1' : 'x0');
			parts.push(element.errorMessage ? 'e1' : 'e0');
			if (!element.isComplete) {
				// A reply mid-stream has to restart its progressive rendering when the view is
				// hidden and shown again; complete replies are left alone so toggling visibility
				// does not splice a 200-message conversation.
				parts.push(`v${this._visibleChangeCount}`);
			}
		}
		return parts.join('_');
	}

	setItems(items: readonly IOpenideChatItem[]): void {
		this._items = items;
		this._lastItem = items.at(-1);

		const children: IObjectTreeElement<IOpenideChatItem>[] = items.map(element => ({
			element,
			collapsible: false,
			collapsed: false,
		}));

		this.withPersistedAutoScroll(() => {
			this._tree.setChildren(null, children, {
				diffIdentityProvider: { getId: element => this.computeDiffIdentity(element) },
			});
		});
	}


	getItems(): readonly IOpenideChatItem[] {
		return this._items;
	}

	/** Forces every row to repaint, e.g. after a renderer-affecting setting changed. */
	rerenderAll(): void {
		this._refreshEpoch++;
		this.setItems(this._items);
	}

	/**
	 * Called by the row renderers once a row's height changed. `element` must be the object the
	 * renderer was handed by the tree, not a fresh snapshot of the same turn: the tree indexes its
	 * nodes by object identity, so any other copy resolves to nothing and the row keeps its stale
	 * height. The guard also covers a measurement landing after the row was spliced out.
	 */
	updateItemHeight(element: IOpenideChatItem, height?: number): void {
		if (!this._visible || !this._tree.hasElement(element)) {
			return;
		}
		this.withPersistedAutoScroll(() => this._tree.updateElementHeight(element, height));
	}

	/**
	 * The scroll lock. Any mutation that can change the content height goes through here: if the
	 * user was pinned to the bottom before it, they stay pinned after it; if they had scrolled up
	 * to read, their position is left exactly where it was.
	 */
	private withPersistedAutoScroll(fn: () => void): void {
		if (this._suppressAutoScroll) {
			fn();
			return;
		}
		const wasFollowing = this._followTail || this.isScrolledToBottom;
		this._mutating = true;
		try {
			fn();
			// INSIDE the guard, and that is the whole point of this change.
			//
			// `_mutating` says "this scroll event is mine, not the user's". It used to cover only
			// `fn()`, so the scroll caused by our OWN `scrollToEnd` was read as user intent — and
			// `reveal` routinely lands a few pixels short, because the row that just arrived has not
			// been measured yet and the tree is revealing it against an estimate. `isScrolledToBottom`
			// then answered false, the tail detached, and it never re-attached: every later
			// measurement found `wasFollowing === false` and stopped re-pinning.
			//
			// The symptom was that the model's reply appeared BELOW the fold — for a virtualised list
			// that means not rendered at all — while the run had completed perfectly.
			if (wasFollowing) {
				this.scrollToEnd();
			}
		} finally {
			this._mutating = false;
		}
		this.updateScrollDownButton();
	}

	setFollowTail(value: boolean): void {
		if (this._followTail === value) {
			return;
		}
		this._followTail = value;
		this.updateScrollDownButton();
		this._onDidChangeFollowTail.fire(value);
	}

	/**
	 * Suspends the tail-following for the duration of a bulk operation (restoring a conversation,
	 * a rollback) where scrolling to the end on every intermediate step would fight the caller.
	 */
	set suppressAutoScroll(value: boolean) {
		this._suppressAutoScroll = value;
	}

	/**
	 * Reveals the object the TREE holds for the tail row, not the snapshot this widget last
	 * received. With a `diffIdentityProvider` in play, `setChildren` keeps the previous node
	 * whenever the identity is unchanged (objectTree.ts:27-35), so the two are not always the same
	 * object — and revealing a snapshot the tree never adopted silently does nothing, which shows
	 * up as the transcript losing the bottom after a resize.
	 */
	scrollToEnd(): void {
		const last = this._tree.getNode(null).children.at(-1)?.element;
		if (!last) {
			return;
		}
		this._tree.reveal(last, Math.max(last.currentRenderedHeight ?? 0, REVEAL_END_OFFSET));
	}

	private updateScrollDownButton(): void {
		const atBottom = this._followTail || this.isScrolledToBottom;
		this._scrollDownButton.element.style.display = atBottom ? 'none' : '';
		this._container.classList.toggle('openide-chat-list-at-bottom', atBottom);
	}

	reveal(element: IOpenideChatItem, relativeTop?: number): void {
		if (this._tree.hasElement(element)) {
			this._tree.reveal(element, relativeTop);
		}
	}

	hasElement(element: IOpenideChatItem): boolean {
		return this._tree.hasElement(element);
	}

	getFocus(): IOpenideChatItem[] {
		return this._tree.getFocus().filter((element): element is IOpenideChatItem => element !== null);
	}

	setFocus(elements: IOpenideChatItem[]): void {
		this._tree.setFocus(elements);
	}

	focus(): void {
		this._tree.domFocus();
	}

	isDOMFocused(): boolean {
		return this._tree.isDOMFocused();
	}

	/** Lets the composer hand a wheel gesture over to the transcript instead of eating it. */
	delegateScrollFromMouseWheelEvent(event: IMouseWheelEvent): void {
		this._tree.delegateScrollFromMouseWheelEvent(event);
	}

	setVisible(visible: boolean): void {
		if (this._visible === visible) {
			return;
		}
		this._visible = visible;
		if (visible) {
			// Bumped only on the way in, so the identity of a streaming reply changes exactly once
			// per re-show and its progressive rendering restarts from a known state.
			this._visibleChangeCount++;
			this.setItems(this._items);
		}
	}

	layout(height: number, width: number): void {
		this.withPersistedAutoScroll(() => this._tree.layout(height, width));
	}
}
