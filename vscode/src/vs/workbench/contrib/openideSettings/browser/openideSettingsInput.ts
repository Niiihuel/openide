/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — boundary for the upstream Settings input contract.
 *
 *  The VS Code implementation still carries a historical version suffix. Product code uses
 *  the stable, versionless name below; the compatibility detail stays at this boundary.
 *--------------------------------------------------------------------------------------------*/

import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { SettingsEditor2Input } from '../../../services/preferences/common/preferencesEditorInput.js';

export class SettingsEditorInput extends SettingsEditor2Input {
	static override readonly ID = SettingsEditor2Input.ID;

	constructor(
		@IPreferencesService preferencesService: IPreferencesService,
	) {
		super(preferencesService);
	}

	override get typeId(): string {
		return SettingsEditorInput.ID;
	}
}
