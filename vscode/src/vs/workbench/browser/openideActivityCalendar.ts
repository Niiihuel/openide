/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../base/browser/dom.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { IHoverService } from '../../platform/hover/browser/hover.js';
import './media/openideActivityCalendar.css';

export interface IOpenideActivityDay { readonly date: string; readonly count: number; readonly level: number; }
export interface IOpenideActivityCalendarOptions {
	readonly label: string;
	readonly locale: string;
	readonly less: string;
	readonly more: string;
	readonly describe: (day: IOpenideActivityDay, formattedDate: string) => string;
}

/** A bounded, static year of activity; no chart runtime, resize observer or per-frame rendering. */
export class OpenideActivityCalendar extends Disposable {
	readonly domNode: HTMLElement;
	constructor(parent: HTMLElement, days: readonly IOpenideActivityDay[], options: IOpenideActivityCalendarOptions,
		@IHoverService hover: IHoverService,
	) {
		super();
		this.domNode = append(parent, $('.openide-activity-calendar'));
		const scroll = append(this.domNode, $('.openide-activity-calendar-scroll'));
		const chart = append(scroll, $('.openide-activity-calendar-chart', { role: 'group', 'aria-label': options.label }));
		const months = append(chart, $('.openide-activity-calendar-months', { 'aria-hidden': 'true' }));
		const grid = append(chart, $('.openide-activity-calendar-days'));
		const dateFormat = new Intl.DateTimeFormat(options.locale, { dateStyle: 'full', timeZone: 'UTC' });
		const monthFormat = new Intl.DateTimeFormat(options.locale, { month: 'short', timeZone: 'UTC' });
		const firstWeekday = days.length ? new Date(`${days[0].date}T00:00:00Z`).getUTCDay() : 0;
		const columns = Math.ceil((days.length + firstWeekday) / 7);
		months.style.gridTemplateColumns = grid.style.gridTemplateColumns = `repeat(${Math.max(1, columns)}, minmax(9px, 1fr))`;
		let previousMonth = '';
		let previousColumn = -4;
		const cells: HTMLElement[] = [];
		for (let index = 0; index < days.length; index++) {
			const day = days[index];
			const date = new Date(`${day.date}T00:00:00Z`);
			const column = Math.floor((index + firstWeekday) / 7) + 1;
			const month = day.date.slice(0, 7);
			if (month !== previousMonth) {
				if (column - previousColumn >= 3 && column <= columns - 1) {
					const label = append(months, $('span', undefined, monthFormat.format(date)));
					label.style.gridColumn = `${column} / span ${Math.min(3, columns - column + 1)}`;
					previousColumn = column;
				}
				previousMonth = month;
			}
			const description = options.describe(day, dateFormat.format(date));
			const cell = append(grid, $('span.openide-activity-calendar-day', { tabindex: index === days.length - 1 ? '0' : '-1', role: 'img', 'aria-label': description }));
			cell.dataset.level = String(Math.max(0, Math.min(4, day.level)));
			cell.style.gridColumn = String(column);
			cell.style.gridRow = String((index + firstWeekday) % 7 + 1);
			cells.push(cell);
			this._register(hover.setupDelayedHover(cell, () => ({ content: description }), { groupId: 'openide.activity.calendar' }));
		}
		// One tab stop for the calendar, arrow keys move by day/week; Home/End jump to the bounds.
		let activeIndex = cells.length - 1;
		this._register(addDisposableListener(grid, 'focusin', event => {
			const index = cells.indexOf(event.target as HTMLElement);
			if (index < 0) { return; }
			cells[activeIndex].tabIndex = -1;
			cells[index].tabIndex = 0;
			activeIndex = index;
		}));
		this._register(addDisposableListener(grid, 'keydown', event => {
			const index = cells.indexOf(event.target as HTMLElement);
			const offset = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
			if (index < 0 || (offset === undefined && event.key !== 'Home' && event.key !== 'End')) { return; }
			event.preventDefault(); event.stopPropagation();
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? cells.length - 1 : Math.max(0, Math.min(cells.length - 1, index + offset!));
			cells[next].focus();
		}));
		const legend = append(this.domNode, $('.openide-activity-calendar-legend', { 'aria-hidden': 'true' }));
		append(legend, $('span', undefined, options.less));
		for (let level = 0; level < 5; level++) { append(legend, $('span.openide-activity-calendar-day', { 'data-level': String(level) })); }
		append(legend, $('span', undefined, options.more));
	}
}
