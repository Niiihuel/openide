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
	turnFilesFromWatchOnly,
	pathspecBatches,
	GIT_PATHSPEC_BATCH,
} from '../../common/openideCliTurnChanges.js';

/** `git status --porcelain -z` output: NUL-separated, no trailing newline. */
function porcelain(...records: string[]): string {
	return records.join('\0') + '\0';
}

suite('OpenIDE — a CLI\'s changes, per turn', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('porcelain -z parsing', () => {
		test('it reads the code and the path', () => {
			const records = parsePorcelainZ(porcelain(' M src/a.ts', '?? nuevo.md'));
			assert.deepEqual(records.map(r => [r.xy, r.path]), [[' M', 'src/a.ts'], ['??', 'nuevo.md']]);
		});

		test('a path with spaces and accents survives intact', () => {
			// This is what -z is for: without it git quotes the path and it stops matching the file it names.
			const records = parsePorcelainZ(porcelain(' M src/mi año/notas de diseño.ts'));
			assert.equal(records[0].path, 'src/mi año/notas de diseño.ts');
		});

		test('a rename\'s origin is consumed, not read as another record', () => {
			// Read as a record of its own, it would invent a status code out of the first two bytes
			// of a path.
			const records = parsePorcelainZ(porcelain('R  nuevo.ts', 'viejo.ts', ' M otro.ts'));
			assert.equal(records.length, 2);
			assert.equal(records[0].path, 'nuevo.ts');
			assert.equal(records[0].from, 'viejo.ts');
			assert.equal(records[1].path, 'otro.ts');
		});

		test('empty output does not break', () => {
			assert.deepEqual(parsePorcelainZ(''), []);
			assert.deepEqual(parsePorcelainZ('\0'), []);
		});

		test('the codes translate into what the view cares about', () => {
			assert.equal(turnFileStatusOf('??'), 'untracked');
			assert.equal(turnFileStatusOf('A '), 'added');
			assert.equal(turnFileStatusOf(' D'), 'deleted');
			assert.equal(turnFileStatusOf('R '), 'renamed');
			assert.equal(turnFileStatusOf(' M'), 'modified');
			assert.equal(turnFileStatusOf('MM'), 'modified');
		});
	});

	suite('the turn\'s list: the watcher says which files, git says of what kind', () => {
		const touched = (...pairs: [string, OpenideTouchKind][]) => new Map(pairs);

		test('an EDIT shows up even when git\'s code does not change', () => {
			// The bug all of this exists for: editing does not change the porcelain. An untracked file
			// is `??` before and after; a modified one is ` M` before and after the second edit. Diffing
			// status snapshots only ever sees transitions, so an agent that keeps working on a file it
			// had already touched produced an empty turn — which reads as "nothing changed".
			const records = parsePorcelainZ(porcelain('?? prueba.md'));
			const files = turnFilesFromWatch(touched(['prueba.md', 'updated']), records);
			assert.deepEqual(files.map(f => [f.path, f.status]), [['prueba.md', 'untracked']]);
		});

		test('what the agent did not touch stays out, however dirty the repo is', () => {
			// A repository with uncommitted work is the normal case; listing all of it as the agent's
			// makes the view useless exactly where the work is happening.
			const records = parsePorcelainZ(porcelain(' M mio.ts', ' M agente.ts'));
			const files = turnFilesFromWatch(touched(['agente.ts', 'updated']), records);
			assert.deepEqual(files.map(f => f.path), ['agente.ts']);
		});

		test('a file that ended up matching HEAD again leaves no row', () => {
			// The agent wrote it and undid it: a row that opens an identical diff spends the reader's
			// attention for nothing.
			assert.deepEqual(turnFilesFromWatch(touched(['a.ts', 'updated']), []), []);
		});

		test('a deleted untracked file does leave a row, even though git never mentions it', () => {
			assert.deepEqual(
				turnFilesFromWatch(touched(['tmp.ts', 'deleted']), []).map(f => [f.path, f.status]),
				[['tmp.ts', 'deleted']],
			);
		});

		test('a rename keeps where it came from', () => {
			const records = parsePorcelainZ(porcelain('R  nuevo.ts', 'viejo.ts'));
			const files = turnFilesFromWatch(touched(['nuevo.ts', 'updated']), records);
			assert.deepEqual(files.map(f => [f.status, f.from]), [['renamed', 'viejo.ts']]);
		});
	});

	suite('turn boundaries', () => {
		test('entering in-progress opens and leaving it closes', () => {
			assert.equal(turnBoundaryOf('needs-input', 'in-progress'), 'begin');
			assert.equal(turnBoundaryOf('in-progress', 'needs-input'), 'end');
			assert.equal(turnBoundaryOf('in-progress', 'completed'), 'end');
			assert.equal(turnBoundaryOf('in-progress', 'failed'), 'end');
		});

		test('staying in the same state is not a boundary', () => {
			assert.equal(turnBoundaryOf('in-progress', 'in-progress'), undefined);
			assert.equal(turnBoundaryOf('needs-input', 'completed'), undefined);
		});
	});

	suite('the session log', () => {

		test('each turn keeps what was touched INSIDE it', () => {
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

		test('a file the repo ignores is not listed even if the watcher saw it', () => {
			const records = parsePorcelainZ(porcelain('!! .next/BUILD_ID', ' M src/a.ts'));
			const files = turnFilesFromWatch(new Map<string, OpenideTouchKind>([['.next/BUILD_ID', 'added'], ['src/a.ts', 'updated']]), records);
			assert.deepEqual(files.map(f => [f.path, f.status]), [['src/a.ts', 'modified']]);
		});

		test('an ignored file that no longer exists is not listed either, with or without git', () => {
			const touched = new Map<string, OpenideTouchKind>([['.next/chunk.js', 'deleted'], ['src/a.ts', 'updated']]);
			const ignored = new Set(['.next/chunk.js']);
			assert.deepEqual(turnFilesFromWatch(touched, parsePorcelainZ(porcelain(' M src/a.ts')), ignored).map(f => f.path), ['src/a.ts']);
			assert.deepEqual(turnFilesFromWatchOnly(touched, ignored).map(f => f.path), ['src/a.ts']);
			assert.deepEqual(turnFilesFromWatch(touched, [], undefined).map(f => f.path), ['.next/chunk.js']);
		});

		test('pathspecs go out in batches that fit the host\'s argv ceiling', () => {
			const paths = Array.from({ length: 123 }, (_, i) => `f${i}.ts`);
			const batches = pathspecBatches(paths);
			assert.strictEqual(batches.length, 3);
			assert.ok(batches.every(batch => batch.length <= GIT_PATHSPEC_BATCH));
			assert.ok(GIT_PATHSPEC_BATCH + 6 <= 64, 'the batch plus the fixed arguments has to fit in 64');
			assert.deepEqual(batches.flat(), paths);
			assert.deepEqual(pathspecBatches([]), []);
		});

		test('a change made OUTSIDE a turn is ignored', () => {
			// Between turns the one editing is the user, and crediting that to the agent is exactly the
			// mistake this file exists to prevent.
			const log = new OpenideCliTurnLog('s1');
			log.touch('mio.ts', 'updated');
			log.begin(1000, true);
			const turn = log.end(parsePorcelainZ(porcelain(' M mio.ts')), 2000)!;
			assert.deepEqual(turn.files, []);
		});

		test('created and then edited still counts as created', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('nuevo.ts', 'added');
			log.touch('nuevo.ts', 'updated');
			assert.deepEqual(log.touchedPaths(), ['nuevo.ts']);
			const turn = log.end(parsePorcelainZ(porcelain('?? nuevo.ts')), 2000)!;
			assert.equal(turn.files.length, 1);
		});

		test('a file created and deleted within the same turn leaves no row', () => {
			// Scratch the agent wrote and cleaned up itself: nothing was left on disk, so there is
			// nothing to review or undo. These used to show up as `D` — files that never existed.
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('.agents', 'added');
			log.touch('.agents', 'deleted');
			assert.deepEqual(log.touchedPaths(), []);
			assert.deepEqual(log.end([], 2000)!.files, []);
		});

		test('a file that ALREADY existed and the agent deleted does leave a row', () => {
			// The difference that matters: here something really was lost.
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('viejo.ts', 'deleted');
			assert.deepEqual(log.end([], 2000)!.files.map(f => [f.path, f.status]), [['viejo.ts', 'deleted']]);
		});

		test('created, deleted and created again counts once more', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.touch('a.ts', 'added');
			log.touch('a.ts', 'deleted');
			log.touch('a.ts', 'added');
			assert.deepEqual(log.touchedPaths(), ['a.ts']);
		});

		test('reopening while a turn is already open does not split it in two', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, true);
			log.begin(1500, true);
			assert.equal(log.all.length, 1);
		});

		test('closing with no turn open does not invent one', () => {
			const log = new OpenideCliTurnLog('s1');
			assert.equal(log.end([], 2000), undefined);
			assert.deepEqual(log.all, []);
		});

		test('a runaway turn is truncated, and says so', () => {
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

		test('the session view does not repeat a file touched across several turns', () => {
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

		test('the session lists the most recent first', () => {
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

		test('a file touched again moves up instead of being duplicated', () => {
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

		test('an open turn reads as open', () => {
			const log = new OpenideCliTurnLog('s1');
			assert.equal(log.isOpen, false);
			log.begin(1000, false);
			assert.equal(log.isOpen, true);
			assert.equal(log.all[0].endedAt, undefined);
		});

		test('the turn remembers whether its boundary came from hooks or from the heuristic', () => {
			const log = new OpenideCliTurnLog('s1');
			log.begin(1000, false);
			assert.equal(log.all[0].hooked, false);
		});
	});
});

suite('Openide CLI turn changes — without git', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the watcher\'s verdict is translated into the view\'s vocabulary', () => {
		const touched = new Map<string, OpenideTouchKind>([['b.ts', 'updated'], ['a.ts', 'added'], ['c.ts', 'deleted']]);
		assert.deepStrictEqual(turnFilesFromWatchOnly(touched), [
			{ path: 'a.ts', status: 'untracked' },
			{ path: 'b.ts', status: 'modified' },
			{ path: 'c.ts', status: 'deleted' },
		]);
	});

	test('closing a turn with no answer from git does NOT say "nothing changed"', () => {
		const log = new OpenideCliTurnLog('s');
		log.begin(1, true);
		log.touch('src/x.ts', 'updated');
		const closed = log.end(undefined, 2)!;
		assert.deepStrictEqual(closed.files, [{ path: 'src/x.ts', status: 'modified' }]);
	});

	test('with git, an empty answer still means "everything went back to HEAD"', () => {
		const log = new OpenideCliTurnLog('s');
		log.begin(1, true);
		log.touch('src/x.ts', 'updated');
		assert.deepStrictEqual(log.end([], 2)!.files, []);
	});
});
