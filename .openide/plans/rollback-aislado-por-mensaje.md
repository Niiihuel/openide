---
title: rollback-aislado-por-mensaje
status: aprobado
planModel: gpt-5.6-sol
execModel: gpt-5.6-sol
created: 2026-07-20T03:05:54.473Z
---

# Rollback aislado por mensaje de IA

## Contexto y decisiones

### Hallazgos del sistema actual

El flujo que falla no usa la infraestructura upstream de `ChatEditingSession`, `ChatEditingCheckpointTimelineImpl` ni `AgentHostEditingSession`. El chat propio de OpenIDE implementa un mecanismo paralelo en `openideAgent`:

```mermaid
flowchart LR
  U[Mensaje user sin ID propio] --> R[runMessages]
  R --> T[write_file / edit_file]
  T --> E[OpenideToolRegistry.onDidEdit]
  E --> C[fileCheckpoint before completo]
  C --> M[userMessage.rollbackFiles]
  E --> G[OpenideDiffSnapshotProvider global por path]
  B[Botón Volver: userIndex] --> S[scan messages.slice(cut)]
  S --> W[rollbackFiles: write/delete contenido completo]
  W --> X[truncate conversación desde cut]
```

Servicios localizados y función actual:

| Área | Archivo | Función real en este flujo |
|---|---|---|
| Tipos de chat/checkpoint | `vscode/src/vs/workbench/contrib/openideAgent/common/openideAgentTypes.ts` | `IChatMessage.rollbackFiles` e `IFileRollbackCheckpoint` guardan solo path, contenido anterior y existencia. No hay `messageId`, operación, after-state, hash ni parche. |
| Captura de ediciones | `vscode/src/vs/workbench/contrib/openideAgent/browser/openideTools.ts` | `write_file` y `edit_file` escriben primero y recién después emiten `IFileEditEvent` con before/after. Solo modelan create/modify. |
| Asociación al turno | `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts` | Una suscripción global `tools.onDidEdit` por run emite `fileCheckpoint`; también mantiene `OpenideDiffSnapshotProvider` global por path para review. |
| Persistencia y botón rollback | `vscode/src/vs/workbench/contrib/openideAgent/browser/openideChatView.ts` | El user message se crea sin ID; el checkpoint se agrega mutando `turnMessage.rollbackFiles`. El botón envía un `userIndex`. `rollbackToUserMessage` agrega checkpoints de todos los mensajes desde el corte y, si no encuentra ninguno, revierte todos los diffs pendientes globales. |
| Historial persistente | `vscode/src/vs/workbench/contrib/openideAgent/browser/openideChatSessions.ts` | Persiste los objetos `IChatMessage` completos en `openide.chat.sessions.v1`; por eso `rollbackFiles` sobrevive un reinicio. No normaliza IDs/change sets ni preserva metadata borrada por compactación. |
| Snapshot visual global | `vscode/src/vs/workbench/contrib/openideAgent/browser/openideDiffSnapshot.ts` | Baseline acumulado global por path (`openide.agent.diffSnapshots.v1`), útil para review, pero sin identidad de sesión o mensaje. No debe ser fuente de rollback transaccional. |
| UI del chat | `vscode/src/vs/workbench/contrib/openideAgent/browser/openideChatHtml.ts` | Numera mensajes user con `userMsgSeq` y envía `userIndex`; no usa una identidad estable persistida. |
| Infraestructura upstream VS Code | `vscode/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingSession.ts`, `chatEditingCheckpointTimelineImpl.ts`, `agentSessions/agentHost/agentHostEditingSession.ts` | Ya modela request IDs, checkpoints, create/delete/rename y snapshots, pero pertenece a otro stack de chat. Además restaura snapshots completos y no resuelve el requisito de preservar cambios manuales/posteriores para el chat OpenIDE. No conviene acoplar ambos subsistemas en este cambio. |
| Tracking alternativo agent-host | `vscode/src/vs/platform/agentHost/node/shared/fileEditTracker.ts` y `sessionDatabase.ts` | Persiste before/after por turn/tool call para Agent Host, no recibe las tools del chat OpenIDE y tampoco ofrece rollback selectivo con merge. Sirve como referencia, no como backend directo. |

### Causa raíz exacta

Hay cuatro defectos combinados:

