# GOAL en OpenIDE: investigación y propuesta de integración

Fecha de investigación: 7 de septiembre de 2026. La implementación posterior se documenta en [Objetivos persistentes](goals.md). Audiencia: diseño e implementación de OpenIDE. Alcance: documentación pública actual, código fuente fijado y lectura del checkout local. No es una certificación de producto ni una implementación de GOAL.

Recomiendo una tarjeta persistente, un contrato Markdown y un supervisor propio que cierre objetivos con evidencia. La propuesta funciona por capacidades del adaptador, con independencia del proveedor.

## Comparación con evidencia

### Codex

Tiene objetivo por conversación, fila de progreso y controles de pausa, reanudación, edición y limpieza. Recomienda resultado, restricciones y verificación; puede partir de un plan. El protocolo local generado con 0.146.0 distingue active, paused, blocked, usageLimited, budgetLimited y complete. El código público inspeccionado serializa cambios del objetivo y solo inicia continuación si el hilo está libre. Las herramientas del modelo permiten completar o bloquear; los demás controles corresponden al usuario o sistema.

Aplicación: Tomar el objetivo durable y la separación entre turno terminado y objetivo cumplido. Límite: La UI privada de escritorio no está auditada. El protocolo upstream presente en OpenIDE ignora sus notificaciones en esa interfaz; no equivale a una integración GOAL ya terminada.

