# Investigación: rendimiento y descubrimiento de herramientas

Fecha: 6 de septiembre de 2026. Documento histórico de la investigación y su línea base. El bloque posterior ya fue implementado: ver [resultados, pruebas y límites](performance-cli-implementation.md).

La prioridad es corregir la pérdida de actualizaciones del índice y la invalidación de consultas; después, reducir trabajo repetido y hacer explícitas las capacidades de OpenIDE para cada CLI. La arquitectura existente permite hacerlo sin reemplazar el editor, el grafo o la memoria Markdown.

El trabajo se realizó sobre el árbol local con cambios sin confirmar, HEAD `72c2545ea9750d0f9630813a140157842410ecaa`. Los [resultados y hashes de fuentes/compilados](research/performance-cli-2026-09-06.json) fijan la versión investigada. Se agregaron sondas y este informe; no se modificó código de producto ni configuraciones de los CLIs del usuario.

## Alcance y calidad de la evidencia

Se inspeccionaron arranque de contribuciones, almacenamiento e invalidación del grafo, watcher, consultas, memoria canónica, checkpoints, renderizado del chat, persistencia de sesiones, hooks y transporte MCP. Se consultaron ayudas de los cuatro CLIs instalados y documentación oficial de los ocho incluidos en el catálogo.

Las mediciones usan clases reales de `vscode/out`, con fixtures sintéticas y servicios simulados donde se indica. Los tiempos de memoria incluyen filesystem, validación de rutas, lectura, parseo YAML y hashing; excluyen IPC, modelo y proyección al grafo. La caché del sistema operativo estaba caliente. Nueve muestras después de un calentamiento; el p95 con nueve muestras coincide con el máximo observado y no representa una estimación poblacional robusta. Máquina: la CPU y versión de Node están registradas en el JSON.

La sonda Electron usa una carpeta mínima, perfiles temporales nuevos, extensiones deshabilitadas y un proveedor SSE local. Es una medición exploratoria del build de desarrollo, no del AppImage de producción. Las dos aperturas finales se verificaron en el workspace 6. Un primer intento de reapertura se ubicó en el 1, se abortó y se cerró; se corrigió la sonda reinstalando la regla antes de cada lanzamiento y eliminando el token de ubicación heredado. No se demuestra cuál de ambos cambios resolvió la ubicación. El intento fallido permanece en `.build/performance-cli-investigation/runtime-first-attempt.json`.

No se midió uso espontáneo de herramientas por un modelo real de cada CLI, consumo de proveedor real, inferencia Mem0, rendimiento remoto/Windows/macOS ni una distribución estadística de arranque de producción. Estas limitaciones no impiden reproducir los problemas de índice y CPU descritos abajo.

## Hallazgos reproducidos

### P0 — El watcher pierde un lote que supera el límite IPC

El watcher consume toda su cola, lanza un `Promise.all` para leerla y envía un único lote. El canal admite como máximo 500 cambios y 500 KiB de contenido por cambio. La sonda reprodujo 501 lecturas concurrentes lógicas, rechazo del lote y **cero entradas pendientes para reintentar**. El control de 500 usa un receptor simulado; el rechazo de 501 pasa por la validación real del canal. No significa que el disco ejecute 501 lecturas físicamente a la vez.

Un checkout, generación o restauración con muchos archivos puede dejar Project Map desactualizado hasta una reconstrucción. Una excepción de lectura también puede descartar el lote, y `void this.flush()` no instala un manejador de rechazo. Mientras un flush espera, otro puede comenzar.

Cambio propuesto: un único drenaje activo; lectura con concurrencia acotada; lotes de hasta 500 y límite agregado de bytes; revisar tamaño antes de cargar contenido; retirar cada cambio sólo cuando se confirma su revisión. Conservar los cambios nuevos del mismo URI y reencolar errores recuperables. Al deshabilitar o disponer el watcher, cancelar temporizadores y trabajo pendiente.

