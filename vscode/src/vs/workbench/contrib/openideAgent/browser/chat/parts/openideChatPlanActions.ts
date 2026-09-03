/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { joinPath } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { setPlanFrontmatterValue } from '../../openideAgentService.js';

/**
 * The three things a plan card can do, kept out of the parts so the card and the "updating the
 * plan" line answer a click the same way.
 *
 * The webview cannot do any of this itself: every one of these is a `postMessage` the host answers
 * in openideChatView.ts (`planOpen` :1090-1097, `planReject` :1085-1089 → `rejectPlan` :1746-1755,
 * `planBuild` :1077-1084). The native card runs inside the workbench, so it calls the same services
 * the host called — the behaviour is transcribed from those handlers, not reinvented.
 */

/**
 * A plan path is stored RELATIVE to the workspace (`.openide/plans/x.md`), because that is what the
 * `plan_save` result carries back. Same resolution as `resolvePlanUri` (openideChatView.ts:1740).
 */
export function resolveOpenideChatPlanUri(contextService: IWorkspaceContextService, path: string): URI | undefined {
	if (!path) {
		return undefined;
	}
	const folder = contextService.getWorkspace().folders[0];
	return folder ? joinPath(folder.uri, path) : undefined;
}

/**
 * Opens the plan in OUR OWN plan editor, never in the text editor: `openide.plan.open` is what
 * renders the checkboxes, the live draft and the Build button the card is a shortcut to.
 */
export function openOpenideChatPlan(commandService: ICommandService, uri: URI): void {
	commandService.executeCommand('openide.plan.open', uri).then(undefined, () => {
		// The plan editor failed to load. The card already said everything it knows, and an error
		// toast for "we could not open a file you can open from the explorer" is pure noise.
	});
}

/**
 * Marks a plan as rejected by rewriting its frontmatter, exactly like `rejectPlan`.
 *
 * A deleted plan still resolves the card: the user's decision is about the proposal, and refusing
 * to record it because the file is gone would leave the card pending forever.
 */
export async function rejectOpenideChatPlan(fileService: IFileService, uri: URI): Promise<void> {
	try {
		const content = (await fileService.readFile(uri)).value.toString();
		await fileService.writeFile(uri, VSBuffer.fromString(setPlanFrontmatterValue(content, 'status', 'rechazado')));
	} catch {
		// Plan deleted by hand: the card resolves anyway.
	}
}
