#!/usr/bin/env node
// A controllable local CLI for real PTY tests. It never contacts a model provider.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const directory = process.env.OPENIDE_FIXTURE_DIRECTORY;
const workspace = process.env.OPENIDE_FIXTURE_WORKSPACE;
if (!directory || !workspace || path.resolve(process.cwd()) !== path.resolve(workspace)) {
	throw new Error('This fixture requires an explicit disposable control directory and workspace.');
}
fs.mkdirSync(directory, { recursive: true });
const generation = randomUUID();
const state = { generation, pid: process.pid, sessionId: process.env.OPENIDE_SESSION_ID, tty: !!process.stdin.isTTY, columns: process.stdout.columns, rows: process.stdout.rows, input: '', writes: 0, mcp: undefined, commands: {} };
const activeMcp = new Map();
const save = () => {
	const file = path.join(directory, `${generation}.json`);
	fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
	fs.renameSync(`${file}.tmp`, file);
};
const output = text => process.stdout.write(`\r\nOPENIDE_FIXTURE ${text}\r\n`);
process.stdout.on('resize', () => { state.columns = process.stdout.columns; state.rows = process.stdout.rows; save(); });
process.stdin.on('data', chunk => { state.input += String(chunk); save(); output('INPUT'); });
if (process.stdin.isTTY) { process.stdin.setRawMode(true); }
process.stdin.resume();
save(); output('READY');
const timer = setInterval(async () => {
	const file = path.join(directory, `${generation}.command.json`);
	if (!fs.existsSync(file)) { return; }
	let mcp;
	const command = JSON.parse(fs.readFileSync(file, 'utf8'));
	fs.rmSync(file);
	try {
		switch (command.action) {
			case 'write':
				fs.writeFileSync(path.join(workspace, 'fixture.txt'), String(command.content)); state.writes++; break;
			case 'mcp': {
				const endpoint = process.argv.find(arg => /mcp_servers\..*\.url=/.test(arg));
				const tokenName = process.argv.find(arg => /mcp_servers\..*\.bearer_token_env_var=/.test(arg));
				if (!endpoint || !tokenName) { throw new Error('No launch-scoped MCP configuration.'); }
				const url = JSON.parse(endpoint.slice(endpoint.indexOf('=') + 1));
				const variable = JSON.parse(tokenName.slice(tokenName.indexOf('=') + 1));
				const parsed = new URL(url);
				if (parsed.hostname !== '127.0.0.1') { throw new Error('Only loopback MCP is permitted.'); }
				const controller = new AbortController();
				activeMcp.set(command.id, controller);
				state.activeMcpCommand = command.id; save();
				try {
					const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${process.env[variable]}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: command.id, method: command.tool ? 'tools/call' : 'tools/list', params: command.tool ? { name: command.tool, arguments: command.arguments ?? {} } : {} }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(command.timeoutMs ?? 10000, 30000))]) });
					const body = await response.json();
					mcp = { status: response.status, toolCount: body.result?.tools?.length ?? 0, ...(command.tool ? { body } : {}) };
					state.mcp = mcp;
				} finally { activeMcp.delete(command.id); }
				break;
			}
			case 'cancel': activeMcp.get(command.requestId)?.abort(); break;
			case 'hook': {
				const hookDirectory = process.env.OPENIDE_FIXTURE_HOOK_DIRECTORY;
				if (!hookDirectory) { throw new Error('An explicit disposable hook directory is required.'); }
				fs.mkdirSync(hookDirectory, { recursive: true });
				const hook = path.join(hookDirectory, `${generation}-${randomUUID()}.json`);
				fs.writeFileSync(`${hook}.tmp`, JSON.stringify({ openideSessionId: state.sessionId, payload: { hook_event_name: command.event ?? 'Stop' } }));
				fs.renameSync(`${hook}.tmp`, hook); break;
			}
			case 'exit': state.exited = true; save(); clearInterval(timer); process.exit(Number(command.code ?? 0)); break;
			default: throw new Error(`Unknown fixture action: ${command.action}`);
		}
		state.lastCommand = { id: command.id, action: command.action, ok: true, ...(mcp ? { mcp } : {}) };
	} catch (error) { state.lastCommand = { id: command.id, action: command.action, ok: false, error: error.message }; }
	state.commands[command.id] = state.lastCommand;
	save(); output(command.action.toUpperCase());
}, 30);
