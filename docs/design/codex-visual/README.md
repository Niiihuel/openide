# Prototipo visual de OpenIDE

Prototipo aislado de la dirección visual aprobada. Especificación: [design.md](../../../design.md).

Abrir `index.html` directamente o, desde la raíz del repositorio:

```bash
python3 -m http.server 4387 --bind 127.0.0.1 --directory docs/design/codex-visual
```

Visitar http://127.0.0.1:4387. No requiere instalación ni conexión a Internet. Ctrl+C detiene el servidor.

- **Ajustes:** categorías, búsqueda dentro de la categoría visible, switches y selectores.
- **Conversación:** adjuntos de ejemplo, entrada local, menús de permisos/modelo/esfuerzo y actividad.
- **Componentes:** paleta, controles, validación, diálogo, aviso, tooltip y tarjeta de novedades.
- **Editor:** adaptación propuesta con pestañas, terminal y chat lateral.

Tab recorre controles; flechas recorren menús y ajustan el slider; Escape cierra overlays. El estado se reinicia al recargar. Los nombres de modelos y salidas de herramientas son ilustrativos.

Esta maqueta no modifica el IDE, no ejecuta comandos y no usa proveedores de IA. El usuario aprobó la dirección visual; la migración de producción queda por implementar. No copiar su reset global ni su estrategia de render al workbench.

## Revisión realizada

- Sintaxis de JavaScript validada con `node --check`.
- Recorridos en el navegador integrado: búsqueda de ajustes, toggle, selector con flechas/Enter, esfuerzo con flechas/Escape, permisos, pausa/reanudación, validación al borrar texto, diálogo con Escape, cambio de pestaña y envío simulado.
- Borrador conservado al añadir un adjunto de ejemplo.
- Revisión visual en viewport normal (934 × 708), 800 × 480 y 1440 × 900; menús dentro de la ventana y contexto visible en escritorio.
- Corregidos cierres de menú ocasionados por scroll/foco y ancho del menú Añadir en el compositor.

No se ejecutó la matriz completa de accesibilidad, plataformas o rendimiento del IDE: corresponde a la migración futura. La revisión de este prototipo no valida comportamiento de producción.

## Revisión 2 — densidad y movimiento

Nueva vista **Movimiento**: abrí el detalle del agente y pulsá **Reproducir actividad** o **Siguiente tarea**. Probá pausa/reanudar, el selector → **Avanzado**, los popovers y el Build del plan.

- Filas laterales separadas por 4 px; menús simples de 28 px y enriquecidos de 46 px.
- Popovers de 240 px; Añadir y Permisos de 360 px; selector de 260 px. Límites del viewport conservados.
- `motion.js` y tokens compartidos: entrada/salida, tooltip, diálogo y cambio de texto; despliegue CSS y spring del selector.
- Shimmer de 2 s basado en el del IDE; transición entre tareas de salida 60 ms y entrada 100 ms. Secuencia de prueba finita.
- Build usa los colores del tema OpenIDE: `#eeb266` / `#f3c07e` y un borde discreto.
- Selector original del ZIP en `vendor/`, sin cambios, con MIT de Zanwei Guo. `selector-adapter.js` aporta tema, posicionamiento y sincronización; no modifica producción.
- El sistema reduce movimiento automáticamente cuando está configurado así en el dispositivo. Las partículas quedan limitadas al selector avanzado.

Comprobado en navegador: despliegue, pausa/reanudar, finalización de secuencia, selector avanzado, Home/End y Escape, cambio de modelo sincronizado y menú Añadir compacto. Revisada sintaxis de los tres scripts propios y verificada identidad SHA-256 del selector vendorizado respecto del ZIP. No se ejecutaron benchmarks del IDE ni pruebas multiplataforma de movimiento reducido.

## Revisión 3 — reglas de overlays y actividad

- Popovers: gap de 8 px, flip debajo/arriba y altura limitada por el espacio disponible; `overlay.js` y `overlay.test.cjs` comparten/verifican la regla.
- Mouse: sin ring automático. Teclado: foco visible y navegación conservados, también dentro del selector.
- Selector: lista y buscador propios dentro del mismo popover; sin select nativo; hover oscuro de Volver.
- Actividad: lecturas y búsquedas en filas simples, chevron al final del estado. Shimmer tenue con ciclo de 4,2 s (unos 2,6 s de reposo), demora inicial de 1,2 s.

Pruebas de geometría: `node --test docs/design/codex-visual/overlay.test.cjs`.


## Revisión 4 — tooltip y scroll

Tooltip con indicador y propietario estable: cruzar texto/iconos no reinicia la animación. Marco redondeado con cuerpo desplazable 6 px hacia dentro, gutter automático y navegación de modelos visible con teclado. En el IDE se conservará `IHoverService`; `tooltip.js` solo pertenece a esta maqueta.

```bash
node --test docs/design/codex-visual/overlay.test.cjs docs/design/codex-visual/tooltip.test.cjs
```

La integración con el PDF de arquitectura está en [el documento de rendimiento](../../research/visual-performance-integration.md).

## Bandejas sobre el compositor

La vista **Bandejas** permite comparar Todo / Cola / Terminal / Cambios. Probá desplegar una fila, editar la cola desde su menú, mostrar la salida, detener la terminal de ejemplo y abrir el diff ilustrativo de un archivo. **Restablecer ejemplos** recupera las filas iniciales.

El patrón también aparece en Conversación y junto al editor. Sus acciones son locales a la maqueta, no están conectadas al harness. La sección 15 de `design.md` define cómo adaptar los recursos reales, incluidos GOAL y aprobaciones, sin cambiar sus permisos ni semántica.


Comprobación de las bandejas: expandir terminal; editar mensaje desde el menú; aceptar un archivo y actualizar totales; simular ejecución activa y sustituir las acciones masivas por Detener; detener y rechazar el conjunto; restablecer la muestra. Acciones de archivo y de cabecera con tooltip. El foco automático por mouse no dibuja ring; el teclado conserva su indicación.


## Scroll condicional y bordes compartidos

El scrollbar no reserva una franja vacía: `scrollbar-gutter: auto`. La vista inactiva del selector no participa de la altura desplazable. El resumen y el esfuerzo no tienen scroll si caben; la lista sí cuando lo necesita. Al filtrar se reduce el panel.

Bordes, radios y fondos de hover consumen los mismos tokens tanto en la maqueta como en el adaptador Shadow DOM del selector. El ZIP original permanece intacto.
