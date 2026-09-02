/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — WHO a credential belongs to, without naming a single provider.
 *
 *  The roster shows one row per subscription, so it has to be able to tell that the ChatGPT account
 *  connected inside OpenIDE and the one the Codex CLI wrote to `~/.codex/auth.json` are the same
 *  account. Orca answers this with one module per provider — a Codex identity reader, a Claude
 *  duplicate-account reader — each one reading the claims that provider happens to publish.
 *
 *  This does the same job from ONE rule, because OAuth already standardised the answer: an access
 *  token that is a JWT carries who issued it (`iss`) and who it is about (`sub`, or a
 *  provider-specific account claim). Both halves matter:
 *
 *    - the ISSUER is what makes the key safe to compare across the whole roster. Two providers
 *      could easily both call an account `12345`; without the issuer they would merge into one row
 *      and hide a real subscription. And it is shared by construction between an in-app account and
 *      a CLI's credential for that same service, which is exactly the pair we need to fold.
 *    - the SUBJECT is the account. The provider-specific claims are tried first because they name
 *      the billed account, while `sub` can be the user — one user can hold two workspaces.
 *
 *  A provider whose token is opaque (Anthropic's `sk-ant-oat…`) yields NO key, and that is the
 *  correct answer, not a gap: a credential that will not say who it belongs to cannot be proven to
 *  be a duplicate, and Orca's rule is the same — only a claim both sides carry can merge them.
 *  Such rows stay separate, which is the safe direction to be wrong in.
 *
 *  Adding a provider requires nothing here. That is the point.
 *--------------------------------------------------------------------------------------------*/

import { stringClaimFromJwt } from './openideJwt.js';

/**
 * Account claims in order of authority. The first two name the BILLED account (a workspace, an
 * organisation); `sub` names the person, which is the same account often enough to be worth using
 * and specific enough to never merge two different ones.
 */
const SUBJECT_CLAIMS = ['chatgpt_account_id', 'account_id', 'workspace_account_id', 'organization_id', 'org_id', 'sub'] as const;

/** Nested objects some issuers hide their account claims in, checked before the top level. */
const NESTED_CLAIM_PATHS = ['https://api.openai.com/auth', 'https://api.openai.com/profile'] as const;

function firstClaim(token: string, claims: readonly string[]): string | undefined {
	for (const claim of claims) {
		const value = stringClaimFromJwt(token, claim);
		if (value) { return value; }
	}
	return undefined;
}

/**
 * A stable `issuer#subject` for the account behind an OAuth access token, or undefined when the
 * token is opaque or says nothing about who it is for.
 */
export function usageAccountKeyFromToken(token: string | undefined): string | undefined {
	const value = String(token ?? '').trim();
	if (!value || value.split('.').length < 3) {
		// Not a JWT: nothing to read. Anthropic's tokens land here, and they simply do not merge.
		return undefined;
	}
	const issuer = stringClaimFromJwt(value, 'iss');
	if (!issuer) { return undefined; }
	const subject = nestedSubject(value) ?? firstClaim(value, SUBJECT_CLAIMS);
	if (!subject) { return undefined; }
	return `${issuer.trim().toLowerCase()}#${subject.trim()}`;
}

/** The account claims OpenAI publishes inside a namespaced object rather than at the top level. */
function nestedSubject(token: string): string | undefined {
	for (const path of NESTED_CLAIM_PATHS) {
		const nested = objectClaim(token, path);
		if (!nested) { continue; }
		for (const claim of SUBJECT_CLAIMS) {
			const value = nested[claim];
			if (typeof value === 'string' && value.trim()) { return value; }
		}
	}
	return undefined;
}

function objectClaim(token: string, claim: string): Record<string, unknown> | undefined {
	try {
		const encoded = token.split('.')[1];
		if (!encoded) { return undefined; }
		const payload = JSON.parse(decodeJwtSegment(encoded)) as Record<string, unknown>;
		const value = payload?.[claim];
		return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function decodeJwtSegment(segment: string): string {
	// The JWT alphabet is base64url; `atob` wants plain base64 and complete padding.
	const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}
