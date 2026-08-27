/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — STREAMING request IPC channel for the agent engine. The stock RequestChannel
 *  buffers the entire response (streamToBuffer) — unusable for SSE. This channel emits the
 *  response as events (res → data* → end/error) so the chat streams for real.
 *
 *  Root cause: the desktop workbench IRequestService calls fetch() IN THE RENDERER →
 *  subject to CORS. api.anthropic.com allows it; chatgpt.com/backend-api (Codex) and others do NOT →
 *  "Failed to fetch". The main process uses Electron net (no CORS, proxy-aware): all agent
 *  traffic goes through here.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, newWriteableBufferStream } from '../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { listenStream } from '../../../base/common/stream.js';
import { IRequestContext, IRequestOptions } from '../../../base/parts/request/common/request.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { AuthInfo, Credentials, IRequestService } from './request.js';

export const OPENIDE_REQUEST_CHANNEL = 'openideRequest';

/** Control messages (travel as JSON). Data chunks do NOT go here: the ipc.ts serializer only
 *  handles native VSBuffer at the TOP LEVEL of the payload — nested inside an object it goes
 *  through JSON.stringify and arrives as a corrupt POJO ("[object Object]" in the stream). So
 *  chunks are emitted as a BARE VSBuffer and the client discriminates via instanceof. */
type StreamMessage =
	| { type: 'res'; statusCode: number | undefined; headers: Record<string, string | string[] | undefined> }
	| { type: 'end' }
	| { type: 'error'; message: string };

/** MAIN side: each `listen('request', options)` starts the request on subscribe and cancels
 *  it when the renderer unsubscribes (disposing the listener = abort). */
export class OpenideRequestChannel implements IServerChannel {

	constructor(private readonly service: IRequestService) { }

	listen(_: unknown, event: string, arg?: any): Event<any> {
		if (event !== 'request') {
			throw new Error(`Evento desconocido: ${event}`);
		}
		const options = arg as IRequestOptions;
		const cts = new CancellationTokenSource();
		const emitter = new Emitter<StreamMessage | VSBuffer>({
			onWillAddFirstListener: () => { this.run(options, emitter, cts.token); },
			onDidRemoveLastListener: () => { cts.cancel(); emitter.dispose(); },
		});
		return emitter.event;
	}

	private async run(options: IRequestOptions, emitter: Emitter<StreamMessage | VSBuffer>, token: CancellationToken): Promise<void> {
		try {
			const ctx = await this.service.request(options, token);
			emitter.fire({ type: 'res', statusCode: ctx.res.statusCode, headers: ctx.res.headers as any });
			listenStream(ctx.stream, {
				onData: chunk => emitter.fire(chunk), // VSBuffer pelado: serialización nativa
				onError: err => emitter.fire({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
				onEnd: () => emitter.fire({ type: 'end' }),
			}, token);
		} catch (err) {
			emitter.fire({ type: 'error', message: err instanceof Error ? err.message : String(err) });
		}
	}

	call(): Promise<any> {
		throw new Error('OpenideRequestChannel es solo listen()');
	}
}

/** RENDERER side: IRequestService consuming the streaming channel. Only request() is really
 *  implemented (it is all the engine uses); the rest are safe no-ops. */
export class OpenideRequestChannelClient implements IRequestService {

	declare readonly _serviceBrand: undefined;

	readonly onDidCompleteRequest = Event.None as IRequestService['onDidCompleteRequest'];

	constructor(private readonly channel: IChannel) { }

	async resolveProxy(_url: string): Promise<string | undefined> { return undefined; }
	async lookupAuthorization(_authInfo: AuthInfo): Promise<Credentials | undefined> { return undefined; }
	async lookupKerberosAuthorization(_url: string): Promise<string | undefined> { return undefined; }
	async loadCertificates(): Promise<string[]> { return []; }

	request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
		return new Promise<IRequestContext>((resolve, reject) => {
			const stream = newWriteableBufferStream();
			let resolved = false;
			const finish = () => {
				disposable.dispose();
				tokenListener.dispose();
			};
			const disposable = this.channel.listen<StreamMessage | VSBuffer>('request', options)(msg => {
				if (msg instanceof VSBuffer) {
					// data chunk: travels as a top-level VSBuffer (native ipc.ts serialization)
					stream.write(msg);
					return;
				}
				switch (msg.type) {
					case 'res':
						resolved = true;
						resolve({ res: { statusCode: msg.statusCode, headers: msg.headers as any }, stream });
						break;
					case 'end':
						stream.end();
						finish();
						break;
					case 'error': {
						const err = new Error(msg.message);
						if (resolved) {
							stream.error(err);
							stream.end();
						} else {
							reject(err);
						}
						finish();
						break;
					}
				}
			});
			const tokenListener = token.onCancellationRequested(() => {
				// unsubscribing cancels the request in the main process (onDidRemoveLastListener)
				finish();
				if (!resolved) {
					reject(new CancellationError());
				} else {
					stream.end();
				}
			});
		});
	}
}
