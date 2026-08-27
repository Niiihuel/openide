import { homedir } from 'os';
import { NativeParsedArgs } from '../common/argv.js';

import { resolve, isAbsolute, join } from 'path';

const cwd = process.env['VSCODE_CWD'] || process.cwd();

export function getUserStatePath(cliArgs: NativeParsedArgs, productName: string): string {
	const userStatePath = doGetUserStatePath(cliArgs, productName);
	const pathsToResolve = [userStatePath];

	if (!isAbsolute(userStatePath)) {
		pathsToResolve.unshift(cwd);
	}

	return resolve(...pathsToResolve);
}

function doGetUserStatePath(cliArgs: NativeParsedArgs, productName: string): string {

	// 0. Running out of sources has a fixed productName
	if (process.env['VSCODE_DEV']) {
		productName = 'code-oss-dev';
	}

	// 1. Support portable mode
	const portablePath = process.env['VSCODE_PORTABLE'];
	if (portablePath) {
		return join(portablePath, 'user-state');
	}

	// 2. Support global VSCODE_APPSTATE environment variable
	let appStatePath = process.env['VSCODE_APPSTATE'];
	if (appStatePath) {
		return join(appStatePath, productName);
	}

	// 4. Otherwise
	appStatePath = process.env['XDG_STATE_HOME'] || join(homedir(), '.local', 'state');

	return join(appStatePath, productName);
}
