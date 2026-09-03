/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { matchesSettingsSearchEntries, plainSettingsQuery, scoreSettingsSearchEntries } from '../../../openideSettings/browser/openideSettingsSearch.js';
import { openideSettingsSurfaceSearch } from '../../../openideSettings/browser/openideSettingsSurfaceSearch.js';

/**
 * Our own Settings pages are not config keys: they are files on disk, accounts and live state.
 * Search looks at the schema, so without a declared index "mcp", "skill" or "hook" find
 * nothing — the user sees an empty tree and concludes the feature does not exist.
 *
 * These tests pin both halves of the contract: that the index is complete (a new surface
 * without an entry is a silent hole) and that the index does not depend on the UI, which is how
 * navigation and search ended up diverging last time.
 */
suite('OpenIDE settings surface search', () => {

	// A static contract over the REPO: it runs from `out/` (ESM, no `__dirname`) but reads `.ts`
	// sources, so it has to map back to `src/`. Same idiom as `openideSettingsContract.test.ts`.
	const sourceDir = import.meta.dirname.replace(`${path.sep}out${path.sep}`, `${path.sep}src${path.sep}`);
	const settingsRoot = path.join(sourceDir, '..', '..', '..', 'openideSettings', 'browser');
	const editorSource = fs.readFileSync(path.join(settingsRoot, 'openideSettingsEditor.ts'), 'utf8');

	/** Categories with their own section registered in the editor. Since MCP and Providers
	 *  migrated, no page remains in a webview, so this is the complete list.
	 *
	 *  The prefix is NOT pinned to `openideAgent/`: once `workbench/language` was added this regex
	 *  stopped seeing it and declared it "unregistered", so the test accused the index of pointing
	 *  at a dead surface that actually exists. Any `group/name` counts. */
	function registeredCategories(): string[] {
		return [...new Set([...editorSource.matchAll(/\[\s*'([a-zA-Z]+\/[a-zA-Z]+)'\s*,\s*Openide\w+Section\s*\]/g)].map(match => match[1]))];
	}

	test('every registered settings surface declares what it offers', () => {
		const categories = registeredCategories();
		assert.strictEqual(categories.length > 0, true, 'the editor scan found no registered categories');
		const sinIndice = categories.filter(category => !openideSettingsSurfaceSearch().has(category));
		assert.deepStrictEqual(sinIndice, [], 'surfaces with no search entry: nobody is going to find them');
	});

	test('the search index does not point at surfaces that no longer exist', () => {
		const categories = new Set(registeredCategories());
		const huerfanas = [...openideSettingsSurfaceSearch().keys()].filter(category => !categories.has(category));
		assert.deepStrictEqual(huerfanas, [], 'search entries for categories that are no longer registered');
	});

	test('the search index stays free of UI imports', () => {
		const source = fs.readFileSync(path.join(settingsRoot, 'openideSettingsSurfaceSearch.ts'), 'utf8');
		const imports = [...source.matchAll(/^import .*from '([^']+)';$/gm)].map(match => match[1]);
		// What the invariant protects is that the index does not depend on the UI, which is how
		// navigation and search drifted apart last time. A `common/` module is not UI: it is pure
		// logic that also runs without a workbench, and the index needs at least the i18n
		// dictionary for its titles to be translated. The literal list banned that by accident.
		const ui = imports.filter(specifier => !/(^\.\/openideSettingsSearch\.js$)|(\/common\/[\w.]+\.js$)/.test(specifier));
		assert.deepStrictEqual(ui, [], 'the index may only import the entry type and modules from common/');
	});

	test('every entry carries keywords a user would actually type', () => {
		for (const [category, entries] of openideSettingsSurfaceSearch()) {
			for (const entry of entries) {
				assert.strictEqual(entry.title.length > 0, true, `${category}: entry with no title`);
				assert.strictEqual((entry.keywords?.length ?? 0) >= 3, true, `${category}: fewer than 3 keywords`);
			}
		}
	});

	test('the page is found by its own name and by its jargon', () => {
		const mcp = openideSettingsSurfaceSearch().get('openideAgent/mcp')!;
		assert.strictEqual(matchesSettingsSearchEntries('mcp', mcp), true);
		assert.strictEqual(matchesSettingsSearchEntries('servidor', mcp), true);
		assert.strictEqual(matchesSettingsSearchEntries('model context', mcp), true);
		assert.strictEqual(matchesSettingsSearchEntries('tipografía', mcp), false);
	});

	test('a title hit outranks a description hit, and exact outranks partial', () => {
		const entries = [{ title: 'Hooks', description: 'Comandos que se ejecutan', keywords: ['evento'] }];
		const exacto = scoreSettingsSearchEntries('hooks', entries);
		const parcial = scoreSettingsSearchEntries('hoo', entries);
		const porDescripcion = scoreSettingsSearchEntries('ejecutan', entries);
		const porKeyword = scoreSettingsSearchEntries('evento', entries);
		assert.strictEqual(exacto > parcial, true, 'exact has to outrank partial');
		assert.strictEqual(parcial > porDescripcion, true, 'the title has to outrank the description');
		assert.strictEqual(porDescripcion > porKeyword, true, 'the description has to outrank the keyword');
		assert.strictEqual(porKeyword > 0, true);
	});

	test('filter-only queries are not text and match nothing', () => {
		assert.strictEqual(plainSettingsQuery('@modified'), '');
		assert.strictEqual(plainSettingsQuery('@ext:vscode.git hooks'), 'hooks');
		assert.strictEqual(plainSettingsQuery('@id:openide.agent.model'), '');
	});
});
