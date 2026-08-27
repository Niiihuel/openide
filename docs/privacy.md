# Privacidad de OpenIDE

OpenIDE no incorpora endpoints propietarios de telemetría de Microsoft. Las comprobaciones de actualización consultan exclusivamente el feed firmado del repositorio `Niiihuel/openide` y GitHub Releases. Se envían únicamente los datos técnicos necesarios para HTTP (versión del producto, sistema operativo y arquitectura mediante User-Agent); no se incluyen prompts, código, workspace, credenciales ni identificadores personales.

Los providers de IA y extensiones instaladas tienen sus propias políticas y conexiones. OpenIDE muestra y gestiona esas credenciales localmente, pero el uso de cada proveedor se rige por sus términos.
