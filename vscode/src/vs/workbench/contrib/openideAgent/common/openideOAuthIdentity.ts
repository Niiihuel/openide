/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — who an OAuth session belongs to.
 *
 *  An account list that says "Account 1, Account 2" answers no question anyone has. What the user
 *  wants to know is WHICH of their logins this is, and the providers do tell us — inconsistently.
 *  This module is the one place that knows where each of them hides it.
 *
 *  Nothing here authenticates or authorises: the result becomes a LABEL. That is what makes it
 *  safe to read a JWT without verifying its signature — a forged token would have to be a token
 *  the provider already accepted, and the only thing it could forge is the name shown next to it.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64 } from '../../../../base/common/buffer.js';

/** Reads the claims of a JWT without verifying it. Safe here BECAUSE nothing is authorised from
 *  the result: the payload only ever becomes a label. Returns undefined for anything that is not
 *  a three-part token with a decodable JSON payload — an opaque access token, most commonly. */
export function jwtClaims(token: unknown): Record<string, unknown> | undefined {
	if (typeof token !== 'string') { return undefined; }
	const parts = token.split('.');
	if (parts.length !== 3) { return undefined; }
	try {
		// JWT uses base64url; decodeBase64 wants plain base64 with padding.
		const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
		const claims = JSON.parse(decodeBase64(padded).toString());
		return claims && typeof claims === 'object' ? claims : undefined;
	} catch {
		return undefined;
	}
}

/** First non-empty string among the candidates, trimmed. */
function firstText(candidates: readonly unknown[]): string | undefined {
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate.trim()) { return candidate.trim(); }
	}
	return undefined;
}

/** The identity inside a set of JWT claims. Some providers nest it under a namespaced claim
 *  (OpenAI uses `https://api.openai.com/auth`) rather than the standard `email`. */
export function identityFromClaims(claims: Record<string, unknown> | undefined): string | undefined {
	if (!claims) { return undefined; }
	const namespaced = Object.keys(claims)
		.filter(key => key.startsWith('http'))
		.map(key => claims[key])
		.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
	return firstText([
		claims['email'], claims['preferred_username'], claims['name'],
		...namespaced.flatMap(value => [value['email'], value['user_email'], value['preferred_username']]),
	]);
}

/** The human identity in a token response, if it carries one. Providers disagree on where it
 *  lives: OpenAI/Codex sign an `id_token` whose claims hold the email, Anthropic returns an
 *  `account` object, others put it at the top level. None of them is required to send anything. */
export function identityFromTokenResponse(json: any): string | undefined {
	return firstText([
		json?.account?.email_address, json?.account?.email, json?.account?.name,
		json?.email, json?.user?.email, json?.user?.login,
		identityFromClaims(jwtClaims(json?.id_token)),
		// Last resort, and the reason sessions signed in before any of this still get a name: the
		// access token is often itself a JWT carrying the same claims.
		identityFromClaims(jwtClaims(json?.access_token)),
	]);
}
