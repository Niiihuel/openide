/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';

/** A fresh renderer generation owns its hook inbox, even when session history is shared. */
export const OPENIDE_CLI_HOOK_OWNER = generateUuid();
