#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(repository, 'vscode', 'out');
const surfaceModule = join(output, 'vs/workbench/contrib/openideAgent/browser/openideSurfaceCss.js');
const require = createRequire(join(repository, 'vscode/package.json'));
const ts = require('typescript');
const portArg = process.argv.find(arg => arg.startsWith('--port='));
const port = Number(portArg?.slice('--port='.length) ?? 9333);
const once = process.argv.includes('--once');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
	throw new Error('Use --port=<local Dev debugging port>, between 1024 and 65535.');
}
const log = message => process.stdout.write(`[css-reload] ${message}\n`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;
let socket;
const watchers = new Map();
const timers = new Map();
const pending = new Map();
let commandId = 0;
let sheets = new Map();
let generation = 0;
let lastSheetChange = 0;

function command(method, params = {}) {
	return new Promise((resolve, reject) => {
		if (socket?.readyState !== WebSocket.OPEN) { reject(new Error('Dev renderer is disconnected')); return; }
		const id = ++commandId;
		const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
		pending.set(id, { resolve, reject, timeout });
		socket.send(JSON.stringify({ id, method, params }));
	});
}

function sourceFile(sourceURL) {
	try {
		const url = new URL(sourceURL);
		if (url.protocol !== 'vscode-file:' || url.hostname !== 'vscode-app') { return; }
		const file = resolve(decodeURIComponent(url.pathname));
		const suffix = relative(output, file);
		if (!suffix.startsWith(`..${sep}`) && suffix !== '..' && !suffix.startsWith(sep) && file.endsWith('.css')) { return file; }
	} catch { /* Inline styles and extension documents have no source file in this checkout. */ }
}

/** Resolve only CSS literals and references to CSS constants; never execute workbench code. */
async function surfaceCss() {
	const source = ts.createSourceFile(surfaceModule, await readFile(surfaceModule, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
	if (source.parseDiagnostics.length) { throw new Error('Waiting for a valid compiled surface module'); }
	const constants = new Map();
	for (const statement of source.statements) {
		if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) { continue; }
		for (const declaration of statement.declarationList.declarations) {
			if (ts.isIdentifier(declaration.name) && /^OPENIDE_.*_(?:CSS|PATH)$/.test(declaration.name.text) && declaration.initializer) {
				constants.set(declaration.name.text, declaration.initializer);
			}
		}
	}
	const resolving = new Set();
	const resolveConstant = name => {
		if (!constants.has(name) || resolving.has(name)) { throw new Error(`Unknown or cyclic CSS constant: ${name}`); }
		resolving.add(name);
		const value = resolveExpression(constants.get(name));
		resolving.delete(name);
		return value;
	};
	const resolveExpression = expression => {
		if (ts.isNoSubstitutionTemplateLiteral(expression) || ts.isStringLiteral(expression)) { return expression.text; }
		if (ts.isIdentifier(expression)) { return resolveConstant(expression.text); }
		if (ts.isTemplateExpression(expression)) {
			return expression.head.text + expression.templateSpans.map(span => resolveExpression(span.expression) + span.literal.text).join('');
		}
		throw new Error('CSS reload supports only literals/templates of CSS constants. Use Reload Window for other module changes.');
	};
	return resolveConstant('OPENIDE_SURFACE_CSS');
}

async function update(sheetId, file, verify = false) {
	const text = file === surfaceModule ? await surfaceCss() : await readFile(file, 'utf8');
	await command('CSS.setStyleSheetText', { styleSheetId: sheetId, text });
	if (verify) {
		const result = await command('CSS.getStyleSheetText', { styleSheetId: sheetId });
		if (result.text !== text) { throw new Error(`Read-back mismatch: ${relative(output, file)}`); }
	}
}

async function registerSheet(header) {
	const currentGeneration = generation;
	let file = sourceFile(header.sourceURL);
	if (!file && header.ownerNode) {
		const { node } = await command('DOM.describeNode', { backendNodeId: header.ownerNode });
		const attrs = node.attributes ?? [];
		for (let i = 0; i < attrs.length; i += 2) {
			if (attrs[i] === 'id' && attrs[i + 1] === 'openide-surface-css') { file = surfaceModule; break; }
		}
	}
	if (!file || currentGeneration !== generation) { return; }
	sheets.set(header.styleSheetId, file);
	if (!once) { watchDirectory(dirname(file)); }
	// Newly mounted pages receive the latest compiled CSS even after a renderer reload.
	await update(header.styleSheetId, file);
}

async function changed(file) {
	const matches = [...sheets].filter(([, source]) => source === file);
	if (!matches.length) { return; }
	for (const [id] of matches) { await update(id, file, true); }
	log(`Updated and verified ${relative(output, file)} (${matches.length} sheet${matches.length === 1 ? '' : 's'})`);
}

function schedule(file) {
	clearTimeout(timers.get(file));
	timers.set(file, setTimeout(() => {
		timers.delete(file);
		changed(file).catch(error => log(`Waiting for next valid save: ${error.message}`));
	}, 150));
}

async function connect() {
	const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
	if (!response.ok) { throw new Error(`Dev endpoint returned ${response.status}`); }
	const expected = join(output, 'vs/code/electron-browser/workbench/workbench-dev.html');
	const targets = (await response.json()).filter(target => {
		if (target.type !== 'page') { return false; }
		try { const url = new URL(target.url); return url.protocol === 'vscode-file:' && url.hostname === 'vscode-app' && decodeURIComponent(url.pathname) === expected; }
		catch { return false; }
	});
	if (targets.length !== 1) { throw new Error(`Expected one Dev workbench from this checkout; found ${targets.length}. Use a dedicated debugging port.`); }
	const endpoint = new URL(targets[0].webSocketDebuggerUrl);
	if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' || Number(endpoint.port) !== port) {
		throw new Error('Refusing a non-local debugger endpoint.');
	}
	sheets = new Map();
	generation++;
	const registrations = new Set();
	socket = new WebSocket(endpoint);
	socket.addEventListener('message', event => {
		const message = JSON.parse(event.data);
		if (message.id) {
			const task = pending.get(message.id);
			if (!task) { return; }
			pending.delete(message.id); clearTimeout(task.timeout);
			if (message.error) { task.reject(new Error(message.error.message)); } else { task.resolve(message.result); }
		} else if (message.method === 'CSS.styleSheetAdded') {
			lastSheetChange = Date.now();
			const currentGeneration = generation;
			const task = registerSheet(message.params.header).catch(error => {
				if (currentGeneration === generation && !error.message.includes('No style sheet') && !error.message.includes('Could not find node')) { log(`Sheet not updated: ${error.message}`); }
			});
			registrations.add(task); task.finally(() => registrations.delete(task));
		} else if (message.method === 'CSS.styleSheetRemoved') {
			lastSheetChange = Date.now();
			sheets.delete(message.params.styleSheetId);
		} else if (message.method === 'DOM.documentUpdated') {
			generation++; sheets.clear(); lastSheetChange = Date.now();
		}
	});
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	await command('DOM.enable');
	await command('CSS.enable');
	await Promise.all([...registrations]);
	log(`Attached to ${targets[0].title}; ${sheets.size} local CSS sheets. No window reload.`);
	return { closed: new Promise(resolve => socket.addEventListener('close', () => {
		for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(new Error('Dev renderer disconnected')); }
		pending.clear(); resolve();
	}, { once: true })) };
}

