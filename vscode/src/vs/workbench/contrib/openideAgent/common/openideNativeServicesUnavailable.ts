/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IChannel, ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IPlaywrightService } from '../../../../platform/browserView/common/playwrightService.js';
import { IOpenideAgentHostService } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IOpenideBrowserAutomation } from '../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { ICodebaseMemoryChannel } from '../../../../platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { t } from './openideStrings.js';
import { IOpenideAgentRequestService, IOpenideNativeServices } from './openideNativeServices.js';

function unavailable(): Error {
	return new Error(t('native.unavailable'));
}

/** Stable events allow browser contributions to load; every native operation rejects. */
class UnavailableChannel implements IChannel {
	listen<T>(): Event<T> { return Event.None; }
	async call<T>(): Promise<T> { throw unavailable(); }
}

class UnavailableRequests implements IOpenideAgentRequestService {
	declare readonly _serviceBrand: undefined;
	readonly onDidCompleteRequest: IOpenideAgentRequestService['onDidCompleteRequest'] = Event.None;
	async request(): Promise<never> { throw unavailable(); }
	async resolveProxy(): Promise<never> { throw unavailable(); }
	async lookupAuthorization(): Promise<never> { throw unavailable(); }
	async lookupKerberosAuthorization(): Promise<never> { throw unavailable(); }
	async loadCertificates(): Promise<never> { throw unavailable(); }
}

export class UnavailableOpenideNativeServices implements IOpenideNativeServices {
	declare readonly _serviceBrand: undefined;
	readonly available = false;
	private readonly channel = new UnavailableChannel();
	readonly host = ProxyChannel.toService<IOpenideAgentHostService>(this.channel);
	readonly browserAutomation = ProxyChannel.toService<IOpenideBrowserAutomation>(this.channel);
	readonly playwright = ProxyChannel.toService<IPlaywrightService>(this.channel);
	readonly codebase = ProxyChannel.toService<ICodebaseMemoryChannel>(this.channel);
	readonly requests: IOpenideAgentRequestService = new UnavailableRequests();
}
