# Notas de actualización

Cada archivo de esta carpeta es la tarjeta que OpenIDE muestra **una vez**, la primera vez que
arranca después de instalar una versión nueva (`PostUpdateWidgetContribution`).

## Cómo la encuentra el IDE

`getUpdateInfoUrl()` (`vscode/src/vs/workbench/contrib/update/common/updateUtils.ts`) arma la URL a
partir de la versión instalada:

```
https://raw.githubusercontent.com/Niiihuel/openide/master/docs/updates/v<versión>_update.md
```

La versión va con `_` en vez de `.`, y un `.0` final se recorta: `1.121.1` → `v1_121_1_update.md`,
`1.122.0` → `v1_122_update.md`.

**Si el archivo no existe, no pasa nada**: el fetch da 404, `getUpdateInfo` devuelve `undefined` y
no se muestra ninguna tarjeta. Una versión sin nota simplemente no saluda. Por eso esto no necesita
que el pipeline de release genere nada: se escribe a mano cuando hay algo que contar.

## Formato

Frontmatter JSON entre `---`, y debajo el markdown de reserva (se usa solo si no hay `features`):

```
---
{
  "badge": "Novedades",
  "title": "OpenIDE 1.121.1",
  "features": [
    { "icon": "$(shield)", "title": "Titular corto", "description": "Una línea." }
  ],
  "buttons": [
    { "label": "Notas de la versión", "commandId": "update.showCurrentReleaseNotes", "style": "secondary" }
  ]
}
---
Texto de reserva.
```

- `features`: hasta **5**; las de más se descartan en silencio. `icon` es un id de codicon.
- `buttons`: `commandId` es un comando del workbench; `style` es `primary` o `secondary`. Si no hay
  ninguno, el widget agrega solo el de *Release Notes*.
- `bannerImageUrl` (opcional): tiene que ser `https://` o un `data:image/*`. Si está, reemplaza el
  banner entero — el degradé derivado del tema y la marca del producto incluidos.
- `bannerVideoUrl` (opcional): un clip corto en el banner, en lugar de la imagen. **Solo `https://`**
  (un `data:` sería base64 dentro de la nota, ~33% más grande, y se bajaría en cada chequeo aunque la
  tarjeta nunca se muestre). Se reproduce en loop, muteado y sin controles, recortado al 16:5 del
  banner (`object-fit: cover`), así que conviene material que aguante el recorte.
- `bannerPosterUrl` (opcional): el cuadro que se ve mientras el clip carga, y el que se muestra **en
  lugar** del clip si el usuario pidió movimiento reducido. Mismas reglas que `bannerImageUrl`.

Sobre el video, tres cosas que conviene saber antes de usarlo:

1. **No lo carga el `<video>` directo.** La CSP del workbench es `media-src 'self' blob:`, así que
   una URL remota en un elemento de media se rechaza en silencio. El widget lo baja por el request
   service (el mismo que trae la nota, con el proxy y los certificados de la ventana) y le pasa al
   elemento un blob. El renderer nunca sale a la red por media por su cuenta.
2. **Tiene tope de 12 MB.** Un clip más grande se descarta y el banner queda como estaba.
3. **Todo degrada a "sin video"**: URL rechazada, request fallido, `content-type` que no es `video/*`,
   tarjeta cerrada a mitad de la descarga. En cualquiera de esos casos queda el poster, la imagen, o
   el banner derivado. La tarjeta tiene que leerse bien sin el clip.
- `badge` y `title` son opcionales; sin `title` la tarjeta dice "New in \<versión\>".

El parser está en `update/common/updateInfoParser.ts` y acepta también un envoltorio JSON puro o el
frontmatter en una sola línea.
