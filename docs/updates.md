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
