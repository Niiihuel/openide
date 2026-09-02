import {notFound} from 'next/navigation';
import {DocsIndex} from '@/components/docs/DocsIndex';
import {isLocale} from '@/i18n/config';
import {getDictionary} from '@/i18n/dictionaries';
import {getDocsNav} from '@/lib/docs';

export default async function DocsIndexPage({params}: PageProps<'/[locale]/docs'>) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const nav = getDocsNav(locale);
  return <DocsIndex locale={locale} dict={dict} nav={nav} />;
}
