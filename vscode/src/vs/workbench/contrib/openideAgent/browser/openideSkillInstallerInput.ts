/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — ephemeral input for the Skills installer. It requires the native modal editor and is
 *  not serialized: every opening creates a new terminal session.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { EditorInputCapabilities } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export type OpenideSkillInstallScope = 'project' | 'global';

export class OpenideSkillInstallerInput extends EditorInput {

	static readonly ID = 'workbench.input.openideSkillInstaller';

	constructor(readonly initialScope: OpenideSkillInstallScope) {
		super();
	}

	override get typeId(): string { return OpenideSkillInstallerInput.ID; }
	override get resource(): URI { return URI.from({ scheme: 'openide-skill-installer', path: '/install' }); }
	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.RequiresModal; }
	override getName(): string { return 'Instalar Skill'; }

	override matches(other: EditorInput): boolean {
		return this === other;
	}
}
