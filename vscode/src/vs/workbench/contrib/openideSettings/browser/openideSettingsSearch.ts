/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — query helpers shared by the Settings pane and tests.
 *--------------------------------------------------------------------------------------------*/

export const OPENIDE_SETTINGS_FILTERS = [
	'@modified', '@hasPolicy', '@id:', '@ext:', '@feature:', '@lang:', '@tag:'
] as const;

export function normalizeSettingsQuery(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** Strips `@…` filters so the plain text reaches the word-based search clean. */
export function plainSettingsQuery(query: string): string {
	return query.replace(/@(modified|hasPolicy)\b|@(id|ext|feature|lang|tag):[^\s]+/gi, '').trim().toLowerCase();
}

/**
 * What a DOM section renders is not a config key, so search — which only looks at the schema —
 * does not find it: installing a skill or adding a hook were invisible. Each surface therefore
 * declares what it offers, as data, and search scores that just like a native setting.
 */
export interface IOpenideSettingsSearchEntry {
	readonly title: string;
	readonly description?: string;
	/** How a user who does not know our name would type it ("mcp", "server", "tool"). */
	readonly keywords?: readonly string[];
}

const NO_MATCH = 0;
const EMPTY_QUERY = 1;

/** A title hit outranks a description hit, and exact outranks "contains": without tiers,
 *  typing "hook" ranked the Hooks page level with any description that merely mentioned it.
 *  mencionara la palabra al pasar. */
interface IScoreTier { readonly exact: number; readonly prefix: number; readonly substring: number }
const TITLE_SCORE: IScoreTier = { exact: 700, prefix: 650, substring: 600 };
const DESCRIPTION_SCORE: IScoreTier = { exact: 500, prefix: 450, substring: 400 };
const KEYWORD_SCORE: IScoreTier = { exact: 300, prefix: 250, substring: 200 };

function scoreText(query: string, value: string | undefined, tier: IScoreTier): number {
	if (!value) { return NO_MATCH; }
	const text = value.toLowerCase();
	if (text === query) { return tier.exact; }
	if (text.startsWith(query)) { return tier.prefix; }
	return text.includes(query) ? tier.substring : NO_MATCH;
}

/** 0 = no match. An empty query scores 1: everything passes, nothing gains ranking. */
export function scoreSettingsSearchEntries(query: string, entries: readonly IOpenideSettingsSearchEntry[]): number {
	const plain = plainSettingsQuery(query);
	if (!plain) { return EMPTY_QUERY; }
	return entries.reduce((best, entry) => Math.max(
		best,
		scoreText(plain, entry.title, TITLE_SCORE),
		scoreText(plain, entry.description, DESCRIPTION_SCORE),
		(entry.keywords ?? []).reduce((keyBest, keyword) => Math.max(keyBest, scoreText(plain, keyword, KEYWORD_SCORE)), NO_MATCH),
	), NO_MATCH);
}

export function matchesSettingsSearchEntries(query: string, entries: readonly IOpenideSettingsSearchEntry[]): boolean {
	return scoreSettingsSearchEntries(query, entries) > NO_MATCH;
}
