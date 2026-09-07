# Implementación: rendimiento, memoria y descubrimiento de herramientas

El bloque se implementó con tres agentes trabajando en áreas separadas —grafo, memoria canónica y CLIs— y una integración central del ciclo de chat. Se mantuvo el árbol de trabajo existente; no se hicieron commits ni publicación. El código nuevo usa copyright OpenIDE. No se importó código de Mem0, Engram, Cline o Microsoft para este bloque.

La memoria Markdown sigue siendo la fuente de verdad. El índice de nodos representa código y notas como una proyección consultable; Mem0 queda como búsqueda semántica opcional. Ninguno sustituye el recibo de escritura canónica.

## Cambios entregados

**Memoria y cierre del chat.** Al terminar una petición, el IDE confirma primero un trabajo durable en el perfil local y luego libera el chat mientras extrae los hechos en segundo plano. La captura informa pendiente, guardado, ausencia de información nueva o error diferido. Al reanudar esa conversación se recuperan sus trabajos en orden; una espera inicial acotada a 250 ms permite incorporar la memoria recién guardada y avisa si todavía falta. El modo manual no hace extracción automática. La captura previa a compactación conserva una copia durable antes de permitir que se descarte contexto.

Cada trabajo tiene identidad independiente. Se conservan hasta 100 trabajos por conversación, sin expulsar pendientes. Las notas retienen los últimos 300 IDs de operación para evitar duplicar observaciones al reintentar después de otra actualización. La cola cancela ejecución al cambiar raíces, confianza o configuración; los trabajos reconocidos en disco sobreviven. La recuperación no es un daemon global: ocurre al volver a ejecutar la conversación correspondiente.

Las lecturas de notas reutilizan parseo y hashing, reconciliando inmediatamente archivos y metadatos en cada acceso. Se preservan edición externa, CAS de revisión/hash, dirty buffers, enlaces y aislamiento de raíces. El handoff y el recall nativo comparten una lectura. La red Mem0 usa una cola separada y sus resultados se validan contra el estado canónico actual. Olvidar una nota actualiza su ruta real en el grafo de forma incremental.

**Grafo.** El watcher conserva revisiones hasta que el proceso compartido reconoce el lote. Lee hasta ocho archivos simultáneamente, respeta tamaños y lotes de 500, y reintenta fallas sin perder cambios nuevos. Los snapshots comparten cargas por generación y rechazan resultados invalidados. Las mutaciones y composición del snapshot se coordinan; el manifiesto ya no copia todos sus archivos en cada inserción. La búsqueda normaliza una vez y selecciona el prefijo relevante sin ordenar todos los resultados.

**CLIs.** Un catálogo común describe navegador, Project Map, memoria, planes y editor. `openide_capabilities` permite descubrir familias y nombres disponibles; MCP recibe orientación breve. El terminal muestra configuración y fallas de cada lanzamiento, con observaciones de conexión separadas y explícitamente limitadas a la ventana. Guardar un archivo de configuración no se presenta como prueba de conexión del modelo.

Se agregaron adaptadores aditivos para Amp y Copilot. Claude recibe orientación mediante un `SessionStart` temporal, que cubre los eventos documentados de inicio, reanudación y compactación. Se conservan los adaptadores de Codex y OpenCode. Grok continúa con registro explícito; Gemini y Droid muestran que no hay un adaptador automático verificado. Los errores de validación, permisos, cancelación y ejecución cruzan MCP como `isError`, preservando imágenes y revisión de planes.

## Resultados medidos

| Operación | Antes | Después |
| --- | ---: | ---: |
| Listar 500 notas + 200 sesiones, mediana | 162,9 ms | 13,1 ms |
| Obtener una nota en ese conjunto, mediana | 191,4 ms | 12,2 ms |
| Insertar 5.000 entradas sin persistencia, mediana de tres muestras | 6.109 ms | 5,2 ms |
| Prefijos descriptivos repetidos en 24 herramientas externas | 13.214 bytes | 4.103 bytes |
| Descripción externa más larga después del cambio | — | 978 bytes |

Las primeras tres mediciones usan clases compiladas reales con datos sintéticos y disco caliente; no incluyen IPC, modelos, GUI o indexado completo de repositorios. La mejora de inserción elimina un costo cuadrático aislado, y no significa que indexar 5.000 archivos reales tarde 5 ms. Las notas de la fixture no contienen el historial máximo de recibos. Los bytes del catálogo tampoco son una medición de tokens ni de decisiones espontáneas de un modelo.

El ensayo Electron con una demora artificial de 1.500 ms en la extracción dejó el chat listo a los **286 ms**, mientras la extracción terminó a los **1.683 ms**; luego apareció el aviso de memoria comprobada. El modo manual realizó cero capturas. Esto verifica el desacople del cierre; no estima latencia de proveedores reales.

