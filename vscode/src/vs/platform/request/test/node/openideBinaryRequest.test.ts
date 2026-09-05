/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createServer } from 'http';
import { VSBuffer, encodeBase64 } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { OpenideRequestChannel, OpenideRequestChannelClient } from '../../common/openideRequestIpc.js';
import { asText, IRequestService } from '../../common/request.js';
import { nodeRequest } from '../../node/requestService.js';

suite('OpenIDE binary requests', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('IPC decoding and Node upload preserve every byte, including invalid UTF-8', async () => {
		const bytes = VSBuffer.wrap(Uint8Array.from({ length: 256 }, (_, index) => index));
		let received = Buffer.alloc(0);
		const server = createServer((request, response) => {
			const chunks: Buffer[] = [];
			request.on('data', (chunk: Buffer) => chunks.push(chunk));
			request.on('end', () => { received = Buffer.concat(chunks); response.end('{"text":"hola"}'); });
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		try {
			const address = server.address();
			assert.ok(address && typeof address !== 'string');
			const main = new OpenideRequestChannel(new class extends mock<IRequestService>() {
				override request: IRequestService['request'] = (options, token) => nodeRequest(options, token);
			});
			const channel: IChannel = { listen: (event, arg) => main.listen(undefined, event, arg), call: () => Promise.reject(new Error('Unexpected call')) };
			const client = new OpenideRequestChannelClient(channel);
			const response = await client.request({ type: 'POST', url: `http://127.0.0.1:${address.port}`, dataBase64: encodeBase64(bytes), callSite: 'openideBinaryRequest.test' }, CancellationToken.None);
			assert.deepStrictEqual({ text: await asText(response), bytes: [...received] }, { text: '{"text":"hola"}', bytes: [...bytes.buffer] });
		} finally {
			await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
	});
});
