/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IOpenideMemoryResponse } from '../../../../platform/openideCodebase/common/openideMemoryRecord.js';
import { IMessageChangeSet } from './openideAgentTypes.js';
import { createFileChange } from './openideMessageChanges.js';

/** RestoreEngine takes filesystem paths, not URI strings; keep each write as its own delta. */
export function memoryCaptureChangeSets(root: URI, response: IOpenideMemoryResponse, warningMessageId: string): IMessageChangeSet[] {
	const changes: IMessageChangeSet[] = (response.writeReceipts ?? []).map(receipt => ({
		messageId: receipt.message, timestamp: receipt.time, state: 'finalized',
		files: [createFileChange(joinPath(root, receipt.path).fsPath, receipt.beforeContent === undefined ? 'create' : 'modify', receipt.beforeContent, receipt.afterContent)],
	}));
	if (response.rollbackWarning) { changes.push({ messageId: warningMessageId, timestamp: Date.now(), state: 'unavailable', files: [], unavailableReason: response.rollbackWarning }); }
	return changes;
}
