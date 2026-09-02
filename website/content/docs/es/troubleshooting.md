---
title: Solución de problemas
description: Problemas conocidos en Linux y Windows y cómo solucionarlos.
---

## Linux

### Las fuentes aparecen como rectángulos

Limpiá la caché de fuentes y reconstruila:

```bash
rm -rf ~/.cache/fontconfig
rm -rf ~/snap/openide/common/.cache
fc-cache -r
```

### El texto o toda la interfaz no aparece

Probablemente encontraste un [bug en Chromium y Electron](https://github.com/microsoft/vscode/issues/190437) al compilar los shaders de Mesa, que afecta a todos los builds de Visual Studio Code y OpenIDE en Linux desde la versión 1.82. La solución alternativa es borrar la caché de la GPU:

```bash
rm -rf ~/.config/OpenIDE/GPUCache
```

### Solución alternativa para el menú global en KDE

Instalá estos paquetes en Fedora:

- `libdbusmenu-devel`
- `dbus-glib-devel`
- `libdbusmenu`

En Ubuntu el paquete se llama `libdbusmenu-glib4`.

### Problemas más comunes de Flatpak

- Pantalla borrosa con HiDPI en Wayland:
  ```bash
  flatpak override --user --nosocket=wayland com.openide.openide
  ```
- Para ejecutar comandos en el sistema anfitrión desde dentro del sandbox:
  ```bash
  flatpak-spawn --host <COMMAND>
  # o
  host-spawn <COMMAND>
  ```
- Extensiones faltantes: usá la extensión [VSIX Manager](https://open-vsx.org/extension/zokugun/vsix-manager) o editá `product.json`; mirá [Extensiones](/docs/extensions/).

### Remote SSH no funciona

Usá la extensión compatible [Open Remote - SSH](https://open-vsx.org/extension/jeanp413/open-remote-ssh). En el servidor, `AllowTcpForwarding` tiene que estar configurado en `yes` en la configuración de `sshd`. Algunas distribuciones (Alpine, por ejemplo) necesitan dependencias adicionales.

### La ventana no aparece

Si estás usando Wayland:

1. Ejecutá `openide --verbose`.
2. Si ves un error como `:ERROR:ui/gl/egl_util.cc:92] EGL Driver message (Error) eglCreateContext: Requested version is not supported`, iniciá con `openide --ozone-platform=x11`.

### native-keymap falla al cargar en NixOS

El módulo de distribución de teclado necesita `libxkbfile`. Ejecutá el producto a través del wrapper FHS descripto en [Instalación](/docs/installation/#nixos), que lo provee.

## Windows

### Se ignoran los Group Policy Objects (GPOs)

OpenIDE usa su propia biblioteca de monitoreo de políticas que lee los valores de GPO desde una **ruta de registro diferente** a la de VS Code.

OpenIDE lee las políticas desde:

```text
HKLM\SOFTWARE\Policies\OpenIDE\OpenIDE
```

VS Code lee las políticas desde:

```text
HKLM\SOFTWARE\Policies\Microsoft\VSCode
```

Si desplegás OpenIDE en un entorno empresarial mediante Group Policy:

1. Copiá el archivo de plantilla `.admx` a `C:\Windows\PolicyDefinitions\`.
2. Copiá el archivo de idioma `.adml` a `C:\Windows\PolicyDefinitions\en-US\`.
3. Abrí `gpedit.msc` y configurá las políticas bajo el grupo de OpenIDE.
4. Verificá que la clave de registro resultante exista en `HKLM\SOFTWARE\Policies\OpenIDE\OpenIDE` (no en `Microsoft\OpenIDE`).

Si configurás las políticas manualmente con el Editor del Registro, creá la clave en la ruta correcta:

```text
HKLM\SOFTWARE\Policies\OpenIDE\OpenIDE\<PolicyName>  (REG_SZ o REG_DWORD)
```

Por ejemplo, para configurar *Update: Mode* en `none`:

```text
Registry key: HKLM\SOFTWARE\Policies\OpenIDE\OpenIDE
Value name:   update.mode
Value type:   REG_SZ
Value data:   none
```

Las políticas por usuario también son compatibles bajo `HKCU\SOFTWARE\Policies\OpenIDE\OpenIDE` (las políticas de máquina tienen prioridad).

### Falta "Open with OpenIDE" en el menú contextual

Si la opción **Open with OpenIDE** no aparece después de la instalación, incluso con la casilla marcada durante la instalación:

1. **Ejecutá el instalador de nuevo** y asegurate de que esté marcada la opción *Add 'Open with OpenIDE' action to Windows Explorer file context menu*.
2. **Nota sobre Windows 11:** Windows 11 oculta la mayoría de las entradas del menú contextual detrás de **Shift + clic derecho** (*Show more options*). La entrada puede estar presente pero oculta en el menú condensado.
3. Si sigue sin aparecer, agregala manualmente con el Editor del Registro, ajustando la ruta de instalación:

   ```text
   Key:   HKEY_CLASSES_ROOT\*\shell\Open with OpenIDE
   Value: (Default) = "Open with OpenIDE"

   Key:   HKEY_CLASSES_ROOT\*\shell\Open with OpenIDE\command
   Value: (Default) = "C:\Program Files\OpenIDE\OpenIDE.exe" "%1"
   ```

### Windows Defender marca el instalador como malware

Algunos usuarios reportan que Windows Defender detecta el instalador como `Cinjo` u otra amenaza. Esto es un **falso positivo** causado por la naturaleza no firmada de los artefactos del build.

- Descargá OpenIDE **únicamente** desde la página oficial de [GitHub Releases](https://github.com/Niiihuel/openide/releases).
- Verificá el checksum SHA-256 o SHA-512 del archivo contra el archivo `.sha256` o `.sha512` publicado junto a cada release.
- Si Defender bloquea el instalador, agregá una exclusión para el archivo descargado, ejecutá la instalación y después quitá la exclusión.
- Podés reportar el falso positivo a Microsoft a través del [portal de envío de Windows Defender Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission).

## Agente

### Un proveedor devuelve una respuesta vacía

Algunos endpoints compatibles con OpenAI ponen el razonamiento del modelo en un campo separado y devuelven un `content` vacío. OpenIDE reintenta esas solicitudes sin herramientas y lee el campo de razonamiento, pero si un proveedor personalizado sigue respondiendo vacío, verificá que el endpoint hable la API de Chat Completions y que el modelo soporte llamadas a herramientas. Mirá [Proveedores](/docs/agent-providers/).

### El agente no puede alcanzar mi servidor local

La vista previa de localhost y las herramientas del navegador solo abren los hosts permitidos por `openide.agent.browserAllowedHosts`. La exploración web (`web_search`, `web_fetch`) es un descargador headless separado, controlado por `openide.agent.web.*`, que bloquea las direcciones de loopback y de LAN por diseño; mirá [Confiabilidad](/docs/reliability/#exploraci-n-web-del-agente).

## ¿Seguís trabado?

Revisá los [issues existentes](https://github.com/Niiihuel/openide/issues) y, si nadie reportó tu problema, [abrí un reporte de bug](https://github.com/Niiihuel/openide/issues/new?labels=bug&template=bug_report.md) con los detalles que pide la plantilla.
