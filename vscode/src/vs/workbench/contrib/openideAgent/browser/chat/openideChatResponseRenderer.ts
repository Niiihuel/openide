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
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { OPENIDE_CHAT_THINKING_OPEN_KEY, OPENIDE_CHAT_TOOLS_EXPANDED_KEY, OPENIDE_CHAT_WORKING_INDICATOR_KEY } from '../../common/chat/openideChatConfig.js';
import { IOpenideChatContent, isOpenideChatContentOfKind, isOpenideChatMarkdownContent, isOpenideChatProgressContent, isOpenideChatThinkingContent, isOpenideChatToolContent } from '../../common/chat/openideChatContent.js';
import { IOpenideChatItem, IOpenideChatResponseItem, isOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { IOpenideChatContentPart, IOpenideChatContentPartContext } from './openideChatContentPart.js';
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
import { OpenideChatTodosPart } from './parts/openideChatTodosPart.js';
import { OpenideChatToolPart } from './parts/openideChatToolPart.js';
import { OpenideChatUnrenderedContentPart } from './parts/openideChatUnrenderedPart.js';
import { t } from '../../common/openideStrings.js';

export interface IOpenideChatItemHeightChange {
	readonly element: IOpenideChatItem;
	readonly height: number;
}

export interface IOpenideChatResponseTemplate {
	readonly row: HTMLElement;
	readonly partsHost: HTMLElement;
	readonly working: HTMLElement;
	/** The text INSIDE the working row. The shimmer goes here, never on the row — see `_renderWorking`. */
	readonly workingLabel: HTMLElement;
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

	constructor(
		private readonly _currentWidth: IObservable<number>,
		private readonly _onDidChangeVisibility: Event<boolean>,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
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
		// Cursor-style "still working" line: lives OUTSIDE partsHost so the content diffing never
		// sees it, and the renderer decides per paint whether the turn has anything else moving.
		const working = append(row, $('.openide-chat-response-working.hidden'));
		const workingLabel = append(working, $('span.openide-chat-response-working-label'));
		const footer = append(row, $('.openide-chat-response-footer'));
		return { row, partsHost, working, workingLabel, footer, templateDisposables, parts: [], currentElement: undefined, renderedId: undefined };
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
		this._renderWorking(element, template);
		this._renderFooter(element, template);
	}

	/**
	 * The shimmer that says the agent is still on it, transcribed from the webview's "Planning next
	 * moves" placeholder (openideChatHtml.ts:2825-2835) and Cursor's thinking line. It shows while
	 * the reply is open and NOTHING else on screen is moving: before the first event, and in the
	 * gaps after a tool settles — never on top of streaming prose, live reasoning or a running tool,
	 * each of which already animates itself.
	 */
	private _renderWorking(element: IOpenideChatResponseItem, template: IOpenideChatResponseTemplate): void {
		const show = !element.isComplete
			&& this._configurationService.getValue(OPENIDE_CHAT_WORKING_INDICATOR_KEY) !== false
			&& !this._contentIsAnimating(element.content);
		template.working.classList.toggle('hidden', !show);
		if (show) {
			const label = element.content.length ? t('chat.working.next') : t('chat.working.thinking');
			if (template.workingLabel.textContent !== label) {
				template.workingLabel.textContent = label;
			}
			// On the LABEL, not on the row. The shimmer paints a gradient and clips it to the text
			// (`background-clip: text` + transparent fill); the row is a flex container, so its text
			// is an anonymous flex item and the clip has nothing of its own to cut against — the
			// sweep never showed. The row also sets `color`, which fights the transparent fill.
			// Every other shimmering label in the chat already does it this way (the tool activity
			// verb is an inner span inside its flex row); this one was the exception.
			template.workingLabel.classList.add('openide-chat-shimmer');
		}
	}

	private _contentIsAnimating(content: readonly IOpenideChatContent[]): boolean {
		const last = content[content.length - 1];
		if (!last) {
			return false;
		}
		switch (last.kind) {
			case 'markdown':
			case 'thinking':
				return true; // streaming prose / live reasoning carry their own motion
			case 'tool':
				return last.state === 'running';
			case 'terminal':
				return last.state === 'running';
			case 'edit':
				return !last.diff.diffLines; // the filename shimmers until the diff lands
			case 'explore':
				return last.entries.some(entry => entry.state === 'running');
			case 'subagent':
				return last.status === 'running';
			case 'ask':
			case 'confirmation':
			case 'modeSuggestion':
				return true; // parked on the user: "pensando" would be a lie
			default:
				return false;
		}
	}

	private _renderFooter(element: IOpenideChatResponseItem, template: IOpenideChatResponseTemplate): void {
		const message = element.errorMessage
			? element.errorMessage
			: element.isCanceled
				? localize('openide.chat.response.canceled', "Turn cancelled.")
				: '';
		reset(template.footer, message);
		template.footer.classList.toggle('hidden', message.length === 0);
		template.footer.classList.toggle('openide-chat-response-error', !!element.errorMessage);
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
			return new OpenideChatToolPart(content, context);
		}
		if (isOpenideChatContentOfKind(content, 'explore')) {
			return new OpenideChatExplorePart(content, context);
		}
		if (isOpenideChatContentOfKind(content, 'subagent')) {
			return new OpenideChatSubagentPart(content, context);
		}
		if (isOpenideChatContentOfKind(content, 'notice')) {
			return this._instantiationService.createInstance(OpenideChatNoticePart, content, context);
		}
		if (isOpenideChatContentOfKind(content, 'decision')) {
			return new OpenideChatDecisionPart(content, context);
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
			return new OpenideChatTodosPart(content, context);
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
	 * Copied deliberately from `ChatListItemRenderer#fireItemHeightChange`
	 * (contrib/chat/browser/widget/chatListRenderer.ts:341-362), including the two guards that
	 * look redundant and are not: nothing is reported while the tree is painting this very row,
	 * and the first measurement is only stored, never announced — the list already measured it.
	 */
	private _fireItemHeightChange(template: IOpenideChatResponseTemplate): void {
		const element = template.currentElement;
		if (!element || !template.row.isConnected) {
			return;
		}
		const height = Math.ceil(template.row.getBoundingClientRect().height);
		if (!height || height === element.currentRenderedHeight) {
			return;
		}
		const previousHeight = element.currentRenderedHeight;
		element.currentRenderedHeight = height;
		if (element !== this._elementBeingRendered && typeof previousHeight === 'number') {
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
