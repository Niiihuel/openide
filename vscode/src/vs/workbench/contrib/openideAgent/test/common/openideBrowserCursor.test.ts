/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { cursorInstallScript, cursorRemoveScript, OPENIDE_CURSOR_GLOBAL, OPENIDE_CURSOR_HOST_ID, openideCursorRuntimeMain, stripCursorHost } from '../../common/openideBrowserCursor.js';

/**
 * The cursor runtime is serialized with toString() and evaluated inside the page. The failure
 * mode is silent: if the code stops being self-contained, or if the overlay starts showing up
 * in DOM reads, nobody notices until the agent is working with contaminated context. The
 * visual behaviour (glide, ripple, clicks passing through) is verified separately with
 * Playwright against a real page.
 */
suite('OpenIDE browser cursor', () => {

	const source = openideCursorRuntimeMain.toString();

	test('the runtime is self-contained: toString() can serialize it', () => {
		// An import or a reference to a module value would be out of scope inside the page.
		assert.strictEqual(source.includes('import '), false);
		assert.strictEqual(/\brequire\(/.test(source), false);
		// The exported constants are repeated as literals in there on purpose.
		//
		// Matched WITHOUT the surrounding quotes. `source` is transpiled output, and the transpiler
		// does not promise a quote style: the same string comes out `'...'` from one pass and
		// `"..."` from the next, which made this whole file pass or fail depending on which build
		// ran last. What is worth pinning is that the literal is inlined, not how it is quoted.
		assert.strictEqual(source.includes(OPENIDE_CURSOR_HOST_ID), true);
		assert.strictEqual(source.includes(OPENIDE_CURSOR_GLOBAL), true);
	});

	test('the install script is an evaluable expression', () => {
		const script = cursorInstallScript();
		assert.strictEqual(script.startsWith('('), true);
		assert.strictEqual(script.endsWith('()'), true);
		assert.doesNotThrow(() => new Function(`return ${script.replace(/\(\)$/, '')}`), 'it has to parse as a function');
	});

	test('it cannot steal a click nor cover the page', () => {
		assert.strictEqual(source.includes('pointer-events:none'), true);
		assert.strictEqual(/attachShadow\(\{\s*mode:\s*['"]closed['"]\s*\}\)/.test(source), true);
	});

	test('it only mirrors real input, never the page\'s synthetic events', () => {
		// Without the isTrusted guard, any dispatchEvent from the app would move the agent's
		// pointer and the screenshot would show a click the agent never made.
		assert.strictEqual((source.match(/isTrusted/g) ?? []).length >= 2, true);
		assert.strictEqual(source.includes('passive: true'), true);
	});

	test('the input mirror is gated: the user\'s mouse does not move the pointer', () => {
		// engage starts off: only browser_playwright turns it on while operating. Without this gate,
		// any user hover over the preview would move the agent's cursor.
		assert.strictEqual(source.includes('let engaged = false'), true);
		assert.strictEqual((source.match(/!engaged/g) ?? []).length >= 2, true);
		// `engage(` and not `engage(on: boolean): void`: `source` is the runtime serialized with
		// toString(), which is the TRANSPILED function — the type annotations are gone by then, so
		// asserting on TypeScript syntax here could only ever fail.
		assert.strictEqual(/\bengage\(/.test(source), true, 'there is no way to switch the mirror on');
	});

	test('it exposes the pieces the tools use', () => {
		for (const member of ['moveTo', 'press', 'highlight', 'clearHighlight', 'typing', 'fail', 'label']) {
			assert.strictEqual(source.includes(member + '('), true, `${member} is missing from the runtime`);
		}
	});

	test('the outline cannot steal a click either', () => {
		// It is inside the same layer with pointer-events:none, but it declares it anyway: it is the
		// element drawn RIGHT on top of the one about to be clicked.
		assert.strictEqual(source.includes('.box{position:absolute'), true);
		// The rule is split across two strings of the CSS array, so the match crosses quotes.
		assert.strictEqual(/\.box\{[\s\S]{0,320}?pointer-events:none\}/.test(source), true);
	});

	test('removing the overlay works even once the global API is gone', () => {
		const script = cursorRemoveScript();
		assert.strictEqual(script.includes(OPENIDE_CURSOR_GLOBAL), true);
		assert.strictEqual(script.includes(`getElementById('${OPENIDE_CURSOR_HOST_ID}')`), true);
	});

	test('stripCursorHost removes the host and keeps the content', () => {
		const html = `<html><body><h1>Hola</h1><div id="${OPENIDE_CURSOR_HOST_ID}" data-openide-overlay="cursor" style="position:fixed"></div></body></html>`;
		const clean = stripCursorHost(html);
		assert.strictEqual(clean.includes(OPENIDE_CURSOR_HOST_ID), false);
		assert.strictEqual(clean.includes('<h1>Hola</h1>'), true);
	});

	test('stripCursorHost leaves html without an overlay alone', () => {
		const html = '<html><body><div id="app">contenido</div></body></html>';
		assert.strictEqual(stripCursorHost(html), html);
	});

	test('a similar id of the user\'s own is not deleted', () => {
		const html = `<div id="${OPENIDE_CURSOR_HOST_ID}-propio">mío</div>`;
		assert.strictEqual(stripCursorHost(html).includes('mío'), true);
	});
});
