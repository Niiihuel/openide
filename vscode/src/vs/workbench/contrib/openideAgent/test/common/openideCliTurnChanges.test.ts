/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	OpenideCliTurnLog,
	parsePorcelainZ,
	MAX_TOUCHED_PER_TURN,
	OpenideTouchKind,
	turnBoundaryOf,
	turnFileStatusOf,
	turnFilesFromWatch,
} from '../../common/openideCliTurnChanges.js';

/** `git status --porcelain -z` output: NUL-separated, no trailing newline. */
function porcelain(...records: string[]): string {
	return records.join('\0') + '\0';
}

suite('OpenIDE — cambios de un CLI, por turno', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('parseo de porcelain -z', () => {
		test('lee código y ruta', () => {
			const records = parsePorcelainZ(porcelain(' M src/a.ts', '?? nuevo.md'));
			assert.deepEqual(records.map(r => [r.xy, r.path]), [[' M', 'src/a.ts'], ['??', 'nuevo.md']]);
		});

		test('una ruta con espacios y acentos sobrevive intacta', () => {
			// This is what -z is for: without it git quotes the path and it stops matching the file it names.
			const records = parsePorcelainZ(porcelain(' M src/mi año/notas de diseño.ts'));
			assert.equal(records[0].path, 'src/mi año/notas de diseño.ts');
		});

		test('el origen de un rename se consume, no se lee como otro registro', () => {
			// Read as a record of its own, it would invent a status code out of the first two bytes
			// of a path.
			const records = parsePorcelainZ(porcelain('R  nuevo.ts', 'viejo.ts', ' M otro.ts'));
			assert.equal(records.length, 2);
			assert.equal(records[0].path, 'nuevo.ts');
			assert.equal(records[0].from, 'viejo.ts');
			assert.equal(records[1].path, 'otro.ts');
		});

		test('salida vacía no rompe', () => {
			assert.deepEqual(parsePorcelainZ(''), []);
			assert.deepEqual(parsePorcelainZ('\0'), []);
		});

		test('los códigos se traducen a lo que le importa a la vista', () => {
			assert.equal(turnFileStatusOf('??'), 'untracked');
			assert.equal(turnFileStatusOf('A '), 'added');
			assert.equal(turnFileStatusOf(' D'), 'deleted');
			assert.equal(turnFileStatusOf('R '), 'renamed');
			assert.equal(turnFileStatusOf(' M'), 'modified');
			assert.equal(turnFileStatusOf('MM'), 'modified');
		});
	});

	suite('la lista del turno: el watcher dice cuáles, git dice de qué tipo', () => {
		const touched = (...pairs: [string, OpenideTouchKind][]) => new Map(pairs);

		test('una EDICIÓN se ve aunque el código de git no cambie', () => {
			// The bug all of this exists for: editing does not change the porcelain. An untracked file
			// is `??` before and after; a modified one is ` M` before and after the second edit. Diffing
			// status snapshots only ever sees transitions, so an agent that keeps working on a file it
			// had already touched produced an empty turn — which reads as "nothing changed".
			const records = parsePorcelainZ(porcelain('?? prueba.md'));
			const files = turnFilesFromWatch(touched(['prueba.md', 'updated']), records);
			assert.deepEqual(files.map(f => [f.path, f.status]), [['prueba.md', 'untracked']]);
		});

		test('lo que el agente no tocó no entra, por sucio que esté el repo', () => {
			// A repository with uncommitted work is the normal case; listing all of it as the agent's
			// makes the view useless exactly where the work is happening.
			const records = parsePorcelainZ(porcelain(' M mio.ts', ' M agente.ts'));
			const files = turnFilesFromWatch(touched(['agente.ts', 'updated']), records);
			assert.deepEqual(files.map(f => f.path), ['agente.ts']);
		});

		test('un archivo que volvió a quedar como HEAD no deja fila', () => {
			// The agent wrote it and undid it: a row that opens an identical diff spends the reader's
			// attention for nothing.
			assert.deepEqual(turnFilesFromWatch(touched(['a.ts', 'updated']), []), []);
		});

		test('un untracked borrado sí deja fila, aunque git no lo mencione', () => {
			assert.deepEqual(
				turnFilesFromWatch(touched(['tmp.ts', 'deleted']), []).map(f => [f.path, f.status]),
				[['tmp.ts', 'deleted']],
			);
		});

		test('el rename conserva de dónde vino', () => {
			const records = parsePorcelainZ(porcelain('R  nuevo.ts', 'viejo.ts'));
			const files = turnFilesFromWatch(touched(['nuevo.ts', 'updated']), records);
			assert.deepEqual(files.map(f => [f.status, f.from]), [['renamed', 'viejo.ts']]);
		});
	});

	suite('límites de turno', () => {
		test('entrar a in-progress abre y salir cierra', () => {
			assert.equal(turnBoundaryOf('needs-input', 'in-progress'), 'begin');
			assert.equal(turnBoundaryOf('in-progress', 'needs-input'), 'end');
			assert.equal(turnBoundaryOf('in-progress', 'completed'), 'end');
			assert.equal(turnBoundaryOf('in-progress', 'failed'), 'end');
		});

		test('quedarse en el mismo estado no es un límite', () => {
			assert.equal(turnBoundaryOf('in-progress', 'in-progress'), undefined);
			assert.equal(turnBoundaryOf('needs-input', 'completed'), undefined);
		});
	});

	suite('bitácora de la sesión', () => {

		test('cada turno se queda con lo que se tocó DENTRO de él', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('a.ts', 'updated');
			const first = log.end(parsePorcelainZ(porcelain(' M a.ts')), 2000)!;
			assert.deepEqual(first.files.map(f => f.path), ['a.ts']);
			assert.equal(first.ordinal, 1);

			log.begin(3000, true);
			log.touch('b.ts', 'updated');
			const second = log.end(parsePorcelainZ(porcelain(' M a.ts', ' M b.ts')), 4000)!;
			// a.ts is still dirty, but nobody touched it in THIS turn: it belongs to the first one.
			assert.deepEqual(second.files.map(f => f.path), ['b.ts']);
			assert.equal(second.ordinal, 2);
		});

		test('un cambio FUERA de un turno se ignora', () => {
			// Between turns the one editing is the user, and crediting that to the agent is exactly the
			// mistake this file exists to prevent.
			const log = new OpenideCliTurnLog('s1');
			log.touch('mio.ts', 'updated');
			log.begin(1000, true);
			const turn = log.end(parsePorcelainZ(porcelain(' M mio.ts')), 2000)!;
			assert.deepEqual(turn.files, []);
		});

		test('creado y después editado sigue contando como creado', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('nuevo.ts', 'added');
			log.touch('nuevo.ts', 'updated');
			assert.deepEqual(log.touchedPaths(), ['nuevo.ts']);
			const turn = log.end(parsePorcelainZ(porcelain('?? nuevo.ts')), 2000)!;
			assert.equal(turn.files.length, 1);
		});

		test('un archivo creado y borrado en el mismo turno no deja fila', () => {
			// Scratch the agent wrote and cleaned up itself: nothing was left on disk, so there is
			// nothing to review or undo. These used to show up as `D` — files that never existed.
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('.agents', 'added');
			log.touch('.agents', 'deleted');
			assert.deepEqual(log.touchedPaths(), []);
			assert.deepEqual(log.end([], 2000)!.files, []);
		});

		test('un archivo que YA existía y el agente borró sí deja fila', () => {
			// The difference that matters: here something really was lost.
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('viejo.ts', 'deleted');
			assert.deepEqual(log.end([], 2000)!.files.map(f => [f.path, f.status]), [['viejo.ts', 'deleted']]);
		});

		test('creado, borrado y creado de nuevo vuelve a contar', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('a.ts', 'added');
			log.touch('a.ts', 'deleted');
			log.touch('a.ts', 'added');
			assert.deepEqual(log.touchedPaths(), ['a.ts']);
		});

		test('reabrir mientras hay un turno abierto no lo parte en dos', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.begin(1500, true);
			assert.equal(log.all.length, 1);
		});

		test('cerrar sin turno abierto no inventa uno', () => {
			const log = new OpenideCliTurnLog('s1');
			assert.equal(log.end([], 2000), undefined);
			assert.deepEqual(log.all, []);
		});

		test('un turno desbocado se corta y lo dice', () => {
			// A build or an install touches thousands of files; remembering all of them helps nobody,
			// but truncating silently reads as "the agent touched exactly these".
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			for (let index = 0; index < MAX_TOUCHED_PER_TURN + 50; index++) {
				log.touch(`f${index}.ts`, 'updated');
			}
			assert.equal(log.touchedPaths().length, MAX_TOUCHED_PER_TURN);
			assert.equal(log.end([], 2000)!.truncated, true);
		});

		test('la vista de sesión no repite un archivo tocado en varios turnos', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('a.ts', 'updated');
			log.end(parsePorcelainZ(porcelain(' M a.ts')), 2000);
			log.begin(3000, true);
			log.touch('a.ts', 'updated');
			log.touch('b.ts', 'updated');
			log.end(parsePorcelainZ(porcelain(' M a.ts', ' M b.ts')), 4000);
			assert.deepEqual(log.sessionFiles().map(f => f.path), ['a.ts', 'b.ts']);
		});

		test('la sesión lista lo más reciente primero', () => {
			// It is what the panel shows: a file the agent touched just now matters more than one
			// from five responses ago, and it has to be readable without scrolling.
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('viejo.ts', 'updated');
			log.end(parsePorcelainZ(porcelain(' M viejo.ts')), 2000);
			log.begin(3000, true);
			log.touch('nuevo.ts', 'updated');
			log.end(parsePorcelainZ(porcelain(' M viejo.ts', ' M nuevo.ts')), 4000);
			assert.deepEqual(log.sessionFiles().map(f => f.path), ['nuevo.ts', 'viejo.ts']);
		});

		test('un archivo tocado de nuevo sube, no se duplica', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('a.ts', 'updated');
			log.touch('b.ts', 'updated');
			log.end(parsePorcelainZ(porcelain(' M a.ts', ' M b.ts')), 2000);
			log.begin(3000, true);
			log.touch('a.ts', 'updated');
			log.end(parsePorcelainZ(porcelain(' M a.ts', ' M b.ts')), 4000);
			assert.deepEqual(log.sessionFiles().map(f => f.path), ['a.ts', 'b.ts']);
		});

		test('un turno abierto se ve como abierto', () => {
			const log = new OpenideCliTurnLog('s1');
			assert.equal(log.isOpen, false);
			log.begin(1000, false);
			assert.equal(log.isOpen, true);
			assert.equal(log.all[0].endedAt, undefined);
		});

		test('el turno recuerda si su límite vino de hooks o de la heurística', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, false);
			assert.equal(log.all[0].hooked, false);
		});
	});
});
