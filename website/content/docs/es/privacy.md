---
title: Privacidad
description: Qué envía OpenIDE por la red, qué nunca envía, y quién recibe lo que escribís en el agente.
---

OpenIDE no incluye los endpoints de telemetría propietarios de Microsoft. Las verificaciones de actualización consultan exclusivamente el feed firmado del repositorio `Niiihuel/openide` y GitHub Releases. Solo se envían los datos técnicos requeridos para HTTP (versión del producto, sistema operativo y arquitectura en el User-Agent); nunca se incluyen prompts, código, contenido del workspace, credenciales ni identificadores personales.

## Qué se comunica con la red

| Conexión | Propósito | Cómo deshabilitarla |
| --- | --- | --- |
| Feed de actualizaciones en GitHub | Verificar nuevos releases firmados | `update.mode`: `manual` o `none` |
| Open VSX | Buscar, instalar y actualizar extensiones | `extensions.autoCheckUpdates`, `extensions.autoUpdate` |
| Lista de control de extensiones | Definiciones de extensiones maliciosas y obsoletas | `extensions.excludeUnsafes` (no recomendado) |
| Anuncios de la página de bienvenida | Noticias obtenidas del repositorio | `workbench.welcomePage.extraAnnouncements` |
| Proveedores de IA | Solo los proveedores que habilités, solo para el chat que estés usando | Eliminar el proveedor |
| Servidores MCP, hooks, herramientas web | Solo lo que configurés y apruebes | Consultá [Extensibilidad](/docs/agent-extensibility/) |

La página de [Telemetría](/docs/telemetry/) enumera la configuración que está apagada por defecto y cómo verificar que no se envíe nada más.

## Proveedores de IA y extensiones

Los proveedores de IA y las extensiones instaladas tienen sus propias políticas y conexiones. OpenIDE muestra y gestiona las credenciales localmente, pero el uso de cada proveedor está regido por sus términos. Cuando enviás un mensaje, el agente transmite el prompt, las partes del workspace que necesita (archivos que lee, salida de comandos, capturas de la vista previa) y los resultados de las herramientas al proveedor seleccionado para esa conversación, y a nadie más.

La exploración web del agente (`web_search`, `web_fetch`) pasa por un descargador headless separado que no comparte cookies, sesiones ni credenciales con el navegador visible, y cuyos resultados no se persisten fuera de la transcripción del modelo.

## Credenciales

Las claves de API y los tokens de OAuth se guardan en el llavero (keyring) del sistema operativo a través de `SecretStorage`. Nunca aparecen en `settings.json`, así que la sincronización de configuración no las transporta.

## Datos locales

Todo lo que el agente aprende sobre tu proyecto se queda en el proyecto: `.openide/MEMORY.md`, los planes, canvases y skills son archivos que podés leer, editar y borrar. Los índices derivados bajo `.openide/memory-indexes/` y `.openide/codegraph/` están ignorados por git y se pueden reconstruir en cualquier momento.

## Reportar una inquietud

Si creés que OpenIDE contacta a un servicio al que no debería, abrí un issue en el [repositorio](https://github.com/Niiihuel/openide/issues) con el host y el contexto. La privacidad de red es uno de los invariantes que monitorean los [gates de confiabilidad](/docs/reliability/).
