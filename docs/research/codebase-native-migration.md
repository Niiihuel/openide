# Motor nativo de memoria del código

Actualizado el 13 de septiembre de 2026. Conectado al indexador y a las consultas de producción. Validación local: Linux x64.

## Qué está migrado

El proceso `vscode/native/codebase` realiza estas operaciones:

- Hash FNV sobre UTF-16 y extracción de definiciones/imports compatible con los providers anteriores `regex` y `text`.
- Resolución global de imports, aliases ambiguos, proyección entre archivos, Louvain, división de comunidades y reinserción de hubs.
- Índices residentes de búsqueda y adyacencia; consultas `search`, `explore`, `callers`, `callees`, `impact`, `path`, `relatedTests`, `communityLabel` y `pickSeeds`.
- Análisis sintáctico incremental con Tree-sitter para TS/TSX/JS/JSX, **experimental y desactivado por defecto**. Se habilita con `openide.memory.enableTreeSitter: true`. Cambiar esa opción reconstruye el índice.

La finalización del grafo y las consultas utilizan Rust automáticamente cuando está disponible el binario empaquetado. Tree-sitter amplía la extracción sintáctica y no pretende devolver los mismos falsos positivos que regex: distingue comentarios, strings y declaraciones. Las gramáticas y el runtime de Tree-sitter son código C nativo utilizado mediante bindings Rust.

La última fase de nombres y IDs estables de comunidades permanece en el helper TS compartido `finalizeCodebaseCommunities`. Preserva exactamente los desempates de `localeCompare` del host. Para el ranking de consultas, el host transmite el orden de IDs por locale una vez al cargar cada versión.

## Responsabilidades que conserva el IDE

`IFileService` sigue controlando selección, lectura, exclusiones, archivos virtuales/remotos, contenido sin guardar y persistencia. El motor recibe contenido, nunca instrucciones para abrir o escribir rutas del workspace. El filtro existente de secretos se aplica antes del envío. Monaco, edición, undo y UI conservan sus servicios nativos.

Los parsers especializados de notas, goals y diseños, su proyección y sus enlaces siguen en TS. Las evidencias de los language servers se combinan después de la extracción nativa y conservan prioridad. `treeSitter` aporta confianza 0,8 y evidencia no verificada; no inventa relaciones semánticas de llamadas.

El hash persistido continúa siendo exclusivamente un hash de contenido. El campo opcional `extractionMode` evita reutilizar resultados del parser anterior cuando cambia la opción, sin alterar los hashes referenciados por notas ni romper manifiestos anteriores.

## Estado, transporte y recuperación

Hay un proceso perezoso por runtime de workspace y una solicitud en vuelo por proceso. El transporte JSON por stdio lleva versión e identificador. La extracción admite hasta 40 archivos y 4 MiB de contenido por lote; cada frame está limitado a 16 MiB.

El grafo de archivos recibe únicamente payloads cambiados y eliminaciones después de su carga inicial. El snapshot canónico para consultas se prepara en el shared process y se envía por bloques de hasta aproximadamente 4 MiB al cambiar de versión o filtro de evidencia. Las consultas repetidas transmiten solo argumentos y resultados. **La actualización del snapshot consultable aún reemplaza la versión completa**; no es una actualización por arista. El renderer deja de preparar y recorrer esos índices para responder a estas consultas; el visor puede seguir solicitando un snapshot para dibujar el grafo.

Se acota a 128 MiB el tamaño JSON retenido de cada conjunto (payloads de archivos y staging de consultas), además de límites de cantidad. Esto no equivale a un techo de RSS: objetos, strings, mapas, parser e índices añaden memoria. El staging de consulta se libera al construir el índice. La caché sintáctica admite hasta 32 archivos, 8 MiB de texto y 250.000 nodos de árbol, con presupuestos de tiempo por archivo.

La cancelación detiene el proceso que está computando. Tras 30 segundos sin solicitudes se libera el proceso. Un cambio de época obliga a reenviar el estado; las consultas además verifican su versión. Se rechazan resultados parciales si el proceso cambia durante una carga del grafo. Descartar el servicio, borrar el índice o revocar confianza descarta el estado correspondiente.