No se demuestra una mejora general de arranque: los ensayos siguen siendo builds de desarrollo con perfiles mínimos, y los últimos usan Xvfb. No se comparan directamente sus tiempos de arranque o memoria con el escritorio original.

## Verificación

- Comprobación completa TypeScript: `npm run typecheck-client`.
- Suites integradas de memoria, grafo, runtime de turnos, adaptadores, exposición MCP y ejecución: **152 pruebas pasan**; resultado final en `.build/performance-cli-implementation/integrated-tests-final.log`.
- Owner, capturas y cola: 39 pruebas focalizadas, incluyendo fsync interrumpido por revocación de raíz, pérdida del recibo tras otra actualización, checkpoints multibyte, cancelación y compacción sin disco disponible.
- Sonda del índice: 500, 501 y 2.000 cambios reconocidos, con cargas concurrentes e invalidación verificadas. El antiguo reproducer ahora exige comportamiento corregido.
- Electron nativo: guardado explícito y automático, Markdown, reinicio, recall, consulta desde el grafo y protección del buffer sin guardar.
- Terminal real con CLI controlado: 14 escenarios, incluyendo MCP, ayuda por familia, observaciones de ventana, error de memoria, teclado, selección, aprobación/rechazo/cancelación de planes y relanzamiento.

Las últimas pruebas gráficas se ejecutaron en un servidor **Xvfb independiente**, sin ventanas de escritorio. Dos intentos anteriores de ubicación mediante Hyprland fallaron y se cerraron al detectarlo; sus resultados no se presentan como cumplimiento del workspace 6. La fixture nativa reinicia la aplicación dentro del mismo display virtual.

Reproducción en NixOS, con `vscode/out` actualizado:

```bash
cd vscode
npm run typecheck-client
cd ..
OPENIDE_BENCHMARK_OUTPUT=.build/performance-cli-implementation/benchmark-final.json node dev/bench-memory-performance.mjs
node dev/probe-memory-indexing.mjs
./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/probe-performance-cli.mjs dev/test-memory-runtime.mjs dev/test-hosted-cli.mjs'
```

El runner permite `OPENIDE_XVFB_EXECUTABLE` para indicar otra instalación de Xvfb. Usa un display asignado por el servidor y lo cierra al terminar. Las pruebas de CLIs usan perfiles, ejecutables y repositorios temporales; no autentican cuentas ni invocan modelos de pago.

## Límites y siguiente trabajo

La revisión automática rechazó la reescritura de credenciales, tickets y revocación independiente por lanzamiento, por considerarla una modificación de seguridad sin autorización suficientemente específica. Se completó una alternativa que conserva la autenticación existente. Por ello, la interfaz informa evidencia por ventana y no atribuye conexiones a un CLI individual ni promete revocación independiente. Ninguna mutación rechazada fue ejecutada por otra vía.

Todavía corresponde medir el build de producción, ampliar la evaluación con modelos reales a los demás CLIs y a sesiones interactivas con compactación, y decidir a partir de trazas si mover búsqueda a un worker o usar un índice invertido. La restauración de un índice obsoleto reconstruye cuando `indexOnOpen` está habilitado; la reconciliación incremental de arranque requiere ampliar el protocolo. El grafo aún recorre candidatos normalizados y una consulta grande puede superar el presupuesto de un frame.

Los agentes externos conservan control de su ciclo: un hook aporta orientación, pero solamente el recibo de `memory_save` demuestra que escribieron la nota. Grok no elimina registros previos sin demostrar su propiedad; OpenCode conserva su precedencia normal, con la limitación documentada de un `OPENCODE_CONFIG` personalizado previo.

## Evidencia detallada

- [Investigación y línea base](performance-cli-discovery-investigation.md).
- [Garantías y límites de memoria](research/memory-performance-implementation.md).
- [Grafo: implementación y regresiones](research/graph-performance-implementation.md).
- [Adaptadores, fuentes oficiales y certificación CLI](research/cli-discovery-implementation.md).
- Mediciones y logs: `.build/performance-cli-implementation/benchmark-final.json`, `reproductions.json`, `runtime-virtual/`, `native-runtime/`, `hosted-cli-virtual.log` y `typecheck-client-final.log`.

Actualización: se probó también el Claude autenticado del PATH (2.1.263): descubrió las cinco familias, guardó Markdown canónico y lo recuperó en una sesión nueva, con dos respuestas exitosas y cero permisos denegados. Fue una prueba controlada en modo print; los detalles y límites están en [la evaluación de Claude](research/cli-discovery-implementation.md#authenticated-claude-evaluation).
