# Componentes compartidos de los docks

Los docks usan los controles y listas nativos del workbench. La migración cambia tokens de pintura y variantes; conserva sus servicios, handlers, filas virtualizadas y medidas.

| Dock | Adaptación específica |
| --- | --- |
| Chat | Historial, pestañas, acciones de cabecera, estado vacío y relanzar CLI usan variantes compartidas. La sesión abre desde un botón principal y sus acciones son hermanas; Archivar con Enter no abre el chat. |
| Files, Open Editors, Outline y Timeline | Cabeceras de sección planas, separadores compartidos, filas y acciones con radios/hover comunes; conserva alturas virtualizadas, indentación y colapsado. |
| Search | Inputs de búsqueda/reemplazo e inclusión/exclusión con borde neutro compartido, cambio de borde en hover/foco y estados de validación nativos. |
| Source Control | Editor compuesto del commit con radio y borde de control, mensajes de validación unidos al borde inferior; cabeceras de repositorio sin sombra aislada. |
| Extensions | Buscador compuesto consistente; acciones existentes reciben variantes secondary/primary mediante variables, conservando botones divididos y disabled. |
| Run and Debug | Selector de configuración como control secundario unido al botón de ejecutar; radios de estados/valores compartidos, colores de debug intactos. |
| Terminal | Radios de controles y acciones consistentes; indicadores de entorno y guía de comandos toman colores del tema. ANSI, selección, cursor y métricas de xterm permanecen nativos. |

`openideWorkbench.css` y `openideSurfaceCss.ts` son propietarios del tratamiento común de listas, cabeceras, botones, inputs, hover y transiciones. Cada sección mantiene únicamente sus excepciones de estructura y roles; no se copian componentes del chat. Las variantes `oi-dock-row`, `oi-dock-action` y `oi-dock-section` se aplican a los elementos existentes; `openideSearchBoxStyles` adapta el InputBox nativo. Los widgets del workbench se conectan mediante selectores de rol, sin recorrer el DOM, crear wrappers ni agregar listeners por fila.

## Comprobación visual

Abrir cada dock en sidebar, panel y barra auxiliar, cuando permita moverlo. Revisar hover, foco por teclado, opciones deshabilitadas y tema claro/oscuro/alto contraste. Search debe permitir buscar/reemplazar y conservar sus toggles; SCM debe conservar mensajes de validación y las acciones de commit; Extensions debe mantener la separación correcta de instalar/menú; Debug debe conservar configuraciones y estados; Terminal debe permitir cambiar pestaña, seleccionar texto y abrir el indicador de entorno.

No se cambian alturas de filas ni se reserva espacio nuevo para scroll. Las pruebas de CSS sólo validan el parseo; el recorrido visual debe hacerse en el IDE de desarrollo.

## Evidencia local

El recorrido en Dev cubrió Files, Search, Source Control, Extensions y Run and Debug. Las cabeceras de Files, Outline y Timeline tienen radio y margen lateral cero, conservando sus alturas nativas; el título del dock conserva 35 px. Capturas y mediciones en `.build/visual-migration-live/docks-files-final.json` y `secondary-docks-final.json`. El cambio de foco y hover conserva los bordes de validación. Terminal tiene validación de CSS; su flujo interactivo se conserva en los widgets originales.

El historial se verificó en Dev sin modificar sesiones: fila sin borde/outline propio, radio compartido, sin overflow y navegación Tab hacia Archivar. Captura y resultado: `.build/visual-migration-live/dock-chat-sessions-final.json`. Pasaron 17 pruebas de navegador para historial, selector, scroll y ContextView; incluyen tres regresiones de teclado, restauración de foco y composición IME. Un smoke adicional verificó selección al hover, tokens independientes de cabecera y bordes de validación/alto contraste.

## Revisión de islas y conversaciones

La preferencia posterior del usuario sustituye el marco continuo por islas redondeadas con insets nativos y pestañas redondeadas; las secciones internas siguen planas. El título del dock ahora mide 32 px, acorde con ese modo. La evidencia anterior de 35 px corresponde al layout previo. El historial pasó a filas compactas por carpeta con preview nativo; ver `docs/conversation-history.md`. La comprobación final de esta revisión está en `.build/visual-migration-live/islands-final.json`.
