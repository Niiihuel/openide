---
title: Actualizaciones
description: Cómo OpenIDE busca actualizaciones, las verifica y las aplica, y cuáles son los secretos de release.
---

OpenIDE publica artefactos en GitHub Releases y manifiestos versión 2 en la rama `updates` del repositorio. Cada manifiesto está firmado con Ed25519 y vincula plataforma, arquitectura, canal, target, versión, tamaño y el SHA-256 del artefacto.

## Integridad

El cliente incluye una clave pública inmutable. Antes de ofrecer una actualización verifica los bytes exactos del manifiesto, su esquema, canal y target, la política anti-rollback y el rollout. Antes de instalarla verifica el tamaño y el SHA-256 del artefacto.

Esa cadena, la firma Ed25519 del manifiesto más el hash del artefacto, es lo que decide si se instala una actualización. La firma del sistema operativo (Authenticode en Windows, Developer ID en macOS) es una capa distinta: protege a quien **descarga** el instalador desde un navegador, no al actualizador. Hoy los instaladores de Windows se publican **sin firmar**, porque hay que comprarle un certificado Authenticode a una CA. La actualización automática funciona igual, pero SmartScreen advierte cuando el instalador se descarga a mano.

El validador del manifiesto también verifica que la URL de descarga sea HTTPS sin credenciales, que el host esté en la lista permitida y que la ruta pertenezca a este repositorio. Si el repositorio se muda a otra cuenta hay que actualizar la expresión regular, o si no el actualizador rechaza todos los releases legítimos. Falla de forma cerrada, que es la dirección correcta, pero en silencio.

## AppImage y NixOS

La instalación mutable soportada vive en `~/.local/bin/OpenIDE.AppImage`. El reemplazo usa un archivo `.pending`, conserva `.previous` y escribe un marcador de salud. Si el primer inicio falla, el wrapper restaura la versión anterior una vez. Una derivación bajo `/nix/store` nunca se modifica automáticamente.

En Linux el actualizador solo reemplaza un AppImage. Las instalaciones por paquete (`.deb`, `.rpm`) se actualizan con tu gestor de paquetes.

## Canales

- `stable`: versiones `X.Y.Z`, promovidas manualmente después de verificar cada artefacto.
- `insider`: versiones `X.Y.Z-insider.YYYYMMDD.N`, publicadas en un feed separado.

## Controlar las verificaciones de actualización

Las settings relevantes son las habituales de VS Code. `update.mode` configurado en `manual` o `none` detiene las verificaciones automáticas; `update.enableWindowsBackgroundUpdates` configurado en `false` deshabilita las actualizaciones en segundo plano en Windows. Mirá [Telemetría](/docs/telemetry/) para la lista completa de settings que contactan la red.

## Secretos de release

El CI falla de forma cerrada si falta `OPENIDE_UPDATE_PRIVATE_KEY`: sin esa clave no hay manifiesto firmado ni actualización posible. La firma de Windows es opcional y solo se rechaza cuando está configurada a medias (un certificado sin contraseña, o al revés), porque esa combinación produce instaladores sin firmar que parecen configurados. Estos secretos nunca se guardan en el repositorio ni en los artefactos de build.

### `OPENIDE_UPDATE_PRIVATE_KEY`

Esta es la clave privada Ed25519, en formato PKCS#8 PEM, que firma los manifiestos. Su mitad pública está fijada en `openide-version.json` (`updater.publicKey`) y viaja dentro de cada cliente publicado: **son un par**. Cambiar una sin la otra hace que todos los clientes instalados rechacen las actualizaciones por firma inválida, y esa falla es invisible desde el CI: los releases se publican bien y solo un IDE ya instalado lo nota.

Si ya tenés la clave, confirmá que es la correcta antes de cargarla:

```bash
node dev/update-signing-key.mjs check path/to/openide-update.pem
```

Si no la tenés, generá un par nuevo. El comando escribe la clave privada en el archivo (modo 600, nunca se imprime) y muestra solo la pública:

```bash
node dev/update-signing-key.mjs new ~/openide-update.pem
```

Después, y **antes de publicar un release firmado con ella**, poné la clave pública impresa en `updater.publicKey` de `openide-version.json` y comiteá ese cambio. Recién ahí pegá el contenido del `.pem`, incluyendo las líneas `BEGIN` y `END`, en el secreto de repositorio `OPENIDE_UPDATE_PRIVATE_KEY`.

Mantené el `.pem` fuera del repositorio y con backup: es lo único que permite publicar una actualización que los clientes existentes acepten. Si se pierde, la clave pública tiene que cambiar y todos los que ya tienen OpenIDE instalado deben reinstalar a mano. `.gitignore` ignora `*.pem`, `*.p12`, `*.pfx` y `*.key` para que un descuido no la publique; una clave comiteada no se borra en el siguiente commit, queda en el historial y hay que rotarla.
