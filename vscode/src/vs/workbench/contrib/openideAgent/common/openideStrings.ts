/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { language as ideLocale } from '../../../../base/common/platform.js';
import { OPENIDE_SETTINGS_STRINGS } from './openideSettingsStrings.js';

/**
 * The fork's own UI strings (chat dock, settings, project map, plan, providers), in the two
 * languages the product ships. VS Code's `localize()` serves the NATIVE workbench through
 * language packs; these are the strings OpenIDE adds on top, which no language pack covers.
 *
 * THE IDE LOCALE IS THE ONLY SWITCH. `t()` reads the same `platform.language` that `localize()`
 * resolves against, so one setting moves the whole interface.
 *
 * There used to be a second switch — `openide.language` — that moved only these strings, live and
 * without a restart. It sounded better and was worse: the native surfaces still needed a restart,
 * so between the two switches the interface sat in a half-translated state, which is precisely
 * the bug the switch existed to fix. VS Code asks for a restart to change language and that is
 * the accepted norm; with one switch, that one restart leaves EVERYTHING in the same language.
 * The setting survives only as a migration alias (`openideAgent.contribution.ts`).
 */

/** @deprecated Migration alias only — see `OpenideLanguageMigrationContribution`. */
export const OPENIDE_LANGUAGE_SETTING = 'openide.language';

export type OpenideLanguage = 'es' | 'en';
export type OpenideLanguageSetting = 'auto' | OpenideLanguage;