1. **El producto implementa “volver a un punto de la conversación”, no “revertir el mensaje seleccionado”.** `rollbackToUserMessage` recorre `messages.slice(cut)` y junta el primer checkpoint por path; por diseño restaura el workspace al inicio del turno elegido y trunca todo lo posterior. Así, un mensaje sin cambios hereda los checkpoints de mensajes posteriores, y un mensaje B puede incluir/revertir archivos de C, D, etc.
2. **El fallback para mensajes sin checkpoints es global y destructivo.** Si el scan no encuentra checkpoints, recorre `pendingFileDiffs()` y llama `revertEdit()` para cada baseline global. Esto explica directamente que un mensaje sin tool calls borre/restaure cambios no relacionados. Tras reinicio, `revertEdit()` incluso intenta `git checkout HEAD -- <path>` o elimina el archivo no trackeado.
3. **La restauración es de archivo completo y ciega.** `rollbackFiles()` escribe `checkpoint.content` o elimina el archivo sin comparar el estado actual con el estado producido por el mensaje. Cualquier cambio manual o posterior en el mismo archivo se sobrescribe. No existen after-hash ni reverse patch para detectar o fusionar divergencias.
4. **La identidad y el registro son insuficientes.** El rollback se resuelve por índice efímero de mensajes user, no por `messageId`; el checkpoint vive como array mutable dentro del user message y solo expresa “existía/contenido”. No hay transacción explícita, estados open/finalized/cancelled, operación delete/rename, ni aislamiento del review snapshot global. La compactación reemplaza mensajes antiguos, por lo que la metadata embebida en ellos puede desaparecer.

La suscripción `onDidEdit` se crea y dispone por cada `runMessagesInternal`, y los runs raíz están serializados por `OpenideRunSequencer`; por lo tanto no aparece hoy un array singleton compartido literal entre turnos. El aislamiento falla principalmente por el scan desde `cut`, el fallback global, la falta de ID estable y la restauración completa. Aun así, el diseño actual depende de mutaciones sobre el array de mensajes y debe reemplazarse por objetos inmutables/finalizados para impedir referencias compartidas en futuros flujos (fork, cancelación, failover y compactación).

### Arquitectura elegida

Separar tres responsabilidades que hoy están mezcladas:

1. **Change set transaccional por mensaje**: fuente única para rollback, indexada por `messageId` y persistida con la sesión.
2. **Motor puro de parches/rebase inverso**: calcula before/after hashes y hunks estructurados; revierte solo hunks del mensaje sobre el contenido actual y reporta conflicto si no puede ubicarlos sin ambigüedad.
3. **Snapshot acumulado de review**: `OpenideDiffSnapshotProvider` sigue sirviendo a la bandeja/diff visual, pero queda explícitamente fuera de la decisión de rollback.

Modelo previsto (ajustado a JSON serializable y a la aplicación segura de parches):

```ts
interface IMessageChangeSet {
  readonly messageId: string;
  readonly timestamp: number;
  readonly state: 'open' | 'finalized' | 'cancelled';
  readonly files: readonly IFileChange[];
}

interface IFileChange {
  readonly uri: string;
  readonly operation: 'create' | 'modify' | 'delete' | 'rename';
  readonly originalUri?: string;
  readonly beforeContent?: string;
  readonly afterContent?: string;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly forwardPatch?: ITextPatch;
  readonly reversePatch?: ITextPatch;
}
```

`ITextPatch` será estructurado (hunks con líneas de contexto y reemplazo), no un comando shell ni un diff que requiera Git. `beforeContent`/`afterContent` se conservan para persistencia, diagnóstico y fast path exacto; los hashes se calculan con una implementación browser-safe del core (por ejemplo `StringSHA1`, documentando el algoritmo como identificador de contenido, no seguridad). El rollback seguirá esta tabla:

| Operación | Estado actual coincide con `afterHash` | Estado actual divergió |
|---|---|---|
| `modify` | Aplicar el reverse patch/resultado `beforeContent` del archivo exacto. | Reubicar cada hunk inverso sobre el contenido actual usando contexto único; conservar hunks manuales/posteriores no solapados. Si falta o es ambiguo un hunk, conflicto y cero escritura para ese archivo. |
| `create` | Eliminar solo si el contenido sigue siendo el creado por el mensaje. | No eliminar; conflicto (incluye archivo modificado/reemplazado posteriormente). |
| `delete` | Restaurar `beforeContent` solo si la ruta sigue ausente. | Si reapareció, no sobrescribir; conflicto. |
| `rename` | Mover destino a origen solo si origen está libre y destino coincide con el after-state. | Si cambió el destino, reapareció el origen o hay ambigüedad, no mover; conflicto. Un cambio de contenido ligado al rename se trata con sus patches antes/después del movimiento. |

