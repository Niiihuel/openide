---
title: Telemetría
description: Qué configuraciones de telemetría están deshabilitadas por defecto, qué reemplaza a los servicios en línea de Microsoft, y cómo verificarlo vos mismo.
---

Esta página explica cómo OpenIDE maneja la telemetría y cómo mejora tu privacidad.

## Telemetría en OpenIDE

Aunque no se pasan los build flags de telemetría y la telemetría integrada está inutilizada a propósito, algunas configuraciones todavía podrían permitir el seguimiento del uso. OpenIDE deshabilita todo lo siguiente por defecto:

```text
telemetry.telemetryLevel
telemetry.enableCrashReporter
telemetry.enableTelemetry
telemetry.editStats.enabled
workbench.enableExperiments
workbench.settings.enableNaturalLanguageSearch
workbench.commandPalette.experimental.enableNaturalLanguageSearch
```

También se recomienda revisar cada configuración que "usa servicios en línea" siguiendo [estas instrucciones](https://code.visualstudio.com/docs/getstarted/telemetry#_managing-online-services). Usá el filtro de búsqueda `@tag:usesOnlineServices` para listarlas y decidir qué cambiar.

**Algunas extensiones también envían datos de telemetría a Microsoft. OpenIDE no tiene control sobre esto y solo puede recomendar eliminar la extensión.** Por ejemplo, la extensión de C# `ms-vscode.csharp` envía datos de seguimiento. Revisá la página de configuración de cada extensión para deshabilitar su telemetría cuando sea posible.

### Servicios de actualización

Por defecto, la aplicación verifica periódicamente la última versión disponible para descargar e instalar, y las extensiones se revisan de vez en cuando para ver si hay actualizaciones. Para evitar esto, cambiá las siguientes preferencias.

Para la aplicación en sí:

- `update.mode` → `manual` (o `none`)
- `update.enableWindowsBackgroundUpdates` → `false` (solo Windows)

Para las extensiones:

- `extensions.autoUpdate` → `false`
- `extensions.autoCheckUpdates` → `false`

En Linux el actualizador solo reemplaza un AppImage; las instalaciones por paquete se actualizan mediante el gestor de paquetes sin importar `update.mode`.

### Telemetría de feedback

La preferencia `telemetry.feedback.enabled` permanece habilitada. Solo permite que aparezca el botón *Report Issue…* donde tiene sentido; no envía datos por sí misma (las otras opciones ya cubren eso). Desactivala si preferís.

## Reemplazos a los servicios en línea de Microsoft

Al buscar con el filtro `@tag:usesOnlineServices`, tené en cuenta que la descripción de *Update: Mode* todavía dice "the updates are fetched from a Microsoft online service". OpenIDE establece `updateUrl` en `product.json` apuntando a su propio feed de releases, así que habilitar esa configuración no llama a Microsoft.

Del mismo modo, las descripciones de *Extensions: Auto Check Updates* y *Extensions: Auto Update* incluyen la misma frase, pero OpenIDE apunta `extensionsGallery` a Open VSX en lugar de Visual Studio Marketplace, así que estas configuraciones tampoco llaman a Microsoft.

## Verificar la telemetría

Para verificar que no se esté enviando telemetría, usá una herramienta de monitoreo de red como:

- Wireshark
- Little Snitch (macOS)
- GlassWire (Windows)

Buscá conexiones a dominios de Microsoft y endpoints de telemetría.

## Anuncios de OpenIDE

La página de bienvenida muestra anuncios obtenidos del repositorio de GitHub del proyecto. Deshabilitá la preferencia `workbench.welcomePage.extraAnnouncements` para desactivar esto.

## Extensiones maliciosas y obsoletas

Las definiciones de extensiones maliciosas y obsoletas se cargan dinámicamente desde:

```text
https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json
```

Si preferís evitar cualquier conexión externa, podés deshabilitar la preferencia `extensions.excludeUnsafes`. Esto no se recomienda, ya que reduce la seguridad de tu entorno.
