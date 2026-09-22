/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import { $, addDisposableListener, append, Dimension } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { buildOpenideChatTranscript, reconcileOpenideChatTranscript } from '../common/chat/openideChatTranscript.js';
import { t } from '../common/openideStrings.js';
import { OpenideChatListWidget } from './chat/openideChatListWidget.js';
import { hydrateOpenideChatImages } from './chat/openideChatImageHydration.js';
import { OpenideChatRequestRenderer } from './chat/openideChatRequestRenderer.js';
import { OpenideChatResponseRenderer } from './chat/openideChatResponseRenderer.js';
import type { OpenideChatWidget } from './chat/openideChatWidget.js';

/** A live transcript input, independent of which conversation the shared composer is editing. */
export class OpenideAgentConversationInput extends EditorInput {
	static readonly ID = 'openide.agent.conversation';
	override get typeId(): string { return OpenideAgentConversationInput.ID; }
	override readonly resource: URI;
	private readonly presentationChanged = this._register(new Emitter<void>());
	readonly onDidChangePresentation = this.presentationChanged.event;
	summaryOnly = false;
	setSummaryOnly(value: boolean): void { if (this.summaryOnly !== value) { this.summaryOnly = value; this.presentationChanged.fire(); } }
	constructor(readonly sessionId: string, readonly source: OpenideChatWidget) {
		super(); this.resource = URI.from({ scheme: 'openide-conversation', path: `/${sessionId}` });
		let title = this.getName();
		this._register(source.sessionStore.onDidChange(() => {
			const updated = this.getName();
			if (updated !== title) { title = updated; this._onDidChangeLabel.fire(); }
		}));
	}
	override getName(): string { return this.source.sessionStore.metaOf(this.sessionId)?.title || t('chat.part.subagentOpen'); }
	override getLabelExtraClasses(): string[] { return ['openide-subagent-tab-label']; }
	override getIcon() { return Codicon.commentDiscussion; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof OpenideAgentConversationInput && other.sessionId === this.sessionId && other.source === this.source; }
}

