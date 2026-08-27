/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OPENIDE_PICK_STYLE_PROPS } from '../../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import {
	formatLength,
	hasStyleEdits,
	OPENIDE_STYLE_CAPTURE_PROPS,
	OPENIDE_STYLE_GROUPS,
	OPENIDE_STYLE_PROPERTIES,
	parseComputedStyles,
	parseLength,
	styleDiffCss,
	styleProperty,
	stylePropertiesOf,
} from '../../common/openideStyleModel.js';

suite('OpenIDE style model', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the catalog is internally consistent', () => {
		const ids = new Set<string>();
		for (const property of OPENIDE_STYLE_PROPERTIES) {
			assert.strictEqual(ids.has(property.id), false, `propiedad duplicada: ${property.id}`);
			ids.add(property.id);
			// A group that is not declared would render into nothing.
			assert.strictEqual(OPENIDE_STYLE_GROUPS.some(group => group.id === property.group), true, property.id);
			// A choice control with no choices is an empty dropdown.
			if (property.control === 'choice') {
				assert.strictEqual((property.choices?.length ?? 0) > 0, true, property.id);
			}
			if (property.control === 'length') {
				assert.strictEqual((property.units?.length ?? 0) > 0, true, property.id);
			}
			assert.strictEqual(styleProperty(property.id), property);
		}
		// Every group has to render something, or it is a header over a void.
		for (const group of OPENIDE_STYLE_GROUPS) {
			assert.strictEqual(stylePropertiesOf(group.id).length > 0, true, group.id);
		}
		assert.deepStrictEqual([...OPENIDE_STYLE_CAPTURE_PROPS], OPENIDE_STYLE_PROPERTIES.map(p => p.id));
	});

	test('every editable property is actually captured by the picker', () => {
		// The picker's list lives in platform/ (electron-main injects it and cannot import a
		// workbench module). If the two drift, the panel renders a control for a property whose
		// value never arrives — an input that silently shows nothing and writes over the real value
		// the moment it is touched. This is the only thing keeping them honest.
		const captured = new Set(OPENIDE_PICK_STYLE_PROPS);
		const missing = OPENIDE_STYLE_PROPERTIES.map(property => property.id).filter(id => !captured.has(id));
		assert.deepStrictEqual(missing, [], 'propiedades editables que el picker no captura');
		const unused = [...captured].filter(id => !OPENIDE_STYLE_PROPERTIES.some(property => property.id === id));
		assert.deepStrictEqual(unused, [], 'propiedades capturadas que nadie edita');
	});

	test('parseComputedStyles keeps values that contain a colon', () => {
		const parsed = parseComputedStyles([
			'color: rgb(255, 0, 0);',
			'background-image: url(http://localhost:3000/a.png);',
			'font-size: 14px',            // sin punto y coma final
			'   ',                        // línea vacía
			'sin-dos-puntos',             // basura
			': 12px',                     // propiedad vacía
		].join('\n'));
		assert.strictEqual(parsed.get('color'), 'rgb(255, 0, 0)');
		assert.strictEqual(parsed.get('background-image'), 'url(http://localhost:3000/a.png)');
		assert.strictEqual(parsed.get('font-size'), '14px');
		assert.strictEqual(parsed.has('sin-dos-puntos'), false);
		assert.strictEqual(parsed.size, 3);
		// Nunca tira, ni con basura ni con vacío.
		assert.strictEqual(parseComputedStyles('').size, 0);
	});

	test('parseLength splits number from unit and refuses keywords', () => {
		assert.deepStrictEqual(parseLength('12px'), { amount: 12, unit: 'px' });
		assert.deepStrictEqual(parseLength('1.5rem'), { amount: 1.5, unit: 'rem' });
		assert.deepStrictEqual(parseLength('-4px'), { amount: -4, unit: 'px' });
		assert.deepStrictEqual(parseLength('50%'), { amount: 50, unit: '%' });
		// Un número pelado es px, que es lo que el usuario quiere decir al tipear "8".
		assert.deepStrictEqual(parseLength('8'), { amount: 8, unit: 'px' });
		// Keywords NO son longitudes: convertirlas en 0 destruiría el valor.
		assert.strictEqual(parseLength('auto'), undefined);
		assert.strictEqual(parseLength('normal'), undefined);
		assert.strictEqual(parseLength('calc(100% - 4px)'), undefined);
		assert.strictEqual(parseLength(undefined), undefined);
	});

	test('formatLength trims the noise off a dragged value', () => {
		assert.strictEqual(formatLength(12, 'px'), '12px');
		assert.strictEqual(formatLength(1.5, 'rem'), '1.5rem');
		assert.strictEqual(formatLength(1.23456, 'px'), '1.235px');
	});

	test('styleDiffCss emits only what changed', () => {
		const original = parseComputedStyles('color: rgb(0, 0, 0);\npadding-top: 8px;\nfont-size: 14px;');
		const edited = new Map(original);
		assert.strictEqual(styleDiffCss(original, edited), '');
		assert.strictEqual(hasStyleEdits(original, edited), false);

		edited.set('padding-top', '16px');
		assert.strictEqual(styleDiffCss(original, edited), 'padding-top: 16px');
		assert.strictEqual(hasStyleEdits(original, edited), true);

		// Una propiedad nueva (no estaba en el computado) también es un cambio.
		edited.set('gap', '4px');
		assert.strictEqual(styleDiffCss(original, edited), 'padding-top: 16px; gap: 4px');
	});

	test('styleDiffCss ignores whitespace-only differences and empty values', () => {
		const original = parseComputedStyles('color: rgb(255, 0, 0);');
		const edited = new Map(original);
		// Mismo color, otro espaciado: NO es una edición.
		edited.set('color', 'rgb(255,0,0)');
		assert.strictEqual(styleDiffCss(original, edited), '');
		edited.set('color', 'RGB(255, 0, 0)');
		assert.strictEqual(styleDiffCss(original, edited), '');
		// Vaciar un campo no debe emitir una declaración rota.
		edited.set('color', '   ');
		assert.strictEqual(styleDiffCss(original, edited), '');
		// Un color realmente distinto sí.
		edited.set('color', 'rgb(0, 0, 255)');
		assert.strictEqual(styleDiffCss(original, edited), 'color: rgb(0, 0, 255)');
	});
});
