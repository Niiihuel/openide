/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IOpenideCanvasService } from '../browser/openideCanvasService.js';
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
import { ICodebaseMemoryChannel, ICodebaseQueryRequest } from '../../../../platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
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
				if (['codexGoalPrepare', 'codexGoalRun', 'goalGet', 'goalCreate', 'goalUpdate', 'goalVerify', 'memoryRequest', 'setMemoryDirtyResources', 'acquireRestoreLocks', 'openRunJournal', 'createSubagentWorktree', 'prepareIsolatedProcess', 'validateWorkspaceResource'].includes(command)) {
					await workspaceReady;
				}
				return channel.call<T>(command, arg, token);
			},
		};
		this.host = ProxyChannel.toService<IOpenideAgentHostService>(guardedChannel);
		this.browserAutomation = ProxyChannel.toService<IOpenideBrowserAutomation>(mainProcessService.getChannel(OPENIDE_BROWSER_AUTOMATION_CHANNEL));
		this.requests = new OpenideRequestChannelClient(mainProcessService.getChannel(OPENIDE_REQUEST_CHANNEL));
		const codebaseChannel = sharedProcessService.getChannel('openideCodebaseMemory');
		// ProxyChannel does not forward CancellationToken. Keep this method on the native
		// channel so cancelling/disposal interrupts CPU work in the Rust child as well.
		this.codebase = ProxyChannel.toService<ICodebaseMemoryChannel>(codebaseChannel, { properties: new Map([
			['query', (workspaceKey: string, request: ICodebaseQueryRequest, token?: CancellationToken) => codebaseChannel.call('query', [workspaceKey, request], token)],
		]) });
	}
}

registerSingleton(IOpenideNativeServices, OpenideNativeServices, InstantiationType.Delayed);

// Capture only the editor rectangle provided by its trusted controller. Canvas code does not
// receive image bytes or arbitrary filesystem access; the result stays beside its design.
CommandsRegistry.registerCommand('openide.canvas.capture', async (accessor, request?: { path: string; rect: { x: number; y: number; width: number; height: number } }) => {
	if (!request || !request.rect || ![request.rect.x, request.rect.y, request.rect.width, request.rect.height].every(Number.isFinite) || request.rect.x < 0 || request.rect.y < 0 || request.rect.width < 1 || request.rect.height < 1 || request.rect.width > 10000 || request.rect.height > 10000) { throw new Error('Invalid Canvas capture rectangle.'); }
	const canvas = accessor.get(IOpenideCanvasService); const files = accessor.get(IFileService); const host = accessor.get(INativeHostService);
	const uri = canvas.resolve(request.path); if (!uri || !uri.path.endsWith('/design.json')) { throw new Error('Invalid design.'); }
	const design = await canvas.readDesign(request.path);
	const image = await host.getScreenshot({ x: Math.round(request.rect.x), y: Math.round(request.rect.y), width: Math.round(request.rect.width), height: Math.round(request.rect.height) });
	if (!image) { throw new Error('Canvas capture is unavailable.'); }
	if (canvas.resolve(request.path)?.toString() !== uri.toString() || (await canvas.readDesign(request.path)).revision !== design.revision) { throw new Error('Design changed during capture. Retry.'); }
	const output = joinPath(uri, '..', `capture-r${design.revision}.jpg`); await files.writeFile(output, image); return output.fsPath;
});

CommandsRegistry.registerCommand('openide.canvas.exportDocument', async (accessor, request: { html: string; format: 'pdf'|'pptx'; title: string }) => accessor.get(INativeHostService).exportCanvasDocument(request.html, request.format, request.title));
