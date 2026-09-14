# Canvas de OpenIDE

Canvas permite crear y editar diseños estructurados, probar sus interacciones y entregarlos a Plan o GOAL. Conserva también los artefactos libres `.canvas.tsx` existentes.

## Crear y editar

Usá **+ → Canvas** en el chat o **Canvas: Create** en la paleta de comandos. Elegí Wireframe, Mobile app, UI mockup, Presentation, Document, Blank, Whiteboard, Animation o 3D scene. Podés indicar título, dispositivo y detalles; **Continue in chat** lleva la selección al composer conservando el borrador previo. Revisá el mensaje y envialo para que el agente genere el canvas. Seleccionar una opción no crea archivos ni inicia una ejecución. Si pedís un canvas directamente en el chat sin definir el formato, el agente consulta las opciones y te pide elegir antes de generarlo.

En el editor, **File & delivery** reúne importaciones, exportaciones, capturas y entregas a Plan/GOAL:

- **Screens:** abrí una pantalla, agregá otra o duplicá una variante. Eliminar una pantalla todavía referenciada por una interacción se rechaza; primero corregí sus conexiones.
- **Design:** seleccioná un elemento con clic o teclado. El inspector permite cambiar texto, color, tamaño, espaciado, ubicación, acción y destino; también agregar elementos y comentarios.
- **Project colors:** cambiá los tokens del diseño. Wireframe usa una representación neutra; Mockup aplica los colores del proyecto.
- **Undo / Redo:** deshacen y rehacen cambios completos. Un gesto del slider se guarda al terminar, sin cortar el movimiento.
- **Play:** probá navegación, volver, abrir/cerrar overlays, botones de estado y formularios locales. El formulario exige completar los campos antes de continuar. No envía datos a un servidor.
- **Viewport:** compará 390, 768 y 1100 píxeles. El prototipo puede desplazarse dentro del editor si el panel es más estrecho.

Los comentarios se guardan con el ID del elemento y la revisión en que se hicieron. Las variantes son pantallas independientes con nuevos IDs; no son ramas enlazadas ni un sistema de componentes compartidos.

## Archivos y conflictos

Cada diseño crea estos recursos:

```text
.openide/designs/<nombre-id>/
  design.json          # fuente editable: pantallas, nodos, tokens, historial
  DESIGN.md            # intención y brief, editable por la persona y la IA
  HANDOFF-rN.md        # entrega de una revisión concreta
  assets/              # copias locales de imágenes importadas
  export-rN.html       # HTML independiente
  export-rN.pdf        # PDF paginado
  export-rN.pptx       # PowerPoint editable
  export-rN.svg        # gráfico vectorial, con animación cuando corresponde
  export-rN.obj        # geometría 3D
  capture-rN.jpg       # captura del editor, cuando se solicita
```

`design.json` usa `schemaVersion: 1` y una revisión creciente. Guardar, deshacer y rehacer incrementan la revisión. Tanto el inspector como las herramientas del agente usan el mismo servicio, la misma validación y escrituras atómicas.

Un parche debe indicar `expectedRevision`. Si otra edición llegó antes, el parche se rechaza: hay que volver a inspeccionar el documento antes de proponer el siguiente cambio. El historial conserva hasta 30 estados por dirección. Límites: 50 pantallas, 500 nodos, 12 niveles de profundidad, 200 comentarios y 2 MB de documento e historial persistidos. El límite se comprueba también sobre los bytes que se escriben, para no generar archivos que el lector rechace después.

El archivo Markdown conserva la intención humana; el JSON conserva la estructura ejecutable. La entrega incluye ambos. Selección, viewport temporal y valores de formularios del prototipo no modifican el diseño.

## Herramientas del harness y de los CLIs

Las herramientas se publican por la conexión MCP existente con prefijo `openide_`. El contrato no depende de Claude Code, Codex ni de otra marca de CLI.

| Herramienta | Uso |
| --- | --- |
| `canvas_templates` | Plantillas y recorrido. `includeTsxGuide: true` incluye la guía incorporada para crear TSX. |
| `canvas_create` | Crear y abrir un diseño; devuelve recurso y revisión. |
| `canvas_inspect` | Leer nodos, pantallas y revisión sin enviar todo el historial. |
| `canvas_patch` | Editar con revisión esperada, o aplicar `undo` / `redo`. |
| `canvas_preview` | Abrir el editor y devolver su captura como imagen MCP. |
| `canvas_import` | Importar imagen, OBJ o tokens JSON de un archivo del workspace, con revisión esperada. |
| `canvas_export` | Exportar la revisión actual como `html`, `pdf`, `pptx`, `svg` u `obj`. |
| `canvas_handoff` | Preparar el brief Markdown para revisión e implementación. |
| `canvas_list/read/write/open` | Listado, lectura y apertura comunes; escritura del formato TSX libre. |

