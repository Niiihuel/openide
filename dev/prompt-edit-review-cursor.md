# Prompt: arreglar review inline Undo/Keep estilo Cursor

Copiá el bloque de abajo tal cual a Sol 5.6 (modo Agent).

---

## Prompt (copiar desde aquí)

```text
# Tarea: arreglar el review inline de ediciones del agente (paridad Cursor)

Sos un agente de implementación en el repo OpenIDE (fork de VS Code). Tu trabajo es hacer que el **review de diffs del agente en Monaco** se sienta y funcione como en Cursor:

1. Barra global en la fila de breadcrumbs (derecha): `^ N of M v` · `< X of Y Files >` · **Undo File** · **Keep File Ctrl+Enter**
2. Widget flotante por bloque activo (sobre el hunk): `^ N of M v` · **Undo Ctrl+N** · **Keep Ctrl+Y** (Keep en verde)

Hoy YA existe una implementación parcial en `openideEditReview.ts`, pero está incompleta / rota respecto a Cursor. NO reescribas el sistema desde cero: diagnosticá, arreglá y completá sobre el código actual.

Referencia visual: el usuario quiere exactamente el layout de Cursor (barra en breadcrumbs + pill flotante por hunk). Hay una captura de referencia en el chat / assets si está disponible.

---

## Estado actual (leé esto ANTES de tocar código)

### Archivos dueños
- `vscode/src/vs/workbench/contrib/openideAgent/browser/openideEditReview.ts` — sesión, header, attach, undo/keep
- `vscode/src/vs/workbench/contrib/openideAgent/browser/openideDiffSnapshot.ts` — baselines por path
- CSS del review: embebido vía contribution / estilos del agente (buscá `.openide-review-header`, `.oreview-stepper`, `.breadcrumbs-control .openide-review-header`)
- Keybindings: `openideAgent.contribution.ts` → `openide.review.undoBlock` (Ctrl+N), `keepBlock` (Ctrl+Y), `keepFile` (Ctrl+Enter), next/prev block
- Wiring: `OpenideAgentService` → `OpenideEditReview` (`openReview`, `attachIfOpen`, `reviewAction`, `notifyCounts`)

### Qué YA funciona (no rompas)
- Diff inline: líneas agregadas verdes + view zones rojas con baseline eliminado
- Baseline en `OpenideDiffSnapshotProvider` (sesión + fallback git HEAD)
- Undo/Keep **por archivo** desde la barra
- Undo/Keep **por bloque** vía keybindings (Ctrl+N / Ctrl+Y) operando sobre `currentBlock`
- Context key `CTX_OPENIDE_REVIEW_ACTIVE` para no pisar Ctrl+Y=redo fuera del review
- Attach al abrir desde chat / archivo ya abierto / reload desde disco

### Qué está mal / incompleto (bugs conocidos en el código)

1. **Falta el widget flotante por bloque**  
   El comentario del archivo dice explícitamente que se ELIMINÓ el widget flotante Undo/Keep por bloque porque con `allowEditorOverflow` se filtraba al chat (auxiliary bar) y duplicaba la barra.  
   Cursor SÍ tiene ese widget. Hay que **reintroducirlo bien**, sin overflow al chat.

2. **Mount frágil del header en breadcrumbs**  
   `ReviewHeaderWidget` hace un one-shot:
   `editor.getContainerDomNode()?.closest('.editor-group-container')?.querySelector('.breadcrumbs-control')`
   Si breadcrumbs están ocultos, tardan en montar, o el DOM de islands/layout cambia → cae al overlay TOP_RIGHT o no se ve / se desalineá. Hay que:
   - re-intentar el mount cuando aparezca `.breadcrumbs-control`
   - re-anclar al cambiar de grupo/editor
   - fallback limpio a overlay TOP_RIGHT si breadcrumbs off
   - no dejar nodos huérfanos al dispose

3. **`pendingPaths()` ≠ archivos con diff real**  
   Hoy `pendingPaths()` devuelve TODAS las keys del map de baselines. Eso infla "X of Y Files" y permite hop a archivos ya resueltos o sin cambios visibles. El contador de archivos debe listar solo paths con review pendiente **y** diff no vacío (o al menos no clearBaselineados).

4. **Sincronización de contadores**  
   La barra y el (nuevo) widget flotante deben mostrar el MISMO `currentBlock` / total. Al navegar con ∧∨ de cualquiera de los dos, ambos se actualizan y el editor revela el hunk.

5. **Posición del widget flotante**  
   Debe anclarse al bloque activo (primera línea del modified range, o zona de deletion), tipicamente a la DERECHA del viewport del editor, sin tapar el código crítico, sin escapar al auxiliary bar del chat. Preferí `IContentWidget` o `IOverlayWidget` con `allowEditorOverflow: false` (o equivalente que clippee al editor). NUNCA uses overflow que cruce al chat.

6. **Inconsistencias de docs/atajos**  
   Comentarios mezclan Ctrl+Shift+Y vs Ctrl+Y. La verdad es Ctrl+Y = keepBlock (registrado). El widget debe mostrar **Ctrl+N** / **Ctrl+Y** / **Ctrl+Enter** como Cursor. Alineá comentarios.

7. **UX del Keep por bloque**  
   Keep debe fundir el bloque al baseline (`overwriteBaseline`) y dejar de pintarlo — ya está; verificá que tras Keep el `currentBlock` avance al siguiente hunk restante (como Cursor), no se quede en un índice inválido.

8. **Layout OpenIDE (islands)**  
   El workbench tiene gaps/bordes custom (`openide-islands`). El header en breadcrumbs y el widget no deben romperse con `overflow: hidden` de contenedores vecinos. Probá mentalmente el clipping; si el breadcrumb row clippea el header, ajustá CSS (padding-right en breadcrumbs para no tapar el path, z-index, position).

---

## Decisiones de diseño (YA tomadas — no preguntes)

### Producto
- Mantener review **integrado en el editor de texto** (NO volver a `vscode.diff` side-by-side).
- Dos superficies, como Cursor:
  - **Header global** (breadcrumbs / TOP_RIGHT): nav bloques + nav archivos + Undo File + Keep File
  - **Widget de bloque** (flotante sobre el hunk activo): nav bloques + Undo + Keep
- El widget de bloque se muestra solo cuando hay `changes.length > 0` y hay sesión activa.
- Al resolver el archivo (0 bloques / Undo File / Keep File), desaparecen header y widget.

### Implementación del widget de bloque
- Nueva clase p.ej. `ReviewBlockWidget` en el mismo archivo `openideEditReview.ts` (no inventes otro módulo salvo que el archivo se vuelva ingobernable).
- API de acciones: `prevBlock`, `nextBlock`, `undoBlock`, `keepBlock` (reusar `ReviewSession.runAction` / métodos privados).
- Estilo visual cercano a Cursor:
  - pill compacta, fondo semi-opaco del editor/chrome, border-radius ~6–8px
  - Undo neutro; Keep verde (`#2ea043` / tokens git decoration) con texto blanco
  - kbd hints `Ctrl+N` / `Ctrl+Y` en el botón
  - stepper `chevron-up` / count / `chevron-down`
