/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { IChannel, ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IPlaywrightService } from '../../../../platform/browserView/common/playwrightService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenideAgentHostService, OPENIDE_AGENT_HOST_CHANNEL } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IOpenideBrowserAutomation, OPENIDE_BROWSER_AUTOMATION_CHANNEL } from '../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { ICodebaseMemoryChannel } from '../../../../platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { OPENIDE_REQUEST_CHANNEL, OpenideRequestChannelClient } from '../../../../platform/request/common/openideRequestIpc.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IOpenideNativeServices } from '../common/openideNativeServices.js';

class OpenideNativeServices extends Disposable implements IOpenideNativeServices {
	declare readonly _serviceBrand: undefined;
	readonly available = true;
	readonly host: IOpenideAgentHostService;
	readonly browserAutomation: IOpenideBrowserAutomation;
	readonly requests: OpenideRequestChannelClient;
	readonly codebase: ICodebaseMemoryChannel;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@ILogService logService: ILogService,
		@IPlaywrightService readonly playwright: IPlaywrightService,
	) {
		super();
		const channel = mainProcessService.getChannel(OPENIDE_AGENT_HOST_CHANNEL);
		const host = ProxyChannel.toService<IOpenideAgentHostService>(channel);
		let workspaceReady: Promise<void>;
		const registerWorkspace = () => {
			workspaceReady = host.setRestoreWorkspace(workspaceService.getWorkspace().folders
				.filter(folder => folder.uri.scheme === Schemas.file).map(folder => folder.uri.fsPath), workspaceService.getWorkspace().id);
			// Keep the original rejection as a barrier for restoration; observing it here also
			// prevents an unhandled rejection when no restoration is requested.
			void workspaceReady.catch(error => logService.error('[OpenIDE] Cannot register restore workspace', error));
		};
		registerWorkspace();
		this._register(workspaceService.onDidChangeWorkspaceFolders(registerWorkspace));
		const guardedChannel: IChannel = {
			listen: (event, arg) => channel.listen(event, arg),
			call: async <T>(command: string, arg?: unknown, token?: CancellationToken): Promise<T> => {
				if (['memoryRequest', 'setMemoryDirtyResources', 'acquireRestoreLocks', 'openRunJournal', 'createSubagentWorktree', 'prepareIsolatedProcess', 'validateWorkspaceResource'].includes(command)) {
					await workspaceReady;
				}
				return channel.call<T>(command, arg, token);
			},
		};
		this.host = ProxyChannel.toService<IOpenideAgentHostService>(guardedChannel);
		this.browserAutomation = ProxyChannel.toService<IOpenideBrowserAutomation>(mainProcessService.getChannel(OPENIDE_BROWSER_AUTOMATION_CHANNEL));
		this.requests = new OpenideRequestChannelClient(mainProcessService.getChannel(OPENIDE_REQUEST_CHANNEL));
		this.codebase = ProxyChannel.toService<ICodebaseMemoryChannel>(sharedProcessService.getChannel('openideCodebaseMemory'));
	}
}

registerSingleton(IOpenideNativeServices, OpenideNativeServices, InstantiationType.Delayed);
