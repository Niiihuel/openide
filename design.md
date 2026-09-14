# OpenIDE — propuesta de sistema visual

**Estado: dirección visual aprobada; migración de producción pendiente.** Fecha: 8 de septiembre de 2026.

Este documento define la migración visual de OpenIDE al lenguaje de la aplicación de escritorio Codex mostrado en las referencias del usuario. El 8 de septiembre de 2026 el usuario aprobó la dirección visual, solicitando cerrar los ajustes de tooltip y scroll e integrar el análisis del PDF de arquitectura. La dirección aprobada ya se integra en el workbench nativo; las secciones de prototipo conservan su historial de validación y la sección 17 describe producción.

## 1. Resultado buscado

Una interfaz neutra, de baja saturación, con navegación oscura, contenido abierto, grupos de ajustes suaves y menús compactos. Mantener el nombre, la identidad y las funciones de OpenIDE. Reproducir fielmente el lenguaje visual observado, con implementación propia; no se ha copiado código ni recursos privados de Codex.

El alcance de la futura migración es toda la estructura visual controlada por OpenIDE: ventana, navegación, ajustes, conversación, compositor, menús, herramientas, GOAL, subagentes, terminales, diálogos, editor, mapa, planes, Canvas y novedades. Incluye los estados y las interacciones, no solamente colores.

El prototipo contiene cinco vistas:

| Vista | Propósito | Relación con la referencia |
| --- | --- | --- |
| Ajustes | Navegación lateral, grupos, filas, descripciones y controles | Reproducción de la composición de la captura de General |
| Conversación | Cabecera, mensajes, compositor, contexto y actividad | Reproducción del lenguaje de la captura de conversación |
| Componentes | Probar controles, menús, estados, actividad y novedades | Catálogo para aprobar las reglas compartidas |
| Editor | Pestañas, código, terminal y conversación lateral | Adaptación propuesta: esta disposición no aparece en las capturas |
| Movimiento | Shimmer, secuencia de tareas, desplegable, selector del ZIP y Build | Segunda revisión solicitada por el usuario |

## 2. Evidencia y grado de certeza

Se intentó acceder a la aplicación nativa mediante la herramienta de interacción disponible. Esta sesión solamente expone el navegador integrado; no ofrece la ventana nativa de Codex. Por eso la referencia efectiva son las cinco imágenes aportadas. No se ha inspeccionado su DOM, CSS interno, fuente instalada ni comportamiento nativo.

| ID | Archivo aportado | Evidencia |
| --- | --- | --- |
| S1 | `codex-clipboard-920cbd16-04d8-4ec6-b9cf-2fa38a058bb9.png` | Shell, conversación, selección lateral, tooltip, entorno y compositor |
| S2 | `codex-clipboard-28a5321b-5c30-459d-b26e-4d8b35853084.png` | Ajustes: navegación, grupos, toggles, selects y espaciado |
| S3 | `codex-clipboard-c95a20c3-e215-4b66-b654-3934bc001eee.png` | Menú Añadir, hover de fila, adjuntos y compositor |
| S4 | `codex-clipboard-dfcb92ac-6742-459a-ad17-479752fcd0e8.png` | Popover de esfuerzo, slider azul, thumb blanco y reset |
| S5 | `codex-clipboard-888c7101-bd8b-4a05-b178-3cac14a5b74f.png` | Menú de permisos con descripciones, selección y disparador |

S1 y S2 tienen 2824 × 1660 píxeles originales. Los colores principales se obtuvieron del histograma de píxeles de esas imágenes. Las dimensiones CSS, fuente, duración de transiciones y comportamiento de teclado son **estimaciones o decisiones de implementación**, no mediciones del código de Codex. No se conoce la relación exacta entre píxel físico, zoom y escala del escritorio de las capturas.

Se excluyen el contorno naranja del sistema operativo, los rectángulos rojos de anotación, el cursor y los subrayados del corrector. Tampoco se trasladan los nombres personales, proyectos privados, textos de conversaciones ni marcas de modelos como requisitos de producto.

No hay referencia de tema claro, alto contraste, menús contextuales del editor o pantallas de error de Codex. Las reglas de esas superficies serán adaptaciones explícitas, sujetas a revisión.

## 3. Principios

1. **Jerarquía por superficies y espacio.** La navegación es más oscura que el contenido; los grupos y overlays están por encima. Evitar una tarjeta alrededor de cada elemento.
2. **Color con propósito.** Ámbar de OpenIDE para Build y ejecución de planes; blanco para acciones principales neutras, azul para enlaces y controles seleccionados. Estados de error, éxito y diff conservan significado propio.
3. **Controles tranquilos en reposo.** Los iconos no tienen una tarjeta permanente detrás. El hover aparece solo dentro de su área interactiva.
4. **Consistencia entre tecnologías.** El workbench, componentes nativos, widgets Monaco y webviews deben consumir los mismos roles visuales.
5. **Densidad según tarea.** Conversación y ajustes tienen más aire; árboles, tablas, código y terminal mantienen densidad útil.
6. **Accesibilidad y rendimiento conservados.** Un cambio visual no debe romper foco, navegación, lectura asistida, virtualización o medición de terminales.

La guía existente `vscode/.github/skills/design-philosophy/SKILL.md` orienta la consistencia y el uso de tokens. Sus radios genéricos pequeños se reemplazan en esta propuesta por radios según función para satisfacer la referencia solicitada. No se propone redondear todo el IDE con el mismo valor.

## 4. Tokens de color

Los nombres del prototipo representan roles; antes de migrar deben reconciliarse con los nombres ya existentes. No introducir un segundo sistema permanente de variables.

| Rol | Valor oscuro propuesto | Evidencia / uso |
| --- | --- | --- |
| Shell / lateral | `#141414` | Medido S1/S2; barra superior, lateral y pie |
| Contenido | `#181818` | Medido S1/S2; fondo principal |
| Grupo | `#232323` | Medido S2; grupos de ajustes |
| Control / compositor | `#2a2a2a` | Medido S1/S3/S5 |
| Popover | `#2d2d2d` | Medido S1/S3/S5 |
| Hover de menú | `#3d3d3d` | Medido S3; no aplicar a toda fila de ajustes |
| Selección lateral | `#262626` | Observado S1/S2 |
| Borde estructural | `#353535` | Estimación para separar superficies cercanas |
| Borde overlay | `#464646` | Estimación acorde a S3/S5 |
| Divisor | `#303030` | Estimación; líneas interiores discretas |
| Texto principal | `#ededed` | Aproximación visual |
| Texto secundario | `#a1a1a1` | Aproximación; descripciones legibles |
| Texto decorativo / inactivo | `#777777` | Aproximación; no usar para instrucciones esenciales |
| Acento | `#3a83f7` | Medido S4; slider, enlaces, foco |
| Switch activo | `#315f9f` | Aproximación de S2; distinto del slider |
| Acción primaria | `#f4f4f4` sobre texto `#151515` | Aproximación de S3/S5 |
| Éxito / inserción | `#32aa7a` | Adaptación semántica |
| Error / eliminación | `#ec6565` | Adaptación semántica |

El hover depende del contexto: lateral `#262626`, opciones de menú `#3d3d3d`, controles elevados con incremento discreto de luminancia. Una fila de ajustes no se vuelve clicable por contener un switch.

El preset oscuro reproduce estas superficies. Los temas personalizados deben conservar una correspondencia semántica mediante los tokens de tema de VS Code. No fijar estos hexadecimales globalmente para todos los temas. Los colores de sintaxis, ANSI y contenidos diseñados por el usuario no forman parte del recoloreado del shell.

## 5. Geometría y tipografía

Valores iniciales para revisar a zoom 100%; son estimaciones normalizadas, no dimensiones internas verificadas de Codex.

| Familia | Valores propuestos |
| --- | --- |
| Espaciado | 4, 8, 12, 16, 20, 24, 32, 48 px; microajustes de 2 px para iconos |
| Radio control | 9 px: botones, campos y pestañas compactas |
| Radio fila | 12 px: navegación; opción enriquecida 13 px |
| Radio grupo | 18 px: ajustes y mensaje del usuario |
| Radio popover | 14 px (revisión 2); diálogo y panel de contexto 24 px |
| Radio compositor | 24 px; no aplicarlo a cada hijo |
| Pill / círculo | 999 px: selector de permisos, fila Añadir, switch, botón Enviar |
| Bordes | 1 px; foco de teclado 2 px con separación de 2 px |
| Sidebar | 280 px a 1440 px de viewport; 230 px bajo 1100 px |
| Barra de ventana / cabecera | 36 px / 47 px |
| Contenido de ajustes | Máximo 784 px, centrado; margen superior 108 px bajo barra |
| Fila lateral | 32 px de alto mínimo; icono 18 px; separación 10 px |
| Fila de ajustes | 62 px mínimo, crece con texto; padding vertical 13 px |
| Menú simple / enriquecido | 28 px / 46 px mínimo, 2 px entre opciones |
| Botón / icono | 29 px mínimo / área de icono 30 × 30 px |
| Texto | UI 14 px; secundario 13 px; metadatos 12 px; título 25 px, peso 500 |
| Conversación | Texto 15 px, interlineado 1.7; entrada 15 px, interlineado 1.5 |
| Iconos | Trazo 1.6 px de referencia, tamaños 14/16/18/20; misma biblioteca del IDE |
| Sombra overlay | `0 8px 28px #0003`; no sombra en todos los grupos |
| Movimiento | Interacción 120 ms; overlay 180/120 ms; morph 260 ms; tooltip 110/120 ms tras demora de 450 ms; spring 380 ms solo en slider |