/** Reuses the native chat list and both message renderers, in a workbench editor tab or modal. */
export class OpenideAgentConversationEditor extends EditorPane {
	static readonly ID = 'workbench.editor.openideAgentConversation';
	private root!: HTMLElement;
	private toolbar!: HTMLElement;
	private list!: OpenideChatListWidget;
	private readonly width = observableValue('agentConversationWidth', 0);
	private readonly visibility = this._register(new Emitter<boolean>());
	private renderedRevision: string | undefined;
	private hydrationGeneration = 0;
	private readonly imageData = new Map<string, string>();
	private transcriptVersion = 0;
	private transcriptVisible = false;
	private scrollPresentationToStart = false;
	private readonly refreshScheduler = this._register(new RunOnceScheduler(() => {
		this.list.setVisible(true);
		this.refreshTranscript();
		if (this.scrollPresentationToStart) { this.scrollPresentationToStart = false; this.list.scrollTop = 0; }
	}, 100));
	private readonly sessionStore = this._register(new DisposableStore());
	constructor(group: IEditorGroup,
		@ITelemetryService telemetry: ITelemetryService,
		@IThemeService theme: IThemeService,
		@IStorageService storage: IStorageService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IFileService private readonly files: IFileService,
	) { super(OpenideAgentConversationEditor.ID, group, telemetry, theme, storage); }
	protected createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.openide-chat-native.openide-agent-conversation-editor.show-file-icons'));
		this.toolbar = append(this.root, $('.openide-agent-conversation-toolbar'));
		const open = append(this.toolbar, $('button.oi-btn.ghost', { type: 'button' }, t('agentWindow.continueConversation')));
		this._register(addDisposableListener(open, 'click', () => {
			if (this.input instanceof OpenideAgentConversationInput) { this.input.source.openSession(this.input.source.sessionStore.metaOf(this.input.sessionId)?.parentSessionId ?? this.input.sessionId); }
		}));
		const host = append(this.root, $('.openide-chat-list-host'));
		const request = this._register(this.instantiation.createInstance(OpenideChatRequestRenderer, { readOnly: true, rollbackTo: async () => false, edit: () => {}, clampLines: () => 0 }));
		const response = this._register(this.instantiation.createInstance(OpenideChatResponseRenderer, this.width, this.visibility.event));
		this.list = this._register(this.instantiation.createInstance(OpenideChatListWidget, host, { renderers: [request, response] }));
		this._register(request.onDidChangeItemHeight(event => this.list.updateItemHeight(event.element, event.height)));
		this._register(response.onDidChangeItemHeight(event => this.list.updateItemHeight(event.element, event.height)));
	}
	override async setInput(input: OpenideAgentConversationInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested || this.input !== input) { return; }
		this.sessionStore.clear();
		this.imageData.clear();
		this.refreshScheduler.cancel();
		this.renderedRevision = undefined;
		this.sessionStore.add(input.onDidChangePresentation(() => { this.renderedRevision = undefined; this.scrollPresentationToStart = true; if (this.transcriptVisible) { this.refreshScheduler.schedule(0); } }));
		this.sessionStore.add(input.source.sessionStore.onDidChange(() => {
			if (this.transcriptVisible && this.revisionOf(input) !== this.renderedRevision && !this.refreshScheduler.isScheduled()) { this.refreshScheduler.schedule(); }
		}));
		this.refreshTranscript(); this.list.scrollToEnd();
		if (this.transcriptVisible) { this.refreshScheduler.schedule(0); }
	}
	private revisionOf(input: OpenideAgentConversationInput): string {
		return `${input.source.sessionStore.messageVersionOf(input.sessionId)}:${input.source.sessionStore.metaOf(input.sessionId)?.subagentStatus === 'running'}:${input.summaryOnly}`;
	}
	private refreshTranscript(): void {
		if (!(this.input instanceof OpenideAgentConversationInput)) { return; }
		const input = this.input;
		const { source, sessionId } = input;
		const streaming = source.sessionStore.metaOf(sessionId)?.subagentStatus === 'running';
		const revision = this.revisionOf(input);
		if (revision === this.renderedRevision) { return; }
		this.renderedRevision = revision;
		const messages = source.sessionStore.transcriptOf(sessionId);
		const summary = input.summaryOnly ? [...messages].reverse().find(message => message.role === 'assistant' && !message.hidden && message.content.trim()) : undefined;
		// Archives and the live model window can share messages. Hydrate a presentation snapshot
		// so opening the complete history never changes the harness's context or stored archives.
		const snapshot = summary ? [{ ...summary, toolCalls: undefined }] : messages.map(message => ({
			...message,
			images: message.images?.map(image => !image.data && image.assetUri && this.imageData.has(image.assetUri) ? { ...image, data: this.imageData.get(image.assetUri)! } : image),
		}));
		const generation = ++this.hydrationGeneration;
		const render = () => this.list.setItems(reconcileOpenideChatTranscript(this.list.getItems(), buildOpenideChatTranscript(snapshot, { streaming: streaming && !input.summaryOnly }), ++this.transcriptVersion));
		render();
		void hydrateOpenideChatImages(this.files, snapshot).then(hydrated => {
			if (!hydrated || this._store.isDisposed || this.input !== input) { return; }
			for (const message of snapshot) {
				for (const image of message.images ?? []) {
					if (image.assetUri && image.data) { this.imageData.set(image.assetUri, image.data); }
				}
			}
			if (generation === this.hydrationGeneration && this.revisionOf(input) === revision) { render(); }
		});
	}
	override clearInput(): void { this.refreshScheduler.cancel(); this.hydrationGeneration++; this.imageData.clear(); this.renderedRevision = undefined; this.scrollPresentationToStart = false; this.sessionStore.clear(); this.list.setItems([]); super.clearInput(); }
	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		if (this.transcriptVisible === visible) { return; }
		this.transcriptVisible = visible; this.visibility.fire(visible);
		// The native part reveals its DOM after this notification. Resume once that layout is ready.
		if (visible) { this.refreshScheduler.schedule(0); } else { this.refreshScheduler.cancel(); this.list.setVisible(false); }
	}
	layout(dimension: Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.width.set(dimension.width, undefined);
		this.list.layout(Math.max(0, dimension.height - this.toolbar.offsetHeight), dimension.width);
	}
}
