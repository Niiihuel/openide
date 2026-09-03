# Update notes

Each file in this folder is the card OpenIDE shows **once**, the first time it
starts after a new version is installed (`PostUpdateWidgetContribution`).

## How the IDE finds it

`getUpdateInfoUrl()` (`vscode/src/vs/workbench/contrib/update/common/updateUtils.ts`)
builds the URL from the installed version:

```
https://raw.githubusercontent.com/Niiihuel/openide/master/docs/updates/v<version>_update.md
```

The version uses `_` instead of `.`, and a trailing `.0` is trimmed:
`1.0.1` → `v1_0_1_update.md`, `1.1.0` → `v1_1_update.md`.

**If the file does not exist, nothing happens**: the fetch 404s, `getUpdateInfo`
returns `undefined`, and no card is shown. A version without a note simply does
not say hello. That is why the release pipeline does not have to generate
anything here — these are written by hand when there is something to tell.

## Format

JSON frontmatter between `---`, and below it the fallback markdown (used only
when there are no `features`):

```
---
{
  "badge": "What's new",
  "title": "OpenIDE 1.0.1",
  "features": [
    { "icon": "$(shield)", "title": "Short headline", "description": "One line." }
  ],
  "buttons": [
    { "label": "Release notes", "commandId": "update.showCurrentReleaseNotes", "style": "secondary" }
  ]
}
---
Fallback text.
```

- `features`: up to **5**; extras are dropped silently. `icon` is a codicon id.
- `buttons`: `commandId` is a workbench command; `style` is `primary` or
  `secondary`. If there are none, the widget adds just the *Release Notes* button.
- `bannerImageUrl` (optional): must be `https://` or a `data:image/*`. When
  present it replaces the whole banner — the theme-derived gradient and the
  product mark included.
- `bannerVideoUrl` (optional): a short clip in the banner instead of the image.
  **`https://` only** (a `data:` URL would be base64 inside the note, ~33%
  larger, and would be downloaded on every check even if the card is never
  shown). It loops, muted and without controls, cropped to the banner's 16:5
  (`object-fit: cover`), so pick material that survives the crop.
- `bannerPosterUrl` (optional): the frame shown while the clip loads, and the one
  shown **instead of** the clip when the user has asked for reduced motion. Same
  rules as `bannerImageUrl`.

Three things worth knowing about the video before using it:

1. **The `<video>` element does not load it directly.** The workbench CSP is
   `media-src 'self' blob:`, so a remote URL on a media element is rejected
   silently. The widget downloads it through the request service (the same one
   that fetches the note, with the window's proxy and certificates) and hands the
   element a blob. The renderer never reaches the network for media on its own.
2. **It is capped at 12 MB.** A larger clip is discarded and the banner stays as
   it was.
3. **Everything degrades to "no video"**: a rejected URL, a failed request, a
   `content-type` that is not `video/*`, the card being closed mid-download. In
   any of those cases you are left with the poster, the image, or the derived
   banner. The card has to read well without the clip.
- `badge` and `title` are optional; without `title` the card says
  "New in \<version\>".

The parser lives in `update/common/updateInfoParser.ts` and also accepts a plain
JSON wrapper or single-line frontmatter.