Las mutaciones externas pasan por el gestor de permisos nativo y respetan el modo de aprobación configurado. Cancelar una solicitud deniega la operación. La lectura de plantillas y diseños no solicita aprobación. La captura escribe un JPEG y también pasa por el permiso de escritura.

Ejemplo de edición después de `canvas_inspect`:

```json
{
  "path": ".openide/designs/checkout-ab12cd34/design.json",
  "expectedRevision": 3,
  "operations": [
    { "type": "setNode", "id": "heading", "text": "Confirmá tu pedido" },
    { "type": "setNode", "id": "continue", "action": "submit", "target": "detail" },
    { "type": "comment", "id": "heading", "text": "Usar el componente de título del proyecto." }
  ]
}
```

El catálogo de capacidades describe intenciones de diseño para facilitar que la IA encuentre estas herramientas desde un pedido natural. La elección efectiva de herramientas también depende del modelo y de las capacidades MCP del CLI conectado.

## Plan, GOAL y verificación

**Prepare Plan** crea un plan editable a partir de la revisión actual. **Create GOAL** abre el flujo existente de objetivo, criterios y límite de turnos; no marca nada como cumplido por generar una imagen. El brief identifica pantallas, interacciones, tokens, comentarios y la fuente del diseño.

La implementación debe comprobarse después en el código y el navegador del proyecto. El brief pide vincular archivos y evidencias en Plan/GOAL y guardar las decisiones duraderas en memoria. Esa instrucción no equivale a haber verificado ya la aplicación. Project Map indexa el diseño actual y sus pantallas, relaciona los destinos del prototipo y enlaza el campo **Implementation file** de cada elemento con un archivo del workspace. No indexa el historial ni las imágenes. Es una proyección del documento: una relación con código no demuestra por sí sola que ese código implemente el diseño.

## Compatibilidad TSX

Los `.openide/canvases/*.canvas.tsx` siguen usando el renderer JSX propio y el SDK `openide/canvas`; no son aplicaciones React completas. Se validan la sintaxis y los imports mediante el AST de TypeScript, incluyendo aliases y exports conocidos. No se presenta esa validación como un chequeo semántico completo ni como una prueba de interacción.

El renderer conserva la identidad de los controles al actualizarse. `useCanvasState` agrupa escrituras y muestra guardado, error y reintento; el estado vive en el archivo `.canvas.data.json` adyacente y se recupera al reiniciar. Las recargas antiguas se descartan y los errores de ejecución se muestran en el Canvas. El webview mantiene una política sin red ni imports externos.

## Validación de esta integración

- Pruebas unitarias del modelo, concurrencia con archivos reales, validación de imports, exposición externa y catálogo del chat.
- Pruebas del runtime en Electron.
- `dev/test-canvas-design-runtime.mjs`: IDE real con workspace temporal en Xvfb; galería, inspector, gesto del slider, undo/redo, comentarios, variantes, formulario, viewports, HTML ejecutado en otro proceso sin conexión, captura, entrega a Plan y apertura del flujo GOAL.
- El mismo test llama al MCP real del IDE desde un cliente Node externo: inventario, lectura, rechazo sin escritura, aprobación, creación y captura devuelta como imagen.
- TSX: escritura continua con foco/cursor, selector, slider, confirmación del guardado, cambios de pestaña durante el guardado pendiente, fallo de escritura con reintento, recarga del archivo y cierre/reinicio completo del IDE con recuperación de estado.

Esta validación de MCP no es una evaluación de selección autónoma de herramientas con modelos de todas las marcas. Tampoco incluye publicación o reemplazo de la AppImage instalada.

## Pizarra, animación y 3D

**Whiteboard** permite colocar texto, formas, imágenes y trazos libres en una superficie de 1100 × 700. Usá **Draw** para dibujar y **Select** para volver a seleccionar. Arrastrá elementos y ajustá posición, dimensiones y rotación desde el inspector. El zoom va de 50 a 200%; la superficie se recorre con las barras de desplazamiento. Cada trazo admite hasta 2000 puntos; los gestos se guardan como una única edición deshacible.

**Animation** agrega duración, reproducción, pausa y control de tiempo. Seleccioná un elemento y guardá keyframes de posición, rotación, escala y opacidad. La interpolación es lineal. La duración admite 0,1–60 segundos y cada elemento hasta 120 keyframes; acortar por debajo del último keyframe se rechaza. La reproducción está limitada a 30 actualizaciones por segundo y se detiene al ocultar la vista. Se respeta la preferencia de movimiento reducido. HTML y SVG conservan la animación; PDF y PPTX son entregas estáticas.

