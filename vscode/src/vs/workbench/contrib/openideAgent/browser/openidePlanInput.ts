/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — PLAN MODE EditorInput. Unlike the diagram/browser ones (synthetic schemes),
 *  this input carries the REAL URI of the .openide/plans/<slug>.md file: that way the editor is
 *  associated with the file (breadcrumb, title, tabs) and the EditorTitle Action2s (Model/Build)
 *  match the resourcePath. The webview editor renders it nicely (openidePlanEditor); "Open as text"
 *  opens the SAME URI in the native text editor. No serializer: on restore it falls back to the editor by glob.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { basename } from '../../../../base/common/resources.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export class OpenidePlanInput extends EditorInput {

	static readonly ID = 'workbench.input.openidePlan';
	/** Id of the editor registered in the resolver (an override to force THIS editor over the .md). */
	static readonly EDITOR_ID = 'openide.planEditor';

	constructor(private readonly _resource: URI) {
		super();
	}

	override get typeId(): string { return OpenidePlanInput.ID; }

	override get resource(): URI { return this._resource; }

	override get capabilities(): EditorInputCapabilities {
		// Viewer: fine editing happens via "Open as text" (native editor) or from the UI.
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return basename(this._resource) || 'Plan';
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof OpenidePlanInput && other._resource.toString() === this._resource.toString();
	}
}
