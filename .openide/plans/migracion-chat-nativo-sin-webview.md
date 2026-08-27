# Plan de arquitectura y migración — Chat de OpenIDE: de webview a DOM del workbench

> Base verificada contra el árbol real: `/home/nihuel/projects/personal/openide-legacy/vscode`.
> `openideChatHtml.ts` = 6448 líneas, `openideChatView.ts` = 2198, `openideSurfaceCss.ts` = 101, `common/openideAgentTypes.ts` = 429.

---

## 0. Correcciones a los relevamientos (antes de arrastrar deuda)

Cinco cosas de los relevamientos que verifiqué y **están mal**. Si no se corrigen ahora, el diseño nuevo hereda el error.

1. **`chatContentParts.ts` NO es copiable "sin arrastrar nada".** El relevamiento dice "sin dependencias de Copilot: se puede copiar el archivo entero (90 líneas)". Falso: son 91 líneas e importa `ChatTreeItem`/`IChatCodeBlockInfo` de `chat/browser/chat.ts`, `IChatRendererContent`/`IChatRequestViewModel`/`IChatResponseViewModel` de `chat/common/model/chatViewModel.ts`, y `EditorPool`/`DiffEditorPool` de `chatContentCodePools.ts`. Copiarlo significa **re-tipar la interfaz sobre nuestros propios tipos**, no un `cp`. Sigue valiendo la pena — pero el trabajo es reescribir 40 líneas de contrato, no copiar.

2. **`ChatCollapsibleContentPart` NO conviene heredarlo.** El relevamiento dice "este sí conviene heredarlo directamente en vez de copiarlo". Son 195 líneas y su `hasSameContent(other: IChatRendererContent, …, element: ChatTreeItem)` obliga a que nuestros items **sean** `ChatTreeItem` y nuestro contenido **sea** `IChatRendererContent`, o sea a adoptar el `ChatViewModel` de VS Code entero. Además importa `IChatMarkdownAnchorService` y `AccessibilityWorkbenchSettingId`. Va a la lista de **copiar-y-adaptar**, no de heredar.

3. **`media/openideChat.css` ya existe** — 650 líneas, importado en `openideAgent.contribution.ts:7`. El relevamiento lo propone como archivo nuevo. Ya está ahí y **contiene el hack de layout más importante del dock**: `.part.auxiliarybar > .composite.title { display:none }` como red de seguridad del `hasTitle: false` que se parcheó en `src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts:108-110`. Ese parche **no se toca** en la migración.

4. **El radio de isla no son "dos radios distintos", son tres — y el correcto es 2px.** `media/openideChat.css:24-29` fuerza `--vscode-cornerRadius-{xSmall..xLarge}: 2px` con el comentario explícito "lenguaje de diseño CUADRADO de OpenIDE". Contra eso, `openideSurfaceCss.ts:53` define `--oi-radius: 10px` y `openideChatHtml.ts:60` usa `border-radius: 12px`. El relevamiento propone "tokenizar el radio de isla" sin decidir. **Decisión: el chat nativo es cuadrado (2px).** El 10/12px es deuda del webview, no lenguaje del producto.

5. **El conflicto de `isDefault` en el auxiliary bar ya existe hoy y no rompe nada.** El relevamiento lo pone como "riesgo a resolver antes de empezar". Verificado: `openideAgent.contribution.ts:174-182` registra con `{ isDefault: true }`, `order: 0`, `hideIfEmpty: false`; `chat/browser/chatParticipant.contribution.ts:39-48` registra con `{ isDefault: true, doNotRegisterOpenCommand: true }`, `order: 1`, `hideIfEmpty: true` y un `when` que depende de `ChatContextKeys.Setup.*`. Conviven desde hace commits. **No es prerequisito de nada.** Lo que sí importa: importar widgets de `contrib/chat` **no registra contenedores** — los registros están en los `*.contribution.ts`, que ya se importan igual desde `workbench.common.main.ts:225-226`.

Además, una precisión de cita: el test que fija HTML por regex está en `test/common/openideTerminalInteractive.test.ts:101-112` (el relevamiento dice 105-111).

---

## 1. Decisiones de fondo

### 1.1 Dónde vive: `vs/workbench/contrib/openideAgent/`, en subcarpetas `chat/`

**Decisión:** el chat nativo vive en `src/vs/workbench/contrib/openideAgent/browser/chat/` y `src/vs/workbench/contrib/openideAgent/common/chat/`. **No** en `vs/sessions`, **no** en un contrib nuevo.

**Por qué no `vs/sessions`:** la regla es unidireccional y está enforced en `eslint.config.js` (~1780-2060): `vs/sessions` puede importar `vs/workbench`, nunca al revés. El chat tiene que funcionar en la ventana principal del IDE, que es `vs/workbench`. Ponerlo en sessions lo dejaría inalcanzable. Además el precedente del árbol es claro: `vs/sessions/contrib/chat` **no implementa ningún chat**, solo re-registra el del workbench.

**Por qué no un contrib nuevo (`contrib/openideChat/`):** técnicamente funciona — `openideSettings/browser/openideSurfaceStyle.ts` ya importa de `openideAgent/browser/openideSurfaceCss.js`, así que el cruce entre contribs de OpenIDE está aceptado en este fork. Pero el chat depende de **todo** lo que ya vive en `openideAgent`: `openideAgentService.ts` (4181 líneas), `openideChatSessions.ts` (436), `openideApproval.ts`, `openideMessageChangeSetService.ts`, `openideEditReview.ts`, `openideSubagentOrchestrationService.ts`, `openideModelCatalog.ts`. Un contrib nuevo sería una carpeta que importa 15 símbolos de su vecino y no aporta ningún aislamiento real, y además obliga a agregar una entrada a `workbench.common.main.ts` y una superficie de layering nueva. Subcarpetas dentro de `openideAgent` dan la misma claridad de árbol a costo cero.

### 1.2 Qué se hereda del chat de VS Code: **nada por herencia de clase**

**Decisión:** cero `extends` sobre `contrib/chat`. Tres niveles de reuso, en orden de preferencia:

| Nivel | Qué | Por qué |
|---|---|---|
| **Import directo** | Todo lo que es `vs/base` y `vs/platform` | Estable entre versiones, cero acoplamiento a Copilot. `WorkbenchObjectTree` (`platform/list/browser/listService.ts:859`), `CachedListVirtualDelegate` (`base/browser/ui/list/list.ts:146`), `IMarkdownRendererService`, `IContextViewService`, `IHoverService`, `IActionWidgetService`, `MenuWorkbenchToolBar`, `defaultStyles.ts` |
| **Copiar y adaptar** | Archivos hoja chicos de `contrib/chat`, re-tipados sobre nuestros tipos | `chatContentParts.ts` (91), `chatCollections.ts` (254, este sí es puro: solo importa `IDisposable`), `ChatListDelegate` (`chatListRenderer.ts:3347`), `chatContentMarkdownRenderer.ts` (136), `chatCollapsibleContentPart.ts` (195) |
| **Leer como referencia, escribir propio** | `chatListWidget.ts` (868), `chatWidget.ts` (2959), `chatListRenderer.ts` (3393), `chatInputPart.ts` (3958) | 11.178 líneas y 27/26/14 servicios inyectados, atados a `IChatModel`+`ChatViewModel`+`IChatEntitlementService`. Heredar = arrastrar el setup de Copilot y romper en cada rebase |