const STRINGS = {
	// The Settings sections' vocabulary lives in its own module: 325 entries would have tripled
	// this file. Spread here so `t()` and `OpenideStringKey` still see one flat dictionary.
	...OPENIDE_SETTINGS_STRINGS,
	// ---- chat composer footer / session info (upstream chat-secondary-toolbar + ChatContextUsageDetails)
	'chat.footer.approvals': { es: 'Aprobaciones', en: 'Approvals' },
	'chat.footer.approvals.tip': { es: 'Política de aprobación de ediciones y comandos', en: 'Approval policy for edits and commands' },
	'chat.footer.context.tip': { es: 'Ventana de contexto: información de la sesión', en: 'Context window: session info' },
	// Working indicator. These were `localize()` with Spanish defaults, which is what mixed the two
	// languages on screen: `localize()` returns its DEFAULT when no language pack supplies a
	// translation, so an English IDE rendered "Pensando" right next to English labels served by
	// `t()`. Surfaces the fork invents have no language pack behind them — they belong here.
	// ---- Fork-owned surfaces that were calling `localize()` with a Spanish default, which is
	// what rendered Spanish inside an English IDE: nls returns the DEFAULT when no language
	// pack covers a string, and no pack will ever cover a screen upstream does not have.
	'hooks.allowSession': { es: '$(check) Permitir durante esta sesión', en: '$(check) Allow for this session' },
	'hooks.consentDrift': { es: 'Hook modificado desde su aprobación ({0})', en: 'Hook changed since it was approved ({0})' },
	'approve.session': { es: '$(history) Permitir durante esta sesión', en: '$(history) Allow for this session' },
	'plan.runningTitle': { es: 'El agente está ejecutando el plan', en: 'The agent is running the plan' },
	'plan.stop': { es: 'Detener la ejecución del plan', en: 'Stop running the plan' },
	'plan.completedTitle': { es: 'El plan terminó de ejecutarse', en: 'The plan finished running' },
	'plan.runAgainTitle': { es: 'El plan ya se ejecutó; volver a ejecutarlo', en: 'The plan already ran; run it again' },
	'usage.disabled': { es: 'El uso de cuentas está desactivado (openide.agent.usage.enabled).', en: 'Account usage is disabled (openide.agent.usage.enabled).' },
	'usage.stale': { es: 'Datos de hace un rato; se actualizan en el próximo ciclo.', en: 'Data is a little old; it refreshes on the next cycle.' },
	'usage.failed': { es: 'La consulta falló.', en: 'The query failed.' },
	'usage.cliExpired': { es: 'La sesión de {0} expiró: abrí la CLI para renovarla.', en: 'The {0} session expired: open the CLI to renew it.' },
	'usage.alsoFrom': { es: 'también {0}', en: 'also {0}' },
	'usage.alsoFromTitle': { es: 'La misma cuenta está conectada por {0}. Es una sola suscripción, con un solo límite: por eso va en una sola fila.', en: 'The same account is also connected through {0}. It is one subscription with one limit, which is why it is a single row.' },
	'usage.pending': { es: 'Todavía sin consultar.', en: 'Not queried yet.' },
	'chat.voice.release': { es: 'Soltá para transcribir', en: 'Release to transcribe' },
	'chat.voice.preparing': { es: 'Preparando micrófono…', en: 'Preparing microphone…' },
	'chat.voice.hold': { es: 'Mantené apretado para dictar', en: 'Hold to dictate' },
	'chat.voice.noCapture': { es: 'La captura de micrófono no está disponible en esta ventana.', en: 'Microphone capture is not available in this window.' },
	'chat.voice.empty': { es: 'No se grabó audio.', en: 'No audio was recorded.' },
	'chat.voice.tooBig': { es: 'La grabación supera el máximo de 25 MB.', en: 'The recording is over the 25 MB limit.' },
	'chat.queue.afterPlan': { es: 'Después del plan', en: 'After the plan' },
	'chat.code.copy': { es: 'Copiar código', en: 'Copy code' },
	'chat.permission.ask.desc': { es: 'Cada edición y comando pide aprobación (lo más seguro).', en: 'Every edit and command asks for approval (the safest option).' },
	'chat.permission.tip': { es: 'Política de aprobación de ediciones y comandos', en: 'Approval policy for edits and commands' },
	'chat.model.addProvider': { es: 'Añadir nuevo proveedor', en: 'Add new provider' },
	'chat.request.rollback': { es: 'Volver acá (editar y reenviar desde este punto)', en: 'Back to here (edit and resend from this point)' },
	'chat.approval.session': { es: 'Permitir esta sesión', en: 'Allow this session' },
	'chat.approval.allowedSession': { es: 'Permitido esta sesión', en: 'Allowed this session' },
	// ---- Project Map. A surface the fork invents, so no language pack will ever translate it:
	// it belongs in this dictionary rather than in nls with a Spanish default, which is what made
	// it render Spanish inside an English IDE.
	'projectMap.search.placeholder': { es: 'Buscar archivos, símbolos, módulos…', en: 'Search files, symbols, modules…' },
	'projectMap.search.aria': { es: 'Buscar en el mapa', en: 'Search the map' },
	'projectMap.search.clear': { es: 'Limpiar búsqueda', en: 'Clear search' },
	'projectMap.rebuild': { es: 'Reconstruir el índice', en: 'Rebuild the index' },
	'projectMap.rebuilding': { es: 'Reconstruyendo el índice…', en: 'Rebuilding the index…' },
	'projectMap.modules': { es: 'Módulos', en: 'Modules' },
	'projectMap.modules.showAll': { es: 'Mostrar todos los módulos', en: 'Show all modules' },
	'projectMap.modules.all': { es: 'todos', en: 'all' },
	'projectMap.modules.expand': { es: 'Expandir módulos', en: 'Expand modules' },
	'projectMap.modules.collapse': { es: 'Compactar módulos', en: 'Collapse modules' },
	'projectMap.empty': { es: 'Todavía no hay memoria del codebase para este workspace.', en: 'There is no codebase memory for this workspace yet.' },
	'projectMap.build': { es: 'Construir el índice', en: 'Build the index' },
	'projectMap.status.counts': { es: '{0} archivos · {1} relaciones · {2} módulos', en: '{0} files · {1} relations · {2} modules' },
	'projectMap.status.truncated': { es: ' · {0} fuera de vista', en: ' · {0} out of view' },
	'projectMap.root': { es: 'raíz', en: 'root' },
	'projectMap.relations': { es: 'Relaciones · {0}', en: 'Relations · {0}' },
	'projectMap.defines.one': { es: 'Define 1 símbolo', en: 'Defines 1 symbol' },
	'projectMap.defines.many': { es: 'Define {0} símbolos', en: 'Defines {0} symbols' },
	'projectMap.noRelations': { es: 'Sin relaciones registradas', en: 'No relations recorded' },
	'projectMap.analyzing': { es: 'El agente está analizando…', en: 'The agent is analyzing…' },
	'projectMap.analysis': { es: 'Análisis del agente', en: 'Agent analysis' },
	'projectMap.analyzePrompt': { es: 'Analizá el nodo {0} ({1}) y sus relaciones de arquitectura, callers, callees, dependencias y tests relacionados.', en: 'Analyse node {0} ({1}) and its architecture relations, callers, callees, dependencies and related tests.' },
	// Project Map cards: the head itself is the toggle, so the chevron's tooltip is generic
	// unless a panel supplies its own.
	'projectMap.card.collapse': { es: 'Compactar', en: 'Collapse' },
	'projectMap.card.expand': { es: 'Expandir', en: 'Expand' },
	'projectMap.scope': { es: 'Alcance', en: 'Scope' },
	'projectMap.scope.collapse': { es: 'Compactar el alcance y el estado', en: 'Collapse scope and status' },
	'projectMap.scope.expand': { es: 'Mostrar el alcance y el estado', en: 'Show scope and status' },
	'projectMap.loading': { es: 'Cargando el mapa…', en: 'Loading the map…' },
	'projectMap.walking': { es: 'Recorriendo {0}/{1}', en: 'Walking {0}/{1}' },
	'projectMap.indexing': { es: 'Indexando {0}/{1}', en: 'Indexing {0}/{1}' },
	'projectMap.noResults': { es: 'Sin resultados', en: 'No results' },
	'projectMap.inspector': { es: 'Nodo', en: 'Node' },
	'projectMap.inspector.close': { es: 'Cerrar el nodo', en: 'Close node' },
	'projectMap.inspector.collapse': { es: 'Compactar el detalle del nodo', en: 'Collapse node detail' },
	'projectMap.inspector.expand': { es: 'Mostrar el detalle del nodo', en: 'Show node detail' },
	'projectMap.open': { es: 'Abrir archivo', en: 'Open file' },
	'projectMap.copyPath': { es: 'Copiar ruta', en: 'Copy path' },
	'projectMap.copied': { es: 'Ruta copiada', en: 'Path copied' },
	'projectMap.ask': { es: 'Preguntar al agente', en: 'Ask the agent' },
	'projectMap.connections': { es: '{0} conexiones', en: '{0} connections' },
	'projectMap.connections.one': { es: '1 conexión', en: '1 connection' },
	'projectMap.godRank': { es: 'nodo #{0}', en: 'node #{0}' },
	'projectMap.outgoing': { es: 'Salientes', en: 'Outgoing' },
	'projectMap.incoming': { es: 'Entrantes', en: 'Incoming' },
	'projectMap.relationsLoading': { es: 'Relaciones · …', en: 'Relations · …' },
	'projectMap.module.tip': { es: '{0} · {1} archivos. Click: aislar. Ctrl+click: ocultar.', en: '{0} · {1} files. Click: isolate. Ctrl+click: hide.' },
	'projectMap.zoomIn': { es: 'Acercar', en: 'Zoom in' },
	'projectMap.zoomOut': { es: 'Alejar', en: 'Zoom out' },
	'projectMap.fit': { es: 'Ajustar a la vista', en: 'Fit to view' },
	// Relation labels: these used to be a Spanish-only map inside the editor.
	'projectMap.rel.IMPORTS': { es: 'importa', en: 'imports' },
	'projectMap.rel.EXPORTS': { es: 'exporta', en: 'exports' },
	'projectMap.rel.DEPENDS_ON': { es: 'depende de', en: 'depends on' },
	'projectMap.rel.CALLS': { es: 'llama a', en: 'calls' },
	'projectMap.rel.CALLED_BY': { es: 'llamado por', en: 'called by' },
	'projectMap.rel.REFERENCES': { es: 'referencia', en: 'references' },
	'projectMap.rel.USES': { es: 'usa', en: 'uses' },
	'projectMap.rel.INHERITS': { es: 'hereda de', en: 'inherits from' },
	'projectMap.rel.IMPLEMENTS': { es: 'implementa', en: 'implements' },
	'projectMap.rel.OVERRIDES': { es: 'sobrescribe', en: 'overrides' },
	'projectMap.rel.INSTANTIATES': { es: 'instancia', en: 'instantiates' },
	'projectMap.rel.READS': { es: 'lee', en: 'reads' },
	'projectMap.rel.WRITES': { es: 'escribe', en: 'writes' },
	'projectMap.rel.TESTS': { es: 'testea', en: 'tests' },
	'projectMap.rel.TESTED_BY': { es: 'testeado por', en: 'tested by' },
	'projectMap.rel.ROUTES_TO': { es: 'enruta a', en: 'routes to' },
	'projectMap.rel.CONFIGURES': { es: 'configura', en: 'configures' },
	'projectMap.rel.RELATED_TO': { es: 'relacionado con', en: 'related to' },
	'projectMap.rel.CONTAINS': { es: 'contiene', en: 'contains' },
	'projectMap.rel.DEFINES': { es: 'define', en: 'defines' },
	'projectMap.rel.ANNOTATES': { es: 'anota', en: 'annotates' },
	// ---- editor visual de estilos (Pick & Polish)
	'style.title': { es: 'Estilos', en: 'Styles' },
	'style.empty': { es: 'Ningún elemento seleccionado.', en: 'No element selected.' },
	'style.emptyHint': { es: 'Usá el selector visual sobre tu app en la vista previa y editá sus estilos acá, sin escribir CSS a mano.', en: 'Use the visual picker over your app in the preview and edit its styles here, without writing CSS by hand.' },
	'style.emptyAction': { es: 'Seleccionar un elemento', en: 'Pick an element' },
	'style.value': { es: 'Valor', en: 'Value' },
	'style.unit': { es: 'Unidad', en: 'Unit' },
	'style.alpha': { es: 'Opacidad del color', en: 'Colour opacity' },
	'style.pickColor': { es: 'Elegir color', en: 'Pick a colour' },
	'style.reset': { es: 'Descartar los cambios', en: 'Discard the changes' },
	'style.resetOne': { es: 'Volver al valor original', en: 'Back to the original value' },
	'style.toSource': { es: 'Llevar al código', en: 'Take to the source' },
	'style.toSourceTip': { es: 'Le pide al agente que aplique estos cambios en el código fuente, no solo en la vista previa.', en: 'Asks the agent to apply these changes in the source code, not just in the preview.' },
	'style.edits': { es: '{0} cambios', en: '{0} changes' },
	'style.edits.one': { es: '1 cambio', en: '1 change' },
	'style.noEdits': { es: 'Sin cambios', en: 'No changes' },
	'style.live': { es: 'Los cambios se ven en vivo en la vista previa; todavía no tocan el código.', en: 'Changes show live in the preview; they do not touch the code yet.' },
	'style.applyFailed': { es: 'No se pudo aplicar en la vista previa: {0}', en: 'Could not apply it in the preview: {0}' },
	'style.sourcePrompt': { es: 'En la vista previa ajusté estos estilos del elemento `{0}` de {1}:\n\n```css\n{0} {\n  {2}\n}\n```\n\nLlevá exactamente estos cambios al código fuente (buscá el elemento por su clase, texto o test id) y dejá el resultado equivalente, respetando el sistema de estilos que ya usa el proyecto.', en: 'In the preview I adjusted these styles of the `{0}` element of {1}:\n\n```css\n{0} {\n  {2}\n}\n```\n\nTake exactly these changes to the source code (find the element by its class, text or test id) and leave an equivalent result, respecting the styling system the project already uses.' },
	'style.group.layout': { es: 'Disposición', en: 'Layout' },
	'style.group.spacing': { es: 'Espaciado', en: 'Spacing' },
	'style.group.typography': { es: 'Tipografía', en: 'Typography' },
	'style.group.colors': { es: 'Colores', en: 'Colours' },
	'style.group.border': { es: 'Borde', en: 'Border' },
	'style.group.effects': { es: 'Efectos', en: 'Effects' },
	'style.box.padding': { es: 'Padding', en: 'Padding' },
	'style.box.margin': { es: 'Margin', en: 'Margin' },
	'style.box.border-width': { es: 'Grosor', en: 'Width' },
	'style.box.border-radius': { es: 'Radio', en: 'Radius' },
	'style.display': { es: 'display', en: 'display' },
	'style.flexDirection': { es: 'dirección', en: 'direction' },
	'style.justifyContent': { es: 'justificar', en: 'justify' },
	'style.alignItems': { es: 'alinear', en: 'align' },
	'style.gap': { es: 'gap', en: 'gap' },
	'style.position': { es: 'position', en: 'position' },
	'style.width': { es: 'ancho', en: 'width' },
	'style.height': { es: 'alto', en: 'height' },
	'style.paddingTop': { es: 'arriba', en: 'top' },
	'style.paddingRight': { es: 'derecha', en: 'right' },
	'style.paddingBottom': { es: 'abajo', en: 'bottom' },
	'style.paddingLeft': { es: 'izquierda', en: 'left' },
	'style.marginTop': { es: 'arriba', en: 'top' },
	'style.marginRight': { es: 'derecha', en: 'right' },
	'style.marginBottom': { es: 'abajo', en: 'bottom' },
	'style.marginLeft': { es: 'izquierda', en: 'left' },
	'style.fontFamily': { es: 'familia', en: 'family' },
	'style.fontSize': { es: 'tamaño', en: 'size' },
	'style.fontWeight': { es: 'peso', en: 'weight' },
	'style.lineHeight': { es: 'interlineado', en: 'line height' },
	'style.letterSpacing': { es: 'espaciado', en: 'letter spacing' },
	'style.textAlign': { es: 'alineación', en: 'align' },
	'style.textTransform': { es: 'transformar', en: 'transform' },
	'style.color': { es: 'texto', en: 'text' },
	'style.backgroundColor': { es: 'fondo', en: 'background' },
	'style.borderTopWidth': { es: 'arriba', en: 'top' },
	'style.borderRightWidth': { es: 'derecha', en: 'right' },
	'style.borderBottomWidth': { es: 'abajo', en: 'bottom' },
	'style.borderLeftWidth': { es: 'izquierda', en: 'left' },
	'style.borderStyle': { es: 'estilo', en: 'style' },
	'style.borderColor': { es: 'color', en: 'colour' },
	'style.radiusTopLeft': { es: 'sup. izq.', en: 'top left' },
	'style.radiusTopRight': { es: 'sup. der.', en: 'top right' },
	'style.radiusBottomRight': { es: 'inf. der.', en: 'bottom right' },
	'style.radiusBottomLeft': { es: 'inf. izq.', en: 'bottom left' },
	'style.opacity': { es: 'opacidad', en: 'opacity' },
	'style.boxShadow': { es: 'sombra', en: 'shadow' },
	'style.transform': { es: 'transform', en: 'transform' },
	'style.overflow': { es: 'overflow', en: 'overflow' },
	'chat.working.thinking': { es: 'Pensando', en: 'Thinking' },
	'chat.working.next': { es: 'Planeando los próximos pasos', en: 'Planning next moves' },
	'chat.session.info': { es: 'Información de sesión', en: 'Session Info' },
	'chat.session.cost': { es: 'Costo de sesión', en: 'Session Cost' },
	'chat.session.cost.tokens': { es: '{0} entrada · {1} salida', en: '{0} in · {1} out' },
	'chat.session.context': { es: 'Ventana de contexto', en: 'Context Window' },
	'chat.session.warning': { es: 'La calidad puede bajar al acercarse al límite.', en: 'Quality may decline as limit nears.' },
	'chat.session.system': { es: 'Sistema', en: 'System' },
	'chat.session.system.instructions': { es: 'Instrucciones del sistema', en: 'System Instructions' },
	'chat.session.system.tools': { es: 'Definiciones de herramientas', en: 'Tool Definitions' },
	'chat.session.user': { es: 'Contexto del usuario', en: 'User Context' },
	'chat.session.user.messages': { es: 'Mensajes', en: 'Messages' },
	'chat.session.user.results': { es: 'Adjuntos y resultados', en: 'Attachments and results' },
	'chat.session.other': { es: 'Otros', en: 'Other' },
	'chat.session.unclassified': { es: 'Sin clasificar', en: 'Unclassified' },
	'chat.session.compact': { es: 'Compactar conversación', en: 'Compact Conversation' },
	'chat.session.compact.tip': { es: 'Resume la conversación para liberar contexto (/compact)', en: 'Summarises the conversation to free up context (/compact)' },
	// ---- plan editor
	'plan.diagram.fullscreen': { es: 'Pantalla completa (modal con zoom)', en: 'Full screen (zoomable modal)' },
	'plan.diagram.title': { es: 'Diagrama', en: 'Diagram' },
	'plan.follow.running': { es: 'El agente está ejecutando el plan', en: 'The agent is running the plan' },
	'plan.follow.done': { es: 'Plan finalizado', en: 'Plan finished' },
	'plan.follow.idle': { es: 'Seguir al agente', en: 'Follow the agent' },
	'plan.follow.stop': { es: 'Dejar de seguir', en: 'Stop following' },
	'plan.tasks.one': { es: '1 To-do', en: '1 To-do' },
	'plan.tasks.count': { es: '{0} To-dos', en: '{0} To-dos' },
	'plan.tasks.new': { es: 'Nuevo', en: 'New' },
	'plan.task.markDone': { es: 'Marcar como hecha', en: 'Mark as done' },
	'plan.task.markPending': { es: 'Marcar como pendiente', en: 'Mark as pending' },
	'plan.task.placeholder': { es: 'Nuevo paso…', en: 'New step…' },
	'plan.task.remove': { es: 'Quitar paso', en: 'Remove step' },
	// ---- subagent editor
	'subagent.editor.intro': { es: 'Definición de subagente: frontmatter + system prompt en Markdown. El archivo es la fuente de verdad.', en: 'Subagent definition: frontmatter + Markdown system prompt. The file is the source of truth.' },
	'subagent.action.openRaw': { es: 'Abrir como texto', en: 'Open as Text' },
	'subagent.action.run': { es: 'Ejecutar subagente', en: 'Run Subagent' },
	'subagent.action.save': { es: 'Guardar', en: 'Save' },
	'subagent.diagnostics.reveal': { es: 'Ver en el archivo', en: 'Reveal in file' },
	'subagent.section.identity': { es: 'Identidad', en: 'Identity' },
	'subagent.section.identity.desc': { es: 'Cómo se invoca y para qué sirve.', en: 'How it is invoked and what it is for.' },
	'subagent.field.name': { es: 'Nombre', en: 'Name' },
	'subagent.field.name.desc': { es: 'Identificador con el que el agente lo delega (`@nombre`).', en: 'Identifier the agent delegates to (`@name`).' },
	'subagent.field.description': { es: 'Descripción', en: 'Description' },
	'subagent.field.description.desc': { es: 'Una línea: el enrutador la usa para elegirlo.', en: 'One line: the router uses it to pick this subagent.' },
	'subagent.field.profile': { es: 'Perfil de tarea', en: 'Task profile' },
	'subagent.profile.auto': { es: 'Automático', en: 'Automatic' },
	'subagent.profile.planning': { es: 'Planificación', en: 'Planning' },
	'subagent.profile.debug': { es: 'Depuración', en: 'Debugging' },
	'subagent.profile.implementation': { es: 'Implementación', en: 'Implementation' },
	'subagent.profile.review': { es: 'Revisión', en: 'Review' },
	'subagent.profile.simpleFix': { es: 'Corrección simple', en: 'Simple fix' },
	'subagent.profile.research': { es: 'Investigación', en: 'Research' },
	'subagent.profile.general': { es: 'General', en: 'General' },
	'subagent.section.model': { es: 'Modelo y herramientas', en: 'Model and tools' },
	'subagent.section.model.desc': { es: 'Con qué corre y qué puede usar. Sin modelo fijo, decide el enrutador.', en: 'What it runs on and what it may use. Without a fixed model the router decides.' },
	'subagent.field.model': { es: 'Modelo', en: 'Model' },
	'subagent.field.model.desc': { es: 'Proveedor/modelo explícito; con enrutado activo funciona como preferencia.', en: 'Explicit provider/model; with routing on it acts as a preference.' },
	'subagent.field.model.pick': { es: 'Elegir modelo', en: 'Pick model' },
	'subagent.field.model.reset': { es: 'Volver al enrutador', en: 'Back to routing' },
	'subagent.field.model.default': { es: 'Automático (enrutador)', en: 'Automatic (router)' },
	'subagent.field.tools': { es: 'Herramientas', en: 'Tools' },
	'subagent.field.tools.desc': { es: 'Herramientas nativas, servidores MCP y skills que puede invocar.', en: 'Built-in tools, MCP servers and skills it may call.' },
	'subagent.field.tools.configure': { es: 'Configurar herramientas…', en: 'Configure Tools…' },
	'subagent.field.tools.empty': { es: 'Sin restricción: usa todas las herramientas disponibles.', en: 'Unrestricted: uses every available tool.' },
	'subagent.field.tools.remove': { es: 'Quitar {0}', en: 'Remove {0}' },
	'subagent.field.readonly': { es: 'Solo lectura', en: 'Read-only' },
	'subagent.field.readonly.desc': { es: 'No puede editar archivos ni ejecutar comandos que escriban.', en: 'Cannot edit files nor run commands that write.' },
	'subagent.field.background': { es: 'Ejecutar en segundo plano', en: 'Run in background' },
	'subagent.field.background.desc': { es: 'Corre sin bloquear el turno del agente principal.', en: 'Runs without blocking the main agent turn.' },
	'subagent.section.prompt': { es: 'System prompt', en: 'System prompt' },
	'subagent.section.prompt.desc': { es: 'Cuerpo Markdown del archivo. Se edita con el editor del IDE.', en: 'Markdown body of the file, edited with the IDE editor.' },
	'subagent.save.error': { es: 'No se pudo guardar el subagente: {0}', en: 'Could not save the subagent: {0}' },
	'subagent.run.task': { es: 'Ejecutá la tarea definida por {0}.', en: 'Run the task defined by {0}.' },
	'subagent.run.error': { es: 'No se pudo ejecutar el subagente: {0}', en: 'Could not run the subagent: {0}' },
	'subagent.tools.bucket.builtin': { es: 'Herramientas nativas', en: 'Built-in tools' },
	'subagent.tools.bucket.mcp': { es: 'Servidores MCP', en: 'MCP servers' },
	'subagent.tools.bucket.skills': { es: 'Skills', en: 'Skills' },
	'subagent.tools.bucket.unavailable': { es: 'No disponibles ahora', en: 'Not available now' },
	'subagent.tools.unavailable': { es: 'No está en el catálogo actual (renombrada o MCP desconectado)', en: 'Not in the current catalog (renamed or MCP disconnected)' },
	'subagent.tools.picker.title': { es: 'Herramientas del subagente', en: 'Subagent tools' },
	'subagent.tools.picker.placeholder': { es: 'Marcá las herramientas permitidas; Enter para confirmar', en: 'Check the allowed tools; Enter to confirm' },
	// ---- settings shell
	'settings.nav.all': { es: 'Todos los ajustes', en: 'All Settings' },
	'settings.nav.commonlyUsed': { es: 'Más usados', en: 'Commonly Used' },
	'settings.nav.extensions': { es: 'Extensiones', en: 'Extensions' },
	'settings.nav.language': { es: 'Idioma', en: 'Language' },
	'settings.nav.aria': { es: 'Categorías de ajustes', en: 'Settings categories' },
	// The OpenIDE pages of the settings TOC. They live here and not in `settingsLayout.ts` because
	// `localize()` resolves against the IDE locale and only switches on restart, and the fork wrote
	// its defaults in Spanish — so an English IDE got a Spanish menu with no way to change it.
	// Terms the product itself brands in English (Skills, MCP, Hooks, Project Map) stay put in both.
	'settings.nav.agent': { es: 'Agente IA', en: 'AI Agent' },
	'settings.nav.agent.providers': { es: 'Proveedores de IA', en: 'AI Providers' },
	'settings.nav.agent.chat': { es: 'Chat y ejecución', en: 'Chat & Execution' },
	'settings.nav.agent.voice': { es: 'Voz', en: 'Voice' },
	'settings.nav.agent.context': { es: 'Contexto y límites', en: 'Context & Limits' },
	'settings.nav.agent.skills': { es: 'Skills', en: 'Skills' },
	'settings.nav.agent.mcp': { es: 'MCP', en: 'MCP' },
	'settings.nav.agent.rules': { es: 'Reglas', en: 'Rules' },
	'settings.nav.agent.hooks': { es: 'Hooks', en: 'Hooks' },
	'settings.nav.agent.commands': { es: 'Comandos', en: 'Commands' },
	'settings.nav.agent.quickCommands': { es: 'Comandos rápidos de terminal', en: 'Terminal Quick Commands' },
	'settings.nav.agent.subagents': { es: 'Subagentes', en: 'Subagents' },
	'settings.nav.agent.projectMap': { es: 'Project Map', en: 'Project Map' },
	'settings.nav.agent.notifications': { es: 'Notificaciones', en: 'Notifications' },
	'settings.nav.agent.browser': { es: 'Navegador', en: 'Browser' },
	'settings.nav.agent.advanced': { es: 'Modelos y avanzado', en: 'Models & Advanced' },
	// Settings search: what each custom surface offers. Shown in results, so they follow the UI
	// language; their `keywords` stay bilingual and untranslated (see openideSettingsSurfaceSearch).
	'settings.surface.subagents': { es: 'Subagentes', en: 'Subagents' },
	'settings.surface.subagents.desc': { es: 'Agentes especializados con su propio prompt, modelo y herramientas.', en: 'Specialised agents with their own prompt, model and tools.' },
	'settings.surface.projectMap.desc': { es: 'Índice del codebase que el agente usa para ubicarse: símbolos, imports y grafo.', en: 'Codebase index the agent uses to find its way: symbols, imports and graph.' },
	'settings.surface.skills.desc': { es: 'Instrucciones empaquetadas que el agente carga cuando la tarea las pide.', en: 'Packaged instructions the agent loads when the task calls for them.' },
	'settings.surface.rules.desc': { es: 'Instrucciones permanentes que el agente respeta en todo el proyecto.', en: 'Permanent instructions the agent respects across the whole project.' },
	'settings.surface.commands.desc': { es: 'Comandos propios invocables desde el chat con /.', en: 'Your own commands, invoked from the chat with /.' },
	'settings.surface.hooks.desc': { es: 'Comandos que se ejecutan cuando el agente usa una herramienta.', en: 'Commands that run when the agent uses a tool.' },
	'settings.surface.quickCommands.desc': { es: 'Acciones de un click sobre la selección o el archivo abierto.', en: 'One-click actions on the selection or the open file.' },
	'settings.surface.providers.desc': { es: 'Cuentas y API keys de los modelos: Anthropic, OpenAI y compatibles.', en: 'Model accounts and API keys: Anthropic, OpenAI and compatible.' },
	'settings.surface.mcp.desc': { es: 'Servidores MCP: herramientas externas que el agente puede usar.', en: 'MCP servers: external tools the agent can use.' },
	// Project Map and Subagents sections: raw literals, never routed through localize().
	'settings.projectMap.title': { es: 'Índice del codebase', en: 'Codebase index' },
	'settings.projectMap.desc': { es: 'Lo que el agente usa para orientarse antes de buscar o leer archivos, y lo que alimenta el explorador visual.', en: 'What the agent uses to get its bearings before searching or reading files, and what feeds the visual explorer.' },
	'settings.projectMap.open': { es: 'Abrir Project Map', en: 'Open Project Map' },
	'settings.projectMap.reading': { es: 'Leyendo estado…', en: 'Reading state…' },
	'settings.projectMap.notBuilt': { es: 'Índice todavía no construido', en: 'Index not built yet' },
	'settings.projectMap.upToDate': { es: 'Índice local actualizado', en: 'Local index up to date' },
	'settings.projectMap.version': { es: 'Versión', en: 'Version' },
	'settings.projectMap.lastBuild': { es: 'Última construcción', en: 'Last build' },
	'settings.projectMap.pending': { es: 'Archivos pendientes', en: 'Pending files' },
	'settings.projectMap.rebuild': { es: 'Reconstruir índice', en: 'Rebuild index' },
	'settings.projectMap.rebuilding': { es: 'Reconstruyendo índice…', en: 'Rebuilding index…' },
	'settings.projectMap.clear': { es: 'Limpiar índice', en: 'Clear index' },
	'settings.projectMap.clearConfirm': { es: 'Confirmar: borrar el índice', en: 'Confirm: delete the index' },
	'settings.projectMap.patterns': { es: 'Patrones de indexado', en: 'Indexing patterns' },
	'settings.projectMap.include': { es: 'Incluir', en: 'Include' },
	'settings.projectMap.exclude': { es: 'Excluir', en: 'Exclude' },
	'settings.projectMap.patternsDesc': { es: 'Un patrón glob por línea. Excluir se suma a los excluidos por defecto (node_modules, dist, .git…); si Incluir tiene patrones, sólo se indexa lo que matchee. Cambiarlos dispara una reconstrucción.', en: 'One glob pattern per line. Exclude adds to the defaults (node_modules, dist, .git…); if Include has patterns, only what matches is indexed. Changing them triggers a rebuild.' },
	'settings.projectMap.learned': { es: 'Entidades con historial', en: 'Entities with history' },
	'settings.projectMap.learnedDesc': { es: 'El agente registra qué entidades resultaron útiles según lo que hacés después (aceptar o revertir sus cambios). Las lecciones pierden la mitad de su peso cada 30 días, así que lo aprendido sobre código ya cambiado se desvanece solo.', en: 'The agent records which entities proved useful based on what you do next (accepting or reverting its changes). Lessons lose half their weight every 30 days, so what it learned about code that has since changed fades on its own.' },
	'settings.projectMap.disputed': { es: 'En disputa', en: 'Disputed' },
	'settings.projectMap.forget': { es: 'Olvidar lo aprendido', en: 'Forget what was learned' },
	'settings.subagents.routingState': { es: 'Estado del routing', en: 'Routing state' },
	'settings.subagents.providers': { es: 'Providers y modelos conectados', en: 'Connected providers and models' },
	'settings.subagents.noProviders': { es: 'No hay providers configurados.', en: 'No providers configured.' },
	'settings.subagents.health': { es: 'Health y cooldowns', en: 'Health and cooldowns' },
	'settings.subagents.noFailures': { es: 'Sin fallos registrados.', en: 'No failures recorded.' },
	'settings.subagents.decisions': { es: 'Últimas decisiones', en: 'Latest decisions' },
	'settings.subagents.noRuns': { es: 'Todavía no hay runs con routing.', en: 'No routed runs yet.' },
	'settings.subagents.policy': { es: 'Policy de routing', en: 'Routing policy' },
	'settings.subagents.policyDesc': { es: 'Targets por perfil de tarea, con providerId y model explícitos. El orden desempata cuando faltan métricas.', en: 'Targets per task profile, with explicit providerId and model. Order breaks ties when metrics are missing.' },
	'settings.subagents.policyLabel': { es: 'Policy de routing de subagentes (JSON)', en: 'Subagent routing policy (JSON)' },
	'settings.subagents.save': { es: 'Guardar policy', en: 'Save policy' },
	'settings.subagents.discard': { es: 'Descartar cambios', en: 'Discard changes' },
	'settings.subagents.policyInvalid': { es: 'JSON inválido: {0}', en: 'Invalid JSON: {0}' },
	'settings.subagents.loading': { es: 'Cargando…', en: 'Loading…' },
	'settings.surface.language.desc': { es: 'Idioma de la interfaz de VS Code (paquetes de idioma) y de las cadenas propias de OpenIDE.', en: 'Language of the VS Code interface (language packs) and of OpenIDE\'s own strings.' },
	'settings.breadcrumb.aria': { es: 'Ubicación', en: 'Location' },
	'settings.search.placeholder': { es: 'Buscar ajustes', en: 'Search settings' },
	'settings.search.clear': { es: 'Limpiar búsqueda', en: 'Clear search' },
	'settings.search.oneResult': { es: '1 resultado', en: '1 result' },
	'settings.search.results': { es: '{0} resultados', en: '{0} results' },
	'settings.search.noMatches': { es: 'No hay ajustes que coincidan con la búsqueda.', en: 'No settings match your search.' },
	'settings.item.modified': { es: 'Modificado en este ámbito — el botón ↩ lo restablece.', en: 'Modified in this scope — the ↩ button resets it.' },
	'settings.item.deprecated': { es: 'Obsoleto: puede dejar de tener efecto en una versión futura.', en: 'Deprecated: it may stop having effect in a future version.' },
	'settings.item.reset': { es: 'Restablecer en este ámbito', en: 'Reset in this scope' },
	'settings.item.policy': { es: 'Este ajuste está controlado por una política.', en: 'This setting is controlled by a policy.' },
	'settings.item.onlyIn': { es: 'Solo se puede configurar en: {0}', en: 'Can only be configured in: {0}' },
	'settings.item.showMore': { es: 'Mostrar {0} más', en: 'Show {0} more' },
	'settings.item.editJson': { es: 'Editar en settings.json', en: 'Edit in settings.json' },
	'settings.item.moreInfo': { es: 'Más información', en: 'More information' },
	'settings.scope.userOrWorkspace': { es: 'Usuario o Workspace', en: 'User or Workspace' },

	// ---- sessions pane (VS Code Agent Sessions, adapted)
	'sessions.toggle': { es: 'Sesiones', en: 'Sessions' },
	'sessions.newKind': { es: 'Nueva sesión con…', en: 'New session with…' },
	'sessions.kind.local': { es: 'Local (OpenIDE)', en: 'Local (OpenIDE)' },
	'sessions.kind.localDesc': { es: 'El harness propio del IDE', en: 'The IDE\'s own harness' },
	'sessions.kind.notInstalled': { es: 'no instalado', en: 'not installed' },
	'sessions.kind.noneInstalled': { es: 'No encontré ningún CLI de agente en el PATH', en: 'No agent CLI found on PATH' },
	'sessions.kind.checking': { es: 'buscando…', en: 'checking…' },
	'sessions.kind.terminal': { es: 'en terminal', en: 'in terminal' },
	'sessions.search': { es: 'Buscar sesiones', en: 'Search sessions' },
	'sessions.filter': { es: 'Filtrar', en: 'Filter' },
	'sessions.filter.all': { es: 'Todas', en: 'All' },
	'sessions.filter.local': { es: 'Solo locales', en: 'Local only' },
	'sessions.filter.cli': { es: 'Solo agentes externos', en: 'External agents only' },
	'sessions.filter.needsInput': { es: 'Esperan tu respuesta', en: 'Waiting for you' },
	'sessions.filter.inProgress': { es: 'En curso', en: 'In progress' },
	'sessions.filter.archived': { es: 'Archivadas', en: 'Archived' },
	'sessions.group.today': { es: 'Hoy', en: 'Today' },
	'sessions.group.yesterday': { es: 'Ayer', en: 'Yesterday' },
	'sessions.group.week': { es: 'Últimos 7 días', en: 'Last 7 days' },
	'sessions.group.month': { es: 'Últimos 30 días', en: 'Last 30 days' },
	'sessions.group.older': { es: 'Más viejas', en: 'Older' },
	'sessions.empty': { es: 'Sin sesiones', en: 'No sessions' },
	'sessions.status.inProgress': { es: 'Trabajando', en: 'Working' },
	'sessions.status.needsInput': { es: 'Espera tu respuesta', en: 'Needs your input' },
	'sessions.status.completed': { es: 'Terminada', en: 'Completed' },
	'sessions.status.failed': { es: 'Falló', en: 'Failed' },
	'sessions.action.markRead': { es: 'Marcar como leída', en: 'Mark as read' },
	'sessions.action.archive': { es: 'Archivar', en: 'Archive' },
	'sessions.action.unarchive': { es: 'Desarchivar', en: 'Unarchive' },
	'sessions.action.delete': { es: 'Eliminar', en: 'Delete' },
	'sessions.time.now': { es: 'ahora', en: 'now' },
	'sessions.time.minutes': { es: 'hace {0} min', en: '{0} min ago' },
	'sessions.time.hours': { es: 'hace {0} h', en: '{0} h ago' },
	'sessions.time.days': { es: 'hace {0} d', en: '{0} d ago' },
	'sessions.cli.title': { es: '{0} · terminal', en: '{0} · terminal' },
	'sessions.cli.launching': { es: 'Iniciando {0}…', en: 'Starting {0}…' },
	'sessions.cli.exited': { es: '{0} terminó (código {1}). Enter para reabrir esta sesión.', en: '{0} exited (code {1}). Enter to reopen this session.' },
	'sessions.cli.relaunch': { es: 'Reabrir', en: 'Reopen' },
	'sessions.cli.resumeBusy': { es: 'Otro proceso de {0} todavía tiene esa conversación abierta. Abrí una sesión nueva; la anterior sigue viva donde está.', en: 'Another {0} process still holds that conversation. Starting a fresh session; the old one is still alive where it is.' },
	'sessions.cli.notFound': { es: 'No encontré el ejecutable "{0}" en el PATH.', en: 'Could not find the "{0}" executable on PATH.' },
	'ide.planReview': { es: 'El agente propone el plan «{0}». Revisalo y editalo: lo que quede en el archivo es lo que recibe de vuelta.', en: 'The agent proposes the plan "{0}". Review and edit it — whatever the file ends up saying is what goes back.' },
	'ide.planReview.approve': { es: 'Aprobar y devolver', en: 'Approve and send back' },
	'ide.planReview.reject': { es: 'Descartar', en: 'Discard' },
	'ide.planReview.view': { es: 'Ver plan', en: 'View plan' },
	'cliChanges.title': { es: 'Cambios del agente', en: 'Agent Changes' },
	'cliChanges.empty': { es: 'Todavía no hay cambios de un CLI.', en: 'No CLI changes yet.' },
	'cliChanges.emptyHint': { es: 'Abrí una sesión de Claude Code, Codex, opencode o Grok en el dock: cada conversación junta acá todo lo que tocó.', en: 'Open a Claude Code, Codex, opencode or Grok session in the dock: each conversation collects everything it touched here.' },
	'cliChanges.emptyAction': { es: 'Nuevo chat', en: 'New chat' },
	'cliChanges.state.working': { es: 'trabajando', en: 'working' },
	'cliChanges.state.workingTitle': { es: 'El agente está generando una respuesta: la lista todavía puede crecer.', en: 'The agent is producing a reply: this list can still grow.' },
	'cliChanges.state.typing': { es: 'escribiendo', en: 'typing' },
	'cliChanges.state.typingTitle': { es: 'Estás escribiendo en esta conversación.', en: 'You are typing in this conversation.' },
	'cliChanges.state.waiting': { es: 'te espera', en: 'waiting on you' },
	'cliChanges.state.waitingTitle': { es: 'El agente terminó y espera tu respuesta.', en: 'The agent finished and is waiting for your reply.' },
	'cliChanges.state.done': { es: 'listo', en: 'done' },
	'cliChanges.state.doneTitle': { es: 'La sesión terminó.', en: 'The session ended.' },
	'cliChanges.state.failed': { es: 'falló', en: 'failed' },
	'cliChanges.state.failedTitle': { es: 'La última respuesta del agente terminó con error.', en: 'The agent\'s last reply ended in an error.' },
	'cliChanges.noBaseline': { es: 'Git no trackea este archivo, así que OpenIDE tomó su propio punto de retorno la primera vez que el agente lo tocó — una escritura tarde. Todo lo que el agente cambió DESPUÉS aparece exacto; su primera edición de esta conversación no. Si lo agregás al repo (git add), desde ahí es exacto de entrada.', en: 'Git does not track this file, so OpenIDE took its own restore point the first time the agent touched it — one write late. Everything the agent changed AFTER that shows exactly; its first edit in this conversation does not. Add it to the repo (git add) and it is exact from the start.' },
	'cliChanges.breadcrumb.noBaseline': { es: 'Sin punto de retorno', en: 'No restore point' },
	'cliChanges.breadcrumb.changed': { es: 'Cambiado por el agente', en: 'Changed by the agent' },
	'cliChanges.breadcrumb.undo': { es: 'Deshacer', en: 'Undo' },
	'cliChanges.breadcrumb.undoTitle': { es: 'Devuelve el archivo a como estaba antes de que esta conversación lo tocara. No toca cambios anteriores a la sesión.', en: 'Puts the file back the way it was before this conversation touched it. Changes older than the session are left alone.' },
	'cliChanges.breadcrumb.undoInexact': { es: 'Deshacer (parcial)', en: 'Undo (partial)' },
	'cliChanges.breadcrumb.undoInexactTitle': { es: 'OJO: el archivo ya tenía cambios sin guardar cuando arrancó la sesión, así que el punto de retorno se tomó una escritura tarde. Deshacer NO va a revertir la primera edición del agente.', en: 'CAREFUL: the file already had uncommitted changes when the session began, so the restore point was taken one write late. Undo will NOT revert the agent\'s first edit.' },
	'cliChanges.breadcrumb.undoFailed': { es: 'No pude deshacer {0}.', en: 'Could not undo {0}.' },
	'cliChanges.breadcrumb.diff': { es: 'Ver cambios', en: 'View changes' },
	'cliChanges.breadcrumb.diffTitle': { es: 'Abre el diff contra cómo estaba el archivo antes de esta conversación.', en: 'Opens the diff against how the file looked before this conversation.' },
	'cliChanges.finished': { es: '{0} terminó', en: '{0} finished' },
	'cliChanges.finishedFiles': { es: '{0} · {1} archivo(s) cambiados', en: '{0} · {1} file(s) changed' },
	'cliChanges.finishedNone': { es: '{0} · sin cambios en el árbol', en: '{0} · nothing changed in the tree' },
	'cliChanges.finishedFailed': { es: '{0}: la respuesta terminó con error', en: '{0}: the reply ended in an error' },
	'cliChanges.working': { es: 'trabajando', en: 'working' },
	'cliChanges.workingTitle': { es: 'El agente está trabajando: la lista todavía puede crecer.', en: 'The agent is working: this list can still grow.' },
	'cliChanges.noFiles': { es: 'esta conversación no cambió nada', en: 'this conversation changed nothing' },
	'cliChanges.pending': { es: 'todavía nada; se completa al terminar cada respuesta', en: 'nothing yet; it fills in as each reply finishes' },
	'cliChanges.diffLabel': { es: 'cambios del agente', en: 'agent changes' },
	'cliChanges.approx': { es: 'aprox.', en: 'approx.' },
	'cliChanges.truncated': { es: '…y más: se tocaron demasiados archivos', en: '…and more: too many files were touched' },
	'cliChanges.truncatedTitle': { es: 'Un build o una instalación tocan miles de archivos. Se recuerdan los primeros; esta lista NO es todo lo que cambió.', en: 'A build or an install touches thousands of files. Only the first are kept; this list is NOT everything that changed.' },
	'cliChanges.approxTitle': { es: 'Este CLI no reporta por hooks: OpenIDE dedujo de su salida cuándo estaba trabajando, así que la lista es "lo que cambió mientras parecía trabajar" — tus propias ediciones de ese rato incluidas.', en: 'This CLI does not report through hooks: OpenIDE inferred from its output when it was working, so the list is "what changed while it looked busy" — your own edits in those windows included.' },
	'cliChanges.renamedFrom': { es: '{0} (renombrado desde {1})', en: '{0} (renamed from {1})' },
	'ide.register.pick': { es: '¿En qué CLI registrar las herramientas de OpenIDE?', en: 'Which CLI should OpenIDE register its tools in?' },
	'ide.register.noServer': { es: 'El servidor de OpenIDE no está corriendo: abrí una carpeta y revisá que "openide.ideServer.enabled" esté activo.', en: 'The OpenIDE server is not running: open a folder and check that "openide.ideServer.enabled" is on.' },
	'ide.register.notFound': { es: 'No encontré el ejecutable "{0}" en el PATH.', en: 'Could not find the "{0}" executable on PATH.' },
	'ide.register.done': { es: 'Listo: {0} ya puede usar las herramientas de OpenIDE en este workspace.', en: 'Done: {0} can now use OpenIDE\'s tools in this workspace.' },
	'ide.register.failed': { es: 'No pude registrar en {0}: {1}', en: 'Could not register in {0}: {1}' },
	'ide.planReview.waiting': { es: 'El agente espera tu revisión', en: 'The agent is waiting for your review' },
	'ide.planReview.waitingTitle': { es: 'Un agente externo escribió este plan y su llamada está esperando. Editá lo que quieras: lo que quede en el archivo es lo que recibe de vuelta.', en: 'An external agent wrote this plan and its call is parked. Edit freely — whatever the file ends up saying is what goes back.' },
	'ide.planReview.approveTitle': { es: 'Devolver el plan editado al agente para que lo ejecute', en: 'Send the edited plan back to the agent to execute' },
	'ide.planReview.rejectTitle': { es: 'Decirle al agente que no ejecute este plan', en: 'Tell the agent not to execute this plan' },
	'sessions.cli.hooksInstalled': { es: 'OpenIDE registró hooks en ~/.claude/settings.json para leer el estado de Claude Code (trabajando / espera tu respuesta).', en: 'OpenIDE registered hooks in ~/.claude/settings.json to read Claude Code\'s state (working / waiting for you).' },
	// ---- language section
	'language.title': { es: 'Idioma', en: 'Language' },
	'language.desc': { es: 'Idioma de toda la interfaz: los menús, comandos y editor de VS Code, y también el chat, los ajustes, el Project Map y los proveedores que agrega OpenIDE.', en: 'Language of the whole interface: VS Code\'s menus, commands and editor, and also the chat, settings, Project Map and providers that OpenIDE adds on top.' },
	'language.ui.label': { es: 'Idioma de la interfaz', en: 'Display language' },
	'language.ui.desc': { es: 'Se aplica al reiniciar. Los idiomas distintos del inglés necesitan un paquete de idioma, que se instala solo al elegirlo.', en: 'Applies after a restart. Languages other than English need a language pack, installed for you when you pick one.' },
	'language.ui.builtin': { es: 'English (integrado)', en: 'English (built-in)' },
	'language.ui.installMore': { es: 'Instalar más idiomas…', en: 'Install more languages…' },
	'language.ui.loading': { es: 'Leyendo paquetes de idioma…', en: 'Reading language packs…' },
	'language.callout.title': { es: 'Un solo idioma para todo', en: 'One language for everything' },
	'language.callout.text': { es: 'OpenIDE usa el idioma de la interfaz para sus propias pantallas, así que este selector mueve el IDE entero. Antes había un segundo selector para las cadenas de OpenIDE: dejaba la interfaz a medio traducir y se retiró.', en: 'OpenIDE renders its own screens in the display language, so this selector moves the entire IDE. There used to be a second selector for OpenIDE\'s strings: it left the interface half-translated and was retired.' },

	// ---- chat dock header and menu
	'chat.header.newTitle': { es: 'Nuevo chat', en: 'New chat' },
	'chat.header.history': { es: 'Historial de conversaciones', en: 'Conversation history' },
	'chat.header.new': { es: 'Nueva conversación', en: 'New conversation' },
	'chat.header.newKind': { es: 'Nueva sesión con…', en: 'New session with…' },
	'chat.header.more': { es: 'Más opciones', en: 'More options' },
	'chat.header.settings': { es: 'Ajustes del chat', en: 'Chat settings' },
	'chat.header.maximize': { es: 'Maximizar', en: 'Maximize' },
	'chat.header.close': { es: 'Cerrar', en: 'Close' },
	'chat.header.sessions': { es: 'Sesiones', en: 'Sessions' },
	'chat.view.local': { es: 'Chat', en: 'Chat' },
	'diagram.viewer.zoomIn': { es: 'Acercar (rueda del mouse)', en: 'Zoom in (mouse wheel)' },
	'diagram.viewer.zoomOut': { es: 'Alejar (rueda del mouse)', en: 'Zoom out (mouse wheel)' },
	'diagram.viewer.fit': { es: 'Ajustar a la ventana', en: 'Fit to window' },
	'diagram.viewer.hint': { es: 'Rueda: zoom · Arrastrá: mover · Doble click: 100%', en: 'Wheel: zoom · Drag: pan · Double click: 100%' },
	'diagram.viewer.unsupported': { es: 'Este contenido no se puede mostrar como diagrama.', en: 'This content cannot be shown as a diagram.' },
	'sessions.action.closeSession': { es: 'Cerrar sesión', en: 'Close session' },
	'chat.header.closeTab': { es: 'Cerrar conversación', en: 'Close conversation' },
	'chat.header.renamePrompt': { es: 'Nuevo nombre de la conversación', en: 'New conversation name' },
	'chat.header.deleteOne': { es: '¿Eliminar la conversación "{0}"?', en: 'Delete the conversation "{0}"?' },
	'chat.header.deleteOnly': { es: '¿Eliminar la única conversación guardada?', en: 'Delete the only saved conversation?' },
	'chat.header.deleteMany': { es: '¿Eliminar las {0} conversaciones guardadas?', en: 'Delete the {0} saved conversations?' },
	'chat.header.irreversible': { es: 'Esta acción no se puede deshacer.', en: 'This action cannot be undone.' },
	'chat.header.delete': { es: 'Eliminar', en: 'Delete' },
	'chat.header.deleteAll': { es: 'Eliminar todas', en: 'Delete all' },
	'chat.menu.rename': { es: 'Renombrar conversación', en: 'Rename conversation' },
	'chat.menu.fork': { es: 'Fork de esta conversación', en: 'Fork this conversation' },
	'chat.menu.copyTranscript': { es: 'Copiar transcript', en: 'Copy transcript' },
	'chat.menu.delete': { es: 'Eliminar conversación…', en: 'Delete conversation…' },
	'chat.menu.deleteAll': { es: 'Eliminar todas las conversaciones…', en: 'Delete all conversations…' },
	'chat.menu.projectMap': { es: 'Project Map', en: 'Project Map' },
} as const satisfies Record<string, { es: string; en: string }>;

