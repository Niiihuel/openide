/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — native diagram viewer (the full-screen modal behind the chat's ⛶ button).
 *
 *  It replaces the overlay-webview viewer 1:1. The stage — zoom, pan, fit, hover — is shared with
 *  the saved-map editor (openideDiagramStage.ts); what is left here is what makes this pane the
 *  MODAL one: it draws a payload handed over by a command, with nothing behind it on disk.
 *
 *  The picture is drawn again from its SOURCE with the same engine the chat uses
 *  (`renderOpenideDiagram`), so the viewer never injects markup, the theme tokens resolve in the
 *  workbench, and tooltips are the workbench hover instead of `<title>` bubbles.
 *--------------------------------------------------------------------------------------------*/

import { Dimension } from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { OpenideDiagramInput, OpenideDiagramPayload } from '../openideDiagramInput.js';
import { renderOpenideDiagram } from './openideDiagramRender.js';
import { liftTitlesToHover, OpenideDiagramStage } from './openideDiagramStage.js';
import './media/openideDiagrams.css';

export class OpenideDiagramEditor extends EditorPane {

	static readonly ID = 'workbench.editor.openideDiagram';

	private stage!: OpenideDiagramStage;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super(OpenideDiagramEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.stage = this._register(new OpenideDiagramStage(parent, this.hoverService));
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (input instanceof OpenideDiagramInput) {
			const content = this.buildContent(input.payload);
			// A video is not a picture to zoom and pan: it goes on the stage's OVERLAY, which sits
			// under the toolbar at full size and hides the zoom controls, and plays with its own
			// controls on a plain black ground instead of at 31% over the dotted canvas.
			this.stage.domNode.classList.toggle('openide-diagram-viewer-video', input.payload.kind === 'video');
			if (input.payload.kind === 'video') {
				this.stage.setContent(undefined, '');
				this.stage.setOverlay(content);
			} else {
				this.stage.setContent(content);
			}
		}
	}

	override clearInput(): void {
		this.stage.domNode.classList.remove('openide-diagram-viewer-video');
		this.stage.clear();
		super.clearInput();
	}

	private buildContent(payload: OpenideDiagramPayload): HTMLElement | undefined {
		const doc = this.stage.domNode.ownerDocument;
		switch (payload.kind) {
			case 'source': {
				const render = renderOpenideDiagram(doc, payload.source);
				if (!render) {
					return undefined;
				}
				liftTitlesToHover(render.domNode);
				return render.domNode;
			}
			case 'image': {
				const img = doc.createElement('img');
				img.src = payload.uri;
				img.alt = payload.alt ?? '';
				img.draggable = false;
				return img;
			}
			case 'video': {
				// The stage zooms on wheel and pans on mouse-down; the player's own controls need
				// both. Events that start on the video stay with the video.
				const video = doc.createElement('video');
				video.src = payload.uri;
				if (payload.poster) {
					video.poster = payload.poster;
				}
				video.controls = true;
				video.autoplay = true;
				video.loop = true;
				video.muted = true;
				video.playsInline = true;
				video.className = 'openide-diagram-video';
				for (const type of ['mousedown', 'wheel', 'dblclick', 'click']) {
					video.addEventListener(type, event => event.stopPropagation());
				}
				return video;
			}
			case 'html': {
				// Rendered markup from a legacy caller: shown as a picture, never parsed into the DOM.
				if (!/^\s*<svg[\s>]/i.test(payload.html)) {
					return undefined;
				}
				const img = doc.createElement('img');
				img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload.html)}`;
				img.draggable = false;
				return img;
			}
		}
	}

	override layout(dimension: Dimension): void {
		this.stage.layout(dimension);
	}

	override focus(): void {
		super.focus();
		this.stage.focus();
	}
}