- CSS: clases nuevas bajo prefijo `openide-review-block` / `oreview-block-*` junto a las existentes. Sin gradients ni sombras pesadas; flat como el header actual.

### Header breadcrumbs
- Preferí anclar a `.breadcrumbs-control` con clase `in-breadcrumbs` (ya existe CSS).
- Dejá padding-right suficiente en el breadcrumb row para que el path no quede debajo de la barra.
- Si `breadcrumbs.enabled === false`, usá overlay TOP_RIGHT del editor (ya hay fallback).
- Observá aparición del nodo (MutationObserver liviano, o re-try en `onDidChangeModel` / active editor change / layout). Dispose limpio.

### Contadores
- Bloques = `linesDiffComputers` changes actuales de la sesión.
- Archivos = paths pendientes con baseline vivo Y (ideal) al menos un change al abrir; al hop, skip archivos sin sesión posible.
- Labels en inglés como Cursor: `"3 of 50"`, `"2 of 4 Files"`, `"Undo File"`, `"Keep File"` (ya localizados; no cambies i18n salvo bugs).

### Fuera de scope
- No rehacer el agent loop, chat cards, ni Canvas.
- No migrar el chat a React.
- No cambiar el sistema de approval de tools.
- No tocar patches ajenos (`openide-islands`, themes) salvo un CSS mínimo imprescindible para clipping del review; si tocás archivo compartido, regenerá el patch correcto y evitá contaminación cruzada.