export type OpenideStringKey = keyof typeof STRINGS;

/**
 * For keys BUILT at runtime from data — the Project Map turns an edge type into
 * `projectMap.rel.IMPORTS`. `t()` would throw on a key nobody wrote, and a new relation type
 * arriving from the index must degrade to its raw name, not crash the panel.
 */
export function isOpenideStringKey(key: string): key is OpenideStringKey {
	return Object.hasOwn(STRINGS, key);
}

/**
 * Resolved at MODULE EVALUATION, on purpose: `platform.language` is a `const` filled from the NLS
 * configuration before any workbench module loads, so there is no window — not even the first
 * render — where `t()` could answer with the wrong language or with `undefined`. A lazily
 * resolved locale would have exactly that window, because `t()` is called from modules that load
 * long before any service is available.
 */
let currentLanguage: OpenideLanguage = resolveOpenideLanguage(ideLocale);
const onDidChange = new Emitter<OpenideLanguage>();

/**
 * Fires when the language changes. With the locale as the source of truth this cannot happen
 * without a restart, so in production it never fires — the surfaces that listen keep the
 * subscription because it costs nothing and it is what they would need if live switching ever
 * comes back. The tests drive it through `setOpenideLanguage`.
 */
export const onDidChangeOpenideLanguage: Event<OpenideLanguage> = onDidChange.event;