**Por qué no `IChatService` / `IChatAgentService.registerDynamicAgent()` (la "tercera vía" del relevamiento):** es la opción de menos código propio, pero el costo es tirar `OpenideChatSessions` (436 líneas, con persistencia real de conversaciones del usuario en `IStorageService`) y migrar a `chatSessionStore`. Eso **invalida las conversaciones guardadas** y ata la persistencia del producto al ritmo de cambio de upstream. Rechazada. Lo que **sí** se toma prestado es el vocabulario: nuestro `IOpenideChatContent` se modela con los mismos `kind` que `IChatProgress`, para dejar la puerta abierta sin pagar el peaje hoy.

### 1.3 Qué se escribe propio, y por qué

- **El transcript.** Un `OpenideChatListWidget` sobre `WorkbenchObjectTree`, copiando la configuración exacta de `chatListWidget.ts:363-400` (`supportDynamicHeights: true`, `horizontalScrolling: false`, `setRowLineHeight: false`, `overrideStyles` neutralizando selección/hover) y el patrón de `_updateElementHeight` (`chatListWidget.ts:655-658`). Escribimos ~330 líneas en vez de importar 868 que hablan `ChatTreeItem`.
- **El reducer de eventos.** `AgentLoopEvent` (`common/openideAgentTypes.ts:322-382`, 30 variantes) es **nuestro** contrato y no va a desaparecer. La traducción evento → items renderizables va a `common/`, pura y testeable. Hoy vive dentro de un `switch` de ~60 casos en un string de JS.
- **Los content parts de dominio.** Plan, canvas, delegación, compactación, sugerencia de modo, "Actualizando el plan", Pick & Polish: no tienen contraparte nativa. Se escriben.
- **El composer.** `chatInputPart.ts` son 3958 líneas. Escribimos ~380 + módulos satélite.

### 1.4 Textarea vs `CodeEditorWidget` en el composer

**Decisión: `CodeEditorWidget` con `getSimpleCodeEditorWidgetOptions()`**, no `InputBox`. No por paridad estética: porque los dos autocompletes (`@archivos` y `/comandos`, hoy ~275 líneas de menú a mano en `openideChatHtml.ts:5790-6026`) se resuelven registrando un `CompletionItemProvider` sobre el modelo del editor, y ahí el foco, el teclado, el filtrado y la accesibilidad ya están hechos. Con `InputBox` habría que reescribir el menú igual que hoy. El costo (scoped instantiation service + auto-grow midiendo `contentHeight`) es real pero acotado y es exactamente lo que hace `chatInputPart.ts:2353-2364`.

**A verificar antes de la Etapa 5:** que `getSimpleCodeEditorWidgetOptions` esté exportado en `vs/workbench/contrib/codeEditor/browser/simpleEditorOptions.ts` en esta versión del fork (1.121.1) y que el paste de imágenes funcione sin `chatPasteProviders.ts`.

---

## 2. Estructura de archivos propuesta

Regla dura: **ningún archivo > 400 líneas**. Presupuesto entre paréntesis.

### 2.1 `common/chat/` — puro, sin DOM, testeable

```
src/vs/workbench/contrib/openideAgent/common/chat/
  openideChatContent.ts          (190) Union IOpenideChatContent: los ~22 kinds renderables
                                       (markdown, thinking, tool, explore, edit, terminal,
                                       confirmation, ask, todos, plan, subagent, diagram,
                                       notice, compaction, canvas, modeSuggestion, screenshot…)
                                       + type guards. Modelado sobre el vocabulario de IChatProgress.
  openideChatItem.ts             (150) IOpenideChatRequestItem / IOpenideChatResponseItem:
                                       id estable, dataId incremental para el diffIdentityProvider,
                                       currentRenderedHeight, isComplete.
  openideChatReducer.ts          (360) applyAgentEvent(state, ev) → state'. El corazón:
                                       traduce AgentLoopEvent a IOpenideChatContent[]. Puro.
  openideChatReducerFilters.ts   (120) Los tres filtros del passthrough hoy escondidos en
                                       openideChatView.ts:1411-1443: unwrap de subagentEvent,
                                       fileCheckpoint/messageChangeSet host-only, done{mode-switch}.
  openideChatExploreGroup.ts     (130) Agrupa read/search/list en un bloque "Exploring" con
                                       contador. Hoy openideChatHtml.ts:1629-1676,2916-2943.
  openideChatToolMeta.ts         (240) Catálogo de las 35 tools: icono, verbo, clave de argumento.
                                       Hoy openideChatHtml.ts:312-369, inalcanzable desde tests.
  openideChatSendPayload.ts      (170) Shape de 'send' + sanitizadores (images, capabilities,
                                       references). Hoy disperso en openideChatView.ts:1252-1514.
  openideChatQueueModel.ts       (150) Cola de mensajes por conversación (máx 20), sin storage.
  openideChatTranscript.ts       (180) IChatMessage[] persistido → IOpenideChatItem[] (restore).
                                       Reemplaza restoreThread (openideChatHtml.ts:5602-5676).
```
**Subtotal common: ~1690 líneas.**

### 2.2 `browser/chat/` — DOM

