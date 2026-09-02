/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — the per-connection authenticated IPC adapter for codebase memory. The shared process
 *  session (ctx) is the authority: the workspaceKey the renderer sends is accepted only when it
 *  matches the session that same caller initialized.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { CodebaseMemoryChannel } from './openideCodebaseMemoryChannel.js';
import { IProviderExtraction } from '../../../common/openideCodebaseMemoryProviders.js';
import { ICodebaseMemoryIndexOptions } from '../../../common/openideCodebaseMemoryProtocol.js';

export class CodebaseMemoryServerChannel extends Disposable implements IServerChannel<string> {
	private readonly service: CodebaseMemoryChannel;
	private readonly sessions = new Map<string, string>();

	constructor(fileService: IFileService) {
		super();
		this.service = this._register(new CodebaseMemoryChannel(fileService));
	}

	private args(arg: unknown): unknown[] { return Array.isArray(arg) ? arg : [arg]; }
	private sessionKey(ctx: string, arg: unknown): string {
		const key = this.args(arg)[0];
		if (typeof key !== 'string' || this.sessions.get(ctx) !== key) { throw new Error('Sesión de memoria no autorizada.'); }
		return key;
	}

	async call<T>(ctx: string, command: string, arg?: unknown, token: CancellationToken = CancellationToken.None): Promise<T> {
		const args = this.args(arg);
		switch (command) {
			case 'initialize': {
				const folders = Array.isArray(args[0]) ? args[0].map(String) : [];
				const key = await this.service.initialize(folders, args[1] === true, args[2] as ICodebaseMemoryIndexOptions | undefined);
				this.sessions.set(ctx, key);
				return key as T;
			}
			case 'setTrusted': await this.service.setTrusted(this.sessionKey(ctx, arg), args[1] === true); return undefined as T;
			case 'setOptions': await this.service.setOptions(this.sessionKey(ctx, arg), args[1] as ICodebaseMemoryIndexOptions); return undefined as T;
			case 'rebuildFull': return await this.service.rebuildFull(this.sessionKey(ctx, arg), token) as T;
			case 'indexIncremental': return await this.service.indexIncremental(this.sessionKey(ctx, arg), Array.isArray(args[1]) ? args[1] : [], token) as T;
			case 'getVersion': return await this.service.getVersion(this.sessionKey(ctx, arg)) as T;
			case 'getSnapshot': return await this.service.getSnapshot(this.sessionKey(ctx, arg)) as T;
			case 'getFileNodes': return await this.service.getFileNodes(this.sessionKey(ctx, arg), String(args[1] ?? '')) as T;
			case 'clear': await this.service.clear(this.sessionKey(ctx, arg)); return undefined as T;
			case 'addLanguageServerExtraction': return await this.service.addLanguageServerExtraction(this.sessionKey(ctx, arg), String(args[1] ?? ''), args[2] as IProviderExtraction) as T;
			default: throw new Error(`Comando IPC desconocido: ${command}`);
		}
	}

	listen<T>(ctx: string, event: string): Event<T> {
		if (event === 'onProgress') { return Event.filter(this.service.onProgress, value => this.sessions.get(ctx) === value.workspaceKey) as Event<T>; }
		if (event === 'onDidChange') { return Event.filter(this.service.onDidChange, value => this.sessions.get(ctx) === value.workspaceKey) as Event<T>; }
		throw new Error(`Evento IPC desconocido: ${event}`);
	}
}
