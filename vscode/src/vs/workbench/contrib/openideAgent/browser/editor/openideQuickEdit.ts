/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — quick edit (Ctrl+K): rewrite the selection from one line of instruction.
 *
 *  Continue's "Edit" and Cursor's Ctrl+K, on the harness's own parts: the instruction goes to
 *  the model with the selection and its surroundings through `completeText` (no tools, no
 *  session), the answer replaces the selection as ONE undoable edit, and the file is then
 *  handed to `OpenideEditReview` with the pre-edit content as baseline — so the result is read
 *  exactly like an agent's edit, green and red blocks with Undo/Keep, instead of in a second
 *  kind of diff. The input is a content widget above the selection; Enter runs, Escape closes,
 *  Escape while running cancels the request and leaves the file untouched.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, getWindow } from '../../../../../base/browser/dom.js';
import { AnchorAlignment, AnchorPosition } from '../../../../../base/browser/ui/contextview/contextview.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { relativePath } from '../../../../../base/common/resources.js';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from '../../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../../editor/browser/editorExtensions.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IEditorContribution } from '../../../../../editor/common/editorCommon.js';
import { t } from '../../common/openideStrings.js';
import { IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { parseProviderModelTarget } from '../../common/openideFallback.js';
import { OpenideChatModelPicker } from '../chat/openideChatModelPicker.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { OpenideSelectionHint } from './openideSelectionHint.js';
import '../media/openideEditorWidgets.css';

/** True while the quick edit input is on screen: Escape closes it from wherever focus went. */
export const CTX_OPENIDE_QUICK_EDIT_VISIBLE = new RawContextKey<boolean>('openideQuickEditVisible', false);
export const OPENIDE_QUICK_EDIT_CLOSE_COMMAND = 'openide.quickEdit.close';
/** `provider/model` the quick edit runs on. Empty ⇒ the chat's active provider and model. */
export const OPENIDE_QUICK_EDIT_MODEL = 'openide.quickEdit.model';

/** Lines of context on each side of the selection that travel with it. */
const CONTEXT_LINES = 40;
/** A rewrite is bounded by the selection; this is generous for anything that is still "quick". */
const QUICK_EDIT_MAX_TOKENS = 4096;

const SYSTEM = [
	'You are a code editor performing an in-place edit.',
	'You will receive a file excerpt, the exact selection to rewrite, and an instruction.',
	'Reply with the rewritten selection only: the code that replaces the selection verbatim,',
	'keeping its indentation and its language, with no explanation and no markdown fence.',
	'Do not include the surrounding context in the reply. If the instruction asks to delete the code, reply with an empty line.',
].join(' ');

export class OpenideQuickEdit extends Disposable implements IEditorContribution, IContentWidget {

	static readonly ID = 'openide.editor.quickEdit';

	static get(editor: ICodeEditor): OpenideQuickEdit | null {
		return editor.getContribution<OpenideQuickEdit>(OpenideQuickEdit.ID);
	}

	/** Inside the editor: a selection on line 1 gets the input BELOW it instead of off the top edge. */
	readonly allowEditorOverflow = false;
	readonly suppressMouseDown = false;

	private readonly domNode: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly note: HTMLElement;
	private position: IContentWidgetPosition | null = null;
	private visible = false;
	private readonly session = this._register(new DisposableStore());
	private readonly running = this._register(new MutableDisposable<CancellationTokenSource>());
	private readonly ctxVisible;
	/** The input must be focused AFTER the editor has laid the widget out; before that it is not in the DOM. */
	private wantsFocus = false;
	/** The chat's model popover, pointed at this widget's own choice instead of the chat's. */
	private readonly picker: OpenideChatModelPicker;
	private readonly modelButton: HTMLButtonElement;
	private readonly modelLabel: HTMLElement;
	/** The model popover was opened from this widget and may still be up. */
	private pickerOpen = false;

	constructor(
		private readonly editor: ICodeEditor,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextViewService contextViewService: IContextViewService,
		@ICommandService commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.ctxVisible = CTX_OPENIDE_QUICK_EDIT_VISIBLE.bindTo(contextKeyService);
		this.domNode = $('.openide-quick-edit');
		const row = append(this.domNode, $('.openide-quick-edit-row'));
		append(row, $('span.codicon.codicon-sparkle.openide-quick-edit-icon'));
		this.input = append(row, $('input.openide-quick-edit-input', { type: 'text', spellcheck: 'false' })) as HTMLInputElement;
		this.input.placeholder = t('quickEdit.placeholder');
		// The model: the same popover the composer opens, but choosing here only sets THIS
		// widget's model (`openide.quickEdit.model`) and never moves the chat's. At rest it names
		// the chat's active model, marked as the default, so it is clear what will run.
		this.modelButton = append(row, $('button.openide-quick-edit-model', { type: 'button' })) as HTMLButtonElement;
		this.modelLabel = append(this.modelButton, $('span.openide-quick-edit-model-label'));
		append(this.modelButton, $('span.codicon.codicon-chevron-down'));
		this.picker = this._register(new OpenideChatModelPicker(agentService, contextViewService, commandService, () => this.renderModel(), {
			// Under the chip, left-aligned to it; the context view flips it above when the room
			// below runs out. The composer's default is ABOVE because the composer sits at the
			// bottom of the dock — here, in the middle of a file, it sent the list to the top edge.
			anchorPosition: AnchorPosition.BELOW,
			anchorAlignment: AnchorAlignment.LEFT,
			width: 380,
			resolveActive: async () => this.resolveTarget(),
			choose: async (group, model) => {
				const active = this.resolveTarget(true);
				const isDefault = group.id === active.providerId && model.id === active.modelId;
				await this.configurationService.updateValue(OPENIDE_QUICK_EDIT_MODEL, isDefault ? '' : `${group.id}/${model.id}`);
				this.pickerOpen = false;
				this.renderModel();
				this.input.focus();
			},
		}));
		this._register(addDisposableListener(this.modelButton, EventType.CLICK, event => {
			event.preventDefault();
			this.pickerOpen = !this.pickerOpen;
			// Anchored to the whole box, not the chip: the composer's standard 8px gap is measured
			// from the anchor's edge, and the chip sits inside the box's padding — anchored there
			// the list touched the box's border. Left-aligned to the box, like every menu of ours.
			this.picker.toggle(this.domNode);
		}));
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(OPENIDE_QUICK_EDIT_MODEL)) {
				this.renderModel();
			}
		}));
		this._register(this.agentService.onDidChange(() => this.renderModel()));
		this.note = append(this.domNode, $('.openide-quick-edit-note'));
		this._register(addDisposableListener(this.input, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				void this.run();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
			}
		}));
		this._register(addDisposableListener(this.domNode, EventType.MOUSE_DOWN, event => {
			if (event.target !== this.input) {
				event.preventDefault();
			}
		}));
		this._register(this.editor.onDidChangeModel(() => this.close()));
	}

	/** The chat's active provider/model, or the widget's own when one is configured. */
	private resolveTarget(activeOnly = false): { providerId: string; modelId: string } {
		const target = activeOnly ? undefined : parseProviderModelTarget(this.configurationService.getValue<string>(OPENIDE_QUICK_EDIT_MODEL));
		if (target?.model) {
			return { providerId: target.providerId, modelId: target.model };
		}
		return { providerId: this.agentService.getActiveProviderId(), modelId: this.agentService.getModel() };
	}

	private renderModel(): void {
		const own = parseProviderModelTarget(this.configurationService.getValue<string>(OPENIDE_QUICK_EDIT_MODEL));
		const target = this.resolveTarget();
		const name = target.modelId ? this.agentService.describeModel(target.providerId, target.modelId).name : t('quickEdit.noModel');
		this.modelLabel.textContent = own?.model ? name : t('quickEdit.defaultModel', name);
		this.modelButton.title = own?.model
			? t('quickEdit.modelOwn', name)
			: t('quickEdit.modelDefault', name);
	}

	/** Ctrl+K, the hint's button, the context menu: all land here. */
	start(): void {
		const selection = this.editor.getSelection();
		const model = this.editor.getModel();
		if (!selection || !model || selection.isEmpty() || this.running.value) {
			return;
		}
		OpenideSelectionHint.get(this.editor)?.suppress(true);
		this.position = {
			position: { lineNumber: selection.startLineNumber, column: 1 },
			preference: [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW],
		};
		this.note.textContent = '';
		this.domNode.classList.remove('running');
		this.input.disabled = false;
		this.renderModel();
		if (this.visible) {
			this.editor.layoutContentWidget(this);
		} else {
			this.visible = true;
			this.editor.addContentWidget(this);
		}
		this.session.clear();
		this.ctxVisible.set(true);
		// Escape, wherever focus went. The context key is scoped to this editor, so the
		// keybinding cannot see it once focus is in the model popover or on the body after the
		// popover closed; a capture-phase listener on the window does not depend on focus. First
		// Escape puts the popover away and brings focus back to the input, the next one closes.
		this.session.add(addDisposableListener(getWindow(this.domNode), EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !this.visible) {
				return;
			}
			if (this.pickerOpen) {
				event.preventDefault();
				event.stopPropagation();
				this.pickerOpen = false;
				this.picker.close();
				this.input.focus();
				return;
			}
			if (this.input.ownerDocument.activeElement !== this.input) {
				event.preventDefault();
				event.stopPropagation();
				this.close();
			}
		}, true));
		this.wantsFocus = true;
		this.editor.layoutContentWidget(this);
	}

	/**
	 * The minimap and the scrollbar paint OVER content widgets, so the box stops where they
	 * start: as wide as the text area allows, never under them.
	 */
	beforeRender(): null {
		const layout = this.editor.getLayoutInfo();
		const rightEdge = layout.minimap.minimapWidth > 0 ? layout.minimap.minimapLeft : layout.contentLeft + layout.contentWidth - layout.verticalScrollbarWidth;
		this.domNode.style.maxWidth = `${Math.max(240, rightEdge - layout.contentLeft - 12)}px`;
		return null;
	}

	/** The editor rendered the widget: now the input exists on screen and can take focus. */
	afterRender(): void {
		if (!this.wantsFocus) {
			return;
		}
		this.wantsFocus = false;
		this.input.focus();
		this.input.select();
		// Closing on blur, but not while the request runs: the user may look elsewhere while
		// waiting, and the answer still has to land in this editor. Registered only once focus is
		// in: a blur fired by the editor re-taking focus during the same keystroke would close
		// the input before the user ever saw it.
		this.session.add(addDisposableListener(this.input, EventType.BLUR, (event: FocusEvent) => {
			// Focus moving into the model popover (it lives in the workbench's context view, not in
			// this widget) is not the user leaving: the input is refocused when they choose.
			const to = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
			if (to?.closest('.context-view, .openide-quick-edit')) {
				return;
			}
			if (!this.running.value) {
				this.close();
			}
		}));
	}

	private async run(): Promise<void> {
		const instruction = this.input.value.trim();
		const selection = this.editor.getSelection();
		const model = this.editor.getModel();
		if (!instruction || !selection || !model || selection.isEmpty()) {
			return;
		}
		const range = new Range(selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn);
		const selected = model.getValueInRange(range);
		const before = model.getValue();
		const lineCount = model.getLineCount();
		const contextBefore = model.getValueInRange(new Range(Math.max(1, range.startLineNumber - CONTEXT_LINES), 1, range.startLineNumber, range.startColumn));
		const contextAfter = model.getValueInRange(new Range(range.endLineNumber, range.endColumn, Math.min(lineCount, range.endLineNumber + CONTEXT_LINES), model.getLineMaxColumn(Math.min(lineCount, range.endLineNumber + CONTEXT_LINES))));
		const folder = this.contextService.getWorkspaceFolder(model.uri);
		const path = (folder && relativePath(folder.uri, model.uri)) || model.uri.path;
		const prompt = [
			`File: ${path} (${model.getLanguageId()})`,
			'',
			'<CONTEXT_BEFORE>', contextBefore, '</CONTEXT_BEFORE>',
			'',
			'<SELECTION>', selected, '</SELECTION>',
			'',
			'<CONTEXT_AFTER>', contextAfter, '</CONTEXT_AFTER>',
			'',
			`Instruction: ${instruction}`,
		].join('\n');

		const tokens = new CancellationTokenSource();
		this.running.value = tokens;
		this.input.disabled = true;
		this.domNode.classList.add('running');
		this.note.textContent = t('quickEdit.running');
		try {
			const own = this.configurationService.getValue<string>(OPENIDE_QUICK_EDIT_MODEL);
			const raw = await this.agentService.completeText({ system: SYSTEM, prompt, maxTokens: QUICK_EDIT_MAX_TOKENS, target: typeof own === 'string' && own.trim() ? own.trim() : undefined }, tokens.token);
			if (tokens.token.isCancellationRequested) {
				return;
			}
			const replacement = matchSelectionShape(stripFences(raw), selected);
			if (this.editor.getModel() !== model) {
				return; // the user moved on; a rewrite landing in another file is worse than none
			}
			this.editor.pushUndoStop();
			this.editor.executeEdits('openide.quickEdit', [{ range, text: replacement }]);
			this.editor.pushUndoStop();
			this.close();
			// The harness's review over the file, against what it was before this edit.
			const reviewPath = model.uri.scheme === 'file' ? model.uri.fsPath : path;
			await this.agentService.reviewExternalChange(reviewPath, { content: before, existed: true });
		} catch (error) {
			if (!tokens.token.isCancellationRequested) {
				this.notificationService.error(t('quickEdit.failed', error instanceof Error ? error.message : String(error)));
			}
		} finally {
			if (this.running.value === tokens) {
				this.running.value = undefined;
			}
			this.domNode.classList.remove('running');
			this.input.disabled = false;
			if (this.visible) {
				this.note.textContent = '';
			}
		}
	}

	close(): void {
		this.pickerOpen = false;
		this.picker.close();
		this.running.value?.cancel();
		this.running.value = undefined;
		this.session.clear();
		this.wantsFocus = false;
		this.ctxVisible.set(false);
		if (this.visible) {
			this.visible = false;
			this.position = null;
			this.editor.removeContentWidget(this);
		}
		OpenideSelectionHint.get(this.editor)?.suppress(false);
		this.editor.focus();
	}

	getId(): string {
		return OpenideQuickEdit.ID;
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	getPosition(): IContentWidgetPosition | null {
		return this.position;
	}

	override dispose(): void {
		this.close();
		super.dispose();
	}
}

/** The model fenced its answer anyway: keep what is inside. */
function stripFences(text: string): string {
	const fence = text.trim().match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
	return (fence ? fence[1] : text).replace(/\r\n/g, '\n');
}

/**
 * The replacement takes the selection's shape at its edges: a selection that ended with a
 * newline gets one back, one that did not loses the trailing newline models like to add — so
 * the lines around the edit stay exactly where they were.
 */
function matchSelectionShape(replacement: string, selected: string): string {
	let text = replacement.replace(/\n+$/, '');
	if (selected.endsWith('\n')) {
		text += '\n';
	}
	return text;
}

registerEditorContribution(OpenideQuickEdit.ID, OpenideQuickEdit, EditorContributionInstantiation.Lazy);
