/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { t } from '../common/openideStrings.js';

type ContextTab = 'changes' | 'terminals' | 'context';

/** A small native tablist; changing the visible panel never destroys its contents. */
export class OpenideAgentWindowContextTabs extends Disposable {
	private readonly tabs = new Map<ContextTab, { button: HTMLButtonElement; panel: HTMLElement }>();
	private readonly selections = new Map<string, ContextTab>();
	private sessionId = '';
	private active: ContextTab = 'changes';

	constructor(parent: HTMLElement) {
		super();
		const tablist = append(parent, $('.openide-conversation-context-tabs', { role: 'tablist', 'aria-label': t('conversationWorkspace.title') }));
		for (const name of ['changes', 'terminals', 'context'] as const) {
			const button = append(tablist, $<HTMLButtonElement>('button.openide-conversation-context-tab', { type: 'button', role: 'tab', id: `conversation-context-tab-${name}`, 'aria-controls': `conversation-context-panel-${name}` }, t(`conversationWorkspace.${name}`)));
			const panel = append(parent, $('.openide-conversation-context-panel', { role: 'tabpanel', id: `conversation-context-panel-${name}`, 'aria-labelledby': button.id }));
			this.tabs.set(name, { button, panel });
			this._register(addDisposableListener(button, 'click', () => this.select(name)));
			this._register(addDisposableListener(button, 'keydown', event => {
				const keys = [...this.tabs.keys()];
				const index = keys.indexOf(name);
				const next = event.key === 'Home' ? keys[0] : event.key === 'End' ? keys[keys.length - 1] : event.key === 'ArrowRight' ? keys[(index + 1) % keys.length] : event.key === 'ArrowLeft' ? keys[(index + keys.length - 1) % keys.length] : undefined;
				if (next) { event.preventDefault(); event.stopPropagation(); this.select(next); this.tabs.get(next)!.button.focus(); }
			}));
		}
		this.select(this.active);
	}

	panel(name: ContextTab): HTMLElement { return this.tabs.get(name)!.panel; }

	setSession(sessionId: string | undefined): void {
		if (this.sessionId === (sessionId ?? '')) { return; }
		this.sessionId = sessionId ?? '';
		this.select(this.selections.get(this.sessionId) ?? 'changes');
	}

	private select(name: ContextTab): void {
		this.active = name;
		this.selections.set(this.sessionId, name);
		for (const [key, { button, panel }] of this.tabs) {
			const active = key === name;
			button.setAttribute('aria-selected', String(active));
			button.tabIndex = active ? 0 : -1;
			panel.hidden = !active;
			panel.inert = !active;
		}
	}
}
