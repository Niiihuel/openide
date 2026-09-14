# Migración visual y rendimiento de OpenIDE

Fecha: 8 de septiembre de 2026. Documento de integración; no describe un motor Rust implementado.

## Decisión y alcance

El usuario aprobó la dirección visual de `design.md`, con ajustes finales de tooltip y scroll. La migración visual conserva los servicios nativos del Workbench y cambia su presentación. La optimización estructural se desarrolla sobre las mismas superficies, con mediciones y cambios independientes que permitan identificar regresiones.

Referencia recibida: `OpenIDE_Rust_Arquitectura.pdf`, 25 páginas, leído completo. Se inspeccionó además la página 8 renderizada para comprobar el diagrama de responsabilidades. Sus ejemplos de protocolo, Rust, SQL, flags y rutas son propuestas, no contratos ni código incorporado. El kit técnico mencionado en la página 23 no fue adjuntado.

La recomendación central del PDF es adecuada para esta integración: eliminar trabajo repetido, mejorar representaciones y acotar colas; comparar TypeScript optimizado y ejecución fuera del renderer antes de decidir una migración a Rust. Conservar Electron, Monaco, Workbench, extensiones, terminales, documentos abiertos y permisos. No existe todavía evidencia medida de ahorro de memoria, CPU o latencia del nuevo backend.

## Contraste con este checkout

El HEAD coincide con el commit auditado por el PDF: `8aa316636e60f96e7140b05bc8d91d0e86cc7f89`. Hay cambios locales posteriores, incluidos GOAL y Canvas. Por ello la coincidencia de HEAD no implica identidad del árbol de trabajo. Las siguientes comprobaciones son estáticas y focalizadas, no un nuevo benchmark ni una reauditoría exhaustiva del documento.

| Punto del PDF | Evidencia actual | Consecuencia |
| --- | --- | --- |
| H01: matriz del grafo | `openideCodebaseGraphService.ts`, `getDependencyMatrix`: busca pertenencia a módulos recorriendo archivos para cada extremo de cada arista; vuelve a copiar `relations` en cada acumulación | Crear mapas de pertenencia y acumuladores privados. Preservar orden, fallback, filtros y referencias antes de cambiar el contrato a agregados |
| H07: diff | `common/openideDiffPreview.ts`: `countDiff` y `buildDiffPreview` calculan diff por separado; los bucles internos pueden producir más filas que el límite antes del `slice` final | Acotar construcción de filas y reutilizar un resultado. Los 3000 ms son un presupuesto configurado, no una medición de bloqueo real |
| H03: indexación | `openideCodebaseMemoryIndexer.ts`: límites de 6000 archivos, 400 KiB y 80 MiB; suma `content.length`; limpia storage al reconstruir. Canvas ya agrega excepciones de tamaño | Distinguir bytes de unidades UTF-16 y preservar las nuevas clases de documentos. Luego pipeline acotado y publicación de nueva generación conservando la última válida |
| H05: cola de mutación | `openideCodebaseMemoryChannel.ts`: reconstrucción, actualización y snapshot pasan por `mutationQueue` | Medir espera y separar respuesta de consultas de mantenimiento largo mediante generaciones explícitas |
| H09: cancelación | `electron-browser/openideNativeServices.ts`: codebase sigue usando `ProxyChannel.toService`; otro canal tiene un wrapper que delega `channel.call` | No asumir que un token en los argumentos del servicio llega como cancelación del transporte. Diseñar y probar el adaptador específico de codebase |
| Frontera actual | Codebase se obtiene desde `sharedProcessService.getChannel('openideCodebaseMemory')` | El indexador ya está fuera del renderer; Rust debe justificar una mejora adicional y evitar duplicar el grafo completo |
| Tooltip actual | `chat/openideChatHover.ts`: `IHoverService`, `setupDelayedHover`, grupo `openide.chat.chrome`, `showPointer: true`, `compact: true` | Conservar este servicio y sus opciones. No portar el controlador de la maqueta al IDE |

