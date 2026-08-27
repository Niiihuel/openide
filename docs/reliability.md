# Confiabilidad de OpenIDE

OpenIDE registra sus invariantes críticos en `dev/reliability-gates.json`. El registro no reemplaza a los tests: documenta qué propiedad se protege, quién es responsable, qué comandos la verifican, qué brechas siguen abiertas y bajo qué condición el gate pierde madurez.

## Madurez

- `experimental`: existe cobertura inicial, pero todavía no protege merges o releases.
- `soak`: el contrato y sus pruebas son estables; falta evidencia sostenida o cobertura de plataforma.
- `blocking`: todos los criterios de promoción están demostrados, el comando corre en la CI/release correspondiente y un fallo reproducible bloquea merge o release.

`promotionCriteria` enumera condiciones todavía necesarias para el siguiente nivel. Por lo tanto, debe ser no vacío en `experimental`/`soak` y estar vacío en `blocking`; el validador rechaza cualquier combinación contradictoria. La madurez no puede ocultar un fallo conocido. Si se viola `demotionRule`, el gate debe degradarse y abrirse una tarea de corrección antes de volver a promoverlo.

## Validación local

```sh
node dev/check-reliability-gates.mjs
node --test dev/reliability-gates.test.mjs
```

El validador exige:

- schema conocido y campos estrictos;
- IDs únicos en kebab-case;
- owner, layer, invariant y demotion rule no vacíos;
- maturity y plataformas permitidas;
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
- actualización/recovery AppImage;
- rollback atómico de mensajes;
- lifecycle de procesos MCP/Agent Host;
- auditoría de branding distribuido.

Se ampliará progresivamente a package smoke, subagent leases, extension/skill provenance, privacidad de red, terminal recovery y artefactos legales.

## Exploración web del agente

`web_search` y `web_fetch` usan un downloader headless separado de la preview localhost. La frontera autoritativa vive en Electron main y aplica validación HTTPS, resolución DNS por salto, bloqueo de loopback/LAN/link-local/metadata, redirects manuales, timeout total, content-types y límites de bytes/caracteres. No se comparten cookies, sesiones ni credenciales del browser visible. Los resultados entregan citas `[S#]` y `[W#]`; el contenido no se persiste fuera del transcript del modelo y las API keys no deben viajar en URLs ni logs. La implementación es extracción estática: no ejecuta JavaScript, no resuelve CAPTCHA/paywalls y no hace crawling ilimitado.

## Agent Host/MCP

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
- limpieza del árbol de procesos en disconnect/timeout/shutdown.

El gate permanece en `experimental` hasta contar con pruebas Electron multiproceso de kill-tree, timeout, SSE incremental, disconnect HTTP y crash-loop en las tres plataformas. Workspace Trust bloquea la configuración MCP del proyecto; el consentimiento persistente ligado a un fingerprint de command/url/env/headers se implementará con el bloque de provenance de extensiones y skills.