```
src/vs/workbench/contrib/openideAgent/browser/chat/
  openideChatWidget.ts               (380) Widget raíz: lista + trays + composer, layout(h,w),
                                           altura del composer como IObservable leída con autorun
                                           (patrón chatWidget.ts:1889-1912 → evita el loop de layout).
  openideChatListWidget.ts           (330) WorkbenchObjectTree + setChildren con diffIdentityProvider
                                           + scroll lock + botón "ir al final" + updateElementHeight.
  openideChatListDelegate.ts          (90) CachedListVirtualDelegate: estimateHeight + templateId.
  openideChatContentPart.ts          (120) IOpenideChatContentPart + IOpenideChatPartContext.
                                           (chatContentParts.ts re-tipado sobre lo nuestro)
  openideChatCollapsiblePart.ts      (200) Base abstracta colapsable. (chatCollapsibleContentPart
                                           re-tipado; header + chevron + body lazy)
  openideChatPartFactory.ts          (170) Dispatch kind → parte. Único punto de crecimiento.
  openideChatRequestRenderer.ts      (300) Fila de usuario: clamp 3 líneas, chips, imágenes,
                                           "Volver acá", editar-y-reenviar.
  openideChatResponseRenderer.ts     (340) Fila de respuesta: diffea content parts, propaga
                                           onDidChangeItemHeight, recicla templates.
  openideChatPools.ts                (260) ResourcePool/KeyedResourcePool (copia de chatCollections.ts,
                                           que sí es puro) + EditorPool propio.
  openideChatMarkdown.ts             (200) Wrapper de IMarkdownRendererService con allowlist
                                           endurecida y allowedLinkSchemes con los nuestros.
                                           (chatContentMarkdownRenderer.ts adaptado)
  openideChatViewPane.ts             (280) ViewPane: renderBody → widget, layoutBody, statusbar,
                                           onDidChangeBodyVisibility. Sustituye openideChatView.ts.
  openideChatController.ts           (380) Puente widget ↔ IOpenideAgentService: send, abort,
                                           rollback, editAndResend, compact. Sin postMessage.
  openideChatSessionBinding.ts       (250) OpenideChatSessions ↔ viewmodel: tabs, switch, fork,
                                           archive, delete, subagent mirror sessions.
  openideChatContextUsagePanel.ts    (250) Barra segmentada + desglose (computeContextBreakdown).
```

```
  parts/
    openideChatMarkdownPart.ts       (270) Markdown en streaming + code blocks vía EditorPool.
    openideChatThinkingPart.ts       (200) Razonamiento colapsable + "Thought for Ns".
    openideChatToolPart.ts           (300) Fila de tool genérica: verbo, detalle, estado, output.
    openideChatExplorePart.ts        (180) Grupo "Exploring".
    openideChatEditPart.ts           (220) Card de edición: nombre + ±N + estado. CONTROL REMOTO
                                           de OpenideEditReview, NO un diff viewer.
    openideChatTerminalPart.ts       (340) Terminal embebida: output, awaiting-input, stdin, menú ⋯.
    openideChatConfirmationPart.ts   (280) Aprobación inline + Ctrl+Enter/Esc + menú de scope.
    openideChatDecisionLine.ts        (90) Línea plana de rechazo (concedido NO deja rastro —
                                           asimetría fijada en el commit 4146dda).
    openideChatAskPart.ts            (340) Stepper de ask_user: 1..5 preguntas, dots, texto libre.
    openideChatTodoPart.ts           (180) Snapshot de to-dos.
    openideChatPlanPart.ts           (300) Card del plan: draft con skeleton + definitiva.
    openideChatPlanUpdateLine.ts      (80) "Actualizando el plan" (.openide/plans/*.md).
    openideChatSubagentPart.ts       (320) Cards de subagentes + timeline + resumen.
    openideChatDiagramPart.ts        (200) Host del SVG; delega el render al módulo compartido.
    openideChatNoticePart.ts         (200) retry con countdown / info / error+CTA / continuar.
    openideChatCompactionPart.ts     (120) Card de compactación.
    openideChatCanvasPart.ts          (90) Card de canvas.
    openideChatModeSuggestionPart.ts (200) Triaje de modo + barra de auto-aceptado.
    openideChatScreenshotPart.ts      (90) Card de screenshot.
```

```
  input/
    openideChatInputPart.ts          (380) CodeEditorWidget simple, auto-grow a 180px,
                                           MenuWorkbenchToolBar, enviar/stop.
    openideChatAttachments.ts        (300) Chips: imágenes, @archivos, links pegados, capacidades.
    openideChatFileCompletions.ts    (220) CompletionItemProvider de @ (searchWorkspaceFiles +
                                           getIconClasses directo, sin round-trip).
    openideChatCommandCompletions.ts (240) CompletionItemProvider de / (skills/commands/mcp/tools).
    openideChatModelPicker.ts        (380) Picker: búsqueda, favoritos, recientes, secciones.
    openideChatModelPickerDnd.ts     (200) Reordenar proveedores y favoritos (DragAndDropObserver).
    openideChatModelDetail.ts        (180) Panel de detalle diferido + política de timers.
    openideChatModePicker.ts         (180) Modo + submenú de permisos.
    openideChatEffortPicker.ts       (120) Esfuerzo de razonamiento (se oculta sin reasoning_options).
    openideChatQueueWidget.ts        (220) Cola: editar / enviar ahora / integrar al plan / quitar.
    openideChatVoice.ts              (260) Dictado: mic en el host, estados, modal de onboarding.
```

```
  dock/
    openideChatTrayHost.ts           (200) Framework de bandejas por prioridad.
    openideChatFilesTray.ts          (250) Archivos modificados: ±N, accept/reject, Keep/Undo All.
    openideChatTerminalsTray.ts      (150) Terminales background.
    openideChatSubagentsTray.ts      (150) "N especialistas trabajando".
  header/
    openideChatTabs.ts               (280) Tabs de conversaciones (marquee, cerrar, click medio).
    openideChatHistoryPicker.ts      (180) Historial agrupado (IQuickInputService, no popover propio).
    openideChatKebabMenu.ts          (100) Fork / copiar transcript / Project Map (MenuId).
  media/
    openideChatNative.css            (380) Layout de filas, composer, trays. Tokens --oi-*, radio 2px.
    openideChatParts.css             (320) Estilos de los content parts.
```

**Subtotal browser: ~11.100 líneas en 47 archivos** (media ~236, máximo 380).

### 2.3 Módulo compartido de diagramas (sale del chat)

```
src/vs/workbench/contrib/openideAgent/browser/diagrams/
  openideDiagramGraphSvg.ts    (280) Familia graph: nodos + aristas desde el layout del engine.
  openideDiagramChartSvg.ts    (200) Dispatch de las 7 familias no-grafo.
  openideDiagramPieGantt.ts    (200) pie + gantt.
  openideDiagramSeqTimeline.ts (200) sequence + timeline.
  openideDiagramMisc.ts        (200) journey + quadrant + git.
  openideDiagramPalette.ts      (90) Rampa de color derivada del foreground, sobre --oi-*.
```
Consumidores: el chat nativo, `openidePlanHtml.ts` (708) y `openideDiagramEditor.ts` (226). El parseo y el layout **ya** viven en `common/diagrams/openideDiagramEngine.ts` (656 líneas): esto es solo el render, hoy duplicado entre `openideChatHtml.ts:1885-2248` y `openidePlanHtml.ts`.

### 2.4 Tests

```
src/vs/workbench/contrib/openideAgent/test/common/
  openideChatReducer.test.ts        Los 30 kinds de AgentLoopEvent → items.
  openideChatReducerFilters.test.ts Los tres filtros del passthrough. ← el que hoy no existe.
  openideChatExploreGroup.test.ts   Agrupación y contadores.
  openideChatToolMeta.test.ts       Cobertura del catálogo de 35 tools.
  openideChatTranscript.test.ts     restore desde IChatMessage[].
```