Los restantes hallazgos del PDF se incorporan como hipótesis a verificar con perfiles y pruebas antes de modificar sus subsistemas. Especialmente: coste real de snapshots, retención de Markdown y DOM, lecturas del watcher y equivalencia de ranking.

## Una misma secuencia de trabajo

| Etapa | Entrega | Aceptación |
| --- | --- | --- |
| 0. Referencia | Capturas del diseño aprobado y baseline de una build distribuible, con corpus, hardware, escala, extensiones y configuración registrados | Repetición de escenarios y resultados antes/después trazables; nada de atribuir mejoras del modo desarrollo a la AppImage |
| 1. Fundaciones visuales | Tokens de superficies, bordes, radios, densidad, movimiento y scroll; adaptadores a controles nativos | Tooltip estable con indicador, popovers con gap de 8 px y flip, scroll interior; foco por teclado, contraste y reduced-motion preservados |
| 2. Superficies | Ajustes, compositor, selector, planes, actividad, GOAL, terminales, Canvas y menús del Workbench | Flujos reales conservados; cambios visuales no alteran permisos, selección de proveedor ni ejecución de herramientas |
| 3. Trabajo local evitable | H01 y H07, cada uno en un cambio independiente | Fixtures diferenciales, mismos resultados y límites; medir CPU/latencia y tamaño de intermediarios |
| 4. Renderer | Perfil de streaming, medidas de filas, reconciliación, callbacks y overlays | No perder cursor, selección ni ancla de scroll; cerrar conversación libera recursos; sin temporizadores de animación cuando no hay actividad |
| 5. API de consultas | Operaciones tipadas, pequeñas, cancelables y con versiones; comparar cálculo TS fuera del renderer | Pruebas de cancelación en cola/cómputo/desconexión; separación por workspace y por ventana; ranking y evidencia equivalentes |
| 6. Experimento Rust | Sidecar de lectura, arranque lazy, protocolo limitado, crash/recovery y consultas en sombra muestreadas | Comparación contra TS optimizado, incluyendo IPC y memoria de todos los procesos. Activación solo con beneficio suficiente y ausencia de regresiones |
| 7. Propiedad del índice | Si la etapa 6 lo justifica: deltas, overlays privados, pipeline por bytes, staging y persistencia versionada | Rebuild y eventos concurrentes sin pérdidas; rollback, disco lleno y reinicio; notas autorales intactas |

Las etapas visuales no dependen de tener Rust. La evaluación de arquitectura sí aprovecha sus escenarios de interacción y datos de rendimiento. “Hacerlo junto” significa una especificación y validación comunes, con cambios separables; no un commit masivo que mezcle apariencia, ranking, IPC y persistencia.

## Reglas que deben sobrevivir a la migración

- El documento abierto pertenece a Monaco. El índice es derivado; no reemplaza el texto sin guardar ni el undo.
- Memoria Markdown, Plan, GOAL y sus reportes no se borran al reconstruir una caché.
- Proveedores virtuales y remotos conservan `IFileService`; un binario local no resuelve todos los esquemas URI.
- Las consultas identifican generación, frescura, cobertura y truncamiento. Una respuesta vacía no representa indistintamente cancelación, fallo o ausencia de resultados.
- Un proceso por consulta o editor y una copia completa del grafo por cliente no son la arquitectura propuesta.
- La cancelación, las cuotas y la desconexión se verifican de extremo a extremo. Los presupuestos en bytes incluyen colas de entrada y resultados retenidos.
- Las animaciones siguen eventos, no un polling permanente. Se preserva la virtualización existente y se mide el trabajo de layout antes de tocar contención CSS.
- No extender estilos del chrome a contenido de documentos, canvas del usuario, webviews o editores de extensiones. Para listas de Monaco, usar sus opciones/layout de scrollbar, no pseudoelementos de un scrollbar HTML que no controlan esa lista.

## Verificación y decisiones pendientes

