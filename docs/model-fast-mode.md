# Fast mode por modelo

El rayo del selector solicita procesamiento prioritario para el modelo elegido. Está desactivado por defecto; activarlo puede incrementar el consumo. No cambia el esfuerzo de razonamiento ni garantiza una multiplicación fija de velocidad.

## Implementación actual

- La API compartida ofrece `getFastModeCapability(providerId?, model?)`, `getFastMode(providerId?, model?)` y `setFastMode(enabled, providerId?, model?)`.
- Codex conectado por OAuth obtiene la capacidad del catálogo vivo de la cuenta: sólo modelos visibles con `service_tiers` que incluyan `id: priority`. No se infiere por nombres GPT, etiquetas ni metadatos de otro endpoint/proveedor.
- La elección se guarda por proveedor/modelo en almacenamiento local del IDE, separada del esfuerzo. El estado desconocido o no compatible impide activarla. No se escribe la configuración de Codex CLI ni se cambia globalmente la cuenta.
- Al enviar, el harness propaga `serviceTier` al adaptador. Codex verifica de nuevo la capacidad y sólo entonces serializa `service_tier: priority`. Al desactivar se omite el campo, conservando el comportamiento anterior del proveedor.
- Los cambios de cuenta limpian capacidades; un error de descubrimiento no mantiene permisos de velocidad antiguos. El diario de peticiones incluye la selección solicitada.
- El proveedor puede limitar o rechazar el tier; la UI indica la opción solicitada, no una medición de velocidad ni confirmación de tier facturado.

Los demás adaptadores permanecen sin capacidad Fast publicada hasta implementar su contrato y comprobarlo para sus modelos/cuentas. En particular, no se traduce automáticamente Fast a menos esfuerzo, otro modelo o parámetros desconocidos. El soporte del endpoint compatible con OpenAI por sí solo no prueba soporte prioritario.

## Evidencia y límites

[OpenAI: Fast mode](https://openai.com/api-fast-mode/) documenta `service_tier` y precios específicos; [Codex: Speed](https://developers.openai.com/codex/speed) distingue velocidad de razonamiento. [Anthropic: Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) requiere una configuración de modelo/acceso propia y describe casos que vuelven a velocidad estándar. Revisado el 8 de septiembre de 2026. La implementación actual usa el catálogo vivo de Codex para no fijar una lista de modelos que se vuelva obsoleta.

## Validación

Pruebas con fixtures, sin peticiones a modelos ni consumo facturable:

- Catálogo sin datos, modelos ocultos, desconocidos o sólo con nombre GPT no habilitan Fast.
- Aislamiento por proveedor/endpoint; fallo de catálogo y cambio de cuenta limpian capacidad.
- Request estándar → priority explícito compatible → estándar omite nuevamente el campo; modelo no compatible nunca serializa prioridad.
- Estado inicial apagado, persistencia independiente por modelo, restauración y apagado; valores almacenados inválidos no activan pagos.

La verificación nativa adicional consiste en abrir un modelo compatible, alternar el rayo y comprobar su estado al reabrir; no hace falta enviar una petición paga para verificar esa interacción.
