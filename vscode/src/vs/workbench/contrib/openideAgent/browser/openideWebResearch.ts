/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — headless tools for searching and reading the public web, separate from the localhost preview.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IOpenideAgentHostService } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { canonicalWebUrl, stripWebHtml } from '../../../../platform/openideAgentHost/common/openideWebResearch.js';
import { IAgentTool } from './openideTools.js';

interface IWebSearchItem { readonly title: string; readonly url: string; readonly snippet: string }

export class OpenideWebResearch {
	constructor(private readonly client: IOpenideAgentHostService, private readonly configurationService: IConfigurationService) { }

	buildTools(): IAgentTool[] { return [this.searchTool(), this.fetchTool()]; }

	private enabled(): boolean { return this.configurationService.getValue<boolean>('openide.agent.web.enabled') !== false; }
	private requestOptions(url: string) {
		return {
			url,
			timeoutMs: Math.max(1, Number(this.configurationService.getValue('openide.agent.web.timeoutSeconds')) || 15) * 1000,
			maxBytes: Number(this.configurationService.getValue('openide.agent.web.maxResponseBytes')) || 2_000_000,
			allowHttp: this.configurationService.getValue<boolean>('openide.agent.web.allowHttp') === true,
			allowedHosts: this.configurationService.getValue<string[]>('openide.agent.web.allowedHosts') ?? [],
			blockedHosts: this.configurationService.getValue<string[]>('openide.agent.web.blockedHosts') ?? [],
		};
	}

	private searchTool(): IAgentTool {
		return {
			risk: 'safe',
			def: { name: 'web_search', description: 'Busca información actual en la web pública sin abrir el browser local. Devuelve resultados citables [S1], [S2] con título, URL y snippet. Usala para documentación, noticias, APIs y hechos que requieran fuentes actuales.', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number', minimum: 1, maximum: 10 } }, required: ['query'] } },
			invoke: async (args: any, token: CancellationToken) => {
				if (!this.enabled()) { return 'Error: exploración web deshabilitada (openide.agent.web.enabled).'; }
				if (token?.isCancellationRequested) { return 'Error: búsqueda web cancelada.'; }
				const query = String(args?.query ?? '').trim().slice(0, 2_000); if (!query) { return 'Error: query web vacía.'; }
				const endpoint = String(this.configurationService.getValue('openide.agent.web.searchEndpoint') ?? '').trim();
				if (!endpoint) { return 'Error: configurá openide.agent.web.searchEndpoint con un endpoint JSON de búsqueda.'; }
				const url = new URL(endpoint); url.searchParams.set('q', query); url.searchParams.set('limit', String(Math.max(1, Math.min(10, Number(args?.max_results) || 5))));
				try {
					const response = await this.client.webFetch(this.requestOptions(url.toString()));
					if (token?.isCancellationRequested) { return 'Error: búsqueda web cancelada.'; }
					const items = this.parseSearchJson(response.body).slice(0, Math.max(1, Math.min(10, Number(args?.max_results) || 5)));
					if (!items.length) { return 'Sin resultados web.'; }
					return items.map((item, index) => `[S${index + 1}] ${item.title}\n${item.url}${item.snippet ? `\n${item.snippet}` : ''}`).join('\n\n');
				} catch (error) { return `Error: búsqueda web falló — ${error instanceof Error ? error.message : String(error)}`; }
			},
		};
	}

	private fetchTool(): IAgentTool {
		return {
			risk: 'safe',
			def: { name: 'web_fetch', description: 'Descarga y extrae texto de una URL web pública con protección SSRF, redirects y límites. No abre ni comparte cookies del browser local. Devuelve una fuente citable [W1].', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
			invoke: async (args: any, token: CancellationToken) => {
				if (!this.enabled()) { return 'Error: exploración web deshabilitada (openide.agent.web.enabled).'; }
				if (token?.isCancellationRequested) { return 'Error: lectura web cancelada.'; }
				try {
					const response = await this.client.webFetch(this.requestOptions(String(args?.url ?? '')));
					if (token?.isCancellationRequested) { return 'Error: lectura web cancelada.'; }
					const maxChars = Number(this.configurationService.getValue('openide.agent.web.maxExtractedChars')) || 60_000;
					const extracted = response.contentType === 'text/html' ? stripWebHtml(response.body, maxChars) : { title: '', text: response.body.slice(0, maxChars) };
					return `[W1] ${extracted.title || canonicalWebUrl(response.url)}\n${canonicalWebUrl(response.url)}\n\n${extracted.text}`;
				} catch (error) { return `Error: lectura web falló — ${error instanceof Error ? error.message : String(error)}`; }
			},
		};
	}

	private parseSearchJson(raw: string): IWebSearchItem[] {
		let parsed: any; try { parsed = JSON.parse(raw); } catch { throw new Error('el endpoint devolvió JSON inválido'); }
		const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed?.items) ? parsed.items : [];
		return candidates.flatMap((item: any) => {
			if (!item || typeof item !== 'object') { return []; }
			const rawUrl = String(item.url ?? item.link ?? '').trim(); if (!rawUrl) { return []; }
			let url: string; try { url = canonicalWebUrl(rawUrl); } catch { return []; }
			return [{ title: String(item.title ?? item.name ?? url).replace(/\s+/g, ' ').trim().slice(0, 500), url, snippet: String(item.snippet ?? item.description ?? item.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 1_500) }];
		});
	}
}
