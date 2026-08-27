/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildOpenideExtensionsNavigation, humanizeExtensionId, isOpenideNavigableSetting, isReadableNavigationLabel } from '../../../openideSettings/common/openideSettingsNavigation.js';

/**
 * Contract for the settings sidebar: nothing without a readable name ever becomes a navigation
 * entry. Born from the "EXTENSIONS › defaultOverrides × N" rows — one per extension that shipped
 * `configurationDefaults`, all labelled with the group id of the preferences model.
 */
suite('OpenIDE settings navigation — extensions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const overrides = [
		{ key: '[typescript]', groupId: 'defaultOverrides', extensionId: 'vscode.typescript-language-features', extensionLabel: 'TypeScript and JavaScript Language Features' },
		{ key: '[markdown]', groupId: 'defaultOverrides', extensionId: 'vscode.markdown-language-features', extensionLabel: 'Markdown Language Features' },
	];
	const real = [
		{ key: 'git.autofetch', groupId: 'git', extensionId: 'vscode.git', extensionLabel: 'Git' },
		{ key: 'git.enabled', groupId: 'git', extensionId: 'vscode.git', extensionLabel: 'Git' },
		{ key: 'eslint.run', groupId: 'eslint', extensionId: 'dbaeumer.vscode-eslint' },
	];

	test('per-language default overrides are not navigable settings', () => {
		for (const ref of overrides) { assert.strictEqual(isOpenideNavigableSetting(ref), false, ref.key); }
		for (const ref of real) { assert.strictEqual(isOpenideNavigableSetting(ref), true, ref.key); }
	});

	test('overrides alone produce no Extensions node at all', () => {
		assert.strictEqual(buildOpenideExtensionsNavigation(overrides, 'Extensions'), undefined);
		assert.strictEqual(buildOpenideExtensionsNavigation([], 'Extensions'), undefined);
	});

	test('one sub-page per extension, named after the extension, never after a group id', () => {
		const node = buildOpenideExtensionsNavigation([...overrides, ...real], 'Extensiones');
		assert.ok(node);
		assert.strictEqual(node.label, 'Extensiones');
		assert.deepStrictEqual(node.children?.map(child => child.label), ['Git', 'Vscode eslint']);
		assert.deepStrictEqual(node.children?.map(child => child.id), ['extensions/vscode.git', 'extensions/dbaeumer.vscode-eslint']);
		assert.deepStrictEqual(node.children?.map(child => child.settings), [['@ext:vscode.git'], ['@ext:dbaeumer.vscode-eslint']]);
		for (const child of node.children ?? []) {
			assert.ok(isReadableNavigationLabel(child.label), `label "${child.label}" is not readable`);
			assert.notStrictEqual(child.label, 'defaultOverrides');
		}
	});

	test('a displayName found on a later setting upgrades the humanized id', () => {
		const node = buildOpenideExtensionsNavigation([
			{ key: 'eslint.run', groupId: 'eslint', extensionId: 'dbaeumer.vscode-eslint' },
			{ key: 'eslint.enable', groupId: 'eslint', extensionId: 'dbaeumer.vscode-eslint', extensionLabel: 'ESLint' },
		], 'Extensions');
		assert.deepStrictEqual(node?.children?.map(child => child.label), ['ESLint']);
	});

	test('humanizeExtensionId reads like a name', () => {
		assert.strictEqual(humanizeExtensionId('dbaeumer.vscode-eslint'), 'Vscode eslint');
		assert.strictEqual(humanizeExtensionId('ms-python.python'), 'Python');
		assert.strictEqual(humanizeExtensionId('single'), 'Single');
	});

	test('isReadableNavigationLabel rejects identifiers and accepts names', () => {
		for (const bad of ['', '  ', 'defaultOverrides', '[typescript]', 'vscode.git', 'someCamelCase']) {
			assert.strictEqual(isReadableNavigationLabel(bad), false, bad);
		}
		for (const good of ['Git', 'Extensiones', 'TypeScript and JavaScript Language Features', 'Idioma', 'MCP']) {
			assert.strictEqual(isReadableNavigationLabel(good), true, good);
		}
	});
});