El motor hará **preflight de todos los archivos del change set antes de escribir**. Si hay conflictos, devolverá resultados por archivo y no ejecutará operaciones destructivas sobre los conflictivos. Los archivos independientes que pasen podrán revertirse; la UI informará claramente reverted/skipped/conflict. Para un único archivo, nunca habrá una escritura parcial. Si una excepción ocurre durante la fase de aplicación, se conservará la compensación actual con snapshots tomados justo antes del rollback para restaurar lo ya aplicado.

### Semántica del botón

El botón seguirá pudiendo truncar/editar y reenviar la conversación como acción de UI, pero el efecto de archivos se separa:

- El webview enviará `messageId`, no `userIndex`.
- Se resolverá **solo** `changeSets.get(messageId)`.
- Change set ausente o vacío = no-op del workspace, sin consultar `pendingFileDiffs()`.
- Los mensajes posteriores se conservarán en disco; el reverse patch permite conservar cambios posteriores no solapados en el mismo archivo.
- Si hay conflicto, no se truncará ni se preparará el reenvío hasta que el usuario decida; se mostrará una notificación/modal con archivos en conflicto y opciones seguras (`Cancelar` / `Revertir solo archivos sin conflicto`). No habrá opción silenciosa de sobrescritura.
- La truncación conversacional podrá seguir ocurriendo después de un rollback exitoso por compatibilidad de “Volver acá”, pero no determinará qué archivos se tocan.

### Captura exacta de cambios

- Asignar `messageId = generateUuid()` al crear cada user turn y persistirlo inmediatamente.
- Pasarlo en `IAgentRunOptions` hacia el loop; crear un builder nuevo por run/message (nunca reutilizado entre retries/failover).
- Capturar el before-state justo antes de la primera escritura de ese mensaje. Para `write_file`/`edit_file`, mover la emisión/captura al borde de la operación y registrar after-state solo después de una escritura exitosa.
- Agregar el archivo únicamente si before y after difieren efectivamente; write del mismo contenido produce change set vacío.
- Consolidar múltiples writes del mismo mensaje/path: primer before + último after, recalculando operación y patches. Casos create→delete o modify→restore-before dentro del mismo mensaje colapsan a sin cambio.
- Finalizar en `finally`, también para cancelación/error: solo quedan operaciones efectivamente completadas. Un write iniciado se espera mediante la barrera de run actual ya existente antes de rollback.
- Añadir API explícita al registro para create/modify/delete/rename. Hoy solo `write_file`/`edit_file` exponen cambios; para cumplir delete/rename se agregan tools de archivo seguras y trazables, o se instrumentan todos los productores internos que modifican workspace. `run_command` no se puede atribuir correctamente observando eventos globales sin mezclar procesos/manual edits; queda fuera de esta transacción y debe declararse fuera de alcance (ver riesgos), no fingirse cubierto.

### Persistencia y migración

- Guardar `messageId` y `changeSet` (o un mapa de change sets dentro de `IChatSession`) en `openide.chat.sessions.v1`; el shape actual ya persiste metadata JSON, pero se normalizará al cargar y se hará copia profunda al guardar/forkear.
- Preferencia: almacenar `changeSetsByMessageId` a nivel sesión para que la compactación del transcript no borre transacciones históricas. El user message conserva `messageId` como referencia estable.
- Migrar lazy los `rollbackFiles` legacy a change sets incompletos solo para lectura/diagnóstico. Como no tienen after-state ni parche, **no ejecutar restauración destructiva automática**: mostrar “checkpoint antiguo no puede revertirse de forma segura”. Eliminar por completo el fallback a snapshots globales/Git.
- Al forkear, copiar profundamente IDs y change sets heredados; los mensajes nuevos reciben IDs nuevos. Rollback en una rama opera solo sobre su sesión activa.
- Establecer límites de persistencia por sesión y validar entradas al cargar (tipo, rutas, tamaño total). No truncar silenciosamente un patch individual requerido para rollback; si supera el límite, marcarlo `unavailable` y fallar seguro.

