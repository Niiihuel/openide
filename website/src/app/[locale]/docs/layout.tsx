import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {DocsShell} from '@/components/docs/DocsShell';
import {isLocale} from '@/i18n/config';
import {getDictionary} from '@/i18n/dictionaries';
import {getDocsNav} from '@/lib/docs';
import {site} from '@/lib/site';

export async function generateMetadata({params}: LayoutProps<'/[locale]/docs'>): Promise<Metadata> {
  const {locale} = await params;
  if (!isLocale(locale)) return {};
  const dict = getDictionary(locale);
  return {
    title: {
      default: dict.meta.docsTitle,
      template: `%s · ${site.name}`,
    },
    description: dict.meta.docsDescription,
  };
}

export default async function DocsLayout({children, params}: LayoutProps<'/[locale]/docs'>) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const nav = getDocsNav(locale);
  return (
    <DocsShell locale={locale} dict={dict} nav={nav}>
      {children}
    </DocsShell>
  );
}
