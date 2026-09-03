import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateReliabilityRegistry } from './reliability-gates-lib.mjs';

function validGate() {
	return {
		id: 'sample-gate',
		owner: 'quality',
		layer: 'ci',
		maturity: 'soak',
		invariant: 'El comportamiento crítico permanece verificable.',
		platforms: ['linux'],
		commands: ['node --test'],
		tests: ['fixture.test.js'],
		knownGaps: ['Falta ampliar la matriz.'],
		promotionCriteria: ['El gate pasa sostenidamente.'],
		demotionRule: 'Un fallo reproducible bloquea el gate.',
	};
}

function withRoot(run) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-reliability-'));
	fs.writeFileSync(path.join(root, 'fixture.test.js'), '');
	try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('acepta un registry mínimo válido', () => withRoot(root => {
	assert.deepEqual(validateReliabilityRegistry({ schemaVersion: 1, gates: [validGate()] }, root), []);
}));

test('rechaza ids duplicados, campos desconocidos y rutas ausentes', () => withRoot(root => {
	const first = validGate(); first.unknown = true;
	const second = validGate(); second.tests = ['missing.test.js'];
	const errors = validateReliabilityRegistry({ schemaVersion: 1, gates: [first, second] }, root);
	assert.ok(errors.some(error => error.includes('campo no permitido')));
	assert.ok(errors.some(error => error.includes('Gate duplicado')));
	assert.ok(errors.some(error => error.includes('no existe')));
}));

test('rechaza paths inseguros y maturities desconocidos', () => withRoot(root => {
const gate = validGate(); gate.tests = ['../outside.test.js', 'C:\\outside.test.js', 'C:relative.test.js', '\\rooted.test.js', '\\\\server\\share\\test.js']; gate.maturity = 'stable';
	const errors = validateReliabilityRegistry({ schemaVersion: 1, gates: [gate] }, root);
	assert.ok(errors.filter(error => error.includes('ruta relativa segura')).length >= 5);
	assert.ok(errors.some(error => error.includes('maturity inválido')));
}));

test('un gate blocking no puede conservar criterios de promoción pendientes', () => withRoot(root => {
	const gate = validGate(); gate.maturity = 'blocking';
	const errors = validateReliabilityRegistry({ schemaVersion: 1, gates: [gate] }, root);
	assert.ok(errors.some(error => error.includes('promotionCriteria debe estar vacío')));
	gate.promotionCriteria = [];
	assert.deepEqual(validateReliabilityRegistry({ schemaVersion: 1, gates: [gate] }, root), []);
}));

test('rechaza directorios y symlinks que escapan del workspace', { skip: process.platform === 'win32' }, () => withRoot(root => {
	fs.mkdirSync(path.join(root, 'tests'));
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-reliability-outside-'));
	fs.writeFileSync(path.join(outside, 'outside.test.js'), '');
	fs.symlinkSync(path.join(outside, 'outside.test.js'), path.join(root, 'escaped.test.js'));
	try {
		const gate = validGate(); gate.tests = ['tests', 'escaped.test.js'];
		const errors = validateReliabilityRegistry({ schemaVersion: 1, gates: [gate] }, root);
		assert.ok(errors.some(error => error.includes('debe apuntar a un archivo')));
		assert.ok(errors.some(error => error.includes('sale del workspace')));
	} finally { fs.rmSync(outside, { recursive: true, force: true }); }
}));
