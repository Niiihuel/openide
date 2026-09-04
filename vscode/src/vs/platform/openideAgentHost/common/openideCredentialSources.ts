/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — where a provider's credential can be FOUND, as data.
 *
 *  ── Why this is not an "importer" ──────────────────────────────────────────────────────────
 *  Importing is copying, and a copy has two owners and one truth: rotate the key in the other
 *  tool and OpenIDE keeps the stale one, silently. Worse, the file it was copied from is not a
 *  stable target — opencode is already moving its credentials to the system keyring and to env
 *  vars, so a parser written against today's path is tomorrow's dead code.
 *
 *  So nothing is ever copied. A credential is RESOLVED at call time from an ordered chain, and
 *  the answer carries where it came from:
 *
 *    1. OpenIDE's own secret store — what the user set HERE always wins.
 *    2. The environment, under the names models.dev publishes for that provider. The registry
 *       ships `env` for all 213 providers, so this covers the whole catalogue with no code per
 *       provider — the registry is the data.
 *    3. External sources: another tool's credential file, read-only.
 *
 *  ── Why OAuth never crosses ────────────────────────────────────────────────────────────────
 *  Not a policy: a refresh token is bound to the client_id that minted it (opencode refreshes
 *  with its own plugin's), and a subscription API additionally accepts it only with that
 *  client's headers. A copied OAuth token therefore dies at its first refresh, silently. What a
 *  source reports instead is the SIGNAL — "this provider is connected over there" — so the UI
 *  can offer OpenIDE's own login rather than a promise that breaks later.
 *
 *  ── Adding a tool ──────────────────────────────────────────────────────────────────────────
 *  One descriptor plus one pure `parse`. No UI, no service, no wiring: `readCredentialSources`
 *  in main walks this list. That is the whole extension point.
 *--------------------------------------------------------------------------------------------*/

/**
 * A credential as its provider needs it: NAMED values, never a bare string.
 *
 * Most providers want one secret, but the registry publishes several env names for the ones that
 * do not — watsonx needs a key AND a project id, Vertex needs project + location + a credentials
 * file. A `string` contract could never grow to those without breaking every caller, so the shape
 * is a record from the start even while every consumer reads `key`.
 */
export type CredentialValues = Readonly<Record<string, string>>;

/** The conventional field for the single-secret case. */
export const CREDENTIAL_KEY = 'key';

export type CredentialOriginKind = 'store' | 'env' | 'source';

/**
 * Where the credential in use came from. Shown in the UI on purpose: a stale `OPENAI_API_KEY` in
 * the environment quietly shadowing the key you just pasted is the bug nobody can diagnose, and
 * printing the origin turns precedence from a mystery into a fact.
 */
export interface ICredentialOrigin {
	readonly kind: CredentialOriginKind;
	/** Source id for `kind === 'source'`, the env var name for `kind === 'env'`. */
	readonly detail?: string;
	/** Human label ("opencode", "OPENAI_API_KEY"). */
	readonly label?: string;
}

export interface IResolvedCredential {
	readonly values: CredentialValues;
	readonly origin: ICredentialOrigin;
}

/** What one external tool holds, once its file has been read and parsed. */
export interface IExternalCredentialScan {
	/** Static secrets, by provider id. Only these can be used. */
	readonly keys: Readonly<Record<string, CredentialValues>>;
	/**
	 * Providers that tool has connected over OAuth. NOT usable — reported so the UI can say
	 * "you already have this connected in opencode" and offer OpenIDE's own flow.
	 */
	readonly oauth: readonly string[];
}

export interface IExternalCredentialSource {
	readonly id: string;
	readonly label: string;
	/**
	 * Path of the credential file, relative to the user's home, as segments. Segments rather than
	 * a string because main joins them with its own separator, and Windows would otherwise need a
	 * second field.
	 */
	readonly path: readonly string[];
	readonly parse: (text: string) => IExternalCredentialScan;
}

const EMPTY_SCAN: IExternalCredentialScan = { keys: {}, oauth: [] };

/**
 * opencode's `~/.local/share/opencode/auth.json`: a map of provider id to credential, 0600, with
 * three shapes — `api` (a static key), `oauth` (access/refresh/expires) and `wellknown`
 * (enterprise discovery). Provider ids are models.dev's, which is what OpenIDE uses too, so no
 * translation table is needed.
 *
 * Only `api` produces a credential. `wellknown` is left out entirely: it points at a custom
 * authentication server, so the stored value is not a secret this can use.
 */
export function parseOpencodeAuth(text: string): IExternalCredentialScan {
	let doc: unknown;
	try {
		doc = JSON.parse(text);
	} catch {
		return EMPTY_SCAN;
	}
	if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
		return EMPTY_SCAN;
	}
	const keys: Record<string, CredentialValues> = {};
	const oauth: string[] = [];
	for (const [providerId, raw] of Object.entries(doc as Record<string, unknown>)) {
		if (!providerId || !raw || typeof raw !== 'object') {
			continue;
		}
		const entry = raw as Record<string, unknown>;
		if (entry['type'] === 'api' && typeof entry['key'] === 'string' && entry['key']) {
			keys[providerId] = { [CREDENTIAL_KEY]: entry['key'] };
		} else if (entry['type'] === 'oauth') {
			oauth.push(providerId);
		}
	}
	return { keys, oauth: oauth.sort() };
}

