/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The last surfaces that were still calling VS Code's `localize()`: the chat dock's composer,
 * pickers and transcript parts, the inline edit review's chrome, the plan breadcrumb's Build
 * split, the usage popover, and the agent contribution's commands and editor names.
 *
 * `localize()` is the wrong mechanism for anything the fork adds. It resolves against a language
 * PACK, and no pack in the world ships translations for keys that only exist here — so whatever is
 * written as the default is what every user sees, in every locale. That produced both halves of
 * the same bug on one screen: "Ejecutando…" and "Razonamiento" in Spanish for a user running the
 * IDE in English, and "Thinking" / "Keep File" in English for a user running it in Spanish.
 *
 * Every key here carries both languages and is read through `t()`, which resolves against the same
 * IDE locale `localize()` does. Spread into the same `STRINGS` object as the rest, so `t()` and
 * `OpenideStringKey` still see one flat dictionary.
 */
export const OPENIDE_CHAT_SURFACE_STRINGS = {
	// ---- composer
	'chatSurface.composer.placeholder': { es: 'Plan, Build, / para skills, @ para contexto', en: 'Plan, Build, / for skills, @ for context' },
	'chatSurface.composer.aria': { es: 'Mensaje del chat de OpenIDE', en: 'OpenIDE chat message' },
	'chatSurface.composer.suggestHint': { es: '/{0} {1}', en: '/{0} {1}' },

	// ---- the model chip in the composer
	'chatSurface.model.unset': { es: 'Seleccionar modelo', en: 'Select model' },
	'chatSurface.model.fallback': { es: 'Modelo', en: 'Model' },

	// ---- queued messages
	'chatSurface.queue.image': { es: '(imagen)', en: '(image)' },
	'chatSurface.queue.one': { es: '1 pendiente', en: '1 queued' },
	'chatSurface.queue.many': { es: '{0} pendientes', en: '{0} queued' },

	// ---- voice dictation
	'chatSurface.voice.unsupported': { es: 'El proveedor activo no permite dictado por voz.', en: 'The active provider does not support voice dictation.' },
	'chatSurface.voice.usingModel': { es: '{0} · {1} · {2}', en: '{0} · {1} · {2}' },
	'chatSurface.voice.configure': { es: 'Configurar el dictado', en: 'Set up dictation' },
	'chatSurface.voice.startFailed': { es: 'No se pudo iniciar el dictado', en: 'Could not start dictation' },
	'chatSurface.voice.label': { es: 'Dictado', en: 'Dictation' },

	// ---- reasoning effort: the menu's heading and the two levels that are not proper names.
	// "Minimal", "Low", "Medium", "High", "Extra High" and "Max" stay identical in both languages
	// on purpose — they are the API's own values, and a user reading a provider's docs should find
	// the same word in the menu.
	'chatSurface.effort.section': { es: 'Razonamiento', en: 'Reasoning' },
	'chatSurface.effort.default': { es: 'Default del modelo', en: 'Model default' },
	'chatSurface.effort.none': { es: 'Sin razonamiento', en: 'No reasoning' },
	'chatSurface.effort.minimal': { es: 'Minimal', en: 'Minimal' },
	'chatSurface.effort.low': { es: 'Low', en: 'Low' },
	'chatSurface.effort.medium': { es: 'Medium', en: 'Medium' },
	'chatSurface.effort.high': { es: 'High', en: 'High' },
	'chatSurface.effort.xhigh': { es: 'Extra High', en: 'Extra High' },
	'chatSurface.effort.max': { es: 'Max', en: 'Max' },

	// ---- transcript list (screen-reader labels)
	'chatSurface.list.widget': { es: 'Transcripción del chat de OpenIDE', en: 'OpenIDE chat transcript' },
	'chatSurface.list.request': { es: 'Vos: {0}', en: 'You: {0}' },
	'chatSurface.list.response': { es: 'Asistente: {0}', en: 'Assistant: {0}' },

	// ---- mode and permission picker
	'chatSurface.mode.section': { es: 'Modo', en: 'Mode' },
	'chatSurface.mode.agent': { es: 'Edita y ejecuta', en: 'Edit and run' },
	'chatSurface.mode.plan': { es: 'Planificación en solo lectura', en: 'Read-only planning' },
	'chatSurface.mode.ask': { es: 'Preguntas y respuestas en solo lectura', en: 'Read-only Q&A' },
	'chatSurface.mode.debug': { es: 'Reproduce y corrige', en: 'Reproduce and fix' },
	'chatSurface.permission.section': { es: 'Permisos', en: 'Permissions' },
	'chatSurface.permission.ask': { es: 'Preguntar siempre', en: 'Always ask' },
	'chatSurface.permission.autoEdit': { es: 'Auto-aprobar ediciones', en: 'Auto-approve edits' },
	'chatSurface.permission.autoEditDesc': { es: 'Las ediciones de archivo se aplican solas; la terminal sigue preguntando.', en: 'File edits apply on their own; the terminal still asks.' },
	'chatSurface.permission.autoAll': { es: 'Auto-aprobar todo', en: 'Auto-approve everything' },
	'chatSurface.permission.autoAllDesc': { es: 'Todo se ejecuta sin preguntar, salvo lo peligroso y los archivos sensibles.', en: 'Everything runs without asking, except what is dangerous and sensitive files.' },

	// ---- model detail card
	'chatSurface.model.tools': { es: 'Uso de herramientas', en: 'Tool use' },
	'chatSurface.model.reasoning': { es: 'Razonamiento', en: 'Reasoning' },
	'chatSurface.model.capabilities': { es: 'Capacidades', en: 'Capabilities' },
	'chatSurface.model.input': { es: 'Entrada', en: 'Input' },
	'chatSurface.model.output': { es: 'Salida', en: 'Output' },
	'chatSurface.model.cost': { es: 'Costo ($/1M tokens)', en: 'Cost ($/1M tokens)' },

	// ---- model picker
	'chatSurface.model.search': { es: 'Buscar modelos…', en: 'Search models…' },
	'chatSurface.model.favorites': { es: 'Favoritos', en: 'Favorites' },
	'chatSurface.model.recents': { es: 'Recientes', en: 'Recent' },
	'chatSurface.model.noResults': { es: 'Sin resultados', en: 'No results' },
	'chatSurface.model.noProviders': { es: 'Sin proveedores conectados', en: 'No providers connected' },
	'chatSurface.model.star': { es: 'Marcar como favorito', en: 'Add to favorites' },
	'chatSurface.model.unstar': { es: 'Quitar de favoritos', en: 'Remove from favorites' },

	// ---- transcript parts
	'chatSurface.response.cancelled': { es: 'Turno cancelado.', en: 'Turn cancelled.' },
	'chatSurface.explore.error': { es: '{0} — error', en: '{0} — error' },
	'chatSurface.thinking': { es: 'Pensando', en: 'Thinking' },
	'chatSurface.thoughtBriefly': { es: 'Pensó un momento', en: 'Thought briefly' },
	'chatSurface.thoughtFor': { es: 'Pensó {0} s', en: 'Thought for {0}s' },
	'chatSurface.tool.cancelled': { es: 'Cancelado', en: 'Cancelled' },
	'chatSurface.tool.failed': { es: 'Falló', en: 'Failed' },
	'chatSurface.tool.result': { es: 'Resultado', en: 'Result' },
	'chatSurface.subagent.toolFailed': { es: 'Falló una herramienta', en: 'A tool failed' },
	'chatSurface.subagent.denied': { es: 'Permiso denegado', en: 'Permission denied' },
	'chatSurface.subagent.failed': { es: 'El especialista falló', en: 'The specialist failed' },

	// ---- inline approval card
	'chatSurface.approval.allow': { es: 'Permitir', en: 'Allow' },
	'chatSurface.approval.always': { es: 'Permitir siempre', en: 'Always allow' },
	'chatSurface.approval.deny': { es: 'Rechazar', en: 'Deny' },
	'chatSurface.approval.allowed': { es: 'Permitido', en: 'Allowed' },
	'chatSurface.approval.allowedAlways': { es: 'Permitido siempre', en: 'Always allowed' },
	'chatSurface.approval.denied': { es: 'Rechazado', en: 'Denied' },

	// ---- approval quick pick (the codicon prefixes are markup, not copy)
	'chatSurface.approve.once': { es: '$(check) Permitir una vez', en: '$(check) Allow once' },
	'chatSurface.approve.always': { es: '$(star-full) Permitir siempre', en: '$(star-full) Always allow' },
	'chatSurface.approve.sensitiveNote': { es: '(no disponible: path sensible)', en: '(unavailable: sensitive path)' },
	'chatSurface.approve.deny': { es: '$(x) Rechazar', en: '$(x) Deny' },
	'chatSurface.approve.execPlaceholder': { es: 'El agente quiere ejecutar: {0}', en: 'The agent wants to run: {0}' },
	'chatSurface.approve.usePlaceholder': { es: 'El agente quiere usar {0}', en: 'The agent wants to use {0}' },

	// ---- inline edit review (editor chrome)
	'chatSurface.review.prevBlock': { es: 'Bloque anterior', en: 'Previous block' },
	'chatSurface.review.nextBlock': { es: 'Bloque siguiente', en: 'Next block' },
	'chatSurface.review.undoBlock': { es: 'Deshacer', en: 'Undo' },
	'chatSurface.review.keepBlock': { es: 'Conservar', en: 'Keep' },
	'chatSurface.review.prevFile': { es: 'Archivo anterior', en: 'Previous file' },
	'chatSurface.review.nextFile': { es: 'Archivo siguiente', en: 'Next file' },
	'chatSurface.review.undoFile': { es: 'Deshacer archivo', en: 'Undo File' },
	'chatSurface.review.undoFileTip': { es: 'Deshacer todos los cambios del agente en este archivo', en: 'Undo all agent changes in this file' },
	'chatSurface.review.keepFile': { es: 'Conservar archivo', en: 'Keep File' },
	'chatSurface.review.keepFileTip': { es: 'Conservar todos los cambios del agente en este archivo', en: 'Keep all agent changes in this file' },
	'chatSurface.review.fileOf': { es: '{0} de {1} archivos', en: '{0} of {1} Files' },
	'chatSurface.review.oneFile': { es: '1 de 1 archivo', en: '1 of 1 File' },
	'chatSurface.review.blockOf': { es: '{0} de {1}', en: '{0} of {1}' },
	'chatSurface.review.noBlocks': { es: '0 de 0', en: '0 of 0' },

	// ---- plan breadcrumb's Build split
	'chatSurface.plan.modelPicker': { es: 'Modelo con el que se ejecuta el plan', en: 'Model the plan runs with' },
	'chatSurface.plan.modelSaveError': { es: 'No se pudo guardar el modelo del plan: {0}', en: 'Could not save the plan model: {0}' },
	'chatSurface.plan.modelUnset': { es: 'Elegir modelo', en: 'Pick model' },
	'chatSurface.plan.running': { es: 'Ejecutando…', en: 'Running…' },
	'chatSurface.plan.completed': { es: 'Finalizado', en: 'Done' },
	'chatSurface.plan.build': { es: 'Ejecutar el plan', en: 'Run the plan' },
	'chatSurface.plan.runAgain': { es: 'Ejecutar de nuevo', en: 'Run again' },
	'chatSurface.plan.openChat': { es: 'Abrir el chat', en: 'Open the chat' },

	// ---- usage popover
	'chatSurface.usage.title': { es: 'Uso', en: 'Usage' },
	'chatSurface.usage.refresh': { es: 'Actualizar ahora', en: 'Refresh now' },
	'chatSurface.usage.details': { es: 'Detalles de uso', en: 'Usage details' },
	'chatSurface.usage.accounts': { es: 'Administrar cuentas…', en: 'Manage accounts…' },
	'chatSurface.usage.updating': { es: 'actualizando…', en: 'updating…' },
	'chatSurface.usage.updatedAgo': { es: 'actualizado {0}', en: 'updated {0}' },
	'chatSurface.usage.loading': { es: 'Consultando las cuentas…', en: 'Querying the accounts…' },
	'chatSurface.usage.noAccounts': { es: 'No hay cuentas conectadas.', en: 'No accounts connected.' },
	'chatSurface.usage.balance': { es: 'Saldo', en: 'Balance' },
	'chatSurface.usage.spent': { es: '{0} gastados', en: '{0} spent' },
	'chatSurface.usage.noData': { es: 'Sin datos de uso', en: 'No usage data' },
	'chatSurface.usage.retry': { es: 'reintenta {0}', en: 'retry {0}' },

	// ---- the status bar entry (openideChatView)
	'chatSurface.status.working': { es: 'Trabajando…', en: 'Working…' },
	'chatSurface.status.workingAria': { es: 'OpenIDE Agent: trabajando', en: 'OpenIDE Agent: working' },
	'chatSurface.status.noProviderShort': { es: 'sin proveedor', en: 'no provider' },
	'chatSurface.status.connect': { es: 'Conectar proveedor de IA', en: 'Connect an AI provider' },
	'chatSurface.status.connectAria': { es: 'OpenIDE Agent: sin proveedor conectado', en: 'OpenIDE Agent: no provider connected' },
	'chatSurface.status.connectTooltip': { es: 'No hay proveedor de IA conectado — abrí la página de proveedores para conectar una cuenta o API key.', en: 'No AI provider is connected — open the providers page to connect an account or API key.' },

	// ---- editor names and commands of the agent contribution. "Project Map", "Plan" and "Canvas"
	// are the editors' own names and stay identical in both languages.
	'chatSurface.editor.projectMap': { es: 'Project Map', en: 'Project Map' },
	'chatSurface.editor.plan': { es: 'Plan', en: 'Plan' },
	'chatSurface.editor.subagent': { es: 'Subagente', en: 'Subagent' },
	'chatSurface.editor.canvas': { es: 'Canvas', en: 'Canvas' },
	'chatSurface.container.chat': { es: 'OpenIDE Chat', en: 'OpenIDE Chat' },
	'chatSurface.cmd.memoryOpen': { es: 'OpenIDE: Abrir Project Map', en: 'OpenIDE: Open Project Map' },
	'chatSurface.cmd.memoryRebuild': { es: 'OpenIDE: Reconstruir la memoria del codebase', en: 'OpenIDE: Rebuild Codebase Memory' },
	'chatSurface.cmd.memoryClear': { es: 'OpenIDE: Borrar la memoria del codebase', en: 'OpenIDE: Clear Codebase Memory' },
	'chatSurface.cmd.memoryStatus': { es: 'OpenIDE: Estado de la memoria del codebase', en: 'OpenIDE: Codebase Memory Status' },
	'chatSurface.cmd.subagentCreate': { es: 'OpenIDE: Crear subagente', en: 'OpenIDE: Create Subagent' },
	'chatSurface.cmd.subagentOpenEditor': { es: 'OpenIDE: Abrir el editor de subagentes', en: 'OpenIDE: Open Subagent Editor' },
	'chatSurface.cmd.subagentOpenText': { es: 'OpenIDE: Abrir el subagente como texto', en: 'OpenIDE: Open Subagent as Text' },
	'chatSurface.mcp.reloadDone': { es: 'MCP: {0}', en: 'MCP: {0}' },
	'chatSurface.language.migrate': { es: 'OpenIDE ahora usa un solo idioma para toda la interfaz. ¿Cambiar la IDE a {0}?', en: 'OpenIDE now uses a single display language for the whole interface. Switch the IDE to {0}?' },
	'chatSurface.language.migrateYes': { es: 'Cambiar el idioma de la interfaz', en: 'Change display language' },
	'chatSurface.language.deprecatedDesc': { es: 'Obsoleto. OpenIDE ahora dibuja sus propias pantallas en el idioma de la interfaz, así que Configuración › Idioma mueve todo a la vez.', en: 'Deprecated. OpenIDE now renders its own screens in the display language, so Settings › Language moves the whole interface at once.' },
	'chatSurface.language.deprecatedMessage': { es: 'Usá el idioma de la interfaz (Configuración › Idioma). OpenIDE lo sigue para sus propias pantallas.', en: 'Use the display language instead (Settings › Language). OpenIDE follows it for its own screens.' },
} as const;
