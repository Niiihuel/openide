/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE-owned update commands and UX. Legacy update.* commands remain IPC-compatible.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { CONTEXT_UPDATE_STATE } from '../../update/browser/update.js';

function statusMessage(state: IUpdateService['state'], product: IProductService): string {
	switch (state.type) {
		case StateType.CheckingForUpdates: return `Buscando actualizaciones de ${product.nameShort}…`;
		case StateType.AvailableForDownload: return `${product.nameShort} ${state.update.productVersion ?? ''} está disponible.`;
		case StateType.Downloading: return `Descargando ${product.nameShort}…`;
		case StateType.Verifying: return 'Verificando firma y SHA-256…';
		case StateType.Downloaded: return 'Actualización descargada y verificada.';
		case StateType.Ready: return 'Actualización lista. Reiniciá para instalarla.';
		case StateType.RecoveryAvailable: return 'Hay una versión anterior disponible para recuperación.';
		case StateType.Disabled: return 'Las actualizaciones automáticas no están disponibles en esta instalación.';
		default: return `${product.nameShort} está actualizado.`;
	}
}

class OpenideCheckForUpdatesAction extends Action2 {
	constructor() { super({ id: 'openide.update.check', title: localize2('openide.update.check', 'OpenIDE: Buscar actualizaciones'), f1: true, menu: [{ id: MenuId.MenubarHelpMenu, group: '1_welcome', order: 1 }] }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const updates = accessor.get(IUpdateService); const notifications = accessor.get(INotificationService); const product = accessor.get(IProductService);
		await updates.checkForUpdates(true); notifications.notify({ severity: Severity.Info, message: statusMessage(updates.state, product) });
	}
}
class OpenideDownloadUpdateAction extends Action2 {
	constructor() { super({ id: 'openide.update.download', title: localize2('openide.update.download', 'OpenIDE: Descargar actualización'), f1: true, precondition: CONTEXT_UPDATE_STATE.isEqualTo(StateType.AvailableForDownload) }); }
	run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IUpdateService).downloadUpdate(true); }
}
class OpenideInstallUpdateAction extends Action2 {
	constructor() { super({ id: 'openide.update.install', title: localize2('openide.update.install', 'OpenIDE: Instalar actualización'), f1: true, precondition: CONTEXT_UPDATE_STATE.isEqualTo(StateType.Downloaded) }); }
	run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IUpdateService).applyUpdate(); }
}
class OpenideRestartUpdateAction extends Action2 {
	constructor() { super({ id: 'openide.update.restart', title: localize2('openide.update.restart', 'OpenIDE: Reiniciar y actualizar'), f1: true, precondition: CONTEXT_UPDATE_STATE.isEqualTo(StateType.Ready) }); }
	run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IUpdateService).quitAndInstall(); }
}
class OpenideRecoverUpdateAction extends Action2 {
	constructor() { super({ id: 'openide.update.recover', title: localize2('openide.update.recover', 'OpenIDE: Restaurar versión anterior'), f1: true, precondition: CONTEXT_UPDATE_STATE.isEqualTo(StateType.RecoveryAvailable) }); }
	run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IUpdateService).recoverPreviousVersion(); }
}

registerAction2(OpenideCheckForUpdatesAction); registerAction2(OpenideDownloadUpdateAction); registerAction2(OpenideInstallUpdateAction); registerAction2(OpenideRestartUpdateAction); registerAction2(OpenideRecoverUpdateAction);
