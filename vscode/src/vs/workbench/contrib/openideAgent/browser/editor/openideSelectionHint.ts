/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the hint over a selection: "Add to chat  Ctrl+L | Quick edit  Ctrl+K".
 *
 *  Continue draws this as an SVG decoration that is only a reminder of two shortcuts
 *  (InlineTipManager.ts); Cursor draws the same pair as real buttons. This is the buttons: a
 *  content widget anchored above the first selected line, appearing half a second after the
 *  user finishes selecting (Continue's debounce), and gone the moment the selection empties,
 *  the editor blurs, or a context menu opens. Each button runs the same command its shortcut
 *  runs, so the two never drift.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType } from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from '../../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../../editor/browser/editorExtensions.js';
import { CursorChangeReason } from '../../../../../editor/common/cursorEvents.js';
import { IEditorContribution } from '../../../../../editor/common/editorCommon.js';
import { t } from '../../common/openideStrings.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import '../media/openideEditorWidgets.css';

export const OPENIDE_SELECTION_HINT_SETTING = 'openide.editor.selectionHint';
export const OPENIDE_ADD_SELECTION_COMMAND = 'openide.agent.addSelectionToChat';
export const OPENIDE_QUICK_EDIT_COMMAND = 'openide.quickEdit';

/** Continue's `debounceDelay`: the hint waits for the selection to settle. */
const SHOW_DELAY_MS = 500;

export class OpenideSelectionHint extends Disposable implements IEditorContribution, IContentWidget {

	static readonly ID = 'openide.editor.selectionHint';

	static get(editor: ICodeEditor): OpenideSelectionHint | null {
		return editor.getContribution<OpenideSelectionHint>(OpenideSelectionHint.ID);
	}

	readonly allowEditorOverflow = false;
	readonly suppressMouseDown = false;

	private readonly domNode: HTMLElement;
	private readonly scheduler: RunOnceScheduler;
	private position: IContentWidgetPosition | null = null;
	private visible = false;
	/** Set while another widget of ours (the quick edit input) owns the selection. */
	private suppressed = false;

	constructor(
		private readonly editor: ICodeEditor,
		@ICommandService private readonly commandService: ICommandService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.domNode = $('.openide-selection-hint');
		this.domNode.setAttribute('role', 'toolbar');
		this.addButton(OPENIDE_ADD_SELECTION_COMMAND, t('editor.hint.chat'));
		this.addButton(OPENIDE_QUICK_EDIT_COMMAND, t('editor.hint.edit'));
		// mousedown would move focus (and the selection with it) before the click lands.
		this._register(addDisposableListener(this.domNode, EventType.MOUSE_DOWN, event => event.preventDefault()));

		this.scheduler = this._register(new RunOnceScheduler(() => this.show(), SHOW_DELAY_MS));
		this._register(this.editor.onDidChangeCursorSelection(event => {
			this.hide();
			// Only a selection the user made: a programmatic one (a search hit, a go-to) is not an
			// invitation to act on it.
			if (event.reason === CursorChangeReason.Explicit && this.hasSelectionWorthActingOn()) {
				this.scheduler.schedule();
			}
		}));
		this._register(this.editor.onDidBlurEditorWidget(() => this.hide()));
		this._register(this.editor.onDidChangeModel(() => this.hide()));
		this._register(this.editor.onContextMenu(() => this.hide()));
		this._register(this.editor.onDidChangeModelContent(() => this.hide()));
	}

	private addButton(command: string, label: string): void {
		const button = append(this.domNode, $('button.openide-selection-hint-action', { type: 'button' }));
		append(button, $('span.openide-selection-hint-label', undefined, label));
		const keybinding = this.keybindingService.lookupKeybinding(command)?.getLabel();
		if (keybinding) {
			append(button, $('kbd.openide-selection-hint-kbd', undefined, keybinding));
		}
		button.title = keybinding ? `${label} (${keybinding})` : label;
		this._register(addDisposableListener(button, EventType.CLICK, event => {
			event.preventDefault();
			this.hide();
			void this.commandService.executeCommand(command);
		}));
	}

	private hasSelectionWorthActingOn(): boolean {
		const selection = this.editor.getSelection();
		const model = this.editor.getModel();
		if (!selection || !model || selection.isEmpty()) {
			return false;
		}
		return !!model.getValueInRange(selection).trim();
	}

	/** The quick edit input takes over the selection: the hint gets out of its way. */
	suppress(value: boolean): void {
		this.suppressed = value;
		if (value) {
			this.hide();
		}
	}

	private show(): void {
		if (this.suppressed || !this.editor.hasWidgetFocus() || this.configurationService.getValue(OPENIDE_SELECTION_HINT_SETTING) === false || !this.hasSelectionWorthActingOn()) {
			return;
		}
		const selection = this.editor.getSelection()!;
		// Above the first selected line, at its start: the same spot for a forward and a backward
		// selection, so the bar never jumps with the drag direction.
		this.position = {
			position: { lineNumber: selection.startLineNumber, column: 1 },
			preference: [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW],
		};
		if (this.visible) {
			this.editor.layoutContentWidget(this);
		} else {
			this.visible = true;
			this.editor.addContentWidget(this);
		}
	}

	hide(): void {
		this.scheduler.cancel();
		if (this.visible) {
			this.visible = false;
			this.position = null;
			this.editor.removeContentWidget(this);
		}
	}

	getId(): string {
		return OpenideSelectionHint.ID;
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	getPosition(): IContentWidgetPosition | null {
		return this.position;
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}

registerEditorContribution(OpenideSelectionHint.ID, OpenideSelectionHint, EditorContributionInstantiation.AfterFirstRender);
