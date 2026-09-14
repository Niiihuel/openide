/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { OpenideChatWidget } from './chat/openideChatWidget.js';
import { OpenideChatSessions } from './openideChatSessions.js';
import { OpenideChatStatus } from './openideChatStatus.js';
import { OpenideAgentWindow } from './openideAgentWindow.js';


export const IOpenideChatRuntime = createDecorator<IOpenideChatRuntime>('openideChatRuntime');

export interface IOpenideChatRuntime {
	readonly _serviceBrand: undefined;
	readonly widget: OpenideChatWidget;
	openAgentWindow(): Promise<void>;
	showUsagePopover(): void;
}

/** Conversation execution survives either presentation; creating it does not reveal an IDE view. */
class OpenideChatRuntime extends Disposable implements IOpenideChatRuntime {
	declare readonly _serviceBrand: undefined;
	private primary: OpenideChatWidget | undefined;
	private agentWindow: OpenideAgentWindow | undefined;
	private status: OpenideChatStatus | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService private readonly storageService: IStorageService,
	) { super(); }

	get widget(): OpenideChatWidget {
		if (!this.primary) {
			// A detached host keeps the main chat unmounted until the user opens it explicitly.
			const host = mainWindow.document.createElement('div');
			this.primary = this._register(this.instantiationService.createInstance(OpenideChatWidget, host, new OpenideChatSessions(this.storageService)));
			this.primary.setVisible(false);
			this.status = this._register(this.instantiationService.createInstance(OpenideChatStatus, this.primary));
		}
		return this.primary;
	}

	showUsagePopover(): void { void this.widget; this.status?.showUsagePopover(); }

	openAgentWindow(): Promise<void> {
		this.agentWindow ??= this._register(this.instantiationService.createInstance(OpenideAgentWindow, this.widget, (container, document, focusChat) => this.status?.registerStatusbarMirror(container, document, focusChat) ?? { dispose() {} }));
		return this.agentWindow.open();
	}
}

registerSingleton(IOpenideChatRuntime, OpenideChatRuntime, InstantiationType.Delayed);
