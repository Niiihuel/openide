#!/usr/bin/env node
/**
 * Every script a workflow runs as `./path.sh` must be executable in git.
 *
 * `dev/publish-update-feed.sh` was committed 100644. Nothing noticed until the release reached its
 * very last step -- after four platforms had built, 54 assets had uploaded and three update
 * manifests had been signed -- and died with:
 *
 *   ./dev/publish-update-feed.sh: Permission denied
 *   Process completed with exit code 126
 *
 * Two things made it hide for so long. It is the last step of the last job, so nothing before it
 * ever touched the file. And `dev/sign-windows.sh` had the same missing bit yet ran fine, because
 * Git Bash on Windows ignores the mode -- so the Windows jobs passed while the Linux one could not.
 *
 * The permission bit is invisible in a diff and survives review. A check is cheaper than finding
 * out at the end of an hour-long release again.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const WORKFLOW_DIR = '.github/workflows';

/** `./dev/foo.sh` or `./foo.sh` -- the form that needs the bit. `bash foo.sh` does not. */
const INVOCATION = /(?:^|[\s;&|(])\.\/([A-Za-z0-9._\-/]+\.(?:sh|mjs|js))/g;

function gitMode(file) {
	try {
		const out = execFileSync('git', ['ls-files', '-s', '--', file], { encoding: 'utf8' }).trim();
		return out ? out.split(/\s+/)[0] : undefined;
	} catch {
		return undefined;
	}
}

const problems = [];
const checked = new Set();

for (const name of readdirSync(WORKFLOW_DIR)) {
	if (!/\.ya?ml$/.test(name)) { continue; }
	const file = path.join(WORKFLOW_DIR, name);
	const text = readFileSync(file, 'utf8');

	for (const match of text.matchAll(INVOCATION)) {
		const script = match[1];
		const key = `${file}::${script}`;
		if (checked.has(key)) { continue; }
		checked.add(key);

		const mode = gitMode(script);
		if (mode === undefined) {
			// Not tracked: either generated at build time or a path this regex misread. Either way
			// there is no mode to check, and guessing would only add noise.
			continue;
		}
		if (mode !== '100755') {
			problems.push({ workflow: name, script, mode });
		}
	}
}

if (problems.length > 0) {
	console.error('Scripts invoked as ./path but not executable in git:\n');
	for (const { workflow, script, mode } of problems) {
		console.error(`  ${script}  (mode ${mode}, run by ${workflow})`);
	}
	console.error('\nFix with:');
	console.error(`  git update-index --chmod=+x ${problems.map(p => p.script).join(' ')}`);
	console.error('\nA missing bit fails at run time with exit code 126, and on Linux only --');
	console.error('Git Bash on Windows ignores the mode, so Windows jobs pass while Linux does not.');
	process.exit(1);
}

console.log(`Script permissions: OK (${checked.size} invocations checked)`);
