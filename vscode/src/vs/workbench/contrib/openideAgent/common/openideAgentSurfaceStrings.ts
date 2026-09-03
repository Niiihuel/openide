/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Strings for the user-facing surfaces of the agent engine (`openideAgentService`): the usage
 * popover's failure reasons, the tool approval cards, the plan target/Build errors, the Pick &
 * Polish picker, voice dictation, the chat's info/error cards and the compaction status.
 *
 * They are NOT model-facing: everything the model reads (system prompts, tool descriptions, tool
 * return values) stays an inline English literal in the service. Spread into the same `STRINGS`
 * object as the rest so `t()` and `OpenideStringKey` still see one flat dictionary.
 */
export const OPENIDE_AGENT_SURFACE_STRINGS = {
	// ---- usage popover / credentials
	'agentSurface.usage.oauthNoToken': { es: 'La sesión OAuth no tiene token vigente.', en: 'The OAuth session has no valid token.' },
	'agentSurface.usage.credentialFailed': { es: 'No se pudo resolver la credencial para consultar el uso.', en: 'Could not resolve the credential to query usage.' },
	'agentSurface.secrets.basicStoreLinuxOnly': { es: 'El almacenamiento local de credenciales solo está disponible en Linux cuando el keyring del sistema no está disponible.', en: 'Local credential storage is only available on Linux when the system keyring is unavailable.' },

	// ---- checkpoint rollback
	'agentSurface.rollback.outsideWorkspace': { es: 'No se puede restaurar fuera del workspace: {0}', en: 'Cannot restore outside the workspace: {0}' },

	// ---- tool approval cards
	'agentSurface.approval.mcpRun': { es: 'Ejecutar herramienta MCP', en: 'Run MCP tool' },
	'agentSurface.approval.subagentUpdate': { es: 'Actualizar Subagente', en: 'Update Subagent' },
	'agentSurface.approval.subagentCreate': { es: 'Crear Subagente', en: 'Create Subagent' },
	'agentSurface.approval.ruleDelete': { es: 'Eliminar Rule', en: 'Delete Rule' },
	'agentSurface.approval.ruleSave': { es: 'Guardar Rule', en: 'Save Rule' },
	'agentSurface.approval.gitNewBranch': { es: ' — rama nueva {0}', en: ' — new branch {0}' },
	'agentSurface.approval.gitFileCount': { es: '{0} archivo(s)', en: '{0} file(s)' },
	'agentSurface.approval.gitNoFiles': { es: 'sin archivos', en: 'no files' },
	'agentSurface.approval.gitNoPush': { es: 'Sin push automático.', en: 'No automatic push.' },
	'agentSurface.approval.gitCommitCommand': { es: 'git add -- <archivos> && git commit', en: 'git add -- <files> && git commit' },
	'agentSurface.scope.user': { es: 'usuario', en: 'user' },
	'agentSurface.scope.project': { es: 'proyecto', en: 'project' },

	// ---- plan target / Build
	'agentSurface.plan.providerNotConnected': { es: 'Provider no conectado: {0}.', en: 'Provider not connected: {0}.' },
	'agentSurface.plan.modelUnavailable': { es: 'Modelo no disponible en {0}: {1}.', en: 'Model not available in {0}: {1}.' },
	'agentSurface.plan.buildOnlyPlans': { es: 'Build sólo admite planes bajo .openide/plans/*.md.', en: 'Build only accepts plans under .openide/plans/*.md.' },
	'agentSurface.plan.providerDisconnected': { es: 'El provider del plan ya no está conectado: {0}.', en: 'The plan provider is no longer connected: {0}.' },
	'agentSurface.plan.planModelUnavailable': { es: 'El modelo del plan no está disponible en {0}: {1}.', en: 'The plan model is not available in {0}: {1}.' },
	'agentSurface.plan.targetChanged': { es: 'El target del plan cambió mientras se preparaba el Build; volvé a ejecutarlo.', en: 'The plan target changed while the Build was being prepared; run it again.' },
	'agentSurface.value.noProvider': { es: '(sin provider)', en: '(no provider)' },
	'agentSurface.value.emptyModel': { es: '(vacío)', en: '(empty)' },
	'agentSurface.value.noModel': { es: '(sin modelo)', en: '(no model)' },

	// ---- Pick & Polish
	'agentSurface.picker.urlNotAllowed': { es: 'URL no permitida: el picker es solo para apps locales (localhost, 127.0.0.1, *.localhost o la allowlist).', en: 'URL not allowed: the picker only works with local apps (localhost, 127.0.0.1, *.localhost or the allowlist).' },
	'agentSurface.picker.previewNotLoaded': { es: 'La vista previa no cargó (¿el server local está corriendo?).', en: 'The preview did not load (is the local server running?).' },
	'agentSurface.picker.failed': { es: 'El picker falló.', en: 'The picker failed.' },

	// ---- voice dictation
	'agentSurface.voice.settingFormat': { es: 'openide.agent.voiceModel debe tener formato "provider/modelo".', en: 'openide.agent.voiceModel must use the format "provider/model".' },
	'agentSurface.voice.selectProvider': { es: 'Seleccioná un proveedor conectado para habilitar el dictado.', en: 'Select a connected provider to enable dictation.' },
	'agentSurface.voice.noTranscriptionModel': { es: '{0} no declara un modelo de transcripción compatible.', en: '{0} does not declare a compatible transcription model.' },
	'agentSurface.voice.noAudioProtocol': { es: '{0} no ofrece dictado por el protocolo de audio compatible.', en: '{0} does not offer dictation over the supported audio protocol.' },
	'agentSurface.voice.connectProvider': { es: 'Conectá {0} para usar dictado por voz.', en: 'Connect {0} to use voice dictation.' },
	'agentSurface.voice.notAvailable': { es: 'El proveedor activo no permite dictado por voz.', en: 'The active provider does not support voice dictation.' },
	'agentSurface.voice.transcriptionFailed': { es: 'La transcripción falló (HTTP {0}){1}', en: 'Transcription failed (HTTP {0}){1}' },
	'agentSurface.voice.emptyTranscription': { es: 'El modelo no devolvió transcripción.', en: 'The model returned no transcription.' },

	// ---- chat info/error cards
	'agentSurface.chat.staleTimeout': { es: 'el provider no emitió eventos durante {0}s ({1}).', en: 'the provider emitted no events for {0}s ({1}).' },
	'agentSurface.chat.noFunctionCalling': { es: '{0} no admite function calling en este endpoint; reintentando sin tools.', en: '{0} does not support function calling on this endpoint; retrying without tools.' },
	'agentSurface.chat.noProviderConnected': { es: 'No tenés ningún proveedor de IA conectado. Conectá una cuenta (OAuth) o pegá una API key para empezar.', en: 'You have no AI provider connected. Connect an account (OAuth) or paste an API key to get started.' },
	'agentSurface.chat.modelMigrated': { es: 'El modelo {0} ya no está disponible en {1}; usando {2}.', en: 'Model {0} is no longer available in {1}; using {2}.' },
	'agentSurface.chat.noClientTools': { es: '{0} no admite tools del cliente. OpenIDE continuará en modo conversación; para editar, ejecutar o delegar elegí un modelo con function calling.', en: '{0} does not support client tools. OpenIDE will continue in conversation mode; to edit, run or delegate, pick a model with function calling.' },
	'agentSurface.chat.sealedToolCalls': { es: 'Se cerraron {0} llamada(s) a herramientas que habían quedado sin resultado por una cancelación previa.', en: 'Closed {0} tool call(s) that an earlier cancellation had left without a result.' },
	'agentSurface.chat.imagesRejected': { es: 'El modelo rechazó las imágenes; reintentando con referencias textuales para no perder el resto del turno.', en: 'The model rejected the images; retrying with text references so the rest of the turn is not lost.' },
	'agentSurface.chat.outputLimitContinued': { es: 'La respuesta alcanzó el límite de salida del modelo; OpenIDE la continúa automáticamente.', en: 'The answer hit the model output limit; OpenIDE continues it automatically.' },
	'agentSurface.chat.nimEmptyHint': { es: ' El modelo no emitió texto ni tools (ya se reintentó sin tools). En NVIDIA NIM no todos los modelos soportan modo agente: probá meta/llama-3.3-70b-instruct, nvidia/nemotron-3-nano-30b-a3b, deepseek-ai/deepseek-v4-flash u openai/gpt-oss-20b.', en: ' The model emitted neither text nor tools (it was already retried without tools). On NVIDIA NIM not every model supports agent mode: try meta/llama-3.3-70b-instruct, nvidia/nemotron-3-nano-30b-a3b, deepseek-ai/deepseek-v4-flash or openai/gpt-oss-20b.' },
	'agentSurface.chat.emptyResponse': { es: 'El modelo respondió vacío{0}.{1}', en: 'The model returned an empty response{0}.{1}' },
	'agentSurface.chat.toolLoopWarning': { es: 'La herramienta "{0}" repitió exactamente la misma llamada 3 veces; se bloqueará si vuelve a ocurrir.', en: 'The "{0}" tool repeated exactly the same call 3 times; it will be blocked if it happens again.' },
	'agentSurface.chat.iterationLimit': { es: 'La tarea sigue en curso: se alcanzaron los {0} ciclos de este turno. Nada se perdió — continuá para seguir desde donde quedó. Si te pasa seguido, subí openide.agent.maxAgentIterations.', en: 'The task is still in progress: this turn reached its {0} cycles. Nothing was lost — continue to pick up where it left off. If this happens often, raise openide.agent.maxAgentIterations.' },
	'agentSurface.chat.oauthRefreshing': { es: 'La sesión OAuth de "{0}" venció o fue revocada; renovando el token y reintentando…', en: 'The OAuth session for "{0}" expired or was revoked; refreshing the token and retrying…' },
	'agentSurface.chat.oauthRefreshFailed': { es: 'No se pudo renovar la sesión OAuth automáticamente: {0}', en: 'Could not refresh the OAuth session automatically: {0}' },

	// ---- subagent card
	'agentSurface.subagent.reviewPrompt': { es: 'Revisión aislada del diff actual', en: 'Isolated review of the current diff' },

	// ---- context compaction
	'agentSurface.compaction.notEnoughHistory': { es: 'Todavía no hay suficiente historial para compactar.', en: 'There is not enough history to compact yet.' },
	'agentSurface.compaction.emptySummary': { es: 'el modelo devolvió un resumen vacío o demasiado corto', en: 'the model returned an empty or too short summary' },
	'agentSurface.compaction.auxModelFailed': { es: 'El modelo auxiliar de compactación falló; reintentando con el modelo activo.', en: 'The auxiliary compaction model failed; retrying with the active model.' },
	'agentSurface.compaction.failed': { es: 'No se pudo compactar el contexto; se conserva el historial completo. {0}', en: 'Could not compact the context; the full history is kept. {0}' },
	'agentSurface.compaction.deterministicFallback': { es: 'La compactación del modelo falló; se aplicó una recuperación determinista para poder continuar.', en: 'Model compaction failed; a deterministic fallback was applied so work can continue.' },
	'agentSurface.compaction.lowSavings': { es: 'La compactación no liberó suficiente contexto; se pausaron nuevos intentos para evitar un ciclo.', en: 'Compaction did not free enough context; further attempts were paused to avoid a loop.' },
} as const;
