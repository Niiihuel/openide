/*---------------------------------------------------------------------------------------------
 *  OpenIDE — lógica de la página "Proveedores de IA", separada del EditorPane visual que la
 *  aloja. El host provee el overlay webview (que puede no existir todavía — getter en vivo),
 *  el contenedor para anclar el hover nativo, y cómo abrir
 *  un archivo cerrando la superficie actual. La page mueve TODO lo demás: buildHtml, postState,
 *  handleMessage, el OAuth inline y el bridge de tooltips [data-tip] → IHoverService.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { IOAuthInteraction } from './openideOAuth.js';
import { getOpenideProvidersHtml } from './openideProvidersHtml.js';
import { buildCodiconCss } from './openideWebviewCodicons.js';
import { OpenideSkillInstallScope } from './openideSkillInstallerInput.js';

/** Superficie que hostea la página: el webview y el
 *  contenedor son getters EN VIVO (en el ctor del pane todavía no existen). */
export interface IOpenidePageHost {
	readonly webview: IOverlayWebview | undefined;
	readonly hoverContainer: HTMLElement | undefined;
	/** Abre un archivo en un editor NORMAL, cerrando antes la superficie actual (si tapa). */
	openFileAndClose(uri: URI): Promise<void>;
	/** Cierra la superficie modal actual antes de transferir el foco a otra parte del workbench. */
	closeCurrent(): Promise<void>;
	/** Abre el instalador de Skills dentro del modal editor nativo del workbench. */
	openSkillInstaller?(scope: OpenideSkillInstallScope): Promise<void>;
}

/** Sesión OAuth en curso disparada desde la página (una por vez; la nueva cancela la vieja). */
interface IOAuthSession {
	readonly providerId: string;
	cancelled: boolean;
	pendingPaste?: DeferredPromise<string | undefined>;
}

export class OpenideProvidersPage extends Disposable {

	private oauthSession: IOAuthSession | undefined;
	// Tooltip NATIVO para los [data-tip] del webview (mismo bridge que el chat).
	private hoverAnchor: HTMLElement | undefined;
	private activeHover: { dispose(): void } | undefined;

	constructor(
		private readonly host: IOpenidePageHost,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IFileService private readonly fileService: IFileService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IHoverService private readonly hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		// Credenciales/config pueden cambiar desde afuera (wizard del palette, settings) — refrescar.
		this._register(this.agentService.onDidChange(() => this.postState()));
	}

	private get webview(): IOverlayWebview | undefined {
		return this.host.webview;
	}

	async buildHtml(embedded = false): Promise<string> {
		const codiconCss = await buildCodiconCss(this.fileService);
		return getOpenideProvidersHtml(generateUuid().replace(/-/g, ''), codiconCss, embedded);
	}

	/** Corta el OAuth en curso y esconde el tooltip — para cuando la superficie se oculta/cierra. */
	reset(): void {
		this.cancelOAuth();
		this.hideNativeTip();
	}

	/** Hover NATIVO del workbench sobre un rect del webview (bridge [data-tip]). */
	private showNativeTip(text: string, x: number, y: number, w: number, h: number): void {
		const container = this.host.hoverContainer;
		if (!container || !text) {
			return;
		}
		if (!this.hoverAnchor) {
			this.hoverAnchor = container.ownerDocument.createElement('div');
			this.hoverAnchor.style.position = 'absolute';
			this.hoverAnchor.style.pointerEvents = 'none';
		}
		// el contenedor puede cambiar entre montajes (sección del Settings) — re-anclar
		if (this.hoverAnchor.parentElement !== container) {
			container.appendChild(this.hoverAnchor);
		}
		const a = this.hoverAnchor;
		a.style.left = `${Math.round(x)}px`;
		a.style.top = `${Math.round(y)}px`;
		a.style.width = `${Math.max(1, Math.round(w))}px`;
		a.style.height = `${Math.max(1, Math.round(h))}px`;
		this.activeHover?.dispose();
		this.activeHover = this.hoverService.showInstantHover({
			content: text,
			target: a,
			appearance: { compact: true, showPointer: true },
		}, false);
	}

