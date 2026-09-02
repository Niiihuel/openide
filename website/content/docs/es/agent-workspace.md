---
title: Herramientas del workspace
description: Archivos, comandos, navegación del código, flujo de git, la vista previa de localhost, Pick & Polish, planes, canvas y memoria del código.
---

Como el agente corre dentro del workbench, sus herramientas son servicios nativos en lugar de scripts de shell. Esta página describe qué puede tocar y las superficies construidas sobre eso.

## Archivos y comandos

- **Leer y editar archivos** pasa por el servicio de archivos del editor, así que las ediciones aparecen como diffs que podés revisar bloque por bloque antes de aceptarlas.
- **Ejecutar comandos** usa una terminal integrada. La salida se captura para el modelo; los procesos de larga duración se pueden detener desde el chat.
- **Aprobaciones.** Las acciones que salen del workspace o son difíciles de deshacer piden consentimiento. Tus respuestas se pueden recordar por proyecto.

## Navegación del código

El agente no hace grep a ciegas. Consulta el **Project Map**, un índice construido a partir del language server (símbolos, referencias, imports) y persistido bajo `.openide/`. Dos herramientas se apoyan en él:

- Una búsqueda rápida de símbolos por nombre, opcionalmente filtrada por tipo (clase, función, método, interfaz).
- Un análisis de impacto que reporta dependientes directos y transitivos y tests relacionados antes de modificar un símbolo.

Cuando el índice no tiene respuesta, el agente recurre a la búsqueda textual; `openide.memory.enableRegexFallback` controla eso.

## Flujo de git

El flujo seguro de git produce commits atómicos: un cambio lógico por commit, staged desde los archivos explícitos que tocó el agente. Los subagentes pueden trabajar en worktrees aislados (`openide.subagents.useWorktrees`) para que el trabajo en paralelo nunca colisione en la copia de trabajo. El agente no pushea ni hace force-push de nada.

## Vista previa de localhost

**OpenIDE: Local Preview** (`openide.localPreview`) abre un navegador integrado para tu app en ejecución. El agente puede:

- tomar capturas de pantalla y snapshots de accesibilidad de la página,
- abrir DevTools,
- interactuar con la vista previa visible a través de Playwright (clic, tipeo, navegación).

Solo se pueden abrir los hosts listados en `openide.agent.browserAllowedHosts`. La automatización corre en el proceso principal (`platform/openideBrowser`) con la misma página que ves.

## Pick & Polish

Ejecutá **OpenIDE: Pick Element** (`openide.agent.pickElement`) y hacé clic en un elemento de la vista previa. Su selector, HTML, estilos calculados y una captura de pantalla se adjuntan al chat, así podés pedir un cambio visual con el elemento exacto en contexto. Esta es la forma más rápida de refinar detalles de UI.

## Planes

El modo *Plan* escribe un plan de implementación completo en `.openide/plans/<slug>.md`. Los planes se abren en un editor dedicado (**OpenIDE: Open Plan**, `openide.plan.open`) con:

- tareas interactivas que podés marcar,
- una selección de modelo por plan para la ejecución (`openide.plan.execModel`),
- una acción *Build* que inicia la ejecución del plan en modo *Agent* (`openide.plan.build`).

Los planes son Markdown, así que se pueden revisar en un pull request como cualquier otro archivo.

## Canvas

Un canvas es un artefacto analítico visual almacenado como `.openide/canvases/<name>.canvas.tsx`. Puede contener tablas, gráficos y diagramas independientes construidos a partir de datos que el agente recolectó. Abrí uno con **OpenIDE: Open Canvas** (`openide.canvas.open`). Los diagramas se pueden expandir a pantalla completa (`openide.diagram.fullscreen`), y el comando *Architecture map* (`openide.archmap.project`) produce un diagrama de la estructura del proyecto.

## Memoria del código

OpenIDE mantiene dos tipos de memoria:

- **Hechos duraderos** en `.openide/MEMORY.md`: convenciones, decisiones y preferencias que el agente guarda con tu consentimiento y vuelve a leer en cada sesión. Los hechos a nivel de proyecto se versionan con el repositorio; los hechos a nivel de usuario quedan en tu perfil.
- **El grafo del código**, un índice persistente de entidades y relaciones en el proyecto. **OpenIDE: Open Memory** (`openide.memory.open`) lo muestra como un grafo 3D en WebGL. `openide.memory.include`, `openide.memory.exclude` y `openide.memory.indexTests` controlan qué se indexa; `openide.memory.indexOnOpen` reconstruye al iniciar, y **OpenIDE: Rebuild Memory** fuerza una reconstrucción. `openide.memory.persistIndex` mantiene el índice en disco entre sesiones.

Los índices pesados viven en `.openide/memory-indexes/` y `.openide/codegraph/`, que están ignorados por git. El contenido escrito a mano (`MEMORY.md`, skills, planes) se versiona.

## Revisión de cambios

Cada edición hecha por el agente llega a la vista de revisión de cambios. Recorré los bloques con *Next block* y *Previous block*, aceptá los que querés y revertí el resto. El rollback a nivel de mensaje restaura el workspace al estado previo a un turno dado, atómicamente.
