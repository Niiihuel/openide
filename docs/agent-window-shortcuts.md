# Atajos de la ventana Agents

Estos comandos se resuelven con el servicio de teclas nativo y aparecen en la paleta con el prefijo **Agents:**. Se activan mientras la ventana Agents tiene el foco; el editor tradicional conserva sus comandos. En macOS, Cmd sustituye a Ctrl.

| Acción | Windows / Linux | Comando |
| --- | --- | --- |
| Nuevo chat | Ctrl+N | `openide.agentWindow.newChat` |
| Buscar conversaciones | Ctrl+Shift+F | `openide.agentWindow.search` |
| Revisar cambios | Ctrl+Shift+G | `openide.agentWindow.review` |
| Browser | Ctrl+T | `openide.agentWindow.browser` |
| Files | Ctrl+Shift+E | `openide.agentWindow.files` |
| Terminal | Ctrl+` | `openide.agentWindow.terminal` |
| Foco del compositor | Ctrl+Alt+L | `openide.agentWindow.focusChat` |
| Mostrar/ocultar conversaciones | Ctrl+B | `openide.agentWindow.sidebar` |
| Mostrar/ocultar panel de trabajo | Ctrl+Alt+B | `openide.agentWindow.workspace` |
| Preparar exploración | Ctrl+Alt+1 | `openide.agentWindow.explore` |
| Preparar planificación | Ctrl+Alt+2 | `openide.agentWindow.plan` |
| Preparar diagnóstico | Ctrl+Alt+3 | `openide.agentWindow.debug` |

Las tres sugerencias agregan texto al borrador sin enviarlo y no actúan sobre sesiones CLI. Nuevo chat conserva la política existente del borrador compartido. Ctrl+P sigue abriendo la búsqueda de archivos. Los atajos anteriores para terminal y paneles se conservan como comandos compatibles.

Para personalizarlos, abrir Keyboard Shortcuts y buscar el ID del comando. Con `keybindings.json`, usar `"when": "openideAgentWindowId > 0"` mantiene el alcance exclusivo de Agents. Las etiquetas de las filas y tooltips leen la asignación real, incluidas las personalizaciones.

Los launchers reutilizan `OpenideEmptyState`: sin logo en el chat o panel de trabajo, filas discretas y hover inmediato. El panel de trabajo usa sólo acciones; el chat conserva una pregunta breve y las pistas `/` y `@`. El watermark del editor tradicional conserva su identidad. La prueba `dev/test-agent-empty-shortcuts-runtime.mjs` cubre DOM estable durante hover, ejecución de teclas, borrador sin envío, aislamiento respecto del IDE y remapeo de Review.