	private hideNativeTip(): void {
		this.activeHover?.dispose();
		this.activeHover = undefined;
	}

	async handleMessage(msg: any): Promise<void> {
			switch (msg.type) {
			case 'ready':
				await this.postState();
				break;
			case 'navigateAgentSettings':
				await this.navigateAgentSettings(String(msg.target ?? ''));
				break;
			case 'connect':
				this.startOAuth(String(msg.id ?? ''));
				break;
			case 'oauthPaste':
				this.oauthSession?.pendingPaste?.complete(String(msg.value ?? '') || undefined);
				break;
			case 'oauthCancel':
				this.cancelOAuth();
				break;
			case 'saveKey': {
				const id = String(msg.id ?? '');
				const key = String(msg.key ?? '').trim();
				if (id && key) {
					await this.agentService.setApiKey(id, key);
					this.webview?.postMessage({ type: 'keySaved', id });
					await this.postState();
				}
				break;
			}
			case 'clearKey':
				await this.agentService.clearApiKey(String(msg.id ?? ''));
				await this.postState();
				break;
			case 'activate': {
				const id = String(msg.id ?? '');
				if (id) {
					await this.agentService.setActiveProvider(id);
					await this.agentService.setModel(String(msg.model ?? ''));
					await this.postState();
				}
				break;
			}
			case 'signOut':
				await this.agentService.signOut(String(msg.id ?? ''));
				await this.postState();
				break;
			case 'openUrl': {
				const url = String(msg.url ?? '');
				if (/^https?:\/\//i.test(url)) {
					this.openerService.open(URI.parse(url));
				}
				break;
			}
			case 'copy':
				await this.clipboardService.writeText(String(msg.text ?? ''));
				break;
			case 'tip':
				this.showNativeTip(String(msg.text ?? ''), Number(msg.x) || 0, Number(msg.y) || 0, Number(msg.w) || 0, Number(msg.h) || 0);
				break;
			case 'tipHide':
				this.hideNativeTip();
				break;
			case 'enableBasicPasswordStore':
				await this.agentService.enableBasicPasswordStore();
				break;
			case 'refreshUsage': {
				const id = String(msg.id ?? '');
				if (id) {
					await this.postUsage(id, true);
				}
				break;
			}
		}
	}

	private async navigateAgentSettings(target: string): Promise<void> {
		if (target === 'providers') {
			return;
		}
		if (target === 'extensions') {
			await this.commandService.executeCommand('openide.agent.openExtensions');
			return;
		}
		await this.commandService.executeCommand('openide.agent.openSettings', target);
	}

	/** Estado completo de la página: catálogo + conexión/keys por proveedor + activo/modelo. */
	async postState(): Promise<void> {
		const webview = this.webview;
		if (!webview) {
			return;
		}
		const entries = this.agentService.listProviders();
		const providers = await Promise.all(entries.map(async p => {
			let connected = false;
			let hasKey = false;
			try {
				connected = await this.agentService.isConnected(p.id);
				hasKey = p.auth === 'apiKey' ? await this.agentService.hasApiKey(p.id) : false;
			} catch {
				// sin credencial legible → desconectado
			}
			// supportsUsage: el webview muestra UsageBar + refresh solo si aplica.
			const supportsUsage = connected && p.auth === 'oauth' && p.protocol === 'anthropic'
				&& (!(p.baseUrl) || /api\.anthropic\.com|claude\.com/i.test(p.baseUrl) || p.id === 'anthropic' || p.id === 'anthropic-oauth' || p.id === 'claude');
			return {
				id: p.id,
				label: p.label,
				company: p.company,
				auth: p.auth,
				protocol: p.protocol,
				blurb: p.blurb ?? '',
				connected,
				hasKey,
				supportsUsage,
				models: await this.agentService.resolveProviderModels(p),
				defaultModel: p.defaultModel ?? '',
				apiKeysUrl: p.apiKeysUrl ?? '',
				oauthHint: p.oauthHint ?? '',
				oauthHintUrl: p.oauthHintUrl ?? '',
			};
		}));
		webview.postMessage({
			type: 'state',
			activeId: this.agentService.getActiveProviderId(),
			model: this.agentService.getModel(),
			providers,
			secretsPersistence: await this.agentService.getSecretsPersistence(),
			canEnableBasicPasswordStore: await this.agentService.canEnableBasicPasswordStore(),
		});
		// Usage bajo demanda: no bloquea el paint inicial; cada provider OAuth Anthropic se hidrata.
		for (const p of providers) {
			if (p.supportsUsage) {
				void this.postUsage(p.id, false);
			}
		}
	}

