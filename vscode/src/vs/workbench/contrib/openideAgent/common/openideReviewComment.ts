/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import { buildSnippetContext, IComposerSnippet } from './chat/openideChatSnippet.js';
import { OpenideDiffLine } from './openideDiffPreview.js';
import { t } from './openideStrings.js';

export interface IOpenideReviewComment {
	readonly path: string;
	readonly text: string;
	readonly selection?: IComposerSnippet;
	/** Bounded immutable diff captured from the currently reviewed file. */
	readonly diffContext?: string;
}

/** Review feedback carries the selected snapshot, not whatever the file contains later. */
export function reviewCommentPrompt(comment: IOpenideReviewComment): string {
	return [t('conversationWorkspace.commentPrompt', comment.path, comment.text.trim()), reviewCommentContext(comment)].filter(Boolean).join('\n\n');
}

const REVIEW_CONTEXT_LIMIT = 8000;

/** Compact worker-computed changes; surrounding source is never copied wholesale. */
export function reviewDiffContext(path: string, lines: readonly OpenideDiffLine[], added: number, removed: number): string {
	const header = `[Review snapshot: ${path} (+${added} / -${removed}). Diff excerpt; omitted lines are unchanged or truncated.]`;
	const diff = lines.slice(0, 120).map(line => `${line.t === 'add' ? '+' : line.t === 'del' ? '-' : line.t === 'gap' ? '…' : ' '}${line.x}`).join('\n');
	return `${header}\n${diff}`.slice(0, REVIEW_CONTEXT_LIMIT);
}

/** Selection is relevant to the comment and takes precedence over extra diff context. */
export function reviewCommentContext(comment: IOpenideReviewComment): string {
	return [comment.selection ? buildSnippetContext([{ ...comment.selection, text: comment.selection.text.slice(0, 4000) }]) : undefined,
		comment.diffContext ?? `[Review file: ${comment.path}. Diff unavailable; read the relevant lines if needed.]`].filter(Boolean).join('\n\n').slice(0, REVIEW_CONTEXT_LIMIT);
}
