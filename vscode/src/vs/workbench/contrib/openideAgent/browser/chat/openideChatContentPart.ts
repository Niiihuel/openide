/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../../base/common/observable.js';
import { IOpenideChatContent } from '../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../common/chat/openideChatItem.js';

/**
 * One renderable chunk of a row.
 *
 * Same shape as `IChatContentPart` (contrib/chat/browser/widget/chatContentParts/chatContentParts.ts:17)
 * but re-typed on our own contract: upstream's `hasSameContent` takes `IChatRendererContent` and
 * `ChatTreeItem`, which would force every OpenIDE part to be typed on Copilot's ChatViewModel.
 * The behaviour is copied, the coupling is not.
 */
export interface IOpenideChatContentPart extends IDisposable {
	/**
	 * Undefined means "render nothing": a part may legitimately decide it has no row (a progress
	 * line that some later content already superseded), and the renderer skips appending it.
	 */
	readonly domNode: HTMLElement | undefined;

	/**
	 * Fires when the part grew or shrank on its own — async code block tokenization, an image
	 * finishing to load. Without it the list keeps the stale measured height and the row clips.
	 */
	readonly onDidChangeHeight?: Event<void>;

	/**
	 * True when `other` is already what is on screen, so the renderer can leave the DOM alone.
	 *
	 * Must be side-effect free. `followingContent` is everything that will be rendered after this
	 * part: a part whose look depends on what comes next (a spinner that must stop once a real
	 * row lands below it) can only answer correctly by looking at it.
	 */
	hasSameContent(other: IOpenideChatContent, followingContent: readonly IOpenideChatContent[], element: IOpenideChatItem): boolean;

	/**
	 * Absorbs `other` in place and returns true, or returns false to be recreated.
	 *
	 * This exists because `hasSameContent` is a pure query, and streaming needs a third answer
	 * between "identical" and "throw the part away": markdown grows by a few characters per
	 * delta, and rebuilding the part for each one loses focus, selection and every listener.
	 * The renderer's loop is: same content → keep; else tryUpdate → keep; else recreate.
	 */
	tryUpdate?(other: IOpenideChatContent, element: IOpenideChatItem): boolean;

	/** Called when the row is re-attached after the list virtualized it away. */
	onDidRemount?(): void;

	addDisposable?(disposable: IDisposable): void;
}

/**
 * What a part gets to render itself.
 *
 * `currentWidth` is an observable and not a number because parts that reflow (tables, code
 * blocks) must react to a resize without the renderer re-creating them.
 */
export interface IOpenideChatContentPartContext {
	readonly element: IOpenideChatItem;
	readonly elementIndex: number;
	/** The row's DOM host. Parts append to it; they must not clear it, siblings live there too. */
	readonly container: HTMLElement;
	readonly content: readonly IOpenideChatContent[];
	readonly contentIndex: number;
	readonly currentWidth: IObservable<number>;
	/** False while the row is scrolled out of view; expensive parts pause on it. */
	readonly onDidChangeVisibility: Event<boolean>;
	/** `openide.chat.tools.defaultExpanded`: tool result bodies and explore groups start open. */
	readonly toolsDefaultExpanded?: boolean;
	/** `openide.chat.thinking.defaultOpen`: the reasoning card stays open once the turn settles. */
	readonly thinkingDefaultOpen?: boolean;
}

/**
 * Shared plumbing for parts: the height emitter and the late-disposable escape hatch.
 *
 * Not merged into the interface on purpose — the renderer only ever depends on
 * `IOpenideChatContentPart`, so a part is free to implement it without extending this class.
 */
export abstract class OpenideChatContentPart extends Disposable implements IOpenideChatContentPart {

	protected readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	/**
	 * Disposables handed over after construction (a hover attached on first paint, a listener
	 * registered on remount). Kept separate so a part can clear them without disposing itself.
	 */
	private readonly _lateDisposables = this._register(new DisposableStore());

	abstract readonly domNode: HTMLElement | undefined;

	abstract hasSameContent(other: IOpenideChatContent, followingContent: readonly IOpenideChatContent[], element: IOpenideChatItem): boolean;

	addDisposable(disposable: IDisposable): void {
		this._lateDisposables.add(disposable);
	}

	protected clearLateDisposables(): void {
		this._lateDisposables.clear();
	}
}

/*
 * The fallback for an unmapped kind used to live here as `OpenideChatEmptyContentPart`, whose
 * whole body was `domNode = undefined`. That is why a kind the reducer emitted but the renderer
 * could not draw showed up as a blank gap and nothing else: no card, no error, no log line. It has
 * been replaced by `parts/openideChatUnrenderedPart.ts`, which reports the gap. Do not reintroduce
 * a silent one — `domNode: undefined` is for parts that legitimately have nothing to draw, never
 * for parts that failed to.
 */
