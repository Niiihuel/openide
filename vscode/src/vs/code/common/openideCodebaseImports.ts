/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — deterministic resolution of import specifiers to real files of the index. It replaces
 *  fuzzy matching by name: an import is a reference with an exact answer,
 *  no una entidad parecida a otra.
 *--------------------------------------------------------------------------------------------*/

/** Synthetic prefix for external packages: it keeps `uri` shaped like a URI without pretending to
 *  be a workspace path (consumers compute relative paths off `uri`). */
export const PACKAGE_URI_PREFIX = 'openide-package:';

/** Synthetic prefix of an aliased import NOT YET resolved to a real file of the index. */
export const ALIAS_URI_PREFIX = 'openide-alias:';

/** Candidate extensions when resolving an extensionless import, in order of preference. */
const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];

export function isRelativeSpecifier(specifier: string): boolean {
	return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
}

/**
 * Alias prefixes that ALWAYS point inside the workspace. `@/` cannot be an npm package (a scope
 * requires `@name/…`), and `~/` and `#/` are not valid package specifiers either, so
 * reconocerlos no puede pisar una dependencia real.
 */
const ALIAS_PREFIXES = ['@/', '~/', '#/'];

export function isWorkspaceAliasSpecifier(specifier: string): boolean {
	return ALIAS_PREFIXES.some(prefix => specifier.startsWith(prefix));
}

/** An internal import is one that references a file of the project: relative or aliased. */
export function isInternalSpecifier(specifier: string): boolean {
	return isRelativeSpecifier(specifier) || isWorkspaceAliasSpecifier(specifier);
}

/** Candidate forms of an extensionless specifier, in the order a bundler would try them. */
function candidateSuffixes(tail: string): string[] {
	const suffixes = ['/' + tail];
	for (const extension of CANDIDATE_EXTENSIONS) { suffixes.push('/' + tail + extension); }
	for (const extension of CANDIDATE_EXTENSIONS) { suffixes.push('/' + tail + '/index' + extension); }
	return suffixes;
}

/**
 * Resolves an aliased import (`@/x/y`) to the real file. The alias is absolute but its root lives
 * in the bundler's config, which this process does not read: it looks for the indexed file whose
 * path ENDS in the specifier. On a tie it does not resolve — an invented edge distorts the
 * communities more than a missing one.
 */
export function resolveAliasImport(specifier: string, knownUris: ReadonlySet<string>): string | undefined {
	if (!isWorkspaceAliasSpecifier(specifier)) { return undefined; }
	const tail = specifier.slice(2).replace(/^\/+/, '');
	if (!tail) { return undefined; }
	for (const suffix of candidateSuffixes(tail)) {
		let match: string | undefined;
		let matches = 0;
		for (const uri of knownUris) {
			if (uri.endsWith(suffix)) { matches++; if (matches > 1) { break; } match = uri; }
		}
		if (matches === 1) { return match; }
		if (matches > 1) { return undefined; }
	}
	return undefined;
}

/** One entry point: relative or aliased, depending on the specifier. */
export function resolveInternalImport(importerUri: string, specifier: string, knownUris: ReadonlySet<string>): string | undefined {
	return isRelativeSpecifier(specifier)
		? resolveRelativeImport(importerUri, specifier, knownUris)
		: resolveAliasImport(specifier, knownUris);
}

/** Package name of a bare specifier, scope included: `@scope/pkg/sub` → `@scope/pkg`. */
export function packageNameOf(specifier: string): string {
	const parts = specifier.split('/');
	if (specifier.startsWith('@') && parts.length >= 2) { return `${parts[0]}/${parts[1]}`; }
	return parts[0] || specifier;
}

function dirnameOf(uri: string): string {
	const slash = uri.lastIndexOf('/');
	return slash >= 0 ? uri.slice(0, slash) : uri;
}

/** Normalizes `a/b/../c` → `a/c` without node's path module (this runs in common). */
function normalizeUriPath(uri: string): string {
	const schemeEnd = uri.indexOf('://');
	const prefix = schemeEnd >= 0 ? uri.slice(0, schemeEnd + 3) : '';
	const rest = schemeEnd >= 0 ? uri.slice(schemeEnd + 3) : uri;
	const out: string[] = [];
	for (const segment of rest.split('/')) {
		if (segment === '.' || segment === '') { if (!out.length && segment === '') { out.push(''); } continue; }
		if (segment === '..') { if (out.length > 1) { out.pop(); } continue; }
		out.push(segment);
	}
	return prefix + out.join('/');
}

/**
 * Resolves a relative import to the URI of the real file it references, trying extensions and
 * `index.*` — the order a bundler uses. It returns undefined when the target is not in the index
 * (not indexed, or excluded), and then the synthetic node survives.
 */
export function resolveRelativeImport(importerUri: string, specifier: string, knownUris: ReadonlySet<string>): string | undefined {
	if (!isRelativeSpecifier(specifier)) { return undefined; }
	const base = normalizeUriPath(`${dirnameOf(importerUri)}/${specifier}`);
	if (knownUris.has(base)) { return base; }
	for (const extension of CANDIDATE_EXTENSIONS) {
		const candidate = base + extension;
		if (knownUris.has(candidate)) { return candidate; }
	}
	for (const extension of CANDIDATE_EXTENSIONS) {
		const candidate = `${base}/index${extension}`;
		if (knownUris.has(candidate)) { return candidate; }
	}
	// The specifier already had an extension but points at the source file (import './x.js' → x.ts).
	const withoutJs = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
	if (withoutJs !== base) {
		for (const extension of CANDIDATE_EXTENSIONS) {
			const candidate = withoutJs + extension;
			if (knownUris.has(candidate)) { return candidate; }
		}
	}
	return undefined;
}
