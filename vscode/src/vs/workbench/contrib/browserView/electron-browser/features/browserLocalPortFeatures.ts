/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Severity from '../../../../../base/common/severity.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { asText, IRequestService } from '../../../../../platform/request/common/request.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IDebugService } from '../../../debug/common/debug.js';
import { ILocalUrlMatch, UrlFinder } from '../../../remote/browser/urlFinder.js';
import { ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { workbenchConfigurationNodeBase } from '../../../../common/configuration.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IBrowserViewWorkbenchService } from '../../common/browserView.js';

const autoOpenLocalPortsSetting = 'workbench.browser.autoOpenLocalPorts';
type AutoOpenLocalPorts = 'off' | 'notify' | 'open';

/**
 * Bridges the existing terminal/debug URL detector to the integrated browser for local
 * workspaces. Remote workspaces keep using the forwarding subsystem, which owns tunnelling.
 */
class BrowserLocalPortContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.browserLocalPortDetection';
	private readonly pending = new Set<string>();

	constructor(
		@ITerminalService terminalService: ITerminalService,
		@IDebugService debugService: IDebugService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IBrowserViewWorkbenchService private readonly browserViewService: IBrowserViewWorkbenchService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IRequestService private readonly requestService: IRequestService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
	) {
		super();
		if (environmentService.remoteAuthority) {
			return;
		}

		const finder = this._register(new UrlFinder(terminalService, debugService));
		this._register(finder.onDidMatchLocalUrlDetailed(match => void this.onLocalUrl(match)));
	}

	private async onLocalUrl(match: ILocalUrlMatch): Promise<void> {
		const mode = this.configurationService.getValue<AutoOpenLocalPorts>(autoOpenLocalPortsSetting);
		if (mode === 'off') {
			return;
		}
		if (match.source.type === 'terminal' && !(await this.isWorkspaceTerminal(match.source.instance))) {
			return;
		}

		const normalizedHost = match.host === '0.0.0.0' || match.host === '127.0.0.1' ? 'localhost' : match.host;
		const url = `http://${normalizedHost}:${match.port}`;
		const key = `${normalizedHost}:${match.port}`;
		if (this.pending.has(key) || this.hasBrowserForPort(match.port)) {
			return;
		}
		this.pending.add(key);
		try {
			if (!(await this.isFrontend(url, match.output))) {
				return;
			}
		} finally {
			this.pending.delete(key);
		}
		const open = () => this.browserViewService.openPreview(url);
		if (mode === 'open') {
			void open();
			return;
		}

		this.notificationService.prompt(
			Severity.Info,
			localize('browser.localPortDetected', "OpenIDE detected a local frontend on port {0}.", match.port),
			[{
				label: localize('browser.openLocalPort', "Open in Integrated Browser"),
				run: open,
			}],
		);
	}

	private async isWorkspaceTerminal(instance: ITerminalInstance): Promise<boolean> {
		if (instance.workspaceFolder && this.workspaceContextService.isInsideWorkspace(instance.workspaceFolder.uri)) {
			return true;
		}
		try {
			return this.workspaceContextService.isInsideWorkspace(URI.file(await instance.getSpeculativeCwd()));
		} catch {
			return false;
		}
	}

	private async isFrontend(url: string, terminalOutput: string): Promise<boolean> {
		const output = terminalOutput.toLowerCase();
		const frontendSignal = /\b(vite|next(?:\.js)?|astro|nuxt|svelte|webpack|angular|react|frontend)\b|\blocal:\s*https?:/.test(output);
		const backendSignal = /\b(api|backend|express|nestjs?|fastapi|uvicorn|django|rails|swagger|debugger listening|server listening)\b/.test(output);
		if (backendSignal && !frontendSignal) {
			return false;
		}
		try {
			const response = await this.requestService.request({
				type: 'GET',
				url,
				headers: { Accept: 'text/html' },
				timeout: 3000,
				disableCache: true,
				callSite: 'browserLocalFrontendDetection',
			}, CancellationToken.None);
			if (!response.res.statusCode || response.res.statusCode < 200 || response.res.statusCode >= 400) {
				return false;
			}
			const contentType = String(response.res.headers['content-type'] ?? '').toLowerCase();
			const body = (await asText(response) ?? '').slice(0, 100_000);
			return (contentType.includes('text/html') || /^\s*<!doctype\s+html/i.test(body))
				&& /<(?:html|head|body|title|script|link)\b/i.test(body);
		} catch {
			return false;
		}
	}

	private hasBrowserForPort(port: number): boolean {
		for (const input of this.browserViewService.getKnownBrowserViews().values()) {
			try {
				const parsed = new URL(input.url ?? '');
				const parsedPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
				if (Number(parsedPort) === port) {
					return true;
				}
			} catch {
				// A blank or partially-entered browser URL cannot represent this server yet.
			}
		}
		return false;
	}
}

registerWorkbenchContribution2(BrowserLocalPortContribution.ID, BrowserLocalPortContribution, WorkbenchPhase.AfterRestored);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		[autoOpenLocalPortsSetting]: {
			type: 'string',
			enum: ['off', 'notify', 'open'],
			enumDescriptions: [
				localize('browser.autoOpenLocalPorts.off', "Do not react to local application URLs printed by terminals or debug sessions."),
				localize('browser.autoOpenLocalPorts.notify', "Ask before opening a detected local application."),
				localize('browser.autoOpenLocalPorts.open', "Open the detected local frontend in the workspace preview."),
			],
			default: 'open',
			description: localize('browser.autoOpenLocalPorts', "Controls how frontend URLs detected from this workspace's terminal and debug output are opened."),
			scope: ConfigurationScope.WINDOW,
		},
	}
});