## Archivos a tocar

| Ruta | Cambio |
|---|---|
| `vscode/src/vs/workbench/contrib/openideAgent/common/openideAgentTypes.ts` | Añadir `messageId`, `IMessageChangeSet`, `IFileChange`, patch/hunk, estados/resultados de rollback y `messageId` en `IAgentRunOptions`; retirar gradualmente `rollbackFiles` como formato activo, manteniéndolo solo para migración legacy. Extender `IFileEditEvent` a operación y before/after/original URI. |
| `vscode/src/vs/workbench/contrib/openideAgent/common/openideMessageChanges.ts` **(nuevo)** | Motor puro: hash, cálculo de forward/reverse patch, consolidación de múltiples operaciones de un mensaje y aplicación/rebase inverso con detección de hunks faltantes/ambiguos. Sin `IFileService`, testeable en unit tests. |
| `vscode/src/vs/workbench/contrib/openideAgent/browser/openideMessageChangeSetService.ts` **(nuevo)** | Lifecycle transaccional por `messageId`: begin/record/finalize/cancel; lectura de estados justo antes/después, preflight y aplicación file-by-file con compensación, create/delete/rename y resultados/conflictos. Resolver rutas solo dentro del workspace. |
| `vscode/src/vs/workbench/contrib/openideAgent/browser/openideTools.ts` | Instrumentar `write_file`/`edit_file` para registrar antes de la primera escritura y completar solo después del éxito; no emitir cambios no efectivos. Añadir operaciones explícitas delete/rename si se exponen al modelo y asegurar que todas usen el mismo tracker. |
| `vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts` | Crear/inyectar el change-set service; pasar `messageId` durante el run y retries; reemplazar `fileCheckpoint`/`rollbackFiles` por eventos de change-set finalizado o consultas por ID; exponer `rollbackMessage(messageId)` con resultados. Mantener `OpenideDiffSnapshotProvider` solo para review y eliminar el fallback Git/global del rollback de mensaje. Reconciliar review después de aplicar cada resultado. |
| `vscode/src/vs/workbench/contrib/openideAgent/browser/openideChatSessions.ts` | Persistir y normalizar `messageId` + mapa de change sets por sesión; APIs `changeSetOf`, `saveChangeSet`, `removeChangeSet`; copias profundas al persistir/forkear; migración fail-safe de `rollbackFiles`; preservar change sets al compactar transcript. |
| `vscode/src/vs/workbench/contrib/openideAgent/browser/openideChatView.ts` | Generar el ID al comenzar el turno, pasarlo al agent service y asociar el change set finalizado exactamente a ese ID. Reemplazar `rollbackToUserMessage(userIndex)` por resolución por `messageId`; no scanear mensajes posteriores ni consultar diffs globales. Manejar no-op, conflictos, cancelación y truncar conversación solo después del resultado permitido. |
| `vscode/src/vs/workbench/contrib/openideAgent/browser/openideChatHtml.ts` | Renderizar cada mensaje user con `messageId` persistido y enviar ese ID en `rollback`/`editAndResend`; mostrar feedback de no-op/conflicto sin depender de índices reconstruidos. |
| `vscode/src/vs/workbench/contrib/openideAgent/test/common/openideMessageChanges.test.ts` **(nuevo)** | Unit tests exhaustivos del cálculo/aplicación de patches, consolidación y conflictos, incluyendo mismo archivo y cambio manual no solapado/solapado. |
| `vscode/src/vs/workbench/contrib/openideAgent/test/browser/openideMessageChangeSetService.test.ts` **(nuevo)** | Integración con `InMemoryFileSystemProvider`: create/modify/delete/rename, atomicidad por archivo, errores/cancelación y no-op. |
| `vscode/src/vs/workbench/contrib/openideAgent/test/browser/openideChatSessions.test.ts` **(nuevo)** | Persistencia/reload, IDs estables, mapa aislado por sesión, fork y migración legacy fail-safe. |
| `vscode/src/vs/workbench/contrib/openideAgent/test/browser/openideChatRollback.test.ts` **(nuevo, o helper extraído de `openideChatView.ts`)** | Integración controlador UI→messageId→change set: dos mensajes, mensaje vacío, truncación solo tras éxito y ausencia total de fallback global. |
| `.github/workflows/ci-openide.yml` | Incluir los nuevos tests browser del agente en CI, porque hoy solo ejecuta `test/common/*.test.js`. |

