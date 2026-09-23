/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import { $, addDisposableListener, append, clearNode } from '../../base/browser/dom.js';
import { KeybindingLabel } from '../../base/browser/ui/keybindingLabel/keybindingLabel.js';
import { onUnexpectedError } from '../../base/common/errors.js';
import { Disposable, DisposableStore } from '../../base/common/lifecycle.js';
import { OS } from '../../base/common/platform.js';
import { IKeybindingService } from '../../platform/keybinding/common/keybinding.js';
import { defaultKeybindingLabelStyles } from '../../platform/theme/browser/defaultStyles.js';
import './media/openideEmptyState.css';

export interface IOpenideEmptyStateAction {
	readonly label: string;
	readonly run: () => void | Promise<void>;
	readonly commandId?: string;
}

export interface IOpenideEmptyStateOptions {
	readonly title: string;
	readonly description: string;
	readonly brand?: boolean;
	readonly compact?: boolean;
	readonly hideHeading?: boolean;
	readonly actions?: readonly IOpenideEmptyStateAction[];
}

/** Shared identity and copy for editor, chat and tool empty states. */
export function renderOpenideEmptyStateHeading(container: HTMLElement, options: Pick<IOpenideEmptyStateOptions, 'title' | 'description'> & { brand?: boolean }): { iconNode: HTMLElement; titleNode: HTMLElement; descriptionNode: HTMLElement } {
	container.classList.add('openide-empty-state-heading');
	const iconNode = append(container, $('span.openide-empty-state-icon', { 'aria-hidden': 'true' }));
	if (options.brand) { iconNode.classList.add('openide-empty-state-brand-icon'); }
	else { iconNode.hidden = true; }
	const copy = append(container, $('.openide-empty-state-copy'));
	const titleNode = append(copy, $('h2.openide-empty-state-title', undefined, options.title));
	const descriptionNode = append(copy, $('p.openide-empty-state-description', undefined, options.description));
	return { iconNode, titleNode, descriptionNode };
}

/** The watermark command pattern, shared by passive hints and actionable empty states. */
export function renderOpenideCommandRow(container: HTMLElement, label: string, interactive = false): { row: HTMLElement; keys: HTMLElement } {
	const row = append(container, $(interactive ? 'button.openide-command-row' : 'dl.openide-command-row'));
	if (interactive) { row.setAttribute('type', 'button'); row.setAttribute('aria-label', label); }
	append(row, $(interactive ? 'span.openide-command-label' : 'dt.openide-command-label', undefined, label));
	const keys = append(row, $(interactive ? 'span.openide-command-keybinding' : 'dd.openide-command-keybinding'));
	return { row, keys };
}

/** A quiet, contextual empty surface with native keyboard labels and shared action controls. */
export class OpenideEmptyState extends Disposable {
	readonly domNode: HTMLElement;
	readonly descriptionNode: HTMLElement;
	readonly actionsNode: HTMLElement;
	readonly contentNode: HTMLElement;
	private readonly actionStore = this._register(new DisposableStore());

	constructor(container: HTMLElement, options: IOpenideEmptyStateOptions,
		@IKeybindingService private readonly keybindings: IKeybindingService,
	) {
		super();
		this.domNode = append(container, $('.openide-empty-state'));
		this.domNode.classList.toggle('compact', !!options.compact);
		this.domNode.setAttribute('aria-label', options.title);
		const body = append(this.domNode, $('.openide-empty-state-body'));
		const headingNode = append(body, $('div'));
		const heading = renderOpenideEmptyStateHeading(headingNode, { title: options.title, description: options.description, brand: options.brand });
		headingNode.hidden = !!options.hideHeading;
		this.descriptionNode = heading.descriptionNode;
		this.actionsNode = append(body, $('.openide-empty-state-actions.openide-command-list'));
		this.contentNode = append(body, $('.openide-empty-state-content'));
		this.setActions(options.actions ?? []);
	}

	setActions(actions: readonly IOpenideEmptyStateAction[]): void {
		this.actionStore.clear(); clearNode(this.actionsNode);
		for (const action of actions) {
			const { row: button, keys } = renderOpenideCommandRow(this.actionsNode, action.label, true);
			button.classList.add('openide-empty-state-action');
			keys.classList.add('openide-empty-state-keybinding');
			keys.hidden = !action.commandId;
			if (action.commandId) {
				const label = this.actionStore.add(new KeybindingLabel(keys, OS, defaultKeybindingLabelStyles));
				const update = () => {
					const binding = this.keybindings.lookupKeybinding(action.commandId!);
					keys.hidden = !binding; label.set(binding);
					const shortcut = binding?.getElectronAccelerator()?.replace(/\bCtrl\b/g, 'Control').replace(/\bCmd\b/g, 'Meta');
					if (shortcut) { button.setAttribute('aria-keyshortcuts', shortcut); }
					else { button.removeAttribute('aria-keyshortcuts'); }
				};
				this.actionStore.add(this.keybindings.onDidUpdateKeybindings(update)); update();
			}
			this.actionStore.add(addDisposableListener(button, 'click', () => { Promise.resolve().then(() => action.run()).catch(onUnexpectedError); }));
		}
	}
}
