/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE Canvas editor input — keeps the real .canvas.tsx resource in the editor tab.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorSerializer } from '../../../common/editor.js';

export class OpenideCanvasInput extends EditorInput {
	static readonly ID = 'workbench.input.openideCanvas';
	static readonly EDITOR_ID = 'openide.canvasEditor';
	constructor(private readonly _resource: URI) { super(); }
	override get typeId(): string { return OpenideCanvasInput.ID; }
	override get resource(): URI { return this._resource; }
	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.Readonly; }
	override getName(): string { return basename(this._resource).replace(/\.canvas\.tsx$/, '') || 'Canvas'; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof OpenideCanvasInput && other.resource.toString() === this.resource.toString(); }
}

export class OpenideCanvasInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean { return editor instanceof OpenideCanvasInput; }
	serialize(editor: EditorInput): string | undefined { return editor instanceof OpenideCanvasInput ? editor.resource.toString() : undefined; }
	deserialize(_instantiationService: IInstantiationService, serializedEditor: string): EditorInput | undefined {
		try { return new OpenideCanvasInput(URI.parse(serializedEditor)); } catch { return undefined; }
	}
}
