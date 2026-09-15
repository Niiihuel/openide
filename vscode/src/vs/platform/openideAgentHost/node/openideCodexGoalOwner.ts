/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, execFile, spawn } from 'child_process';
import { mkdtemp, realpath, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { isAbsolute, join, relative } from 'path';
import { promisify } from 'util';
import type * as wsTypes from 'ws';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { IOpenideCodexGoalConnection, IOpenideCodexGoalEvent, IOpenideCodexGoalPrepare, IOpenideCodexGoalResult } from '../common/openideCodexGoal.js';
import { OpenideCodexGoalConnection } from './openideCodexGoalConnection.js';

interface IOwner {
	readonly child: ChildProcess;
	readonly directory: string;
	readonly socket: wsTypes.WebSocket;
	readonly connection: OpenideCodexGoalConnection;
	readonly subscriptions: DisposableStore;
	readonly endpoint: string;
}
interface IFrame { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } }
const execute = promisify(execFile);

/** A private Codex server per owned TTY; never attaches to the user's shared daemon. */
export class OpenideCodexGoalOwner extends Disposable {
	private readonly changed = this._register(new Emitter<IOpenideCodexGoalEvent>());
	readonly onDidChange = this.changed.event;
	private readonly sessions = new Map<string, IOwner>();
	private readonly preparing = new Set<string>();
	private roots: readonly string[] = [];
	private stopped = false;
	private generation = 0;
	private readonly sessionGenerations = new Map<string, number>();
	constructor(private readonly environment: () => Promise<NodeJS.ProcessEnv>) { super(); }
	async setWorkspace(roots: readonly string[]): Promise<void> {
		if (JSON.stringify(this.roots) === JSON.stringify(roots)) { return; }
		this.generation++; this.roots = [...roots];
		await Promise.all([...this.sessions.keys()].map(id => this.close(id)));
	}