`openideDiffSnapshot.ts` no debería cambiar su modelo a per-message: hacerlo mezclaría review acumulado con rollback. Solo se tocará si hace falta una API explícita de reconciliación tras rollback; nunca se usará como fuente de verdad transaccional.

## Validación y revisión

### Pruebas obligatorias mapeadas

1. **Mensaje sin cambios**: change set vacío/ausente; `rollbackMessage(messageId)` devuelve no-op; spy de `IFileService` confirma cero write/del/move y cero acceso a pending global.
2. **Dos mensajes, archivos distintos**: A modifica A, B modifica B; rollback B deja A exacto; rollback A deja B exacto.
3. **Dos mensajes, mismo archivo**: A y B generan hunks distintos; rollback A sobre estado A+B quita solo A y conserva B; rollback B quita solo B. Agregar variante solapada que devuelve conflicto sin escritura.
4. **Archivo creado**: solo el change set creador puede borrarlo; si fue modificado luego, conflicto y conservación.
5. **Archivo eliminado**: solo el change set eliminador lo restaura; si la ruta reapareció, conflicto sin overwrite.
6. **Cambio manual posterior**: hunk manual no solapado sobrevive al reverse patch; cambio solapado/ambiguo produce conflicto y contenido intacto.
7. **Mensaje fallido/cancelado**: un write completado antes de cancelar queda registrado; una operación que falló antes de escribir no aparece; múltiples writes consolidan solo el estado efectivamente aplicado.
8. **Reinicio del IDE**: persistir sesión, reconstruir store/service y revertir por el mismo `messageId`; validar hashes/patches y asociaciones.

Cobertura adicional imprescindible:

- Rename/move exacto y rename con destino/origen divergente.
- Write idéntico y create→delete dentro del mismo mensaje colapsan a no-op.
- Dos sesiones/forks no comparten arrays ni builders mutables.
- Failover/retry conserva el mismo `messageId` sin duplicar operaciones.
- Compactación no elimina `changeSetsByMessageId`.
- Checkpoint legacy sin after-state falla seguro y jamás llama Git ni borra archivos.
- Path fuera del workspace es rechazado antes de aplicar.
- Fallo a mitad de aplicación compensa archivos ya escritos.

### Comandos de validación

Desde `vscode/`:

1. `npm run compile-check-ts-native` para typecheck completo.
2. `npm run eslint -- src/vs/workbench/contrib/openideAgent` (o el filtro admitido por `build/eslint.ts`) para lint del área.
3. `npm run compile` para generar `out/` y detectar problemas de capas/bundling.
4. Mocha common: `./node_modules/.bin/mocha --ui tdd --timeout 5000 --exit out/vs/workbench/contrib/openideAgent/test/common/*.test.js`.
5. Tests browser específicos: `npm run test-browser-no-install -- --run src/vs/workbench/contrib/openideAgent/test/browser/openideMessageChangeSetService.test.ts --browser chromium` y equivalentes para sessions/controller; en CI se agruparán con `--runGlob` del directorio.
6. `npm run valid-layers-check` si las nuevas dependencias entre common/browser disparan restricciones de capa.
7. Diagnósticos LSP del workspace al finalizar.

### Foco de revisión adversarial

- Que no quede ninguna ruta desde rollback por mensaje hacia `pendingFileDiffs`, `revertEdit`, Git checkout/reset o snapshot global.
- Correctitud de offsets/contexto de patch con CRLF, EOF sin newline, Unicode, hunks repetidos y múltiples hunks en orden inverso.
- TOCTOU entre preflight y write: releer/verificar hash inmediatamente antes de cada operación o usar etag cuando sea posible.
- Consolidación create/modify/delete/rename y cadenas de rename.
- No pérdida de cambios manuales, posteriores o de otra sesión.
- Persistencia con límites y sin referencias mutables compartidas.
- Cancelación/failover y suscripciones `onDidEdit` sin atribución cruzada.

## Límites de commit

El cambio debe dividirse en commits atómicos revisables:

