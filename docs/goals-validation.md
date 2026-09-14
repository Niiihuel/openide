# Validación de GOAL y corrección de PTY

Fecha: 8 de septiembre de 2026. Checkout de desarrollo; la instalación AppImage anterior no contiene estos cambios.

## Error reportado de terminal

El error `The terminal process identity was not confirmed by the native PTY backend` afectaba al harness al invocar `git_status` y comandos en segundo plano. El renderer recibía el evento de proceso preparado por un canal distinto del observado por el propietario en el proceso principal. El registro podía llegar antes que la confirmación del otro canal.

La corrección consulta el PID vivo al backend PTY y vuelve a comprobarlo después de asociar el shell. Conserva las comprobaciones de directorio, propietario e identidad; no acepta un PID proporcionado por el renderer como única prueba.

Una regresión reproduce el fallo con el propietario anterior. El ensayo gráfico usa el IDE real, una respuesta de modelo controlada y un servidor de prueba: comprueba `git_status`, arranque de background, identidad del proceso y desaparición del hijo al cerrar su propietario.

## Ensayos reproducibles

Desde la raíz del repositorio, dentro del entorno FHS configurado:

```bash
./result-fhs/bin/openide-build -c 'npm --prefix vscode run typecheck-client'
./result-fhs/bin/openide-build -c 'npm --prefix vscode run valid-layers-check'
./result-fhs/bin/openide-build -c 'npm --prefix vscode run transpile-client'
./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-goal-runtime.mjs dev/test-terminal-runtime.mjs'
OPENIDE_TEST_CODEX="$(command -v codex)" ./result-fhs/bin/openide-build -c 'node dev/test-codex-goal-transport.mjs'
OPENIDE_TEST_CODEX="$(command -v codex)" ./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-codex-goal-runtime.mjs'
```

El wrapper gráfico usa Xvfb para no abrir ventanas en el escritorio de trabajo. Los ensayos de transporte y gráficos de Codex requieren `OPENIDE_TEST_CODEX` con la ruta del ejecutable instalado. Los scripts usan datos temporales y proveedores locales de prueba; no cambian la autenticación personal ni requieren consumir créditos de modelos.

| Superficie | Qué comprueba |
| --- | --- |
| Store y owner | Diario durable, recuperación tras interrupción, revisión esperada, exclusión entre propietarios y rechazo de corrupción. |
| Supervisor | Cierre con recibos, verificación fallida, pausa concurrente, límite de turnos, repetición, revisión del contrato, evidencia obsoleta, buffers sin guardar, trabajo background y cambio de workspace durante I/O. |
| Markdown y MCP | Parser de contrato, reportes externos declarados sin autoridad de verificación, rechazo de IDs antiguos o ajenos a la ventana. |
| Diffs | Cadena antes/después, identidad de ejecución, límites de captura y señalización de omisiones. |
| UI y Project Map | Persistencia visual, reanudación con contrato actual, disponibilidad por adaptador, evidencia vigente y enlaces documentales dentro del workspace. |
| IDE nativo real | Crear, pausar, recargar, reanudar, rechazar una afirmación de éxito con verificación fallida, continuar hasta un recibo válido y abrir la comparación capturada. |
| Codex real | Servidor privado, terminal conectada al mismo hilo, configuración conservada, turno estructurado contra Responses local y aprobación real antes de ejecutar un comando que crea un archivo. |

Las suites están junto al código en `vscode/src/vs/platform/openideAgentHost/test` y `vscode/src/vs/workbench/contrib/openideAgent/test`. El runner de Node admite varios selectores `--run`; `--runGlob` acepta un único patrón.

## Alcance de la evidencia

Los proveedores simulados permiten forzar afirmaciones de éxito prematuras, fallos y pausas. No evalúan la calidad de razonamiento de un modelo comercial. El transporte se prueba con el ejecutable Codex instalado; la adaptación a otras versiones se habilita por las capacidades que anuncian y verifican al conectar.

Los Markdown y los nodos del mapa son inspeccionables y reconstruibles. La aceptación del objetivo depende del estado privado y los recibos del host. Las restricciones operativas y de captura se describen en [la guía de uso](goals.md).