Próxima medición: matriz de dependencias, diff grande, streaming determinista y scroll con mensajes de altura variable. Capturar latencia extremo a extremo, CPU, bytes IPC, retención tras cerrar y memoria por proceso; PSS donde esté disponible. Comparar varias ejecuciones con el mismo corpus y reportar dispersión.

Los umbrales orientativos del PDF (20% CPU o 25% memoria) no se adoptan como promesas ni resultados. Elegir el criterio por carga antes de medir. Si TS optimizado resuelve el problema o el coste IPC elimina la ventaja de Rust, se conserva TS.

Estado al 8 de septiembre: refinamientos aplicados al prototipo y especificación actualizada. No se ha migrado el CSS de producción ni instalado un motor Rust o una AppImage nueva.


## Revisión del chat y arrastre — 12 de septiembre de 2026

La revisión actual encontró este documento y `graph-performance-implementation.md`; el PDF original no está en el checkout. Las conclusiones siguientes provienen del código actual, perfiles del renderer y fuentes primarias, no de una nueva lectura de ese PDF.

### Bienvenida contextual y controles compartidos

Se reemplazó el logo central y «New chat» por el workspace y tres entradas de tarea: explorar el proyecto, planificar un cambio y resolver un problema. Cada acción prepara un borrador editable, conserva el texto existente y nunca envía automáticamente. El historial solo aparece cuando existe una conversación con contenido. Se conservan los controles `oi-btn`, filas `oi-dock-row`, Codicons, tokens y servicios nativos; la entrada animada respeta movimiento reducido.

