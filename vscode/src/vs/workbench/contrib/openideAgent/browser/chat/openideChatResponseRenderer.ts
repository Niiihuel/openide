/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, reset } from '../../../../../base/browser/dom.js';
import { ITreeNode, ITreeRenderer } from '../../../../../base/browser/ui/tree/tree.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { FuzzyScore } from '../../../../../base/common/filters.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../../base/common/observable.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { OPENIDE_CHAT_THINKING_OPEN_KEY, OPENIDE_CHAT_TOOLS_EXPANDED_KEY, OPENIDE_CHAT_WORKING_INDICATOR_KEY } from '../../common/chat/openideChatConfig.js';
import { IOpenideChatContent, isOpenideChatContentOfKind, isOpenideChatMarkdownContent, isOpenideChatProgressContent, isOpenideChatThinkingContent, isOpenideChatToolContent } from '../../common/chat/openideChatContent.js';
import { IOpenideChatItem, IOpenideChatResponseItem, isOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { isOpenideChatLiveTail, openideChatLiveStatusLabel } from '../../common/chat/openideChatLiveStatus.js';
import { IOpenideChatContentPart, IOpenideChatContentPartContext } from './openideChatContentPart.js';
import { OpenideChatStatusLine } from './openideChatStatusLine.js';
import { OPENIDE_CHAT_RESPONSE_TEMPLATE_ID } from './openideChatListDelegate.js';
import { OpenideChatMarkdownRenderer } from './openideChatMarkdown.js';
import { OpenideChatCanvasPart } from './parts/openideChatCanvasPart.js';
import { OpenideChatCompactionPart } from './parts/openideChatCompactionPart.js';
import { OpenideChatDelegationPart } from './parts/openideChatDelegationPart.js';
import { OpenideChatDiagramPart } from './parts/openideChatDiagramPart.js';
import { OpenideChatEditPart } from './parts/openideChatEditPart.js';
import { OpenideChatExplorePart } from './parts/openideChatExplorePart.js';
import { OpenideChatMarkdownPart } from './parts/openideChatMarkdownPart.js';
import { OpenideChatModeSuggestionPart } from './parts/openideChatModeSuggestionPart.js';
import { OpenideChatDecisionPart, OpenideChatNoticePart } from './parts/openideChatNoticePart.js';
import { OpenideChatPlanPart } from './parts/openideChatPlanPart.js';
import { OpenideChatPlanUpdatePart } from './parts/openideChatPlanUpdatePart.js';
import { OpenideChatProgressPart } from './parts/openideChatProgressPart.js';
import { OpenideChatScreenshotPart } from './parts/openideChatScreenshotPart.js';
import { OpenideChatSubagentPart } from './parts/openideChatSubagentPart.js';
import { OpenideChatTerminalPart } from './parts/openideChatTerminalPart.js';
import { OpenideChatThinkingPart } from './parts/openideChatThinkingPart.js';
import { OpenideChatAskPart } from './parts/openideChatAskPart.js';
import { OpenideChatConfirmationPart } from './parts/openideChatConfirmationPart.js';
import { OpenideChatAccountChoicePart } from './parts/openideChatAccountChoicePart.js';
import { OpenideChatTodosPart } from './parts/openideChatTodosPart.js';
import { OpenideChatToolPart } from './parts/openideChatToolPart.js';
import { OpenideChatUnrenderedContentPart } from './parts/openideChatUnrenderedPart.js';

export interface IOpenideChatItemHeightChange {
	readonly element: IOpenideChatItem;
	readonly height: number;
}

export interface IOpenideChatResponseTemplate {
	readonly row: HTMLElement;
	readonly partsHost: HTMLElement;
	/** The turn's ONE live line: the step in flight, swapped in place. See `_renderStatus`. */
	readonly status: OpenideChatStatusLine;
	readonly footer: HTMLElement;
	readonly templateDisposables: DisposableStore;
	/** Parallel to the item's `content`, index by index. Owned by the template, not the element. */
	parts: IOpenideChatContentPart[];
	currentElement: IOpenideChatResponseItem | undefined;
	/**
	 * Which turn the parts above belong to. Survives `disposeElement`, unlike `currentElement`:
	 * the whole point of keeping the parts around is to reuse them on the NEXT render, and the
	 * list hands a recycled template to whatever row needs one — including another turn's.
	 */
	renderedId: string | undefined;
}

/**
 * The assistant's turn.
 *
 * The row keeps its content parts alive across renders and diffs them one by one, because a
 * streamed reply re-renders on every delta: rebuilding the subtree each time would drop the text
 * selection the user is making while reading and re-tokenize every code block from scratch.
 */
export class OpenideChatResponseRenderer extends Disposable implements ITreeRenderer<IOpenideChatItem, FuzzyScore, IOpenideChatResponseTemplate> {

	readonly templateId: string = OPENIDE_CHAT_RESPONSE_TEMPLATE_ID;

	private readonly _onDidChangeItemHeight = this._register(new Emitter<IOpenideChatItemHeightChange>());
	/** The widget forwards this to the list; a row that grows after its measurement clips. */
	readonly onDidChangeItemHeight: Event<IOpenideChatItemHeightChange> = this._onDidChangeItemHeight.event;

	private readonly _markdownRenderer: OpenideChatMarkdownRenderer;

	/**
	 * Set while `renderElement` runs. Reporting a height from inside the tree's own render pass
	 * makes the list re-enter the row it is painting, which is the layout loop.
	 */
	private _elementBeingRendered: IOpenideChatItem | undefined;

	/**
	 * Rows whose height changed DURING the render pass, to be reported once it is over.
	 *
	 * Deferring instead of dropping is the whole point. A part that grows from `tryUpdate` — the
	 * todos card gaining an item, a terminal card gaining output — grows inside the pass, so the
	 * re-entrancy guard below used to swallow its report and the list kept the row at its previous
	 * size. `.monaco-list-row` is `overflow: hidden`, so the card came out clipped by exactly the
	 * amount it had grown: its bottom border and the gap to the next row simply were not there.
	 * Collapsing the card and reopening it fixed the row, which is what gave the cause away — that
	 * toggle fires from a click, outside any pass, so its report was never dropped.
	 */
	private readonly _deferredHeights = new Map<IOpenideChatResponseTemplate, IOpenideChatResponseItem>();

	constructor(
		private readonly _currentWidth: IObservable<number>,
		private readonly _onDidChangeVisibility: Event<boolean>,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		// Not registered: the renderer holds no state of its own, every disposable it produces is
		// owned by the `IRenderedMarkdown` the part keeps.
		this._markdownRenderer = this._instantiationService.createInstance(OpenideChatMarkdownRenderer);
	}

	renderTemplate(container: HTMLElement): IOpenideChatResponseTemplate {
		const templateDisposables = new DisposableStore();
		const row = append(container, $('.openide-chat-row.openide-chat-row-response'));
		const partsHost = append(row, $('.openide-chat-response-parts'));
		// Cursor-style live line: lives OUTSIDE partsHost so the content diffing never sees it, and
		// the renderer decides per paint which step it is speaking for.
		const status = templateDisposables.add(new OpenideChatStatusLine(row));
		const footer = append(row, $('.openide-chat-response-footer'));
		return { row, partsHost, status, footer, templateDisposables, parts: [], currentElement: undefined, renderedId: undefined };
	}

	renderElement(node: ITreeNode<IOpenideChatItem, FuzzyScore>, index: number, template: IOpenideChatResponseTemplate): void {
		const element = node.element;
		if (!isOpenideChatResponseItem(element)) {
			return;
		}

		// A recycled template still holds the parts of whichever turn it showed before. Diffing
		// against those would compare unrelated content and could keep a stale DOM subtree.
		if (template.renderedId !== element.id) {
			this._clearParts(template);
			// The live line belongs to the turn, not to the template: without this a recycled row
			// would animate from the previous turn's last step into this one's first.
			template.status.hide();
			template.renderedId = element.id;
		}
		template.currentElement = element;

		this._elementBeingRendered = element;
		try {
			this._renderContent(element, index, template);
		} finally {
			this._elementBeingRendered = undefined;
		}

		template.row.classList.toggle('openide-chat-row-streaming', !element.isComplete);
		this._renderStatus(element, template);
		this._renderFooter(element, template);
	}

	/**
	 * The turn's ONE live line.
	 *
	 * The steps of a running turn used to be a tree: a collapsible "Exploring" block with its own
	 * chevron, plus a row per tool call, all of them growing under each other while they ran. What
	 * the user asked for — and what Cursor does — is a single line in a fixed place that swaps
	 * between the steps with a short animation while it shimmers. So the step IN FLIGHT is hoisted
	 * out of the transcript and into this line (`setLive` tells the part to stand down), and the
	 * transcript keeps only the settled record of what the agent already did.
	 *
	 * The wording is `openideChatLiveStatusLabel` (pure, in common/); the swap and its PACING are
	 * the status line itself. `undefined` means some part below is already speaking — streaming
	 * prose, live reasoning, a running terminal — and two animated lines saying the same thing is
	 * noise.
	 */
	private _renderStatus(element: IOpenideChatResponseItem, template: IOpenideChatResponseTemplate): void {
		const enabled = this._configurationService.getValue(OPENIDE_CHAT_WORKING_INDICATOR_KEY) !== false;
		const status = enabled ? openideChatLiveStatusLabel(element.content, element.isComplete) : undefined;
		if (status === undefined) {
			template.status.hide();
		} else {
			// The line decides WHEN to show it: a step it just put up is held for a moment even if
			// the content moved on, which is the difference between reading the turn and watching it
			// strobe. See `openideChatStatusLine.ts`.
			template.status.setStatus(status);
		}
	}

	private _renderFooter(element: IOpenideChatResponseItem, template: IOpenideChatResponseTemplate): void {
		// A failure that came from the agent loop is ALREADY on screen: `applyError` pushes it as an
		// error notice AND records it in `errorMessage`, so painting the footer too printed the same
		// text twice, one block under the other. The footer still owns the failures nobody rendered
		// as a notice (the ones `finishStream` reports) and the cancellation line.
		const alreadyANotice = !!element.errorMessage && element.content.some(
			c => c.kind === 'notice' && c.message === element.errorMessage);
		const failed = !!element.errorMessage && !alreadyANotice;
		const message = failed
			? element.errorMessage!
			: element.isCanceled
				? localize('openide.chat.response.canceled', "Turn cancelled.")
				: '';
		reset(template.footer, message);
		template.footer.classList.toggle('hidden', message.length === 0);
		template.footer.classList.toggle('openide-chat-response-error', failed);
	}

	/**
	 * Reconciles the row's parts with the item's content, position by position.
	 *
	 * The three-way decision — same content, absorbable, replace — is the whole reason
	 * `IOpenideChatContentPart` has both `hasSameContent` and `tryUpdate`: without the middle
	 * case a streamed answer rebuilds its markdown part once per token.
	 */
	private _renderContent(element: IOpenideChatResponseItem, elementIndex: number, template: IOpenideChatResponseTemplate): void {
		const content = element.content;
		for (let i = 0; i < content.length; i++) {
			const existing = template.parts[i];
			if (existing) {
				if (existing.hasSameContent(content[i], content.slice(i + 1), element)) {
					continue;
				}
				if (existing.tryUpdate?.(content[i], element)) {
					continue;
				}
			}
			this._replacePart(element, elementIndex, template, i, content);
		}

		for (let i = content.length; i < template.parts.length; i++) {
			this._disposePart(template.parts[i]);
		}
		template.parts.length = content.length;

		// Which part is the step in flight, decided HERE and not by the part: a part only learns
		// what follows it from `hasSameContent`, which is a pure query and must not be what moves
		// the row. The live one hides itself — the status line above is showing it.
		for (let i = 0; i < template.parts.length; i++) {
			template.parts[i]?.setLive?.(isOpenideChatLiveTail(content, i, element.isComplete));
		}
	}

	private _replacePart(element: IOpenideChatResponseItem, elementIndex: number, template: IOpenideChatResponseTemplate, index: number, content: readonly IOpenideChatContent[]): void {
		const context: IOpenideChatContentPartContext = {
			element,
			elementIndex,
			container: template.partsHost,
			content,
			contentIndex: index,
			currentWidth: this._currentWidth,
			onDidChangeVisibility: this._onDidChangeVisibility,
			toolsDefaultExpanded: this._configurationService.getValue(OPENIDE_CHAT_TOOLS_EXPANDED_KEY) === true,
			thinkingDefaultOpen: this._configurationService.getValue(OPENIDE_CHAT_THINKING_OPEN_KEY) === true,
		};
		const part = this._createPart(content[index], context);
		// Heights reported by a part are the async ones (code block tokenization, images): the
		// list has already measured the row by then and would otherwise keep it clipped.
		if (part.onDidChangeHeight && part.addDisposable) {
			part.addDisposable(part.onDidChangeHeight(() => this._fireItemHeightChange(template)));
		}

		const previous = template.parts[index];
		if (previous) {
			this._disposePart(previous);
		}
		template.parts[index] = part;

		if (part.domNode) {
			// Anchored on the next part that actually owns a node: a part may render nothing, so
			// its index is not a DOM position.
			const anchor = this._nextRenderedNode(template, index);
			if (anchor) {
				template.partsHost.insertBefore(part.domNode, anchor);
			} else {
				template.partsHost.appendChild(part.domNode);
			}
		}
	}

	private _nextRenderedNode(template: IOpenideChatResponseTemplate, index: number): HTMLElement | undefined {
		for (let i = index + 1; i < template.parts.length; i++) {
			const node = template.parts[i]?.domNode;
			if (node?.parentElement === template.partsHost) {
				return node;
			}
		}
		return undefined;
	}

	private _createPart(content: IOpenideChatContent, context: IOpenideChatContentPartContext): IOpenideChatContentPart {
		if (isOpenideChatMarkdownContent(content)) {
			return new OpenideChatMarkdownPart(content, context, this._markdownRenderer);
		}
		if (isOpenideChatProgressContent(content)) {
			return new OpenideChatProgressPart(content, context);
		}
		if (isOpenideChatThinkingContent(content)) {
			return new OpenideChatThinkingPart(content, context);
		}
		if (isOpenideChatToolContent(content)) {
			return new OpenideChatToolPart(content, context, this._hoverService);
		}
		if (isOpenideChatContentOfKind(content, 'explore')) {
			return new OpenideChatExplorePart(content, context, this._hoverService);
		}
		if (isOpenideChatContentOfKind(content, 'subagent')) {
			return new OpenideChatSubagentPart(content, context, this._hoverService);
		}
		if (isOpenideChatContentOfKind(content, 'notice')) {
			return this._instantiationService.createInstance(OpenideChatNoticePart, content, context, this._markdownRenderer);
		}
		if (isOpenideChatContentOfKind(content, 'decision')) {
			return new OpenideChatDecisionPart(content, context, this._hoverService);
		}
		// `createInstance` rather than `new` from here down: these cards are remote controls for the
		// agent service, the command service and the file services, and threading a dozen services
		// through the renderer's own constructor just to hand them to one part each is exactly what
		// a scoped instantiation service already does.
		if (isOpenideChatContentOfKind(content, 'edit')) {
			return this._instantiationService.createInstance(OpenideChatEditPart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'terminal')) {
			return this._instantiationService.createInstance(OpenideChatTerminalPart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'todos')) {
			return new OpenideChatTodosPart(content, context, this._hoverService);
		}
		if (isOpenideChatContentOfKind(content, 'plan')) {
			return this._instantiationService.createInstance(OpenideChatPlanPart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'planUpdate')) {
			return this._instantiationService.createInstance(OpenideChatPlanUpdatePart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'delegation')) {
			return new OpenideChatDelegationPart(content, context);
		}
		if (isOpenideChatContentOfKind(content, 'diagram')) {
			return this._instantiationService.createInstance(OpenideChatDiagramPart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'compaction')) {
			return new OpenideChatCompactionPart(content, context);
		}
		if (isOpenideChatContentOfKind(content, 'canvas')) {
			return this._instantiationService.createInstance(OpenideChatCanvasPart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'modeSuggestion')) {
			return this._instantiationService.createInstance(OpenideChatModeSuggestionPart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'screenshot')) {
			return this._instantiationService.createInstance(OpenideChatScreenshotPart, content, context);
		}
		// Still unmapped: 'confirmation' and 'ask', the two blocking prompts. They need a way to
		// answer the promise the agent service is parked on, which no content part owns — the
		// controller warns the user about that separately (`BLOCKING_UNSUPPORTED`). Everything else
		// that lands here is a genuine gap, and the fallback now says so out loud instead of
		// rendering a zero-height row nobody could diagnose.
		// Both of these BLOCK the run: the service is parked on a promise until the user answers, so
		// an unmapped kind here is not a cosmetic gap — it is a turn that can never finish.
		if (isOpenideChatContentOfKind(content, 'confirmation')) {
			return this._instantiationService.createInstance(OpenideChatConfirmationPart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'accountChoice')) {
			return this._instantiationService.createInstance(OpenideChatAccountChoicePart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'ask')) {
			return this._instantiationService.createInstance(OpenideChatAskPart, content, context);
		}
		return this._instantiationService.createInstance(OpenideChatUnrenderedContentPart, content, context);
	}

	private _disposePart(part: IOpenideChatContentPart | undefined): void {
		part?.domNode?.remove();
		part?.dispose();
	}

	private _clearParts(template: IOpenideChatResponseTemplate): void {
		for (const part of template.parts) {
			this._disposePart(part);
		}
		template.parts = [];
	}

	/**
	 * Reports the row's real height back to the list.
	 *
	 * Adapted from `ChatListItemRenderer#fireItemHeightChange`
	 * (contrib/chat/browser/widget/chatListRenderer.ts:341-362). Upstream's two guards are kept —
	 * nothing is reported while the tree is painting this very row, and a first measurement is
	 * only stored, never announced, because the list has just measured it itself — but the first
	 * one no longer THROWS the report away. See `_deferredHeights`.
	 */
	private _fireItemHeightChange(template: IOpenideChatResponseTemplate): void {
		const element = template.currentElement;
		if (!element || !template.row.isConnected) {
			return;
		}
		if (element === this._elementBeingRendered) {
			this._deferHeightReport(template, element);
			return;
		}
		this._reportHeight(template, element, false);
	}

	/**
	 * Queues one report per row for after the render pass. A microtask is enough: it runs once the
	 * tree's synchronous pass has unwound, so the list is re-entrant again, and it still lands
	 * before the frame is painted — the row is resized without a visible flash of the clipped card.
	 */
	private _deferHeightReport(template: IOpenideChatResponseTemplate, element: IOpenideChatResponseItem): void {
		if (this._deferredHeights.has(template)) {
			this._deferredHeights.set(template, element);
			return;
		}
		this._deferredHeights.set(template, element);
		queueMicrotask(() => {
			const queued = this._deferredHeights.get(template);
			this._deferredHeights.delete(template);
			// The template is recycled by the list: by now it may be painting another turn, and
			// resizing THAT row to this one's height is worse than not reporting at all.
			if (queued && !this._store.isDisposed && template.currentElement === queued) {
				this._reportHeight(template, queued, true);
			}
		});
	}

	/**
	 * `announceFirst` is what separates the two callers. A height that arrives outside a render
	 * pass and is the row's first measurement needs no announcement, because the list produced it.
	 * A DEFERRED one is the opposite case by construction: the row grew after the list measured it,
	 * so that measurement is precisely what is stale.
	 */
	private _reportHeight(template: IOpenideChatResponseTemplate, element: IOpenideChatResponseItem, announceFirst: boolean): void {
		if (!template.row.isConnected) {
			return;
		}
		const height = Math.ceil(template.row.getBoundingClientRect().height);
		if (!height || height === element.currentRenderedHeight) {
			return;
		}
		const previousHeight = element.currentRenderedHeight;
		element.currentRenderedHeight = height;
		if (announceFirst || typeof previousHeight === 'number') {
			this._onDidChangeItemHeight.fire({ element, height });
		}
	}

	disposeElement(_node: ITreeNode<IOpenideChatItem, FuzzyScore>, _index: number, template: IOpenideChatResponseTemplate): void {
		template.currentElement = undefined;
	}

	disposeTemplate(template: IOpenideChatResponseTemplate): void {
		this._clearParts(template);
		template.renderedId = undefined;
		template.templateDisposables.dispose();
	}
}
