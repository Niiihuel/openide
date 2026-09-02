/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }` — see openideCodebaseGraphLayout.test.ts.
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { leadingDocComment } from '../../common/diagrams/openideSourceDoc.js';

/**
 * The rule that decides whether a map explains itself or captions every node with the same
 * copyright line: a license banner is not a description.
 */
suite('OpenIDE source doc — the header comment as the node explanation', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the license banner is skipped and the real header is taken', () => {
		const file = [
			'/*--------------------------------------------------------------',
			' *  Copyright (c) OpenIDE. All rights reserved.',
			' *  Licensed under the MIT License.',
			' *-------------------------------------------------------------*/',
			'',
			'/*--------------------------------------------------------------',
			' *  OpenIDE — the map SWITCHER: the popover that moves between',
			' *  the maps of the project.',
			' *',
			' *  A second paragraph nobody needs in a panel.',
			' *-------------------------------------------------------------*/',
			'',
			'import { x } from "y";',
		].join('\n');
		assert.strictEqual(
			leadingDocComment(file),
			'OpenIDE — the map SWITCHER: the popover that moves between the maps of the project.',
		);
	});

	test('a file whose only comment is its license has no description', () => {
		const file = '/*\n * Copyright (c) 2026 Someone.\n * Licensed under the MIT License.\n */\n\nexport const x = 1;\n';
		assert.strictEqual(leadingDocComment(file), undefined);
	});

	test('a run of line comments is one header', () => {
		const file = '// The order queue.\n// Retries three times and then gives up.\n\nfunction q() {}\n';
		assert.strictEqual(leadingDocComment(file), 'The order queue. Retries three times and then gives up.');
	});

	test('a shebang and a hash header, the way a script is written', () => {
		const file = '#!/usr/bin/env bash\n# Publishes the update feed.\n\nset -e\n';
		assert.strictEqual(leadingDocComment(file), 'Publishes the update feed.');
	});

	test('a jsdoc header is prose too', () => {
		assert.strictEqual(leadingDocComment('/** Formats a price for the checkout. */\nexport function f() {}'), 'Formats a price for the checkout.');
	});

	test('code with no header comment says nothing rather than guessing', () => {
		assert.strictEqual(leadingDocComment('import { x } from "y";\n\n// a comment, but not a header\n'), undefined);
		assert.strictEqual(leadingDocComment(''), undefined);
		assert.strictEqual(leadingDocComment('{ "type": "archmap" }'), undefined);
	});

	test('a long header is cut to something a panel can hold', () => {
		const long = `/**\n * ${'palabra '.repeat(120)}\n */\ncode();`;
		const doc = leadingDocComment(long)!;
		assert.ok(doc.length <= 320, `got ${doc.length}`);
		assert.ok(doc.endsWith('…'));
	});

	test('the real files of this tree describe themselves', () => {
		// The shape every file in the fork actually has: banner, license, banner, description.
		const file = [
			'/*---------------------------------------------------------------------------------------------',
			' *  Copyright (c) OpenIDE. All rights reserved.',
			' *  Licensed under the MIT License. See License.txt in the project root for license information.',
			' *--------------------------------------------------------------------------------------------*/',
			'',
			'/*---------------------------------------------------------------------------------------------',
			' *  OpenIDE — PLAN MODE EditorPane, native.',
			' *--------------------------------------------------------------------------------------------*/',
		].join('\n');
		assert.strictEqual(leadingDocComment(file), 'OpenIDE — PLAN MODE EditorPane, native.');
	});
});
