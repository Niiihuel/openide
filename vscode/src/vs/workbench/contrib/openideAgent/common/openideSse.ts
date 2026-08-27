/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — helper to POST and consume the SSE response incrementally, via IRequestService
 *  (which goes through the main process → no CORS problems).
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { VSBuffer, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { listenStream } from '../../../../base/common/stream.js';
import { IHeaders } from '../../../../base/parts/request/common/request.js';
import { IRequestService } from '../../../../platform/request/common/request.js';

export interface ISsePostOptions {
	readonly url: string;
	readonly headers: IHeaders;
	readonly body: string;
}

function readAll(stream: VSBufferReadableStream): Promise<string> {
	return new Promise<string>(resolve => {
		let buf = '';
		listenStream(stream, {
			onData: (c: VSBuffer) => { buf += c.toString(); },
			onError: () => resolve(buf),
			onEnd: () => resolve(buf),
		});
	});
}

/**
 * Performs the POST and calls `onBlock` for each complete SSE block (text between blank
 * lines). Provider-specific parsing is left to the caller.
 */
export async function ssePost(
	requestService: IRequestService,
	options: ISsePostOptions,
	token: CancellationToken,
	onBlock: (block: string) => void
): Promise<void> {
	const ctx = await requestService.request({
		type: 'POST',
		callSite: 'openideAgent',
		url: options.url,
		headers: options.headers,
		data: options.body,
	}, token);

	const status = ctx.res.statusCode ?? 0;
	if (status < 200 || status >= 300) {
		const errBody = await readAll(ctx.stream);
		throw new Error(`HTTP ${status}: ${errBody.slice(0, 800)}`);
	}

	let buffer = '';
	await new Promise<void>((resolve, reject) => {
		listenStream(ctx.stream, {
			onData: (chunk: VSBuffer) => {
				// normalize CRLF (some proxies rewrite the SSE line breaks); the WHOLE buffer is
				// normalized after appending, to cover a \r\n split across chunks — after the drain
				// the buffer is small (a partial block), so the cost is negligible
				buffer = (buffer + chunk.toString()).replace(/\r\n/g, '\n');
				let idx: number;
				while ((idx = buffer.indexOf('\n\n')) !== -1) {
					const block = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					if (block.trim()) {
						onBlock(block);
					}
				}
			},
			onError: err => reject(err),
			onEnd: () => {
				if (buffer.trim()) {
					onBlock(buffer);
				}
				resolve();
			},
		}, token);
	});
}

/** Extracts the `data:` value from an SSE block (concatenating multiple data: lines). */
export function sseDataOf(block: string): string | undefined {
	const datas: string[] = [];
	for (const line of block.split('\n')) {
		if (line.startsWith('data:')) {
			datas.push(line.slice(5).trimStart());
		}
	}
	return datas.length ? datas.join('\n') : undefined;
}

/** Extracts the `event:` from an SSE block (used by Anthropic). */
export function sseEventOf(block: string): string | undefined {
	for (const line of block.split('\n')) {
		if (line.startsWith('event:')) {
			return line.slice(6).trim();
		}
	}
	return undefined;
}
