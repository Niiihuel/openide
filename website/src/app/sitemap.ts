import type {MetadataRoute} from 'next';
import {locales} from '@/i18n/config';
import {allDocSlugs} from '@/lib/docs-nav';
import {site} from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = `${site.url}${site.basePath}`;
  const entries: MetadataRoute.Sitemap = [];
  for (const locale of locales) {
    entries.push({url: `${base}/${locale}/`, changeFrequency: 'weekly', priority: 1});
    entries.push({url: `${base}/${locale}/docs/`, changeFrequency: 'weekly', priority: 0.9});
    for (const slug of allDocSlugs) {
      entries.push({
        url: `${base}/${locale}/docs/${slug}/`,
        changeFrequency: 'monthly',
        priority: 0.7,
      });
    }
  }
  return entries;
}
