# Cadenas en español pendientes de migrar a `t()`

Inventario generado automáticamente (literales con caracteres acentuados/ñ/¿¡ fuera de `localize()` y `t()`). Migradas en esta ronda: shell del settings, sección Idioma, header y menú ⋯ del chat.

Total pendiente: **500** cadenas en 57 archivos.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts` (171)

- L492: [Continuación interna de OpenIDE: la respuesta anterior alcanzó el límite de salida. Conti
- L502: , y marcá 
- L521: \n\nMODO AGENT (ejecución y delegación adaptativa): resolvé directamente los pedidos claro
- L522: \n\nMODO PLAN (solo lectura): tu entregable es un PLAN DE IMPLEMENTACIÓN completo, no códi
- L523: \n\nMODO PREGUNTA (solo lectura): respondé la consulta usando las herramientas de lectura.
- L524: \n\nMODO DEBUG (diagnóstico y corrección): trabajá por evidencia, no por ensayo y error. S
- L530: Revisa una vez el diff actual de archivos explícitos con un contexto aislado. Los informes
- L534: Archivos explícitos del cambio que se revisará
- L555: Delega una tarea especializada a un subagente registrado con permisos y workspace aislados
- L558: Espera una sola vez el resultado terminal de un subagente background, después de avanzar c
- L564: Solicitá al usuario cambiar a un modo más adecuado (Agent, Plan, Ask, Debug o Fork). Muest
- L568: agent = ejecutar, editar y delegar · plan = diseñar antes de editar · ask = sólo lectura ·
- L569: Justificación BREVE y concreta para el usuario (1 frase): por qué conviene ese modo para E
- L570: Opcional: el pedido ya reformulado y scopeado para el modo destino, que se enviará si el u
- L1140: La sesión OAuth no tiene token vigente.
- L1184: El almacenamiento local de credenciales solo está disponible en Linux cuando el keyring de
- L1456: [Skill seleccionada explícitamente por el usuario: ${name}]\nSeguí estas instrucciones par
- L1462: [Herramienta seleccionada explícitamente por el usuario]\nPriorizá la herramienta \
- L1462:  cuando sea aplicable a este pedido. Descripción: ${def.description}
- L1756: Memoria persistente entre sesiones. Guardá hechos DURADEROS: target "project" (convencione
- L1763: Fragmento único de la entrada existente (replace/remove)
- L1783: Ejecuta una herramienta MCP conectada por su nombre exacto. Usala sólo con nombres del cat
- L1796: Error: nombre de herramienta MCP inválido.
- L1801: Error: argumentos inválidos para ${name}: ${errors.join('; ')}.
- L1847: Error: operación ${invalid.index + 1} (${invalid.name || 'sin nombre'}): ${invalid.error}.
- L1864: Carga el contenido completo de una skill del proyecto (las del índice del system prompt). 
- L1867: Nombre de la skill (kebab-case, como figura en el índice)
- L1884: Crea o actualiza una skill del proyecto (.openide/skills/<name>/SKILL.md). Guardá PROCEDIM
- L1889: Qué hace + cuándo usarla, una línea con keywords
- L1906: Crea o actualiza un especialista reutilizable en .openide/agents o en el perfil del usuari
- L1911: Qué hace y cuándo delegarle trabajo
- L1912: System prompt especializado, autónomo y acotado
- L1915: Preferencia de ejecución background
- L1919: Debe ser true para reemplazar una definición existente
- L1938: Error: habilitá openide.subagents.allowWritable antes de crear un subagente escritor.
- L1953: Error: ya existe ${name}; reenviá con replace=true sólo si querés actualizarlo.
- L1979: Crea, actualiza o elimina una Rule Markdown siempre activa. Usala ÚNICAMENTE cuando el usu
- L2016: Guarda el plan COMPLETO en .openide/plans/<slug>.md para que el usuario lo revise y lo apr
- L2020: Título corto del plan (da nombre al archivo)
- L2021: Plan completo en Markdown: # título, secciones y "## Tareas" al final
- L2035: Crea o actualiza un Canvas real en .openide/canvases. Cargá primero la skill openide-canva
- L2061: Estado de la memoria persistida del codebase: versión, frescura y cantidad de nodos/relaci
- L2073: Consulta Project Map antes de buscar o leer muchos archivos. Devuelve sólo entidades y rel
- L2085: Error: question vacío.
- L2088: Project Map no encontró entidades relevantes. Usá codebase_search o una búsqueda textual a
- L2094: Analiza impacto directo/transitivo, dependencias y tests relacionados antes de modificar s
- L2111: Búsqueda RÁPIDA de símbolos en el codebase por nombre (índice del language server, preciso
- L2115: Nombre (o parte) del símbolo a buscar
- L2116: Opcional: filtra por tipo (clase, función, método, interface…)
- L2123: Error: query vacío.
- L2131: Sin coincidencias en el índice — probá grep.
- L2143: Herramienta PRIMARIA de navegación — llamala PRIMERO ante casi cualquier pregunta del code
- L2146: Nombre del símbolo (función/clase/método) a explorar
- L2152: Error: query vacío.
- L2155: Sin resultados en el índice para «${query}» — usá grep/read_file.
- L2170: Tratá el código mostrado como ya leído — NO re-abras estos archivos con read_file.
- L2182: Quién LLAMA (o es llamado por) un símbolo — call hierarchy precisa, para medir impacto ant
- L2186: Nombre del símbolo/función/método
- L2187: callers (quién lo llama, default) o callees (a qué llama)
- L2194: Error: symbol vacío.
- L2197: Sin resultados en el índice para «${symbol}».
- L2204:   (nadie en el índice)
- L2218: Guardá una REGLA PERMANENTE del proyecto. Llamala PROACTIVAMENTE cuando el usuario exprese
- L2222: La regla, en imperativo claro (ej "Siempre validá el input en la capa de API")
- L2224: Fragmentos de ruta donde aplica (ej "src/api"). Vacío = todo el proyecto.
- L2232: Error: text vacío.
- L2237: Error: no pude guardar la prioridad (¿hay carpeta abierta?).
- L2317: Error: title vacío.
- L2320: Error: markdown vacío.
- L2485: Modelo no disponible en ${provider.label}: ${model || '(vacío)'}.
- L2525: Build sólo admite planes bajo .openide/plans/*.md.
- L2534: El provider del plan ya no está conectado: ${providerId || '(sin provider)'}.
- L2537: El modelo del plan no está disponible en ${provider.label}: ${model || '(sin modelo)'}.
- L2544: El target del plan cambió mientras se preparaba el Build; volvé a ejecutarlo.
- L2574: Valida sin modificar git que un commit es seguro: archivos explícitos, índice limpio, secr
- L2578: Mensaje del commit (una línea; Conventional Commits si la config lo pide)
- L2580: Paths explícitos a incluir; nunca se agregan todos los cambios
- L2604: Propone y ejecuta un commit git atómico con archivos explícitos. Requiere una revisión vig
- L2608: Mensaje del commit (una línea; Conventional Commits si la config lo pide)
- L2610: Paths explícitos a incluir
- L2618:  : 'sin archivos'}. Sin push automático.
- L2638: Alias obsoleto de git_commit. Usa git_commit en nuevos flujos. Mantiene las mismas protecc
- L2642: Error: git_checkpoint ya no admite push. Ejecutá git push manualmente después de revisar e
- L2655: Configura el workflow de commits y revisión cuando el usuario exprese preferencias: umbral
- L2659: Umbral de líneas cambiadas para recomendar checkpoint
- L2691: Alias obsoleto de workflow_configure. Guarda la configuración en .openide/workflow.json.
- L2702: Abre una URL LOCAL (localhost/127.0.0.1/*.localhost) en la vista previa integrada del IDE,
- L2739: La vista previa no cargó (¿el server local está corriendo?).
- L2748: El picker falló.
- L2772: Seleccioná un proveedor conectado para habilitar el dictado.
- L2778: ${entry.label} no declara un modelo de transcripción compatible.
- L2784: Conectá ${entry.label} para usar dictado por voz.
- L2807: Transcribí el audio EXACTAMENTE como se dijo, en su mismo idioma. Devolvé SOLO la transcri
- L2833: La transcripción falló (HTTP ${status})${detail}
- L2838: El modelo no devolvió transcripción.
- L2910: \n\nSUBAGENTES REGISTRADOS (usá exclusivamente estos nombres con delegate_to_subagent):\n
- L2912: \n\nNavegación del proyecto: OpenIDE recupera automáticamente una orientación compacta de 
- L2930: \n\nTRIAJE DE COMPLEJIDAD (elegí el modo correcto ANTES de arrancar): al recibir un pedido
- L2931: - MODO PLAN — tarea grande y multi-paso donde conviene acordar el ENFOQUE antes de escribi
- L2932: - MODO DEBUG — hay un fallo reproducible, crash, test roto o comportamiento incorrecto cuy
- L2933: - QUEDATE EN AGENT Y DELEGÁ — si existen varios frentes independientes, usá subagentes bac
- L2934: - FORK (rama nueva) — hay 2 o más enfoques VÁLIDOS y DIVERGENTES y conviene explorarlos po
- L2935: - QUEDATE EN AGENTE — para lo simple y acotado: 1 a 3 archivos, camino claro, un bug puntu
- L2936: Regla de oro: ante la duda, si el pedido es claro avanzá. Una tarea paralelizable permanec
- L3012: Stream stale timeout: el provider no emitió eventos durante ${seconds}s (${request.model})
- L3059: ${activeRequest.system ?? ''}\n\nCAPACIDAD DEL MODELO: el endpoint rechazó function callin
- L3158: No tenés ningún proveedor de IA conectado. Conectá una cuenta (OAuth) o pegá una API key p
- L3200: El modelo ${previous} ya no está disponible en ${entry.label}; usando ${model}.
- L3254: ${model} no admite tools del cliente. OpenIDE continuará en modo conversación; para editar
- L3264: \n\nCATÁLOGO MCP COMPACTO: llamá estas herramientas mediante mcp_call; no inventes nombres
- L3265: \n\nCAPACIDAD DEL MODELO: este modelo no puede invocar herramientas de OpenIDE. No afirmes
- L3267: INSTRUCCIÓN INTERNA DE REANUDACIÓN DE MODO (no es un nuevo mensaje del usuario):\n${intern
- L3321: ${withoutImages.content}\n\n[${images.length} imagen(es) omitidas: el modelo activo no adm
- L3368: El modelo rechazó las imágenes; reintentando con referencias textuales para no perder el r
- L3401: La respuesta alcanzó el límite de salida del modelo; OpenIDE la continúa automáticamente.
- L3408:  El modelo no emitió texto ni tools (ya se reintentó sin tools). En NVIDIA NIM no todos lo
- L3410: El modelo respondió vacío${stopInfo}.${nimHint}
- L3432: La herramienta "${call.name}" repitió exactamente la misma llamada 3 veces; se bloqueará s
- L3435: Error: llamada repetida bloqueada para evitar un ciclo (${call.name}, ${loopDecision.occur
- L3448: Error: el modo ${mode} sólo puede delegar a subagentes de lectura.
- L3469: Error: review_changes necesita files explícitos.
- L3476: REVISIÓN BLOQUEADA
- L3502: El usuario aceptó cambiar al modo ${target}. La UI reenviará el pedido en ese modo; no con
- L3503: El usuario rechazó cambiar al modo ${target}. Continuá en el modo actual y resolvé el pedi
- L3523: Error: ask_user sin preguntas (pasá "questions" o "question").
- L3531: (el usuario canceló)
- L3554: Error: terminal_send acepta como máximo 500 caracteres.
- L3555: Error: terminal_send acepta una sola línea (sin saltos de línea ni nulos).
- L3561: Error: no hay una sesión interactiva awaiting-input. Lanzá run_command primero; terminal_s
- L3576: Error: el usuario rechazó terminal_send.
- L3583: Error: la sesión interactiva se cerró. Reintentá con run_command.
- L3590: timeout: no hubo exit ni nuevo prompt en 30s. Salida parcial:\n${out || '(sin salida nueva
- L3592: awaiting-input (aún esperando): ${out || '(sin salida nueva)'}
- L3607: Error: argumentos JSON inválidos para ${call.name}.
- L3614: Error: argumentos inválidos para ${call.name}: ${argumentErrors.join('; ')}.
- L3623: Error: las Rules son instrucciones protegidas. Solo se pueden modificar cuando el usuario 
- L3656: Acción rechazada por el usuario: ${call.name}.
- L3718: La tarea sigue en curso: se alcanzaron los ${maxIterations} ciclos de este turno. Nada se 
- L3738: La sesión OAuth de "${entryForRefresh.label}" venció o fue revocada; renovando el token y 
- L3746: \nNo se pudo renovar la sesión OAuth automáticamente: ${detail}
- L3771: El proveedor "${providerId}" falló (${cls.reason}); probando con "${target}"…
- L3823: correctitud, regresiones, seguridad, manejo de errores y cobertura de validación
- L3826: Sos un revisor adversarial e INDEPENDIENTE. Revisá solamente el diff incluido, sin impleme
- L3826: . Si hay algo que debe corregirse antes de integrar, cerrá exactamente con \
- L3826:  : ''}; ${workload.changedLines} líneas cambiadas.\nARCHIVOS: ${files.join(', ')}\n\nDIFF 
- L3833: Revisión aislada del diff actual
- L3852: REVISIÓN BLOQUEADA: corregí los hallazgos y ejecutá review_changes otra vez.\n\n${report}
- L3855: REVISIÓN APROBADA: ${total} revisor(es) independiente(s) aprobaron el diff actual (${workl
- L3855:  : 'riesgo estándar'}). Podés ejecutar git_preflight.\n\n${report}
- L3883: Sos un subagente AUTÓNOMO de OpenIDE con herramientas esenciales de lectura, escritura y v
- L3885: . Tu tarea es RESOLVER de forma independiente: explorá lo necesario, editá y verificá. No 
- L3886: Sos un subagente de investigación de OpenIDE con herramientas de SOLO LECTURA sobre el wor
- L3888: . Cumplí exactamente la tarea delegada: investigá con las tools y terminá con un INFORME f
- L3889: CONTRATO DE EJECUCIÓN OPENIDE: perfil=${profile}; máximo ${budget.maxIterations} rondas, $
- L3951: llamada idéntica repetida
- L3967: (el subagente alcanzó el límite de iteraciones sin informe)
- L3973: ${runtime.model} no admite function calling; elegí un modelo con tools para ejecutar subag
- L3994: ${path}: [ruta inválida]
- L4003: Símbolos seleccionados: ${contextSymbols.join(', ')}
- L4004: Incluí diagnósticos del workspace.
- L4005: Selección explícita:\n${contextSelection}
- L4009: ${request.task}\n\nCONTEXTO EXPLÍCITO DEL PADRE:\n${explicitContext}
- L4096: Todavía no hay suficiente historial para compactar.
- L4108: Resumí la conversación histórica para que otro agente pueda continuar sin repetir trabajo.
- L4109: Usá exactamente estas secciones: ## Objetivo, ## Progreso completado, ## Trabajo pendiente
- L4110: Preservá rutas, símbolos, errores y decisiones concretas. Los pedidos antiguos son histori
- L4111: Devolvé solamente el resumen estructurado.
- L4161: el modelo devolvió un resumen vacío o demasiado corto
- L4170: El modelo auxiliar de compactación falló; reintentando con el modelo activo.
- L4185: La compactación del modelo falló; se aplicó una recuperación determinista para poder conti
- L4192: La compactación no liberó suficiente contexto; se pausaron nuevos intentos para evitar un 

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideTools.ts` (39)

