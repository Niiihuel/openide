/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64 } from '../../../../base/common/buffer.js';

function jwtPayload(token: string): Record<string, unknown> | undefined {
	try {
		const encoded = token.split('.')[1];
		if (!encoded) {
			return undefined;
		}
		const parsed = JSON.parse(decodeBase64(encoded).toString());
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

export function chatGptAccountIdFromJwt(token: string): string | undefined {
	const auth = jwtPayload(token)?.['https://api.openai.com/auth'];
	if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
		return undefined;
	}
	const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
	return typeof accountId === 'string' && accountId ? accountId : undefined;
}

export function stringClaimFromJwt(token: string, claim: string): string | undefined {
	const value = jwtPayload(token)?.[claim];
	return typeof value === 'string' && value ? value : undefined;
}

export function numberClaimFromJwt(token: string, claim: string): number | undefined {
	const value = jwtPayload(token)?.[claim];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
