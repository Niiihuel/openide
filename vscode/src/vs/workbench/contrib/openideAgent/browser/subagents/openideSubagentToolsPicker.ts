/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — tools picker for a subagent definition, modelled on upstream's `showToolsPicker`
 *  (chat/browser/actions/chatToolPicker.ts): a multi-select quick pick bucketed by origin
 *  (built-in tools, MCP servers, skills), every entry with its description, the current
 *  selection pre-checked. Ours is fed by the composer capability catalog instead of
 *  `ILanguageModelToolsService`, so it lists exactly what `/` can invoke.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../../platform/quickinput/common/quickInput.js';
import { t } from '../../common/openideStrings.js';
import { ComposerCapabilityKind, IComposerCapability, IOpenideAgentService } from '../openideAgentService.js';

type ToolPick = IQuickPickItem & { readonly name: string };

const BUCKET_ORDER: readonly ComposerCapabilityKind[] = ['tool', 'mcp', 'skill'];

function bucketLabel(kind: ComposerCapabilityKind): string {
	switch (kind) {
		case 'tool': return t('subagent.tools.bucket.builtin');
		case 'mcp': return t('subagent.tools.bucket.mcp');
		case 'skill': return t('subagent.tools.bucket.skills');
	}
}

function riskIcon(capability: IComposerCapability): ThemeIcon {
	switch (capability.risk) {
		case 'exec': return Codicon.terminal;
		case 'write': return Codicon.edit;
		default: return capability.kind === 'mcp' ? Codicon.plug : capability.kind === 'skill' ? Codicon.sparkle : Codicon.tools;
	}
}

/**
 * Opens the picker with `selected` checked. Resolves to the new list, or `undefined` when the
 * user dismissed it (Escape) — a dismissal must never be read as "no tools".
 */
export async function showOpenideSubagentToolsPicker(quickInputService: IQuickInputService, agentService: IOpenideAgentService, selected: readonly string[]): Promise<string[] | undefined> {
	const capabilities = await agentService.listComposerCapabilities();
	const known = new Set(capabilities.map(c => c.name));
	const items: (ToolPick | IQuickPickSeparator)[] = [];
	for (const kind of BUCKET_ORDER) {
		const bucket = capabilities.filter(c => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
		if (!bucket.length) { continue; }
		items.push({ type: 'separator', label: bucketLabel(kind) });
		for (const capability of bucket) {
			items.push({ name: capability.name, label: capability.name, description: capability.description, iconClass: ThemeIcon.asClassName(riskIcon(capability)), picked: selected.includes(capability.name) });
		}
	}
	// Names the definition carries that the catalog does not know (renamed tool, disconnected
	// MCP): kept visible and checked, as upstream does with unavailable tools, so a save never
	// silently drops them.
	const unknown = selected.filter(name => !known.has(name));
	if (unknown.length) {
		items.push({ type: 'separator', label: t('subagent.tools.bucket.unavailable') });
		for (const name of unknown) {
			items.push({ name, label: name, description: t('subagent.tools.unavailable'), iconClass: ThemeIcon.asClassName(Codicon.warning), picked: true });
		}
	}

	const picks = await quickInputService.pick(items, {
		canPickMany: true,
		title: t('subagent.tools.picker.title'),
		placeHolder: t('subagent.tools.picker.placeholder'),
		matchOnDescription: true,
		sortByLabel: false,
	});
	return picks ? picks.map(pick => (pick as ToolPick).name) : undefined;
}
