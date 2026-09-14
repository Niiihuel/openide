# OpenIDE Dev: cambios visibles al guardar

El desarrollo visual usa dos procesos del checkout: un watcher incremental que mantiene `vscode/out` actualizado y un recargador CSS que modifica las hojas ya cargadas en OpenIDE Dev. Guardar CSS conserva la conversación, el foco, las selecciones y el estado de los controles. No reinicia la ventana.

## Arranque

Con las dependencias y la salida de desarrollo ya preparadas, ejecutar desde la raíz del repositorio:

```sh
# Terminal 1: sincronización inicial incremental y seguimiento de src → out.
node dev/watch-workbench.mjs

# Terminal 2: conectar solamente el workbench Dev de este checkout.
node dev/css-hot-reload.mjs --port=9333
```

En NixOS, el watcher necesita el entorno de compilación que permite ejecutar el binario de esbuild:

```sh
./result-fhs/bin/openide-build -c 'node dev/watch-workbench.mjs'
```

OpenIDE Dev debe estar abierto con `--remote-debugging-port=9333`. Si todavía no hay una instancia Dev, su lanzamiento habitual es:

```sh
cd vscode
VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh --remote-debugging-port=9333 /ruta/al/proyecto
```

El puerto es local. El recargador comprueba que el endpoint corresponde exactamente a `vscode/out/vs/code/electron-browser/workbench/workbench-dev.html` de este checkout; rechaza ventanas de producción, repositorios distintos y endpoints remotos. Mantener un solo watcher y un solo recargador por checkout. `Ctrl+C` detiene cada proceso; no cierra el IDE.

Para comprobar una instancia ya abierta, aplicar y leer de nuevo todas sus hojas cargadas, sin dejar otro proceso observando:

```sh
node dev/css-hot-reload.mjs --port=9333 --once
```

## Qué se actualiza

| Cambio | Resultado |
| --- | --- |
| CSS ya importado | El watcher copia la salida; el recargador sustituye esa misma hoja mediante el dominio CSS del debugger y verifica su texto. No agrega una segunda capa CSS. |
| Tokens o reglas en `openideSurfaceCss.ts` | Se actualiza el elemento `openide-surface-css` existente. El parser admite literales y templates que referencian constantes CSS del mismo módulo; no ejecuta el módulo. |
| TypeScript funcional, creación DOM, imports o estilos inline de widgets | La salida se transpila al guardar. Ejecutar **Developer: Reload Window** para cargar el nuevo código. |
| Nueva hoja CSS importada por primera vez | Reiniciar **solamente OpenIDE Dev** una vez. `CSSDevelopmentService` enumera y cachea módulos en el proceso principal; Reload Window puede conservar un import map que todavía no incluye esa hoja. |
| Webviews/iframes con documentos CSS propios | Conservan su ciclo de renderizado. El recargador está limitado a las hojas y al style compartido expuestos por el workbench Dev; no promete HMR de todos los documentos de una extensión. |

Una hoja nueva ausente del import map produce un error de importación/MIME `text/css` durante el arranque. Es distinto de un fallo de sintaxis de la hoja: reiniciar el proceso Dev renueva la enumeración. No hace falta reinstalar OpenIDE ni modificar el perfil de producción.

## Por qué hay un watcher dedicado

En el estado actual del repositorio, `build/buildConfig.ts` tiene `useEsbuildTranspile=false`. `npm run watch-client-transpile` informa que es un **no-op** y queda vivo sin emitir archivos. Por otro lado, `watch-client` utiliza `tsgo` con `noEmit:true`: comprueba tipos, pero tampoco actualiza la salida. Tener ambos procesos activos no equivale a tener hot reload.

`dev/watch-workbench.mjs` reutiliza `build/next/transpile.ts` para transformar TypeScript y copiar recursos, con ocho operaciones concurrentes y debounce de 200 ms. La primera pasada compara fechas de los archivos; `--force` vuelve a emitir todos los archivos de `src` si el checkout restauró fechas antiguas. No borra `out`, no ejecuta builds de extensiones y no sustituye el chequeo de tipos. Escribe cada resultado en un temporal y lo renombra completo: un error conserva la última salida válida.

El recargador observa solamente los directorios de hojas que el renderer tiene cargadas, más el módulo de estilos compartido. Agrupa eventos y espera 150 ms antes de leer. Se reconecta al proceso Dev después de un reinicio y descarta IDs de hojas que desaparecieron durante una navegación.

## Verificación de esta integración

Se verificó el flujo completo con un guardado de comentario inocuo en una hoja existente: `src` → salida incremental → `CSS.setStyleSheetText` → lectura posterior de la hoja del renderer. La marca temporal se retiró. Después del reinicio necesario para incorporar nuevas hojas, la comprobación `--once` verificó **391 hojas** cargadas, incluidos los estilos compartidos compuestos a partir de constantes. El proceso Dev quedó en workspace 6; el watcher y el recargador permanecieron activos.

Los números de hojas y PID dependen de la ventana y no constituyen una condición de funcionamiento. La evidencia útil es `Updated and verified ...` tras un guardado y la ausencia de errores de compilación. No atribuir recarga en caliente al mero hecho de tener una terminal de watch abierta.
