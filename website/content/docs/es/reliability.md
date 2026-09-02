---
title: Gates de confiabilidad
description: El registro de invariantes críticos que deben cumplirse antes de un release, sus niveles de madurez y la política para cambiarlo.
---

OpenIDE registra sus invariantes críticos en `dev/reliability-gates.json`. El registro no reemplaza a los tests: documenta qué propiedad se protege, quién es responsable, qué comandos la verifican, qué brechas siguen abiertas y bajo qué condición el gate pierde madurez.

## Madurez

- `experimental`: existe cobertura inicial, pero todavía no protege merges o releases.
- `soak`: el contrato y sus pruebas son estables; falta evidencia sostenida o cobertura de plataforma.
- `blocking`: todos los criterios de promoción están demostrados, el comando corre en la CI o el workflow de release correspondiente, y un fallo reproducible bloquea merge o release.

`promotionCriteria` enumera las condiciones todavía necesarias para el siguiente nivel. Por lo tanto, debe ser no vacío en `experimental` y `soak`, y estar vacío en `blocking`; el validador rechaza cualquier combinación contradictoria. La madurez no puede ocultar un fallo conocido: si se viola `demotionRule`, el gate debe degradarse y abrirse una tarea de corrección antes de volver a promoverlo.

## Validación local

```bash
node dev/check-reliability-gates.mjs
node --test dev/reliability-gates.test.mjs
```

El validador exige:

- un schema conocido y campos estrictos;
- IDs únicos en kebab-case;
- owner, layer, invariant y demotion rule no vacíos;
- valores de maturity y plataformas permitidos;
- comandos y criterios explícitos;
- paths de tests relativos, seguros y existentes.

No ejecuta automáticamente los comandos declarados. La CI y los workflows de release deben invocar los comandos relevantes para su capa.

## Política de cambios

Todo cambio que agregue una superficie crítica debe:

1. crear o actualizar un gate;
2. incluir tests reproducibles;
3. declarar brechas reales, no aspiracionales;
4. mantener paths concretos y vigentes;
5. definir cuándo debe bloquearse o degradarse;
6. evitar métricas personales, prompts, código o telemetría de producto.

## Alcance inicial

El registro comienza con:

- updater firmado y anti-rollback;
- actualización y recovery de AppImage;
- rollback atómico de mensajes;
- lifecycle de procesos de MCP y Agent Host;
- auditoría de branding distribuido.

Se va a extender progresivamente a smoke tests de paquetes, subagent leases, provenance de extensiones y skills, privacidad de red, terminal recovery y artefactos legales.

## Exploración web del agente

`web_search` y `web_fetch` usan un downloader headless separado de la preview de localhost. La frontera autoritativa vive en el proceso principal de Electron y aplica validación HTTPS, resolución DNS por salto, bloqueo de direcciones loopback, LAN, link-local y de metadata, redirects manuales, un timeout total, chequeos de content-type y límites de bytes y caracteres. No se comparten cookies, sesiones ni credenciales del browser visible. Los resultados entregan citas `[S#]` y `[W#]`; el contenido no se persiste fuera del transcript del modelo y las API keys no deben viajar en URLs ni en logs. La implementación es de extracción estática: no ejecuta JavaScript, no resuelve CAPTCHAs ni paywalls y no hace crawling sin límites.

## Agent Host y MCP

El gate `agent-host-process-lifecycle` cubre una primera capa de hardening:

- environment heredado allowlisted;
- bloqueo de `NODE_OPTIONS`, loaders, `NODE_PATH` y CA overrides;
- validación de args y valores de entorno;
- tamaño máximo de frames JSON-RPC y respuestas HTTP/SSE;
- cantidad y bytes máximos de requests stdio en vuelo;
- logs stderr acotados y creados con permisos restrictivos;
- input/output acotado para hooks;
- connect/tool deadlines;
- keepalive, backoff host-side y parking;
- limpieza del árbol de procesos en disconnect, timeout o shutdown.

El gate permanece en `experimental` hasta contar con pruebas Electron multiproceso de kill-tree, timeout, SSE incremental, disconnect HTTP y crash loop en las tres plataformas. Workspace Trust bloquea la configuración MCP del proyecto; el consentimiento persistente ligado a un fingerprint de command, URL, environment y headers se implementará junto con el bloque de provenance de extensiones y skills.
