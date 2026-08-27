/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — pure ordering/filtering for the provider detail's model list.
 *
 *  The Settings page shows the models.dev catalog the way opencode does: the registry's own
 *  order, with the provider's default pinned first so "what happens if I pick nothing" is always
 *  the first row. Kept out of the DOM section so the contract is testable.
 *--------------------------------------------------------------------------------------------*/

/**
 * Default model first, the rest in the order the catalog/discovery produced them, no duplicates.
 * The registry's order is deliberate upstream (models.dev curates it); re-sorting alphabetically
 * would bury the models the provider itself leads with.
 */
export function orderProviderModels(ids: readonly string[], defaultModel: string): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	const push = (id: string): void => {
		const trimmed = id.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			ordered.push(trimmed);
		}
	};
	if (defaultModel) { push(defaultModel); }
	for (const id of ids) { push(id); }
	return ordered;
}

export interface IFilterableModel {
	readonly id: string;
	readonly name: string;
}

/**
 * Case-insensitive substring match over the human name AND the raw id: users search "sonnet" as
 * often as "claude-sonnet-4". An empty query keeps everything.
 */
export function filterProviderModels<T extends IFilterableModel>(models: readonly T[], query: string): T[] {
	const needle = query.trim().toLowerCase();
	if (!needle) { return [...models]; }
	return models.filter(model => model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle));
}

/** The search box only earns its place when the list is long enough to need it. */
export const PROVIDER_MODEL_SEARCH_THRESHOLD = 8;