### 2.5 Balance

| | Hoy | Después |
|---|---|---|
| `openideChatHtml.ts` | 6448 | **0** (borrado) |
| `openideChatView.ts` | 2198 | ~280 (`openideChatViewPane.ts`) + 380 controller + 250 binding |
| Chat nativo nuevo | — | ~12.800 en 52 archivos |
| Duplicación de diagramas con `openidePlanHtml.ts` | sí | no (~380 líneas menos en el plan viewer) |

Neto: **+2.500 líneas aprox**, en archivos de ≤380 líneas, tipados, testeables e importables — contra 8646 en dos archivos, uno de los cuales es un string de JS que **no puede usar template literals ni `${}`** (restricción documentada en `openideChatHtml.ts:4-7`) y con las regex doble-escapadas.

---

## 3. Lógica compartida

### 3.1 Se importa tal cual de VS Code (sin copiar)

| Símbolo | Ruta verificada | Para qué |
|---|---|---|
| `WorkbenchObjectTree` | `platform/list/browser/listService.ts:859` | El transcript |
| `CachedListVirtualDelegate` | `base/browser/ui/list/list.ts:146` | Alturas dinámicas sin saltos |
| `IMarkdownRendererService` | `platform/markdown/browser/markdownRenderer.ts` | Cuerpo de las respuestas |
| `IContextViewService` / `IContextMenuService` | `platform/contextview/browser/contextView.ts` | Todos los popovers |
| `IHoverService` | `platform/hover/browser/hover.ts` | Todos los tooltips |
| `IActionWidgetService` | `platform/actionWidget/browser/actionWidget.ts` | Pickers con filas ricas |
| `MenuWorkbenchToolBar` | `platform/actions/browser/toolbar.ts` | Toolbar del composer |
| `DragAndDropObserver` | `base/browser/dom.ts` | Reorder de favoritos/proveedores |
| `default*Styles` | `platform/theme/browser/defaultStyles.ts` | Obligatorio en toda primitiva base |
| `aria.status` / `aria.alert` | `base/browser/ui/aria/aria.ts` | Anunciar streaming (hoy no existe) |
| `CodeEditorWidget` + `getSimpleCodeEditorWidgetOptions` | `editor/browser/widget/codeEditor/codeEditorWidget.ts`, `contrib/codeEditor/browser/simpleEditorOptions.ts` | Composer — **a verificar el export en 1.121.1** |
| `IQuickInputService` | `platform/quickinput/common/quickInput.ts` | Historial de conversaciones |

### 3.2 Se copia y se adapta de `contrib/chat`

| Origen | Líneas | Destino | Qué hay que cambiar |
|---|---|---|---|
| `widget/chatContentParts/chatContentParts.ts` | 91 | `chat/openideChatContentPart.ts` | Re-tipar `ChatTreeItem`→`IOpenideChatItem`, `IChatRendererContent`→`IOpenideChatContent`, sacar `InlineTextModelCollection` |
| `widget/chatContentParts/chatCollections.ts` | 254 | `chat/openideChatPools.ts` | Nada (solo importa `IDisposable`) — el único copiable literal |
| `widget/chatListRenderer.ts:3347` (`ChatListDelegate`) | ~20 | `chat/openideChatListDelegate.ts` | Tipo del elemento |
| `widget/chatContentMarkdownRenderer.ts` | 136 | `chat/openideChatMarkdown.ts` | `allowedLinkSchemes` + los nuestros |
| `widget/chatContentParts/chatCollapsibleContentPart.ts` | 195 | `chat/openideChatCollapsiblePart.ts` | Sacar `IChatMarkdownAnchorService`; re-tipar |
| `widget/chatListWidget.ts:363-400,544-570,655-658` | ~80 | `chat/openideChatListWidget.ts` | Config de la tree + `diffIdentityProvider` + `_updateElementHeight` |

**El conocimiento no obvio a replicar sí o sí**, en orden de importancia:
1. `diffIdentityProvider` (`chatListWidget.ts:544-570`): concatena dataId + contadores para forzar re-render durante el streaming. Si se copia mal, **el streaming no repinta**.
2. `hasSameContent(other, followingContent, element)`: el `followingContent` existe porque las partes de progreso se colapsan cuando llega contenido posterior. Sin él, las filas de "Planning next moves" se quedan pegadas.
3. `supportDynamicHeights: true` es **incompatible** con `horizontalScrolling: true` (`base/browser/ui/list/listView.ts` tira error). Consecuencia dura: **los code blocks y las tablas anchas scrollean en su propio contenedor**, nunca la lista.
4. La altura del composer como `IObservable` leída con `autorun` (`chatWidget.ts:1889-1912`): evita el loop de layout entre input y ViewPane. Ese comentario en upstream documenta un bug real.

### 3.3 Se reutiliza de lo que OpenIDE ya tiene

| Qué | Ruta | Cómo se usa en el chat nativo |
|---|---|---|
| Tokens `--oi-*` | `browser/openideSurfaceCss.ts` (101) | Vía `applyOpenideSurfaceCss()`. **Mover** `openideSettings/browser/openideSurfaceStyle.ts` a `openideAgent/browser/` — hoy la dependencia va al revés del nombre |
| Chrome del dock | `browser/media/openideChat.css` (650) | **Se queda tal cual.** Contiene el `hasTitle:false` de respaldo y la normalización a radio 2px |
| Provider icons | `browser/openideProviderIcons.ts` (130) | `applyProviderIcon()` rama nativa. `buildProviderIconData`/`serializeProviderIconData` se **borran** al morir el webview |
| Marca de proveedor | `common/openideProviderBranding.ts` | Nombres e iniciales sin tocar DOM |
| Diagramas | `common/diagrams/openideDiagramEngine.ts` (656) | Parseo y layout ya resueltos: solo migra el render |
| Semáforo de cuota | `common/openideUsage.ts` | `usageBand` + `formatResetCountdown` |
| Desglose de contexto | `common/openideTokens.ts` | `computeContextBreakdown` → barra segmentada |
| Modelos | `browser/openideModelCatalog.ts`, `common/openideModelDisplay.ts` | Picker y ventana de contexto |
| Errores | `common/openideErrorClassifier.ts` | 5 kinds → 5 CTAs distintos |
| Sesiones | `browser/openideChatSessions.ts` (436) | **No se toca.** Es la persistencia real del usuario |
| Aprobaciones | `browser/openideApproval.ts` | El chat nuevo solo implementa `ApprovalPrompt` |
| Change sets | `browser/openideMessageChangeSetService.ts`, `common/openideMessageChanges.ts` | Fuente del ±N y del rollback |
| Review de ediciones | `browser/openideEditReview.ts` | La card del chat es un **control remoto** vía `IEditReviewHost` |
| Glifo de thinking | `common/openideGlyphs.ts` | `OPENIDE_GLYPH_THINKING` |
| Popover nativo de referencia | `browser/openideUsagePopover.ts` (336) | El patrón ya validado de `IContextViewService` en este contrib |

