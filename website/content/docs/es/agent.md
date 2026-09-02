---
title: El agente
description: Qué es el agente integrado, en qué se diferencian los modos de operación y cómo fluye una conversación desde el pedido hasta el commit revisado.
---

El agente de OpenIDE es una contribución nativa del workbench, no una extensión. Vive en `vscode/src/vs/workbench/contrib/openideAgent/` y se ejecuta con el mismo acceso que tiene el editor: archivos, terminales, el índice del language server, git, un navegador local y la interfaz de configuración. Como es parte del producto, puede ofrecer superficies que una extensión no puede, como un editor de planes, un editor de canvas y una memoria persistente de tu código.

## Dónde vive

El chat se abre en el panel derecho (la barra auxiliar). Ejecutá **OpenIDE: New Chat** desde la Paleta de comandos o hacé clic en el ícono del agente. Cada conversación es una sesión; podés bifurcar una con **OpenIDE: Fork Chat** para explorar una alternativa sin perder el hilo original.

El encabezado del chat muestra el proveedor y el modelo activos. Usá **OpenIDE: Select Provider** para cambiar; mirá [Proveedores](/docs/agent-providers/).

## Modos de operación

| Modo | Qué hace el agente | Cuándo usarlo |
| --- | --- | --- |
| **Agent** | Ejecuta: lee, edita, corre comandos y delega a subagentes cuando una tarea es clara. | Un cambio concreto que querés que se haga. |
| **Plan** | Solo lectura. Produce un plan de implementación completo que revisás antes de que se escriba código. | Cambios grandes o riesgosos, cualquier cosa que quieras diseñar primero. |
| **Ask** | Solo lectura. Responde preguntas usando las herramientas de lectura, sin editar. | Entender código, obtener explicaciones. |
| **Ultracode** | Orquestación multiagente para tareas grandes que se benefician de workers en paralelo. | Refactors amplios, trabajo que se divide en partes independientes. |
| **Fork** | Bifurca la conversación actual en una nueva sesión con el mismo contexto. | Probar un enfoque alternativo. |

El agente también puede sugerir un modo mejor para el pedido actual: cuando un mensaje en modo *Ask* en realidad pide un cambio, ofrece cambiar a *Agent* con el pedido ya delimitado.

## Del pedido al commit

1. **Contexto.** El agente lee el mapa del proyecto desde la [memoria del código](/docs/agent-workspace/#memoria-del-c-digo), los skills que aplican, las reglas siempre activas y lo que hayas adjuntado (archivos, selecciones, elementos de Pick & Polish).
2. **Trabajo.** En modo *Agent* edita archivos y corre comandos con las [herramientas del workspace](/docs/agent-workspace/). Las tareas largas se pueden delegar a subagentes con permisos aislados y, opcionalmente, sus propios worktrees de git.
3. **Revisión.** Antes de que se confirme nada, una pasada de revisión adversarial examina el diff de los archivos explícitos con un contexto aislado y reporta problemas. La vista de revisión de cambios te permite recorrer bloques (*Next block*, *Previous block*) y aceptarlos o revertirlos atómicamente.
4. **Commit.** El flujo seguro de git produce commits atómicos; nada se pushea sin tu intervención.

## Gestión de contexto

Cada proveedor tiene una ventana de contexto. A medida que la conversación se acerca al límite, el agente la compacta automáticamente, resumiendo los turnos más viejos con un modelo de resumen configurable. Controlás los presupuestos de tokens de entrada y salida desde la configuración. Usá **OpenIDE: Show Context** para inspeccionar qué está viendo el modelo actualmente, y **OpenIDE: Show Usage** para el medidor de uso del proveedor activo (`openide.agent.showUsage`, `openide.agent.usage.pollMinutes`).

## Voz

`openide.agent.voiceMode` habilita el dictado en el compositor. El botón de micrófono transcribe hacia el campo de entrada; nada se envía hasta que enviás el mensaje.

## Notificaciones

Las tareas largas notifican cuando terminan. `openide.agent.notifications.sound` alterna el sonido; **OpenIDE: Test Notification** lo previsualiza.

## Comandos rápidos

Los prompts reutilizables viven en `.openide/quick-commands.json` y aparecen como comandos (`openide.agent.runQuickCommand`). Creálos desde la interfaz de configuración (sección *Commands*) o editando el archivo.

## Extender el agente

Los servidores MCP, hooks de shell, skills, reglas y subagentes personalizados están cubiertos en [Extensibilidad](/docs/agent-extensibility/).