Fuentes: [Codex · Long-running work](https://learn.chatgpt.com/docs/long-running-work), [Codex · controlador y continuación](https://github.com/openai/codex/blob/8e694e955ae02ca737230a5468c55d5847074072/codex-rs/ext/goal/src/runtime.rs), [Codex · herramientas de objetivos](https://github.com/openai/codex/blob/8e694e955ae02ca737230a5468c55d5847074072/codex-rs/ext/goal/src/tool.rs).

### Claude Code

Tiene /goal nativo. Un modelo separado revisa el diálogo después del turno y devuelve pendiente, cumplido o imposible. No ejecuta pruebas por sí mismo. Muestra razón, tiempo, turnos y tokens. Al reanudar conserva el objetivo activo, pero reinicia contadores. El trabajo en background difiere la evaluación; incorpora esperas crecientes y límites a despertares.

Aplicación: Mostrar el motivo de cada evaluación y comprobar el cierre con evidencia. Límite: Documentación actual, no ensayo del /goal instalado. Sus snapshots cubren herramientas de edición; Bash y cambios externos no quedan íntegramente cubiertos. Un juez LLM es falible.

Fuentes: [Claude Code · Goals](https://code.claude.com/docs/en/goal), [Claude Code · Checkpointing](https://code.claude.com/docs/en/checkpointing).

### Cursor

Documenta /goal como objetivo duradero y señala despliegue gradual. En CLI, Ctrl+C pausa. Plan Mode permite revisar y editar Markdown antes de construir. Los checkpoints locales son una función diferenciada del historial Git.

Aplicación: Reutilizar el flujo Plan → ejecutar objetivo y una superficie compacta persistente. Límite: No encontré evidencia pública del algoritmo del juez, formato interno de GOAL ni un goal.md propio. No atribuirle la implementación de Claude.

Fuentes: [Cursor · Agent y Goals](https://cursor.com/docs/agent/overview#goals-with-goal), [Cursor · Plan Mode](https://cursor.com/docs/agent/plan-mode).

### OpenHands

GoalController separa la decisión de continuar del driver que ejecuta la conversación. Un juez revisa evidencias y devuelve faltantes; el bucle diferencia complete de capped. El controlador tiene estados aptos para UI.

Aplicación: Es la referencia más directa para estructurar un supervisor independiente del proveedor. Límite: El juez realiza I/O aunque el controlador no transporte mensajes. Persistir la conversación no demuestra que el contador en memoria del supervisor sobreviva automáticamente a un crash.

Fuentes: [OpenHands · Goal Completion Loop](https://docs.openhands.dev/sdk/guides/convo-goal), [OpenHands · GoalController](https://github.com/OpenHands/software-agent-sdk/blob/df2ea8fa5542d5d2a543e108bc8b2d4fbbab34b1/openhands-sdk/openhands/sdk/conversation/goal/controller.py).

### Cline

Focus Chain crea focus_chain_taskid_<id>.md y conserva una checklist legible. El SDK inspeccionado guarda checkpoints compatibles con stash en refs privadas por sesión/ejecución; la historia evita reemplazar el baseline al reanudar.

Aplicación: Adoptar un documento propio y snapshots con identidad estable. Límite: No confirmé sincronización bidireccional completa de Focus Chain. La documentación describe shadow Git por herramienta y el SDK inspeccionado usa captura por turno: son superficies/revisiones diferentes. Un snapshot no prueba autoría.

Fuentes: [Cline · Focus Chain Markdown](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/apps/vscode/src/core/task/focus-chain/file-utils.ts), [Cline · Checkpoint hooks SDK](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/sdk/packages/core/src/hooks/checkpoint-hooks.ts), [Cline · Checkpoints](https://docs.cline.bot/core-workflows/checkpoints).

### LangGraph

Diferencia checkpoints de ejecución de memoria compartida. Una interrupción durable puede esperar entrada y reanudarse; al recuperar un nodo se ejecuta nuevamente desde el comienzo.

Aplicación: Separar la memoria del estado operativo y reconciliar efectos antes de repetir acciones. Límite: Es infraestructura de workflows, no una función GOAL de IDE. No hace falta incorporarlo como dependencia para aplicar estos principios.

Fuentes: [LangGraph · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts).

El experimento de Anthropic añade una advertencia relevante: compacción sola no evita cierres prematuros. Usó requisitos estructurados, registro de progreso y verificación end-to-end. Su elección de JSON frente a Markdown es evidencia de ese experimento, no una prohibición general de Markdown ni prueba del almacenamiento de Claude Code. [Anthropic, 26-11-2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

## Decisión recomendada

Construir GOAL como capacidad propia del host de OpenIDE, reutilizando el diario, los planes, las herramientas y la revisión de cambios existentes. El proveedor ejecuta; OpenIDE conserva identidad, contrato, evidencia y controles. Primera entrega: agente nativo y un adaptador CLI estructurado verificado. Los demás muestran el nivel de soporte real.

Sí recomiendo .openide/goals/<goal-id>/GOAL.md. El objetivo define el resultado; el plan explica los pasos; la memoria conserva aprendizajes reutilizables. Los tres se enlazan y tienen ciclos de vida distintos. Este documento es una propuesta: GOAL todavía no está implementado.


## Experiencia en el IDE

Entrada “Goal” en el menú + y /goal en el compositor; también “Ejecutar como Goal” desde un plan. Un único objetivo activo por conversación en la primera versión. El inicio reutiliza la autorización de la petición; pide precisión solo cuando falta una condición necesaria para saber cuándo terminar.

Tarjeta hermana de OpenideChatTerminalsTray, entre conversación y compositor. Mostrar título, estado, criterio actual, última evidencia y “3 de 5 criterios verificados”. No inventar porcentajes de trabajo: los criterios pueden tener complejidades muy distintas. Mostrar tiempo activo y total por separado; tokens solo si se conocen.

Expandir abre Resumen, Actividad, Evidencias y Cambios; acciones Abrir GOAL.md, Abrir plan, Pausar, Reanudar y Cancelar. Pausa detiene nuevas continuaciones y explica si hay una operación terminando. Cancelar conserva historial. Detener una terminal asociada requiere distinguirla de pausar el objetivo. Usar teclado, texto de estado y anuncios accesibles acotados; no mover foco ni abrir ventanas por cada reporte.

La semejanza con terminal background es visual. Un goal persiste después de que muere un proceso. Al cerrar el host se registra interrupción; reabrir permite reconciliar y reanudar. Seguir trabajando con el IDE cerrado exige un worker persistente aparte y queda fuera de la primera entrega.


## Markdown, estado e informes

GOAL.md contiene frontmatter con schema_version, id, revisión, título y plan_ref; cuerpo con resultado, alcance, restricciones y criterios C1…Cn. Cada criterio define evidencia esperada, validador automático o revisión manual. El host asigna identidad/revisión. Una casilla editada no convierte por sí sola un criterio en verificado.

Guardar contrato versionado y su hash en el almacén local del host. Cambiar criterios genera una nueva revisión explícita; invalida evidencias afectadas. Las ediciones directas del .md se muestran como cambio de contrato para reconciliar. El registro controla la revisión en vigor, no la mera fecha del archivo. Validar rutas, esquema y tamaño siguiendo el almacenamiento existente.

El estado operativo y eventos quedan en almacenamiento local del host, separado de los documentos compartibles: goalId, sessionId, runId, contractRevision, seq, status, reason, checkpointId y referencias a evidencias. Snapshot JSON es una proyección reconstruible del journal. Registro antes de efectos; escritura atómica para snapshots; serialización y control de revisión para escritores concurrentes.

REPORT.md se actualiza en hitos, verificaciones, bloqueos, pausa y cierre: qué cambió, qué se comprobó, qué falta y enlaces a diff/evidencia. El host genera hechos y enlaces desde recibos; la IA redacta una explicación breve identificada como tal. No reescribir por token ni volcar razonamiento interno. Los logs completos viven fuera del .md con lectura paginada y retención.

GOAL.md y REPORT.md son portables y opcionalmente versionables. Baselines, credenciales y registros operativos quedan locales; compartir el contrato no inicia ejecución en otra máquina. Los artefactos generados del objetivo se excluyen del cómputo de progreso para evitar que reportarse a sí mismo parezca trabajo.


## Controlador, estados y verificación

Separar lifecycle (draft, active, paused, blocked, interrupted, limit_reached, failed, completed, cancelled) de phase (working, waiting, verifying). reason indica aprobación, autenticación, presupuesto, red o tarea pendiente. Así esperar un test no equivale a estar bloqueado, ni llegar a un límite equivale a éxito.

Bucle: adquirir lease del objetivo → comprobar contrato y entorno → iniciar un turno si no hay otro activo → registrar operaciones/resultados → esperar tareas relevantes → verificar → continuar con faltantes concretos o cambiar estado. Eventos de finalización de tareas despiertan al supervisor; temporizadores con espera creciente sirven solo para diagnóstico. Una terminal de desarrollo permanente no debe impedir completar: marcar dependencias required_for_completion frente a servicios auxiliares.

La IA solicita finalizar; GoalVerifier evalúa los criterios con recibos reales del host. Guardar command, cwd, exitCode, tiempo, salida referenciada, versión del contrato y hashes del estado comprobado. Una prueba aprobada antes de una edición relevante pasa a obsoleta. Que el agente haya editado una prueba no demuestra que haya conservado la exigencia: registrar cambios de validadores y revisar si alteran el contrato.

Para aspectos semánticos, un evaluador opcional recibe contrato y evidencia seleccionada. Su veredicto no sustituye resultados ausentes. Debe poder devolver insuficiente o revisión manual. Completed exige todos los criterios vigentes, ninguna operación relevante incierta y reporte final. Ni fin de respuesta, ni PTY silenciosa, ni código de salida 0 de un CLI bastan.

Presupuesto y máximos de turnos/tiempo los aplica el host cuando son medibles. No convertir consumo desconocido a cero ni inventar coste de una suscripción. Si no hay medidor de tokens usar límites observables. Detectar repetición con huellas de error y ausencia de evidencia nueva; tras un umbral configurable y persistido, bloquear con diagnóstico accionable. No contar solo llamadas a herramientas: pueden repetirse sin progreso.

Al recuperar un crash, invalidar leases del proceso anterior, releer contrato/journal y comprobar archivos/tareas. Una operación con intención sin resultado conserva estado incierto y se inspecciona; no se repite automáticamente. Un fallo de disco impide la acción dependiente. No prometer exactly-once para comandos arbitrarios o efectos remotos.


## Qué diff pertenece al Goal

Capturar baseline al iniciar, incluyendo estado sucio previo y snapshots necesarios de archivos no rastreados dentro de límites. Etiquetar modificaciones del agente nativo con goalId/runId/operationId, versión antes/después y recibo. Agrupar por objetivo conservando la cadena de cambios, no sumando parches incompatibles de varios turnos.

Ofrecer vistas Desde el inicio, Por hito y Estado actual. Separar “atribuido a una operación”, “observado durante el objetivo” y “autoría incierta/conflicto”. En CLI sin eventos de edición, el watcher y Git solo justifican la segunda categoría. Un worktree aislado reduce mezcla, pero tampoco convierte todas sus ediciones en autoría probada.

Restaurar únicamente archivos o fragmentos revisados y con estado posterior todavía coincidente. Rechazar si cambió el contenido, hay escritores activos o faltan snapshots exactos. Para binarios, renombres, conversiones Git, enlaces o archivos grandes sin soporte, mostrar limitación y comparación adecuada; nunca ofrecer un reset global como “deshacer goal”. Los efectos fuera de archivos necesitan registros específicos y no tienen rollback genérico.


## Memoria y sistema de nodos

Incorporar un nodo goal con ID estable y enlaces a plan, runs, criterios, evidencias, archivos y notas. Distinguir aristas observed_change de attributed_change. La vista del grafo deriva del contrato/journal; no decide el estado ni se convierte en un segundo scheduler.

Al inicio recuperar notas relevantes y decisiones previas; en hitos y al terminar, proponer aprendizajes duraderos mediante el servicio de memoria Markdown existente, con topic_key, expected_revision y recibo. Guardar decisiones, causas y soluciones reutilizables; no cada turno ni afirmaciones todavía no verificadas. Relacionar nota ↔ goal ↔ evidencia.

Un goal fallido también puede producir una nota válida, por ejemplo una limitación comprobada. Que haya memoria nueva no significa que el goal terminó. Al borrar y reconstruir índices de Project Map deben permanecer contratos, reportes y estado recuperable.


## CLIs y descubrimiento natural

Un solo dueño del bucle: continuationOwner = openide | provider | manual. OpenIDE supervisa al agente nativo. Un CLI con protocolo estructurado puede delegar en su goal nativo y proyectar eventos, o dejar la continuación al host; nunca activar ambos sin coordinación explícita.

El adaptador declara resume, interrupt, turnEvents, fileReceipts, usage y nativeGoal. Inspeccionar versión/capacidades al iniciar. El Codex TUI de tu captura y el app-server upstream son caminos distintos: la presencia de tipos en el repo no conecta automáticamente el terminal hospedado.

Para una PTY genérica, ofrecer contrato, reportes y cambios observados. Sin límites de turno verificables no enviar “continúa” al detectar silencio. La autonomía completa requiere un adaptador validado. Cambiar de CLI recupera objetivo y pendientes desde OpenIDE; no promete migrar el razonamiento privado ni el historial interno del proveedor.

Exponer herramientas comunes de intención: openide_goal_get, openide_goal_report y openide_goal_request_completion, más creación/edición dentro de la autorización del usuario. Inyectar contexto corto en inicio, reanudación y compacción: objetivo vigente, pendientes, bloqueo y cómo obtener evidencia. Publicar solo herramientas registradas. Los ejemplos deben responder a “seguí hasta cumplir el plan”, “cómo va”, “qué cambió este objetivo” sin que el usuario memorice nombres.

Primero resolver identidad de sesión al reportar por MCP: el endpoint actual es de ventana. No confiar en un goalId arbitrario suministrado por un modelo para acreditar autoría. Hasta contar con asociación del host validada, los reportes externos quedan declarados, no recibos autenticados de una ejecución. Esta es una dependencia concreta del seguimiento fiable, no motivo para bloquear las partes independientes.


## Rendimiento y límites del alcance

Reutilizar servicios TypeScript y el almacenamiento existente; no incorporar Mem0, LangGraph u otro backend solo para GOAL. Sus patrones aportan diseño, pero no justifican por sí mismos una dependencia. Medir primero latencia de checkpoint, lectura y reconstrucción en el repositorio grande.

Diffs bajo demanda, snapshots deduplicados, journal paginado e índices incrementales. Actualizaciones de UI agrupadas; escritura durable antes de efectos y reportes menos frecuentes son requisitos distintos. Cargar primero la fila de resumen, no toda la historia. Aplicar cuotas a logs/snapshots y preservar la evidencia que aún respalda un criterio.

Primera entrega excluye daemon 24/7, ejecución cloud automática, múltiples writers sobre el mismo checkout y compatibilidad completa por simples heurísticas con todos los CLIs. La arquitectura deja interfaces para esos casos; la UI debe distinguir lo implementado de lo que requiere adaptador.

## Plan de implementación propuesto

### 1 · Contrato y persistencia

Definir OpenideGoal, eventos versionados, GoalStore, control de revisiones y recuperación; enlazar GOAL.md/REPORT.md.

Cierre del bloque: Tras reinicio conserva identidad, historial y criterios; cambiar el contrato invalida evidencias relacionadas.

### 2 · Supervisor y verificador nativo

GoalService coordina turnos y tareas; GoalVerifier valida recibos, límites y estado.

Cierre del bloque: Terminar un turno no cierra el objetivo; pausa vence a una continuación simultánea; fallo de disco impide efectos.

### 3 · Tarjeta y editor de objetivo

OpenideChatGoalTray comparte lenguaje visual con terminales y abre actividad, evidencia y cambios.

Cierre del bloque: Todos los estados restauran sin crash; teclado y lector de pantalla; no cambia foco; uso desconocido se muestra desconocido.

### 4 · Diffs por objetivo

Extender changesets nativos y cambios CLI con goalId/baselines/atribución y restore selectivo.

Cierre del bloque: Edición simultánea del usuario nunca se atribuye como segura ni se sobrescribe; archivos previos sucios siguen protegidos.

### 5 · Adaptador CLI y contexto

Certificar Codex estructurado y después Claude; handshake de capacidades, un owner y asociación de sesión.

Cierre del bloque: Prompt natural crea/reporta/retoma objetivo sin nombres de tool; disconnect/resume no duplica turnos ni mezcla ventanas.

### 6 · Memoria, grafo y entrega

Proyectar nodos/aristas y capturar aprendizajes mediante memoria existente; pruebas del paquete instalado.

Cierre del bloque: Reindexar no pierde objetivos; captura idempotente; recorrido real Crear → Ejecutar → Pausar → Reiniciar → Verificar → Diff.

## Pruebas de aceptación

- Fin de turno sin todos los criterios: continúa o expone la dependencia; no completa.
- Test aprobado y archivo relevante modificado después: evidencia obsoleta, nueva verificación.
- El modelo marca checkbox o cambia el test para pasar: no altera silenciosamente el contrato.
- Pausa llega al mismo tiempo que la respuesta final: una sola transición, cero turnos nuevos tras pausa.
- Crash después de intención y antes de resultado: efecto incierto visible, sin replay ciego.
- Reanudar dos ventanas el mismo objetivo: solo una lease activa; reportes no se cruzan.
- Límite de tiempo/uso o error de autenticación: estado preciso, nunca completed.
- Proceso background acaba, queda colgado o es servidor permanente: despierta/diagnostica sin espera infinita.
- Edición manual concurrente y baseline sucio: diff observado bien etiquetado, restore conflictivo rechazado.
- Archivos no rastreados, binarios, renombre y filtros Git: no hay pérdida ni falsa restauración.
- CLI sin eventos fiables: seguimiento básico visible; ninguna continuación inferida del silencio.
- Pruebas con Codex y Claude reales, prompts naturales, resume y compacción: misma identidad y herramientas disponibles.
- Reconstrucción del grafo y reinicio del IDE: no desaparecen contrato ni evidencia.
- Prueba GUI aislada y smoke del paquete: controles y diffs funcionan con teclado sin interrumpir el workspace del usuario.

## Evidencia local y límites de la investigación

Lectura del checkout 1.3.0 más cambios de descubrimiento CLI aún sin publicar. Las conclusiones locales proceden de estos archivos:

- `vscode/src/vs/workbench/contrib/openideAgent/browser/chat/parts/openideChatTerminalsTray.ts`: la bandeja actual representa procesos vivos, sin recuperación propia.
- `vscode/src/vs/platform/openideAgentHost/common/openideRunJournal.ts` y `node/openideRunJournalStore.ts`: journal ordenado, barrera durable y efectos inciertos.
- `vscode/src/vs/workbench/contrib/openideAgent/common/openideCliTurnChanges.ts` y `browser/openideCliChangesService.ts`: ventanas de observación, snapshots y restore condicionado.
- `vscode/src/vs/workbench/contrib/openideAgent/browser/openideIdePlanReview.ts`: revisión de plan y lectura del contenido aprobado.
- `vscode/src/vs/platform/agentHost/node/codex/protocol/generated/v2/ThreadGoal.ts` y `ThreadGoalStatus.ts`: contrato generado con Codex 0.146.0. `codexAgent.ts:3003` ignora notificaciones de GOAL en esa UI upstream.
- `.openide/plans/markdown-memory-integration.md`: memoria Markdown canónica, revisiones y relación con nodos.

Confianza alta en la lectura concreta del código y en las funciones documentadas. No se probaron /goal de Cursor ni Claude, ni se auditó el runtime privado de escritorio. La rama pública de Codex es más reciente que los tipos locales: no asumir equivalencia de versiones. La documentación de Cline y su SDK difieren en el mecanismo de checkpoint; la comparación lo conserva explícito. No se asignan cifras de rendimiento ni plazos de implementación sin medir.

El alcance se cerró tras cubrir continuidad, evaluación, persistencia, Markdown, cambios, CLI, UI y recuperación con fuentes primarias. Queda por validar al implementar la identidad por sesión MCP, las capacidades de cada CLI instalado y el coste real en un checkout grande. No se incorporó código externo.

## Fuentes consultadas

- [Codex · Long-running work](https://learn.chatgpt.com/docs/long-running-work). OpenAI; s. f.. Consultado el 07-09-2026.
- [Codex · Follow a goal](https://learn.chatgpt.com/use-cases/follow-goals). OpenAI; s. f.. Consultado el 07-09-2026.
- [Codex · controlador y continuación](https://github.com/openai/codex/blob/8e694e955ae02ca737230a5468c55d5847074072/codex-rs/ext/goal/src/runtime.rs). OpenAI; commit 8e694e955ae02ca737230a5468c55d5847074072. Consultado el 07-09-2026.
- [Codex · herramientas de objetivos](https://github.com/openai/codex/blob/8e694e955ae02ca737230a5468c55d5847074072/codex-rs/ext/goal/src/tool.rs). OpenAI; mismo commit. Consultado el 07-09-2026.
- [Claude Code · Goals](https://code.claude.com/docs/en/goal). Anthropic; s. f.. Consultado el 07-09-2026.
- [Claude Code · Checkpointing](https://code.claude.com/docs/en/checkpointing). Anthropic; s. f.. Consultado el 07-09-2026.
- [Cursor · Agent y Goals](https://cursor.com/docs/agent/overview#goals-with-goal). Cursor; s. f.; rollout indicado. Consultado el 07-09-2026.
- [Cursor · Plan Mode](https://cursor.com/docs/agent/plan-mode). Cursor; s. f.. Consultado el 07-09-2026.
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). Justin Young / Anthropic; 26-11-2025. Consultado el 07-09-2026.
- [OpenHands · Goal Completion Loop](https://docs.openhands.dev/sdk/guides/convo-goal). OpenHands; s. f.. Consultado el 07-09-2026.
- [OpenHands · GoalController](https://github.com/OpenHands/software-agent-sdk/blob/df2ea8fa5542d5d2a543e108bc8b2d4fbbab34b1/openhands-sdk/openhands/sdk/conversation/goal/controller.py). OpenHands; commit df2ea8fa5542d5d2a543e108bc8b2d4fbbab34b1. Consultado el 07-09-2026.
- [Cline · Focus Chain Markdown](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/apps/vscode/src/core/task/focus-chain/file-utils.ts). Cline; commit dac3b35ba485dbab3b5a73aca239b0d07ce071cf. Consultado el 07-09-2026.
- [Cline · Checkpoint hooks SDK](https://github.com/cline/cline/blob/dac3b35ba485dbab3b5a73aca239b0d07ce071cf/sdk/packages/core/src/hooks/checkpoint-hooks.ts). Cline; mismo commit. Consultado el 07-09-2026.
- [Cline · Checkpoints](https://docs.cline.bot/core-workflows/checkpoints). Cline; s. f.; difiere del SDK inspeccionado. Consultado el 07-09-2026.
- [LangGraph · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence). LangChain; s. f.. Consultado el 07-09-2026.
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts). LangChain; s. f.. Consultado el 07-09-2026.
