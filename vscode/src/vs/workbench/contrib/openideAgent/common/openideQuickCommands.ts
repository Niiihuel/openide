/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — terminal quick commands (saved snippets; not to be confused with the chat
 *  "Commands", which are `/name` prompts for the agent). Persisted as one JSON array per scope:
 *
 *    proyecto  <workspace>/.openide/quick-commands.json
 *    global    <userData>/openideAgent/quick-commands.json
 *--------------------------------------------------------------------------------------------*/

export type QuickCommandScope = 'project' | 'global';

export interface IQuickCommand {
	readonly id: string;
	readonly label: string;
	readonly command: string;
	readonly scope: QuickCommandScope;
}

const MAX_LABEL_LENGTH = 80;
const MAX_COMMAND_LENGTH = 4000;

/** Validates and normalizes a raw entry (parsed JSON, or a webview message payload).
 *  Never throws — invalid entries are dropped silently when reading a noisy file. */
export function parseQuickCommandEntry(raw: unknown, scope: QuickCommandScope): IQuickCommand | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const entry = raw as Record<string, unknown>;
	const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : undefined;
	const label = typeof entry.label === 'string' ? entry.label.trim().slice(0, MAX_LABEL_LENGTH) : '';
	const command = typeof entry.command === 'string' ? entry.command.trim().slice(0, MAX_COMMAND_LENGTH) : '';
	if (!id || !label || !command) {
		return undefined;
	}
	return { id, label, command, scope };
}

export function parseQuickCommandsFile(content: string, scope: QuickCommandScope): IQuickCommand[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) {
		return [];
	}
	const out: IQuickCommand[] = [];
	for (const raw of parsed) {
		const entry = parseQuickCommandEntry(raw, scope);
		if (entry) {
			out.push(entry);
		}
	}
	return out;
}

export function serializeQuickCommands(commands: readonly IQuickCommand[]): string {
	return JSON.stringify(commands.map(({ id, label, command }) => ({ id, label, command })), null, '\t') + '\n';
}
