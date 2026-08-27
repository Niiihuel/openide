/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — registration of the standalone Settings surface.
 *--------------------------------------------------------------------------------------------*/

import { OpenideSettingsEditor } from './openideSettingsEditor.js';

// Registration is intentionally owned by preferences.contribution: SettingsEditor2Input has a
// stable serialized typeId used by restore/sync. Registering a second pane/serializer for a
// subclass produced an ambiguous editor descriptor at runtime. This module remains the product
// contribution entrypoint and exports the pane for the native preferences registration.
export { OpenideSettingsEditor };
