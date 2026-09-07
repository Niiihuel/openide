// Run with the built Electron binary after transpile-client. No model or CLI account is used.
// On Linux run `ulimit -c 0` first: the deliberate renderer crash must not wait for a core dump.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from '../vscode/out/vs/base/parts/ipc/electron-main/ipc.electron.js';
import { ProxyChannel } from '../vscode/out/vs/base/parts/ipc/common/ipc.js';
import { toDisposable } from '../vscode/out/vs/base/common/lifecycle.js';
import { OpenideIdeServerMain } from '../vscode/out/vs/platform/openideAgentHost/electron-main/openideIdeServerMain.js';
import { OpenideBrowserAutomationMainService } from '../vscode/out/vs/platform/openideBrowser/electron-main/openideBrowserAutomationMainService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-electron-bridge-'));
const windows = [];
const records = [];
const results = [];
const reportDirectory = path.join(root, '.build/fork-hardening/electron-bridge');
const log = { trace() {}, debug() {}, info() {}, warn() {}, error(...args) { console.error(...args); } };
const preload = path.join(temporary, 'preload.cjs');
const compiled = relative => JSON.stringify(pathToFileURL(path.join(root, 'vscode/out/vs', relative)).href);
fs.writeFileSync(preload, `
const { ipcRenderer, contextBridge } = require('electron');
(async () => {
 const [{ IPCClient }, { Emitter }, { VSBuffer }] = await Promise.all([
  import(${compiled('base/parts/ipc/common/ipc.js')}),
  import(${compiled('base/common/event.js')}),
  import(${compiled('base/common/buffer.js')})
 ]);
 const emitter = new Emitter();
 ipcRenderer.on('vscode:message', (_event, message) => emitter.fire(VSBuffer.wrap(message)));
 ipcRenderer.send('vscode:hello');
 const protocol = { onMessage: emitter.event, send: message => ipcRenderer.send('vscode:message', message.buffer) };
 // Both renderers deliberately serialize the same forged owner context.
 const client = new IPCClient(protocol, 'window:forged-owner');
 const channel = client.getChannel('openide-bridge-test');
 const requests = [];
 const preloadGeneration = require('node:crypto').randomUUID();
 let automatic = true;
 channel.listen('onDidRequestTool')(request => {
  requests.push(request);
  if (automatic) {
   channel.call('respondTool', [request.requestId, { content: [{ type: 'text', text: 'renderer:' + process.argv.find(arg => arg.startsWith('--test-label=')).slice(13) }] }]);
  }
 });
 contextBridge.exposeInMainWorld('bridge', {
  call: (command, ...args) => channel.call(command, args),
  requests: () => requests,
  generation: () => preloadGeneration,
  automatic: value => { automatic = value; },
  respond: requestId => channel.call('respondTool', [requestId, { content: [{ type: 'text', text: 'manual' }] }])
 });
})().catch(error => { console.error(error); });
`);