El prototipo usa Arial/Helvetica/sans-serif como aproximación. La fuente exacta de Codex no está confirmada. La migración debe usar una pila multiplataforma compatible con la fuente de interfaz configurada y validar métricas en Linux, Windows y macOS. No descargar ni empaquetar una fuente suponiendo que es la original.

## 6. Contratos por componente

### 6.1 Shell y navegación

Cada dock es una isla redondeada con borde de 1 px y márgenes del layout nativo. Las secciones internas pertenecen a esa misma isla, sin una tarjeta adicional por sección. Etiquetas secundarias sin mayúsculas forzadas. Separar filas adyacentes por 4 px, incluyendo la combinación selección + hover de la captura de feedback. Selección con fondo neutro, texto principal e indicador accesible; no usar acento azul en cada fila.

Acciones de una tarea aparecen en hover y foco dentro de la fila. En producción deben ser botones independientes, con nombre accesible y sin anidar botones. La maqueta usa iconos decorativos de pin/archivo para mostrar la composición: no demuestra su funcionalidad.

La barra de revisión con cuatro vistas pertenece al prototipo, no al producto final. Los botones de ventana son una representación; las decoraciones del sistema operativo no se simulan como controles reales.

### 6.2 Ajustes

Navegación a la izquierda; contenido centrado con ancho máximo. Título separado de las secciones. Cada grupo reúne varias filas bajo un solo borde y radio. Separadores interiores no alcanzan el borde externo: respetan padding lateral de 16 px.

Texto a la izquierda, control a la derecha, sin etiquetas en mayúsculas ni excesivo peso tipográfico. Las descripciones pueden ocupar varias líneas. Los controles nunca se superponen al texto; en espacios estrechos pasan a una segunda línea. Los cambios reales conservan validación, alcance usuario/proyecto, persistencia y comportamiento existentes.

La búsqueda debe encontrar ajustes de todo el catálogo en producción, con navegación al resultado. La muestra solamente filtra las filas de la categoría visible; otras categorías son ejemplos representativos, no una implementación de todos los ajustes.

### 6.3 Compositor y adjuntos

Una superficie continua, borde discreto, radio 24 px y padding 14 px. Entrada sin borde interno. Acciones alineadas abajo: Añadir y permisos a la izquierda; modelo/esfuerzo, voz y Enviar a la derecha. Enviar es circular blanco. La entrada puede crecer sin desplazar el texto que el usuario está editando.

Adjuntos con miniatura, radio 18 px y quitar circular. No mostrar rutas privadas innecesarias. Plan y GOAL conservan sus estados reales; no representar una función como activa solo por cambiar un estilo. Foco visible del contenedor por teclado, sin un doble marco alrededor de cada línea de la entrada.

### 6.4 Popovers, menús y tooltip

| Componente | Regla |
| --- | --- |
| Añadir | 360 px de ancho máximo, limitado al viewport; grupos compactos; filas con radio 8 px y descripciones breves |
| Permisos | Ancho 360 px; opciones enriquecidas de 46 px mínimo; check al final; cambiar apariencia no cambia autorización |
| Esfuerzo | Selector compacto de 260 px del ZIP: resumen y vista avanzada, arrastre magnético y snap, partículas y transición azul/violeta. Los niveles reales dependerán del modelo |
| Modelo | Opciones legibles, selección con check; nombres de la maqueta son ejemplos, no una lista de soporte |
| Tooltip | Demora corta, ancho acotado, texto y contexto; no reemplaza un nombre accesible |
| Menú contextual | Mismo vocabulario visual, densidad adaptada a comandos del editor |

Los overlays usan el servicio de contexto existente, en una capa superior a paneles y webviews cuando sea técnicamente posible. Se posicionan respecto del ancla; separador de 8 px; se invierten arriba/abajo y se limitan a 12 px del viewport. Contenido largo tiene scroll propio. No quedan recortados por `overflow:hidden` del chat.

Escape cierra y devuelve foco al disparador. Click exterior cierra. Flechas, Home/End y Enter recorren/activan opciones. Tab no queda atrapado en un menú no modal. El slider conserva flechas nativas y texto accesible del valor. `aria-expanded`, relación con el ancla y roles de selección deben reflejar el estado real. Un diálogo modal sí requiere contención de foco y retorno al cerrar.

En el prototipo se usan portales al body y un diálogo HTML nativo. En producción no duplicar la infraestructura de `IContextViewService` o los widgets accesibles existentes para conseguir la apariencia.

### 6.5 Botones, campos y estados

| Estado | Presentación y comportamiento |
| --- | --- |
| Reposo | Fondo por rol; iconos secundarios transparentes; borde discreto en campos |
| Hover | Cambio de superficie local; no cambia tamaño, padding o ancho de borde |
| Foco de teclado | Anillo visible, sin depender del hover; nombres accesibles |
| Presionado | Superficie ligeramente más clara, sin desplazamiento físico |
| Seleccionado | Fondo neutro y check/estado semántico; azul reservado a controles que lo usan |
| Deshabilitado | Contraste reducido y semántica disabled; no ejecuta acciones |
| Solo lectura | Texto legible y seleccionable; distinto de disabled |
| Cargando | Texto de estado y señal pequeña; evitar bloquear todo el panel |
| Error | Borde/indicador semántico, mensaje asociado y recuperación; no solamente color |
| Éxito | Confirmación breve; evitar toasts para cada toggle sin necesidad |
| Destructivo | Nombre explícito; confirmación según comportamiento existente, sin inventar permisos nuevos |

Build mantiene el ámbar `#eeb266`, hover `#f3c07e` de `vscode/extensions/theme-defaults/themes/openide-dark.json`. El split tiene 28 px de altura, borde de 1 px, radio 8 px, divisoria interior y atajo. Los botones secundarios de planes usan borde visible de 1 px y radio 9 px, sin repetir el ámbar en cada acción.

La muestra permite vaciar el nombre del proyecto para revisar validación. Incluye controles nativos checkbox/radio y campo numérico: en producción deben adaptarse mediante los componentes existentes para consistencia multiplataforma. No se reclama equivalencia visual de los controles nativos en todos los sistemas.

### 6.6 Agentes, GOAL y terminales

Actividad en filas compactas, icono, título, estado y acción secundaria. **Pausa/reanudar: icono transparente en reposo y hover simple**, sin tarjeta heredada, borde permanente ni sombra. El área clicable y foco no se eliminan.

GOAL mantiene objetivo, progreso, informes y acceso a cambios; no se convierte en un bloque decorativo. Terminal conserva estado vivo/salida/finalización, scroll y acciones. Los resultados de herramientas extensos pueden expandirse bajo un grupo discreto. Código y logs se mantienen monoespaciados. El estilo no modifica ownership del PTY ni el ciclo de ejecución del harness.

### 6.7 Editor, documentos y novedades

Pestañas y breadcrumbs adaptados a los mismos tonos, pero con densidad de editor. Mantener indicadores de modificado, errores, rama, modo y terminal activa. Divisores claros entre editor, chat y panel inferior. No eliminar affordances de resize ni de arrastre.

Plan, mapas, diagramas y Canvas reciben la nueva apariencia en sus barras, inspectores y selectores. **El artefacto del usuario conserva sus propios colores, tipografía y diseño.** Una exportación PDF/PPTX/HTML no debe heredar accidentalmente el tema del IDE.

Las novedades usan título breve, texto secundario, CTA y descarte. La muestra incluye una tarjeta representativa; publicación, versionado y persistencia del descarte conservan el sistema real existente. No sustituir información de una actualización por contenido fijo de demostración.

## 7. Mapa de migración del repositorio

Rutas relativas a la raíz. Deben verificarse nuevamente al empezar cada fase porque el árbol tiene trabajo en desarrollo.

