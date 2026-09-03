/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { planSlug, readPlanDraft } from '../../common/openidePlanDraft.js';

/**
 * The draft is read from JSON that has NOT CLOSED YET: the arguments of `plan_save` arrive as
 * provider deltas. If this reader gets it wrong, the editor skeleton shows garbage or stays
 * empty for the whole stream — and there is no way to notice except watching a real plan being
 * written, which is exactly what cannot be reproduced on demand.
 */
suite('OpenIDE plan draft', () => {

	test('it reads the title and the markdown out of a complete JSON', () => {
		const d = readPlanDraft('{"title":"Analisis de precios","markdown":"# Hola\\n\\n## Contexto"}');
		assert.strictEqual(d.title, 'Analisis de precios');
		assert.strictEqual(d.markdown, '# Hola\n\n## Contexto');
		assert.strictEqual(d.markdownComplete, true);
	});

	test('it reads the markdown out of a JSON cut in half', () => {
		const d = readPlanDraft('{"title":"Plan","markdown":"# Plan\\n\\nEl proyecto ya mues');
		assert.strictEqual(d.title, 'Plan');
		assert.strictEqual(d.markdown, '# Plan\n\nEl proyecto ya mues');
		assert.strictEqual(d.markdownComplete, false, 'the string never closed: content is still missing');
	});

	test('the markdown key has not arrived yet', () => {
		const d = readPlanDraft('{"title":"Plan a');
		assert.strictEqual(d.title, 'Plan a');
		assert.strictEqual(d.markdown, '');
		assert.strictEqual(d.markdownComplete, false);
	});

	test('a half-written title is marked incomplete (the file name comes from it)', () => {
		// Opening the editor with a half-written title would point at a uri that is not the one later
		// written: the skeleton would be left in an orphaned tab.
		const aMedias = readPlanDraft('{"title":"Analisis de Prec');
		assert.strictEqual(aMedias.title, 'Analisis de Prec');
		assert.strictEqual(aMedias.titleComplete, false);

		const cerrado = readPlanDraft('{"title":"Analisis de Precios","markdown":"# ');
		assert.strictEqual(cerrado.title, 'Analisis de Precios');
		assert.strictEqual(cerrado.titleComplete, true);
	});

	test('empty or garbage JSON does not break', () => {
		for (const entrada of ['', '{', '{"', 'null', '[]', '{"otra":"cosa"}']) {
			const d = readPlanDraft(entrada);
			assert.strictEqual(d.markdown, '', `entrada: ${JSON.stringify(entrada)}`);
			assert.strictEqual(d.markdownComplete, false);
		}
	});

	test('it decodes escaped quotes, backslashes and newlines', () => {
		const d = readPlanDraft('{"markdown":"dijo \\"hola\\" y C:\\\\tmp\\ty\\nsigue"}');
		assert.strictEqual(d.markdown, 'dijo "hola" y C:\\tmp\ty\nsigue');
		assert.strictEqual(d.markdownComplete, true);
	});

	test('an escape cut off at the end is discarded until the rest arrives', () => {
		// The delta split right in the middle of \n — emitting the lone backslash would dirty the render.
		const parcial = readPlanDraft('{"markdown":"linea\\');
		assert.strictEqual(parcial.markdown, 'linea');
		// With the next delta the escape completes and the line break appears.
		const completo = readPlanDraft('{"markdown":"linea\\n2');
		assert.strictEqual(completo.markdown, 'linea\n2');
	});

	test('a half-arrived \\uXXXX is not emitted half-way either', () => {
		assert.strictEqual(readPlanDraft('{"markdown":"caf\\u00e').markdown, 'caf');
		assert.strictEqual(readPlanDraft('{"markdown":"caf\\u00e9 listo').markdown, 'café listo');
	});

	test('the word "markdown" INSIDE the plan does not confuse the reader', () => {
		// The plan talks about the plan: the text contains the word, and even the quoted sequence.
		const json = '{"title":"Plan","markdown":"Guardar el \\"markdown\\": completo en el .md"}';
		const d = readPlanDraft(json);
		assert.strictEqual(d.markdown, 'Guardar el "markdown": completo en el .md');
	});

	test('the order of the keys does not matter', () => {
		const d = readPlanDraft('{"markdown":"cuerpo","title":"Titulo"}');
		assert.strictEqual(d.title, 'Titulo');
		assert.strictEqual(d.markdown, 'cuerpo');
	});

	test('the slug matches the one savePlan uses to name the file', () => {
		// If they diverge, the editor opened with the skeleton is NOT the file later written.
		const comoSavePlan = (title: string) => title.trim().toLowerCase().normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '').slice(0, 64) || 'plan';
		for (const title of [
			'Análisis de Precios: modelos y fórmulas',
			'  espacios  raros  ',
			'¿¡Símbolos!?',
			'',
			'a'.repeat(120),
		]) {
			assert.strictEqual(planSlug(title), comoSavePlan(title), `title: ${JSON.stringify(title)}`);
		}
	});

	test('the markdown grows monotonically, delta after delta', () => {
		// Key streaming property: what is already shown is never rewritten, only appended to.
		const completo = '{"title":"Plan","markdown":"# T\\n\\nUno\\ndos \\"tres\\"\\ncuatro"}';
		let anterior = '';
		for (let corte = 1; corte <= completo.length; corte++) {
			const actual = readPlanDraft(completo.slice(0, corte)).markdown;
			assert.ok(actual.startsWith(anterior) || anterior.startsWith(actual),
				`not monotonic at cut ${corte}: ${JSON.stringify(anterior)} -> ${JSON.stringify(actual)}`);
			if (actual.length >= anterior.length) { anterior = actual; }
		}
		assert.strictEqual(anterior, '# T\n\nUno\ndos "tres"\ncuatro');
	});
});
