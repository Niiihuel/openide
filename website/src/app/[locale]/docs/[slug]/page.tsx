import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {DocArticle} from '@/components/docs/DocArticle';
import {isLocale, locales} from '@/i18n/config';
import {getDictionary} from '@/i18n/dictionaries';
import {getAdjacentDocs, getDoc} from '@/lib/docs';
import {allDocSlugs} from '@/lib/docs-nav';
import {site} from '@/lib/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.flatMap(locale => allDocSlugs.map(slug => ({locale, slug})));
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/docs/[slug]'>): Promise<Metadata> {
  const {locale, slug} = await params;
  if (!isLocale(locale)) return {};
  const doc = getDoc(locale, slug);
  if (!doc) return {};
  return {
    title: doc.title,
    description: doc.description || undefined,
    alternates: {
      languages: Object.fromEntries(locales.map(l => [l, `${site.basePath}/${l}/docs/${slug}/`])),
    },
  };
}

export default async function DocPage({params}: PageProps<'/[locale]/docs/[slug]'>) {
  const {locale, slug} = await params;
  if (!isLocale(locale)) notFound();
  const doc = getDoc(locale, slug);
  if (!doc) notFound();

  const dict = getDictionary(locale);
  const {previous, next} = getAdjacentDocs(locale, slug);
  const sectionTitle = doc.section ? dict.docs.sections[doc.section].title : dict.docs.title;
  const editUrl = `${site.repo}/edit/master/${site.contentPath}/${locale}/${slug}.md`;

  return (
    <DocArticle
      locale={locale}
      dict={dict}
      doc={doc}
      sectionTitle={sectionTitle}
      previous={previous}
      next={next}
      editUrl={editUrl}
    />
  );
}
