/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The renderer services' user-visible messages: OAuth sign-in prompts and errors, the provider
 * usage/quota failures painted in the usage popover and the providers card, the MCP reload
 * summary, the Project Map index timeout, the hook consent picker and the composer queue notice.
 *
 * They used to be inline Spanish literals (or `localize()` calls with Spanish as the SOURCE,
 * which no language pack can ever match). They live here, behind `t()`, so both languages ship.
 *
 * Every key is namespaced under `service.` so this module can be spread into `openideStrings.ts`
 * alongside the other surface dictionaries without any chance of a key collision.
 */
export const OPENIDE_SERVICE_STRINGS = {
	// ---- OAuth engine (openideOAuth.ts): quick-input prompts and the errors that reach
	// notificationService or the Settings providers card.
	'service.oauth.notSignedIn': { es: 'No iniciaste sesión en "{0}".', en: 'You are not signed in to "{0}".' },
	'service.oauth.cannotRefresh': { es: 'La sesión de "{0}" no se puede renovar. Iniciá sesión de nuevo.', en: 'The session for "{0}" cannot be refreshed. Sign in again.' },
	'service.oauth.noConfig': { es: 'El provider "{0}" no tiene config OAuth.', en: 'Provider "{0}" has no OAuth config.' },
	'service.oauth.devicePrompt': { es: 'Abrí {0} e ingresá el código: {1}', en: 'Open {0} and enter the code: {1}' },
	'service.oauth.pastePrompt': { es: 'Autorizá en el navegador y pegá acá el código (o la URL completa de redirección) que te devuelve {0}', en: 'Authorise in the browser and paste here the code (or the full redirect URL) that {0} gives you back' },
	'service.oauth.pastedCodeMismatch': { es: 'OAuth: el código pegado pertenece a otro intento de login. Cerrá las pestañas anteriores del proveedor, reintentá y pegá el código nuevo.', en: 'OAuth: the pasted code belongs to a different login attempt. Close the provider\'s earlier tabs, retry, and paste the new code.' },
	'service.oauth.stateMismatch': { es: 'OAuth: el state del callback no coincide (posible CSRF); reintentá el login.', en: 'OAuth: the callback state does not match (possible CSRF); retry the login.' },
	'service.oauth.callbackTimeout': { es: 'OAuth: no llegó el callback del navegador (5 min). Reintentá el login.', en: 'OAuth: the browser callback never arrived (5 min). Retry the login.' },
	'service.oauth.loginError': { es: 'OAuth: el login devolvió "{0}".', en: 'OAuth: the login returned "{0}".' },
	'service.oauth.noCode': { es: 'OAuth: el callback no trajo código de autorización.', en: 'OAuth: the callback carried no authorization code.' },
	'service.oauth.codeExpired': { es: 'El código expiró antes de autorizar.', en: 'The code expired before it was authorised.' },
	'service.oauth.minimaxStateMismatch': { es: 'OAuth MiniMax: state no coincide (posible CSRF).', en: 'MiniMax OAuth: the state does not match (possible CSRF).' },
	'service.oauth.minimaxBadResponse': { es: 'OAuth MiniMax: respuesta inesperada del endpoint de código.', en: 'MiniMax OAuth: unexpected response from the code endpoint.' },
	'service.oauth.copilotExchange': { es: 'Copilot token exchange {0}: {1} — ¿tu cuenta tiene Copilot activo?', en: 'Copilot token exchange {0}: {1} — is Copilot active on your account?' },
	'service.oauth.copilotNoToken': { es: 'Copilot token exchange: respuesta sin token.', en: 'Copilot token exchange: response carried no token.' },

	// ---- Usage / quota service (openideUsageService.ts): the `error` field of IProviderRateLimits,
	// painted in the usage popover and in the providers settings card.
	'service.usage.noTokenQuota': { es: 'Sin token OAuth para consultar la cuota.', en: 'No OAuth token to check the quota.' },
	'service.usage.noTokenUsage': { es: 'Sin token OAuth para consultar usage.', en: 'No OAuth token to check usage.' },
	'service.usage.noApiKeyCredits': { es: 'Sin API key para consultar los créditos.', en: 'No API key to check the credits.' },
	'service.usage.googleSessionCodeAssist': { es: 'La sesión de Google expiró o no tiene permiso para Code Assist.', en: 'The Google session expired or has no permission for Code Assist.' },
	'service.usage.googleCodeAssistHttp': { es: 'Google Code Assist respondió HTTP {0}.', en: 'Google Code Assist answered HTTP {0}.' },
	'service.usage.googleNotOnboarded': { es: 'La cuenta todavía no tiene proyecto de Code Assist: mandá un mensaje con este proveedor y volvé a consultar.', en: 'The account has no Code Assist project yet: send a message with this provider and check again.' },
	'service.usage.googleSessionQuota': { es: 'La sesión de Google expiró o no tiene permiso para leer la cuota.', en: 'The Google session expired or has no permission to read the quota.' },
	'service.usage.googleQuotaHttp': { es: 'Google no devolvió la cuota (HTTP {0}).', en: 'Google did not return the quota (HTTP {0}).' },
	'service.usage.googleQuotaUnreadable': { es: 'Google devolvió una cuota que no se pudo leer.', en: 'Google returned a quota that could not be read.' },
	'service.usage.googleQuotaUnreachable': { es: 'No se pudo consultar la cuota de Google (red o servicio caído).', en: 'Could not check the Google quota (network or service down).' },
	'service.usage.openRouterRejectedKey': { es: 'OpenRouter rechazó la API key.', en: 'OpenRouter rejected the API key.' },
	'service.usage.openRouterCreditsHttp': { es: 'OpenRouter no devolvió los créditos (HTTP {0}).', en: 'OpenRouter did not return the credits (HTTP {0}).' },
	'service.usage.openRouterUnreadable': { es: 'OpenRouter devolvió una respuesta que no se pudo leer.', en: 'OpenRouter returned a response that could not be read.' },
	'service.usage.openRouterUnreachable': { es: 'No se pudo consultar los créditos de OpenRouter.', en: 'Could not check the OpenRouter credits.' },
	'service.usage.unavailableSession': { es: 'Usage no disponible (sesión OAuth sin permiso o expirada).', en: 'Usage unavailable (OAuth session without permission, or expired).' },
	'service.usage.unavailableHttp': { es: 'Usage no disponible (HTTP {0}).', en: 'Usage unavailable (HTTP {0}).' },
	'service.usage.nonJson': { es: 'Usage: respuesta no-JSON del provider.', en: 'Usage: non-JSON response from the provider.' },
	'service.usage.unreachable': { es: 'No se pudo consultar usage (red o provider caído).', en: 'Could not check usage (network or provider down).' },
	'service.usage.codexExpired': { es: 'Usage de Codex no disponible (sesión expirada).', en: 'Codex usage unavailable (session expired).' },
	'service.usage.codexHttp': { es: 'Usage de Codex no disponible (HTTP {0}).', en: 'Codex usage unavailable (HTTP {0}).' },
	'service.usage.codexUnreachable': { es: 'No se pudo consultar usage de Codex.', en: 'Could not check Codex usage.' },
	'service.usage.grokExpired': { es: 'Usage de Grok no disponible (sesión expirada).', en: 'Grok usage unavailable (session expired).' },
	'service.usage.grokUnreachable': { es: 'No se pudo consultar usage de Grok.', en: 'Could not check Grok usage.' },

	// ---- MCP reload (openideAgentMcp.ts): the summary its callers hand to notificationService.
	'service.mcp.disabled': { es: 'MCP está deshabilitado (openide.agent.mcp.enabled).', en: 'MCP is disabled (openide.agent.mcp.enabled).' },
	'service.mcp.registryNotReady': { es: 'El registry de tools todavía no está listo.', en: 'The tool registry is not ready yet.' },
	'service.mcp.noServers': { es: 'Sin servers MCP configurados (.openide/mcp.json del proyecto o global del perfil).', en: 'No MCP servers configured (the project\'s .openide/mcp.json, or the profile\'s global one).' },
	'service.mcp.summary': { es: '{0} server(s) conectado(s), {1} tool(s) registrada(s).', en: '{0} server(s) connected, {1} tool(s) registered.' },
	'service.mcp.summaryErrors': { es: '{0} Errores: {1}', en: '{0} Errors: {1}' },

	// ---- Project Map index (openideCodebaseMemoryService.ts). {0} is the Rebuild button's own
	// label, so the message always names the button the user actually sees.
	'service.projectMap.initTimeout': { es: 'El índice del Project Map no respondió a tiempo. Reintentá con "{0}".', en: 'The Project Map index did not answer in time. Retry with "{0}".' },

	// ---- Hook consent picker and hook block reason (openideAgentHooks.ts).
	'service.hooks.blockedDefault': { es: 'bloqueado por un hook del usuario', en: 'blocked by a user hook' },
	'service.hooks.allowAlways': { es: '$(star-full) Permitir siempre', en: '$(star-full) Always allow' },
	'service.hooks.deny': { es: '$(x) Denegar', en: '$(x) Deny' },
	'service.hooks.consentTitle': { es: 'Hook del agente ({0})', en: 'Agent hook ({0})' },
	'service.hooks.consentPh': { es: '"{0}" corre con tus credenciales completas. ¿Permitir?', en: '"{0}" runs with your full credentials. Allow it?' },

	// ---- Composer queue (openideChatComposerQueue.ts).
	'service.chat.queue.full': { es: 'La cola de esta conversación llegó a 20 mensajes. Enviá, editá o quitá uno antes de agregar otro.', en: 'This conversation\'s queue reached 20 messages. Send, edit or remove one before adding another.' },
} as const;
