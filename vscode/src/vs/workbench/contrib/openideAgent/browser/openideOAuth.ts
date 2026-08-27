/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — OAuth engine for providers that support it. Two flows designed to run
 *  from the renderer (no local server, no URI handler):
 *      - 'device' : device-code (a code is shown, the URL is opened, and it polls).
 *      - 'pkce'   : authorize-code + PKCE where the user PASTES the returned code.
 *  Tokens (access + refresh + expiry) in SecretStorage.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { VSBuffer, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { listenStream } from '../../../../base/common/stream.js';
import { URI } from '../../../../base/common/uri.js';
import { IHeaders } from '../../../../base/parts/request/common/request.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IProviderEntry } from '../common/openideProviderCatalog.js';
import { identityFromClaims, identityFromTokenResponse, jwtClaims } from '../common/openideOAuthIdentity.js';
import { challengeS256, randomState, randomVerifier } from '../common/openidePkce.js';

export const SECRET_OAUTH_PREFIX = 'openide.agent.oauth.';

/** How the OAuth flow talks to the user. By default it uses QuickInput; the Providers page
 *  passes its own implementation to show code/paste INLINE in the webview. */
export interface IOAuthInteraction {
	/** Shows the user-code to enter in the browser (non-blocking). */
	showUserCode(url: string, code: string): void;
	/** Asks for the code (or the callback URL) pasted by the user. undefined = cancelled. */
	promptCode(prompt: string): Promise<string | undefined>;
	/** true when the user cancelled — it stops the device flows' polling. */
	readonly cancelled?: boolean;
}

interface IStoredToken {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	/** Who this session belongs to — an email or a username, when the provider says so. Purely
	 *  descriptive: nothing authenticates with it, it exists so the account list can name the
	 *  session instead of numbering it. */
	account?: string;
}

function readText(stream: VSBufferReadableStream): Promise<string> {
	return new Promise<string>(resolve => {
		let buf = '';
		listenStream(stream, {
			onData: (c: VSBuffer) => { buf += c.toString(); },
			onError: () => resolve(buf),
			onEnd: () => resolve(buf),
		});
	});
}

export interface IOAuthLoopbackStartOptions {
	readonly port?: number;
	readonly callbackPath?: string;
}

/** Loopback server in MAIN for flows redirecting to localhost (Google): the renderer cannot
 *  listen on ports — the openideAgentHost channel provides it. */
export interface IOAuthLoopback {
	start(options?: IOAuthLoopbackStartOptions): Promise<{ id: string; port: number }>;
	wait(id: string, timeoutMs: number): Promise<{ code?: string; state?: string; error?: string; timedOut?: boolean }>;
	cancel(id: string): Promise<void>;
}

export class OpenideOAuthManager {

	constructor(
		private readonly requestService: IRequestService,
		private readonly secretStorage: ISecretStorageService,
		private readonly openerService: IOpenerService,
		private readonly quickInputService: IQuickInputService,
		private readonly loopback?: IOAuthLoopback,
	) { }

	async isSignedIn(providerId: string): Promise<boolean> {
		return !!(await this.read(providerId));
	}

	async signOut(providerId: string): Promise<void> {
		await this.secretStorage.set(SECRET_OAUTH_PREFIX + providerId, '');
		if (providerId === 'copilot') {
			this._copilotCache = undefined; // el JWT efímero no debe sobrevivir al logout
		}
	}

	/** Returns a valid access token (refreshing when expired). Throws when there is no session. */
	async getValidToken(entry: IProviderEntry): Promise<string> {
		const stored = await this.read(entry.id);
		if (!stored) {
			throw new Error(`No iniciaste sesión en "${entry.label ?? entry.id}".`);
		}
		const skewMs = (entry.oauth?.refreshSkewSeconds ?? 60) * 1000;
		if (stored.expiresAt && Date.now() > stored.expiresAt - skewMs && stored.refreshToken && entry.oauth) {
			const refreshed = await this.refresh(entry, stored.refreshToken);
			await this.write(entry.id, refreshed);
			return refreshed.accessToken;
		}
		return stored.accessToken;
	}

	/** Forces a refresh after a 401/403 from the provider. Used only once per run, before any
	 * content has been shown, to recover OAuth sessions revoked between the expiresAt
	 * computation and the real request. */
	async forceRefresh(entry: IProviderEntry): Promise<string> {
		if (entry.id === 'copilot') {
			this._copilotCache = undefined;
			return this.getCopilotToken(entry);
		}
		const stored = await this.read(entry.id);
		if (!stored?.refreshToken || !entry.oauth) {
			throw new Error(`La sesión de "${entry.label ?? entry.id}" no se puede renovar. Iniciá sesión de nuevo.`);
		}
		const refreshed = await this.refresh(entry, stored.refreshToken);
		await this.write(entry.id, refreshed);
		return refreshed.accessToken;
	}

	async signIn(entry: IProviderEntry, interaction?: IOAuthInteraction): Promise<boolean> {
		if (!entry.oauth) {
			throw new Error(`El provider "${entry.id}" no tiene config OAuth.`);
		}
		const ix = interaction ?? this.defaultInteraction();
		let token: IStoredToken | undefined;
		switch (entry.oauth.flow) {
			case 'device': token = await this.deviceFlow(entry, ix); break;
			case 'openai-device': token = await this.openaiDeviceFlow(entry, ix); break;
			case 'minimax-device': token = await this.minimaxDeviceFlow(entry, ix); break;
			case 'loopback': token = await this.loopbackFlow(entry); break;
			default: token = await this.pkceFlow(entry, ix); break;
		}
		if (token && token.accessToken) {
			await this.write(entry.id, token);
			return true;
		}
		return false;
	}

	/** Default interaction (native QuickInput) — used by the palette commands. */
	private defaultInteraction(): IOAuthInteraction {
		return {
			showUserCode: (url, code) => {
				// Non-blocking: the user enters the code in the browser, not here.
				this.quickInputService.input({
					prompt: `Abrí ${url} e ingresá el código: ${code}`,
					value: code,
					ignoreFocusLost: true,
				});
			},
			promptCode: prompt => this.quickInputService.input({ prompt, ignoreFocusLost: true }),
		};
	}

	/** Resolves authorize/token endpoints, via OIDC discovery when the catalog says so (xAI). */
	private async resolveEndpoints(cfg: NonNullable<IProviderEntry['oauth']>): Promise<{ authorizationUrl: string; tokenUrl: string }> {
		if (cfg.discoveryUrl && (!cfg.authorizationUrl || !cfg.tokenUrl)) {
			const disc = await this.getJson(cfg.discoveryUrl);
			return {
				authorizationUrl: cfg.authorizationUrl || String(disc.authorization_endpoint ?? ''),
				tokenUrl: cfg.tokenUrl || String(disc.token_endpoint ?? ''),
			};
		}
		return { authorizationUrl: cfg.authorizationUrl ?? '', tokenUrl: cfg.tokenUrl };
	}

	// ---- flujos ----

	/** Token endpoints in preference order (the primary one plus the catalog's fallbacks). */
	private tokenUrls(cfg: NonNullable<IProviderEntry['oauth']>): string[] {
		return [cfg.tokenUrl, ...(cfg.tokenUrlFallbacks ?? [])];
	}

	/** POST to the token endpoint trying the fallbacks in order (Anthropic changed domain). */
	private async postTokenWithFallback(cfg: NonNullable<IProviderEntry['oauth']>, params: Record<string, string>, useJson: boolean): Promise<any> {
		const urls = this.tokenUrls(cfg);
		let lastError: unknown;
		for (const url of urls) {
			try {
				return await this.postToken(url, params, useJson, false, cfg.tokenUserAgent);
			} catch (e) {
				lastError = e;
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}

	private async pkceFlow(entry: IProviderEntry, ix: IOAuthInteraction): Promise<IStoredToken | undefined> {
		const cfg = entry.oauth!;
		const verifier = randomVerifier();
		const challenge = await challengeS256(verifier);
		const state = randomState();
		const redirectUri = cfg.redirectUri || 'https://console.anthropic.com/oauth/code/callback';
		const endpoints = await this.resolveEndpoints(cfg);

		const params = new URLSearchParams({
			client_id: cfg.clientId,
			response_type: 'code',
			redirect_uri: redirectUri,
			scope: cfg.scopes.join(' '),
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state,
			...(cfg.discoveryUrl ? { nonce: randomState() } : {}),   // OIDC (xAI) espera nonce
			...(cfg.authorizeExtraParams ?? {}),                     // xAI: plan=generic
		});
		const authUrl = `${endpoints.authorizationUrl}?${params.toString()}`;

		await this.openerService.open(URI.parse(authUrl));
		const pasted = await ix.promptCode(`Autorizá en el navegador y pegá acá el código (o la URL completa de redirección) que te devuelve ${entry.label}`);
		if (!pasted) {
			return undefined;
		}
		// We accept the bare code, "code#state" (Anthropic) or the whole callback URL
		// (xAI without a loopback server: the user copies the "failed" URL with ?code=...).
		let code = pasted.split('#')[0].trim();
		// Anthropic returns "code#state": if the pasted state is not ours, the exchange is sure to
		// 400 (a code from ANOTHER login attempt) — better to cut it here with an actionable
		// message than to let the token endpoint answer with something cryptic.
		const pastedState = pasted.includes('#') ? (pasted.split('#')[1] ?? '').trim() : '';
		if (pastedState && pastedState !== state) {
			throw new Error('OAuth: el código pegado pertenece a otro intento de login. Cerrá las pestañas anteriores del proveedor, reintentá y pegá el código nuevo.');
		}
		if (/^https?:\/\//i.test(pasted.trim())) {
			try {
				const cbUrl = new URL(pasted.trim());
				code = cbUrl.searchParams.get('code') ?? code;
				const cbState = cbUrl.searchParams.get('state');
				if (cbState && cbState !== state) {
					throw new Error('OAuth: el state del callback no coincide (posible CSRF); reintentá el login.');
				}
			} catch (e) {
				if (e instanceof Error && e.message.startsWith('OAuth:')) { throw e; }
				// malformed URL: carry on with the pasted text as the code
			}
		}

		const tokenParams: Record<string, string> = {
			grant_type: 'authorization_code',
			code,
			state,
			client_id: cfg.clientId,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		};
		if (cfg.resendChallengeOnToken) {
			tokenParams.code_challenge = challenge;      // xAI re-valida el challenge acá
			tokenParams.code_challenge_method = 'S256';
		}
		const json = await this.postToken(endpoints.tokenUrl || cfg.tokenUrl, tokenParams, cfg.tokenContentType === 'json', false, cfg.tokenUserAgent)
			.catch(async e => {
				// catalog fallback URLs (legacy Anthropic console)
				if (cfg.tokenUrlFallbacks?.length) {
					return this.postTokenWithFallback(cfg, tokenParams, cfg.tokenContentType === 'json');
				}
				throw e;
			});

		return this.toStored(json);
	}

	/** PKCE con redirect a http://localhost:<puerto>/oauth2callback (Google/Gemini CLI): el
	 *  ephemeral server lives in MAIN; the user authorizes in the browser and comes back by
	 *  themselves — no pasting codes. Google requires client_secret in the exchange even with PKCE. */
	private async loopbackFlow(entry: IProviderEntry): Promise<IStoredToken | undefined> {
		const cfg = entry.oauth!;
		if (!this.loopback) {
			throw new Error('OAuth loopback no disponible: falta el canal del host (openideAgentHost).');
		}
		const verifier = randomVerifier();
		const challenge = await challengeS256(verifier);
		const state = randomState();
		let loopbackOpts: IOAuthLoopbackStartOptions | undefined;
		if (cfg.redirectUri) {
			const parsed = new URL(cfg.redirectUri);
			loopbackOpts = { port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80), callbackPath: parsed.pathname };
		}
		const { id, port } = await this.loopback.start(loopbackOpts);
		const redirectUri = cfg.redirectUri ?? `http://localhost:${port}/oauth2callback`;
		try {
			const params = new URLSearchParams({
				client_id: cfg.clientId,
				response_type: 'code',
				redirect_uri: redirectUri,
				scope: cfg.scopes.join(' '),
				code_challenge: challenge,
				code_challenge_method: 'S256',
				state,
				...(cfg.authorizeExtraParams ?? {}),
			});
			await this.openerService.open(URI.parse(`${cfg.authorizationUrl}?${params.toString()}`));
			const cb = await this.loopback.wait(id, 5 * 60_000);
			if (cb.timedOut) {
				throw new Error('OAuth: no llegó el callback del navegador (5 min). Reintentá el login.');
			}
			if (cb.error) {
				throw new Error(`OAuth: el login devolvió "${cb.error}".`);
			}
			if (cb.state !== state) {
				throw new Error('OAuth: el state del callback no coincide (posible CSRF); reintentá el login.');
			}
			if (!cb.code) {
				throw new Error('OAuth: el callback no trajo código de autorización.');
			}
			const tokenParams: Record<string, string> = {
				grant_type: 'authorization_code',
				code: cb.code,
				client_id: cfg.clientId,
				redirect_uri: redirectUri,
				code_verifier: verifier,
			};
			if (cfg.clientSecret) {
				tokenParams.client_secret = cfg.clientSecret;
			}
			const json = await this.postToken(cfg.tokenUrl, tokenParams, cfg.tokenContentType === 'json', false, cfg.tokenUserAgent);
			return this.toStored(json);
		} finally {
			this.loopback.cancel(id).catch(() => { /* ya cerrado */ });
		}
	}

	/** Device-code CUSTOM de OpenAI (backend Codex): usercode → poll deviceauth/token →
	 *  authorization_code + code_verifier → standard exchange. This is not RFC 8628. */
	private async openaiDeviceFlow(entry: IProviderEntry, ix: IOAuthInteraction): Promise<IStoredToken | undefined> {
		const cfg = entry.oauth!;
		const start = await this.postToken(cfg.deviceAuthorizationUrl!, { client_id: cfg.clientId }, true);
		const userCode = String(start.user_code ?? '');
		const deviceAuthId = String(start.device_auth_id ?? '');
		if (!userCode || !deviceAuthId) {
			throw new Error('OAuth OpenAI: respuesta inesperada del device endpoint.');
		}
		const interval = Math.max(3, Number(start.interval) || 5) * 1000;
		const expiresAt = Date.now() + 15 * 60_000;

		await this.openerService.open(URI.parse('https://auth.openai.com/codex/device'));
		ix.showUserCode('https://auth.openai.com/codex/device', userCode);

		let grant: any;
		while (Date.now() < expiresAt) {
			await timeout(interval);
			if (ix.cancelled) {
				return undefined;
			}
			const res = await this.postToken(
				cfg.deviceAuthorizationUrl!.replace(/\/usercode$/, '/token'),
				{ device_auth_id: deviceAuthId, user_code: userCode }, true, true,
			);
			if (res.authorization_code) {
				grant = res;
				break;
			}
			// 403/404 = pending; any other error is tolerated and polling continues
		}
		if (!grant) {
			throw new Error('El código expiró antes de autorizar.');
		}
		const json = await this.postToken(cfg.tokenUrl, {
			grant_type: 'authorization_code',
			code: String(grant.authorization_code),
			redirect_uri: 'https://auth.openai.com/deviceauth/callback',
			client_id: cfg.clientId,
			code_verifier: String(grant.code_verifier ?? ''),
		}, false);
		return this.toStored(json);
	}

	/** Device-code CUSTOM de MiniMax: user_code + verification_uri, poll con grant user_code. */
	private async minimaxDeviceFlow(entry: IProviderEntry, ix: IOAuthInteraction): Promise<IStoredToken | undefined> {
		const cfg = entry.oauth!;
		const verifier = randomVerifier();
		const challenge = await challengeS256(verifier);
		const state = randomState();
		const start = await this.postToken(cfg.deviceAuthorizationUrl!, {
			response_type: 'code',
			client_id: cfg.clientId,
			scope: cfg.scopes.join(' '),
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state,
		}, true);
		if (start.state && start.state !== state) {
			throw new Error('OAuth MiniMax: state no coincide (posible CSRF).');
		}
		const userCode = String(start.user_code ?? '');
		const verificationUri = String(start.verification_uri ?? '');
		if (!userCode || !verificationUri) {
			throw new Error('OAuth MiniMax: respuesta inesperada del endpoint de código.');
		}
		// expired_in may be a TTL in seconds or a unix-ms timestamp (defensive parsing, per observed variants)
		const rawExp = Number(start.expired_in) || 600;
		const expiresAt = rawExp > 10_000_000 ? rawExp : Date.now() + rawExp * 1000;

		await this.openerService.open(URI.parse(verificationUri));
		ix.showUserCode(verificationUri, userCode);

		while (Date.now() < expiresAt) {
			await timeout(5000);
			if (ix.cancelled) {
				return undefined;
			}
			const res = await this.postToken(cfg.tokenUrl, {
				grant_type: 'urn:ietf:params:oauth:grant-type:user_code',
				client_id: cfg.clientId,
				user_code: userCode,
				code_verifier: verifier,
				state,
			}, true, true);
			if (res.access_token) {
				return this.toStored(res);
			}
		}
		throw new Error('El código expiró antes de autorizar.');
	}

	/** GET JSON simple (discovery OIDC). */
	private async getJson(url: string): Promise<any> {
		const ctx = await this.requestService.request({ type: 'GET', url, headers: { 'Accept': 'application/json' }, callSite: 'openideOAuth' }, CancellationToken.None);
		const text = await readText(ctx.stream);
		try { return JSON.parse(text); } catch { return {}; }
	}

	private async deviceFlow(entry: IProviderEntry, ix: IOAuthInteraction): Promise<IStoredToken | undefined> {
		const cfg = entry.oauth!;
		const useJson = cfg.tokenContentType === 'json';
		if (!cfg.deviceAuthorizationUrl) {
			throw new Error(`El provider "${entry.id}" no tiene deviceAuthorizationUrl.`);
		}
		const start = await this.postToken(cfg.deviceAuthorizationUrl, {
			client_id: cfg.clientId,
			scope: cfg.scopes.join(' '),
		}, useJson);

		const deviceCode = start.device_code;
		const userCode = start.user_code;
		const verificationUri = start.verification_uri_complete || start.verification_uri;
		const interval = (start.interval || 5) * 1000;
		const expiresAt = Date.now() + (start.expires_in || 600) * 1000;

		if (verificationUri) {
			await this.openerService.open(URI.parse(verificationUri));
		}
		// We show the code (non-blocking) so the user can enter it in the browser.
		ix.showUserCode(verificationUri, userCode);

		let pollInterval = interval;
		while (Date.now() < expiresAt) {
			await timeout(pollInterval);
			if (ix.cancelled) {
				return undefined;
			}
			let res: any;
			try {
				res = await this.postToken(cfg.tokenUrl, {
					grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
					device_code: deviceCode,
					client_id: cfg.clientId,
				}, useJson, true, cfg.tokenUserAgent);
			} catch {
				continue;
			}
			if (res.access_token) {
				return this.toStored(res);
			}
			if (res.error === 'slow_down') {
				pollInterval += 5000; // RFC 8628: el server pide bajar la frecuencia
				continue;
			}
			if (res.error && res.error !== 'authorization_pending') {
				throw new Error(`OAuth: ${res.error_description || res.error}`);
			}
		}
		throw new Error('El código expiró antes de autorizar.');
	}

	private async refresh(entry: IProviderEntry, refreshToken: string): Promise<IStoredToken> {
		const cfg = entry.oauth!;
		const endpoints = await this.resolveEndpoints(cfg);
		const params: Record<string, string> = {
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: cfg.clientId,
		};
		if (cfg.clientSecret) {
			params.client_secret = cfg.clientSecret; // Google lo exige también en el refresh
		}
		const json = cfg.tokenUrl
			? await this.postTokenWithFallback(cfg, params, cfg.tokenContentType === 'json')
			: await this.postToken(endpoints.tokenUrl, params, cfg.tokenContentType === 'json', false, cfg.tokenUserAgent);
		const stored = this.toStored(json);
		if (!stored.refreshToken) {
			stored.refreshToken = refreshToken; // algunos no rotan el refresh token
		}
		return stored;
	}

	// ---- GitHub Copilot: the device-code produces a GitHub token (ghu_*) that must be
	// EXCHANGED for an ephemeral Copilot JWT (~25 min) at copilot_internal/v2/token.
	// Cached in memory with a 120s buffer (defensive cache, copilot_auth.py). ----

	private _copilotCache: { token: string; expiresAt: number } | undefined;

	async getCopilotToken(entry: IProviderEntry): Promise<string> {
		if (this._copilotCache && Date.now() < this._copilotCache.expiresAt - 120_000) {
			return this._copilotCache.token;
		}
		const ghToken = await this.getValidToken(entry); // el ghu_* guardado por el device flow
		const ctx = await this.requestService.request({
			type: 'GET',
			url: 'https://api.github.com/copilot_internal/v2/token',
			headers: {
				'Authorization': `token ${ghToken}`,
				'Editor-Version': 'vscode/1.104.1',
				'User-Agent': 'GitHubCopilotChat/0.26.7',
				'Accept': 'application/json',
			},
			callSite: 'openideOAuth',
		}, CancellationToken.None);
		const text = await readText(ctx.stream);
		const status = ctx.res.statusCode ?? 0;
		if (status < 200 || status >= 300) {
			throw new Error(`Copilot token exchange ${status}: ${text.slice(0, 200)} — ¿tu cuenta tiene Copilot activo?`);
		}
		let json: any;
		try { json = JSON.parse(text); } catch { json = {}; }
		if (!json.token) {
			throw new Error('Copilot token exchange: respuesta sin token.');
		}
		this._copilotCache = {
			token: String(json.token),
			expiresAt: typeof json.expires_at === 'number' ? json.expires_at * 1000 : Date.now() + 20 * 60_000,
		};
		return this._copilotCache.token;
	}

	// ---- helpers ----

	private async postToken(url: string, params: Record<string, string>, useJson: boolean, tolerateError = false, userAgent?: string): Promise<any> {
		const headers: IHeaders = { 'Accept': 'application/json' };
		if (userAgent) {
			headers['User-Agent'] = userAgent;
		}
		let body: string;
		if (useJson) {
			headers['Content-Type'] = 'application/json';
			body = JSON.stringify(params);
		} else {
			headers['Content-Type'] = 'application/x-www-form-urlencoded';
			body = new URLSearchParams(params).toString();
		}
		const ctx = await this.requestService.request({ type: 'POST', url, headers, data: body, callSite: 'openideOAuth' }, CancellationToken.None);
		const text = await readText(ctx.stream);
		let json: any;
		try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
		const status = ctx.res.statusCode ?? 0;
		if ((status < 200 || status >= 300) && !tolerateError) {
			throw new Error(`OAuth ${status}: ${text.slice(0, 300)}`);
		}
		return json;
	}

	private toStored(json: any): IStoredToken {
		return {
			accessToken: json.access_token,
			refreshToken: json.refresh_token,
			expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
			account: identityFromTokenResponse(json),
		};
	}

	/** Who the stored session belongs to, when the provider said so. Sessions saved before the
	 *  identity was recorded have nothing stored, so the access token is read for it — which is
	 *  free for the JWT-based providers and simply finds nothing for the opaque ones. */
	async identity(providerId: string): Promise<string | undefined> {
		const stored = await this.read(providerId);
		if (!stored) { return undefined; }
		return stored.account ?? identityFromClaims(jwtClaims(stored.accessToken));
	}

	private async read(providerId: string): Promise<IStoredToken | undefined> {
		const raw = await this.secretStorage.get(SECRET_OAUTH_PREFIX + providerId);
		if (!raw) { return undefined; }
		try {
			const parsed = JSON.parse(raw) as IStoredToken;
			return parsed.accessToken ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	private async write(providerId: string, token: IStoredToken): Promise<void> {
		// A refresh response rarely repeats the identity — it only has to return a token. Dropping
		// what the sign-in learned would rename the account back to a number an hour later, so the
		// previous value carries over whenever the new one has nothing to say.
		const next = token.account ? token : { ...token, account: (await this.read(providerId))?.account };
		await this.secretStorage.set(SECRET_OAUTH_PREFIX + providerId, JSON.stringify(next));
	}
}
