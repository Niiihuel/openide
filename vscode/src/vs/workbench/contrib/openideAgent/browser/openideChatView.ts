/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — ViewPane del chat (dock derecho / auxiliary bar).
 *
 *  Mounts the shared native chat only when the IDE view is opened. Execution, status and the
 *  companion window belong to OpenideChatRuntime and stay alive while this view is hidden.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IOpenideChatRuntime } from './openideChatRuntime.js';
import { OpenideChatWidget } from './chat/openideChatWidget.js';
import { IComposerSnippet } from '../common/chat/openideChatSnippet.js';

export class OpenideChatViewPane extends ViewPane {

	private _container: HTMLElement | undefined;
	private readonly _widget: { value?: OpenideChatWidget } = {};

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IOpenideChatRuntime private readonly chatRuntime: IOpenideChatRuntime,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._container = container;
		container.style.position = 'relative';
		if (this._widget.value) {
			this._widget.value.mount(container);
			this._widget.value.setVisible(this.isBodyVisible());
			return;
		}
		const widget = this.chatRuntime.widget;
		widget.mount(container);
		widget.setVisible(this.isBodyVisible());
		this._widget.value = widget;
		this._register(this.onDidChangeBodyVisibility(visible => this._widget.value?.setVisible(visible)));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._container) {
			this._container.style.height = `${height}px`;
			this._container.style.width = `${width}px`;
		}
		this._widget.value?.layout(height, width);
	}

	override focus(): void {
		super.focus();
		this._widget.value?.focus();
	}

	async openAgentWindow(): Promise<void> {
		await this.chatRuntime.openAgentWindow();
	}

	// ---- commands routed to the pane --------------------------------------------------------

	/** "Uso de contexto": the panel explaining the number in the status bar. */
	showContextPanel(): void {
		this._widget.value?.showContextPanel();
	}

	showUsagePopover(): void { this.chatRuntime.showUsagePopover(); }

	/** Restart: creates a new conversation (new tab) and activates it. Triggered by "New chat". */
	createGoalFromPlan(request: { planPath: string; objective: string }): void {
		this._widget.value?.createGoalFromPlan(request);
	}

	newChat(): void {
		this._widget.value?.newSession();
	}

	/**
	 * Fills the composer without sending. The visual style editor uses it to hand over the CSS it
	 * already decided: the user should read the request and press Send themselves, because carrying
	 * a style into the source touches files.
	 */
	injectPrompt(text: string): void {
		this._widget.value?.injectCanvasPrompt(text, false);
	}

	/** The editor selection, as a chip in the composer. Focus follows so the user can just type. */
	attachSnippet(snippet: IComposerSnippet): void {
		this._widget.value?.attachSnippet(snippet);
		this.focus();
	}

	/** "Ask the agent" from the Project Map: a new conversation, already asking. */
	askInNewChat(prompt: string): void {
		this._widget.value?.askInNewSession(prompt);
	}

	/** Fork of the active conversation (an independent branch with the inherited context). */
	forkChat(): void {
		this._widget.value?.forkActiveSession();
	}

	/** Brings an explicit Canvas choice to the composer without starting a turn behind the user's back. */
	injectCanvasChoice(choice: { choiceId: string; label: string; canvas?: string }): void {
		const label = String(choice?.label ?? '').trim().slice(0, 1000);
		if (!label) { return; }
		this._widget.value?.injectCanvasChoice(label);
		this.focus();
	}

	/** Prompt triggered by a canvas button: fills the composer and, unless told otherwise, sends it. */
	injectCanvasPrompt(request: { prompt: string; send: boolean; canvas?: string }): void {
		const prompt = String(request?.prompt ?? '').trim().slice(0, 4000);
		if (!prompt) { return; }
		this._widget.value?.injectCanvasPrompt(prompt, request.send !== false);
		this.focus();
	}

	override dispose(): void {
		this._widget.value?.setVisible(false);
		this._widget.value?.unmount();
		super.dispose();
	}
}
