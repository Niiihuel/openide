# Archivo de prueba de OpenIDE

Este archivo sirve para probar la apertura, edición, guardado y previsualización de documentos Markdown.

> Una pequeña prueba también puede ser un buen lugar para experimentar.

## Mensaje de bienvenida

¡Hola, OpenIDE! Si estás viendo este archivo, la edición de Markdown está funcionando.

Puedes cambiar este texto, añadir nuevas secciones y comprobar que los cambios se conserven al volver a abrir el documento.

> [!TIP]
> Esta edición fue hecha desde OpenIDE para comprobar que el archivo admite cambios reales sin perder su formato.

## Panel de control de la prueba

| Componente | Estado | Cómo verificarlo |
| --- | :---: | --- |
| Edición desde OpenIDE | ✅ | Cambia cualquier frase y guarda con `Ctrl+S` |
| Navegación interna | ✅ | Salta a [Elementos para probar](#elementos-para-probar) |
| Previsualización | ⏳ | Usa `Ctrl+Shift+V` y compara fuente y resultado |
| Persistencia | ⏳ | Cierra y vuelve a abrir este archivo |

**Objetivo rápido:** editar una línea, abrir la previsualización y volver aquí usando el enlace interno.

## Lista de comprobación

- [ ] Abrir el archivo
- [x] Editar este texto
- [x] Guardar los cambios
- [ ] Ver la previsualización Markdown
- [ ] Comprobar que los títulos y subtítulos se renderizan correctamente
- [ ] Revisar la tabla y el bloque de código
- [ ] Cerrar y volver a abrir el archivo

> Si puedes leer esto, el archivo fue creado correctamente.

## Elementos para probar

### Tabla de ejemplo

| Elemento | Estado | Comentario |
| --- | :---: | --- |
| Edición | ✅ | Puedes modificar cualquier sección |
| Guardado | ⏳ | Falta comprobarlo manualmente |
| Previsualización | ⏳ | Verificar el formato Markdown |

### Código

```ts
function saludar(nombre: string): string {
  return `Hola, ${nombre}!`;
}

console.log(saludar("OpenIDE"));
```

### Lista de ideas

1. Cambiar el título principal.
2. Añadir una imagen o un enlace.
3. Probar una lista anidada:
   - Primer elemento
   - Segundo elemento
4. Guardar y confirmar que nada se perdió.

## Notas de la prueba

Escribe aquí cualquier observación, resultado o comportamiento inesperado:

- **Resultado:** pendiente de completar.
- **Fecha:** 25 de agosto de 2026.
- **Observaciones:** archivo editado y guardado correctamente como parte de la prueba.

## Testing puro

Esta sección se añadió en una segunda edición para comprobar que los cambios sucesivos se conservan correctamente.

| Caso de prueba | Resultado esperado | Estado |
| --- | --- | :---: |
| Renderizar títulos | Los niveles de encabezado mantienen su jerarquía | ⏳ |
| Renderizar texto | La negrita, la cursiva y el `código inline` se muestran correctamente | ⏳ |
| Renderizar listas | Las listas ordenadas y anidadas conservan su estructura | ⏳ |
| Renderizar enlaces | El enlace apunta al destino correcto | ⏳ |
| Renderizar código | El bloque conserva el lenguaje y el formato | ⏳ |

## Validación rápida de OpenIDE

Este archivo también sirve para probar la nueva validación estructural de OpenIDE:

1. Abrí la paleta de comandos (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Ejecutá **OpenIDE: Validar Markdown activo**.
3. Revisá el informe **OpenIDE Markdown** en el panel de salida.

- [ ] El informe no muestra errores ni advertencias
- [ ] El resumen cuenta encabezados, enlaces, tareas y bloques de código
- [ ] El bloque siguiente no genera un falso positivo: su enlace peligroso es sólo texto

![Marca de OpenIDE](icons/openide.png)

```md
[Enlace de ejemplo](javascript:esto-no-se-ejecuta)
```

## Referencias: tema de color

Consulta la documentación de [superficies y temas de OpenIDE](docs/theming-surfaces.md)
para revisar cómo se definen y aplican los colores de la interfaz.

También puedes visitar el [README del proyecto](README.md) para conocer más sobre OpenIDE.

## Modificación de prueba

Este texto fue actualizado en una segunda ronda para comprobar que el archivo Markdown conserva los cambios sucesivos.

## Laboratorio de interacción

Esta sección reúne algunos elementos extra para probar la edición y la previsualización:

- **Negrita**, *cursiva*, ~~tachado~~ y `código en línea`.
- [Enlace externo de ejemplo](https://example.com).
- [Volver al panel de control](#panel-de-control-de-la-prueba).
- Una línea con caracteres especiales: `á`, `ñ`, `¿`, `¡`, `€` y `→`.

### Lista anidada

1. Preparar la prueba.
   - Abrir el archivo.
   - Cambiar una frase.
2. Revisar el resultado.
   - Comparar la vista de código con la previsualización.
   - Confirmar que el enlace interno funciona.
3. Guardar una última vez.

### Matriz de resultados

| Prueba | Antes | Después | Comentario |
| --- | :---: | :---: | --- |
| Encabezados | ✅ | ✅ | Mantienen la jerarquía |
| Listas | ⏳ | ⏳ | Revisar la indentación |
| Enlaces | ⏳ | ⏳ | Probar el enlace interno |
| Caracteres UTF-8 | ✅ | ✅ | La ñ y los acentos se conservan |

### Configuración de ejemplo

```json
{
  "aplicacion": "OpenIDE",
  "modoPrueba": true,
  "elementos": ["markdown", "enlaces", "codigo"],
  "mensaje": "Todo listo para probar"
}
```

> **Nota:** modifica esta cita, guarda el archivo y comprueba que la previsualización se actualiza.

<details>
<summary>Bloque desplegable para probar HTML embebido</summary>

Este contenido debería aparecer al abrir el bloque. También puedes editarlo y comprobar si el cambio se refleja sin recargar el documento.

</details>

### Resultado de esta edición

- [ ] Confirmar que el enlace externo se puede abrir.
- [ ] Confirmar que el enlace interno lleva al panel de control.
- [ ] Expandir y cerrar el bloque HTML.
- [ ] Editar el mensaje del bloque JSON.
- [ ] Guardar, cerrar y volver a abrir el archivo.

---

## Segunda ronda de edición

**Mensaje editable:** esta línea puede cambiarse nuevamente para probar que OpenIDE detecta y guarda otra modificación. 🚀

Primera línea de prueba  
Segunda línea con un salto manual.

```bash
echo "OpenIDE sigue respondiendo"
```

### Comprobación final

- [ ] Cambiar el mensaje editable.
- [ ] Ejecutar o revisar visualmente el bloque Bash.
- [ ] Comprobar el salto de línea en la previsualización.
- [ ] Guardar los cambios con `Ctrl+S`.
