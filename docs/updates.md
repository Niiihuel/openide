# Actualizaciones de OpenIDE

OpenIDE publica artefactos en GitHub Releases y manifests v2 en la rama `updates`. Cada manifest está firmado con Ed25519 y enlaza plataforma, arquitectura, canal, target, versión, tamaño y SHA-256 del artefacto.

## Integridad

El cliente incluye una clave pública inmutable. Antes de ofrecer una actualización verifica los bytes exactos del manifest, su schema, canal/target, política anti-rollback y rollout. Antes de instalar verifica tamaño y SHA-256 del artefacto. Windows exige además Authenticode y macOS Developer ID/notarización en releases estables.

## AppImage y NixOS

La instalación mutable soportada vive en `~/.local/bin/OpenIDE.AppImage`. El reemplazo usa `.pending`, conserva `.previous` y escribe un marker de salud. Si el primer arranque falla, el wrapper restaura la versión anterior una sola vez. Una derivation bajo `/nix/store` nunca se modifica automáticamente.

## Canales

- `stable`: versiones `X.Y.Z` promovidas manualmente luego de verificar todos los artefactos.
- `insider`: versiones `X.Y.Z-insider.YYYYMMDD.N`, publicadas en un feed separado.

## Secrets de release

CI falla cerrado si faltan `OPENIDE_UPDATE_PRIVATE_KEY`, credenciales Apple de Developer ID/notarización o certificado Authenticode de Windows. Esos secretos nunca se guardan en el repositorio ni en artifacts.
