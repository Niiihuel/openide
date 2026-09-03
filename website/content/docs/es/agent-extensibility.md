---
title: MCP, hooks, skills y subagentes
description: Extendé el agente con servidores del Model Context Protocol, hooks de shell, skills de proyecto, reglas siempre activas y subagentes personalizados, todo con consentimiento explícito.
---

Todo lo de esta página vive bajo `.openide/` en tu proyecto (o en tu perfil de usuario) y es opt-in. El agente nunca ejecuta un servidor, un hook o un subagente que no hayas aprobado.

## Servidores MCP

Los servidores del Model Context Protocol se declaran en `.openide/mcp.json`. Agregá uno desde la interfaz de configuración (sección *MCP*) o con **OpenIDE: Add MCP Server**; **OpenIDE: Reload MCP** (`openide.agent.reloadMcp`) los reinicia después de editar el archivo. `openide.agent.mcp.enabled` activa y desactiva la función globalmente.

Cada servidor se inicia con un entorno restringido a una lista permitida: `NODE_OPTIONS`, loaders, `NODE_PATH` y overrides de CA están bloqueados, los argumentos y valores de entorno se validan, los frames de JSON-RPC y las respuestas HTTP/SSE tienen límites de tamaño, y el árbol de procesos se limpia al desconectar, por timeout o al apagar. Workspace Trust controla la configuración del proyecto: una carpeta no confiable no puede iniciar servidores.

Las herramientas expuestas por un servidor aparecen en el catálogo del agente con su nombre exacto. OpenIDE mismo se puede registrar como servidor MCP para otras herramientas (`openide.ide.registerMcp`), y el servicio de diagramas se puede exportar como una configuración MCP (`openide.agent.copyDiagramsMcpConfig`).

## Hooks

Los hooks de shell del usuario en `.openide/hooks.json` se ejecutan en puntos definidos del ciclo de vida del agente (antes de que corra una herramienta, después de una edición, cuando termina una sesión). Cada hook debe ser **aprobado** explícitamente la primera vez que se ve (`openide.hooks.approve`) y se puede revocar en cualquier momento (`openide.hooks.revoke`). La entrada y salida de un hook están acotadas, y un hook que falla no bloquea al agente silenciosamente.

Los hooks escritos para otras CLI de agentes se pueden reutilizar: el directorio `.openide/agent-hooks/` contiene adaptadores (por ejemplo `.openide/agent-hooks/claude/`).

## Skills

Un skill es un procedimiento reutilizable de proyecto almacenado como `.openide/skills/<name>/SKILL.md`: una descripción de una línea con palabras clave más las instrucciones completas. El agente indexa los skills al comienzo de una sesión e **inyecta automáticamente los que aplican** a la tarea actual; también podés seleccionar uno explícitamente desde el compositor.

Creá skills desde la interfaz de configuración (sección *Skills*) o pedile al agente que guarde un procedimiento que acaba de seguir. Los nombres son kebab-case. `openide.agent.disabledSkills` desactiva skills individuales sin borrarlos. Los skills también se pueden instalar desde un catálogo (`openide.skills.install`).

## Reglas

Las reglas son archivos Markdown siempre activos en `.openide/rules/` que el agente lee en cada turno: estándares de código, patrones prohibidos, checklists de revisión. Creá una con **OpenIDE: New Rule** o desde la interfaz de configuración. Mantenelas cortas; las reglas largas cuestan contexto en cada mensaje.

## Subagentes

El agente puede delegar una tarea especializada a un subagente registrado con permisos aislados y, opcionalmente, su propio worktree de git. Las definiciones viven en `.openide/agents/` (proyecto) o en tu perfil (usuario) y contienen una descripción, un system prompt especializado y una preferencia de ejecución (foreground o background).

- `openide.subagents.enabled` activa la delegación.
- `openide.subagents.allowWritable` debe estar en `true` antes de que se pueda crear un subagente que edite archivos.
- `openide.subagents.maxParallelRuns`, `openide.subagents.maxDepth` y `openide.subagents.defaultTimeoutMinutes` acotan el trabajo.
- `openide.subagents.useWorktrees` le da a cada subagente su propio worktree.
- `openide.subagents.routing.*` permite que una política de enrutamiento elija el subagente automáticamente (`policy`, `preset`, `maxAttempts`).

Creá o editá un subagente con **OpenIDE: Create Subagent** (`openide.subagent.create`) y abrí su definición con `openide.subagent.openEditor`.

## Exploración web

`web_search` y `web_fetch` usan un descargador headless separado de la vista previa de localhost. `openide.agent.web.enabled` los activa; `openide.agent.web.allowedHosts`, `openide.agent.web.blockedHosts` y `openide.agent.web.allowHttp` los delimitan, y `openide.agent.web.searchEndpoint` selecciona el backend de búsqueda. El descargador valida HTTPS, resuelve DNS por cada salto, bloquea direcciones de loopback, LAN, link-local y de metadata, sigue redirecciones manualmente y limita timeouts y tamaños. Los resultados llevan citas y nada se persiste fuera de la transcripción del modelo.

## Modelo de consentimiento

Cada integración de arriba está deshabilitada hasta que la habilitás, y la configuración a nivel de proyecto solo se respeta en un workspace confiable. Las aprobaciones están atadas a una huella del comando, la URL, el entorno y los headers, así que un cambio en cualquiera de ellos vuelve a preguntar.
