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

	test('anuncia la conexión y nombra el proveedor', () => {
		const html = getOpenideOauthPage({ provider: 'Claude' });
		assert.strictEqual(html.includes('Conectaste Claude'), true);
		assert.strictEqual(html.includes('Ya podés cerrar esta pestaña'), true);
	});

	test('sin proveedor cae en el mensaje genérico', () => {
		assert.strictEqual(getOpenideOauthPage().includes('Cuenta conectada'), true);
	});

	test('el estado de error explica qué pasó', () => {
		const html = getOpenideOauthPage({ failed: true, detail: 'access_denied' });
		assert.strictEqual(html.includes('No se completó la conexión'), true);
		assert.strictEqual(html.includes('access_denied'), true);
		assert.strictEqual(html.includes('Sin conectar'), true);
	});

	test('el detalle del proveedor no puede inyectar HTML', () => {
		const html = getOpenideOauthPage({ failed: true, detail: '<img src=x onerror=alert(1)>' });
		assert.strictEqual(html.includes('<img src=x'), false);
		assert.strictEqual(html.includes('&lt;img src=x'), true);
	});

	test('el nombre del proveedor tampoco puede inyectar HTML', () => {
		const html = getOpenideOauthPage({ provider: '<script>alert(1)</script>' });
		assert.strictEqual(html.includes('<script>alert(1)'), false);
	});

	test('el logo va suelto: ni borde, ni sombra, ni recuadro', () => {
		const html = getOpenideOauthPage();
		const mark = html.slice(html.indexOf('.mark {'), html.indexOf('.mark svg'));
		assert.strictEqual(/border\s*:/.test(mark), false, 'el logo no lleva borde');
		assert.strictEqual(/box-shadow\s*:/.test(mark), false, 'el logo no lleva sombra');
		assert.strictEqual(/border-radius\s*:/.test(mark), false, 'el logo no lleva recuadro redondeado');
	});

	test('el estado es texto plano: sin pill ni punto de color', () => {
		const html = getOpenideOauthPage();
		const state = html.slice(html.indexOf('.state {'), html.indexOf('</style>'));
		assert.strictEqual(/border\s*:/.test(state), false);
		assert.strictEqual(/border-radius\s*:/.test(state), false);
		assert.strictEqual(html.includes('class="dot"'), false, 'el punto de color se fue con la pill');
	});

	test('declara los dos temas del sistema', () => {
		const html = getOpenideOauthPage();
		assert.strictEqual(html.includes('prefers-color-scheme: dark'), true);
		assert.strictEqual(html.includes('content="light dark"'), true);
	});

	test('no pide un solo recurso externo', () => {
		const html = getOpenideOauthPage({ provider: 'ChatGPT' });
		assert.strictEqual(/src="http/.test(html), false);
		assert.strictEqual(/href="http/.test(html), false);
	});
});
