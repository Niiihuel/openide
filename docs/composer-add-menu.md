# Menú + del composer

El acceso + reúne contexto, creación y herramientas usando el popover y las filas compartidas del IDE. El botón de clip duplicado se retira; pegar y arrastrar imágenes siguen funcionando.

| Control | Acción real |
| --- | --- |
| Archivos del proyecto | Abre el descubrimiento `@` del workspace; al elegir un archivo se añade su referencia al mensaje. |
| Imágenes | Abre el selector de imágenes existente, con sus validaciones y límites. |
| Goal | Solicita el objetivo en la conversación actual. |
| Modo plan | Activa Plan; si ya está activo vuelve a Agent. La marca refleja el modo actual. |
| Canvas | Ejecuta la creación de Canvas del IDE. |
| Herramientas y skills | Abre el catálogo `/` existente, con comandos, skills, MCP y herramientas disponibles. |
| Mapa y memoria | Abre Project Map, que reúne el mapa y la memoria del proyecto. |
| Navegador | Abre el navegador integrado. |
| Nueva terminal | Crea una terminal mediante el comando nativo del workbench. |

Los accesos a `@` y `/` conservan el borrador y la selección: insertan el disparador después de la selección, sin reemplazar texto, separándolo de palabras contiguas. Si el cursor ya está en un token del mismo tipo, lo reutilizan. No envían el mensaje ni ejecutan una herramienta del catálogo automáticamente.

## Comprobación en Dev

- Abrir + mediante ratón y teclado: grupos compactos, hover compartido, Escape cierra, popover separado de su ancla y scroll sólo con desbordamiento real.
- Con texto y una selección en medio del borrador, elegir Archivos o Herramientas: conservar todo el texto y abrir resultados; elegir un resultado debe añadir su chip.
- Reabrir Archivos o Herramientas mientras el cursor está en un token existente: no duplicar `@` o `/`.
- Adjuntar imagen desde +, pegar otra y eliminarla desde su miniatura; no debe aparecer un segundo botón de clip en la fila inferior.
- Alternar Plan desde + y desde el selector de modo: la marca y el envío deben usar el mismo estado.
- Crear Goal y Canvas, abrir mapa, navegador y terminal: verificar sus vistas reales y que el borrador siga intacto.
- Cambiar el idioma ES/EN y reabrir el menú; comprobar etiquetas y accesibilidad de cada botón.

La validación de sintaxis no sustituye este recorrido en el IDE ejecutado.
