import {notFound} from 'next/navigation';
import {LandingPage} from '@/components/landing/LandingPage';
import {isLocale} from '@/i18n/config';
import {getDictionary} from '@/i18n/dictionaries';

export default async function HomePage({params}: PageProps<'/[locale]'>) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return <LandingPage locale={locale} dict={dict} />;
}
