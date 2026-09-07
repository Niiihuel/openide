# Memoria canónica: rendimiento y recuperación

Implementación del 6 de septiembre de 2026. La fuente canónica sigue siendo Markdown; estas mejoras no dependen de Mem0.

## Lecturas coherentes

El owner nativo conserva documentos parseados por raíz y ruta. Cada acceso reconcilia nombres de archivos y metadatos (`dev`, `ino`, tamaño, `mtimeNs`, `ctimeNs`, modo y enlaces). La reconciliación no depende de eventos de filesystem que puedan llegar tarde o perderse. Las lecturas de metadatos se agrupan de a 32; sólo archivos nuevos o modificados vuelven a leerse, parsearse y hashearse.

Se conservan la detección de IDs duplicados, el rechazo de symlinks/hardlinks, la validación de ancestros, los límites de directorio/archivo, los dirty buffers y CAS de revisión/hash. Una lectura fallida no publica memoria vacía. Se devuelven copias para que un consumidor local no pueda modificar la caché. Cambiar raíces o desconectar invalida su generación. No se utiliza TTL como garantía de coherencia.

Con la fixture previa de 500 notas + 200 sesiones, caché de disco caliente y nueve muestras, la mediana de `list` pasó de 162,9 a 13,2 ms; `get`, de 191,4 a 11,9 ms; dos listas, de 337,5 a 21,5 ms. Estas cifras incluyen filesystem/validación/parseo/hash del owner, pero excluyen IPC, proveedor y proyección al grafo. Se midieron antes de agregar el historial de recibos descrito abajo; la fixture no contiene recibos históricos, por lo que no caracteriza notas con ese historial lleno. Resultados: `.build/performance-cli-implementation/memory-benchmark.json`.

## Colas y cancelación

La proyección Mem0 usa una cola por raíz distinta de la cola canónica. Una demora de red no impide leer, guardar o borrar Markdown. Antes de insertar remotamente se persiste la intención; al terminar una búsqueda se vuelven a comprobar estado activo y hash canónico, descartando resultados borrados o revisados durante la llamada. La eliminación remota conserva alcance por raíz/ID. Un fallo deja el manifiesto disponible para reintentar. El recibo de `forget` todavía puede esperar la limpieza remota; la cola canónica permanece libre.

El commit atómico comprueba la generación después de la IO asíncrona e inmediatamente antes de despachar `rename`/`link`. Si se revocó durante esa espera, no publica la escritura. Después de despachar un commit autorizado se conserva su recibo; cambiar de workspace no intenta revertirlo. Las pruebas bloquean la sincronización del archivo y cambian workspace, revocan raíces o desconectan el owner.

## Capturas durables por petición

Cada conversación tiene trabajos independientes en el perfil local, bajo `checkpoints/<hash de sesión>/<hash de ID>.json`. Cada envelope contiene ID, estado y fecha de creación, preservada al actualizarlo. La recuperación procesa pendientes/deferred por fecha; también reconoce el checkpoint anterior de archivo único. `checkpoint-list` devuelve los pendientes de esa conversación. Los estados guardados son `pending`, `deferred`, `saved` y `no_durable_change`.

La cola admite hasta 100 archivos por conversación. Al necesitar espacio, elimina un trabajo completado; nunca descarta pendientes para admitir otro. Si los 100 siguen pendientes, rechaza explícitamente la nueva persistencia. El estado tiene un máximo serializado de 32.768 bytes UTF-8, hasta tres candidatos, IDs de hasta 256 caracteres y watermark de hasta 128. Las lecturas de estado tienen además un límite de 40.000 bytes; la enumeración está limitada a 2.000 entradas, permitiendo ignorar temporales dejados por un cierre abrupto sin bloquear la recuperación normal.

`enqueue` resuelve después del recibo nativo. Los check/create concurrentes de una conversación se serializan. Cada drain intenta cada trabajo una vez; las fallas no producen un bucle ni bloquean las otras conversaciones. La revisión del drain detecta trabajos agregados durante su último escaneo. `resume` espera por defecto hasta 250 ms e informa pendiente tanto ante timeout como si quedan trabajos deferred. Reset/dispose cancela ejecución; los archivos durables permanecen recuperables.

## Idempotencia y compacción

Las notas incluyen `applied_operations`, con los últimos **300 IDs de operación** aplicados a esa nota. Se conservan al actualizarla. Antes de reintentar una captura se buscan sus recibos en registros activos y superseded, para evitar volver a agregar una observación si otro turno ya modificó después esa misma nota. Esto cubre la pérdida del recibo de finalización del checkpoint tras un guardado canónico exitoso. La garantía está acotada a los recibos retenidos: no se promete deduplicación eterna después de 300 operaciones posteriores ni si una edición manual borra la metadata. No se insertan marcadores ocultos en el cuerpo Markdown.

Cada ID admite hasta 256 caracteres. El historial está separado del presupuesto configurable de contenido de nota; el archivo completo conserva el límite duro de 128 KiB. Los recibos no se incorporan al texto de recall. Mantener hasta 300 IDs puede aumentar el tamaño en disco e IPC; las mediciones calientes anteriores no evalúan ese extremo.

Antes de compacción, una falla que impida reconocer una copia durable hace fallar la captura y preserva el historial sin compactar. Si existe una captura inline anterior aún diferida, el delta nuevo se persiste independientemente antes de intentar aquella, de modo que un nuevo error del proveedor no lo descarte. Los candidatos mal formados se rechazan antes de congelarlos en el estado: una extracción posterior puede corregirlos. Cancelar durante el listado canónico impide iniciar una nueva extracción.

## Validación

Las suites focalizadas usan el owner real, Markdown y perfiles temporales. Cubren edición externa conservando mtime, rename/delete, enlaces, duplicados, cambios entre ventanas, generaciones revocadas durante fsync, límites y reinicio de checkpoints, llamadas Mem0 bloqueadas, actualización/borrado concurrentes, recibos tras una revisión posterior, compacción fallida, cancelación, colas independientes y carreras al terminar el drain.

```bash
node vscode/node_modules/mocha/bin/mocha.js --ui tdd \
  vscode/out/vs/workbench/contrib/openideAgent/test/node/openideMemoryCheckpoint.test.js \
  vscode/out/vs/platform/openideAgentHost/test/node/openideMemoryOwner.test.js \
  vscode/out/vs/workbench/contrib/openideAgent/test/node/openideMemoryCaptureQueue.test.js
```

Se requiere `out` actualizado desde las fuentes. El resultado focalizado está en `.build/performance-cli-implementation/memory-review-tests.log`; el coordinador realiza typecheck y validación integrada de Electron por separado.