**No** se reutiliza `OpenideSectionRenderer` (`openideSettings/browser/openideSettingsSectionBuilder.ts`, 426) para el transcript: su `.openide-settings-row` es un grid de dos columnas `minmax(260px,1fr)/minmax(210px,320px)` con `min-height: 74px` y `gap: 26px` — calibrado a la columna de 880px de Settings. En un dock de 280-450px se rompe. Sí se puede usar para la **página de configuración** del chat, si aparece.

### 3.4 Primitivas nuevas que hay que crear

Estas no existen ni en `--oi-*` ni en el chat nativo. Van a `openideSurfaceCss.ts` (las compartidas con el plan viewer) o a `media/openideChatParts.css` (las exclusivas):

| Primitiva | Dónde | Por qué no existe |
|---|---|---|
| `.oi-turn` (+ `.user`/`.assistant`), `.oi-turn-body`, `.oi-turn-actions` | surfaceCss | No hay ninguna primitiva de turno. Regla: fondo solo en el usuario, el asistente sin caja |
| `--oi-diff-add` / `--oi-diff-del` (+ `-bg`), `.oi-diff-file` | surfaceCss | Cero tokens de diff. Hoy el diff está pintado **dos veces distinto** dentro del mismo archivo: `.ediff-*` y `.dock-diff-*` |
| `.oi-part` (fila densa: ~28px, una columna, sin gap) | chatParts.css | El `row()` del builder mide 74px |
| `.oi-chip` (+ `.removable`) | surfaceCss | Adjuntos, capacidades, links y menciones repiten cuatro variantes |
| `.oi-skeleton`, `.oi-streaming` (caret), regla de `codicon-modifier-spin` | surfaceCss | Los tokens no tienen **nada** de "en progreso"; ni el spin está ahí |
| `--oi-motion-fast` / `--oi-motion-slow` | surfaceCss | No hay escala de transición |
| `.oi-meter` con segmentos + leyenda | surfaceCss | `progress()` del builder es una sola pista y un color |
| `.oi-callout.action` (con acción primaria) | surfaceCss | `auth` y `billing` de `classifyProviderError` no son errores rojos: son "hacé esto" |
| Escala de spacing y tipografía | surfaceCss | Hoy 10/12/13px y 11/11.5/12/12.5/13/17px hardcodeados en cada primitiva |

**Unificación previa obligatoria (30 minutos, deuda que si no se paga se duplica):** hay **tres vocabularios para el mismo semáforo** — `usageBand` devuelve `green|amber|red` (`common/openideUsage.ts`), `ISectionStatus.tone` es `ok|warn|error|neutral` y `OpenideSectionRenderer.progress` usa `ok|warn|critical`. El chat nativo no puede inventar un cuarto.

---

## 4. Etapas de migración

**Mecanismo de convivencia (una sola palanca, todas las etapas):** un setting `openide.chat.renderer: 'webview' | 'native'` (default `'webview'`). El ViewPane elige en `renderBody()` entre montar el overlay webview de hoy o construir `OpenideChatWidget`. **Nunca los dos a la vez** — el overlay del webview tapa cualquier DOM del pane, así que no hay migración "por pedazos dentro de la misma vista". Cambiar el setting exige recargar la ventana (aceptable durante el desarrollo; se documenta en la descripción del setting).

`openideChatHtml.ts` **no se toca en ninguna etapa salvo la 0 y la 9**. Eso mantiene verdes los cuatro tests que lo importan (`test/common/openideTerminalInteractive.test.ts:101-112`, `test/browser/openideChatModeTransition.test.ts:5`, `test/browser/openideChatRollback.test.ts:5`, `test/common/openideAgentCommon.test.ts:27`).

---

### Etapa 0 — Limpieza previa (sin cambio funcional)

**Qué:** borrar el código muerto confirmado y arreglar los tres bugs menores, para no portarlos.
- CSS sin uso en `openideChatHtml.ts`: `.part.action-card`/`.part-kind`/`.part-badge` (317-334), `.explore-header` (310-311), `.queue-row`/`.queue-label`/`.queue-actions` (242-248), el panel viejo de to-dos (1022-1037, salvo `.tray-spacer`), `.ediff-gap` (415-418), `.term-shell` (437), `.hl-fn` (240), `.abtn.detail` (1122), `.dock-link` (911-912, 965-968), `.menu-section.provider-section` (1179-1180). ~60 líneas.
- `OVERFLOW_FADE_SELECTOR` (1728-1735): sacar `.queue-label`, `.tray-current`, `.approval-summary` — tres selectores de clases que ya no existen en el DOM.
- Bugs: `finalizeExploreLine` (2931-2943) solo enriquece `read_file`; `onSubagentDone` (3748) quita `shimmer` de `.sub-title` cuando el shimmer va en `.sub-status`; `addTermCard` (2952-2963) tiene una rama inalcanzable.

**Archivos:** `browser/openideChatHtml.ts`.
**Convivencia:** n/a.
**Terminada cuando:** build limpio, los 4 tests que importan el HTML siguen verdes, y el chat se ve idéntico.

---

### Etapa 1 — Cabeza de playa: transcript nativo, solo texto (LA MÁS CHICA)

**Qué se migra:** el mínimo que prueba las cuatro cosas que pueden matar el enfoque — lista virtualizada con alturas dinámicas, streaming sin saltos de scroll, layout del composer sin loop, y tema heredado sin puentes.
- Burbuja de usuario (texto plano).
- Respuesta del asistente: **solo** `{type:'text'}` renderizado como markdown en streaming.
- Composer: `InputBox` con `flexibleHeight` (todavía **no** el `CodeEditorWidget`), botón enviar/stop.
- Todo el resto de los `AgentLoopEvent` cae a una fila genérica de una línea (`toolStart` → "· nombre_de_tool") o se ignora.

**Archivos que toca (nuevos):** `common/chat/openideChatContent.ts`, `openideChatItem.ts`; `browser/chat/openideChatWidget.ts`, `openideChatListWidget.ts`, `openideChatListDelegate.ts`, `openideChatContentPart.ts`, `openideChatMarkdown.ts`, `openideChatPools.ts`, `parts/openideChatMarkdownPart.ts`, `openideChatController.ts`, `media/openideChatNative.css`.
**Modificados:** `browser/openideChatView.ts` (rama del setting en `renderBody`/`layoutBody`), `browser/openideAgent.contribution.ts` (registrar el setting), y **mover** `openideSettings/browser/openideSurfaceStyle.ts` → `openideAgent/browser/openideSurfaceStyle.ts` (ajustar el import en `openideSettingsEditor.ts:32`).