	async prepare(input: IOpenideCodexGoalPrepare, developerInstructions?: string): Promise<IOpenideCodexGoalConnection> {
		if (this.stopped || this.preparing.has(input.sessionId) || !/^[a-zA-Z0-9_-]{1,256}$/.test(input.sessionId) || !isAbsolute(input.executable)) { throw new Error('Codex structured session is unavailable.'); }
		const previous = this.sessions.get(input.sessionId);
		if (previous?.connection.isConnected) { return { endpoint: previous.endpoint, threadId: previous.connection.threadId }; }
		if (previous) { await this.close(input.sessionId); }
		if (process.platform === 'win32') { throw new Error('This Codex structured adapter requires a Unix socket. Use manual CLI tracking on this platform.'); }
		this.preparing.add(input.sessionId);
		const generation = this.generation;
		const sessionGeneration = this.sessionGenerations.get(input.sessionId) ?? 0;
		const isCurrent = () => generation === this.generation && sessionGeneration === (this.sessionGenerations.get(input.sessionId) ?? 0);
		let stage = 'workspace';
		let directory: string | undefined, child: ChildProcess | undefined, socket: wsTypes.WebSocket | undefined, subscriptions: DisposableStore | undefined;
		try {
			const cwd = await realpath(input.cwd);
			const roots = await Promise.all(this.roots.map(root => realpath(root)));
			if (!roots.some(root => { const rel = relative(root, cwd); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); })) { throw new Error('Codex goal workspace is outside this window.'); }
			stage = 'environment';
			const env = { ...await this.environment(), ...input.env };
			stage = 'capability help';
			const help = await execute(input.executable, ['--help'], { env, timeout: 5000, maxBuffer: 160000 });
			const serverHelp = await execute(input.executable, ['app-server', '--help'], { env, timeout: 5000, maxBuffer: 160000 });
			if (!help.stdout.includes('--remote') || !serverHelp.stdout.includes('unix://')) { throw new Error('The installed Codex does not advertise the required structured transport.'); }
			stage = 'private server';
			directory = await mkdtemp(join(tmpdir(), 'oid-cdx-'));
			const socketPath = join(directory, 'rpc.sock');
			const endpoint = `unix://${socketPath}`;
			if (!isCurrent() || this.stopped) { throw new Error('Workspace changed during Codex startup.'); }
			child = spawn(input.executable, [...input.configurationArgs, 'app-server', '--listen', endpoint], { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] });
			// Consume diagnostics without logging credential-bearing launch configuration.
			child.stderr?.on('data', () => {});
			let exited = false; child.once('exit', () => { exited = true; }); child.once('error', () => { exited = true; });
			const deadline = Date.now() + 15000;
			while (Date.now() < deadline && !exited && !this.stopped && isCurrent()) {
				try { if ((await stat(socketPath)).isSocket()) { break; } } catch { /* not listening yet */ }
				await new Promise(resolve => setTimeout(resolve, 25));
			}
			if (exited || this.stopped || !isCurrent() || Date.now() >= deadline || ((await stat(socketPath)).mode & 0o077) !== 0) { throw new Error('Codex did not open a private control socket.'); }
			stage = 'websocket';
			const { default: WebSocket } = await import('ws');
			socket = new WebSocket(`ws+unix://${socketPath}:/`, { perMessageDeflate: false, maxPayload: 4 * 1024 * 1024, handshakeTimeout: 5000 });
			const ws = socket;
			await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
			let id = 0;
			const pending = new Map<number, { resolve: (result: unknown) => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
			const send = (frame: IFrame) => { if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(frame)); } };
			const request = (method: string, params: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
				if (ws.readyState !== WebSocket.OPEN) { reject(new Error('Codex connection is closed.')); return; }
				const requestId = ++id;
				const fail = () => reject(new Error(`Codex request failed: ${method}`));
				const timer = setTimeout(() => { pending.delete(requestId); fail(); }, 15000);
				pending.set(requestId, { resolve, reject: fail, timer }); send({ id: requestId, method, params });
			});
			let connection: OpenideCodexGoalConnection | undefined;
			const close = () => {
				for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(); } pending.clear();
				connection?.disconnect();
			};
			ws.on('close', close); ws.on('error', close); child.once('exit', close);
			ws.on('message', bytes => {
				let frame: IFrame;
				try { frame = JSON.parse(bytes.toString()) as IFrame; } catch { ws.close(); return; }
				if (!frame || typeof frame !== 'object') { ws.close(); return; }
				if (!frame.method && typeof frame.id === 'number') {
					const entry = pending.get(frame.id); if (!entry) { return; }
					pending.delete(frame.id); clearTimeout(entry.timer);
					if (frame.error) { entry.reject(); } else { entry.resolve(frame.result); }
				} else { connection?.accept(frame); }
			});
			stage = 'initialize';
			await request('initialize', { clientInfo: { name: 'openide_goal', version: '1.0.0' }, capabilities: { experimentalApi: true } });
			send({ method: 'initialized', params: {} });
			stage = 'thread';
			const context = developerInstructions === undefined ? {} : { developerInstructions };
			const resumed = await request(input.providerSessionId ? 'thread/resume' : 'thread/start', { ...(input.providerSessionId ? { threadId: input.providerSessionId } : {}), cwd, ...context }) as { thread?: { id?: string; cwd?: string } };
			if (!resumed.thread?.id || resumed.thread.cwd !== cwd) { throw new Error('Codex did not confirm this workspace and thread.'); }
			if (!input.providerSessionId) {
				// Codex does not materialize a new idle thread's rollout at thread/start.
				// Naming and resuming it is the native persistence barrier before TUI attach.
				await request('thread/name/set', { threadId: resumed.thread.id, name: 'OpenIDE' });
				await request('thread/resume', { threadId: resumed.thread.id, ...context });
			}
			stage = 'goal capabilities';
			const goalState = await request('thread/goal/get', { threadId: resumed.thread.id }) as { goal?: unknown };
			const backgroundState = await request('thread/backgroundTerminals/list', { threadId: resumed.thread.id, limit: 1 }) as { data?: unknown[] };
			const threadState = await request('thread/read', { threadId: resumed.thread.id, includeTurns: false }) as { thread?: { status?: { type?: string } } };
			if (!goalState || !('goal' in goalState) || !Array.isArray(backgroundState.data) || !threadState.thread?.status?.type) { throw new Error('Codex goal capabilities were not confirmed.'); }
			connection = new OpenideCodexGoalConnection(input.sessionId, resumed.thread.id, { request, respond: (wireId, result) => send({ id: wireId, result }), deny: wireId => send({ id: wireId, error: { code: -32601, message: 'This request requires manual interaction in Codex.' } }) });
			subscriptions = new DisposableStore();
			subscriptions.add(connection); subscriptions.add(connection.onDidChange(event => { this.changed.fire(event); if (event.kind === 'disconnected') { void this.close(input.sessionId); } }));
			if (this.stopped || !isCurrent()) { throw new Error('Codex owner disconnected during startup.'); }
			this.sessions.set(input.sessionId, { child, directory, socket: ws, connection, subscriptions, endpoint });
			return { endpoint, threadId: connection.threadId };
		} catch (error) {
			console.warn(`[OpenIDE Codex] Structured startup failed at ${stage}.`);
			subscriptions?.dispose(); socket?.terminate();
			if (child) {
				child.kill(); const hostedProcess = child;
				const timer = setTimeout(() => hostedProcess.kill('SIGKILL'), 2000); 
				hostedProcess.once('exit', () => clearTimeout(timer));
			}
			if (directory) { await rm(directory, { recursive: true, force: true }); }
			throw new Error(error instanceof Error && error.message.startsWith('The installed Codex') ? error.message : `The structured Codex connection could not be verified (${stage}); manual CLI tracking remains available.`);
		} finally { this.preparing.delete(input.sessionId); }
	}
	run(sessionId: string, runId: string, prompt: string): Promise<IOpenideCodexGoalResult> {
		const owner = this.sessions.get(sessionId); if (!owner) { throw new Error('No structured Codex connection for this session.'); }
		if (!runId || !prompt || prompt.length > 128000) { throw new Error('Invalid Codex goal turn.'); }
		return owner.connection.start(runId, prompt);
	}
	interrupt(sessionId: string, runId: string): Promise<void> { return this.sessions.get(sessionId)?.connection.interrupt(runId) ?? Promise.resolve(); }
	respond(sessionId: string, approvalId: string, accepted: boolean): void { const owner = this.sessions.get(sessionId); if (!owner) { throw new Error('Codex session closed.'); } owner.connection.respond(approvalId, accepted); }
	async close(sessionId: string): Promise<void> {
		this.sessionGenerations.set(sessionId, (this.sessionGenerations.get(sessionId) ?? 0) + 1);
		const owner = this.sessions.get(sessionId); if (!owner) { return; }
		this.sessions.delete(sessionId); owner.subscriptions.dispose(); owner.socket.terminate(); owner.child.kill();
		const timer = setTimeout(() => owner.child.kill('SIGKILL'), 2000);
		owner.child.once('exit', () => clearTimeout(timer));
		await rm(owner.directory, { recursive: true, force: true });
	}
	override dispose(): void { this.stopped = true; this.generation++; for (const id of this.sessions.keys()) { void this.close(id); } super.dispose(); }
}