Un binario ausente, timeout, respuesta inválida o fallo utiliza el motor TS existente con espera de 30 segundos antes de reintentar. La recuperación de consultas ocurre en el shared process y conserva un índice TS cacheado; no descarga el grafo al renderer. Ese índice se libera al recuperar el motor nativo. `nativeBatches`, `fallbackBatches` y `lastFailure` siguen disponibles para diagnóstico de extracción y transporte.

## Validación

- `cargo test --locked`: 12 pruebas Rust; también `cargo fmt --check` y clippy con `-D warnings`.
- `test-codebase-native.mjs`: 533 archivos × dos modos de providers, paridad ordenada, Unicode, hash, cancelación y fallos.
- `test-codebase-native-indexer.mjs`: indexador real, full/incremental, contenido sin guardar, exclusiones, secretos, borrado/recreación y prioridad del language server.
- `test-codebase-native-graph.mjs`: 107 casos de equivalencia de aliases, grupos, grados y metadatos; incluye ambigüedad, Unicode, hubs y 2.000 archivos.
- `test-codebase-native-query.mjs`: 2.680 consultas comparadas con TS; ranking, filtros, evidencia, notas reemplazadas, profundidad y pruebas del facade remoto sin cargar snapshots.
- `test-codebase-native-runtime.mjs`: cargas incrementales, borrado, interrupción durante carga, reinicios, versiones y fallback.
- `test-codebase-native-syntax.mjs`: cambios Unicode sobre archivos reales, reutilización comprobada de árboles, igualdad incremental/fresco, cambios de modo con hash intacto y prioridad semántica.
- `test-codebase-native-channel.mjs`: canal autenticado real, aliases canónicos, consultas cacheadas, nuevas versiones, fallback cacheado, cancelación, confianza y aislamiento entre workspaces.
- 84 pruebas existentes de memoria, imports, comunidades, notas, goals y regresiones de rendimiento.

Las pruebas nativas e integrales están incorporadas a `ci-openide.yml`. No se ejecutaron builds Windows/macOS en esta máquina.

## Mediciones y límites

Medición local posterior a la integración, tres pasadas calientes del grafo:

| Caso | TS | Rust residente | Rust con carga completa |
|---|---:|---:|---:|
| 26 archivos reales | 0,94 ms | 1,90 ms | 20,09 ms |
| 2.000 archivos con muchos aliases | 127,73 ms | 10,70 ms | 28,93 ms |

Incluye transporte donde se indica, sin persistencia ni trabajo del renderer. No mide indexación completa ni FPS. En el caso pequeño, TS sigue siendo más rápido.

En consultas sobre 301 nodos/470 aristas, cada grupo de 335 consultas tardó aproximadamente 16–32 ms con Rust y transporte frente a 8–25 ms con TS, según filtros y profundidad. La ventaja comprobada aquí es sacar ese cómputo del renderer y evitar trasladar/reconstruir el grafo para cada consulta; no se demuestra menor latencia general. Reporte: `.build/codebase-native/query-results.json`.

La extracción de 4.000 definiciones sintéticas estuvo alrededor de 83–120 ms nativa frente a 317–331 ms TS; las muestras pequeñas reales favorecieron TS. El algoritmo TS previo también tiene margen de optimización. Reporte: `.build/codebase-native/results.json`.

Tree-sitter todavía no cubre destructuring, todas las firmas de propiedades ni imports dinámicos/require. El código incompleto puede limitar lo que recupera el parser. La búsqueda textual del workspace ya utiliza ripgrep: duplicar ese motor no es el siguiente paso. Antes de trasladar persistencia o más servicios, medir indexación completa, p50/p95 y RSS/PSS de todos los procesos. La siguiente optimización concreta sería enviar deltas del snapshot canónico de consultas si su coste aparece en esos perfiles.

## Compilación y uso

`node dev/build-codebase-native.mjs` compila con Cargo.lock y copia el binario a `vscode/native/bin`. En NixOS: `./result-fhs/bin/openide-build -c 'node dev/build-codebase-native.mjs'`. `build_cli.sh` usa el mismo script con el target Rust de cada paquete y lo coloca en `resources/app/native/bin` (Contents/Resources/app en macOS), fuera de asar.

El binario y los módulos TS están compilados. Una instancia Dev que ya estaba abierta necesita **Developer: Reload Window** para cargar los cambios del servicio; el watcher CSS no actualiza esta lógica. La extracción sintáctica requiere habilitar explícitamente la opción experimental mencionada arriba.