	/** Consulta usage y lo manda al webview (sin tokens). */
	private async postUsage(providerId: string, force: boolean): Promise<void> {
		const webview = this.webview;
		if (!webview || !providerId) {
			return;
		}
		webview.postMessage({ type: 'usageLoading', id: providerId, loading: true });
		try {
			const usage = await this.agentService.getProviderUsage(providerId, force);
			webview.postMessage({
				type: 'usage',
				id: providerId,
				usage: usage ? {
					providerId: usage.providerId,
					fetchedAt: usage.fetchedAt,
					error: usage.error,
					windows: usage.windows.map(w => ({
						label: w.label,
						usedPercent: w.usedPercent,
						limitMinutes: w.limitMinutes,
						resetsAt: w.resetsAt,
						resetDescription: w.resetDescription,
					})),
				} : null,
			});
		} catch (err) {
			webview.postMessage({
				type: 'usage',
				id: providerId,
				usage: {
					providerId,
					fetchedAt: Date.now(),
					windows: [],
					error: err instanceof Error ? err.message : String(err),
				},
			});
		} finally {
			webview.postMessage({ type: 'usageLoading', id: providerId, loading: false });
		}
	}

	/** Arranca el OAuth de un proveedor con la interacción INLINE (código/paste en la página). */
	private startOAuth(providerId: string): void {
		if (!providerId) {
			return;
		}
		this.cancelOAuth(); // una sesión por vez: la nueva corta el polling de la anterior
		const session: IOAuthSession = { providerId, cancelled: false };
		this.oauthSession = session;

		const interaction: IOAuthInteraction = {
			showUserCode: (url, code) => {
				if (!session.cancelled) {
					this.webview?.postMessage({ type: 'oauth', id: providerId, phase: 'code', url, code });
				}
			},
			promptCode: prompt => {
				if (session.cancelled) {
					return Promise.resolve(undefined);
				}
				session.pendingPaste = new DeferredPromise<string | undefined>();
				this.webview?.postMessage({ type: 'oauth', id: providerId, phase: 'paste', prompt });
				return session.pendingPaste.p;
			},
			get cancelled() { return session.cancelled; },
		};

		this.agentService.signIn(providerId, interaction).then(ok => {
			if (session.cancelled) {
				return;
			}
			if (ok) {
				this.webview?.postMessage({ type: 'oauth', id: providerId, phase: 'done' });
			} else {
				this.webview?.postMessage({ type: 'oauth', id: providerId, phase: 'error', message: 'Inicio de sesión cancelado o código expirado.' });
			}
			this.oauthSession = undefined;
			this.postState();
		}, err => {
			if (!session.cancelled) {
				this.webview?.postMessage({ type: 'oauth', id: providerId, phase: 'error', message: err instanceof Error ? err.message : String(err) });
				this.oauthSession = undefined;
			}
		});
	}

	private cancelOAuth(): void {
		const session = this.oauthSession;
		if (session) {
			session.cancelled = true;
			session.pendingPaste?.complete(undefined);
			this.oauthSession = undefined;
		}
	}

	override dispose(): void {
		this.reset();
		super.dispose();
	}
}
