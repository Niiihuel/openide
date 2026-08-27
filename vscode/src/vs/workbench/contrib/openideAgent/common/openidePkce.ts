/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — helpers PKCE (RFC 7636) usando utilidades de VS Code (common-safe) + Web Crypto.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';

function randomBytes(n: number): Uint8Array {
	const arr = new Uint8Array(n);
	crypto.getRandomValues(arr);
	return arr;
}

export function randomVerifier(): string {
	return encodeBase64(VSBuffer.wrap(randomBytes(32)), false, true);
}

export function randomState(): string {
	return encodeBase64(VSBuffer.wrap(randomBytes(16)), false, true);
}

export async function challengeS256(verifier: string): Promise<string> {
	const input = VSBuffer.fromString(verifier).buffer;
	const digest = await crypto.subtle.digest('sha-256', input as ArrayBufferView<ArrayBuffer>);
	return encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false, true);
}
