/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Appends review comments or editor context without replacing the user's existing draft. */
export function appendOpenideCliDraft(current: string, addition: string): string {
	if (!addition.trim()) { return current; }
	return current ? `${current}\n\n${addition}` : addition;
}

/** Drafts go through bracketed paste only; never add a carriage return to submit a CLI prompt. */
export function buildOpenideCliPaste(draft: string): string {
	// Strip terminal controls, including bracketed-paste terminators. Keep tabs/newlines as text.
	return draft.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

/** Without terminal bracketed-paste mode, sendText converts newlines into submitting Enter keys. */
export function canPasteOpenideCliDraft(draft: string, bracketedPaste: boolean): boolean {
	return bracketedPaste || !buildOpenideCliPaste(draft).includes('\n');
}

export const OPENIDE_CLI_TEXT_ATTACHMENT_LIMIT = 128 * 1024;