La dirección combina [Views de VS Code](https://code.visualstudio.com/api/ux-guidelines/views), que recomienda bienvenidas breves con acciones relevantes, y el patrón de [estados vacíos de Carbon](https://carbondesignsystem.com/patterns/empty-states-pattern/), que orienta hacia el siguiente paso. Los flujos de [chat de Kiro](https://kiro.dev/docs/ide/chat/) y [specs](https://kiro.dev/docs/specs/) sirven como referencia de tareas y contexto. No se añadió otra librería de componentes al Workbench.

### Causa medida del lag

Las propiedades CSS `--agent-sidebar-width` y `--agent-context-width` solo dimensionan el grid raíz, pero antes se heredaban por todo el chat y Changes. Cada movimiento invalidaba estilos en miles de descendientes. Ahora se registran con `@property`, tipo longitud e `inherits: false`.

Experimento diagnóstico, misma ventana dev con 400 archivos y secuencia de 60 posiciones del mouse:

| Medición acumulada | Antes | Solo aislar la herencia |
| --- | ---: | ---: |
| RecalcStyleDuration | 21,739 s | 1,324 s |
| LayoutDuration | 1,068 s | 1,063 s |
| Duración de la secuencia automatizada | 30,567 s | 6,369 s |

Es una comparación controlada para identificar la causa, no un benchmark de distribución ni una medida de FPS. La automatización CDP, diagnósticos dev, carga de CPU y cálculos de diffs afectan los tiempos. Los perfiles finales de una sesión real también mostraron cálculo de diffs en segundo plano; no corresponde atribuir todo el tiempo restante al sash ni prometer la misma mejora total en cualquier workspace. Evidencia local: `.build/agent-window-resize-profile/{baseline,non-inherited}.json` y sus perfiles de CPU.

Además, el sash agrupa eventos con el planificador nativo de animation frames y aplica la posición final al soltar. Se evita relayout de barras, sesiones y árboles con dimensiones iguales. El editor acoplado usa su ResizeObserver existente; se retiró la llamada manual duplicada y su API auxiliar sin otros consumidores. No se reconstruyen las filas al arrastrar y los diffs colapsados siguen sin montar editores ni cargar modelos.

La prueba reproducible `dev/test-agent-window-resize-runtime.mjs` abre 400 archivos en un perfil Electron aislado, usa el sash real y verifica límites, posición final, identidad de nodos, carga lazy, panel angosto y conservación de conversación/borrador. Guarda mediciones en `.build/agent-window-resize-runtime/metrics.json`; los contadores son diagnósticos, sin umbral temporal dependiente del hardware. También existen pruebas de bienvenida y del flujo completo de revisión/edición en `dev/test-chat-welcome-runtime.mjs` y `dev/test-agent-window-review-runtime.mjs`.

También se corrigió el ciclo de disposición de temporizadores de ventanas auxiliares: `deleteAndLeak` podía volver a registrar en el detector GC un objeto ya dispuesto. `delete` conserva la disposición idempotente y no rearma ese registro. La suite Chromium `Window` cubre finalización, cancelación, callbacks tardíos y cierre de ventanas; el detector sigue habilitado.

Validación de esta revisión: `npm run typecheck-client`, bienvenida contextual, flujo completo de agente, revisión/edición/guardado, resize con 400 archivos y suite `Window` aprobados. Algunas suites emiten cancelaciones de lectura/escritura de sus archivos temporales durante el cierre, después de completar sus aserciones. No son mediciones de una build distribuible.

### TypeScript nativo y frontera de Rust

Actualización del 13 de septiembre: la extracción de símbolos, imports y hashes ya se conecta a un motor Rust por lotes. El alcance, validación y límites están en [Migración del indexador a Rust](codebase-native-migration.md). Las conclusiones de la revisión siguiente describen el estado anterior a esa implementación.

**TypeScript 7 está escrito en Go.** Acelera compilador y servicio de lenguaje; el JavaScript emitido continúa ejecutándose en V8, con layout y pintura a cargo de Chromium. Este checkout ya usa `@typescript/native` como alias de TypeScript 7.0.2 y mantiene `@typescript/typescript6` para herramientas con API JS. El ejecutable `tsc` resuelve al compilador nativo. No hay que reemplazar esa convivencia para arreglar un sash. [Anuncio oficial y compatibilidad TS6/TS7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

El antecedente más próximo encontrado a la preocupación sobre archivos es el [experimento de buffer de texto en C++ de Microsoft](https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation). Las conversiones de strings y llamadas frecuentes entre JS y C++ eliminaron ventajas esperadas de velocidad; el equipo mejoró estructuras de datos en JS. No se identificó con certeza el issue recordado por el usuario y no debe describirse ese experimento como Rust.

La búsqueda de VS Code ya usa ripgrep (Rust). El [issue 206030](https://github.com/microsoft/vscode/issues/206030) y [PR 213511](https://github.com/microsoft/vscode/pull/213511) documentan una degradación por demasiados threads en un filesystem distribuido y la incorporación de un límite configurable. El lenguaje no sustituye los presupuestos de concurrencia. El [watcher nativo](https://github.com/microsoft/vscode/wiki/File-Watcher-Internals) ya se ejecuta fuera del renderer; persisten [restricciones de SO, symlinks y unidades de red](https://github.com/microsoft/vscode/wiki/File-Watcher-Issues).

Orden recomendado para este fork:

1. Mantener UI, Monaco e IFileService. No sustituir proveedores remotos/virtuales, texto sin guardar, undo o extensiones por acceso directo a disco.
2. Optimizar `getDependencyMatrix` con mapas de pertenencia y acumuladores; evitar calcular el mismo diff dos veces y producir filas que se descartarán. Probar equivalencia y medir antes/después por separado.
3. Aprovechar el shared process de codebase existente. `graph-performance-implementation.md` ya registra lotes, lecturas acotadas, generaciones y ranking parcial: no tratarlos como trabajo ausente.
4. Si persiste CPU significativa, comparar consultas agregadas en TS fuera del renderer con un sidecar Rust de lectura bajo flag. Usar resultados pequeños, cancelación, generaciones, cuotas de bytes y recuperación. Evitar IPC por línea/nodo y transferir el grafo completo por consulta.
5. Decidir con latencia extremo a extremo, memoria de todos los procesos y retención al cerrar; incluir espera, serialización, IPC y aplicación del resultado. No hay todavía motor Rust implementado ni beneficio medido de una migración.
