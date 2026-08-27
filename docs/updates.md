# Actualizaciones de OpenIDE

OpenIDE publica artefactos en GitHub Releases y manifests v2 en la rama `updates`. Cada manifest está firmado con Ed25519 y enlaza plataforma, arquitectura, canal, target, versión, tamaño y SHA-256 del artefacto.

## Integridad

El cliente incluye una clave pública inmutable. Antes de ofrecer una actualización verifica los bytes exactos del manifest, su schema, canal/target, política anti-rollback y rollout. Antes de instalar verifica tamaño y SHA-256 del artefacto.

Esa cadena —firma Ed25519 del manifest más hash del artefacto— es la que decide si una actualización se instala. La firma del sistema operativo (Authenticode en Windows, Developer ID en macOS) es una capa distinta: protege a quien **descarga** el instalador desde el navegador, no al updater. Hoy los instaladores de Windows se publican **sin firmar**, porque un certificado Authenticode se compra a una CA: el auto-update funciona igual, pero SmartScreen advierte al descargarlo a mano.

## AppImage y NixOS

La instalación mutable soportada vive en `~/.local/bin/OpenIDE.AppImage`. El reemplazo usa `.pending`, conserva `.previous` y escribe un marker de salud. Si el primer arranque falla, el wrapper restaura la versión anterior una sola vez. Una derivation bajo `/nix/store` nunca se modifica automáticamente.

## Canales

- `stable`: versiones `X.Y.Z` promovidas manualmente luego de verificar todos los artefactos.
- `insider`: versiones `X.Y.Z-insider.YYYYMMDD.N`, publicadas en un feed separado.

## Secrets de release

CI falla cerrado si falta `OPENIDE_UPDATE_PRIVATE_KEY`: sin esa clave no hay manifest firmado y no hay actualización posible. La firma de Windows es opcional y sólo se rechaza a medio configurar (certificado sin contraseña, o al revés), porque esa combinación produce instaladores sin firma con apariencia de configurada. Esos secretos nunca se guardan en el repositorio ni en artifacts.

### `OPENIDE_UPDATE_PRIVATE_KEY`

Es la clave privada Ed25519, en PEM PKCS#8, que firma los manifests. Su mitad pública está fijada en `openide-version.json` (`updater.publicKey`) y viaja dentro de cada cliente publicado: **las dos son un par**. Cambiar una sin la otra hace que todo cliente instalado rechace las actualizaciones por firma inválida, y ese fallo es invisible desde CI — los releases se publican bien y sólo lo nota una IDE ya instalada.

Si ya tenés la clave, confirmá que sea la correcta antes de cargarla:

```sh
node dev/update-signing-key.mjs check ruta/a/openide-update.pem
```

Si no la tenés, generá un par nuevo. El comando escribe la privada en el archivo (permisos 600, nunca la imprime) y muestra sólo la pública:

```sh
node dev/update-signing-key.mjs new ~/openide-update.pem
```

Después, y **antes de publicar un release firmado con ella**, poné la pública que imprimió en `updater.publicKey` de `openide-version.json` y commiteá ese cambio. Recién entonces pegá el contenido del `.pem` —incluidas las líneas `BEGIN`/`END`— en el secret `OPENIDE_UPDATE_PRIVATE_KEY` del repositorio.

Guardá el `.pem` fuera del repositorio y con backup: es lo único que permite publicar una actualización que los clientes existentes acepten. Si se pierde, hay que cambiar la pública y quienes ya tengan OpenIDE instalado deben reinstalar a mano. `.gitignore` ignora `*.pem`, `*.p12`, `*.pfx` y `*.key` para que un descuido no la publique — una clave commiteada no se borra con el commit siguiente, queda en el historial y hay que rotarla.
