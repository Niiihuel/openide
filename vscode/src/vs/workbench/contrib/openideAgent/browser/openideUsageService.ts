/*---------------------------------------------------------------------------------------------
 *  OpenIDE — servicio de usage/billing OAuth por provider.
 *  Scope inicial: Anthropic OAuth → GET https://api.anthropic.com/api/oauth/usage.
 *  Nunca loguea ni expone el bearer token.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { OPENIDE_REQUEST_CHANNEL, OpenideRequestChannelClient } from '../../../../platform/request/common/openideRequestIpc.js';
import {
	IProviderRateLimits,
	normalizeAnthropicUsageJson,
	providerSupportsAnthropicUsage,
} from '../common/openideUsage.js';

export const IOpenideUsageService = createDecorator<IOpenideUsageService>('openideUsageService');

export interface IOpenideUsageService {
	readonly _serviceBrand: undefined;
	/** Usage cacheado o undefined si nunca se consultó / no aplica. */
	getCached(providerId: string): IProviderRateLimits | undefined;
	/** Invalida el cache de un provider (o de todos). */
	invalidate(providerId?: string): void;
	/**
	 * Consulta usage del provider. `accessToken` es el bearer OAuth ya resuelto por el caller
	 * (el servicio NO toca SecretStorage). Devuelve ventanas normalizadas o error suave.
	 */
	fetchAnthropicOAuthUsage(providerId: string, accessToken: string, opts?: { force?: boolean }): Promise<IProviderRateLimits>;
	/** Helper: ¿este entry del catálogo soporta el endpoint de usage Anthropic? */
	supportsProvider(entry: { protocol?: string; auth?: string; baseUrl?: string; id?: string } | undefined): boolean;
}

const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
/** Cache corto: evita martillar billing en cada expand de la fila. */
const CACHE_TTL_MS = 60_000;

export class OpenideUsageService extends Disposable implements IOpenideUsageService {

	declare readonly _serviceBrand: undefined;

	private readonly net: IRequestService;
	private readonly cache = new Map<string, IProviderRateLimits>();

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		// Mismo canal MAIN que OAuth/providers: sin CORS y sin filtrar el bearer al renderer log.
		this.net = new OpenideRequestChannelClient(mainProcessService.getChannel(OPENIDE_REQUEST_CHANNEL));
	}

	supportsProvider(entry: { protocol?: string; auth?: string; baseUrl?: string; id?: string } | undefined): boolean {
		return providerSupportsAnthropicUsage(entry);
	}

	getCached(providerId: string): IProviderRateLimits | undefined {
		const hit = this.cache.get(providerId);
		if (!hit) {
			return undefined;
		}
		if (Date.now() - hit.fetchedAt > CACHE_TTL_MS) {
			return undefined;
		}
		return hit;
	}

	invalidate(providerId?: string): void {
		if (!providerId) {
			this.cache.clear();
			return;
		}
		this.cache.delete(providerId);
	}

	async fetchAnthropicOAuthUsage(providerId: string, accessToken: string, opts?: { force?: boolean }): Promise<IProviderRateLimits> {
		const token = (accessToken ?? '').trim();
		if (!providerId || !token) {
			return { providerId, fetchedAt: Date.now(), windows: [], error: 'Sin token OAuth para consultar usage.' };
		}
		if (!opts?.force) {
			const cached = this.getCached(providerId);
			if (cached && !cached.error) {
				return cached;
			}
		}
		try {
			const ctx = await this.net.request({
				type: 'GET',
				url: ANTHROPIC_USAGE_URL,
				headers: {
					'Authorization': `Bearer ${token}`,
					'anthropic-beta': 'oauth-2025-04-20',
					'User-Agent': 'claude-code/2.1.0',
					'Accept': 'application/json',
				},
				callSite: 'openideUsageAnthropic',
			}, CancellationToken.None);
			const status = ctx.res.statusCode ?? 0;
			const text = (await asText(ctx)) ?? '';
			if (status < 200 || status >= 300) {
				// No incluir body crudo si pudiera filtrar PII; mensaje corto alcanza.
				const result: IProviderRateLimits = {
					providerId,
					fetchedAt: Date.now(),
					windows: [],
					error: status === 401 || status === 403
						? 'Usage no disponible (sesión OAuth sin permiso o expirada).'
						: `Usage no disponible (HTTP ${status}).`,
				};
				this.cache.set(providerId, result);
				return result;
			}
			let json: unknown;
			try {
				json = text ? JSON.parse(text) : null;
			} catch {
				const bad: IProviderRateLimits = {
					providerId,
					fetchedAt: Date.now(),
					windows: [],
					error: 'Usage: respuesta no-JSON del provider.',
				};
				this.cache.set(providerId, bad);
				return bad;
			}
			const normalized = normalizeAnthropicUsageJson(json, providerId);
			this.cache.set(providerId, normalized);
			return normalized;
		} catch {
			const fail: IProviderRateLimits = {
				providerId,
				fetchedAt: Date.now(),
				windows: [],
				error: 'No se pudo consultar usage (red o provider caído).',
			};
			this.cache.set(providerId, fail);
			return fail;
		}
	}
}

registerSingleton(IOpenideUsageService, OpenideUsageService, InstantiationType.Delayed);