---

## Plan de trabajo

1. Leé `openideEditReview.ts` completo + CSS del review + keybindings en contribution + wiring en `openideAgentService.ts`.
2. Reproducí mentalmente los fallos: mount breadcrumbs, ausencia de widget, pendingPaths inflado, índice post-keep.
3. Implementá `ReviewBlockWidget` + posicionamiento sin overflow al chat.
4. Robustecé mount/re-anclado del `ReviewHeaderWidget` en breadcrumbs.
5. Unificá estado `currentBlock` → update(header + blockWidget) en un solo método.
6. Tras keep/undo de bloque: recompute → clamp índice → reveal siguiente → update UI + `notifyCounts`.
7. Filtrá la lista de archivos del stepper para que "N of M Files" sea honesto.
8. Ajustá CSS (header + block widget + padding breadcrumbs).
9. Compilá y verificá el cambio directamente desde la fuente canónica en `vscode/`.
10. `cd vscode && npm run compile` — 0 errores.

---

## Criterios de aceptación

- [ ] Con review activo se ve la barra en breadcrumbs (o TOP_RIGHT si breadcrumbs off) con bloques + archivos + Undo File + Keep File.
- [ ] Se ve el widget flotante en el hunk activo con Undo/Keep y el mismo contador de bloques.
- [ ] El widget NUNCA aparece encima del chat / auxiliary bar ni fuera del editor group.
- [ ] Ctrl+N / Ctrl+Y / Ctrl+Enter hacen lo mismo que los botones (y solo con `openideReviewActive`).
- [ ] ∧∨ (header o widget) navega hunks y scrollea al centro si hace falta.
- [ ] `<` `>` cambia entre archivos pendientes reales.
- [ ] Keep bloque: el hunk desaparece del diff y el foco pasa al siguiente.
- [ ] Undo bloque: restaura baseline de ese rango, guarda a disco, re-render.
- [ ] Undo/Keep File resuelve el archivo, limpia UI, salta al siguiente pendiente si hay.
- [ ] Dispose sin leaks: no quedan DOM nodes en `.breadcrumbs-control` ni widgets huérfanos.
- [ ] `npm run compile` OK; patch regenerado sin contaminación de `welcomeOnboarding` u otros hunks ajenos.

Empezá leyendo el código real y después implementá. Preguntá solo si un constraint es físicamente imposible en este árbol (p.ej. Monaco no puede clippear overlays de cierta forma) — en ese caso proponé el workaround más cercano a Cursor y seguí.
```

---

## Cómo usarlo

1. Chat Agent con **GPT Sol 5.6** en el repo `openide`.
2. Pegá el prompt.
3. Anclá contexto:
   - `vscode/src/vs/workbench/contrib/openideAgent/browser/openideEditReview.ts`
   - `vscode/src/vs/workbench/contrib/openideAgent/browser/openideDiffSnapshot.ts`
   - `.claude/skills/openide-build/SKILL.md`
   - La captura del review Cursor (barra breadcrumbs + pill Undo/Keep) si podés adjuntarla.
4. Al terminar: pedile regenerar patch + `npm run compile`.

## Hallazgos del análisis (para vos)

| Pieza | Hoy en OpenIDE | Cursor (objetivo) |
|-------|----------------|-------------------|
| Barra en breadcrumbs | Sí (`ReviewHeaderWidget` + CSS `in-breadcrumbs`) | Sí |
| Widget flotante por hunk | **No** (se quitó por overflow al chat) | Sí — Undo/Keep + stepper |
| Undo/Keep por bloque | Solo teclado Ctrl+N/Y | Teclado + botones visibles |
| Mount breadcrumbs | One-shot frágil | Estable / re-anclado |
| Contador de archivos | Todas las baselines | Solo pendientes reales |
