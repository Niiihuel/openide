/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { getOpenideOauthPage } from '../../common/openideOauthPage.js';

/**
 * The OAuth return page is opened by the system browser: it inherits nothing from the IDE, so
 * everything visible has to be in the HTML. These tests cover what would break silently: that
 * the detail sent by the provider cannot inject markup, and that the logo stays a bare logo
 * rather than a boxed badge.
 */
suite('OpenIDE OAuth page', () => {

	test('announces the connection and names the provider', () => {
		const html = getOpenideOauthPage({ provider: 'Claude' });
		assert.strictEqual(html.includes('Conectaste Claude'), true);
		assert.strictEqual(html.includes('Ya podés cerrar esta pestaña'), true);
	});

	test('with no provider it falls back to the generic message', () => {
		assert.strictEqual(getOpenideOauthPage().includes('Cuenta conectada'), true);
	});

	test('the error state explains what happened', () => {
		const html = getOpenideOauthPage({ failed: true, detail: 'access_denied' });
		assert.strictEqual(html.includes('No se completó la conexión'), true);
		assert.strictEqual(html.includes('access_denied'), true);
		assert.strictEqual(html.includes('Sin conectar'), true);
	});

	test('the provider detail cannot inject HTML', () => {
		const html = getOpenideOauthPage({ failed: true, detail: '<img src=x onerror=alert(1)>' });
		assert.strictEqual(html.includes('<img src=x'), false);
		assert.strictEqual(html.includes('&lt;img src=x'), true);
	});

	test('the provider name cannot inject HTML either', () => {
		const html = getOpenideOauthPage({ provider: '<script>alert(1)</script>' });
		assert.strictEqual(html.includes('<script>alert(1)'), false);
	});

	test('the logo stands alone: no border, no shadow, no box', () => {
		const html = getOpenideOauthPage();
		const mark = html.slice(html.indexOf('.mark {'), html.indexOf('.mark svg'));
		assert.strictEqual(/border\s*:/.test(mark), false, 'the logo carries no border');
		assert.strictEqual(/box-shadow\s*:/.test(mark), false, 'the logo carries no shadow');
		assert.strictEqual(/border-radius\s*:/.test(mark), false, 'the logo carries no rounded box');
	});

	test('the state is plain text: no pill, no colored dot', () => {
		const html = getOpenideOauthPage();
		const state = html.slice(html.indexOf('.state {'), html.indexOf('</style>'));
		assert.strictEqual(/border\s*:/.test(state), false);
		assert.strictEqual(/border-radius\s*:/.test(state), false);
		assert.strictEqual(html.includes('class="dot"'), false, 'the colored dot went away with the pill');
	});

	test('declares both system themes', () => {
		const html = getOpenideOauthPage();
		assert.strictEqual(html.includes('prefers-color-scheme: dark'), true);
		assert.strictEqual(html.includes('content="light dark"'), true);
	});

	test('does not request a single external resource', () => {
		const html = getOpenideOauthPage({ provider: 'ChatGPT' });
		assert.strictEqual(/src="http/.test(html), false);
		assert.strictEqual(/href="http/.test(html), false);
	});
});