function watchDirectory(directory) {
	if (watchers.has(directory)) { return; }
	watchers.set(directory, watch(directory, (_event, file) => {
		if (!file) { return; }
		const path = join(directory, String(file));
		if (path.endsWith('.css') || path === surfaceModule) { schedule(path); }
	}));
}

function stop() {
	stopping = true;
	for (const watcher of watchers.values()) { watcher.close(); }
	watchers.clear();
	for (const timer of timers.values()) { clearTimeout(timer); }
	timers.clear(); socket?.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

if (!once) {
	log('Watching loaded CSS directories. Keep dev/watch-workbench.mjs running for src → out. Ctrl+C stops CSS reload.');
}

let announced = false;
while (!stopping) {
	try {
		const { closed } = await connect();
		if (once) {
			const deadline = Date.now() + 15000;
			while (Date.now() < deadline && (!sheets.size || Date.now() - lastSheetChange < 300)) { await delay(100); }
			if (!sheets.size) { stop(); await closed; throw new Error('No local CSS sheets registered after 15 seconds; wait until the Dev workbench finishes loading.'); }
			for (const [id, file] of [...sheets]) { if (sheets.has(id)) { await update(id, file, true); } }
			log(`Verified ${sheets.size} loaded stylesheet contents against compiled files.`);
			stop(); await closed;
		} else {
			await closed; announced = false;
		}
	} catch (error) {
		if (once) { stop(); throw error; }
		if (!announced) { log(`Waiting for Dev: ${error.message}`); announced = true; }
	}
	if (!stopping) { await delay(1500); }
}
