/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE-owned update commands and UX. Legacy update.* commands remain IPC-compatible.
 *--------------------------------------------------------------------------------------------*/

import { t } from '../../openideAgent/common/openideStrings.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { CONTEXT_UPDATE_STATE } from '../../update/browser/update.js';

function statusMessage(state: IUpdateService['state'], product: IProductService): string {
	switch (state.type) {
		case StateType.CheckingForUpdates: return t('update.status.checking', product.nameShort);
		case StateType.AvailableForDownload: return t('update.status.available', product.nameShort, state.update.productVersion ?? '');
		case StateType.Downloading: return t('update.status.downloading', product.nameShort);
		case StateType.Verifying: return t('update.status.verifying');
		case StateType.Downloaded: return t('update.status.downloaded');
		case StateType.Ready: return t('update.status.ready');
		case StateType.RecoveryAvailable: return t('update.status.recovery');
		case StateType.Disabled: return t('update.status.disabled');
		default: return t('update.status.upToDate', product.nameShort);
	}
}

class OpenideCheckForUpdatesAction extends Action2 {
	constructor() { super({ id: 'openide.update.check', title: { value: t('update.check'), original: 'OpenIDE: Check for Updates' }, f1: true, menu: [{ id: MenuId.MenubarHelpMenu, group: '1_welcome', order: 1 }] }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const updates = accessor.get(IUpdateService); const notifications = accessor.get(INotificationService); const product = accessor.get(IProductService);
		await updates.checkForUpdates(true); notifications.notify({ severity: Severity.Info, message: statusMessage(updates.state, product) });
	}
}
class OpenideDownloadUpdateAction extends Action2 {
	constructor() { super({ id: 'openide.update.download', title: { value: t('update.download'), original: 'OpenIDE: Download Update' }, f1: true, precondition: CONTEXT_UPDATE_STATE.isEqualTo(StateType.AvailableForDownload) }); }
	run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IUpdateService).downloadUpdate(true); }
}
class OpenideInstallUpdateAction extends Action2 {
	constructor() { super({ id: 'openide.update.install', title: { value: t('update.install'), original: 'OpenIDE: Install Update' }, f1: true, precondition: CONTEXT_UPDATE_STATE.isEqualTo(StateType.Downloaded) }); }
	run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IUpdateService).applyUpdate(); }
}
class OpenideRestartUpdateAction extends Action2 {
	constructor() { super({ id: 'openide.update.restart', title: { value: t('update.restart'), original: 'OpenIDE: Restart and Update' }, f1: true, precondition: CONTEXT_UPDATE_STATE.isEqualTo(StateType.Ready) }); }
	run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IUpdateService).quitAndInstall(); }
}
class OpenideRecoverUpdateAction extends Action2 {
	constructor() { super({ id: 'openide.update.recover', title: { value: t('update.recover'), original: 'OpenIDE: Restore Previous Version' }, f1: true, precondition: CONTEXT_UPDATE_STATE.isEqualTo(StateType.RecoveryAvailable) }); }
	run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IUpdateService).recoverPreviousVersion(); }
}

registerAction2(OpenideCheckForUpdatesAction); registerAction2(OpenideDownloadUpdateAction); registerAction2(OpenideInstallUpdateAction); registerAction2(OpenideRestartUpdateAction); registerAction2(OpenideRecoverUpdateAction);
