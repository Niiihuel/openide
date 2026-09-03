/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { ALIAS_URI_PREFIX, isInternalSpecifier, PACKAGE_URI_PREFIX, resolveInternalImport } from '../../../../../code/common/openideCodebaseImports.js';

/**
 * The Project Map showed "208 files · 0 relationships · 1 modules" on perfectly working
 * projects. Extraction was fine —925 import nodes, 925 IMPORTS edges on disk—; what was
 * missing was resolution: without the alias table, EVERY import edge dies, because the
 * synthetic node of a relative import carries the uri of the importer ITSELF (discarded as a
 * self-edge) and an alias one carries an `openide-alias:` that is not a workspace file.
 *
 * These tests pin down resolution, which is where the file↔file edges come from.
 */
suite('OpenIDE codebase imports — resolution', () => {

	const ROOT = 'file:///w';
	const uris = new Set([
		`${ROOT}/src/app.tsx`,
		`${ROOT}/src/lib/db.ts`,
		`${ROOT}/src/lib/index.ts`,
		`${ROOT}/src/components/ui/button.tsx`,
		`${ROOT}/src/utils.ts`,
	]);

	test('a relative import resolves to the real file by trying extensions', () => {
		assert.strictEqual(resolveInternalImport(`${ROOT}/src/app.tsx`, './utils', uris), `${ROOT}/src/utils.ts`);
	});

	test('a relative import that walks up a folder is normalized', () => {
		assert.strictEqual(resolveInternalImport(`${ROOT}/src/components/ui/button.tsx`, '../../lib/db', uris), `${ROOT}/src/lib/db.ts`);
	});

	test('a directory resolves to its index', () => {
		assert.strictEqual(resolveInternalImport(`${ROOT}/src/app.tsx`, './lib', uris), `${ROOT}/src/lib/index.ts`);
	});

	test('an aliased import resolves to the real file', () => {
		// This is the case that wiped the whole graph in Next/Vite projects: treating `@/` as an external
		// package left ZERO file-to-file edges.
		assert.strictEqual(resolveInternalImport(`${ROOT}/src/app.tsx`, '@/lib/db', uris), `${ROOT}/src/lib/db.ts`);
	});

	test('the alias is internal, the package is not', () => {
		assert.strictEqual(isInternalSpecifier('@/lib/db'), true);
		assert.strictEqual(isInternalSpecifier('~/lib/db'), true);
		assert.strictEqual(isInternalSpecifier('./db'), true);
		assert.strictEqual(isInternalSpecifier('react'), false);
		// An npm scope IS external: `@scope/pkg` must not be confused with `@/`.
		assert.strictEqual(isInternalSpecifier('@radix-ui/react-dialog'), false);
	});

	test('an ambiguous alias does not invent a resolution', () => {
		// Two files ending the same way: an invented edge distorts the communities more
		// than a missing one does.
		const ambiguous = new Set([`${ROOT}/a/lib/db.ts`, `${ROOT}/b/lib/db.ts`]);
		assert.strictEqual(resolveInternalImport(`${ROOT}/a/app.tsx`, '@/lib/db', ambiguous), undefined);
	});

	test('an import that misses the index stays unresolved', () => {
		assert.strictEqual(resolveInternalImport(`${ROOT}/src/app.tsx`, './no-existe', uris), undefined);
	});

	test('the synthetic prefixes do not collide with a real path', () => {
		// finalizeGraph uses them to discard unresolved synthetic nodes; if a real uri could start
		// this way, genuine files would be discarded.
		assert.strictEqual(ALIAS_URI_PREFIX.endsWith(':'), true);
		assert.strictEqual(PACKAGE_URI_PREFIX.endsWith(':'), true);
		assert.notStrictEqual(ALIAS_URI_PREFIX, PACKAGE_URI_PREFIX);
		for (const uri of uris) {
			assert.strictEqual(uri.startsWith(ALIAS_URI_PREFIX) || uri.startsWith(PACKAGE_URI_PREFIX), false);
		}
	});
});