1. **`feat(agent): add per-message change set model and patch engine`**: tipos + motor puro + unit tests. No cambia todavía el botón.
2. **`feat(agent): capture and persist message change sets`**: lifecycle service, instrumentación de tools, IDs y persistencia/reload/fork + tests del servicio/store.
3. **`fix(agent): rollback only the selected message change set`**: controller/webview, conflictos, eliminación del fallback global y reconciliación de review + tests de integración.
4. **`ci(agent): run rollback integration tests`**: CI si puede separarse sin dejar tests fuera del pipeline en los commits anteriores; si la política exige verde por commit, incluir el ajuste de CI en el commit 3.

No mezclar refactors generales del chat upstream, cambios cosméticos del review editor ni migraciones de Agent Host.

## Riesgos y fuera de alcance

- **`run_command` y procesos externos**: una shell puede cambiar cualquier archivo sin pasar por `OpenideToolRegistry.onDidEdit`. Observar `IFileService.onDidRunOperation` no permite distinguir con certeza IA, usuario, extensión o proceso externo y violaría el aislamiento. Esta fase garantiza las operaciones de archivo estructuradas del agente; los comandos seguirán fuera del rollback transaccional y la UI/documentación debe decirlo explícitamente. Cubrir shell requeriría sandbox/journal del proceso o integración Agent Host/Git index dedicada, proyecto aparte.
- **Otras tools write internas** (`memory`, plan, canvas, rules, workflow) escriben artefactos propios por servicios directos y hoy no emiten file edits. Se debe inventariar cuáles se consideran “workspace edits rollbackables”; no se interceptarán superficialmente. Las que deban participar usarán la API explícita del change-set service.
- **Binarios/archivos enormes**: el modelo propuesto es textual. Detectar contenido no UTF-8 o sobre límite y marcar rollback no disponible/conflictivo; nunca truncar y luego restaurar parcialmente.
- **Rollback selectivo de un cambio antiguo solapado**: no siempre existe una inversión limpia. El requisito correcto es preservar cambios posteriores cuando el hunk puede rebasarse y reportar conflicto sin tocar el archivo cuando no.
- **Infraestructura upstream**: `ChatEditingCheckpointTimelineImpl` y `AgentHostEditingSession` no se reemplazarán ni modificarán para este bug; pertenecen a flujos distintos. Reutilizar conceptos, no acoplar stores.
- **Compatibilidad legacy**: los checkpoints viejos carecen de after-state; no pueden satisfacer preservación de cambios manuales. La migración será fail-safe, no una restauración ciega “best effort”.

## Tareas

- [x] Añadir IDs estables y los tipos JSON-serializables de change set, operación, patch, conflicto y resultado de rollback.
- [x] Implementar el motor puro de hash, diff/hunks, consolidación y aplicación de reverse patch con detección de ambigüedad/conflicto.
- [x] Crear el servicio transaccional por `messageId` con begin/record/finalize/cancel, preflight, compensación y operaciones create/modify/delete/rename.
- [x] Instrumentar todas las tools estructuradas de archivo para capturar before justo antes de escribir y after solo tras éxito, omitiendo cambios no efectivos.
- [x] Persistir change sets a nivel sesión, normalizar reload, copiar profundamente en forks y conservarlos durante compactación; migrar legacy en modo fail-safe.
- [x] Pasar `messageId` desde `OpenideChatView` por `runMessages` y retries/failover, y asociar únicamente el change set finalizado de ese mensaje.
- [x] Cambiar webview/controller para solicitar rollback por `messageId`, eliminar el scan desde el corte y eliminar todo fallback a snapshots/Git globales.
- [x] Implementar UX de no-op y conflictos; truncar/reenviar solo después de una resolución segura y nunca sobrescribir silenciosamente.
- [x] Reconciliar la bandeja/review acumulado con los archivos realmente revertidos sin convertirla en fuente del rollback.
- [x] Añadir unit tests del motor para hunks, mismo archivo, cambios manuales, no-op y conflictos.
- [x] Añadir tests de integración del servicio para create/delete/rename, cancelación/fallo, atomicidad y paths seguros.
- [x] Añadir tests de persistencia/reinicio/fork/compactación y del flujo UI por `messageId`, cubriendo las ocho pruebas obligatorias.
- [x] Actualizar CI para ejecutar los nuevos tests browser del agente.
- [x] Ejecutar typecheck, lint, compile, tests common/browser y validación de capas; corregir diagnósticos.
- [x] Ejecutar revisión adversarial enfocada en operaciones globales residuales, TOCTOU, patches ambiguos, persistencia y pérdida de cambios ajenos; separar los commits atómicos definidos.
