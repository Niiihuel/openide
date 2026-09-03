/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — usage for the agent CLIs signed in on this machine, following Orca's roster
 *  (its main-process rate-limit service): Claude Code, Codex, Gemini CLI and Grok keep
 *  their OAuth session in a file under the home directory; whoever is signed into a CLI has a
 *  subscription worth showing next to the accounts connected inside OpenIDE. This service reads
 *  those files (parsing lives in `openideCliUsageAuth.ts`, tested) and reuses the SAME usage
 *  endpoints `IOpenideUsageService` already speaks. It never refreshes a CLI's token on disk:
 *  Anthropic/OpenAI rotate the refresh token on use, and rotating it here would sign the CLI
 *  out (Orca pays a hidden PTY for that; we say "open the CLI" instead). Google is the one
 *  exception — its refresh tokens do not rotate — so an expired Gemini token is refreshed
 *  IN MEMORY only, with the Gemini CLI's own public OAuth client.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { OPENIDE_REQUEST_CHANNEL, OpenideRequestChannelClient } from '../../../../platform/request/common/openideRequestIpc.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import {
	cliCredentialExpired,
	cliUsageAccountOf,
	ICliOAuthCredential,
	ICliUsageAccountDef,
	OPENIDE_CLI_USAGE_ACCOUNTS,
	parseCliCredential,
} from '../common/openideCliUsageAuth.js';
import { IProviderEntry } from '../common/openideProviderCatalog.js';
import { IProviderRateLimits } from '../common/openideUsage.js';
import { t } from '../common/openideStrings.js';
import { IOpenideUsageService } from './openideUsageService.js';

export const IOpenideCliUsageSource = createDecorator<IOpenideCliUsageSource>('openideCliUsageSource');

export interface IOpenideCliUsageSource {
	readonly _serviceBrand: undefined;
	/** The CLIs with a readable session on this machine, as catalog-shaped entries for the roster. */
	listAccounts(): Promise<IProviderEntry[]>;
	/** Usage for one CLI account, or undefined when its session is gone (the row drops). */
	getUsage(id: string, force?: boolean): Promise<IProviderRateLimits | undefined>;
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Gemini CLI's OAuth client (public by design — shipped in google-gemini/gemini-cli's source). */
const GEMINI_CLI_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GEMINI_CLI_CLIENT_SECRET = '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';

export class OpenideCliUsageSource extends Disposable implements IOpenideCliUsageSource {

	declare readonly _serviceBrand: undefined;

	private readonly net: IRequestService;
	/** Refreshed Gemini bearer, held in memory only (the file on disk stays the CLI's). */
	private geminiToken: { token: string; expiresAt: number } | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IOpenideUsageService private readonly usageService: IOpenideUsageService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		// Same MAIN channel as the usage service: no CORS, no bearer in the renderer log.
		this.net = new OpenideRequestChannelClient(mainProcessService.getChannel(OPENIDE_REQUEST_CHANNEL));
	}

	private credentialUri(def: ICliUsageAccountDef): URI {
		return URI.joinPath(this.pathService.userHome({ preferLocal: true }), ...def.credentialSegments);
	}

	private async readCredential(def: ICliUsageAccountDef): Promise<ICliOAuthCredential | undefined> {
		try {
			const content = await this.fileService.readFile(this.credentialUri(def));
			return parseCliCredential(def.kind, content.value.toString());
		} catch {
			// Missing file = the CLI was never signed in here; unreadable = same answer for us.
			return undefined;
		}
	}

	async listAccounts(): Promise<IProviderEntry[]> {
		const present = await Promise.all(OPENIDE_CLI_USAGE_ACCOUNTS.map(async def => {
			// An EXPIRED session still lists (Orca shows the row with the honest note); only a
			// missing or unreadable store means "not an account".
			return (await this.readCredential(def)) ? def : undefined;
		}));
		return present
			.filter((def): def is ICliUsageAccountDef => !!def)
			.map(def => ({ id: def.id, label: def.label, company: def.company, protocol: def.protocol, auth: 'oauth' as const }));
	}

	async getUsage(id: string, force = false): Promise<IProviderRateLimits | undefined> {
		const def = cliUsageAccountOf(id);
		if (!def) { return undefined; }
		const credential = await this.readCredential(def);
		if (!credential) { return undefined; }
		let token = credential.token;
		if (cliCredentialExpired(credential)) {
			if (def.kind === 'gemini' && credential.refreshToken) {
				const refreshed = await this.refreshGeminiToken(credential.refreshToken);
				if (!refreshed) { return this.expired(def); }
				token = refreshed;
			} else {
				return this.expired(def);
			}
		}
		switch (def.kind) {
			case 'anthropic': return this.usageService.fetchAnthropicOAuthUsage(id, token, { force });
			case 'codex': return this.usageService.fetchCodexOAuthUsage(id, token, { force });
			case 'grok': return this.usageService.fetchGrokOAuthUsage(id, token, { force });
			case 'gemini': return this.usageService.fetchGeminiQuota(id, token, { force });
		}
	}

	/** The CLI owns its refresh token; the honest row says whose terminal renews it. */
	private expired(def: ICliUsageAccountDef): IProviderRateLimits {
		return { providerId: def.id, fetchedAt: Date.now(), windows: [], status: 'error', failureKind: 'stale-token', error: t('usage.cliExpired', def.label) };
	}

	private async refreshGeminiToken(refreshToken: string): Promise<string | undefined> {
		if (this.geminiToken && this.geminiToken.expiresAt - Date.now() > 60_000) {
			return this.geminiToken.token;
		}
		try {
			const ctx = await this.net.request({
				type: 'POST',
				url: GOOGLE_TOKEN_URL,
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
				data: new URLSearchParams({
					client_id: GEMINI_CLI_CLIENT_ID,
					client_secret: GEMINI_CLI_CLIENT_SECRET,
					refresh_token: refreshToken,
					grant_type: 'refresh_token',
				}).toString(),
				callSite: 'openideCliUsageGemini',
			}, CancellationToken.None);
			const status = ctx.res.statusCode ?? 0;
			const text = (await asText(ctx)) ?? '';
			if (status < 200 || status >= 300) { return undefined; }
			const json = text ? JSON.parse(text) as { access_token?: unknown; expires_in?: unknown } : undefined;
			const token = typeof json?.access_token === 'string' && json.access_token ? json.access_token : undefined;
			if (!token) { return undefined; }
			const expiresIn = typeof json?.expires_in === 'number' && Number.isFinite(json.expires_in) ? json.expires_in : 3600;
			this.geminiToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
			return token;
		} catch {
			return undefined;
		}
	}
}

registerSingleton(IOpenideCliUsageSource, OpenideCliUsageSource, InstantiationType.Delayed);
