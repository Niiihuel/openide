/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { applyTextPatch, consolidateFileChange, contentHash, createFileChange, createTextPatch } from '../../common/openideMessageChanges.js';

suite('OpenIDE message changes', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('hash is stable and content-sensitive', () => {
		assert.strictEqual(contentHash('a'), contentHash('a'));
		assert.notStrictEqual(contentHash('a'), contentHash('b'));
	});

	test('reverse patch preserves a later non-overlapping edit', () => {
		const before = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n');
		const afterA = ['alpha', 'BETA-A', 'gamma', 'delta', 'epsilon'].join('\n');
		const current = ['alpha', 'BETA-A', 'gamma', 'DELTA-MANUAL', 'epsilon'].join('\n');
		const result = applyTextPatch(current, createTextPatch(afterA, before), before);
		assert.strictEqual(result.conflict, undefined);
		assert.strictEqual(result.content, ['alpha', 'beta', 'gamma', 'DELTA-MANUAL', 'epsilon'].join('\n'));
	});

	test('reverse patch reports overlapping manual change without content', () => {
		const before = 'alpha\nbeta\ngamma';
		const after = 'alpha\nBETA-A\ngamma';
		const result = applyTextPatch('alpha\nBETA-MANUAL\ngamma', createTextPatch(after, before), before);
		assert.ok(result.conflict);
		assert.strictEqual(result.content, undefined);
	});

	test('reverse patch rejects ambiguous repeated hunks', () => {
		const patch = createTextPatch('same\ntarget\nsame', 'same\nold\nsame');
		const result = applyTextPatch('same\ntarget\nsame\ntarget\nsame', patch);
		assert.ok(result.conflict);
	});

	test('multiple edits consolidate first before and last after', () => {
		const first = createFileChange('a.ts', 'modify', 'one', 'two');
		const second = createFileChange('a.ts', 'modify', 'two', 'three');
		const merged = consolidateFileChange(first, second);
		assert.strictEqual(merged?.beforeContent, 'one');
		assert.strictEqual(merged?.afterContent, 'three');
		assert.strictEqual(merged?.operation, 'modify');
	});

	test('rename followed by delete restores the original path', () => {
		const rename = createFileChange('b.ts', 'rename', 'content', 'content', 'a.ts');
		const remove = createFileChange('b.ts', 'delete', 'content', undefined);
		const merged = consolidateFileChange(rename, remove);
		assert.strictEqual(merged?.operation, 'delete');
		assert.strictEqual(merged?.uri, 'a.ts');
	});

	test('effective no-ops disappear', () => {
		assert.strictEqual(consolidateFileChange(undefined, createFileChange('a.ts', 'modify', 'same', 'same')), undefined);
		const create = createFileChange('a.ts', 'create', undefined, 'new');
		const remove = createFileChange('a.ts', 'delete', 'new', undefined);
		assert.strictEqual(consolidateFileChange(create, remove), undefined);
		const modify = createFileChange('a.ts', 'modify', 'one', 'two');
		const restore = createFileChange('a.ts', 'modify', 'two', 'one');
		assert.strictEqual(consolidateFileChange(modify, restore), undefined);
	});

	test('global EOL conversion is represented and reverted', () => {
		const patch = createTextPatch('a\r\nb\r\n', 'a\nb\n');
		const result = applyTextPatch('a\r\nb\r\n', patch, 'a\nb\n');
		assert.strictEqual(result.content, 'a\nb\n');
	});

	test('later final-newline edit survives when the message did not touch EOF', () => {
		const patch = createTextPatch('a\nB\n', 'a\nb\n');
		const result = applyTextPatch('a\nB', patch, 'a\nb\n');
		assert.strictEqual(result.content, 'a\nb');
	});

	test('combined text and EOF reverse patch conflicts after later lines were appended', () => {
		const patch = createTextPatch('a\nB\n', 'a\nb');
		const result = applyTextPatch('a\nB\nmanual\n', patch, 'a\nb');
		assert.ok(result.conflict);
		assert.strictEqual(result.content, undefined);
	});

	test('EOF-only reverse patch conflicts after later lines were appended', () => {
		const patch = createTextPatch('a\n', 'a');
		const result = applyTextPatch('a\nlater\n', patch, 'a');
		assert.ok(result.conflict);
		assert.strictEqual(result.content, undefined);
	});

	test('CRLF and EOF newline round trip', () => {
		const before = 'a\r\nb\r\n';
		const after = 'a\r\nB\r\n';
		const result = applyTextPatch(after, createTextPatch(after, before), before);
		assert.strictEqual(result.content, before);
	});
});