**Convivencia:** default `'webview'`. Cero riesgo para el usuario.

**Terminada cuando, con el flag en `'native'`:**
1. Se manda un mensaje sin tools y la respuesta llega en streaming palabra a palabra sin que el scrollbar salte.
2. Con el scroll abajo, sigue el fondo; al scrollear arriba se desengancha y aparece el botón de ir al final.
3. Redimensionar el dock de 280px a 600px re-layoutea sin loop y sin logs de "layout thrash".
4. Cambiar de tema claro/oscuro repinta sin ninguna inyección de CSS (prueba de que `iconThemeCss`/`tokenColorsCss` son innecesarios).
5. Una conversación de 200 mensajes scrollea a 60fps (prueba de la virtualización).

Si algo de esto no se cumple, **el enfoque se replantea acá**, con ~1.500 líneas escritas, no con 12.000.

---

### Etapa 2 — Reducer puro y testeado

**Qué:** sacar la traducción `AgentLoopEvent` → contenido renderizable del `switch` de ~60 casos del webview (`openideChatHtml.ts:6264-6440`) y de los filtros escondidos en `openideChatView.ts:1411-1443`, a `common/chat/`, con tests.

**Archivos:** nuevos `common/chat/openideChatReducer.ts`, `openideChatReducerFilters.ts`, `openideChatExploreGroup.ts`, `openideChatToolMeta.ts`, `openideChatTranscript.ts` + los 5 tests. El widget nativo pasa a consumir el reducer.

**Convivencia:** el webview sigue con su propio switch. Durante esta etapa la lógica está **duplicada a propósito** — es el precio de que la IDE siga andando.

**Terminada cuando:** los tests cubren los 30 kinds de `common/openideAgentTypes.ts:322-382` y, específicamente, los cuatro comportamientos que hoy **no tienen ningún test**: el unwrap recursivo de `subagentEvent` (`openideChatView.ts:1412-1415`), `fileCheckpoint` que no cruza (1416-1418), `messageChangeSet` que se guarda y no cruza (1419-1422), y `done{reason:'mode-switch'}` que se traga (1426-1443).

---

### Etapa 3 — Tools, thinking y exploración

**Qué:** las tres partes que aparecen en el 90% de los turnos.
**Archivos:** `parts/openideChatToolPart.ts`, `openideChatThinkingPart.ts`, `openideChatExplorePart.ts`, `chat/openideChatCollapsiblePart.ts`, `openideChatPartFactory.ts`.
**Convivencia:** igual.
**Terminada cuando:** un turno con `read_file` + `grep` + `edit_file` + razonamiento se ve completo en nativo; expandir/colapsar una tool no re-renderiza el resto de la fila (verificable con `hasSameContent` devolviendo `true`) y no pierde el estado abierto al llegar el siguiente token.

---

### Etapa 4 — Los tres protocolos bloqueantes

**Qué:** `approvalRequest`↔`approvalResponse`, `ask`↔`askResponse`, `suggestMode`↔`modeSuggestionResponse`. **Son los únicos tres que sobreviven como protocolo request/response con id**, porque el servicio queda literalmente bloqueado esperando (`openideApproval.ts` resuelve una Promise). Hasta que estén, el modo nativo no sirve para trabajo real.
**Archivos:** `parts/openideChatConfirmationPart.ts`, `openideChatDecisionLine.ts`, `openideChatAskPart.ts`, `openideChatModeSuggestionPart.ts`.
**Terminada cuando:** un `run_command` peligroso pide permiso, Ctrl+Enter aprueba, Esc rechaza, la concesión **no** deja card y el rechazo deja una línea plana (asimetría del commit `4146dda`), y un `ask_user` de 3 preguntas se responde entero.

---

### Etapa 5 — Composer real

**Qué:** cambiar el `InputBox` de la Etapa 1 por `CodeEditorWidget`, más autocompletes, chips, imágenes y cola. Acá **desaparece el round-trip** `fileQuery`/`fileSuggest` y `commandQuery`/`commandSuggest`: `searchWorkspaceFiles()` y `getIconClasses()` se llaman en el render del completion item, y el array paralelo `icons` se borra.
**Archivos:** `input/openideChatInputPart.ts`, `openideChatAttachments.ts`, `openideChatFileCompletions.ts`, `openideChatCommandCompletions.ts`, `openideChatQueueWidget.ts` + `common/chat/openideChatQueueModel.ts`, `openideChatSendPayload.ts`.
**Terminada cuando:** `@` completa archivos con el icono del theme activo, `/` completa skills/commands/mcp/tools con badge de riesgo, se pegan imágenes, y el pipeline de `prepareAndSend` (`openideChatView.ts:1252-1514`) corre **en el mismo orden**: snapshot sincrónico de provider/model antes del primer `await` → expansión de `/comando` → `buildMentionContext` → `buildFileReferenceContext` → `buildComposerCapabilityContext` → `hookUserPromptSubmit` → Pick&Polish → `persistChatImages`.

---

### Etapa 6 — Pickers, header y contexto

**Qué:** modelo (con su drag&drop y su panel diferido), modo+permisos, esfuerzo, tabs, historial, kebab, panel de uso de contexto. Acá mueren, como mensajes, `selectProvider`, `selectModel`, `selectProviderModel`, `togglePickerFavorite`, `reorderPickerFavorite`, `togglePickerSection`, `setProviderOrder`, `setEffort`, `setPermission` **y el `postSession` entero** (`openideChatView.ts:2085-2150`, 66 líneas con guardas de generación contra carreras) → pasan a `agentService.onDidChange` + getters.
**Archivos:** todo `input/openideChatModel*.ts`, `openideChatModePicker.ts`, `openideChatEffortPicker.ts`, `header/*`, `chat/openideChatContextUsagePanel.ts`, `openideChatSessionBinding.ts`.
**Terminada cuando:** cambiar de proveedor, modelo, modo y permiso desde nativo persiste igual que desde el webview y se refleja en la statusbar (`updateStatusbar`, `openideChatView.ts:1836-1932`, que ya es 100% nativa y no se migra).

---

### Etapa 7 — Bandejas del dock y edición

**Qué:** archivos modificados, terminales background, subagentes, y la card de edición como **control remoto** de `OpenideEditReview`.
**Archivos:** `dock/*`, `parts/openideChatEditPart.ts`.
**Terminada cuando:** `keepFile`/`keepFiles`/`revertFile`/`openDiff` funcionan y los ±N de la card salen de `OpenideDiffSnapshotProvider`/`OpenideMessageChangeSetService`, **no** de un recuento propio.

