/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IOpenideChatPlanTask {
	readonly text: string;
	readonly done: boolean;
}

export interface IOpenideChatParsedPlan {
	readonly title: string;
	readonly desc: string;
	readonly tasks: readonly IOpenideChatPlanTask[];
}

const TASKS_HEADING = /^##\s+(Tareas|Tasks|To-?dos?)\b/i;
const TITLE_HEADING = /^#\s+/;
const ANY_HEADING = /^#{1,6}\s/;
const BLANK = /^\s*$/;
const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

/**
 * Reduces a plan's markdown to the three things the card shows.
 *
 * Straight port of the webview's `parsePlan`, regex for regex. It is
 * deliberately NOT a markdown renderer: the card is a summary whose job is to get the user to open
 * the real plan editor, and rendering the whole document inline would put an unbounded, scrolling
 * block inside a row of a `supportDynamicHeights` list.
 *
 * The input is the bare markdown, with no frontmatter — that is what `plan_save` carries in its
 * arguments and what the transcript restores into `IOpenideChatPlanContent.body`.
 */
export function parseOpenideChatPlan(markdown: string): IOpenideChatParsedPlan {
	const lines = String(markdown ?? '').split('\n');

	// Located first and by a full scan: the tasks heading may sit above the title in a plan the
	// model wrote out of order, and the description scan below must not swallow it.
	let tasksIndex = -1;
	for (let k = 0; k < lines.length; k++) {
		if (TASKS_HEADING.test(lines[k])) {
			tasksIndex = k;
		}
	}

	let i = 0;
	let title = '';
	while (i < lines.length && !TITLE_HEADING.test(lines[i])) { i++; }
	if (i < lines.length) {
		title = lines[i].replace(TITLE_HEADING, '').trim();
		i++;
	}

	// Description: the first non-empty paragraph after the title, joined into one line. Joining is
	// what lets the card cap it visually without leaving a half-rendered markdown block behind.
	while (i < lines.length && BLANK.test(lines[i])) { i++; }
	const descLines: string[] = [];
	while (i < lines.length && !BLANK.test(lines[i]) && !ANY_HEADING.test(lines[i])) {
		descLines.push(lines[i].trim());
		i++;
	}

	const tasks: IOpenideChatPlanTask[] = [];
	if (tasksIndex >= 0) {
		for (let j = tasksIndex + 1; j < lines.length; j++) {
			const match = CHECKBOX.exec(lines[j]);
			if (match) {
				tasks.push({ text: match[2].trim(), done: match[1].toLowerCase() === 'x' });
				continue;
			}
			// Any other heading ends the task list: what follows belongs to another section.
			if (ANY_HEADING.test(lines[j])) {
				break;
			}
		}
	}

	return { title, desc: descLines.join(' '), tasks };
}

/** Head line of the task box (the removed chat webview). */
export function pendingTasksLabel(tasks: readonly IOpenideChatPlanTask[]): string {
	const remaining = tasks.filter(task => !task.done).length;
	return remaining === 1 ? '1 tarea pendiente' : `${remaining} tareas pendientes`;
}
