---
title: Autenticación de cuentas
description: Cómo se comporta la autenticación de cuentas de GitHub y Microsoft en OpenIDE, y cuándo la dispara una extensión.
---

## GitHub

La autenticación de GitHub fue parchada para usar tokens de acceso personal. Creá uno siguiendo la [documentación de GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) y seleccioná los scopes que necesite la extensión.

En Linux el token se guarda en el llavero (keyring) del sistema; si ves un error `org.freedesktop.secrets`, instalá `gnome-keyring` (consultá [Uso](/docs/usage/#linux)).

## Microsoft

La autenticación de Microsoft no fue parchada, así que se desconoce su estado.

## ¿Cuándo sucede?

Una autenticación de cuenta solo ocurre cuando una extensión la solicita.

Para GitLens, desde la versión 12 (no-plus), no solicita ninguna autenticación nueva.

## Proveedores de IA

Las credenciales de proveedores para el agente son un mecanismo separado: van a `SecretStorage` y se gestionan desde el panel de proveedores. Consultá [Proveedores y modelos](/docs/agent-providers/).
