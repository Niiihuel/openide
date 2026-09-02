import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import '@/styles/layers.css';
import '@/styles/globals.css';
import {AppProviders} from '@/components/providers/AppProviders';
import {themeBootScript} from '@/components/providers/theme-mode';
import {isLocale, locales} from '@/i18n/config';
import {getDictionary} from '@/i18n/dictionaries';
import {site} from '@/lib/site';

// The Neutral theme names Figtree; Astryx never loads fonts, so the site does.
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map(locale => ({locale}));
}

export async function generateMetadata({params}: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const {locale} = await params;
  if (!isLocale(locale)) return {};
  const dict = getDictionary(locale);
  return {
    metadataBase: new URL(site.url),
    title: {
      default: dict.meta.title,
      template: `%s · ${site.name}`,
    },
    description: dict.meta.description,
    applicationName: site.name,
    icons: {icon: `${site.basePath}/openide.png`},
    openGraph: {
      type: 'website',
      siteName: site.name,
      title: dict.meta.title,
      description: dict.meta.description,
      locale,
      images: [{url: `${site.basePath}/openide.png`, width: 512, height: 512, alt: site.name}],
    },
    alternates: {
      languages: Object.fromEntries(locales.map(l => [l, `${site.basePath}/${l}/`])),
    },
  };
}

export default async function LocaleLayout({children, params}: LayoutProps<'/[locale]'>) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale} dir="ltr" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{__html: themeBootScript}} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} precedence="default" />
        <AppProviders locale={locale}>{children}</AppProviders>
      </body>
    </html>
  );
}
