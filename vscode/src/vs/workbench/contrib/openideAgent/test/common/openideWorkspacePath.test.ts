/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { resolvePathInsideWorkspace } from '../../common/openideWorkspacePath.js';

suite('OpenIDE workspace paths', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const firstRoot = URI.file('/workspace/first');
	const secondRoot = URI.file('/workspace/second');
	const roots = [firstRoot, secondRoot];

	test('resolves relative paths against the first root', () => {
		assert.strictEqual(
			resolvePathInsideWorkspace('src/index.ts', roots)?.fsPath,
			URI.file('/workspace/first/src/index.ts').fsPath,
		);
	});

	test('accepts absolute paths inside any workspace root', () => {
		assert.strictEqual(
			resolvePathInsideWorkspace('/workspace/second/package.json', roots)?.fsPath,
			URI.file('/workspace/second/package.json').fsPath,
		);
	});

	test('rejects absolute paths outside the workspace', () => {
		assert.strictEqual(resolvePathInsideWorkspace('/etc/passwd', roots), undefined);
	});

	test('rejects relative traversal outside the first root', () => {
		assert.strictEqual(resolvePathInsideWorkspace('../../etc/passwd', roots), undefined);
	});

	test('rejects empty paths and missing roots', () => {
		assert.strictEqual(resolvePathInsideWorkspace('', roots), undefined);
		assert.strictEqual(resolvePathInsideWorkspace('file.ts', []), undefined);
	});
});
