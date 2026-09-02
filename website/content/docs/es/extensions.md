---
title: Extensiones y marketplace
description: Open VSX es la galería predeterminada; cómo cambiar a otra galería, alojar una propia, y qué no pueden hacer las extensiones propietarias.
---

## Marketplace

Al ser un editor basado en VS Code, OpenIDE obtiene funcionalidades adicionales instalando extensiones de Visual Studio Code. Microsoft [prohíbe el uso del marketplace de Microsoft por parte de cualquier otro producto](https://github.com/microsoft/vscode/issues/31168) y la redistribución de archivos `.vsix` desde ahí, por lo que las extensiones se tienen que instalar de otra manera.

Por defecto, `product.json` apunta la galería de extensiones a [open-vsx.org](https://open-vsx.org/), que provee un [adaptador](https://github.com/eclipse/openvsx/wiki/Using-Open-VSX-in-VS-Code) para la API de marketplace que usa VS Code. Es posible que extrañes algunas extensiones que conocés de Visual Studio Marketplace. Tus opciones:

- Pedile a los mantenedores de la extensión que también publiquen en Open VSX. El proceso está documentado en la [wiki de Open VSX](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).
- Abrí un pull request en [publish-extensions](https://github.com/open-vsx/publish-extensions) para que la cuenta de servicio `@open-vsx` publique la extensión por vos.
- Descargá e [instalá el archivo `.vsix`](https://code.visualstudio.com/docs/editor/extension-gallery#_install-from-a-vsix), por ejemplo desde la página de releases del repositorio de la extensión.

## Usar el Open VSX Registry

El [Open VSX Registry](https://open-vsx.org/) es la galería preconfigurada en OpenIDE, así que la vista de Extensiones lo usa por defecto. Consultá [este artículo](https://web.archive.org/web/20200423131829/https://www.gitpod.io/blog/open-vsx/) para conocer la motivación detrás de Open VSX.

## Usar una galería de extensiones diferente

Podés cambiar la galería preconfigurada de Open VSX Registry configurando los endpoints de una de dos maneras.

Variables de entorno:

- `VSCODE_GALLERY_SERVICE_URL` **(obligatoria)**
- `VSCODE_GALLERY_ITEM_URL` **(obligatoria)**
- `VSCODE_GALLERY_CACHE_URL`
- `VSCODE_GALLERY_CONTROL_URL`
- `VSCODE_GALLERY_EXTENSION_URL_TEMPLATE` **(obligatoria)**
- `VSCODE_GALLERY_RESOURCE_URL_TEMPLATE`

O un `product.json` personalizado en la siguiente ubicación (reemplazá `OpenIDE` por `OpenIDE - Insiders` si usás ese canal):

- Windows: `%APPDATA%\OpenIDE` o `%USERPROFILE%\AppData\Roaming\OpenIDE`
- macOS: `~/Library/Application Support/OpenIDE`
- Linux: `$XDG_CONFIG_HOME/OpenIDE` o `~/.config/OpenIDE`

con un contenido como:

```jsonc
{
  "extensionsGallery": {
    "serviceUrl": "", // required
    "itemUrl": "", // required
    "cacheUrl": "",
    "controlUrl": "",
    "extensionUrlTemplate": "", // required
    "resourceUrlTemplate": ""
  }
}
```

## Alojá tu propia galería de extensiones

Desarrolladores individuales y empresas en industrias reguladas o con foco en seguridad pueden alojar su propia galería. Se sabe que las siguientes funcionan:

- [Open VSX](https://github.com/eclipse/openvsx), el proyecto de código abierto de Eclipse. La instancia pública operada por la Eclipse Foundation es el endpoint preconfigurado, pero podés alojar la tuya propia.

  > Open VSX es una alternativa de código abierto [neutral respecto a proveedores](https://projects.eclipse.org/projects/ecd.openvsx) al Visual Studio Marketplace. Provee una aplicación de servidor que gestiona extensiones de VS Code en una base de datos, una aplicación web similar al Visual Studio Marketplace, y una herramienta de línea de comandos para publicar extensiones similar a `vsce`.

- [code-marketplace](https://coder.com/blog/running-a-private-vs-code-extension-marketplace), un proyecto de código abierto de Coder.

  > `code-marketplace` es un binario de Go autocontenido sin frontend ni ningún mecanismo para que los autores agreguen o actualicen extensiones. Lee las extensiones desde almacenamiento de archivos y provee una API para editores compatibles con VS Code.

## Visual Studio Marketplace

Como con cualquier servicio en línea, asegurate de haber entendido [sus términos de uso](https://aka.ms/vsmarketplace-ToU), que incluyen:

> Marketplace Offerings are intended for use only with Visual Studio Products and Services and you may only install and use Marketplace Offerings with Visual Studio Products and Services.

No podemos brindar ninguna ayuda si tenés intención de infringir esos términos. Tené en cuenta también que la galería aloja extensiones no libres cuyas licencias prohíben explícitamente su uso en productos que no sean de Microsoft, y que usan telemetría.

## Herramientas de depuración propietarias

El depurador que viene con la [extensión de C#](https://github.com/OmniSharp/omnisharp-vscode) de Microsoft y el depurador de Windows que viene con la [extensión de C++](https://github.com/Microsoft/vscode-cpptools) tienen licencia para funcionar únicamente con el build oficial de Visual Studio Code. Consultá [este comentario en el repositorio de C#](https://github.com/OmniSharp/omnisharp-vscode/issues/2491#issuecomment-418811364) y [este en el repositorio de C++](https://github.com/Microsoft/vscode-cpptools/issues/21#issuecomment-248349017).

Para proyectos de C# existe una alternativa con [netcoredbg](https://github.com/Samsung/netcoredbg), el proyecto de código abierto de Samsung.

## Extensiones propietarias

Al igual que esos depuradores, algunas extensiones del marketplace (por ejemplo el paquete [Remote Development](https://code.visualstudio.com/docs/remote/remote-overview)) solo funcionan con el build oficial. A veces podés evitar esto agregando el ID interno de la extensión a la propiedad `extensionAllowedProposedApi` de `product.json` en tu instalación:

```jsonc
"extensionAllowedProposedApi": [
  // ...
  "ms-vscode-remote.vscode-remote-extensionpack",
  "ms-vscode-remote.remote-wsl",
  // ...
],
```

En algunos casos esto no ayuda porque la extensión tiene codificado que solo corre con el producto oficial. Consultá [Compatibilidad de extensiones](/docs/extensions-compatibility/) para ver alternativas abiertas.

## Usar la extensión "VSIX Manager"

La extensión [**VSIX Manager**](https://github.com/zokugun/vscode-vsix-manager) provee una interfaz amigable para gestionar archivos `.vsix` directamente dentro de OpenIDE. Es particularmente útil para:

- **Múltiples marketplaces:** instalar y gestionar extensiones desde varias galerías al mismo tiempo.
- **Archivos locales:** gestionar una colección de archivos `.vsix` almacenados localmente.
- **Releases de GitHub o Forgejo:** instalar una extensión directamente desde su página de releases.
- **Opciones de respaldo** cuando una galería está temporalmente inaccesible.

Los casos de uso típicos son el desarrollo sin conexión, equipos que distribuyen versiones fijas de extensiones, y empresas con entornos restringidos que necesitan control sobre lo que se instala.