| Superficie | Punto de integración | Trabajo necesario |
| --- | --- | --- |
| Tokens y componentes compartidos | `vscode/src/vs/workbench/contrib/openideAgent/browser/openideSurfaceCss.ts` | Roles de superficie, radios y densidad; aliases compatibles |
| Widgets con estilos inline | `…/openideAgent/browser/openideControlStyles.ts`, `openideSurfaceStyle.ts` | Adaptadores de InputBox, SelectBox, Toggle y Checkbox |
| Ajustes | `…/openideSettings/browser/media/openideSettings.css`, `openideSettingsToggle.css`, `openideSettingsDropdown.css`, `openideSettingsIcons.css` | Grupos, navegación, jerarquía y controles |
| Estructura de ajustes | `…/openideSettings/browser/openideSettingsEditor.ts`, `openideSettingsSectionBuilder.ts`, `openideSettingsControls.ts` | Cambios DOM puntuales donde CSS no basta; preservar búsqueda y persistencia |
| Chat y compositor | `…/openideAgent/browser/chat/media/openideChatNative.css`, `openideChatComposer.css`, `openideChatHeader.css`, `openideChatHistory.css` | Shell, burbujas, entrada, historial |
| Menús | `…/openideAgent/browser/chat/media/openideChatMenus.css` y constructores de menús | Portales, tamaños, estados y anchoring |
| Actividad | `…/openideAgent/browser/chat/media/` archivos de Subagent, Goal, Terminal, Plan, Todos, Questions y Confirmation | Reducir cajas; consolidar estados y botones |
| Diálogos | `…/openideDialogs/browser/media/openideDialog.css` | Grupos, acciones y espaciado |
| Workbench | `vscode/src/vs/workbench/browser/parts/` sidebar, panel, statusbar, editor, views | Chrome, pestañas, árboles y divisores |
| Widgets base | `vscode/src/vs/base/browser/ui/` contextview, hover, inputbox, selectBox, toggle, dialog, menu | Preferir tokens/adaptadores; revisar impacto global antes de modificar bases |
| Mapas y planes | `…/openideAgent/browser/projectMap/media/openideProjectMap.css`, `plan/media/openidePlan.css`, `diagrams/media/openideDiagrams.css` | Barras, inspector, menús y estados vacíos |
| Diffs y cambios | `…/openideAgent/browser/media/openideDiff.css`, `openideEditorWidgets.css`, `openideCliChanges.css` | Cabeceras, listas y acciones; conservar semántica diff |
| Canvas / diseño | `…/openideAgent/browser/openideCanvasHtml.ts`, `openideDesignHtml.ts` | Puente de tokens del chrome; aislar contenido del artefacto |
| Bienvenida | `…/welcomeGettingStarted/browser/media/openideWelcome.css` | Acciones, tarjetas y novedades |

`…` en la tabla significa `vscode/src/vs/workbench/contrib`. La lista cubre familias principales, no sustituye un inventario de todos los selectores antes de editar.

### Arquitectura propuesta

- Mantener una fuente de verdad en `OPENIDE_SURFACE_CSS`, aplicada a `:root` y `.monaco-workbench`, y transportada a webviews mediante el mecanismo existente.
- Definir roles de radio: control, fila, grupo, overlay, compositor. Mantener aliases antiguos durante la migración; retirar cada alias solo después de migrar sus consumidores.
- Resolver tema → tokens OpenIDE → componentes. Revisar `--vscode-openide-islandBackground`, `--vscode-*`, contrastes y variantes. No imponer un reset global sobre todos los botones de Monaco o extensiones.
- Cambiar los estilos inline desde el adaptador TypeScript. Una cascada de `!important` no resuelve de forma mantenible ese origen.
- Estilar overlays por su clase propia: los menús de `IContextViewService` viven fuera del subárbol del chat.
- Separar capas: chrome del IDE, widget, contenido del usuario. En particular, el iframe de Canvas no debe recibir una recoloración del documento generado.
- Los webviews de terceros solo admiten los tokens que consumen. No prometer uniformidad total del contenido que controla una extensión o de diálogos del sistema operativo.
- Evitar animar altura/ancho de paneles durante streaming o gestos. Los radios y sombras no deben invalidar mediciones de Monaco o xterm.

## 8. Secuencia de implementación después de aprobar

| Fase | Entrega | Criterio de cierre |
| --- | --- | --- |
| 0. Aprobación | Ajustes a esta muestra y decisiones registradas | Usuario aprueba geometría, jerarquía y comportamiento visual |
| 1. Inventario y baseline | Capturas de la versión actual, mapa de consumidores y estrategia reversible | No hay superficies sin propietario ni cambios de comportamiento mezclados |
| 2. Fundaciones | Tokens, preset oscuro, adaptadores de controles y shell | Temas y foco funcionan; sin sobrescrituras globales indiscriminadas |
| 3. Ajustes | Navegación, grupos, búsqueda y controles | Preferencias reales persisten; búsqueda y teclado conservados |
| 4. Conversación | Compositor, adjuntos, menús, tooltip, contexto | No se pierde entrada/foco; overlays accesibles y sin recorte |
| 5. Actividad | Subagentes, GOAL, terminales y resultados de herramientas | Estados reales distinguibles; pausa/reanudar y output sin regresiones |
| 6. Resto del IDE | Editor, diff, mapas, Canvas, bienvenida, diálogos y novedades | Mismo lenguaje, límites de contenido respetados |
| 7. Verificación | Matriz visual, accesibilidad y rendimiento | Sin regresiones funcionales; revisión final con el usuario |

Realizar cambios por familias, con commits revisables y reversión por fase. Evaluar un preset/flag temporal si hace falta comparar los dos estilos durante desarrollo. No añadir un modo paralelo permanente ni una dependencia de UI nueva solo para esta migración.

## 9. Matriz de aceptación

### Visual

- Comparar a tamaño nativo capturas del mismo viewport, sin confundir escala del escritorio con CSS.
- Revisar 1440 × 900, 1920 × 1080, 1280 × 800 y ventana baja de 800 × 480; revisar zoom 100%, 125%, 150% y 200% y pantallas HiDPI.
- Ajustes: ancho máximo, alineación derecha, descripciones largas, grupos y scroll.
- Menús: reposo, hover, selección, foco, scroll, apertura cerca de cada borde y superposición con terminal/webview.
- Conversación: sin adjuntos, varios adjuntos, entrada multilínea, streaming, mensajes largos, error y estado vacío.
- Actividad: activo, pausado, esperando permiso, terminado, fallido y sin tareas.
- Editor: una/dos columnas, panel inferior, tabs largas, diff, breadcrumbs, menú contextual y árbol profundo.
- No afirmar fidelidad pixel-perfect hasta comprobar fuente, escala y referencias adicionales.

### Accesibilidad y comportamiento

- Tab/Shift+Tab, flechas, Enter, Escape; foco visible y devolución al disparador.
- Roles, nombres, descripciones y estados accesibles; lector de pantalla no cambia de modo accidentalmente.
- Contraste de texto normal mínimo 4.5:1; controles y foco esenciales 3:1, usando los colores realmente compuestos. El gris decorativo no se usa como texto obligatorio.
- Alto contraste y movimiento reducido; no depender solo de color.
- Búsqueda y modificación de preferencias reales; selector de esfuerzo ajustado a capacidades del modelo.
- Deshacer/rehacer y persistencia de Canvas intactos; memoria, CLIs, GOAL, PTY y permisos sin cambios semánticos.

### Rendimiento

- Comparar baseline con la misma carga y hardware: apertura de menú/ajustes, streaming largo, lista virtualizada, redimensionado, terminal con salida y Canvas con interacción.
- Sin reconstruir árboles completos por hover, sin efectos de blur sobre toda la ventana, sin sombras animadas ni observadores globales de alta frecuencia.
- Cambios de altura se notifican por las rutas existentes de layout; no romper scroll anclado ni medidas de terminal.
- No declarar mejoras de rendimiento sin mediciones. La maqueta no es un benchmark del IDE.

## 10. Prototipo y límites de la entrega actual

Archivos: `docs/design/codex-visual/index.html`, `tokens.css`, `preview.js`, `motion.js`, `selector-adapter.js`, `vendor/` y `README.md`. HTML/CSS/JavaScript sin instalación de paquetes, APIs externas ni conexiones con modelos. Incluye una dependencia vendorizada local, con su licencia, y adaptadores propios. No importa CSS del producto ni escribe configuración del IDE.

Se puede abrir `index.html` directamente o servir esa carpeta:

```bash
python3 -m http.server 4387 --bind 127.0.0.1 --directory docs/design/codex-visual
```

Abrir `http://127.0.0.1:4387`. Detener con Ctrl+C. Si el puerto está ocupado, elegir otro. Los valores son temporales y se reinician al recargar. No hay persistencia ni llamadas a servicios reales.

Interacciones representativas: cambiar vista, filtrar ajustes visibles, navegar categorías, switches, selector de idioma/destino, menús de permisos/modelo/esfuerzo, slider/reset, adjuntos de ejemplo, entrada y envío simulado, pausa/reanudación, expandir resultado de herramienta, diálogo, aviso, validación, pestañas y ocultación de terminal. Pin/archivar, copiar, compartir, selector de carpeta, Git, Canvas y voz no ejecutan sus acciones reales: son muestras visuales o avisos.

El prototipo tiene un reset CSS local porque es un documento aislado. **Ese reset no debe copiarse al workbench.** Las funciones de render de esta muestra tampoco son una propuesta de arquitectura del chat real.

## 11. Decisiones a confirmar

| Decisión | Propuesta | Estado |
| --- | --- | --- |
| Paleta | Superficies medidas del tema oscuro de las capturas | Pendiente |
| Geometría | Controles 9 px, filas 12 px separadas 4 px, grupos 18 px, popovers 14 px, compositor 24 px | Aprobada; ver revisión 4 |
| Ajustes | Sidebar oscura, contenido centrado, grupos continuos | Pendiente |
| Compositor y overlays | Triggers pill, opciones compactas, entrada continua, selector del ZIP | Aprobada; ver revisión 4 |
| Actividad y editor | Adaptaciones de OpenIDE con el mismo lenguaje | Pendiente |
| Inicio de migración real | Solo después de revisar y aprobar la muestra | No iniciado |

