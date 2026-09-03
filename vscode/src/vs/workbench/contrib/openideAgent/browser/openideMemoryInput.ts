/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — Project Map EditorInput. A logical singleton: one map per window.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IEditorSerializer, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export class OpenideMemoryInput extends EditorInput {

	static readonly ID = 'workbench.input.openideMemory';
	static readonly RESOURCE = URI.from({ scheme: 'openide-memory', path: '/graph' });

	override get typeId(): string { return OpenideMemoryInput.ID; }
	override get resource(): URI { return OpenideMemoryInput.RESOURCE; }

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('openide.memory.title', "Project Map");
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof OpenideMemoryInput;
	}
}

export class OpenideMemoryInputSerializer implements IEditorSerializer {
	canSerialize(): boolean { return true; }
	serialize(): string { return '{}'; }
	deserialize(): EditorInput { return new OpenideMemoryInput(); }
}
