/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService, NO_FETCH_TELEMETRY } from '../../request/common/request.js';
import { listenStream } from '../../../base/common/stream.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { DeferredPromise } from '../../../base/common/async.js';
import { Event } from '../../../base/common/event.js';
import { app } from 'electron';
import { getOpenideVersion } from '../../product/common/openideVersion.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { finished } from 'stream/promises';
import { getOpenideAppImageLauncher, getOpenideAppImagePaths, markOpenideAppImageHealthy, recoverOpenideAppImage, stageOpenideAppImage } from './openideAppImageUpdater.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, State, UpdateType } from '../common/update.js';
import { AbstractUpdateService, createUpdateURL, IUpdateURLOptions } from './abstractUpdateService.js';

export class LinuxUpdateService extends AbstractUpdateService {
	private downloadCts: CancellationTokenSource | undefined;
	private downloadFinished: DeferredPromise<void> | undefined;
	private checkCts: CancellationTokenSource | undefined;

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
		@IProductService productService: IProductService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
		@IWindowsMainService windowsMainService: IWindowsMainService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, false);
		const acknowledgeStartup = () => {
			const current = process.env['OPENIDE_APPIMAGE_PATH'] || process.env['APPIMAGE'];
			if (environmentMainService.isBuilt && current && !current.startsWith('/nix/store/')) {
				void markOpenideAppImageHealthy(getOpenideAppImagePaths(current), getOpenideVersion(productService))
					.catch(error => logService.warn('update#AppImage health confirmation failed', error));
			}
		};
		if (windowsMainService.getWindows().some(window => window.isReady)) { acknowledgeStartup(); }
		else { this._register(Event.once(windowsMainService.onDidSignalReadyWindow)(acknowledgeStartup)); }
	}

	protected buildUpdateFeedUrl(quality: string, _commit: string, _options?: IUpdateURLOptions): string {
		return createUpdateURL(this.productService, quality, process.platform, process.arch, 'appimage');
	}

	protected doCheckForUpdates(explicit: boolean, _pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));
		this.checkCts?.dispose(true);
		const checkCts = this.checkCts = new CancellationTokenSource();

		const internalOrg = this.getInternalOrg();
		const background = !explicit && !internalOrg;
		const url = this.buildUpdateFeedUrl(this.quality, this.productService.commit!, { background, internalOrg });

		this.logService.info('update#doCheckForUpdates', { url, explicit, background });

		this._isLatestVersion(url, explicit, checkCts.token)
			.then((result) => {
				if (checkCts.token.isCancellationRequested) { return; }
				if(!result) {
					this.setState(State.Idle(UpdateType.Archive));

					return Promise.resolve(null);
				}

				if(result.lastest) {
					this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				}
				else {
					this.setState(State.AvailableForDownload(result.update));
				}

				return Promise.resolve(null);
			})
			.then(undefined, (error) => {
				if (checkCts.token.isCancellationRequested) { return; }
				this.logService.error(error);

				// only show message when explicitly checking for updates
				const message: string | undefined = explicit ? (error.message || error) : undefined;

				this.setState(State.Idle(UpdateType.Archive, message));
			}).finally(() => {
				if (this.checkCts === checkCts) { this.checkCts = undefined; }
				checkCts.dispose();
			});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		const current = process.env['OPENIDE_APPIMAGE_PATH'] || process.env['APPIMAGE'];
		if (!current || !state.update.url || !state.update.sha256hash || !state.update.size) {
			if (state.update.url) { this.nativeHostMainService.openExternal(undefined, state.update.url); }
			this.setState(State.Idle(UpdateType.Archive, 'Esta instalación no es un AppImage mutable.'));
			return;
		}
		if (this.downloadCts) { return; }
		const downloadFinished = this.downloadFinished = new DeferredPromise<void>();
		const operationCts = new CancellationTokenSource(); this.downloadCts = operationCts; this.setState(State.Downloading(state.update, true, false, 0, state.update.size, Date.now()));
		let dir: string | undefined;
		try {
			const paths = getOpenideAppImagePaths(current); dir = await mkdtemp(join(tmpdir(), 'openide-update-')); const download = join(dir, 'OpenIDE.AppImage');
			if (operationCts.token.isCancellationRequested) { this.setState(State.Idle(UpdateType.Archive)); return; }
			const context = await this.requestService.request({ url: state.update.url, callSite: NO_FETCH_TELEMETRY }, operationCts.token);
			if (!context.res.statusCode || context.res.statusCode < 200 || context.res.statusCode >= 300) { throw new Error(`Descarga HTTP ${context.res.statusCode ?? 'sin status'}.`); }
			const output = createWriteStream(download, { mode: 0o700, flags: 'wx' }); const completed = finished(output); completed.catch(() => undefined); let received = 0;
			await new Promise<void>((resolve, reject) => { let settled = false; output.once('error', error => { if (!settled) { settled = true; context.stream.destroy(); reject(error); } }); listenStream(context.stream, {
				onData: chunk => { if (settled) { return; } received += chunk.byteLength; if (received > state.update.size!) { settled = true; context.stream.destroy(); output.destroy(); reject(new Error('La descarga excede el tamaño firmado.')); return; } if (!output.write(Buffer.from(chunk as unknown as Uint8Array))) { context.stream.pause(); output.once('drain', () => context.stream.resume()); } },
				onError: error => { if (!settled) { settled = true; output.destroy(); reject(error); } },
				onEnd: () => { if (!settled) { settled = true; output.end(); resolve(); } },
			}); });
			await completed; if (received !== state.update.size) { throw new Error('La descarga quedó truncada.'); }
			if (operationCts.token.isCancellationRequested) { this.setState(State.Idle(UpdateType.Archive)); return; }
			this.setState(State.Verifying(state.update, true));
			const staged = await stageOpenideAppImage(download, paths, state.update.productVersion ?? state.update.version, state.update.size!, state.update.sha256hash!, operationCts.token);
			this.setState(staged ? State.Ready(state.update, true, false) : State.Idle(UpdateType.Archive));
		} catch (error) {
			if (operationCts.token.isCancellationRequested) { return; }
			this.setState(State.Idle(UpdateType.Archive, error instanceof Error ? error.message : String(error))); throw error;
		} finally { if (dir) { await rm(dir, { recursive: true, force: true }).catch(error => this.logService.warn('No se pudo limpiar temporal de update', error)); } if (this.downloadCts === operationCts) { this.downloadCts = undefined; } operationCts.dispose(); this.downloadFinished = undefined; downloadFinished.complete(); }
	}

	protected override async cancelUpdate(): Promise<void> {
		this.checkCts?.cancel();
		this.downloadCts?.cancel();
		await this.downloadFinished?.p;
	}

	protected override doQuitAndInstall(): void {
		const current = process.env['OPENIDE_APPIMAGE_PATH'] || process.env['APPIMAGE'];
		if (current) {
			app.relaunch({ execPath: getOpenideAppImageLauncher(current, this.productService.applicationName, process.env['OPENIDE_APPIMAGE_LAUNCHER']), args: process.argv.slice(1) });
		}
	}

	override dispose(): void {
		this.checkCts?.dispose(true);
		this.downloadCts?.cancel();
		super.dispose();
	}

	protected override async cancelPendingUpdate(): Promise<void> { this.downloadCts?.cancel(); }

	override async recoverPreviousVersion(): Promise<void> {
		const current = process.env['OPENIDE_APPIMAGE_PATH'] || process.env['APPIMAGE']; if (!current) { return; }
		if (await recoverOpenideAppImage(getOpenideAppImagePaths(current))) { this.setState(State.Idle(UpdateType.Archive)); }
	}
}