export function getOpenideLanguage(): OpenideLanguage {
	return currentLanguage;
}

/** Test seam. Production resolves the language once, from the locale, at module evaluation. */
export function setOpenideLanguage(language: OpenideLanguage): void {
	if (language === currentLanguage) {
		return;
	}
	currentLanguage = language;
	onDidChange.fire(language);
}

/**
 * Which of the two languages OpenIDE ships an IDE locale maps to: Spanish variants (`es`, `es-AR`)
 * read Spanish, everything else — an English IDE, a German language pack — reads English.
 */
export function resolveOpenideLanguage(ideLocale: string): OpenideLanguage {
	return ideLocale.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** Looks a string up in the current language; `{0}`, `{1}`… are replaced by `args`. */
export function t(key: OpenideStringKey, ...args: (string | number)[]): string {
	const text = STRINGS[key][currentLanguage];
	return args.length ? text.replace(/\{(\d+)\}/g, (match, index) => { const value = args[Number(index)]; return value === undefined ? match : String(value); }) : text;
}

/** For the tests: every key must carry both languages. */
export function openideStringKeys(): readonly OpenideStringKey[] {
	return Object.keys(STRINGS) as OpenideStringKey[];
}

export function openideStringFor(key: OpenideStringKey, language: OpenideLanguage): string {
	return STRINGS[key][language];
}
