# Historial de conversaciones

El historial conserva las sesiones locales al workspace y ahora muestra filas compactas: título truncado en una línea, estado y tiempo relativo. Las acciones existentes aparecen al hover o al foco por teclado: marcar leída, archivar/restaurar, cerrar un CLI abierto y eliminar con su confirmación habitual.

Los grupos usan carpetas reales del workspace y el `cwd` registrado por los CLIs. Si varias carpetas están abiertas y una conversación nativa no tiene atribución propia, aparece en «Espacio de trabajo». No se adivina su proyecto ni se anuncian sesiones de otros workspaces. Las conversaciones fijadas se persisten y aparecen en su propio grupo en el sidebar del agente.

Un único hover nativo por fila presenta el título completo, carpeta, proveedor CLI cuando corresponda, estado y tiempo. El servicio del IDE controla demora, indicador y permanencia al pasar a la tarjeta; el borde y radio son compartidos. Los eventos sin cambios no reconstruyen la fila, manteniendo estable el target del hover.

La búsqueda coincide con título, carpeta/ruta o CLI. Se conservan selección activa, foco tras archivar y composición IME. Los botones de acciones son hermanos del botón principal, evitando activación accidental de la conversación al archivarla por teclado.

Validado con seis pruebas Chromium headless del pane: activación independiente de archivo, restauración de foco, búsqueda/IME, agrupamiento sin atribución falsa, preview único/target estable y búsqueda por ruta. La inspección visual final se realiza en OpenIDE Dev sin alterar sesiones reales.

## Cabecera y escala de iconos

Las pestañas de conversación muestran el título y, cuando corresponde, el indicador de estado; el proveedor sigue disponible en el tooltip. Se retiró el icono decorativo anterior de conversaciones nativas y CLIs. Las acciones de cabecera y composer comparten `--oi-icon-action` (18 px), mientras enviar usa `--oi-icon-send` (20 px). Los targets de cabecera son de 24 px; los indicadores de estado y elementos informativos no se agrandan como botones.


## Sidebar del agente: lectura y movimiento

La cabecera de cada proyecto separa grupos con espacio, conserva el contador y permite contraerlos. Las conversaciones mantienen una línea, una selección neutra con marca discreta y el mismo componente `oi-dock-row`. El tiempo relativo vuelve a estar visible en reposo; actividad y mensajes no leídos tienen prioridad. Al pasar el puntero o enfocar con teclado, las acciones reemplazan visualmente al tiempo en una zona reservada: el título no cambia de ancho. La transición afecta sólo a la opacidad y se elimina al activar movimiento reducido.

«Nuevo chat» y el selector de agente comparten una superficie continua, usando los botones existentes. Se conservan búsqueda nativa, fijados, archivados, renombrado, subagentes y limitación inicial a seis conversaciones por grupo. Cambiar el ancho del sidebar no reconstruye filas.

Referencias de implementación inspeccionadas en `/home/nihuel/projects/personal/refs`:

- `openchamber/packages/ui/src/components/session/sidebar/SessionNodeItem.tsx`: fecha compacta y acciones que aparecen al hover/foco. Se adopta la alternancia con espacio reservado, sin incorporar React ni su store.
- `vscode/src/vs/workbench/contrib/chat/browser/agentSessions/media/agentsessionsviewer.css`: jerarquía de secciones, tipografía de metadatos y toolbar discreta. Se mantienen los componentes nativos de OpenIDE.
- `orca/src/renderer/src/components/sidebar/PendingWorktreeRow.tsx`: contraste entre nombre, metadatos y estados, con selección perceptible. Se adapta al color neutro de OpenIDE, sin copiar anillos ni añadir otra tarjeta por conversación.

Validación focalizada: `dev/test-agent-window-sessions-runtime.mjs` comprueba agrupación, fijado/archivado, renombrado, menú, indicadores, geometría estable al hover, conservación del nodo al redimensionar, foco de acciones, movimiento reducido y ausencia de overflow estrecho. Capturas y resultado en `.build/agent-window-sessions-runtime/`.