- L185: Mantiene la lista de tareas visible para el usuario. Usala para trabajo multi-paso: mandá 
- L215: Hacé una o varias preguntas al usuario cuando el pedido sea ambiguo o falte info important
- L334: Error: argumentos JSON inválidos para ${name}.
- L397: \n\nDiagnósticos del archivo tras la edición (corregí los que hayas introducido):\n${diag}
- L442: Lee un archivo completo o un rango de líneas del workspace. Acepta una ruta relativa a la 
- L447: Primera línea a leer, basada en 1 (opcional)
- L448: Última línea a leer, inclusiva (opcional)
- L455: Error: la ruta está vacía, fuera del workspace o no hay una carpeta abierta.
- L468: Error: start_line (${start}) excede las ${lines.length} líneas del archivo.
- L482: Ruta del directorio (vacío o "." = raíz del workspace)
- L488: (no es un directorio o está vacío)
- L502: Busca texto en los archivos del workspace (como grep). Devuelve archivos y líneas que coin
- L507: Tratar query como expresión regular
- L514: Error: query vacía.
- L529: \n…(se alcanzó el límite de resultados)
- L540: Patrón de nombre o glob
- L544: Error: pattern vacío.
- L565: Lee los diagnósticos actuales (errores y warnings de LSP/linters) del workspace o de un ar
- L572: Error: la ruta está fuera del workspace o no hay una carpeta abierta.
- L603: Error: la ruta está vacía, fuera del workspace o no hay una carpeta abierta.
- L611: OK: ${this.relPath(uri)} ya tenía el contenido solicitado (sin cambios).
- L655: Error: old_string (con matching aproximado) aparece ${hits.length} veces; agregá contexto 
- L683: Reemplaza una ocurrencia exacta de texto en un archivo. old_string debe aparecer EXACTAMEN
- L697: Error: la ruta está vacía, fuera del workspace o no hay una carpeta abierta.
- L700: Error: old_string vacío (usá write_file para crear).
- L703: Error: old_string aparece ${count} veces; agregá contexto para que sea único.
- L711: Error: old_string no se encontró en el archivo (ni con matching tolerante a whitespace). R
- L716: OK: ${this.relPath(uri)} quedó sin cambios efectivos${note}.
- L731: Elimina un archivo del workspace y registra la operación para rollback aislado del mensaje
- L737: Error: ruta vacía o fuera del workspace.
- L753: Renombra o mueve un archivo dentro del workspace y registra la operación para rollback ais
- L760: Error: ruta origen/destino vacía o fuera del workspace.
- L791: Tope de espera en segundos (default 120, máx 600) — subilo SOLO para builds/instalaciones 
- L819: (comando enviado a la terminal, pero shell integration no está disponible → no se pudo cap
- L822: (timeout: el comando no terminó en ${timeoutSec}s y fue TERMINADO. Si es un server/watcher
- L826: awaiting-input: el comando está esperando una respuesta interactiva (y/N, password, menú).
- L1055: Error: terminal_send acepta una sola línea (sin saltos de línea).
- L1058: Error: terminal_send acepta como máximo 500 caracteres (no se trunca en silencio).
- L1205: Iniciado en segundo plano (id=${id}). Seguís sin esperar a que termine; el usuario puede a

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideBrowserTools.ts` (20)

- L160: Error: las tools de navegador del agente están deshabilitadas (openide.agent.browserTools.
- L171: No hay una vista previa conectada. Usá browser_navigate o browser_open primero.
- L192: Ejecución pendiente: ${result.deferredResultId}. Volvé a llamar browser_playwright con def
- L206: Abre o navega la única vista previa nativa de OpenIDE a una URL LOCAL y espera su carga. E
- L209: URL local (ej: http://localhost:5173) o sólo el puerto (ej: 5173)
- L217: Error: URL no permitida — el browser integrado es sólo para apps locales.
- L229: OK: cargada ${result.url} (título: ${result.title || 'sin título'}).
- L281: Lee el HTML renderizado de la vista previa nativa o de un elemento. Longitud máxima config
- L309: (consola vacía)
- L445: OK: texto ingresado${how}, pero el campo lo normalizó: quedó ${JSON.stringify(typed.value)
- L448: OK: texto ingresado. El campo no aceptó la escritura tecla por tecla (¿máscara o autocompl
- L459: Evalúa una expresión JavaScript mediante Playwright en la vista previa nativa.
- L480: Aplica CSS inline en vivo mediante Playwright a la vista previa nativa. No persiste en el 
- L504: Ejecuta un bloque Playwright autocontenido contra la vista previa nativa actual. La variab
- L509: ID de una ejecución anterior todavía pendiente
- L510: Espera máxima antes de devolver un deferredResultId; default openide.agent.browserTools.ac
- L525: Error: browser_playwright opera exclusivamente sobre la page nativa existente; no puede cr
- L550: Responde el diálogo, prompt o selector de archivos que interrumpió el último paso Playwrig
- L556: Paths para un file chooser; array vacío lo cancela
- L560: Responder diálogo del browser

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideGitFlow.ts` (18)

- L134: OK: workflow guardado en .openide/workflow.json. La configuración previa .openide/git.json
- L151: Debés indicar los archivos explícitos del commit; OpenIDE no usa git add -A.
- L155: Path inválido o fuera del workspace: ${invalid}
- L159: El path ${duplicate} aparece más de una vez.
- L162: Bloqueado: ${secretPath} parece contener secretos. Excluilo y gestioná la credencial fuera
- L224: Error: el mensaje de commit está vacío.
- L227: Error: el mensaje debe usar Conventional Commits (por ejemplo: feat(chat): agrega revisión
- L238: Error: no se pudo inspeccionar el índice git.\n${staged.output}
- L241: Bloqueado: hay cambios ya staged fuera de este flujo:\n${staged.output}\n\nLimpiá o commit
- L253: Error: git diff --check encontró problemas de whitespace:\n${whitespace.output}
- L262: Bloqueado: el diff actual no tiene una revisión aprobada. Ejecutá review_changes después d
- L264: Preflight OK: ${files.length} archivo(s), revisión vigente y sin staging ajeno.
- L272: Error: no se pudo leer el estado de git (¿es un repo? ¿shell integration activa?).
- L286: }${behind ? ` — ${behind} detrás del remoto` : 
- L286: }.`, files.length ? `Cambios sin commitear: ${files.length} archivo(s), ~${changedLines} l
- L294: CHECKPOINT RECOMENDADO: superó el umbral (${cfg.maxChangedLines} líneas o ${cfg.maxUnpushe
- L296: Flujo recomendado: review_changes → git_preflight → git_commit. Los commits son atómicos, 
- L326: OK: commit ejecutado (sin push automático).\n${done.map(step => 

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgent.contribution.ts` (16)

- L247: Project Map: ${version.nodeCount} nodos, ${version.edgeCount} relaciones, versión ${versio
- L247: Project Map: índice aún no construido.
- L511: Descripción y cuándo utilizarlo
- L585: Plan: Modelo de ejecución
- L698: OpenIDE Agent: Usar elección del Canvas
- L745: OpenIDE Agent: Fork de la conversación
- L824: Identificador único
- L1040: Milisegundos entre teclas cuando `browser_type` escribe tecla por tecla. Escribir así disp
- L1068: Ejecutar los hooks de shell configurados en `.openide/hooks.json` del proyecto y en el glo
- L1227: OpenIDE Agent: Iniciar sesión (OAuth)
- L1342: OpenIDE Agent: Copiar configuración MCP de diagramas
- L1366: Agente IA: Enviar notificación de prueba
- L1379: Agente IA: notificación de prueba
- L1380: Así se va a ver el aviso cuando el agente termine una tarea.
- L1389: Agente IA: Ejecutar comando rápido…
- L1408: Elegí un comando rápido para ejecutar

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideUsageService.ts` (16)

- L126: La sesión de Google expiró o no tiene permiso para Code Assist.
- L126: Google Code Assist respondió HTTP ${loadStatus}.
- L134: La cuenta todavía no tiene proyecto de Code Assist: mandá un mensaje con este proveedor y 
- L146: La sesión de Google expiró o no tiene permiso para leer la cuota.
- L146: Google no devolvió la cuota (HTTP ${status}).
- L150: Google devolvió una cuota que no se pudo leer.
- L158: No se pudo consultar la cuota de Google (red o servicio caído).
- L165: Sin API key para consultar los créditos.
- L180: OpenRouter rechazó la API key.
- L180: OpenRouter no devolvió los créditos (HTTP ${status}).
- L184: OpenRouter devolvió una respuesta que no se pudo leer.
- L192: No se pudo consultar los créditos de OpenRouter.
- L247: Usage no disponible (sesión OAuth sin permiso o expirada).
- L274: No se pudo consultar usage (red o provider caído).
- L307: Usage de Codex no disponible (sesión expirada).
- L343: Usage de Grok no disponible (sesión expirada).

## `vscode/src/vs/workbench/contrib/openideAgent/browser/projectMap/openideProjectMapEditor.ts` (16)

- L136: Buscar archivos, símbolos, módulos…
- L137: Limpiar búsqueda
- L150: Reconstruir el índice
- L159: Módulos
- L161: Mostrar todos los módulos
- L168: Expandir módulos
- L168: Compactar módulos
- L277: Todavía no hay memoria del codebase para este workspace.
- L278: Construir el índice
- L282: ${view.nodes.length} archivos · ${view.edges.length} relaciones · ${view.modules.length} m
- L290: Reconstruyendo el índice…
- L347: raíz
- L473: , undefined, `Define ${defined} símbolo${defined === 1 ? 
- L500: Analizá el nodo ${node.name} (${node.path}) y sus relaciones de arquitectura, callers, cal
- L507: El agente está analizando…
- L516: Análisis del agente

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideMessageChangeSetService.ts` (15)

- L133: El archivo creado cambió después del mensaje; no se eliminará.
- L137: La ruta eliminada volvió a existir; no se sobrescribirá.
- L156: El origen o destino del movimiento cambió después del mensaje.
- L196: El archivo cambió durante el rollback.
- L204: El archivo cambió durante el commit del rollback.
- L218: El archivo cambió y quedó preservado en ${quarantine.path}.
- L241: El archivo cambió durante el movimiento.
- L257: El archivo cambió durante la operación condicional de rollback.
- L258: El archivo cambió durante el rollback.
- L265: Se restauró la versión concurrente preservada; no se aplicó el rollback.
- L270: No se compensó el move porque sus endpoints cambiaron.
- L274: No se compensó porque el archivo volvió a cambiar.
- L285: La versión concurrente quedó preservada en ${quarantine.path}.
- L290: La compensación no pudo completarse sin sobrescribir datos.
- L295: Rollback atómico abortado por conflicto en otro archivo.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideOAuth.ts` (15)

- L95: No iniciaste sesión en "${entry.label ?? entry.id}".
- L116: La sesión de "${entry.label ?? entry.id}" no se puede renovar. Iniciá sesión de nuevo.
- L149: Abrí ${url} e ingresá el código: ${code}
- L213: Autorizá en el navegador y pegá acá el código (o la URL completa de redirección) que te de
- L225: OAuth: el código pegado pertenece a otro intento de login. Cerrá las pestañas anteriores d
- L233: OAuth: el state del callback no coincide (posible CSRF); reintentá el login.
- L297: OAuth: no llegó el callback del navegador (5 min). Reintentá el login.
- L300: OAuth: el login devolvió "${cb.error}".
- L303: OAuth: el state del callback no coincide (posible CSRF); reintentá el login.
- L306: OAuth: el callback no trajo código de autorización.
- L358: El código expiró antes de autorizar.
- L390: OAuth MiniMax: respuesta inesperada del endpoint de código.
- L415: El código expiró antes de autorizar.
- L475: El código expiró antes de autorizar.
- L524: Copilot token exchange ${status}: ${text.slice(0, 200)} — ¿tu cuenta tiene Copilot activo?

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentSkills.ts` (14)

- L91: Opción A
- L91: Opción A — estructura en dos columnas
- L92: Opción B
- L92: Opción B — flujo lineal de una columna
- L103: Navegación
- L271: Error: la skill "${name}" está deshabilitada.
- L282: Error: la skill "${name}" está deshabilitada — el usuario puede reactivarla en "Extensione
- L314: Error: nombre de skill inválido "${name}" (kebab-case: a-z, 0-9 y guiones; sin -- ni guion
- L317: Error: la description es obligatoria (qué hace + CUÁNDO usarla, con keywords).
- L320: Error: content vacío.
- L335: CREACIÓN: cuando resuelvas un problema difícil, descubras una convención del proyecto o re
- L337: \n\nSKILLS DEL PROYECTO: todavía no hay. 
- L339: - ${s.name}: ${s.description || '(sin descripción)'}
- L340: \n\nSKILLS DEL PROYECTO (procedimientos reutilizables en .openide/skills y .agents/skills)

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideProjectMapSettingsSection.ts` (13)

- L65: Índice del codebase
- L80: Reconstruir índice
- L81: Limpiar índice
- L92: Confirmar: borrar el índice
- L112: Reconstruyendo índice…
- L115: Índice todavía no construido
- L118: ${version.staleCount} archivo(s) requieren actualización
- L120: Índice local actualizado
- L129: Versión
- L133: Última construcción
- L140: Último scan: ${parts.join(' · ')}.
- L147: Un patrón glob por línea. Excluir se suma a los excluidos por defecto (node_modules, dist,
- L173: El agente registra qué entidades resultaron útiles según lo que hacés después (aceptar o r

## `vscode/src/vs/workbench/contrib/openideSettings/browser/openideSettingsSurfaceSearch.ts` (13)

- L25: Índice del codebase que el agente usa para ubicarse: símbolos, imports y grafo.
- L25: índice
- L25: símbolos
- L40: Comandos rápidos
- L40: Acciones de un click sobre la selección o el archivo abierto.
- L40: comando rápido
- L40: acción
- L40: selección
- L43: iniciar sesión
- L43: suscripción
- L49: español
- L49: inglés
- L49: traducción

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideWebResearch.ts` (11)

- L38: Busca información actual en la web pública sin abrir el browser local. Devuelve resultados
- L40: Error: exploración web deshabilitada (openide.agent.web.enabled).
- L41: Error: búsqueda web cancelada.
- L42: Error: query web vacía.
- L44: Error: configurá openide.agent.web.searchEndpoint con un endpoint JSON de búsqueda.
- L48: Error: búsqueda web cancelada.
- L52: Error: búsqueda web falló — ${error instanceof Error ? error.message : String(error)}
- L60: Descarga y extrae texto de una URL web pública con protección SSRF, redirects y límites. N
- L62: Error: exploración web deshabilitada (openide.agent.web.enabled).
- L70: Error: lectura web falló — ${error instanceof Error ? error.message : String(error)}
- L76: el endpoint devolvió JSON inválido

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSubagentHtml.ts` (9)

- L14: >Automático</option><option value=
- L14: >Planificación</option><option value=
- L14: >Depuración</option><option value=
- L14: >Implementación</option><option value=
- L14: >Revisión</option><option value=
- L14: >Corrección simple</option><option value=
- L14: >Investigación</option><option value=
- L14: >Default / routing</option></select><small>Podés fijar un target explícito provider/model;
- L14: ><label>Tools permitidas (una por línea)</label><textarea id=

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentMcp.ts` (8)

- L152: [openide-mcp] mcp.json cambió — reload: ${summary}
- L153: [openide-mcp] reload por watcher falló: ${e instanceof Error ? e.message : String(e)}
- L202: MCP está deshabilitado (openide.agent.mcp.enabled).
- L205: El registry de tools todavía no está listo.
- L272: [openide-mcp] ${id}: reintentos agotados — queda caído hasta "Recargar servers MCP"
- L297: [openide-mcp] ${id}: reintento ${attempt + 1} falló — ${e instanceof Error ? e.message : S
- L334: [openide-mcp] ${id}: no conectó — ${msg}
- L380: Error: la conexión MCP ya no está autorizada.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSkillInstallerEditor.ts` (8)

- L59: Pegá una fuente de skills.sh, owner/repo o el comando publicado por la Skill. OpenIDE lo n
- L61: Ámbito de instalación
- L124: Abrí una carpeta para usar este ámbito
- L130: El comando debe ocupar una sola línea.
- L133: Pegá una fuente o un comando de instalación.
- L172: Comando normalizado · revisalo y presioná Enter
- L202: Ámbito global
- L202: Ámbito del proyecto

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentMemory.ts` (6)

- L65: \n…(memoria truncada — consolidá/limpiá entradas viejas)
- L84: Error: text vacío.
- L87: Error: esa entrada ya está en la memoria (duplicado).
- L95: Error: old_text no se encontró en la memoria.
- L102: Error: old_text no se encontró en la memoria.
- L112: Error: la memoria "${target}" superaría su límite (${updated.length}/${limit} chars). Cons

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideChatView.ts` (6)

- L237: No hay proveedor de IA conectado — abrí la página de proveedores para conectar una cuenta 
- L256: Usage y límites de las cuentas de IA
- L257: Ver usage y límites de las cuentas conectadas
- L300: Contexto usado: ${total.toLocaleString()} tokens. El proveedor no publica un límite verifi
- L351: Agente IA: la tarea falló
- L352: Volvé al chat para ver la respuesta.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSubagentRegistryService.ts` (6)

- L43: Explora en solo lectura un área autocontenida y devuelve evidencia compacta. Úsalo proacti
- L49: Sos el especialista Explore incorporado de OpenIDE. Investigá únicamente el alcance delega
- L57: Especialista de diagnóstico en solo lectura. Aísla causa raíz desde síntomas, logs, diagnó
- L63: Sos el especialista Debugger incorporado de OpenIDE. No edites. Separá síntomas de causas:
- L71: Revisa un cambio acotado en solo lectura buscando defectos concretos, regresiones y valida
- L77: Sos el especialista Code Reviewer incorporado de OpenIDE. Revisá sólo el alcance delegado.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatController.ts` (5)

- L82: Esperá a que termine el rollback antes de enviar otro mensaje.
- L84: Esperá a que termine la ejecución actual antes de compactar.
- L86: Esperá a que termine la ejecución actual antes de aprobar otro plan.
- L93: Ejecutá el plan aprobado en ${path}. Leé el archivo, seguí las tareas de "## Tareas" EN OR
- L439: , `Comando desconocido: /${slash.slug}${near ? ` (¿quisiste decir /${near}?)` : 

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentRules.ts` (5)

- L66: (regla vacía)
- L114: Error: nombre de regla inválido "${name}" (usá kebab-case).
- L117: Error: la regla no puede estar vacía.
- L153: …(presupuesto de Rules agotado; consolidá reglas redundantes)
- L160: \n\nRULES OBLIGATORIAS DE OPENIDE (seguí TODAS. Solo podés modificarlas si el usuario lo p

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseGraph.ts` (5)

- L135: módulo
- L139: método
- L145: función
- L151: símbolo
- L243: … (+${last - stop} líneas más — abrí el archivo si necesitás el resto)

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentHooks.ts` (4)

- L208: [openide-hooks] ${label}: JSON inválido — archivo ignorado
- L219: ${near ? ` (¿quisiste decir 
- L326: [openide-hooks] ${event} "${entry.command}": sin consentimiento del usuario — skipeado (ja
- L338: [openide-hooks] dispatch(${event}) falló: ${e instanceof Error ? e.message : String(e)} — 

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideCanvasService.ts` (4)

- L85: Nombre inválido: usá kebab-case.
- L102: Import no permitido: ${match[1]}. Usá solamente openide/canvas.
- L103: Canvas no permite red ni imports dinámicos.
- L140: Canvas inválido o fuera del workspace.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSubagentSettingsSection.ts` (4)

- L50: Targets por perfil de tarea, con providerId y model explícitos. El orden desempata cuando 
- L74: JSON inválido: ${error instanceof Error ? error.message : String(error)}
- L139: Últimas decisiones
- L141: Todavía no hay runs con routing.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatHistoryMenu.ts` (3)

- L54: Últimos 7 días
- L55: Últimos 30 días
- L56: Más viejas

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentMcpCatalog.ts` (3)

- L70: Documentación actualizada de librerías y frameworks para el agente.
- L72: vacío para saltear
- L87: Documentación de cualquier repo público de GitHub (remoto, sin cuenta).

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideCanvasRuntime.ts` (3)

- L144: Gráfico de torta
- L208: Gráfico
- L312: Ver el canvas a pantalla completa (presentación)

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideChatSessions.ts` (3)

- L74: El change set excede el límite seguro de persistencia.
- L89: Checkpoint creado por una versión anterior: falta el estado posterior y no puede revertirs
- L235: El change set excede el límite seguro de persistencia.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideCommandsSettingsSection.ts` (3)

- L110: , "Ningún comando coincide"), description: localize(
- L110: Probá otra búsqueda.
- L181: ---\ndescription: Qué hace este comando (aparece en el menú del /)\nargument-hint: [args]\

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openidePlanHtml.ts` (3)

- L431: esta fila pasó a hecha
- L431: apareció una fila hecha
- L525: El agente está ejecutando el plan

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideProvidersSettingsSection.ts` (3)

- L473: límite
- L485: sesión
- L494: cerrar sesión

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSubagentPermissionService.ts` (3)

- L39: La definición no autoriza ${toolName}.
- L45: Profundidad máxima ${maxDepth} excedida.
- L46: La delegación formaría un ciclo.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatRollbackOperation.ts` (2)

- L46: El mensaje ya no existe en la conversación.
- L54: El mensaje cambió durante el rollback.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentCommands.ts` (2)

- L217: ${body}\n\nInstrucción adicional: ${argStr}
- L251: ---\ndescription: Qué hace este comando (aparece en el menú del /)\nargument-hint: [args]\

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideRulesSettingsSection.ts` (2)

- L95: Probá otra búsqueda.
- L153: # ${name.trim()}\n\nEscribí acá una instrucción obligatoria, concreta y verificable para e

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSubagentOrchestrationService.ts` (2)

- L64: El subagente ${definition.name} necesita escritura. Habilitá openide.subagents.allowWritab
- L168: Falló la reselección de routing: ${routingError instanceof Error ? routingError.message : 

## `vscode/src/vs/workbench/contrib/openideSettings/browser/openideLanguageSettingsSection.ts` (2)

- L78: español
- L78: inglés

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatComposerControls.ts` (1)

- L225: , "Soltá para transcribir") : localize(

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatComposerPick.ts` (1)

- L100: Elemento seleccionado en la app (se adjunta al próximo mensaje)

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatComposerQueue.ts` (1)

- L17: La cola de esta conversación llegó a 20 mensajes. Enviá, editá o quitá uno antes de agrega

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatModePicker.ts` (1)

- L40: Cada edición y comando pide aprobación (lo más seguro).

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatTranscriptExport.ts` (1)

- L39: No hay conversación para exportar.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatWidget.ts` (1)

- L55: Todavía no se puede volver a este mensaje: el turno no llegó a registrarse.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/parts/openideChatNoticePart.ts` (1)

- L45: continuá

## `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/parts/openideChatTerminalMenu.ts` (1)

- L26: Cada edición y comando pide aprobación (lo más seguro).

## `vscode/src/vs/workbench/contrib/openideAgent/browser/diagrams/openideGraphDiagram.ts` (1)

- L156: Asíncrono / retorno

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseGraphService.ts` (1)

- L314: (sin módulo)

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseMemoryService.ts` (1)

- L146: El índice del Project Map no respondió a tiempo. Reintentá con "Reconstruir índice".

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideMcpSettingsSection.ts` (1)

- L654: Sólo este workspace (.openide/)

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideModelCatalog.ts` (1)

- L409: catálogo vacío

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideQuickCommandsService.ts` (1)

- L56: No hay una carpeta abierta para guardar un comando rápido de proyecto.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSubagentEditor.ts` (1)

- L49: ).then(parsed => parsed.definition && this.orchestration.delegate({ agent: parsed.definiti

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSubagentExecutionService.ts` (1)

- L45: El runtime de subagentes todavía no está disponible.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSubagentRunStorageService.ts` (1)

- L65: La ventana se reinició durante la ejecución.

## `vscode/src/vs/workbench/contrib/openideAgent/browser/openideUsageMonitor.ts` (1)

- L254: La consulta de uso falló.

## `vscode/src/vs/workbench/contrib/openideSettings/browser/openideSettingsSectionBuilder.ts` (1)

- L296: , "(guardado — tipeá para reemplazar)") : localize(
