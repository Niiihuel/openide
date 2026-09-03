/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { AgentMode } from '../../common/openideAgentTypes.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { createMenuContent, createMenuRow, createMenuSection, createMenuSeparator, OpenideComposerPopover } from './openideComposerMenu.js';
import { t } from '../../common/openideStrings.js';

export interface IAgentModeEntry {
	readonly id: AgentMode;
	/** Codicon id WITHOUT the `codicon-` prefix, exactly as the webview names it. */
	readonly icon: string;
	readonly label: string;
	readonly description: string;
}

/** The four modes of the webview, in its order. `debug` borrows the workbench's own debug glyph. */
export const OPENIDE_AGENT_MODES: readonly IAgentModeEntry[] = [
	{ id: 'agent', icon: 'openide-mode-agent', label: 'Agent', description: localize('openide.chat.mode.agent', "Edit and run") },
	{ id: 'plan', icon: 'openide-mode-plan', label: 'Plan', description: localize('openide.chat.mode.plan', "Read-only planning") },
	{ id: 'ask', icon: 'openide-mode-ask', label: 'Ask', description: localize('openide.chat.mode.ask', "Read-only Q&A") },
	{ id: 'debug', icon: 'debug', label: 'Debug', description: localize('openide.chat.mode.debug', "Reproduce and fix") },
];

export interface IPermissionEntry {
	readonly id: string;
	readonly label: string;
	readonly icon: string;
	readonly description: string;
}

/** Approval policy. It is a SEPARATE axis from the mode, which is why it hangs off a submenu
 *  instead of sitting among the four modes as a fifth choice. */
export const PERMISSIONS: readonly IPermissionEntry[] = [
	{ id: 'ask', icon: 'shield', label: localize('openide.chat.permission.ask', "Preguntar siempre"), description: t('chat.permission.ask.desc') },
	{ id: 'auto-edit', icon: 'edit', label: localize('openide.chat.permission.autoEdit', "Auto-aprobar ediciones"), description: localize('openide.chat.permission.autoEdit.desc', "Las ediciones de archivo se aplican solas; la terminal sigue preguntando.") },
	{ id: 'auto-all', icon: 'zap', label: localize('openide.chat.permission.autoAll', "Auto-aprobar todo"), description: localize('openide.chat.permission.autoAll.desc', "Todo se ejecuta sin preguntar, salvo lo peligroso y los archivos sensibles.") },
];

export function agentModeEntry(id: string): IAgentModeEntry {
	return OPENIDE_AGENT_MODES.find(entry => entry.id === id) ?? OPENIDE_AGENT_MODES[0];
}

export function permissionLabel(mode: string): string {
	return PERMISSIONS.find(entry => entry.id === (mode || 'ask'))?.label ?? PERMISSIONS[0].label;
}

/**
 * Mode popover: the four agent modes plus the approval policy behind a submenu.
 *
 * The submenu replaces the whole content rather than opening a second popover, exactly like the
 * webview: a nested context view would anchor to a row that is about to be re-rendered, and the
 * back row is cheaper than keeping two overlays alive.
 */
export class OpenideChatModePicker extends Disposable {

	private readonly _popover: OpenideComposerPopover;
	private _mode: AgentMode = 'agent';

	constructor(
		private readonly agentService: IOpenideAgentService,
		contextViewService: IContextViewService,
		/** Repaints the trigger; the composer owns that DOM, not this picker. */
		private readonly onDidChangeMode: (mode: AgentMode) => void,
	) {
		super();
		this._popover = this._register(new OpenideComposerPopover(contextViewService));
	}

	get mode(): AgentMode {
		return this._mode;
	}

	setMode(mode: AgentMode): void {
		this._mode = agentModeEntry(mode).id;
		this.onDidChangeMode(this._mode);
	}

	toggle(anchor: HTMLElement): void {
		this._popover.toggle(anchor, {
			className: 'openide-menu-mode',
			render: (container, store) => {
				const content = createMenuContent(container.ownerDocument);
				container.appendChild(content);
				this._renderModes(content, store);
			},
		});
	}

	close(): void {
		this._popover.close();
	}

	private _renderModes(content: HTMLElement, store: DisposableStore): void {
		const document = content.ownerDocument;
		clearNode(content);
		content.appendChild(createMenuSection(document, localize('openide.chat.mode.section', "Modo")));
		for (const entry of OPENIDE_AGENT_MODES) {
			// The active row keeps its own glyph and is marked by the persistent tint instead;
			// the description travels as the tooltip because narrow docks clipped it.
			const row = createMenuRow(document, {
				icon: entry.icon,
				label: entry.label,
				tooltip: entry.description,
				active: entry.id === this._mode,
			});
			store.add(addDisposableListener(row, 'click', () => {
				this._popover.close();
				this.setMode(entry.id);
			}));
			content.appendChild(row);
		}
		content.appendChild(createMenuSeparator(document));
		const permission = createMenuRow(document, {
			icon: 'shield',
			label: localize('openide.chat.permission.section', "Permisos"),
			detail: permissionLabel(this.agentService.getPermissionMode()),
			tooltip: t('chat.permission.tip'),
			submenu: true,
		});
		store.add(addDisposableListener(permission, 'click', event => {
			event.stopPropagation();
			this._renderPermissions(content, store);
		}));
		content.appendChild(permission);
		this._popover.layout();
	}

	private _renderPermissions(content: HTMLElement, store: DisposableStore): void {
		const document = content.ownerDocument;
		clearNode(content);
		const back = createMenuRow(document, { icon: 'arrow-left', label: localize('openide.chat.mode.section', "Modo"), muted: true });
		store.add(addDisposableListener(back, 'click', event => {
			event.stopPropagation();
			this._renderModes(content, store);
		}));
		content.appendChild(back);
		content.appendChild(createMenuSection(document, localize('openide.chat.permission.section', "Permisos")));
		const current = this.agentService.getPermissionMode() || 'ask';
		for (const entry of PERMISSIONS) {
			const row = createMenuRow(document, {
				icon: entry.icon,
				label: entry.label,
				tooltip: entry.description,
				active: entry.id === current,
			});
			store.add(addDisposableListener(row, 'click', () => {
				this._popover.close();
				void this.agentService.setPermissionMode(entry.id);
			}));
			content.appendChild(row);
		}
		this._popover.layout();
	}
}
