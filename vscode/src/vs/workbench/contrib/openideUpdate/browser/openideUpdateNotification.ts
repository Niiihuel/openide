/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from '../../../../base/common/actions.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationHandle, INotificationService, NotificationPriority, Severity } from '../../../../platform/notification/common/notification.js';
import { getOpenideVersion } from '../../../../platform/product/common/openideVersion.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IUpdateService, State, StateType } from '../../../../platform/update/common/update.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { t } from '../../openideAgent/common/openideStrings.js';
import { SHOW_UPDATE_STATUS_COMMAND_ID } from '../../update/browser/updateTitleBarEntry.js';

/** Keeps discovered updates in the notification center after the title-bar popover is dismissed. */
export class OpenideUpdateNotificationContribution extends Disposable implements IWorkbenchContribution {

	private readonly announcedVersions = new Set<string>();
	private notification: INotificationHandle | undefined;
	private readonly notificationAction = this._register(new MutableDisposable<Action>());

	constructor(
		@IUpdateService updateService: IUpdateService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
		@IProductService private readonly productService: IProductService,
	) {
		super();
		this._register(toDisposable(() => this.notification?.close()));
		this._register(updateService.onStateChange(state => this.onStateChange(state)));
		// A window can restore after main has already discovered or downloaded an update.
		this.onStateChange(updateService.state);
	}

	private onStateChange(state: State): void {
		if (state.type === StateType.Disabled || state.type === StateType.Idle) {
			this.notification?.close();
			this.notification = undefined;
			this.notificationAction.clear();
			return;
		}

		if (state.type !== StateType.AvailableForDownload && state.type !== StateType.Downloading
			&& state.type !== StateType.Verifying && state.type !== StateType.Downloaded
			&& state.type !== StateType.Updating && state.type !== StateType.Ready
			&& state.type !== StateType.Overwriting) {
			return;
		}

		const version = state.update?.productVersion;
		if (!version || version === getOpenideVersion(this.productService) || this.announcedVersions.has(version)) {
			return;
		}
		this.announcedVersions.add(version);
		this.notification?.close();
		const action = this.notificationAction.value = new Action('openide.update.showNotification', t('update.notification.show'), undefined, true, async () => {
			const shown = await this.commandService.executeCommand<boolean>(SHOW_UPDATE_STATUS_COMMAND_ID);
			if (!shown) {
				// The title-bar indicator can be disabled. The update command remains available.
				await this.commandService.executeCommand('openide.update.check');
			}
		});
		this.notification = this.notificationService.notify({
			id: `openide.update.available.${version}`,
			source: { id: 'openide.update', label: t('update.notification.source') },
			severity: Severity.Info,
			message: t('update.status.available', this.productService.nameShort, version),
			// The existing popover announces the update; keep the bell/unread entry without
			// opening a second toast or moving focus away from the editor or composer.
			priority: NotificationPriority.SILENT,
			actions: { primary: [action] },
		});
	}
}
