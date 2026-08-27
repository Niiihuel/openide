/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the Project Map's floating cards, as ONE primitive.
 *
 *  The map has three panels stacked over the canvas (search, modules, inspector) and each one had
 *  grown its own head markup. Only the modules panel could be collapsed, and its collapse was
 *  ~15 lines wired by hand in `createEditor`: a chevron, a class toggle, a storage key and an
 *  icon swap. Giving the other two the same behaviour by copy-paste would have been the third
 *  copy of that logic and the third chance for them to drift apart.
 *
 *  So a card is: a head that is itself the toggle (that is how the workbench's own panes behave —
 *  the whole header is clickable, the chevron only SHOWS the state), a body that the `collapsed`
 *  class hides, and a state remembered per profile so the map comes back the way it was left.
 *  A card without a `storageKey` is one whose collapsed state is not worth remembering.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { t } from '../../common/openideStrings.js';

export function projectMapIcon(id: ThemeIcon): HTMLElement {
	return $(`span.${ThemeIcon.asClassName(id).replace(/ /g, '.')}`);
}

export interface IProjectMapCardOptions {
	/** Extra class on the card, carrying its per-panel sizing rules. */
	readonly className: string;
	/** Leading glyph in the head. Omitted when the head supplies its own (the inspector's file icon). */
	readonly icon?: ThemeIcon;
	/** Head label. Omitted when the caller fills the head itself (the search field IS the head). */
	readonly title?: string;
	/** Where the collapsed state is remembered. Absent = not remembered, and starts expanded. */
	readonly storageKey?: string;
	readonly startCollapsed?: boolean;
	/** What the toggle's tooltip says, e.g. "Collapse modules". Falls back to the generic pair. */
	readonly collapseTitle?: string;
	readonly expandTitle?: string;
}

/**
 * A floating card of the Project Map. The head toggles, the body hides; everything a panel adds
 * goes into `head` (before the toggle, via `addHeadAction`) or into `body`.
 */
export class OpenideProjectMapCard extends Disposable {

	readonly card: HTMLElement;
	readonly head: HTMLElement;
	readonly body: HTMLElement;
	/** Filled by the caller when the head needs more than icon + title (a count, a link, a close). */
	readonly headActions: HTMLElement;

	private readonly toggle: HTMLButtonElement;
	private readonly _onDidToggle = this._register(new Emitter<boolean>());
	/** Fires with the NEW collapsed state; panels re-scan their scrollables on it. */
	readonly onDidToggle: Event<boolean> = this._onDidToggle.event;

	private _collapsed = false;

	constructor(
		parent: HTMLElement,
		private readonly options: IProjectMapCardOptions,
		private readonly storageService: IStorageService,
	) {
		super();
		this.card = append(parent, $(`.openide-pmap-card.${options.className}`));
		this.head = append(this.card, $('.openide-pmap-card-head'));
		if (options.icon) {
			append(this.head, projectMapIcon(options.icon));
		}
		if (options.title) {
			append(this.head, $('span.openide-pmap-card-title', undefined, options.title));
		}
		this.headActions = append(this.head, $('.openide-pmap-head-actions'));
		this.toggle = append(this.headActions, $('button.openide-pmap-iconbtn.openide-pmap-collapse', { type: 'button', tabindex: '-1' })) as HTMLButtonElement;
		this.body = append(this.card, $('.openide-pmap-card-body'));

		// The whole head is the hit target, like a workbench pane header. The actions inside it are
		// real buttons doing their own thing, so a click that started on one must not also toggle.
		this.head.setAttribute('role', 'button');
		this.head.tabIndex = 0;
		this._register(addDisposableListener(this.head, 'click', event => {
			const target = event.target as HTMLElement | null;
			if (target && target !== this.toggle && !this.toggle.contains(target) && target.closest('button, input, a')) {
				return;
			}
			this.setCollapsed(!this._collapsed, true);
		}));
		this._register(addDisposableListener(this.head, 'keydown', event => {
			const key = new StandardKeyboardEvent(event);
			if (key.keyCode === KeyCode.Enter || key.keyCode === KeyCode.Space) {
				key.preventDefault();
				this.setCollapsed(!this._collapsed, true);
			}
		}));

		const stored = options.storageKey
			? this.storageService.getBoolean(options.storageKey, StorageScope.PROFILE, !!options.startCollapsed)
			: !!options.startCollapsed;
		this.setCollapsed(stored, false);
	}

	get collapsed(): boolean {
		return this._collapsed;
	}

	setCollapsed(collapsed: boolean, persist: boolean): void {
		this._collapsed = collapsed;
		this.card.classList.toggle('collapsed', collapsed);
		this.head.setAttribute('aria-expanded', String(!collapsed));
		this.toggle.title = collapsed
			? this.options.expandTitle ?? t('projectMap.card.expand')
			: this.options.collapseTitle ?? t('projectMap.card.collapse');
		clearNode(this.toggle);
		append(this.toggle, projectMapIcon(collapsed ? Codicon.chevronDown : Codicon.chevronUp));
		if (persist && this.options.storageKey) {
			this.storageService.store(this.options.storageKey, collapsed, StorageScope.PROFILE, StorageTarget.USER);
		}
		this._onDidToggle.fire(collapsed);
	}

	/** Adds a control to the head, to the LEFT of the collapse chevron. */
	addHeadAction<T extends HTMLElement>(element: T): T {
		this.headActions.insertBefore(element, this.toggle);
		return element;
	}
}
