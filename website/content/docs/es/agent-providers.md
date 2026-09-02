---
title: Proveedores y modelos
description: Conectá Anthropic, OpenAI, Gemini, OpenRouter, modelos locales y endpoints personalizados; dónde se guardan las credenciales y cómo funciona el failover.
---

El agente habla con los modelos a través de un catálogo de proveedores. Abrilo con **OpenIDE: Open Providers** (`openide.agent.openProviders`) o desde la sección *Providers* de la configuración de OpenIDE.

## Catálogo

| Proveedor | Autenticación |
| --- | --- |
| Anthropic | Clave de API u OAuth |
| OpenAI | Clave de API |
| OpenAI Codex | OAuth (cuenta de Codex) |
| Gemini (Google Cloud Code) | OAuth; configurá `openide.agent.googleCloudProject` cuando tu cuenta tenga varios proyectos |
| GitHub Copilot | OAuth |
| OpenRouter | Clave de API |
| xAI | Clave de API u OAuth |
| MiniMax | Clave de API u OAuth |
| DeepSeek, Mistral, Moonshot, Groq, Cerebras, Together, Fireworks | Clave de API |
| NVIDIA NIM | Clave de API |
| Ollama | Local, sin credenciales |
| Custom | Cualquier endpoint compatible con OpenAI (proxies corporativos, gateways autoalojados) |

La lista de modelos de cada proveedor se obtiene del proveedor cuando es posible y se cachea. Usá la búsqueda de modelos en el panel de proveedores para filtrar por nombre, y la acción de *reintentar* si la lista no se cargó.

## Credenciales

Las claves y los tokens de OAuth van a `SecretStorage`, que es el llavero (keyring) del sistema operativo (GNOME Keyring o KWallet en Linux, Credential Manager en Windows, Keychain en macOS). **Nunca** se escriben en `settings.json`, así que sincronizar tu configuración no las filtra.

En Linux, el almacenamiento local de credenciales solo está disponible cuando hay un keyring de Secret Service corriendo. Si el inicio de sesión falla con un error de llavero, instalá `gnome-keyring` u otro proveedor; mirá [Uso](/docs/usage/#linux).

Usá **OpenIDE: Set API Key** (`openide.agent.setApiKey`) para pegar una clave de un proveedor, o **OpenIDE: Sign In** (`openide.agent.signIn`) para proveedores OAuth. Las sesiones de OAuth se renuevan automáticamente; cuando una sesión no tiene un token válido, el proveedor queda marcado y se te pide que inicies sesión de nuevo.

## Seleccionar un modelo

**OpenIDE: Select Provider** (`openide.agent.selectProvider`) cambia el proveedor y el modelo para el chat actual. Los planes pueden fijar un modelo distinto por plan; mirá [Planes](/docs/agent-workspace/#planes). El modelo de resumen usado para la compactación de contexto es una configuración separada.

## Fallback y failover

`openide.agent.fallbackProviders` y `openide.agent.fallbackChain` definen una lista ordenada de proveedores para probar cuando el activo falla (límite de tasa, caída, respuesta inválida). El cambio se anuncia en el chat y se puede deshacer con **OpenIDE: Undo Account Failover** (`openide.agent.undoAccountFailover`).

## Endpoints personalizados compatibles con OpenAI

Agregá un proveedor *Custom* con la URL base del endpoint y, si hace falta, una clave de API. El agente usa la API de Chat Completions con llamadas a herramientas. Algunos gateways devuelven el razonamiento del modelo en un campo dedicado y dejan `content` vacío; OpenIDE lee ese campo y reintenta sin herramientas cuando un modelo no las soporta, pero el endpoint igual tiene que hablar el protocolo de Chat Completions.

Ollama viene preconfigurado como proveedor local: iniciá Ollama, descargá un modelo con pull y aparece en la lista.

## Uso y límites

`openide.agent.usage.enabled` activa el medidor de uso para los proveedores que exponen uno (cuotas de suscripción, créditos restantes). `openide.agent.usage.cliAccounts` le permite a OpenIDE leer las cuentas de herramientas CLI instaladas en la máquina, y `openide.agent.usage.pollMinutes` controla cada cuánto se actualiza el medidor.

## Privacidad

Cada proveedor es algo que vos habilitás. OpenIDE envía prompts, archivos adjuntos y resultados de herramientas únicamente al proveedor que seleccionaste para esa conversación. Leé [Privacidad](/docs/privacy/) para el panorama completo.