**3D scene** permite crear cajas, esferas y cilindros, orbitar la vista arrastrando y editar posición, rotación y escala XYZ. Un archivo OBJ agrega una malla editable mediante esas transformaciones. La geometría se proyecta con un renderer SVG local, sin descargar librerías ni activar recursos 3D al iniciar el IDE. Los límites son 30 objetos, 12 000 triángulos por documento y 5000 vértices/triángulos por malla importada. OBJ conserva geometría y transformaciones; no incluye materiales, texturas, esqueletos ni animación 3D. PDF y PPTX guardan la vista de entrega con cámara predeterminada; la órbita temporal del editor no modifica el documento.

## Assets y sistemas de diseño

**Import Image** copia PNG, JPEG o SVG pasivo a `assets/`. Los imports desde un CLI deben apuntar a archivos del workspace; el selector del IDE también permite elegir archivos externos. El SVG aceptado contiene geometría y texto sin scripts, referencias, entidades, imágenes enlazadas ni estilos activos. Las imágenes raster tienen un presupuesto de 16 megapíxeles. Límites adicionales: 5 MB por archivo, 50 imágenes y 20 MB de assets referenciados por el documento. El historial puede conservar referencias de imágenes retiradas al deshacer.

**Import Tokens** lee JSON de DTCG, colores de Tokens Studio o una paleta de colores hexadecimales con nombre. Resuelve aliases y admite colores opacos sRGB, nombres de fuentes instaladas, tamaño/espaciado/radio en píxeles y altura de línea numérica. Los roles `background`, `surface`, `text` y `accent` actualizan los colores usados por el documento. Otros colores quedan disponibles en el inspector. El sistema se importa como una copia local deshacible; no es una sincronización con Figma ni carga fuentes remotas. Las dimensiones y colores compatibles se validan antes de cambiar el diseño. Referencia del formato: [Design Tokens Community Group](https://www.designtokens.org/tr/drafts/format/).

Las imágenes viajan embebidas en las exportaciones HTML/SVG. Los cambios se aplican con el mismo control de revisión que una edición manual, y un import fallido no deja nodos a medio crear.

## Exportaciones

| Formato | Contenido y alcance |
| --- | --- |
| HTML | Documento autónomo con navegación, formularios locales, imágenes y movimiento. |
| PDF | Una página por pantalla, renderizada por Electron; texto seleccionable y gráficos. |
| PPTX | Una diapositiva por pantalla. Texto y formas editables; imágenes, trazos y vistas 3D se incorporan como imágenes. La disposición se adapta al formato fijo de la diapositiva. |
| SVG | Geometría, texto e imágenes embebidas. Keyframes convertidos en animaciones SVG. El layout de documentos de flujo se aproxima; HTML/PDF conservan el layout del renderer. |
| OBJ | Mallas trianguladas con sus transformaciones aplicadas. Requiere geometría 3D en el documento. |

La exportación nativa usa una ventana oculta y aislada, sin Node, red ni permisos del host. Tiene un límite de 30 segundos y 30 MB de salida, admite hasta 50 páginas de hasta 4000 × 8000 píxeles y rechaza exportaciones nativas simultáneas. Si el documento cambia durante la generación, se exige exportar de nuevo. El exportador y la compresión se cargan bajo demanda. API utilizada: [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents).

La plantilla Presentation admite tanto HTML interactivo como PPTX. No incluye exportación de vídeo, GLB, edición de vértices, importación completa de proyectos Figma ni todas las categorías de tokens de DTCG. Esos formatos no se muestran como opciones disponibles.

## Pruebas de las ampliaciones

Validación local: 62 pruebas automatizadas de modelo, servicio, exposición y catálogo; `typecheck-client` y `valid-layers-check` aprobados.

`dev/test-canvas-advanced-runtime.mjs` ejecuta el IDE en Xvfb y comprueba trazos, arrastre, undo/redo, importación de imágenes/tokens mediante MCP, edición de keyframes, reproducción, órbita, cambio de primitivas, roundtrip OBJ y exportaciones reales HTML/SVG/PDF/PPTX. Guarda capturas y métricas del proceso en `.build/canvas-advanced-runtime/`.

Las pruebas de modelo y servicio cubren aliases, ciclos, geometría inválida, presupuestos, importaciones fuera del workspace, revisiones desactualizadas, persistencia de imágenes y proyección de Project Map. Los PDF se inspeccionan con un lector independiente y se renderizan para revisión; los PPTX se verifican como paquetes OOXML y se abren con un lector de presentaciones. La compatibilidad visual exacta puede variar entre lectores de PowerPoint.

