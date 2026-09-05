// Run with the built Electron binary: tests import Electron main-process APIs.
import { app } from 'electron';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
process.env.MOCHA_COLORS = '1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'vscode/package.json'));
const Mocha = require('mocha');
app.whenReady().then(async () => {
	try {
		const mocha = new Mocha({ ui: 'tdd', timeout: 10000 });
		for (const name of ['abstractUpdateService', 'openideLinuxUpdateService', 'openideAppImageUpdater', 'updateRelaunchArguments', 'win32UpdateType']) {
			mocha.addFile(path.join(root, `vscode/out/vs/platform/update/test/electron-main/${name}.test.js`));
		}
		await mocha.loadFilesAsync();
		mocha.run(failures => app.exit(failures ? 1 : 0));
	} catch (error) {
		console.error(error);
		app.exit(1);
	}

});
