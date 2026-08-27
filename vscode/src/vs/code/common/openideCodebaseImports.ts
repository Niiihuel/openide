/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — resolución determinista de specifiers de import a archivos reales del índice.
 *  Reemplaza el matching difuso por nombre: un import es una referencia con respuesta exacta,
 *  no una entidad parecida a otra.
 *--------------------------------------------------------------------------------------------*/

/** Prefijo sintético para paquetes externos: mantiene `uri` con forma de URI sin fingir un path
 *  del workspace (los consumidores calculan paths relativos sobre `uri`). */
export const PACKAGE_URI_PREFIX = 'openide-package:';

/** Prefijo sintético del import por alias TODAVÍA no resuelto a un archivo real del índice. */
export const ALIAS_URI_PREFIX = 'openide-alias:';

/** Extensiones candidatas al resolver un import sin extensión, en orden de preferencia. */
const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];

export function isRelativeSpecifier(specifier: string): boolean {
	return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
}

/**
 * Prefijos de alias que apuntan SIEMPRE dentro del workspace. `@/` no puede ser un paquete npm
 * (un scope exige `@nombre/…`), y `~/` y `#/` tampoco son specifiers de paquete válidos, así que
 * reconocerlos no puede pisar una dependencia real.
 */
const ALIAS_PREFIXES = ['@/', '~/', '#/'];

export function isWorkspaceAliasSpecifier(specifier: string): boolean {
	return ALIAS_PREFIXES.some(prefix => specifier.startsWith(prefix));
}

/** Un import interno es el que referencia un archivo del proyecto: relativo o por alias. */
export function isInternalSpecifier(specifier: string): boolean {
	return isRelativeSpecifier(specifier) || isWorkspaceAliasSpecifier(specifier);
}

/** Formas candidatas de un specifier sin extensión, en el orden que probaría un bundler. */
function candidateSuffixes(tail: string): string[] {
	const suffixes = ['/' + tail];
	for (const extension of CANDIDATE_EXTENSIONS) { suffixes.push('/' + tail + extension); }
	for (const extension of CANDIDATE_EXTENSIONS) { suffixes.push('/' + tail + '/index' + extension); }
	return suffixes;
}

/**
 * Resuelve un import por alias (`@/x/y`) al archivo real. El alias es absoluto pero su raíz vive
 * en la config del bundler, que este proceso no lee: se busca el archivo indexado cuyo path
 * TERMINA en el specifier. Si dos archivos empatan, no se resuelve — una arista inventada
 * distorsiona las comunidades más que una arista faltante.
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

/** Resolución unificada: relativa o por alias, según el specifier. */
export function resolveInternalImport(importerUri: string, specifier: string, knownUris: ReadonlySet<string>): string | undefined {
	return isRelativeSpecifier(specifier)
		? resolveRelativeImport(importerUri, specifier, knownUris)
		: resolveAliasImport(specifier, knownUris);
}

/** Nombre de paquete de un specifier bare, conservando el scope: `@scope/pkg/sub` → `@scope/pkg`. */
export function packageNameOf(specifier: string): string {
	const parts = specifier.split('/');
	if (specifier.startsWith('@') && parts.length >= 2) { return `${parts[0]}/${parts[1]}`; }
	return parts[0] || specifier;
}

function dirnameOf(uri: string): string {
	const slash = uri.lastIndexOf('/');
	return slash >= 0 ? uri.slice(0, slash) : uri;
}

/** Normaliza `a/b/../c` → `a/c` sin depender de path de node (esto corre en common). */
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
 * Resuelve un import relativo al URI del archivo real que referencia, probando extensiones e
 * `index.*` — el mismo orden que usa un bundler. Devuelve undefined si no cae en el índice
 * (archivo no indexado o excluido), y en ese caso el nodo sintético sobrevive.
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
	// El specifier ya traía extensión pero apunta al archivo fuente (import './x.js' → x.ts).
	const withoutJs = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
	if (withoutJs !== base) {
		for (const extension of CANDIDATE_EXTENSIONS) {
			const candidate = withoutJs + extension;
			if (knownUris.has(candidate)) { return candidate; }
		}
	}
	return undefined;
}