Registrar aquí el feedback y la fecha de aprobación antes de ejecutar las fases de producción.


## 12. Revisión 2 — feedback, movimiento y procedencia

El usuario pidió conservar la densidad de OpenIDE, separar las filas del lateral, recuperar su botón Build ámbar, completar animaciones de actividad y usar el selector compartido. Estas correcciones reemplazan los valores iniciales de popovers de 20 px y opciones de 34/54 px. La migración de producción sigue sin aprobarse.

### Recetas compartidas de movimiento

| Receta | Entrada / salida | Propiedades | Uso |
| --- | --- | --- | --- |
| Interacción | 120 ms | Color de fondo, texto y borde | Hover y pressed; sin cambiar geometría |
| Overlay | 180 / 120 ms | Opacidad, desplazamiento 4 px, escala 0.97→1 | Popovers y menús |
| Tooltip | 110 / 120 ms, demora 450 ms | Opacidad y desplazamiento 2 px | Tooltip por hover o foco |
| Diálogo | 180 / 120 ms | Opacidad, 6 px, escala 0.985→1 | Diálogo; foco y cierre nativo conservados |
| Despliegue | 260 ms, contenido 180 ms | Alto del contenedor, opacidad y chevron | Detalle del agente; solo el contenedor afectado |
| Cambio de tarea | Salida 60 ms, entrada 100 ms | Opacidad y desplazamiento vertical 4 px | Misma secuencia que `openideChatStatusLine.ts`; salida antes de entrada |
| Shimmer | Ciclo de 4,2 s: barrido de ~1,6 s y reposo de ~2,6 s; demora inicial de 1,2 s | Gradiente tenue recortado al texto | Solo etiqueta de trabajo activo, sin parpadear toda la fila |
| Cambio de vista del selector | 260 ms de contenedor, 180 ms de contenido | Alto, opacidad y desplazamiento | Resumen ↔ avanzado |
| Snap del slider | 380 ms | Posición y relleno con spring amortiguado | Arrastre del selector; conservar movimiento directo durante el gesto |

Curvas compartidas: `--oi-ease-out: cubic-bezier(.32,.72,0,1)` y `--oi-ease-swap: cubic-bezier(.2,0,0,1)`. `--oi-ease-spring` conserva la curva `linear()` del selector aportado. No usar el spring de arrastre para todas las entradas de tooltip o menú.

`motion.js` centraliza entrada/salida y cambio de texto, cancela una transición anterior sobre el mismo elemento y consume tokens de duración. `selector-adapter.js` utiliza esos tokens en el Shadow DOM del componente. La misma familia visual se aplica en la maqueta a los overlays generales; no se cargó un framework de animaciones.

El shimmer usa el recorte de texto existente de `openideChatActivity.css`, pero la revisión 3 cambia su cadencia: 400% de gradiente tenue, ciclo de 4,2 s con aproximadamente 2,6 s de reposo entre barridos y 1,2 s de demora inicial. No usa `will-change: background-position`. La secuencia de prueba es finita, tiene pausa/reanudar, avance manual y replay. No genera turnos, procesos ni llamadas de IA. La pausa elimina el shimmer y el estado completado queda estático.

Con `prefers-reduced-motion`, las transiciones se resuelven sin desplazamientos y el texto queda legible sin gradiente animado; el componente original contempla una representación estática del slider. Al ocultar la página se pausa el shimmer y se cierra el selector para detener sus partículas. Al desconectar el componente se liberan observadores, listeners y animaciones. No extender las partículas del slider ni su celebración de Ultra al resto de la interfaz.

### Código de terceros

