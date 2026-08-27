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

	test('el runtime es autocontenido: toString() puede serializarlo', () => {
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

	test('el script de instalación es una expresión evaluable', () => {
		const script = cursorInstallScript();
		assert.strictEqual(script.startsWith('('), true);
		assert.strictEqual(script.endsWith('()'), true);
		assert.doesNotThrow(() => new Function(`return ${script.replace(/\(\)$/, '')}`), 'tiene que parsear como función');
	});

	test('no puede robar un click ni tapar la página', () => {
		assert.strictEqual(source.includes('pointer-events:none'), true);
		assert.strictEqual(/attachShadow\(\{\s*mode:\s*['"]closed['"]\s*\}\)/.test(source), true);
	});

	test('sólo espeja entrada real, nunca eventos sintéticos de la página', () => {
		// Without the isTrusted guard, any dispatchEvent from the app would move the agent's
		// pointer and the screenshot would show a click the agent never made.
		assert.strictEqual((source.match(/isTrusted/g) ?? []).length >= 2, true);
		assert.strictEqual(source.includes('passive: true'), true);
	});

	test('el espejo de entrada está gated: el mouse del usuario no mueve el puntero', () => {
		// engage starts off: only browser_playwright turns it on while operating. Without this gate,
		// any user hover over the preview would move the agent's cursor.
		assert.strictEqual(source.includes('let engaged = false'), true);
		assert.strictEqual((source.match(/!engaged/g) ?? []).length >= 2, true);
		// `engage(` and not `engage(on: boolean): void`: `source` is the runtime serialized with
		// toString(), which is the TRANSPILED function — the type annotations are gone by then, so
		// asserting on TypeScript syntax here could only ever fail.
		assert.strictEqual(/\bengage\(/.test(source), true, 'no hay forma de encender el espejo');
	});

	test('expone las piezas que usan las tools', () => {
		for (const member of ['moveTo', 'press', 'highlight', 'clearHighlight', 'typing', 'fail', 'label']) {
			assert.strictEqual(source.includes(member + '('), true, `falta ${member} en el runtime`);
		}
	});

	test('el recuadro tampoco puede robar un click', () => {
		// It is inside the same layer with pointer-events:none, but it declares it anyway: it is the
		// element drawn RIGHT on top of the one about to be clicked.
		assert.strictEqual(source.includes('.box{position:absolute'), true);
		// The rule is split across two strings of the CSS array, so the match crosses quotes.
		assert.strictEqual(/\.box\{[\s\S]{0,320}?pointer-events:none\}/.test(source), true);
	});

	test('quitar el overlay funciona aunque la API global ya no esté', () => {
		const script = cursorRemoveScript();
		assert.strictEqual(script.includes(OPENIDE_CURSOR_GLOBAL), true);
		assert.strictEqual(script.includes(`getElementById('${OPENIDE_CURSOR_HOST_ID}')`), true);
	});

	test('stripCursorHost saca el host y deja el contenido', () => {
		const html = `<html><body><h1>Hola</h1><div id="${OPENIDE_CURSOR_HOST_ID}" data-openide-overlay="cursor" style="position:fixed"></div></body></html>`;
		const clean = stripCursorHost(html);
		assert.strictEqual(clean.includes(OPENIDE_CURSOR_HOST_ID), false);
		assert.strictEqual(clean.includes('<h1>Hola</h1>'), true);
	});

	test('stripCursorHost no toca un html sin overlay', () => {
		const html = '<html><body><div id="app">contenido</div></body></html>';
		assert.strictEqual(stripCursorHost(html), html);
	});

	test('un id parecido del usuario no se borra', () => {
		const html = `<div id="${OPENIDE_CURSOR_HOST_ID}-propio">mío</div>`;
		assert.strictEqual(stripCursorHost(html).includes('mío'), true);
	});
});
