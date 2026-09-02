# OpenIDE website

Landing page and documentation for OpenIDE, built with [Next.js](https://nextjs.org/) (App Router, static export) and the [Astryx](https://astryx.atmeta.com/) design system. Light and dark mode, English and Spanish.

## Structure

| Path | What it is |
| --- | --- |
| `src/app/[locale]/page.tsx` | Landing page (`/en/`, `/es/`) |
| `src/app/[locale]/docs/` | Documentation index and articles |
| `src/app/(root)/page.tsx` | `/` picks the visitor's language and redirects |
| `content/docs/<locale>/<slug>.md` | Documentation sources (Markdown with `title` / `description` front matter) |
| `src/lib/docs-nav.ts` | Sidebar order and sections; add a slug here when you add a page |
| `src/i18n/dictionaries/` | UI strings for each locale |
| `src/lib/version.json` | Product version shown on the site; synced from `../openide-version.json` on every build |
| `src/components/` | Client components built with Astryx (shell, landing, docs, theme toggle, locale switcher) |

## Develop

```sh
npm install
npm run dev        # http://localhost:3000/en/
npm run lint
npm run build      # static export to out/
```

`npm run astryx -- <command>` runs the Astryx CLI (`component <Name>`, `docs <topic>`, `template --list`). The rules the design system expects are in `AGENTS.md`.

## Add or edit a documentation page

1. Create `content/docs/en/<slug>.md` and `content/docs/es/<slug>.md` with the front matter:

   ```md
   ---
   title: Page title
   description: One sentence shown under the title and on the docs index.
   ---
   ```

2. Add the slug to the right section in `src/lib/docs-nav.ts`.
3. Link between pages with `/docs/<slug>/` (the locale prefix is added at render time). Anchors follow the English headings, e.g. `/docs/troubleshooting/#windows`.

## Deploy

The build is fully static (`out/`), so it can be served by any static host.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public origin, used for the sitemap and `hreflang` links (e.g. `https://niiihuel.github.io`) |
| `NEXT_PUBLIC_BASE_PATH` | Sub-path when the site is not served from the origin root (e.g. `/openide` for a GitHub Pages project site) |

- **GitHub Pages:** the workflow in `.github/workflows/website.yml` builds and deploys on every push that touches `website/`. Enable *Settings → Pages → Source: GitHub Actions* once.
- **Vercel / Netlify:** set the root directory to `website`, build command `npm run build`, output directory `out`.
