import fs from 'node:fs';
import path from 'node:path';
import type {Locale} from '@/i18n/config';
import {allDocSlugs, docsSections, sectionOfSlug, type DocsSectionId} from './docs-nav';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'docs');

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  section: DocsSectionId | undefined;
}

export interface Doc extends DocMeta {
  body: string;
}

/** Minimal front matter parser: `key: value` lines between `---` fences. */
function parseFrontmatter(raw: string): {data: Record<string, string>; body: string} {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return {data: {}, body: normalized};
  }
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) {
    return {data: {}, body: normalized};
  }
  const header = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, '');
  const data: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return {data, body};
}

function docPath(locale: Locale, slug: string): string {
  return path.join(CONTENT_DIR, locale, `${slug}.md`);
}

export function getDoc(locale: Locale, slug: string): Doc | null {
  if (!allDocSlugs.includes(slug)) return null;
  const file = docPath(locale, slug);
  if (!fs.existsSync(file)) return null;
  const {data, body} = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return {
    slug,
    title: data.title ?? slug,
    description: data.description ?? '',
    section: sectionOfSlug(slug),
    body,
  };
}

export function getDocMeta(locale: Locale, slug: string): DocMeta | null {
  const doc = getDoc(locale, slug);
  if (!doc) return null;
  const {body: _body, ...meta} = doc;
  void _body;
  return meta;
}

/** Every documented page for a locale, in sidebar order. */
export function getAllDocMetas(locale: Locale): DocMeta[] {
  return allDocSlugs
    .map(slug => getDocMeta(locale, slug))
    .filter((d): d is DocMeta => d !== null);
}

export interface DocsNavItem {
  slug: string;
  title: string;
  description: string;
  href: string;
}

export interface DocsNavSection {
  id: DocsSectionId;
  items: DocsNavItem[];
}

/** Sidebar model: sections with resolved, localized titles and hrefs. */
export function getDocsNav(locale: Locale): DocsNavSection[] {
  const metas = new Map(getAllDocMetas(locale).map(m => [m.slug, m]));
  return docsSections.map(section => ({
    id: section.id,
    items: section.slugs
      .map(slug => metas.get(slug))
      .filter((m): m is DocMeta => m !== undefined)
      .map(m => ({
        slug: m.slug,
        title: m.title,
        description: m.description,
        href: `/${locale}/docs/${m.slug}/`,
      })),
  }));
}

export function getAdjacentDocs(
  locale: Locale,
  slug: string,
): {previous: DocsNavItem | null; next: DocsNavItem | null} {
  const flat = getDocsNav(locale).flatMap(s => s.items);
  const index = flat.findIndex(item => item.slug === slug);
  return {
    previous: index > 0 ? flat[index - 1] : null,
    next: index >= 0 && index < flat.length - 1 ? flat[index + 1] : null,
  };
}