function bounded(promise, label, milliseconds = 10000) {
	let timer;
	return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds); })]).finally(() => clearTimeout(timer));
}
async function until(predicate, label) {
	await bounded((async () => {
		while (!await predicate()) { await new Promise(resolve => setTimeout(resolve, 20)); }
	})(), label);
}
const evaluate = (window, expression) => window.webContents.executeJavaScript(expression, true);
const call = (window, command, ...args) => bounded(evaluate(window, `bridge.call(${[command, ...args].map(value => JSON.stringify(value)).join(',')})`), command);
async function createWindow(label) {
	const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: false, nodeIntegration: false, additionalArguments: [`--test-label=${label}`] } });
	windows.push(window);
	window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) { console.error(`[renderer ${label}] ${message}`); } });
	await window.loadURL('about:blank');
	await until(() => evaluate(window, 'typeof bridge !== "undefined"'), `renderer ${label} preload`);
	return window;
}
let rpcCounter = 0;
async function request(info, method = 'tools/call', params = { name: 'getOpenEditors', arguments: {} }, token = info.authToken) {
	const response = await fetch(`http://127.0.0.1:${info.port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcCounter, method, params }), signal: AbortSignal.timeout(8000) });
	return { status: response.status, body: response.status === 200 ? await response.json() : undefined };
}
async function revoked(info) {
	try { assert.equal((await request(info, 'tools/list', {})).status, 401); }
	catch (error) { if (error instanceof assert.AssertionError) { throw error; } assert.ok(error.cause?.code === 'ECONNREFUSED' || error.cause?.code === 'UND_ERR_SOCKET', `Unexpected revocation error: ${error}`); }
}
async function check(name, task) {
	try { await task(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
	catch (error) { results.push({ name, passed: false, error: error.stack }); throw error; }
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
	const server = new Server();
	server.registerWindowChannel('openide-bridge-test', (sender, disposables) => {
		const bridge = disposables.add(new OpenideIdeServerMain(log));
		const record = { owner: sender.id, disposed: false, bridge };
		records.push(record);
		disposables.add(toDisposable(() => { record.disposed = true; }));
		return ProxyChannel.fromService({
			onDidRequestTool: bridge.onDidRequestTool,
			start: options => bridge.start(options),
			respondTool: (id, result) => bridge.respondTool(id, result),
			setExtraTools: tools => bridge.setExtraTools(tools),
			stop: () => bridge.stop(),
			owner: () => sender.id,
		}, disposables, { unbufferedEvents: ['onDidRequestTool'] });
	});
	let failure;
	try {
		const a = await createWindow('A'), b = await createWindow('B');
		const options = { ideName: 'OpenIDE test', workspaceFolders: [temporary], lockRootDir: temporary, publishLockfile: false };
		let infoA, infoB;
		await check('same workspace and forged context retain distinct Electron owners and credentials', async () => {
			assert.equal(await call(a, 'owner'), a.webContents.id);
			assert.equal(await call(b, 'owner'), b.webContents.id);
			[infoA, infoB] = await Promise.all([call(a, 'start', options), call(b, 'start', options)]);
			assert.notEqual(infoA.port, infoB.port);
			assert.notEqual(infoA.authToken, infoB.authToken);
			assert.equal((await request(infoA, 'tools/list', {}, infoB.authToken)).status, 401);
		});
		await check('each HTTP tool reaches only its owning renderer', async () => {
			assert.equal((await request(infoA)).body.result.content[0].text, 'renderer:A');
			assert.equal((await request(infoB)).body.result.content[0].text, 'renderer:B');
			assert.equal((await evaluate(a, 'bridge.requests()')).length, 1);
			assert.equal((await evaluate(b, 'bridge.requests()')).length, 1);
		});
		await check('foreign owner response cannot settle another renderer request', async () => {
			await evaluate(a, 'bridge.automatic(false)');
			const pending = request(infoA);
			await until(async () => (await evaluate(a, 'bridge.requests()')).length === 2, 'pending A request');
			const requestId = (await evaluate(a, 'bridge.requests()'))[1].requestId;
			await evaluate(b, `bridge.respond(${JSON.stringify(requestId)})`);
			let settled = false;
			pending.then(() => { settled = true; });
			await new Promise(resolve => setTimeout(resolve, 80));
			assert.equal(settled, false);
			await evaluate(a, `bridge.respond(${JSON.stringify(requestId)})`);
			assert.equal((await pending).body.result.content[0].text, 'manual');
		});
		await check('disposed browser owner cannot attach a delayed picker to a replacement preview', async () => {
			const http = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end('<html><body><button id="target">Target</button></body></html>'));
			await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
			const url = `http://127.0.0.1:${http.address().port}/`;
			const preview = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
			windows.push(preview);
			let releaseContents;
			const old = new OpenideBrowserAutomationMainService(b.webContents, () => new Promise(resolve => { releaseContents = resolve; }));
			let replacement;
			try {
				await preview.loadURL(url);
				const pending = old.pickInPage(url, [], 0);
				await until(() => !!releaseContents, 'delayed browser contents lookup');
				old.dispose();
				assert.deepEqual(await bounded(pending, 'disposed browser lookup'), { ok: false, cancelled: true });
				replacement = new OpenideBrowserAutomationMainService(b.webContents, async () => [preview.webContents]);
				const replacementPick = replacement.pickInPage(url, [], 0);
				await until(() => evaluate(preview, 'window.__openidePickInstalled === true'), 'replacement picker installation');
				const replacementId = await evaluate(preview, 'window.__openidePickOwner');
				releaseContents([preview.webContents]);
				await new Promise(resolve => setTimeout(resolve, 50));
				assert.equal(await evaluate(preview, 'window.__openidePickOwner'), replacementId);
				assert.equal(await evaluate(preview, 'window.__openidePickInstalled'), true);
				replacement.dispose();
				assert.deepEqual(await bounded(replacementPick, 'replacement picker disposal'), { ok: false, cancelled: true });
				await until(() => evaluate(preview, 'window.__openidePickInstalled !== true'), 'owned overlay cleanup');
				const count = BrowserWindow.getAllWindows().length;
				assert.equal((await old.navigate(url, [])).ok, false);
				assert.deepEqual(await old.pick(url, []), { ok: false, cancelled: true });
				assert.equal(BrowserWindow.getAllWindows().length, count);
			} finally {
				old.dispose(); replacement?.dispose();
				if (!preview.isDestroyed()) { preview.destroy(); }
				await new Promise(resolve => http.close(resolve));
			}
		});
		await check('disposing a browser owner destroys its visible picker and settles its request', async () => {
			const http = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>Picker</body></html>'));
			await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
			const browser = new OpenideBrowserAutomationMainService(b.webContents);
			try {
				const before = new Set(BrowserWindow.getAllWindows());
				const pending = browser.pick(`http://127.0.0.1:${http.address().port}/`, []);
				const picker = BrowserWindow.getAllWindows().find(window => !before.has(window));
				assert.ok(picker);
				windows.push(picker);
				await until(() => evaluate(picker, 'window.__openidePickInstalled === true'), 'visible picker installation');
				browser.dispose();
				assert.equal(picker.isDestroyed(), true);
				assert.deepEqual(await bounded(pending, 'visible picker disposal'), { ok: false, cancelled: true });
			} finally { browser.dispose(); await new Promise(resolve => http.close(resolve)); }
		});
		await check('closing A settles its pending HTTP call and keeps B operational', async () => {
			const pending = request(infoA);
			await until(async () => (await evaluate(a, 'bridge.requests()')).length === 3, 'A before close');
			const owner = a.webContents.id;
			a.destroy();
			assert.match((await pending).body.error.data, /stopping/);
			await until(() => records.some(record => record.owner === owner && record.disposed), 'A owner disposal');
			assert.equal((await request(infoB)).body.result.content[0].text, 'renderer:B');
			await revoked(infoA);
		});
		await check('reload disposes the old connection and rejects its stale endpoint', async () => {
			const previous = infoB;
			const generation = await evaluate(b, 'bridge.generation()');
			b.reload();
			await new Promise(resolve => b.webContents.once('did-finish-load', resolve));
			await until(() => evaluate(b, `typeof bridge !== "undefined" && bridge.generation() !== ${JSON.stringify(generation)}`), 'B reload preload');
			infoB = await call(b, 'start', options);
			assert.notEqual(infoB.authToken, previous.authToken);
			await revoked(previous);
			assert.equal((await request(infoB)).body.result.content[0].text, 'renderer:B');
		});
		await check('renderer process crash disposes its bridge and settles pending HTTP', async () => {
			await evaluate(b, 'bridge.automatic(false)');
			const pending = request(infoB);
			await until(async () => (await evaluate(b, 'bridge.requests()')).length === 2, 'B before crash');
			const gone = new Promise(resolve => b.webContents.once('render-process-gone', (_event, details) => { console.log('Renderer crash observed:', details.reason); resolve(); }));
			b.webContents.forcefullyCrashRenderer();
			await bounded(gone, 'Electron render-process-gone', 6000);
			assert.match((await pending).body.error.data, /stopping/);
			await until(() => records.every(record => record.disposed), 'all owner disposal');
			await revoked(infoB);
		});
	} catch (error) { failure = error; console.error(error); }
	finally {
		for (const window of windows) { if (!window.isDestroyed()) { window.destroy(); } }
		server.dispose();
		for (const record of records) { record.bridge.dispose(); }
		fs.mkdirSync(reportDirectory, { recursive: true });
		fs.writeFileSync(path.join(reportDirectory, 'results.json'), JSON.stringify({ platform: process.platform, electron: process.versions.electron, source: 'fresh compiled modules; real BrowserWindow renderers and loopback HTTP', limitations: 'Exercises production IPC and server with a test facade; does not launch the workbench dock or a third-party CLI.', results }, null, 2) + '\n');
		fs.rmSync(temporary, { recursive: true, force: true });
		app.exit(failure ? 1 : 0);
	}
}).catch(error => { console.error(error); app.exit(1); });
