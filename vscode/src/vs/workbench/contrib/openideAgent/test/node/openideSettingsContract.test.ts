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
 * A setting declared in the schema is a promise to the user: it appears in Settings, it can be
 * configured, and it is expected to do something. This test enforces that.
 *
 * It was born from two real defects found during an audit:
 *   - `openide.agent.maxAgentIterations` had `default: 120` in the schema and a different
 *       DEFAULT_AGENT_ITERATIONS constant in the code. Since getValue returns the schema's
 *       default, the constant was never applied: raising it had no effect at all.
 *   - `openide.agent.usage.pollMinutes` was declared and documented, but NOBODY read it:
 *       configuring it did absolutely nothing, with no way to notice.
 */
suite('OpenIDE settings contract', () => {

	// This suite reads the .ts SOURCES (it is a static contract over the repo, not over the build),
	// so it must resolve `src/` even though at runtime it executes from the transpiled `out/` tree.
	// It lives under test/node because it needs fs/path — the browser runner has neither, and the
	// node runner excludes test/browser, which is how it silently stopped running at all.
	const compiledDir = import.meta.dirname;
	const sourceDir = compiledDir.replace(`${path.sep}out${path.sep}`, `${path.sep}src${path.sep}`);
	const contribRoot = path.join(sourceDir, '..', '..', 'browser');
	const sourceRoot = path.join(sourceDir, '..', '..', '..', '..', '..');

	function readAllSources(dir: string, out: string[] = []): string[] {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) { readAllSources(full, out); }
			else if (entry.name.endsWith('.ts')) { out.push(full); }
		}
		return out;
	}

	/**
	 * The whole tree, walked and read ONCE.
	 *
	 * Both tests below need every `.ts` under `src/vs` — about 7,600 files. Doing that per test read
	 * the tree twice and pushed the suite against mocha's 10s timeout: it passed on a warm local
	 * disk and timed out on CI, which is the worst shape a test can have, because the failure looks
	 * like a flake and gets re-run instead of read.
	 */
	let cachedSources: { file: string; text: string }[] | undefined;
	function allSources(): { file: string; text: string }[] {
		cachedSources ??= readAllSources(sourceRoot).map(file => ({ file, text: fs.readFileSync(file, 'utf8') }));
		return cachedSources;
	}

	function declaredSettings(): { key: string; def: string }[] {
		const contribution = fs.readFileSync(path.join(contribRoot, 'openideAgent.contribution.ts'), 'utf8');
		const settings: { key: string; def: string }[] = [];
		const re = /'(openide\.[a-zA-Z0-9.]+)':\s*\{([\s\S]*?)\n\t\t\}/g;
		let match: RegExpExecArray | null;
		while ((match = re.exec(contribution))) {
			const body = match[2];
			const def = body.match(/\bdefault:\s*([^,\n]+)/);
			settings.push({ key: match[1], def: def ? def[1].trim() : '' });
		}
		return settings;
	}

	test('every declared setting is read somewhere', () => {
		const settings = declaredSettings();
		assert.strictEqual(settings.length > 0, true, 'el escaneo del schema no encontró settings');
		const sources = allSources()
			.filter(entry => !entry.file.endsWith('openideAgent.contribution.ts') && !entry.file.endsWith('openideSettingsContract.test.ts'))
			.map(entry => entry.text)
			.join('\n');
		const huerfanos = settings.filter(setting => !sources.includes(setting.key)).map(setting => setting.key);
		assert.deepStrictEqual(huerfanos, [], 'settings declarados que nadie lee (o los implementás, o los sacás)');
	});

	test('numeric defaults are not duplicated with a different value in code', () => {
		// The dangerous pattern: getValue('key') ... || N  /  ?? N with N different from the schema's.
		const settings = declaredSettings().filter(setting => /^-?\d+$/.test(setting.def));
		const sources = allSources().filter(entry => !entry.file.endsWith('openideAgent.contribution.ts'));
		const conflictos: string[] = [];
		for (const setting of settings) {
			for (const { file, text } of sources) {
				let index = text.indexOf(setting.key);
				while (index >= 0) {
					const after = text.slice(index + setting.key.length, index + setting.key.length + 90);
					const fallback = after.match(/\)\s*(?:\?\?|\|\|)\s*(-?\d+)/);
					if (fallback && fallback[1] !== setting.def) {
						conflictos.push(`${setting.key}: schema=${setting.def} código=${fallback[1]} (${path.basename(file)})`);
					}
					index = text.indexOf(setting.key, index + 1);
				}
			}
		}
		assert.deepStrictEqual(conflictos, [], 'el default del schema y el del código deben coincidir: getValue devuelve el del schema');
	});
});