Evidencia: [watcher, queue/flush](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseMemoryWatcher.ts#L67), [validación del canal](../vscode/src/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryChannel.ts#L354), [límites](../vscode/src/vs/platform/openideCodebase/common/openideCodebaseMemoryProtocol.ts#L71), `reproductions.watcher` en el JSON.

### P0 — Una consulta puede reinstalar un snapshot invalidado

`OpenideCodebaseQueryService.current()` comprueba la caché, espera `memory.getSnapshot()` y luego asigna el resultado. Si llega `onDidChange` durante esa espera, la invalidación se pierde cuando termina la lectura vieja. La siguiente consulta devuelve versión 1 después de una invalidación de versión 2. Dos consultas simultáneas sin caché también hicieron dos llamadas al proveedor del snapshot.

Cambio propuesto: generación de invalidación capturada antes del `await`, una promesa compartida por workspace/generación, y publicación del resultado sólo si sigue vigente. La promesa debe limpiarse en éxito y error. Aplicar la misma disciplina a la caché de `CodebaseMemoryService`, que hoy comprueba cambio de workspace pero no garantiza esa coherencia ante cambios del índice durante una lectura. Mantener aisladas generaciones, opciones, confianza y raíces.

Evidencia: [current](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseQueryService.ts#L58), [getSnapshot del adaptador](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseMemoryService.ts#L184), `reproductions.snapshotRace`.

### P1 — El manifiesto del grafo tiene un coste acumulado elevado

Cada `writeFile` copia el objeto completo `manifest.files` y recorre todos sus valores para recalcular `staleCount`. La inserción secuencial crece aproximadamente de forma cuadrática. Con persistencia desactivada y payloads vacíos, tres ejecuciones independientes dieron medianas de **25 ms para 500 archivos, 718 ms para 2.000 y 6.109 ms para 5.000**. Este último tiempo ocurre sin parsear código, sin detectar comunidades y sin escribir payloads al disco: identifica un coste del almacenamiento en memoria, no el tiempo total de indexar un repositorio.

Cambio propuesto: estructura mutable privada o `Map` para archivos, contadores actualizados por diferencia y snapshot inmutable en los límites públicos. Serializar una vez por lote/flush; preservar cola de mutaciones y consistencia de versiones. No sustituir primero el backend por SQLite: eliminar este coste es una intervención menor y medible.

Evidencia: [writeFile y removeFile](../vscode/src/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryStorage.ts#L146), `benchmarks.storage`.

### P1 — Obtener una nota vuelve a leer toda la memoria

`OpenideMemoryOwner.documents()` recorre notas y sesiones completas. `get`, `save`, `forget`, `list` y `semantic` pasan por allí. La búsqueda lexical y el handoff del inicio nativo llaman a `list` por separado.

Medianas observadas para listar: 14,4 ms con 50 notas; 45,4 ms con 200; 109,2 ms con 500; **162,9 ms con 500 notas y 200 sesiones**. En ese último caso, obtener una sola nota costó 191,4 ms; dos listas secuenciales, 337,5 ms; cuatro listas concurrentes tardaron 634,1 ms en completarse porque comparten la cola por raíz. El ranking sobre esos documentos ya cargados costó 2,6 ms. El total de los 700 Markdown sintéticos es aproximadamente 1,5 MB.

Cambio propuesto: snapshot canónico por raíz, índices por ID/topic/session y textos preprocesados; una lectura compartida por turno para handoff y recall. Invalidación por escritura propia y watcher nativo para ediciones externas, rename/delete, cambio de confianza y desconexión. Para obtener un ID, validar su archivo actual. Antes de mutar, conservar los controles de ruta, dirty buffers, CAS por revisión/hash, IDs duplicados y operación idempotente. Una caché no puede convertir errores de lectura en memoria vacía ni sustituir la validación de seguridad de escritura.

Evidencia: [documents/request](../vscode/src/vs/platform/openideAgentHost/node/openideMemoryOwner.ts#L65), [handoff/search](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentMemory.ts#L85), [preparación del turno](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts#L2980), `benchmarks.memory`.

### P1 — Las consultas grandes consumen el hilo del renderer

La consulta prepara strings y calcula frecuencia de términos sobre candidatos, después puntúa y ordena. En un escenario sintético donde todos los nodos comparten términos, la mediana fue **5,5 ms con 5.000 nodos, 24,8 ms con 25.000 y 100,5 ms con 100.000**. Se midió el algoritmo real bajo Node con snapshot ya caliente; no son FPS medidos. Como esta clase ejecuta en el renderer, el mismo trabajo síncrono compite allí con la interacción.

Cambio propuesto: normalizar texto una vez por versión, índice invertido y selección top-k. Si la traza real mantiene bloqueos, mover búsqueda/traversal al shared process o a un worker y retornar resultados acotados. No enviar el grafo completo para contestar cada consulta.

El almacenamiento por archivo **sí tiene caché**: sería incorrecto afirmar que cada snapshot caliente relee todos los JSON del disco. Lo que se repite al invalidar es la composición global, deduplicación, vínculos de notas y transferencia del DTO; cuando cambia la versión también puede requerirse finalizar comunidades. El primer acceso tras reiniciar puede cargar todos los payloads secuencialmente. Esas fases necesitan medición separada antes de decidir un formato nuevo.

Evidencia: [search/current](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseQueryService.ts#L130), [snapshot del shared process](../vscode/src/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryChannel.ts#L372), [caché de payloads](../vscode/src/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryStorage.ts#L130), `reproductions.query`.

## Memoria consistente sin frenar innecesariamente el IDE

La escritura canónica y el checkpoint no son la misma operación. `memory_save` persiste un Markdown; el checkpoint adicional consulta al modelo para decidir qué conservar, incluso ante una respuesta trivial. `OpenideTurnRuntime` espera ese checkpoint antes de terminar.

En Electron, un saludo en modo automático produjo una llamada adicional de checkpoint. Al imponer una demora conocida de 1.500 ms en ese endpoint, el checkpoint comenzó a los 127 ms y el turno terminó a los 1.679 ms. El texto ya era visible a los 822 ms. El modo manual no llamó al checkpoint. Esto demuestra la dependencia del cierre con la respuesta auxiliar; no estima la latencia ni el precio de un proveedor real.

La mejora debe conservar el compromiso solicitado: **cada petición termina con memoria guardada, una decisión explícita de que no hay información durable, o trabajo pendiente recuperable**. No basta con disparar una promesa y olvidar su resultado.

Propuesta:

1. Persistir el delta/watermark pendiente antes de dar por finalizada la captura. Un worker por conversación procesa y registra `saved`, `no_durable_change` o un error recuperable.
2. Separar el estado de respuesta del estado de memoria en la UI: respuesta lista; memoria guardándose/guardada/pendiente. El próximo turno debe conocer si queda una captura pendiente; definir una barrera acotada de lectura para peticiones que dependan de esa memoria.
3. Mantener explícitas y sin demora las escrituras solicitadas por el usuario. No omitir decisiones expresadas sólo en conversación por una heurística basada en uso de herramientas.
4. Mantener la captura previa a compacción y la recuperación después de reinicio. Antes de cambiar a background, probar cancelación, salida inmediata, reintento idempotente, revisión concurrente y cambio de raíz.
5. Evaluar un modelo auxiliar configurable o candidatos estructurados del turno principal sólo después de medir calidad de recuerdo. Una respuesta más rápida no justifica menos memoria correcta.

Además, Mem0 opcional realiza sincronización y red dentro de la misma cola nativa por raíz. Separar proyección remota y lecturas canónicas con IDs/hashes de versión evita que una demora de red retenga operaciones locales. El borrado canónico debe seguir excluyendo el dato inmediatamente aunque la proyección esté pendiente. No es un cuello de botella por defecto: Mem0 está apagado.

Al olvidar una nota, la proyección actual espera `rebuildFull()`. Usar una eliminación incremental del URI y actualizar relaciones evita releer todo el código por borrar una observación. Debe conservarse la desactivación de predecesores.

Evidencia: [checkpoint](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideMemoryCheckpoint.ts#L42), [cierre del runtime](../vscode/src/vs/workbench/contrib/openideAgent/common/openideTurnRuntime.ts#L156), [proyección](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts#L824), [cola y proyección Mem0](../vscode/src/vs/platform/openideAgentHost/node/openideMemoryOwner.ts#L91).

## Arranque, chat y tareas de fondo

Las dos aperturas finales alcanzaron el workbench en 5,11 y 5,21 s; abrir el chat mediante la paleta llevó el tiempo acumulado a 6,10 y 6,24 s. La petición llegó al proveedor local 100–114 ms después de enviarla, en una carpeta mínima. El heap JS del renderer rondaba 143–149 MiB; su working set informado por Electron, 662–665 MiB. Heap y working set miden cosas diferentes; no deben sumarse, ni sumar RSS de procesos para inferir memoria física única.

El tramo de tres segundos inmediatamente posterior a abrir el chat registró 1,05–1,36 s de `TaskDuration`. **No es una medición de reposo estable**: todavía hay trabajo de arranque y la ventana está en otro workspace. No permite atribuir lentitud a una función específica ni concluir fuga de memoria. Tampoco permite convertir el tiempo hasta que Playwright observa texto en una medición de fluidez a 60 FPS.

Inspección adicional:

- La contribución MCP en `Restored` llama a `agentService.externalTools()`: fuerza la creación del servicio nativo completo pese a estar registrado como delayed. Separar schemas estáticos de handlers diferidos puede reducir activación, pero requiere una traza de arranque y un A/B de build de producción. [Contribución](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgent.contribution.ts#L185).
- Watcher y enriquecimiento LS se instancian en `AfterRestored`; el bridge ya limita a 1.500 archivos, trabaja de a 25 y cede 50 ms entre lotes. Priorizar archivos abiertos/cambiados y trabajo ocioso; verificar configuración disabled y confianza en toda la contribución. [Contribución del índice](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseMemoryContribution.ts#L23).
- Al restaurar almacenamiento se marca todo stale, pero el rebuild automático se dispara por versión cero. Definir una reconciliación incremental de los archivos persistidos y medir tiempo hasta índice verificado. Es un riesgo observado en código, todavía sin reproducción de producto específica.
- El chat **ya agrupa repintados por frame** y conserva partes DOM. No corresponde proponer React.memo como solución: esta superficie es TypeScript/DOM de workbench. Persistencia de sesiones serializa el conjunto completo y Markdown vuelve a parsear contenido antes de reconciliar bloques: perfilar conversaciones largas antes de optimizar. [Pacing](../vscode/src/vs/workbench/contrib/openideAgent/browser/chat/openideChatController.ts#L321), [Markdown](../vscode/src/vs/workbench/contrib/openideAgent/browser/chat/parts/openideChatMarkdownPart.ts#L88), [persistencia](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideChatSessions.ts#L195).
- El bridge de selección construye texto y publica IPC en eventos de cursor; investigar coalescing, límite de selección y suscripción sólo cuando haya clientes. Los hooks Claude ya combinan watcher y polling de respaldo de 2 s; no quitar el respaldo sin verificar entrega. [Selección](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideIdeServerService.ts#L313), [hooks](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentCliHooks.ts#L253).

## Descubrimiento: lo que existe y lo que falta

El [catálogo](../vscode/src/vs/workbench/contrib/openideAgent/common/openideAgentCliCatalog.ts#L174) contiene ocho CLIs. La sonda nativa emitió 69 definiciones, 37.993 bytes de JSON. Aplicando el allowlist y los transformadores reales a ese request, se obtienen **24 herramientas puente, 25.754 bytes**, de los cuales **13.214 bytes son contexto añadido por las descripciones externas**. A eso se agregan 11 herramientas visibles de compatibilidad y `openide_memory_read`: 36 definiciones previstas en esa configuración. Esto es una reconstrucción desde el request real, no una captura de `tools/list` externo; los bytes no son tokens de un tokenizer ni prueba de qué cargó cada modelo.

El protocolo inicial sólo describe memoria; `prompts/list` y `resources/list` devuelven vacío. Las descripciones de memoria todavía presentan `.openide/MEMORY.md` como ubicación general aunque las notas detalladas viven en `.openide/memory/notes/`. `openide_memory_read` sólo lee el overview y puede decir que está vacío aunque existan notas. Es una fuente de confusión concreta.

Una descripción, `openide_browser_record_start`, alcanza 2.093 bytes. Claude documenta un límite de 2 KB para instrucciones del servidor y descripciones; también documenta búsqueda diferida de herramientas y la importancia de explicar categorías y momentos de uso. Por tanto, poner toda la orientación en cada descripción deja información repetida y puede cortar el final. No se comprobó el truncamiento ejecutando un modelo en esta investigación. [Documentación oficial de Claude MCP](https://code.claude.com/docs/en/mcp).

El transporte serializa nombres, descripciones y schemas, sin annotations ni outputSchema. La conversión genérica de resultados a texto puede presentar un `Error: ...` como resultado MCP sin `isError`. Conviene migrar a resultados tipados, preservando imágenes, grabaciones y la revisión bloqueante de planes. No inferir error buscando palabras arbitrarias en texto. [Listado](../vscode/src/vs/platform/openideAgentHost/electron-main/openideIdeServerMain.ts#L102), [bridge](../vscode/src/vs/workbench/contrib/openideAgent/browser/openideIdeServerService.ts#L262).

### Situación por CLI

- **Claude Code 2.1.263 instalado:** inyección por `--mcp-config` con archivo 0600; hooks actuales de OpenIDE informan estado, no inyectan un protocolo de capacidades al modelo. Mejorar primero `initialize.instructions`; después agregar integración de sesión/compacción, con contenido acotado. Claude ofrece `additionalContext` en hooks y `SessionStart` permite reintroducir contexto. [Hooks oficiales](https://code.claude.com/docs/en/hooks).
- **Codex 0.153.4 instalado:** inyección por `-c` de URL, nombre de variable bearer y timeout. Conservar esta vía sin sustituir su configuración personal. La documentación confirma transporte HTTP, bearer por variable y filtros de herramientas. Verificar por versión si consume instrucciones del servidor y cómo vuelve a descubrir después de compacción; no dar por hecho que admite los hooks de Claude. [MCP oficial](https://developers.openai.com/codex/mcp).
- **OpenCode 1.17.12 instalado:** integración por `OPENCODE_CONFIG`. Mantener merge y comprobar colisiones/precedencia de configuración del proyecto. Su documentación advierte que MCP aumenta contexto: reducir repetición beneficia a clientes que cargan schemas completos. [MCP oficial](https://opencode.ai/docs/mcp-servers/).
- **Grok 1.0.13 instalado:** OpenIDE ofrece registro explícito persistente, sin inyección por lanzamiento. El comentario del catálogo todavía se basa en 0.2.118 y dice no asumir remove/update; la ayuda actual ofrece `mcp remove`, `doctor` y add/update. Revalidar adaptador y limpieza exclusivamente de entradas propiedad de OpenIDE. La ayuda también expone `--rules` para orientación adicional. No se comprobó una opción de MCP temporal equivalente a la de Claude. [MCP oficial](https://docs.x.ai/build/features/mcp-servers).
- **Copilot, no instalado:** sin adapter MCP en OpenIDE, pese a que su documentación ofrece `--additional-mcp-config @archivo` por sesión. Es un candidato directo para extender el builder 0600, conservando permisos del CLI. Validar `headers`, `tools` y merge en una versión fijada antes de anunciar compatibilidad. [Referencia oficial](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).
- **Amp, no instalado:** sin adapter actual. Su documentación incluye `--mcp-config` y carga de herramientas mediante skills. Verificar forma del archivo y semántica de merge en el binario objetivo; no reutilizar ciegamente JSON de Claude. Las definiciones remotas de Amp y sus orbs no equivalen al endpoint local del IDE. [MCP oficial](https://ampcode.com/docs/customize/mcp).
- **Gemini, no instalado:** sin adapter actual. Soporta `mcpServers` con `httpUrl` y headers. No usar `GEMINI_CLI_SYSTEM_SETTINGS_PATH` como atajo de sesión: corresponde a configuración administrativa y puede alterar precedencia/políticas. Investigar extensión o configuración soportada que agregue sólo OpenIDE. [MCP oficial](https://geminicli.com/docs/tools/mcp-server/), [referencia de configuración en el repositorio oficial](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md).
- **Droid, no instalado:** sin adapter actual. Documenta archivos `mcp.json` de usuario, carpeta y proyecto; no se verificó una opción temporal equivalente. Preparar conexión guiada con propiedad/revocación explícitas antes de modificar configuración persistente. [MCP oficial](https://docs.factory.ai/harness/mcp).

Esta matriz describe implementación y evidencia, no una certificación de los ocho clientes. Un binario encontrado en PATH no significa autenticado; un archivo generado no significa conectado; `tools/list` no prueba que el modelo eligió bien.

## Arquitectura recomendada para descubrir herramientas

### Un registro de capacidades, varias presentaciones

Crear `OpenideCapabilityCatalog` como fuente única de metadatos: ID estable, familia, propósito, cuándo usarla, requisitos, disponibilidad, schema, ejemplos breves, efectos, presupuesto de resultado y versión. Los handlers permanecen en servicios con activación diferida. Generar desde ese catálogo instrucciones MCP, descripciones, ayuda dentro del IDE y paquetes de orientación por CLI.

Propuesta inicial de texto del servidor, a validar con evaluaciones:

> OpenIDE connects this project to the IDE's live browser, code graph, shared Markdown memory, editor diagnostics and editable plan review. For UI bugs or visual checks, discover its browser tools to inspect the user's current page. For architecture or change impact, use project_map_query and verify stale evidence against source. For prior decisions, search memory and expand relevant notes; save durable findings with memory_save after checking the current revision. For a plan the user should edit and approve, use plan_save; it waits for their decision. These capabilities are scoped to this workspace. Use the tool names exposed by your client.

Es texto nuevo de OpenIDE; su tamaño objetivo es menor a 1.500 bytes UTF-8. Los nombres reales pueden llevar prefijos del cliente: no fijar `mcp__...` como si fuera universal. El registro permite aplicar una comprobación automática de longitud y evitar contradicciones entre overview y notas.

### Descubrimiento progresivo sin romper permisos

Primero reducir descripciones duplicadas y permitir que los clientes con búsqueda nativa la utilicen. Un recurso/prompt de ayuda puede complementar, pero no garantiza consumo automático. MCP define listado y notificaciones de cambios; no garantiza que un modelo vea o siga instrucciones. [Especificación de herramientas](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

Luego evaluar una herramienta acotada `openide_capabilities` o `openide_tool_help`, que devuelva familias, disponibilidad y ejemplos según intención. No crear inicialmente un `execute_any_tool` genérico: perdería schemas y decisiones de permisos por herramienta. No ocultar herramientas detrás de cambios dinámicos del listado hasta probar actualización y caché de cada cliente. Prompts/recursos y skills sirven de orientación; las operaciones siguen cruzando el allowlist, la raíz autorizada y sus validaciones.

### Lo que verá una persona que no leyó la documentación

En cada sesión CLI: estado compacto **“Herramientas de OpenIDE conectadas”**, con acceso a Memoria, Mapa, Navegador y Planes; mostrar sólo estados que se verificaron. Ejemplos de intención: “revisá esta pantalla”, “qué depende de este módulo”, “recordá esta decisión”, “prepará un plan para revisar”. La IA recibe la misma guía sin que la persona tenga que pegarla en el prompt.

Si falla: distinguir instalado / preparando conexión / conectado / herramientas disponibles / autenticación requerida / integración no disponible. Ofrecer reintentar, reconectar o abrir diagnóstico. Si se pudo lanzar el CLI pero falló la escritura del config MCP, hacerlo visible: actualmente esa ruta continúa sin herramientas.

No depender del `clientInfo.name` remoto para atribución confiable. Un ticket por lanzamiento, asociado por el host a sesión/ventana/workspace, permite medir inicialización, listado, errores y uso sin confundir dos CLIs. Registrar tiempos, IDs y contadores, nunca bearer tokens ni contenido privado de prompts/notas.

### Relación con Engram y los nodos

La idea útil de Engram es el **protocolo repetido en momentos del ciclo de vida**, no sólo una herramienta llamada memoria. En la referencia local, `plugin/claude-code/hooks/hooks.json` conecta inicio/reanudación, recuperación tras compactación y eventos del turno; los scripts inyectan protocolo y contexto. Se inspeccionó el checkout local `8a982bb762c2183ca087e10e2a3b7504a57a14cc`; no se copió implementación.

En OpenIDE, el `.md` sigue siendo la fuente canónica. `memory_save` escribe; el indexador proyecta un nodo con ID estable; los enlaces lo relacionan con código; `project_map_query` consulta esa vista derivada. La guía del CLI debe enseñar a buscar antes de guardar y distinguir una decisión durable de un handoff. La caché acelera esa lectura y el grafo agrega relaciones; ninguno debe sustituir o reescribir silenciosamente la fuente canónica.

Para un CLI con hooks soportados, reinjectar orientación al iniciar, reanudar y compactar. Usar scope de lanzamiento y preservar hooks del usuario. Si no hay mecanismo verificado, mantener MCP y mostrar el nivel de soporte real. No prometer checkpoints automáticos dentro de todos los loops externos: el agente externo conserva control sobre su ejecución. Una escritura sólo cuenta como guardada cuando hay recibo canónico; un hook disparado o un texto del modelo no lo prueba.

## Bloques de implementación y aceptación

Los siguientes objetivos son propuestas para el próximo bloque, no mejoras ya logradas. Las metas temporales se calibran con el mismo equipo/fixture y luego con builds de producción.

1. **PR de integridad del índice.** Corregir drenaje del watcher e invalidación/promesa compartida. Casos: 501 y 2.000 cambios, evento nuevo durante flush, lectura fallida, archivo grande, cancelación, invalidación durante carga y dos consultas simultáneas. Aceptación: cero cambios perdidos; ningún snapshot anterior se publica tras invalidación; una carga compartida por generación.
2. **PR de almacenamiento y memoria.** Actualizaciones O(1) del manifiesto, contadores por diferencia, snapshot canónico cacheado y un recall por turno. Meta exploratoria: inserción en memoria de 5.000 archivos por debajo de 1 s frente a 6,1 s; recall caliente de 500 notas + 200 sesiones por debajo de 50 ms. Aceptación funcional: hashes/revisiones, edición manual, symlinks, dirty buffers y concurrencia siguen protegidos. La meta de rendimiento no permite omitir esos controles.
3. **PR de orientación y diagnóstico CLI.** Catálogo único, instrucciones completas y breves, descripciones bajo 2 KB, resultados MCP tipados y estado de conexión. Corregir la semántica de `memory_read`. Conservar nombres existentes y compatibilidad de planes/imágenes. Meta: reducir al menos 40% los 13.214 bytes de prefijos añadidos, comprobando que siguen claras las reglas de memoria y revisión.
4. **PR de adapters y protocolo de memoria externo.** Certificar primero Claude, Codex y OpenCode; revalidar Grok actual; agregar Copilot y Amp con binarios fijados. Gemini/Droid quedan detrás de una capacidad explícita hasta verificar el mecanismo. Pruebas: nueva sesión, resume, compactación, dos ventanas, cierre/revocación, configuración ajena preservada y fallo recuperable. No marcar “conectado” sólo porque el CLI se inició.
5. **PR de checkpoints y proyecciones.** Desacoplar finalización visible y captura durable con cola persistida; eliminar rebuild completo al olvidar; separar red Mem0. Aceptación: salida inmediata y reinicio no pierden pendiente; reintento no duplica nota; UI distingue guardado de pendiente; captura previa a compactación conserva información.
6. **PR guiada por perfiles del editor.** Trazas de renderer/main/shared process, A/B de activación diferida, queries en worker, Markdown largo, historial de sesiones y selección. Aceptación: demostrar mejora en la traza que motivó el cambio y ausencia de regresión funcional. No reescribir renderizado ni desactivar extensiones del usuario como “optimización”.

## Evaluaciones necesarias para certificar descubrimiento

Preparar una suite sin nombres de herramientas en las peticiones: revisar una pantalla ya abierta; investigar impacto; recuperar una decisión; guardar una convención; revisar un plan editable; reportar falta de navegador; reanudar tras compactación; rechazar una herramienta fuera de scope.

Comparar baseline y guía nueva con los mismos modelos/versiones y fixtures, varias repeticiones por intención, incluyendo tareas negativas donde OpenIDE no aporta nada. Medir selección de herramienta adecuada, llamadas innecesarias, tiempo hasta primera herramienta útil, errores de argumentos, bytes/tokens efectivamente cargados, éxito de escritura y recall tras reinicio. Objetivo inicial propuesto: ≥90% de elección útil en tareas pertinentes y sin aumentar uso innecesario en las negativas. No hay una tasa medida todavía.

Para rendimiento de release: al menos 10 arranques en frío de proceso y 10 reaperturas por perfil; 30 muestras para latencias interactivas; repositorios de 500/2.000/5.000 archivos; 0/50/200/500 notas; sesiones largas y varios CLIs. Separar tiempo de proveedor de preparación, tool queue, IO, proyección y render. Cold de proceso no equivale a vaciar la caché del sistema operativo.

## Reproducción

Desde la raíz, con `vscode/out` generado desde las fuentes que se quiere evaluar:

```bash
node dev/bench-memory-performance.mjs
node dev/probe-memory-indexing.mjs
./result-fhs/bin/openide-build -c 'node dev/probe-performance-cli.mjs'
```

La tercera sonda requiere Electron y Playwright ya disponibles y Hyprland para verificar el workspace 6. Crea y elimina perfiles temporales; sólo usa un proveedor local. La sonda de indexing documenta y afirma las reproducciones de esta versión: después de corregirlas, convertirlas en expectativas de regresión en la suite del producto, en vez de conservar assertions del comportamiento defectuoso.

Los resultados actuales están preservados en [JSON](research/performance-cli-2026-09-06.json); las ejecuciones nuevas escriben en `.build/performance-cli-investigation/`. Las sondas se verificaron sintácticamente después de trasladarlas a `dev/`; los módulos medidos no se editaron durante la investigación. No se ejecutó un typecheck completo porque no cambió TypeScript de producto.