---

### Etapa 8 — El resto de dominio

**Qué:** plan (draft + definitiva + "actualizando el plan"), subagentes, terminal embebida, canvas, diagramas (con extracción al módulo compartido), compactación, screenshot, retry/error, voz.
**Archivos:** el resto de `parts/`, `browser/diagrams/*`, `input/openideChatVoice.ts`. Acá `openidePlanHtml.ts` (708) pierde ~380 líneas duplicadas.
**Terminada cuando:** paridad funcional completa contra el webview, verificada con una checklist de los 30 kinds.

---

### Etapa 9 — Flip y borrado

**Qué:** default `'native'`, borrar `openideChatHtml.ts` (6448), `openideWebviewCodicons.ts`, `buildProviderIconData`/`serializeProviderIconData` de `openideProviderIcons.ts`, y reescribir los cuatro tests que fijan HTML por regex.
**Terminada cuando:** `grep -r openideChatHtml src/` no devuelve nada y el test de la terminal interactiva asserta **comportamiento** (`applyAgentEvent` con un `terminalData` produce un item con `awaiting-input`) en vez de `assert.match(html, /Enviar al panel/)`.

---

## 5. Riesgos concretos

**R1 — Los cuatro tests que fijan HTML generado por regex.** `test/common/openideTerminalInteractive.test.ts:101-112` asserta `/Enviar al panel/`, `/type: 'termToPanel'/`, `/\.part\.term-card\.awaiting-input/` y `/background_persistent/` sobre el string de `getOpenideChatHtml()`. Más `test/browser/openideChatModeTransition.test.ts:5`, `test/browser/openideChatRollback.test.ts:5`, `test/common/openideAgentCommon.test.ts:27`. Cualquier renombre de clase CSS o de tipo de mensaje rompe tests que **no miran DOM**. *Mitigación:* no tocar `openideChatHtml.ts` entre las Etapas 1 y 8; en la 9 reescribirlos contra el reducer.

**R2 — El `<script>` embebido no puede usar template literals ni `${}`** (`openideChatHtml.ts:4-7`). Todo es concatenación con `+` y las regex están **doble-escapadas** (`\\s`, `\\\\`). Mover código de ahí a un `.ts` real exige des-escapar a mano cada regex. *No es copy/paste seguro.* Las zonas peligrosas son el markdown propio (154-195, 2386-2462) y el highlighter (2249-2332) — pero los dos se **borran** en vez de portarse, así que el riesgo se concentra en `TOOL_META` (312-369) y en los renderers de charts (1885-2248), que sí hay que trasladar carácter por carácter.

**R3 — `supportDynamicHeights` vs `horizontalScrolling`.** `base/browser/ui/list/listView.ts` tira error si se activan los dos. Consecuencia: los code blocks anchos, las tablas markdown y los diagramas **tienen que scrollear en su propio contenedor interno**. Hoy en el webview lo hacen (`.codewrap`, `.diagram-scroll`), pero con `overflow-x` sobre un documento que también scrollea. Si al portar algún part se le olvida el contenedor, la fila fuerza scroll horizontal en toda la lista y el layout se rompe de forma difícil de diagnosticar.

**R4 — El `diffIdentityProvider` mal copiado mata el streaming en silencio.** `chatListWidget.ts:544-570` concatena dataId + contadores. Si nuestro `IOpenideChatItem.dataId` no cambia con cada delta, `setChildren` no re-renderiza y el usuario ve la respuesta **congelada** — sin error, sin excepción. Es el bug más probable de la Etapa 1 y por eso el criterio de terminación la incluye explícitamente.

**R5 — Las carreras de `postSession`.** `openideChatView.ts:2085-2150` tiene guardas de generación (`_sessionPostGeneration`) y re-chequea `getActiveProviderId()`/`getModel()` **después de cada await**, porque el fanout asincrónico corre carreras contra el picker. Peor: hace una recuperación con **efecto secundario** (2104-2114) — si no hay proveedor activo y hay exactamente un grupo conectado, lo activa y persiste el modelo. Eso es lógica de negocio escondida en un "post". Al migrar a observables (Etapa 6), esa recuperación tiene que mudarse a `openideAgentService.ts` **explícitamente**, o desaparece y el usuario abre el chat sin proveedor.

**R6 — La barrera global de rollback.** `openideChatView.ts` mantiene `_rollbackQueue`, `_rollbackActive`, `_rollbackOperations`, `_sendPreparations` y `_sendPreparationWaiters` porque el rollback **muta archivos del workspace** y es una transacción única incluso entre sesiones. Si el controller nativo (Etapa 1) no hereda esa barrera desde el principio, un `send` concurrente durante un rollback pisa archivos recién restaurados. **Esta barrera se copia en la Etapa 1, no en la 7.**

**R7 — `trackSubagentEvent` no es UI: es mutación de estado persistido.** `openideChatView.ts:256-308` reescribe los eventos de subagente en el camino del `postMessage`: `subagentStart` **crea una sesión espejo** de background y le inyecta `sessionId`; `subagentEvent` acumula `IChatMessage[]` en esa sesión; `subagentDone` cierra la tab transitoria si el usuario no la está mirando. Un reducer "puro" que consuma `AgentLoopEvent` directo se saltea todo eso. *Mitigación:* en la Etapa 2, `openideChatReducerFilters.ts` es puro pero devuelve **efectos declarados** (`{items, sessionEffects}`) que el controller aplica; no se llama a `OpenideChatSessions` desde `common/`.

**R8 — Dos rutas de ejecución con manejo de eventos distinto.** `prepareAndSend` (1252-1514) y `runExistingTurn` (1545-1578, para plan build y cambio silencioso de modo). La segunda es **más pobre**: no filtra por `parentVisible`, no acumula usage, no enriquece `fileDiff` con icono. Al unificarlas hay que quedarse con la lógica de la primera — si se unifica "por la mitad" aparecen bugs solo en el flujo de aprobar un plan, que es el menos ejercitado.

**R9 — Riesgo de rebase.** Cada import desde `contrib/chat` es un punto de fricción en el próximo rebase del fork (hoy 1.121.1). La regla del plan: **cero imports de `contrib/chat/browser/widget/*`** en el código final; solo `vs/base` y `vs/platform`. Lo de `contrib/chat` se copia con un comentario de cabecera que diga de dónde salió y en qué versión.

### Qué se pierde o se degrada temporalmente

