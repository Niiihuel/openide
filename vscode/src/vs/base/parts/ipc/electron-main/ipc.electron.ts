/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebContents } from 'electron';
import { validatedIpcMain } from './ipcMain.js';
import { VSBuffer } from '../../../common/buffer.js';
import { Emitter, Event } from '../../../common/event.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../common/lifecycle.js';
import { ClientConnectionEvent, IPCServer, IServerChannel } from '../common/ipc.js';
import { Protocol as ElectronProtocol } from '../common/ipc.electron.js';

interface IIPCEvent {
	event: { sender: WebContents };
	message: Buffer | null;
}

function createScopedOnMessageEvent(senderId: number, eventName: string): Event<VSBuffer | null> {
	const onMessage = Event.fromNodeEventEmitter<IIPCEvent>(validatedIpcMain, eventName, (event, message) => ({ event, message }));
	const onMessageFromSender = Event.filter(onMessage, ({ event }) => event.sender.id === senderId);

	return Event.map(onMessageFromSender, ({ message }) => message ? VSBuffer.wrap(message) : message);
}

/**
 * An implementation of `IPCServer` on top of Electron `ipcMain` API.
 */
export class Server extends IPCServer {

	private static readonly Clients = new Map<number, IDisposable>();
	private static readonly senders = new WeakMap<ElectronProtocol, WebContents>();

	private static getOnDidClientConnect(): Event<ClientConnectionEvent> {
		const onHello = Event.fromNodeEventEmitter<WebContents>(validatedIpcMain, 'vscode:hello', ({ sender }) => sender);

		return Event.map(onHello, webContents => {
			const id = webContents.id;
			const client = Server.Clients.get(id);

			client?.dispose();

			const onDidClientReconnect = new Emitter<void>();
			const reconnectDisposable = toDisposable(() => {
				onDidClientReconnect.fire();
			});
			Server.Clients.set(id, reconnectDisposable);

			const onMessage = createScopedOnMessageEvent(id, 'vscode:message') as Event<VSBuffer>;
			const onDidClientDisconnect = Event.any(Event.signal(createScopedOnMessageEvent(id, 'vscode:disconnect')), onDidClientReconnect.event, Event.signal(Event.fromNodeEventEmitter(webContents, 'destroyed')), Event.signal(Event.fromNodeEventEmitter(webContents, 'render-process-gone')));
			Event.once(onDidClientDisconnect)(() => {
				if (Server.Clients.get(id) === reconnectDisposable) {
					Server.Clients.delete(id);
				}

				// Let every disconnect subscriber release its connection before clearing this emitter.
				queueMicrotask(() => onDidClientReconnect.dispose());
			});
			const protocol = new ElectronProtocol(webContents, onMessage);
			Server.senders.set(protocol, webContents);

			return { protocol, onDidClientDisconnect };
		});
	}

	/** The sender comes from Electron, never from the client's serialized routing context. */
	registerWindowChannel(name: string, factory: (sender: WebContents, disposables: DisposableStore) => IServerChannel): void {
		this.registerConnectionChannel(name, (connection, disposables) => {
			const sender = Server.senders.get(connection.protocol as ElectronProtocol);
			if (!sender || sender.isDestroyed()) {
				throw new Error('The IPC window is no longer available.');
			}
			return factory(sender, disposables);
		});
	}

	constructor() {
		super(Server.getOnDidClientConnect());
	}
}
