/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — EditorInput for the project's ARCHITECTURE MAP: the same measured truth the Project
 *  Map draws as nodes, told one level up as a diagram.
 *
 *  A synthetic scheme and a singleton, exactly like `OpenideMemoryInput`: this map is DERIVED from
 *  the index, so there is nothing on disk for it to point at. A file would be a copy that starts
 *  lying the moment somebody moves a module — the index already knows the truth, and a second
 *  place holding the same answer is a second place to keep in step.
 *
 *  It serializes, so the tab comes back after a restart and re-derives itself from whatever the
 *  index says THEN, which is the whole point.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { EditorInputCapabilities, IEditorSerializer, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { t } from '../common/openideStrings.js';

export class OpenideArchMapInput extends EditorInput {

	static readonly ID = 'workbench.input.openideArchMap';
	static readonly RESOURCE = URI.from({ scheme: 'openide-archmap', path: '/project' });

	override get typeId(): string { return OpenideArchMapInput.ID; }
	override get resource(): URI { return OpenideArchMapInput.RESOURCE; }

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return t('archmap.project.title');
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof OpenideArchMapInput;
	}
}

export class OpenideArchMapInputSerializer implements IEditorSerializer {
	canSerialize(): boolean { return true; }
	serialize(): string { return '{}'; }
	deserialize(): EditorInput { return new OpenideArchMapInput(); }
}