| Cosa | Etapas afectadas | Estado |
|---|---|---|
| Todo salvo texto+markdown | 1-2 | **Degradado a una línea de texto.** Por eso el default sigue en `'webview'` |
| Aprobaciones y `ask_user` | 1-3 | **No funcionan en nativo.** El modo nativo no es usable para trabajo real hasta la Etapa 4 |
| Autocompletes `@` y `/` | 1-4 | **Ausentes** |
| Terminal embebida, plan, subagentes, diagramas, voz | 1-7 | **Ausentes** |
| Marquee de texto cortado | Permanente | **Se pierde.** No hay equivalente nativo y el ellipsis por CSS es lo que hace el resto del workbench. Se acepta |
| Turno pineado (`.turn-pin` sticky, `openideChatHtml.ts:621-709`) | Permanente, **decisión pendiente** | Ver abajo |
| Parpadeo de iniciales → logo de proveedor | Permanente | Ya pasa hoy (`openideProviderIcons.ts`); en una lista virtualizada se nota **más** porque el reciclado re-monta |

**Sobre el turno pineado — el único punto donde el plan no es obvio.** El `.turn-pin` sticky mantiene el mensaje del usuario y sus to-dos a la vista mientras corre el turno, y `appendToFlow` appendea a `currentTurn` (`openideChatHtml.ts:2464-2469`). En una lista virtualizada **no existe** el concepto de "hijo de un turno": las filas son planas y el reciclado destruye cualquier `position: sticky` que dependa de un ancestro. Hay tres salidas y hay que elegir en la Etapa 1, no después, porque condiciona el contrato de **todos** los content parts:
1. **Renunciar al pin** (lo que hace el chat nativo). Más simple, cambio de UX visible.
2. **Un banner sticky fuera de la lista** que refleje el turno en curso, alimentado por el mismo estado. Conserva el 80% del valor con el 10% del costo. **Recomendada.**
3. Sticky scroll de la tree (`stickyScrollDelegate` en `abstractTree.ts`) — **a verificar** si funciona con `supportDynamicHeights` y filas de altura muy variable. No lo comprobé.

---

## 6. Qué NO migrar

### 6.1 Andamiaje puro del iframe — se borra entero (~200 líneas)

| Bloque | Ubicación | Por qué muere |
|---|---|---|
| Puente `data-tip` → hover nativo | `openideChatHtml.ts:5745-5771` + `openideChatView.ts:844-857,402-429` | Existe **solo** porque el iframe no puede llamar a `IHoverService`. En DOM nativo, `setupManagedHover` |
| `clampMenu` | `openideChatHtml.ts:5773-5788` | `IContextViewService` posiciona y hace flip solo |
| Réplica de scrollbars | `openideChatHtml.ts:31-46` | 16 líneas que imitan a mano `DomScrollableElement` |
| Puente del file icon theme | `openideChatHtml.ts:1395-1400,5798-5821,6430-6438` + `openideChatView.ts:478-515` | `getIconClasses()` funciona directo |
| `tokenColorsCss` | `openideChatView.ts:520-553` | 34 líneas resolviendo tokenColors textmate a mano para alimentar un highlighter propio |
| `openImagePreview` / `diagramFullscreen` por postMessage | `openideChatHtml.ts:5373-5376,6242-6250` | Llamada directa a `ICommandService` |
| Persistencia de la cola en `vscode.getState/setState` | `openideChatHtml.ts:4125-4130` | `IStorageService` |
| `buildCodiconCss` | `browser/openideWebviewCodicons.ts` (archivo entero) | El workbench ya tiene la fuente. **No invertir un minuto acá** |
| `buildProviderIconData` / `serializeProviderIconData` | `browser/openideProviderIcons.ts` | Existen solo para cruzar el borde del iframe |

### 6.2 Features duplicadas — se reemplazan, no se portan

| Qué | Líneas | Reemplazo |
|---|---|---|
| Markdown propio | ~135 (`openideChatHtml.ts:154-195,1833-1845,2386-2462`) | `IMarkdownRendererService` con sanitizado endurecido. En DOM nativo **no hay CSP que nos cubra**: escribir nuestro propio saneador para output de LLM sería peor que la deuda actual |
| Syntax highlighting por regex | ~93 (`2249-2332`) | `CodeBlockPart` (tokenización real de Monaco). El absurdo actual: se paga un parser a mano para colorear con `tokenColors` que **ya vienen** del theme |
| `patchMarkdown` incremental (`__oiSrc`) | ~24 (`2830-2853`) | `hasSameContent()` de los content parts |
| Tablas markdown a mano | ~14 (`190-195,1840-1845`) | El renderer nativo + contenedor con `overflow-x` |
| Motor de overflow-fade + marquee | ~88 (`283-306,1725-1788`) | `text-overflow: ellipsis` + `IconLabel`. Dos observers (`ResizeObserver` + `MutationObserver`) sobre 28 selectores es un costo de runtime que no se justifica |
| Auto-follow del scroll + botón "ir al final" | ~50 (`877-882,1789-1832`) | El scroll lock de la lista (`chatListWidget.ts` como referencia) |
| Primitivas `.menu-*` | ~50 (`768-817`) + los 7 popovers | `IContextViewService`, siguiendo `openideUsagePopover.ts` (336 líneas) que ya lo validó en este mismo contrib |
| Render de diagramas en `openidePlanHtml.ts` | ~380 de 708 | El módulo compartido `browser/diagrams/` |
| **Diff viewer inline** (`.ediff-*`, ~200 líneas en `370-425,3321-3442`) | | La card queda como **control remoto** de `OpenideEditReview` (`browser/openideEditReview.ts`). La decisión de producto ya está tomada: el diff se revisa en el editor. Además, el diff está pintado **dos veces distinto** dentro del mismo archivo (`.ediff-*` para el transcript y `.dock-diff-*` para el dock) — se unifica en una primitiva |

### 6.3 Código muerto — se borra en la Etapa 0

Detallado arriba. ~60 líneas de CSS + 3 entradas muertas del `OVERFLOW_FADE_SELECTOR`.

### 6.4 Lo que NO se toca (y hay que decirlo explícitamente)

- **Todo `common/` del agente** y todos los servicios: `openideAgentService.ts` (4181), `openideChatSessions.ts` (436), `openideApproval.ts`, `openideMessageChangeSetService.ts`, `openideModelCatalog.ts`, `openideSubagentOrchestrationService.ts`. **La migración es de vista, no de motor.**
- `updateStatusbar` (`openideChatView.ts:1836-1932`): ya es 100% nativa, nunca pasó por el webview.
- El parche `hasTitle: false` en `src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts:108-110` y su red de seguridad en `media/openideChat.css:10-16`.
- La normalización a radio 2px en `media/openideChat.css:24-29`.
- Los charts SVG (`openideChatHtml.ts:1885-2248`, 385 líneas): **son la feature sin contraparte nativa más grande del chat.** No se borran ni se reescriben — se **mueven** a `browser/diagrams/` partidos en cinco archivos de ≤280 líneas y pasan a servir también al plan viewer y al editor de diagramas. Es la única parte donde el port es literal (con el des-escapado de regex del R2).