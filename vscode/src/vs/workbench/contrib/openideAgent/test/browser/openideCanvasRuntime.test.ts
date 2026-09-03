/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { getOpenideCanvasHtml } from '../../browser/openideCanvasHtml.js';
import { openideCanvasRuntimeMain } from '../../browser/openideCanvasRuntime.js';

/**
 * The canvas runtime is embedded by serializing `openideCanvasRuntimeMain` with toString(). It
 * used to live as text inside a TypeScript template literal, where a backtick closed the
 * literal and backslashes were consumed silently: `\s` became `s`, so
 * `split(/\s+/)` split class names at the letter "s" and nobody noticed until it
 * failed on screen. These tests pin that contract so the class of error cannot come back.
 */
suite('OpenIDE canvas runtime', () => {

	function runtimeScript(state: unknown = {}): string {
		const html = getOpenideCanvasHtml('nonce123', undefined, [], state);
		const scripts = [...html.matchAll(/<script nonce="nonce123">([\s\S]*?)<\/script>/g)].map(match => match[1]);
		assert.strictEqual(scripts.length >= 2, true, 'the html has to carry the state and the runtime in separate scripts');
		return scripts[1];
	}

	test('embeds the runtime as serialized code, not as an interpolated string', () => {
		const script = runtimeScript();
		assert.strictEqual(script.includes('acquireVsCodeApi'), true);
		assert.strictEqual(script.includes('${'), false, 'the runtime can no longer depend on host interpolations');
	});

	test('keeps regex escapes intact', () => {
		const script = runtimeScript();
		// The exact signature of the bug: if the escaping is lost, this becomes /s+/.
		assert.strictEqual(/split\(\/\\s\+\//.test(script), true, 'the \\s of the regular expressions have to survive');
		assert.strictEqual(script.includes('split(/s+/'), false, 'a lost backslash turns \\s into the letter s');
	});

	test('passes the initial state through the agreed global, not through the code', () => {
		const html = getOpenideCanvasHtml('nonce123', undefined, [], { abierto: true });
		assert.strictEqual(html.includes('globalThis.__openideCanvasState={"abierto":true}'), true);
		assert.strictEqual(runtimeScript({ abierto: true }).includes('"abierto":true'), false, 'the state is not injected inside the runtime');
	});

	test('stays self-contained so toString() can serialize it', () => {
		const source = openideCanvasRuntimeMain.toString();
		// A module import would be out of scope when serializing: the runtime runs in the iframe.
		assert.strictEqual(/\brequire\(/.test(source), false);
		assert.strictEqual(source.includes('import '), false);
	});

	test('creates SVG in the SVG namespace', () => {
		// The bug that meant canvas charts never rendered: createElement leaves the
		// <svg> in the XHTML namespace and the browser does not paint it.
		const script = runtimeScript();
		assert.strictEqual(script.includes('createElementNS'), true);
		assert.strictEqual(script.includes('http://www.w3.org/2000/svg'), true);
	});

	test('forwards identity props so Design Mode can build semantic selectors', () => {
		const script = runtimeScript();
		assert.strictEqual(script.includes('function ident'), true);
		assert.strictEqual(/data-/.test(script), true);
	});

	test('escapes closing script tags in the canvas payload', () => {
		const html = getOpenideCanvasHtml('nonce123', 'const x = "</script><script>alert(1)</script>";', [], {});
		assert.strictEqual(html.includes('"</script><script>alert(1)'), false, 'the canvas code cannot close the host script');
	});
});
