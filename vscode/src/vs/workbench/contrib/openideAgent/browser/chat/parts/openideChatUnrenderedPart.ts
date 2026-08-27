/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { IEnvironmentService } from '../../../../../../platform/environment/common/environment.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IOpenideChatContent } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatUnrendered.css';

/**
 * Kinds already reported, so the log stays readable.
 *
 * Module scope and not per-part on purpose: the renderer builds a fresh fallback for every row
 * that carries the unmapped kind, and a streamed turn re-renders on every delta. A per-instance
 * guard would still print one line per row per reload, which is the same flood it is meant to
 * avoid — the fact worth knowing ("kind X has no part") is global and only interesting once.
 */
const reported = new Set<string>();

/**
 * What a content kind with no part renders.
 *
 * This class exists because its predecessor did the opposite: it returned `domNode: undefined`,
 * which the renderer faithfully honours by appending nothing at all. A kind the reducer emits and
 * the renderer cannot draw therefore produced a row of height zero — no card, no error, no log —
 * and the whole failure surfaced to the user as an unexplained blank gap in the transcript. It
 * took a code read to find out that anything was wrong. Silence is the worst possible report for
 * a missing branch, so the fallback is now loud.
 *
 * Loud has two levels, because the two audiences want different things:
 *  - always, in every build: one `error` line per kind through `ILogService`. Costs nothing, never
 *    reaches the user, and turns "the chat has a hole in it" into a greppable fact.
 *  - only when `!isBuilt` (running from source): a visible placeholder row naming the kind, so the
 *    hole is impossible to scroll past while developing.
 *
 * In a packaged build the placeholder is deliberately NOT drawn. A user mid-conversation is not
 * served by a diagnostic box they cannot act on, and the transcript degrading quietly still beats
 * it throwing — the row simply collapses as before, but now with the log line that was missing.
 */
export class OpenideChatUnrenderedContentPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement | undefined;

	private readonly _kind: IOpenideChatContent['kind'];

	constructor(
		content: IOpenideChatContent,
		_context: IOpenideChatContentPartContext,
		@ILogService logService: ILogService,
		@IEnvironmentService environmentService: IEnvironmentService,
	) {
		super();
		this._kind = content.kind;

		if (!reported.has(this._kind)) {
			reported.add(this._kind);
			logService.error(`[openide-chat] no content part registered for kind '${this._kind}'; the row renders empty. Register it in OpenideChatResponseRenderer#_createPart.`);
		}

		if (environmentService.isBuilt) {
			return;
		}

		this.domNode = $('.openide-chat-unrendered');
		append(this.domNode, $('span.codicon.codicon-warning'));
		// The kind is the one actionable token here, so it is the one thing shown verbatim.
		append(this.domNode, $('span.openide-chat-unrendered-text', undefined, `Sin parte para el contenido '${this._kind}'`));
	}

	/**
	 * The kind is the whole identity of this part: it has no content of its own to compare, and a
	 * placeholder that rebuilt itself on every streaming delta would flicker for no benefit.
	 */
	hasSameContent(other: IOpenideChatContent): boolean {
		return other.kind === this._kind;
	}
}
