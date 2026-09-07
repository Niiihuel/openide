/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IRequestContext } from '../../../../base/parts/request/common/request.js';
import { IPlaywrightService } from '../../../../platform/browserView/common/playwrightService.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenideAgentHostService } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IOpenideBrowserAutomation } from '../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { ICodebaseMemoryChannel } from '../../../../platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { IOpenideRequestOptions } from '../../../../platform/request/common/openideRequestIpc.js';
import { IRequestService } from '../../../../platform/request/common/request.js';

export const IOpenideNativeServices = createDecorator<IOpenideNativeServices>('openideNativeServices');

/** Streaming provider transport, including binary requests such as audio transcription. */
export interface IOpenideAgentRequestService extends IRequestService {
	request(options: IOpenideRequestOptions, token: CancellationToken): Promise<IRequestContext>;
}

/**
 * Typed capabilities supplied by the host environment. Workbench features never acquire
 * Electron channels themselves. Unsupported hosts expose availability and reject operations.
 */
export interface IOpenideNativeServices {
	readonly _serviceBrand: undefined;
	readonly available: boolean;
	readonly host: IOpenideAgentHostService;
	readonly browserAutomation: IOpenideBrowserAutomation;
	readonly playwright: IPlaywrightService;
	readonly requests: IOpenideAgentRequestService;
	readonly codebase: ICodebaseMemoryChannel;
}
