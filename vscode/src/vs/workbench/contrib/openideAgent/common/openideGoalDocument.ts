/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideGoal, IOpenideGoalCreate } from '../../../../platform/openideAgentHost/common/openideGoal.js';

/** The host owns identity; Markdown edits only propose a new objective and acceptance contract. */
export function parseOpenideGoalDocument(markdown: string, goal: IOpenideGoal): { objective: string; criteria: IOpenideGoalCreate['criteria'] } {
	if (markdown.length > 256000) { throw new Error('Goal document exceeds the size limit'); }
	const header = /^---\r?\n(?<metadata>[\s\S]*?)\r?\n---\r?\n/.exec(markdown)?.groups?.metadata;
	if (!header || !header.split(/\r?\n/).includes(`id: ${goal.id}`) || !header.split(/\r?\n/).includes(`revision: ${goal.revision}`)) { throw new Error('Keep the goal identity and revision unchanged; OpenIDE assigns the next revision.'); }
	const content = /(?:^|\n)# Goal\s*\n(?<objective>[\s\S]*?)\n## Acceptance criteria\s*\n(?<criteria>[\s\S]*)$/.exec(markdown)?.groups;
	if (!content?.objective.trim()) { throw new Error('Goal document requires an objective and acceptance criteria.'); }
	const criteria: { text: string; command?: string }[] = [];
	for (const line of content.criteria.split(/\r?\n/)) {
		if (!line.trim()) { continue; }
		const criterion = /^- C\d+: (?<text>.+)$/.exec(line)?.groups?.text;
		if (criterion) { criteria.push({ text: criterion }); continue; }
		const command = /^  Command: (?<command>.+)$/.exec(line)?.groups?.command;
		if (command && criteria.length && !criteria.at(-1)!.command) { criteria.at(-1)!.command = command; continue; }
		throw new Error('Use one “- C1: criterion” line and an optional indented “Command:” line per criterion.');
	}
	if (!criteria.length || criteria.length > 50) { throw new Error('A goal requires 1 to 50 criteria.'); }
	return { objective: content.objective.trim(), criteria };
}
