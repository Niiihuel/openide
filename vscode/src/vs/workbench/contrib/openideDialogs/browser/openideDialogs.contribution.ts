/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { applyOpenideSurfaceCss } from '../../openideAgent/browser/openideSurfaceStyle.js';
import './media/openideDialog.css';

/** Gate for every rule in media/openideDialog.css, the way the Modern UI modules gate theirs. */
const OPENIDE_DIALOGS_CLASS = 'openide-dialogs';

/**
 * OpenIDE's modals.
 *
 * The fork had none: `window.dialogStyle` defaults to `native` on desktop, so a confirmation was
 * whatever the OS draws — on Linux a GTK window with GTK's type, buttons and corners, dropped on
 * top of an IDE built around one radius scale and one set of surface tokens. It is also opaque to
 * the workbench: it lives in another window, so it cannot be styled, screenshotted or driven from
 * inside, which is why the fork's own visual checks never once caught how it looked.
 *
 * This puts the class on and installs the `--oi-*` tokens the stylesheet is written against. The
 * DEFAULT of the setting is flipped in `desktop.contribution.ts`, next to the setting itself, so
 * anyone who prefers the system dialog still has `window.dialogStyle: "native"`.
 *
 * The tokens are installed here and not left to whoever mounts first because a dialog can BE the
 * first thing on screen — a "this workspace is not trusted" or a "restore the previous session?"
 * arrives before the chat dock or Settings exist. `applyOpenideSurfaceCss` is idempotent.
 */
export class OpenideDialogsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openideDialogs';

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
	) {
		super();
		applyOpenideSurfaceCss();
		for (const container of this.layoutService.containers) {
			container.classList.add(OPENIDE_DIALOGS_CLASS);
		}
		// Auxiliary windows open after startup and get their own container.
		this._register(this.layoutService.onDidAddContainer(({ container }) => container.classList.add(OPENIDE_DIALOGS_CLASS)));
	}
}

// BlockRestore, like Modern UI: the class has to be on before anything can put a dialog on screen.
registerWorkbenchContribution2(OpenideDialogsContribution.ID, OpenideDialogsContribution, WorkbenchPhase.BlockRestore);
