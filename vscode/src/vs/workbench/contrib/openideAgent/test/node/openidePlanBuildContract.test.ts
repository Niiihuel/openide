/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Build spinner switched off a few milliseconds after starting. The cause: whoever launches
 * the Build run first calls `cancelCurrentRun()` to close the previous run, and that function
 * called `failPlanBuild()` — which clears the SERVICE's state, not a local field. The previous
 * attempted fix saved and restored `this._planBuild` around the call, but that only restored
 * the field: the service had already forgotten the build, so the breadcrumb
 * went back to "Build" instantly and `finishPlanBuild` ended up a no-op (the plan never
 * llegaba a `status: completado`).
 *
 * OpenideChatView drags in half the workbench through its imports, so this is verified against
 * the source. It is exactly the same approach as openideSettingsContract: it does not test
 * runtime behaviour, it tests that the shape that broke it cannot come back without someone
 * lo note.
 */
suite('OpenIDE plan build contract', () => {

	const chatView = fs.readFileSync(path.join(__dirname, '..', '..', 'browser', 'openideChatView.ts'), 'utf8');
	const agentService = fs.readFileSync(path.join(__dirname, '..', '..', 'browser', 'openideAgentService.ts'), 'utf8');

	test('el turno TERMINA al guardar el plan: la decisión es del usuario', () => {
		// Without this cut the model received the plan_save result and kept working: it
		// started implementing without anyone pressing Build, until it hit the fact that plan mode
		// has no write tools. It looked as if the plan started by itself.
		const stop = agentService.slice(agentService.indexOf("if (call.name === 'plan_save'"));
		assert.strictEqual(stop.length > 0, true, 'falta el corte del turno tras plan_save');
		const block = stop.slice(0, 420);
		assert.strictEqual(/onEvent\(\{ type: 'done', reason: 'plan-saved' \}\)/.test(block), true, 'tiene que cerrar el turno');
		assert.strictEqual(/\breturn;/.test(block), true, 'y salir del loop, no sólo avisar');
		assert.strictEqual(block.includes("!out.startsWith('Error')"), true, 'un plan_save fallido no puede cerrar el turno');
	});

	test('cancelCurrentRun sólo aborta el Build cuando no le piden conservarlo', () => {
		const body = chatView.slice(chatView.indexOf('private cancelCurrentRun('), chatView.indexOf('private finishRun('));
		assert.strictEqual(body.includes('keepPlanBuild'), true, 'cancelCurrentRun debe aceptar conservar el Build en vuelo');
		assert.strictEqual(/if \(this\._planBuild && !options\?\.keepPlanBuild\)/.test(body), true, 'failPlanBuild tiene que quedar detrás de la guarda');
	});

	test('el save/restore de _planBuild alrededor de la cancelación no vuelve', () => {
		// The exact signature of the fix that fixed nothing.
		assert.strictEqual(/this\.cancelCurrentRun\(\);\s*\n\s*if \(planBuild\) \{ this\._planBuild = planBuild; \}/.test(chatView), false,
			'restaurar el campo local no recupera el estado del servicio: pasar keepPlanBuild');
	});

	test('todo lanzamiento de run conserva el Build al cancelar el run anterior', () => {
		const lines = chatView.split('\n');
		const launches = lines.map((line, index) => ({ line, index })).filter(entry => entry.line.includes('this.agentService.runMessages('));
		assert.strictEqual(launches.length >= 2, true, 'se esperaban los dos caminos de ejecución (handleSend y runExistingTurn)');
		for (const launch of launches) {
			const preceding = lines.slice(Math.max(0, launch.index - 14), launch.index).join('\n');
			assert.strictEqual(preceding.includes('cancelCurrentRun('), true, `sin cancelación previa cerca de la línea ${launch.index + 1}`);
			assert.strictEqual(/cancelCurrentRun\(\{ keepPlanBuild: true \}\)/.test(preceding), true,
				`la cancelación previa a la línea ${launch.index + 1} mata el Build que se está lanzando`);
		}
	});
});
