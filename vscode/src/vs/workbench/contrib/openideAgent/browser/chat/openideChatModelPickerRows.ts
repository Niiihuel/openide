/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { IListRenderer, IListVirtualDelegate } from '../../../../../base/browser/ui/list/list.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IOpenidePickerGroup, IOpenidePickerModel } from '../openideAgentService.js';
import { createProviderIcon } from '../openideProviderIcons.js';
import { createCodicon } from './openideComposerMenu.js';

/** Collapsible header: favourites, recents or one provider. */
export interface IModelSectionRow {
	readonly kind: 'section';
	/** Storage key of the collapsed state (`favorites`, `recent`, `provider:<id>`). */
	readonly key: string;
	readonly label: string;
	/** Provider whose logo heads the section; absent on favourites/recents, which use a codicon. */
	readonly providerId?: string;
	readonly codicon?: string;
	readonly collapsed: boolean;
}

export interface IModelEntryRow {
	readonly kind: 'model';
	readonly key: string;
	readonly group: IOpenidePickerGroup;
	readonly model: IOpenidePickerModel;
	readonly active: boolean;
	readonly favorite: boolean;
}

export type ModelPickerRow = IModelSectionRow | IModelEntryRow;

export const MODEL_SECTION_TEMPLATE = 'openide.model.section';
export const MODEL_ROW_TEMPLATE = 'openide.model.row';

/**
 * Row heights the virtual list needs up front.
 *
 * The webview lets both rows size themselves (`min-height: 24px` on `.menu-row`, padding on
 * `.mp-head`), which a virtualized list cannot do without measuring every row. These are the
 * resulting box heights at 13px/11px text, pinned in CSS so the two agree.
 */
export const MODEL_ROW_HEIGHT = 24;
export const MODEL_SECTION_HEIGHT = 25;

export class ModelPickerDelegate implements IListVirtualDelegate<ModelPickerRow> {
	getHeight(element: ModelPickerRow): number {
		return element.kind === 'section' ? MODEL_SECTION_HEIGHT : MODEL_ROW_HEIGHT;
	}
	getTemplateId(element: ModelPickerRow): string {
		return element.kind === 'section' ? MODEL_SECTION_TEMPLATE : MODEL_ROW_TEMPLATE;
	}
}

interface ISectionTemplate {
	readonly container: HTMLElement;
	readonly icon: HTMLElement;
	readonly label: HTMLElement;
	readonly store: DisposableStore;
	current?: IModelSectionRow;
}

export class ModelSectionRenderer implements IListRenderer<IModelSectionRow, ISectionTemplate> {

	readonly templateId = MODEL_SECTION_TEMPLATE;

	constructor(private readonly onToggle: (row: IModelSectionRow) => void) { }

	renderTemplate(container: HTMLElement): ISectionTemplate {
		const store = new DisposableStore();
		const document = container.ownerDocument;
		const head = document.createElement('div');
		head.className = 'openide-mp-head';
		const icon = append(head, document.createElement('span'));
		icon.className = 'openide-mp-head-icon';
		const label = append(head, document.createElement('span'));
		label.className = 'openide-mp-head-label';
		head.appendChild(createCodicon(document, 'chevron-down', 'openide-mp-chevron'));
		container.appendChild(head);
		const template: ISectionTemplate = { container: head, icon, label, store };
		// Bound once on the recycled template: the row under it changes on every render, so the
		// handler reads `current` instead of closing over an element that has since moved.
		store.add(addDisposableListener(head, 'click', event => {
			event.stopPropagation();
			if (template.current) { this.onToggle(template.current); }
		}));
		return template;
	}

	renderElement(element: IModelSectionRow, _index: number, templateData: ISectionTemplate): void {
		templateData.current = element;
		templateData.label.textContent = element.label;
		templateData.container.classList.toggle('collapsed', element.collapsed);
		const document = templateData.container.ownerDocument;
		clearNode(templateData.icon);
		templateData.icon.appendChild(element.providerId
			? createProviderIcon(document, element.providerId, element.label)
			: createCodicon(document, element.codicon ?? 'circle-filled'));
	}

	disposeTemplate(templateData: ISectionTemplate): void {
		templateData.store.dispose();
	}
}

interface IModelRowTemplate {
	readonly container: HTMLElement;
	readonly iconSlot: HTMLElement;
	readonly name: HTMLElement;
	readonly size: HTMLElement;
	readonly check: HTMLElement;
	readonly star: HTMLElement;
	readonly store: DisposableStore;
	current?: IModelEntryRow;
}

/**
 * The rich row of the picker: provider mark, friendly name, context window and a favourite star.
 *
 * A raw id is not enough to choose between two models of the same family — they differ by context
 * window and price, not by name. Everything past the context window lives in the detail panel so a
 * row never becomes a paragraph.
 */
export class ModelRowRenderer implements IListRenderer<IModelEntryRow, IModelRowTemplate> {

	readonly templateId = MODEL_ROW_TEMPLATE;

	constructor(private readonly onToggleFavorite: (row: IModelEntryRow) => void) { }

	renderTemplate(container: HTMLElement): IModelRowTemplate {
		const store = new DisposableStore();
		const document = container.ownerDocument;
		const row = document.createElement('div');
		row.className = 'openide-menu-row openide-mp-row';
		const iconSlot = append(row, document.createElement('span'));
		iconSlot.className = 'openide-menu-row-icon';
		const name = append(row, document.createElement('span'));
		name.className = 'openide-mp-name';
		const size = append(row, document.createElement('span'));
		size.className = 'openide-mp-size';
		const check = append(row, document.createElement('span'));
		check.className = 'openide-mp-check';
		const star = append(row, document.createElement('span'));
		star.className = 'openide-mp-star';
		star.setAttribute('role', 'button');
		container.appendChild(row);
		const template: IModelRowTemplate = { container: row, iconSlot, name, size, check, star, store };
		// Stopped here and not on the list: the star is an action ON the row, and letting the click
		// through would also select the model the user was only bookmarking.
		store.add(addDisposableListener(star, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			if (template.current) { this.onToggleFavorite(template.current); }
		}));
		store.add(addDisposableListener(star, 'mousedown', event => event.stopPropagation()));
		return template;
	}

	renderElement(element: IModelEntryRow, _index: number, templateData: IModelRowTemplate): void {
		templateData.current = element;
		const document = templateData.container.ownerDocument;
		clearNode(templateData.iconSlot);
		templateData.iconSlot.appendChild(createProviderIcon(document, element.group.id, element.group.label));
		templateData.name.textContent = element.model.name;
		templateData.size.textContent = element.model.context;
		clearNode(templateData.check);
		if (element.active) {
			templateData.check.appendChild(createCodicon(document, 'check'));
		}
		clearNode(templateData.star);
		templateData.star.classList.toggle('on', element.favorite);
		templateData.star.appendChild(createCodicon(document, element.favorite ? 'star-full' : 'star-empty'));
		templateData.star.title = element.favorite
			? localize('openide.chat.model.unstar', "Quitar de favoritos")
			: localize('openide.chat.model.star', "Marcar como favorito");
	}

	disposeTemplate(templateData: IModelRowTemplate): void {
		templateData.store.dispose();
	}
}