/**
 * Every tool OpenIDE knows how to read a credential from.
 *
 * One entry today. It is a list because the next ones — Claude Code, Codex, Gemini CLI — are the
 * same shape: a path and a parse. Nothing else in the product changes when one is added.
 */
export const OPENIDE_CREDENTIAL_SOURCES: readonly IExternalCredentialSource[] = [
	{
		id: 'opencode',
		label: 'opencode',
		path: ['.local', 'share', 'opencode', 'auth.json'],
		parse: parseOpencodeAuth,
	},
];

/** What main answers with: the env names that were asked for, and each source's scan. */
export interface ICredentialSourcesSnapshot {
	/** Only the variables the caller named — the rest of the environment never crosses the wire. */
	readonly env: Readonly<Record<string, string>>;
	readonly sources: readonly { readonly id: string; readonly scan: IExternalCredentialScan }[];
}

export const EMPTY_CREDENTIAL_SNAPSHOT: ICredentialSourcesSnapshot = { env: {}, sources: [] };

/**
 * The credential a provider gets from the environment, or undefined when it is not fully there.
 *
 * `envNames` is the registry's own list for that provider, in its order. A provider with several
 * names needs ALL of them (watsonx without its project id is not a usable credential); a provider
 * that publishes alternatives for one secret — google ships three names for the same key — is
 * satisfied by the first that answers, which the caller expresses by passing one name.
 */
export function credentialFromEnv(envNames: readonly string[], env: Readonly<Record<string, string>>): IResolvedCredential | undefined {
	if (!envNames.length) {
		return undefined;
	}
	if (envNames.length === 1) {
		const value = env[envNames[0]];
		return value ? { values: { [CREDENTIAL_KEY]: value }, origin: { kind: 'env', detail: envNames[0], label: envNames[0] } } : undefined;
	}
	const values: Record<string, string> = {};
	for (const name of envNames) {
		const value = env[name];
		if (!value) {
			return undefined;
		}
		values[name] = value;
	}
	// The first name is the secret by convention in the registry's lists; also exposed under the
	// conventional field so a single-secret consumer keeps working.
	values[CREDENTIAL_KEY] = env[envNames[0]];
	return { values, origin: { kind: 'env', detail: envNames.join(', '), label: envNames.join(' + ') } };
}

export interface ICredentialLookup {
	/** models.dev id of the provider — the id both the env names and the sources are keyed by. */
	readonly registryId?: string;
	/** Env var names the registry publishes for it. */
	readonly envNames?: readonly string[];
	/** What OpenIDE's own secret store holds, if anything. */
	readonly stored?: string;
	readonly snapshot?: ICredentialSourcesSnapshot;
}

/**
 * The chain, in one pure function so the precedence can be argued with in a test instead of in a
 * review: what the user set here, then the environment, then the other tools in the order they
 * are declared.
 */
export function chooseCredential(lookup: ICredentialLookup): IResolvedCredential | undefined {
	if (lookup.stored) {
		return { values: { [CREDENTIAL_KEY]: lookup.stored }, origin: { kind: 'store' } };
	}
	const snapshot = lookup.snapshot;
	if (!snapshot) {
		return undefined;
	}
	const fromEnv = credentialFromEnv(lookup.envNames ?? [], snapshot.env);
	if (fromEnv) {
		return fromEnv;
	}
	if (!lookup.registryId) {
		return undefined;
	}
	for (const source of snapshot.sources) {
		const values = source.scan.keys[lookup.registryId];
		if (values && values[CREDENTIAL_KEY]) {
			const label = OPENIDE_CREDENTIAL_SOURCES.find(candidate => candidate.id === source.id)?.label ?? source.id;
			return { values, origin: { kind: 'source', detail: source.id, label } };
		}
	}
	return undefined;
}

/** Providers another tool has connected over OAuth, for the "connect it here too" hint. */
export function oauthSignalsFor(registryId: string | undefined, snapshot: ICredentialSourcesSnapshot | undefined): { readonly sourceId: string; readonly label: string }[] {
	if (!registryId || !snapshot) {
		return [];
	}
	const out: { sourceId: string; label: string }[] = [];
	for (const source of snapshot.sources) {
		if (source.scan.oauth.includes(registryId)) {
			out.push({ sourceId: source.id, label: OPENIDE_CREDENTIAL_SOURCES.find(candidate => candidate.id === source.id)?.label ?? source.id });
		}
	}
	return out;
}
