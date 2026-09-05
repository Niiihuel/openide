/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which display languages the Language section offers, and in what order.
 *
 * The two OpenIDE ships (`openideStrings.ts` carries every string in `es` and `en`) are ALWAYS
 * offered, installed or not. That is the whole point: upstream's picker only lists what the
 * gallery's `category:"language packs"` query happens to return, and against Open VSX that query
 * is a text search — it answered with Uzbek, Punjabi and two copies of Chinese, and no Spanish,
 * even though `MS-CEINTL.vscode-language-pack-es` is right there under its id. A language the
 * product is fully translated into cannot depend on a search result to be reachable, so it is
 * listed from a constant here and the pack is fetched BY ID when the user picks it.
 *
 * Anything else already installed still shows up after those two, because it is what the user
 * would see if they picked it — but it only moves the native workbench. OpenIDE's own screens
 * fall back to English for every locale that is not Spanish (`resolveOpenideLanguage`).
 */

/** A language OpenIDE itself is translated into. */
export interface IOpenideShippedLanguage {
	/** What goes in `argv.json`'s `locale`, lowercase. */
	readonly locale: string;
	/** The endonym. Never translated: a language names itself in itself, in every interface. */
	readonly label: string;
	/**
	 * The language pack that translates the NATIVE workbench, or `undefined` for English, which
	 * needs none. Microsoft's CEINTL packs are the only ones `ILocaleService.setLocale` installs
	 * without bouncing the user to the extensions view, so this must stay an `ms-ceintl` id.
	 */
	readonly extensionId?: string;
}

export const OPENIDE_SHIPPED_LANGUAGES: readonly IOpenideShippedLanguage[] = [
	{ locale: 'en', label: 'English' },
	{ locale: 'es', label: 'Español', extensionId: 'MS-CEINTL.vscode-language-pack-es' },
];

/** The locale the selector means by "no language pack, the built-in strings". */
export const OPENIDE_DEFAULT_LOCALE = 'en';

export interface IDisplayLanguageOption {
	/** The locale, lowercase. It is the select's value. */
	readonly value: string;
	readonly label: string;
	/** True when OpenIDE has no strings of its own for it: the fork's screens stay in English. */
	readonly partial: boolean;
	/** True when it needs a language pack that is not installed yet. */
	readonly needsInstall: boolean;
}

/** The shape `getInstalledLanguages()` hands back, narrowed to what the list needs. */
export interface IInstalledLanguage {
	readonly id?: string;
	readonly label: string;
}

function normalize(locale: string): string {
	return locale.trim().toLowerCase();
}

export function isShippedLanguage(locale: string): boolean {
	const value = normalize(locale);
	return OPENIDE_SHIPPED_LANGUAGES.some(language => language.locale === value);
}

/**
 * The selector's options: the two shipped languages first, then every other installed pack, then
 * the active locale if it is neither. `installed` being `undefined` means the read has not come
 * back yet — the shipped two are still listed, because they do not depend on it.
 */
export function buildDisplayLanguageOptions(currentLocale: string, installed: readonly IInstalledLanguage[] | undefined): IDisplayLanguageOption[] {
	const installedLocales = new Set((installed ?? []).map(pack => normalize(pack.id ?? '')).filter(Boolean));
	const options: IDisplayLanguageOption[] = OPENIDE_SHIPPED_LANGUAGES.map(language => ({
		value: language.locale,
		label: language.label,
		partial: false,
		// English needs no pack; a shipped language whose pack is missing is installed on pick.
		// While `installed` is still loading, assume nothing is missing rather than flash a hint.
		needsInstall: !!language.extensionId && !!installed && !installedLocales.has(language.locale),
	}));

	const seen = new Set(options.map(option => option.value));
	const extra = (installed ?? [])
		.map(pack => ({ value: normalize(pack.id ?? ''), label: pack.label }))
		.filter(pack => pack.value && !seen.has(pack.value))
		.sort((a, b) => a.label.localeCompare(b.label));
	for (const pack of extra) {
		if (seen.has(pack.value)) {
			// Two publishers can ship the same locale — upstream's picker listed zh-cn twice for
			// exactly this reason. One locale is one choice.
			continue;
		}
		seen.add(pack.value);
		options.push({ value: pack.value, label: pack.label, partial: true, needsInstall: false });
	}

	// A locale set by hand in argv.json, or one whose pack was uninstalled: it is what the user is
	// looking at right now, so it has to be selectable even though nothing else knows about it.
	// A regional variant of a language already listed is NOT one of those — `es-AR` is Spanish,
	// and listing it separately would split one language into two rows that do the same thing.
	const current = normalize(currentLocale);
	if (current && !seen.has(current) && !seen.has(current.split('-')[0])) {
		options.push({ value: current, label: current, partial: true, needsInstall: false });
	}

	return options;
}

/**
 * Which option is selected for an active locale. Regional variants pick their base language —
 * `es-AR` selects Spanish, the same way `resolveOpenideLanguage` reads it as Spanish — so the
 * selector never shows English to someone whose IDE is in Spanish.
 */
export function selectedDisplayLanguage(currentLocale: string, options: readonly IDisplayLanguageOption[]): string {
	const current = normalize(currentLocale);
	if (options.some(option => option.value === current)) {
		return current;
	}
	const base = current.split('-')[0];
	if (base && options.some(option => option.value === base)) {
		return base;
	}
	return OPENIDE_DEFAULT_LOCALE;
}
