/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — EditorInput del editor especializado de definiciones de subagentes.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export class OpenideSubagentInput extends EditorInput {
	static readonly ID = 'workbench.input.openideSubagent';
	static readonly EDITOR_ID = 'openide.subagentEditor';
	constructor(private readonly _resource: URI) { super(); }
	override get typeId(): string { return OpenideSubagentInput.ID; }
	override get resource(): URI { return this._resource; }
	override getName(): string { return basename(this._resource) || 'Subagent'; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof OpenideSubagentInput && other.resource.toString() === this.resource.toString(); }
}