Fuente: ZIP del usuario `/home/nihuel/Downloads/chatgpt-model-selector-main.zip`, componente `JavaScript/chatgpt-model-selector.js`. Referencias: [artículo proporcionado](https://www.cssscript.com/chatgpt-model-selector/), [repositorio original](https://github.com/zanwei/chatgpt-model-selector).

Se conserva el archivo original sin modificaciones en `docs/design/codex-visual/vendor/chatgpt-model-selector.js`, junto con su `LICENSE`: **Copyright (c) 2026 Zanwei Guo, MIT**. El resto de las modificaciones de esta revisión pertenecen al prototipo de OpenIDE. No sustituir el copyright del autor por OpenIDE.

El adaptador agrega tema oscuro, tipografía, densidad, posicionamiento fijo con límites de viewport, cierre al cambiar de contexto, etiquetas en español y sincronización de modelo/esfuerzo de muestra. La fila de modelo expande una lista propia con buscador dentro del mismo popover, navegación por teclado y selección marcada; la velocidad se muestra como dependiente del proveedor. Light/Medium/High/Extra High/Ultra son niveles del demo, no una promesa de soporte universal de los CLIs.

Antes de una integración productiva, conectar los niveles permitidos por proveedor/modelo, preferencias persistidas, permisos y el servicio real de overlays. Verificar especialmente foco, reduced motion, cambio de vista y cantidad de loops de partículas en un chat largo. El benchmark de producción permanece pendiente.


## 13. Revisión 3 — anclaje, foco y actividad discreta

Regla obligatoria: un popover nunca ocupa el rectángulo de su disparador. Abre debajo con 8 px de separación si cabe; si no, abre arriba. Si no cabe completo en ninguno de los lados, usa el de mayor espacio y limita su altura con scroll interno. No se permite ajustar la coordenada vertical hacia el botón para mantener el menú completo dentro de la ventana. El margen exterior es de 12 px. Si no hay espacio utilizable, no se muestra superpuesto.

`overlay.js` centraliza el cálculo para menús, tooltips y el selector adaptado. Las animaciones se orientan alejándose del ancla, conservando la separación. La geometría se prueba en `overlay.test.cjs` con bordes superiores/inferiores, ventanas pequeñas, menús largos y casos sin espacio.

Al abrir con mouse no se enfoca automáticamente la primera opción ni se dibuja un ring. Al entrar con teclado, Tab/flechas y Enter conservan foco visible y Escape permite volver. La regla de modalidad se comparte con el Shadow DOM y cubre también el pseudo-elemento de foco del slider. No se elimina indiscriminadamente la accesibilidad de teclado.

El desplegable de actividad cambia de estructura: icono de búsqueda/lectura, estado actual y chevron al final del texto. Al expandir muestra lecturas con nombres de archivo subrayados de forma discreta y búsquedas realizadas; no una lista de pasos futuros con checks ni una línea vertical de timeline. Son datos de ejemplo en la maqueta, identificados como tales al abrir sus detalles.

El selector abre la lista de modelos **dentro del mismo popover**, con buscador, marca de selección, estado sin resultados y retorno al resumen. El contenedor anima su altura y el contenido su entrada. Se elimina el `select` nativo: no debe aparecer un segundo desplegable del sistema. El hover de «Volver» usa superficie oscura y texto legible. Los nombres de modelos siguen siendo ilustrativos; esta revisión no conecta proveedores reales.


## 14. Revisión 4 — aprobación, hover y scroll

Dirección visual aprobada por el usuario el 8 de septiembre de 2026 («ahora ya me convenció»). Este registro actualiza los estados históricos de las revisiones anteriores. La integración estructural se detalla en [Migración visual y rendimiento](docs/research/visual-performance-integration.md).

### Hover: conservar el comportamiento del IDE

En producción se conserva `setupChatTooltip` y `IHoverService`: demora configurada por el Workbench, grupo de continuidad entre controles, posición adaptable, texto resuelto al mostrar e indicador `showPointer`. Se actualizan superficie, borde y radio; no se reemplaza el servicio por listeners globales de la maqueta.

La maqueta corrige su bug con identidad del elemento propietario y comprobación de `relatedTarget`: atravesar texto/iconos no reinicia demora ni animación. Usa demora inicial de 450 ms, continuidad inmediata entre controles y gracia de 100 ms para cruzar el espacio hacia el tooltip. El indicador apunta al control, se invierte al cambiar de lado y conserva el borde. Escape, click, scroll y resize cierran el hover; se conserva `aria-describedby` ajeno al componente. Estos tiempos son una aproximación de prueba, no un reemplazo de la preferencia nativa del IDE.

### Regla global de scroll

1. **Marco y viewport son capas distintas.** El marco tiene borde, radio y `overflow: hidden`; nunca dibuja el scrollbar sobre su borde exterior.
2. **Inset común de 6 px.** El cuerpo desplazable queda 6 px dentro del marco en superficies redondeadas. Track y thumb terminan antes de las esquinas. El ancho del thumb es 6 px en la maqueta.
3. **Espacio solo cuando hace falta.** El cuerpo usa `min-height: 0`, `scrollbar-gutter: auto` y `overscroll-behavior: contain`; su altura se limita al espacio disponible después del gap y del marco. El gutter aparece únicamente con desborde real; si todo cabe, los márgenes interiores son simétricos.
4. **Un dueño del scroll por vista.** Menús verticales no agregan scroll horizontal por vistas inactivas/animadas. Flechas y búsqueda conservan la opción visible. Para paneles con encabezado fijo, el cuerpo es la única región desplazable.
5. **Adaptación nativa.** En Workbench se usa el layout de `ScrollableElement`/listas de Monaco; la regla es de geometría, no un reset universal ni la sustitución de la virtualización. El editor de código conserva sus barras y medición propias.
6. **Ancla y foco.** Al insertar datos se mantiene el elemento visible y la selección; seguir el stream solo si el usuario estaba al final. Cambiar de modelo/esfuerzo no mueve el trigger ni lo tapa.

Aplicación actual: popovers genéricos y selector del prototipo comparten marco interior; navegación, ajustes, laboratorio y conversación usan gutter automático. La misma regla se debe adaptar a cada superficie nativa en la migración real.

### Validación de esta revisión

Nueve pruebas Node de geometría y ciclo de hover: no solapamiento, cambio de lado, limitación de altura, paso entre descendientes sin reinicio, cruce hacia tooltip, continuidad, limpieza accesible y cancelación de propietarios retirados. Navegador: filtro de modelo, selección con flechas/Enter y tooltip por teclado con indicador. Son verificaciones del prototipo; no certifican rendimiento ni comportamiento multiplataforma del IDE instalado.

## 15. Bandejas integradas encima del compositor

Referencia: capturas del usuario del 8 de septiembre de 2026, con el mensaje pendiente detrás del compositor. Se adopta para todos los recursos asociados a la entrada: mensajes en cola, terminales en segundo plano, cambios de archivos y, en producción, GOAL, aprobaciones y otros recursos activos.

**Estructura común:** `composer-stack` contiene la bandeja de recursos y el compositor al frente. La bandeja se retrae 14 px por lado (10 px en espacios estrechos), tiene superficie `#242424`, borde de 1 px y esquinas superiores de 20 px. Su base se prolonga 18 px detrás del compositor. Este solapamiento decorativo entre superficies es intencional; no es una excepción a la regla de separar los popovers de sus botones.

Las filas compactas de 38 px contienen icono, título truncable, estado/conteos y chevron. Las acciones secundarias permanecen transparentes; aparecen con hover o foco dentro de la fila, y siempre son visibles en dispositivos sin hover. El menú de más opciones sigue accesible. No hay una tarjeta pequeña detrás de cada icono.

| Recurso | Resumen | Detalle | Acciones |
| --- | --- | --- | --- |
| Mensaje en cola | Texto, adjunto si existe y cantidad pendiente | Mensaje completo y condición de envío | Enviar ahora/dirigir, editar, quitar y abrir en otra conversación |
| Terminal en segundo plano | Comando, cantidad de procesos y estado real | Salida acotada; última actividad y errores | Abrir terminal, detener o reiniciar cuando corresponda |
| Diff de archivos | Cantidad de archivos y añadidos/eliminados | Lista de rutas y conteos por archivo | Abrir diff individual y revisión completa |
| GOAL | Objetivo y progreso verificable | Reportes, próximos pasos, bloqueos | Abrir documento/diff y controles del GOAL existente |
| Aprobación pendiente | Acción y permiso solicitado | Alcance y evidencia necesarios | Controles reales de aprobación; nunca ocultar por falta de espacio |

El prototipo implementa interacciones de muestra para cola, terminal y diff, disponibles en **Bandejas**, Conversación, Componentes y la adaptación del editor. GOAL y aprobaciones son contratos para la migración, no funciones nuevas simuladas como ya conectadas.

**Despliegue:** una sección abierta a la vez, transición de altura/opacidad con los tokens comunes, sin recrear las filas al abrir/cerrar. El detalle desplaza dentro del marco con el inset global; el compositor no pierde foco ni borrador. La maqueta usa contenido finito; la integración real debe limitar filas visibles y agrupar el excedente con un resumen, conservar identificadores estables y virtualización cuando corresponda. No cortar controles con `overflow: hidden` sobre una pila de altura fija.

**Semántica:** los menús y acciones se vinculan al recurso identificado, no a la posición de la fila. Quitar una fila de terminal no equivale a matar el proceso. Ocultar una revisión no descarta cambios. Editar un mensaje en cola debe impedir un envío concurrente y devolverlo al compositor conservando adjuntos; resolver ese contrato con el servicio de cola durante la migración. Si el compositor ya contiene un borrador, la maqueta lo conserva en la cola al intercambiarlo con el mensaje que se edita. El prototipo solo modela texto y acciones locales, sin ejecutar procesos ni alterar archivos.

### Funciones del IDE que se conservan en las bandejas

Revisadas en el checkout: `OpenideChatFilesTray`, `OpenideChatFileRow`, `OpenideChatComposerQueue` y `_editQueued` de `OpenideChatComposer`.

- **Por archivo:** revisar, aceptar (`keepEdit`) y rechazar/revertir (`revertEdit`), con tooltip para cada acción. Aceptar conserva lo editado; rechazar revierte, no oculta una fila.
- **Conjunto:** aceptar mediante `keepEdits(paths)`; revertir usando la ruta existente por archivo. Mientras el agente está ocupado, el tray actual sustituye las acciones masivas por Detener. No cambiar esa barrera para acomodar los botones.
- **Estado persistente:** los diffs pendientes pertenecen al workspace y se restauran; una conversación o turno nuevo no los elimina. Conservar notificaciones de error y señales de aceptación/reversión al Project Map.
- **Cola:** se conserva por conversación, con límite de 20 entradas. Sus mensajes incluyen imágenes, referencias, capacidades, links, snippets, modo, proveedor y modelo; no reducirlos a texto durante la migración. En el IDE, Enviar ahora cancela primero la ejecución activa: no etiquetarlo como un steer que se integra sin interrumpir.
- **Tooltips:** todas las acciones de bandeja tienen texto específico, usando el servicio nativo en producción. Mouse sin ring automático; navegación por teclado con foco visible.

El prototipo ahora permite aceptar/rechazar archivos individualmente o en conjunto y actualiza conteos/filas; `Simular agente activo` demuestra la sustitución de acciones masivas por Detener. No modifica archivos reales. Los flujos de persistencia, reversión de texto y errores se validarán contra los servicios del IDE durante la migración.


## 16. Scroll condicional y acabado compartido

Corrección solicitada tras probar las bandejas: el inset del marco no equivale a reservar una columna para una barra que no existe. Todos los scrollports del prototipo usan `scrollbar-gutter: auto`. Cuando hay desborde, el scroll continúa dentro del marco; cuando no lo hay, el contenido usa el ancho disponible con el mismo padding a izquierda y derecha.

El selector mide únicamente la vista activa. Las vistas inactivas quedan con altura y padding vertical cero, contenido recortado e `inert`; no generan overflow por su tamaño ni por sus transformaciones. El resumen de modelo/esfuerzo y el slider no muestran barra cuando caben. La lista de modelos permite scroll si supera el espacio disponible y vuelve a contraerse al filtrar. La animación de altura y la separación del trigger se conservan.

Acabado común en el documento y en el Shadow DOM del selector:

| Rol | Token compartido | Aplicación |
| --- | --- | --- |
| Hover neutro | `--oi-hover` | Botones, filas de menú, selector, bandejas, pestañas y navegación |
| Radio de controles y opciones | `--oi-radius-control` / `--oi-radius-item` = 9 px | Botones pequeños, acciones, opciones simples/enriquecidas y opciones del selector |
| Borde de superficie | `--oi-border` | Grupos, planes, bandejas y tarjetas |
| Borde de control y overlay | `--oi-border-overlay` | Selectores, popovers, tooltip y controles delineados |
| Borde interactivo | `--oi-border-hover` | Inputs/controles delineados al pasar el cursor |
| Radio de popover | `--oi-radius-popover` = 14 px | Menús generales y selector |
| Radio de tooltip | `--oi-radius-tooltip` = 9 px | Hover compacto con indicador |

Los tamaños por rol siguen siendo intencionales: fila de navegación 12 px, grupo 18 px, compositor/diálogo 24 px. No son excepciones arbitrarias por componente. Build conserva sus tokens ámbar aprobados; aceptar/rechazar, errores, selección y foco mantienen su significado. Un componente nuevo debe consumir estos tokens y no elegir otro gris, radio o borde para su hover.


## 17. Integración en OpenIDE — 8 de septiembre de 2026

La aprobación del prototipo se implementa en el Workbench nativo. Las revisiones anteriores documentan el proceso; ya no describen una entrega limitada al mock.

### Fuente compartida y composición

- `openideSurfaceCss.ts` exporta `OPENIDE_SURFACE_TOKENS_CSS` y `OPENIDE_SURFACE_CSS`: roles semánticos, aliases compatibles, radios, movimiento y controles `.oi-btn`/`.oi-split`. El instalador se ejecuta al iniciar el Workbench y propaga estilos a ventanas auxiliares.
- `openideControlStyles.ts` adapta los widgets nativos mediante variantes primarias/secundarias. Las acciones destructivas conservan su confirmación y semántica; Build conserva el ámbar.
- `openideWorkbench.css` conecta los roles al chrome compartido: overlays, controles, tooltips con indicador, diálogos, notificaciones y islas redondeadas. El layout nativo reserva sus márgenes y bordes; las cabeceras mantienen los 32 px que mide ese modo. Ajustes a ventana completa queda excluido de esos insets.
- `createChatTray` compone encabezado, estado, acciones y cuerpo para cola, diffs y terminales. Cada propietario mantiene sus datos, permisos, persistencia y acciones. El selector reutiliza catálogo y lista virtualizada; la vista de esfuerzo usa capacidades reales del modelo.
- Canvas recibe sólo tokens y selectores del chrome del editor. Los diseños del usuario y las exportaciones independientes conservan sus estilos.

### Cobertura

Ajustes y sus secciones, conversación y adjuntos, actividad y subagentes, GOAL, cola, terminales, archivos pendientes, planes, mapas, diagramas, Canvas/Design, navegador/inspector, edición rápida, diff, instalador de skills, bienvenida, novedades, diálogos y chrome general del editor.

Los menús del sistema operativo y el contenido de webviews de extensiones externas mantienen sus propios motores visuales. El sistema respeta temas personalizados, tipografía y medición de Monaco/xterm. La paleta exacta aprobada corresponde al tema OpenIDE Dark.

### Rendimiento y desarrollo

No se incorpora un framework de UI ni un reset sobre el contenido. Se reutilizan servicios y widgets existentes, listas virtualizadas y registros de actividad reales. El shimmer de actividad tiene descanso, se detiene al finalizar y respeta movimiento reducido. El render de modelos sólo crea filas cuando se abre la búsqueda. No se reserva gutter cuando no hay overflow.

La recarga CSS de desarrollo conserva el estado de la ventana; cambios estructurales de TypeScript requieren recargar el Workbench. Las instrucciones reproducibles y sus limitaciones se mantienen en `docs/dev-reload.md`. Esta integración no actualiza la AppImage instalada ni inicia la migración a Rust.


### Ajustes y selector: cierre de la revisión

Ajustes usa una presentación de ventana completa del host de editores, limitada al input de Settings: ocupa todo bajo el titlebar, sin marco, blur ni cabecera flotante. «Volver al IDE» devuelve el foco al espacio anterior. No modifica preferencias transitorias del layout. Los destinos de grupo/lateral pedidos explícitamente se conservan.

El selector abre directamente un panel compacto: Fast a la izquierda, esfuerzo/modelo en el centro y restablecer a la derecha. El centro abre el catálogo con búsqueda dentro del mismo popover; se retira Avanzado. Sus niveles vienen del catálogo real; el slider previsualiza al arrastrar y persiste al terminar el gesto. Las selecciones asíncronas se serializan y el cierre/reapertura invalida cambios visuales tardíos. Los popovers se cierran al entrar a otra sección.

Cola, diffs, terminales y GOAL registran su expansión en un coordinador compartido por compositor. Una sección abierta cierra la anterior, sincronizando el estado de sus propietarios y las notificaciones de altura; otros chats y las tareas históricas del transcript permanecen independientes.

### Evidencia de integración

- 97 pruebas de navegador: bandejas y restauración, GOAL, actividad, selector asíncrono, revisión de archivos, terminales, navegación/búsqueda de ajustes y destinos de apertura.
- Chequeo TypeScript completo del cliente sin errores tras retirar una constante obsoleta del host.
- Workbench Dev real sin errores de renderer durante la captura de arranque; selector con separación medida de 8 px, resumen sin overflow, búsqueda filtrada que reduce su altura y radio de 14 px.
- Ajustes de 1412 px de ancho en una ventana de 1412 px; presentación bajo el titlebar y sin backdrop. Capturas y geometría locales en `.build/visual-migration-live/`.
- Smoke de Canvas/Design, Map y diálogos con controles estrechos, movimiento reducido y aislamiento de artefactos/exportaciones.

Esta verificación no equivale a un benchmark de rendimiento de toda la aplicación ni a una certificación visual de cada extensión externa. La optimización estructural/Rust conserva su plan y sus mediciones propias.

### Movimiento del selector nativo

El slider conserva el rango nativo accesible y añade arrastre continuo, ajuste elástico al nivel admitido, transición del encabezado, destellos y una celebración breve al alcanzar el máximo real del modelo. No introduce niveles ni capacidades ficticias. Se retira Avanzado y el centro usa el hover compartido completo, con tooltip nativo.

Las recetas visuales adaptadas del selector proporcionado por el usuario conservan el aviso MIT de Zanwei Guo en el helper y en `vscode/ThirdPartyNotices.txt`. El render usa un único ciclo de animación sólo con Fast activo o al máximo esfuerzo real, DPR limitado a 2 y hasta 24 destellos; cerrar/cambiar de vista libera los recursos. Ocultar la ventana pausa el ciclo y movimiento reducido mantiene el control estático y funcional.

Cuatro regresiones específicas cubren partículas en Max sin Fast, previsualización sin escrituras, confirmación única, cancelación del gesto, teclado y suspensión/liberación de animaciones. El runtime se inyecta en las pruebas sin modificar APIs globales.

### Scroll y movimiento compartidos del Workbench

`ContextViewMotion` incorpora apertura, cierre y adaptación de tamaño en el host nativo `ContextView`, incluidas las raíces Shadow DOM. Consume variables de movimiento del tema, respeta movimiento reducido y conserva el cálculo de posición, foco y límites del Workbench. El selector deja de tener su propio motor de cambio de tamaño. Las llamadas de layout repetidas no cancelan la transición; una transición interrumpida parte del estado visible. El cierre congela ese estado antes de desvanecerse y el host vuelve inerte el contenido hasta liberarlo.

El scroll conserva los widgets virtualizados y sus propietarios. Las áreas nativas comparten thumb temático, track transparente y ausencia de flechas del sistema. No se reserva gutter cuando no hay overflow. Durante una transición sólo se suspende la pintura del scrollbar; al terminar se muestra si el contenido lo requiere. La capa decorativa de partículas no participa del área desplazable.

El botón + utiliza las mismas filas, secciones y superficie. Sus acciones reales y comprobaciones están documentadas en `docs/composer-add-menu.md`; reemplaza el clip duplicado. La comprobación nativa verifica cambio de tamaño, cierre inerte, barra temática, lista vacía sin overflow y ausencia de animaciones con movimiento reducido.

### Selector compacto y divisiones del layout

El rayo es una acción real: Fast activa destellos en todos los niveles. El máximo esfuerzo real también tiene destellos morados y una breve celebración al alcanzarlo, independientemente de Fast; el efecto decorativo no modifica el tier de la solicitud. Su disponibilidad procede del catálogo vivo del proveedor; no se promete una velocidad fija de 2×. Actualmente se conecta al tier prioritario de modelos Codex compatibles. Los demás modelos muestran el motivo de indisponibilidad. El control central abre la búsqueda y restablecer reinicia sólo el esfuerzo en el slider existente, conserva Fast y mantiene abierto el popover. Detalles y pruebas de serialización: `docs/model-fast-mode.md`.

Sidebar, editor, chat, panel, titlebar y statusbar se separan con líneas de un píxel y el color compartido. Los overlays de separación son no interactivos y se orientan según la posición real del panel; no modifican medidas ni duplican las divisiones nativas entre grupos de editores.

### Foco del catálogo y comprobación final

El resaltado del ratón se limpia al salir de la lista hacia el buscador, el pie o fuera del popover. El foco de teclado se conserva para navegar con flechas; abrir de nuevo el catálogo elimina el foco anterior. Los eventos del host se entregan como eventos DOM nativos, conservando `type`, `key` y la composición IME.

El recorrido final en Workbench Dev verifica el foco limpio sobre «Agregar proveedor», Escape, navegación del menú + con teclado, partículas en Max, morph compartido, scroll temático y lista vacía sin overflow, separadores no interactivos y movimiento reducido. Resultado y capturas: `.build/visual-migration-live/final-selector-ui.json`. El chequeo TypeScript completo pasa con estos cambios.

### Componentes internos de los docks

Files, Outline y Timeline usan secciones planas y la receta común de acciones/filas. El historial, pestañas y cabecera del chat consumen `oi-dock-row`, `oi-dock-action`, `oi-dock-section` y la variante nativa de búsqueda. Search, SCM, Extensions, Debug y Terminal conservan sus widgets y adaptan sus excepciones al mismo sistema. Alcance y evidencia en `docs/dock-components.md`.

### Revisión: islas, Reset y conversaciones

Los docks recuperan el layout nativo de islas con radio de grupo y pestañas con radio de control. Se retira el separador rectangular superpuesto; el borde sigue el perímetro de cada isla. Las acciones nativas de toolbar, actividad y estado consumen los mismos tokens de hover que compositor, cola, archivos y terminales. Los colores semánticos de aceptar/rechazar y grabación se conservan mediante variantes.

Reset actualiza el slider sin reemplazar el botón o panel durante el bubbling del evento. El historial agrupa por carpeta conocida, usa filas de una línea y un único hover nativo por fila con título, contexto y antigüedad. Detalles en `docs/conversation-history.md`.

Validación: 30 pruebas de selector/slider/cola/archivos/terminales, 6 de historial y 8 de layout; TypeScript del cliente sin errores. Recorrido Dev en `.build/visual-migration-live/islands-final.json`: bordes/radios y márgenes, hovers coincidentes, Reset abierto y Fast conservado, preview de conversación y Ajustes completo. El esfuerzo original fue restaurado tras la comprobación.

### Ajuste de densidad y bordes exteriores

En modo de islas no se pintan los separadores rectos del titlebar ni del statusbar, incluido el pseudo-elemento nativo de StatusbarPart. El perímetro lo define cada isla. El compositor reduce el espacio vacío: en Dev pasó de 116 a 82 px, conserva crecimiento multilínea y scroll al máximo de 180 px del textarea. Los iconos neutrales de Files y toolbars comparten también el color de hover, sin cambiar disabled ni colores de ejecución.

Verificación CSS en Dev mediante hot reload, sin recargar: `.build/visual-migration-live/compact-clean-islands.json` y captura del mismo nombre. Comprobados Nuevo archivo, Nueva carpeta, Refrescar, menú de Files y actividad: mismo fondo y radio, sin outline de puntero.

### Curvas contenidas y botones divididos

La escala compartida se ajusta a radios menos pronunciados: controles, ítems y tooltips 7 px; filas 9 px; popovers 12 px; grupos/islas 14 px; compositor 18 px y diálogos 20 px. Los controles circulares conservan su geometría. El compositor mantiene su altura compacta de 82 px en vacío.

Los `ButtonWithDropdown` nativos consumen el radio de control como una sola silueta: sólo las esquinas exteriores son curvas, con unión recta y separador interno. La adaptación es compartida e incluye Commit de SCM; conserva acciones, colores, estados y dimensiones nativas.

Verificado en Workbench Dev mediante recarga CSS: apertura del menú de Commit y cierre con Escape, radios calculados del compositor/islas y captura en `.build/visual-migration-live/radius-split-final.json` y `.png`. No se ejecutó la acción Commit.

### Cabeceras y viewport del catálogo

Graph, Installed, Recommended y las demás cabeceras de PaneView se dibujan con los 28 px que ya reserva el layout, escalados con la fuente. Se elimina el desajuste heredado de 22 px y el hover deja 2 px de aire vertical, sin reducir el área de clic/arrastre.

El catálogo mide sus controles fijos y márgenes por separado: nunca resta la altura anterior de la lista de un cuerpo comprimido por flex o por la animación. La lista virtual es el único dueño del scroll de modelos; buscador y pie permanecen fijos. Un ResizeObserver actualiza el viewport al cambiar el espacio disponible y se libera al cerrar.

Validación: regresión de filtrado repetido, frame comprimido, lista vacía, resize y navegación al último modelo; seis pruebas de PaneView para tres docks y dos tamaños de fuente. En Dev: lista de 307 px dentro de la tarjeta de 420 px, sin overflow exterior, rueda y arrastre funcionales; Graph/Installed/Recommended a 28 px. Evidencia en `.build/visual-migration-live/model-scroll-final.json` y `headers-spacing-final.json`.

### Voz e iconos del chat

Las acciones del header nativo y del compositor comparten `--oi-icon-action` (18 px); enviar usa `--oi-icon-send` (20 px). Las pestañas de conversación presentan título y estado, sin icono decorativo, manteniendo el tooltip del agente.

La captura usa una barra nativa dentro del compositor: cancelar, historial visual del nivel RMS real, detener y enviar. Los puntos/barras mantienen un paso compacto con historial acotado a 128 muestras. No hay animación de audio ficticia ni captura para generar previews. Detener completa la transcripción y deja editar; enviar espera un resultado correcto; cancelar libera captura y descarta respuestas pendientes, conservando el texto ya transcrito.

Validación integrada: 24 pruebas de selector, cabeceras, controlador de voz y barra; chequeo TypeScript del cliente sin errores. Iconos medidos en Dev a 18 px, cero iconos decorativos de pestaña y compositor vacío de 82 px. Capturas aisladas con muestras deterministas en `.build/visual-migration-live/voice-bar-400.png` y `voice-bar-800.png`; comprobación de iconos en `icons-final.json`.

El modo mantener pulsado conserva la captura del puntero durante los cambios de layout. Cambiar de conversación invalida también un envío ya resuelto pero todavía pendiente de ejecutarse.

### Project Map, popovers y actividad compartida

Project Map reutiliza acciones, filas y botones del Workbench para búsqueda, Modules, inspector, zoom y minimapa; las tarjetas conservan su renderizado nativo. El buscador ya no colapsa la tarjeta al escribir espacios, y el canvas del minimapa mide un viewport sin padding.

El selector alinea buscador, lista y pie con los mismos insets; usa control con borde completo, radios compartidos y secciones con hover. Se retiran separadores sueltos sin alterar el viewport virtual ni su presupuesto de altura.

La referencia visual para el brillo es [shimmer de shadcn/ui](https://ui.shadcn.com/docs/utils/shimmer). La implementación es CSS nativo propio: una banda estrecha sobre el texto, ciclo de 3,2 s con pausa, delay inicial de 1 s y sin JavaScript por frame ni `will-change`. Chat y cambios CLI comparten `OPENIDE_SHIMMER_CSS`; en movimiento reducido y alto contraste el texto queda estático y legible. La comprobación visual y de preferencias está en `.build/visual-migration-live/shimmer-final.json`.

Los recibos informativos de memoria se actualizan en una sola fila de la conversación correspondiente, sin toast sobre el compositor ni contenido adicional enviado al modelo. Las advertencias accionables conservan su aviso. Enviar, detener, voz y bajar al final comparten botón circular de 32 px y paleta neutra.

### Pestañas e iconos alineados con el editor

La pestaña de chat consume las clases `modern-ui-editor-tab` y su fill: área de 32 px, relleno de 24 px y estados/radio del editor. Se retira el estilo de fila de lista. Los iconos de acciones y del compositor pasan al estándar compartido de 16 px. Expandir/contraer usa los SVG Bootstrap solicitados, con atribución MIT; el icono, tooltip y nombre accesible siguen el estado real del dock.

Las cabeceras expandidas reservan 4 px internos abajo dentro de sus 28 px existentes. Las acciones quedan separadas de la primera fila sin modificar offsets ni altura del árbol virtual.

Validación de esta iteración: suites nativas de chat, memoria, voz, cabecera, selector, Project Map y scroll correctas; se actualizó la expectativa de iconos de Project Map al nuevo estándar de 16 px. TypeScript del cliente sin errores. La recarga de Electron sufrió un fallo nativo de seccomp; se restauró Dev con el mismo perfil para continuar la comprobación visual.

Medición final en Dev: ambas pestañas de 32 px, iconos de cabecera de 16 px y acción de bajar al final de 32×32 px, radio 50%, borde y fondo claros. Evidencia: `.build/visual-migration-live/current-controls.json`, `current-interactions.json` y `current-scroll.jpg`.

### Acciones circulares y spinner único

Enviar e ir al final comparten una flecha sobre una cuadrícula de 16 unidades (trazo 1,5 px), sin reducirla dentro de un viewBox de 24. Detener usa un SVG con cuadrado sólido de 10 px en el mismo espacio de 16 px. Las acciones primarias comparten círculo blanco de 32 px y primer plano oscuro; el botón flotante queda por encima del degradado del compositor, que sólo atenúa el texto.

El anillo de Build es ahora `OPENIDE_SPINNER_CSS`, compartido mediante `.oi-spinner`, el alias del plan y los indicadores loading del Workbench. La animación CSS de 900 ms afecta sólo al anillo; no gira el área de clic ni cambia refresh/sync. Respeta movimiento reducido y desaparece al finalizar la carga.

Verificado: TypeScript del cliente, cinco pruebas de voz y la regresión del spinner; formas y medidas reales en `.build/visual-migration-live/round-actions-final.png`. En Dev se comprobó el botón de bajar blanco, de 32×32 px e icono de 16 px, con recarga nativa del Workbench y hot reload activo.

### Escala compacta final y expansión en todas las superficies

Las acciones circulares se ajustan a 28 px, con SVG de 14 px y trazo más fino. La expansión conserva un slot de 14 px con dibujo de aproximadamente 12 px, dando al path Bootstrap el margen óptico de los codicons. El cierre de pestaña es ahora el mismo `close-small` de Monaco a 13 px (área de 18 px). La cabecera del chat no dibuja línea inferior.

Los paths expandir/contraer se comparten entre el SVG de chat y las máscaras nativas de panel, terminal, barra auxiliar y fullscreen. El estado checked selecciona contraer; se conserva la orientación en paneles laterales. Ajustar un gráfico o diagrama mantiene su icono semántico propio. El watcher CSS resuelve las constantes PATH junto con CSS.

Verificación: TypeScript correcto, pruebas del adaptador nativo y de la cabecera correctas. En Dev se midieron tamaños y ausencia de borde; se amplió/restauró el panel nativo conservando su estado inicial. Evidencias en `.build/visual-migration-live/compact-actions-native.json` y `terminal-expand-final.json`. Hot reload permanece activo.

### Indicadores de conversación y círculos de 24 px

Pestañas e historial usan `createChatSessionStatusIcon`: anillo compartido de Build durante ejecución, sin indicador cuando están completadas/inactivas. Atención y error mantienen iconos semánticos sin puntos ni pulsos de color. Se retiran las recetas antiguas tab-dot/session-dot. El spinner no modifica el título ni el foco al actualizarse.

El círculo de enviar, detener y bajar al final se reduce a 24 px; los símbolos interiores se mantienen a 14 px. El mínimo del botón nativo también usa este token para evitar que Monaco vuelva a agrandarlo.

Validación: TypeScript del cliente correcto y nueve pruebas de cabecera, sesiones y spinner; transición de ejecución a completada verificada y foco de teclado conservado.

### Rollback de memoria y popovers del composer sticky

Los avisos de captura llevan el ID del turno que los originó. «Guardando» y «Guardada» actualizan una misma fila; el rollback elimina los avisos de los turnos descartados y rechaza resultados tardíos de esos turnos.

Antes de restaurar archivos, el rollback espera la escritura pendiente y cancela de forma durable sus capturas. Los recibos guardan el contenido anterior y posterior de cada escritura de memoria, incluso cuando termina después del turno. Se revierten los turnos descartados en orden inverso y se conservan archivos con ediciones posteriores. Las notas de versiones anteriores sin un recibo verificable se conservan con un aviso explícito.

Ambos hosts compartidos de popovers miden la altura efectiva del contenido y el espacio a cada lado del ancla. Si arriba no alcanza, abren abajo; listas más grandes y cambios de tamaño vuelven a calcular la posición manteniendo el margen del viewport y la separación de 8 px.

Validación: 43 pruebas nativas de chat, rollback, avisos, selector y posición; 51 pruebas de memoria con disco real, colas, reinicio y restauración. Se comprueba eliminación de notas nuevas, recuperación del contenido previo, conservación de ediciones manuales y orden inverso aun con marcas de tiempo iguales. Dev no se reinició durante la respuesta activa del usuario; el backend debe reiniciarse para cargar el nuevo propietario de memoria.

### Canvas: elección en el chat y componentes compartidos

La galería exige elegir explícitamente un formato. Título y detalles son opcionales; «Continue in chat» agrega la solicitud al composer sin borrar el borrador existente ni crear archivos. El usuario revisa y envía el mensaje. Para solicitudes directas sin formato, las instrucciones del agente indican consultar `canvas_templates` y pedir la elección con `ask_user`.

Galería, controles del editor y primitivas públicas del Canvas reutilizan las recetas compartidas de botones, campos, opciones, tarjetas y avisos. Los radios seleccionables conservan foco y navegación nativos. Se retiraron estilos duplicados y las reglas antiguas del chat que cambiaban las tarjetas del Canvas. El contenido propio del prototipo conserva sus tokens editables.

Validación: TypeScript del cliente y 11 pruebas unitarias correctas. Prueba en Electron aislado: elección hacia el composer, borrador conservado, ausencia de generación/envío automático, estilos compartidos, edición, undo/redo, formularios, exportación, MCP y persistencia tras reiniciar. Evidencias en `.build/canvas-design-runtime/`.

### Composer neutro y espera de respuestas

El composer conserva el borde neutro durante el foco y la ejecución. Se eliminaron los elementos del antiguo borde animado, sus gradientes, keyframes, variables, cálculos de duración y las reglas que lo ocultaban. El shimmer de texto compartido es el indicador de actividad.

Aprobaciones, preguntas, elección de cuenta y sugerencias de modo pendientes muestran una sola línea «Esperando respuesta» debajo del contenido. Las decisiones se resuelven por ID de solicitud; las elecciones de cuenta y modo actualizan también conversaciones en segundo plano. Un terminal cuya última salida espera entrada usa el mismo texto. Las preguntas pendientes ya no duplican el shimmer en su registro; al responder se muestra el registro de respuestas.

El selector del alcance de aprobación usa el botón discreto compartido, sin el borde blanco heredado del select del IDE, con chevron y foco de teclado. Verificación: pruebas de estado, renderer, aprobaciones y resolución entre conversaciones; prueba visual aislada en Electron con movimiento reducido. Evidencias en `.build/chat-waiting-runtime/`.

### Bandejas compactas del composer

Terminales, archivos y cola comparten cabeceras y filas de 24 px, acciones de 22 px e iconos de 16 px. Se redujeron el padding del host, las cabeceras y los cuerpos, y también la separación interna de GOAL. Los botones mantienen foco de teclado y usan hover neutro, sin el borde ni padding de botones de texto sobre el cierre de terminales. Se retiraron las copias obsoletas del contenedor en los estilos de cada variante.

Validación: 34 pruebas de bandejas, archivos, terminales, cola y objetivos. Electron comprueba medidas reales, expansión exclusiva, iconos, acciones de revelar/detener y ausencia de desborde horizontal a 280 px. Evidencias en `.build/chat-trays-runtime/`.

### Espaciado del chat y contraste de proveedores

El pie del composer deja 2 px de separación y 4 px de padding inferior. La cabecera elimina el separador vacío junto a expandir y usa 2 px entre acciones. La opción nativa del selector es «Nuevo chat», sin icono ni descripción; los CLI siguen filtrándose por ejecutables encontrados en PATH, con sondeo conjunto y caché.

Los logos monocromos usan el color del texto. Su tinte opcional es `--oi-provider-icon-tint`, separado del antiguo token de fondo translúcido que heredaban por error; se elimina ese token sin consumidores. Los botones repetidos «Connect» de Settings usan la variante ghost compartida y los iconos de acciones usan 16 px. Se retiraron el separador y las traducciones que dejó de usar el menú.

Validación: typecheck del cliente y comprobación en Electron aislado de la opción nativa, filtrado por PATH, una sola consulta concurrente, selección de ambos tipos, contraste de logos y botón Connect neutro.

### Popover del alcance de aprobación

El alcance de permisos usa `OpenideComposerPopover` y las filas compartidas del chat. Se retira el select nativo y su CSS. El menú muestra la selección con check, usa las superficies y radios comunes, abre debajo y cambia de lado si falta espacio. Escape devuelve el foco al botón; las flechas, Inicio, Fin y Enter permiten elegir. Seleccionar un alcance no autoriza la acción: hace falta pulsar Allow. Las acciones sensibles no ofrecen permiso permanente; una resolución externa cierra el popover.

Validación: 19 pruebas de aprobación, typecheck del cliente y Electron con selección, reapertura, Escape, navegación por teclado y shimmer de espera. Captura en `.build/chat-waiting-runtime/approval-popover.png`.

### Memoria cronológica y controles del browser

El guardado de memoria se inserta en la respuesta que lo originó. Cierra los grupos de texto para que los pasos posteriores aparezcan debajo y conserva los cursores de herramientas pendientes. El recibo es una línea discreta con enlace al tema, sin tarjeta de alerta. No se anuncian comprobaciones sin cambios ni el inicio de una captura en segundo plano.

Las verificaciones de solo lectura pueden repetirse después de una mutación exitosa; los contadores de acciones que modifican estado permanecen para detectar bucles. Un intento bloqueado termina con su resultado de error y no invoca la herramienta.

El browser inicializa los tokens compartidos. Escala usa el dropdown común, los campos y botones usan los adaptadores del producto y el inspector aloja ColorPickerWidget en el popover compartido. El segundo clic cierra el selector; las resincronizaciones diferidas no desmontan el ancla de otro selector. Los overlays fijos conservan los estilos compartidos frente al reset nativo. Se eliminó el CSS duplicado del contenedor de color y del select de escala.

Validación: 77 pruebas de memoria, estado del chat y protección de herramientas; typecheck del cliente; pruebas visuales de browser y regresión de menús del chat. Evidencia en `.build/browser-controls-runtime/color-popover.png`.


### Panel de herramientas y estados vacíos compartidos

El panel derecho integra pestañas y controles de agregar, ampliar y ocultar en una sola cabecera. Se conservan las pestañas nativas y su lógica de foco, cierre, arrastre y overflow; los controles se alojan en el toolbar que el editor ya mide. Evitar un segundo título «Workspace panel» encima de las pestañas.

Los estados vacíos de superficie reutilizan `OpenideEmptyState` (`vs/workbench/browser/openideEmptyState.ts`): marca o icono contextual a la izquierda de título y descripción breve, acciones debajo, ancho contenido y centrado seguro cuando hay espacio. El editor tradicional comparte su cabecera con `renderOpenideEmptyStateHeading`. Chat y lanzador de herramientas usan la marca OpenIDE; Browser, Changes, Files y terminal usan el icono de su función. La variante compacta se reserva para paneles bajos o secciones pequeñas. Mensajes inline de ausencia de elementos mantienen su escala de sección; no deben convertirse en grandes portadas con logo.

Las acciones usan controles compartidos y sólo muestran atajos que resuelve `IKeybindingService` para el mismo comando. No inventar combinaciones ni asociar el atajo de un selector a otra acción. Los estados sin resultados de filtro ofrecen limpiar el filtro; los errores y las cargas conservan su mensaje específico. Al reemplazar un vacío, liberar sus listeners y labels; no reconstruirlo durante el resize.

### Launchers de Agents

El vacío del panel de trabajo usa sólo filas de herramientas con iconos pequeños y atajos reales. El chat usa una pregunta breve, filas de sugerencias y las pistas del compositor, sin repetir el logo de OpenIDE. Usar la variante `launcher` de `OpenideEmptyState`; el watermark del editor tradicional conserva su variante de identidad. En launchers el hover responde de inmediato, sin transiciones de fondo acumuladas. Los atajos se definen una vez en el catálogo de Agents y se reutilizan en etiquetas, menús y controles; nunca se escriben combinaciones falsas en el texto de una fila.
