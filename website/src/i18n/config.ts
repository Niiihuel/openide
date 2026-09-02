export const locales = ['en', 'es'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** Human-readable names, written in their own language. */
export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

/** Locale identifiers understood by the Astryx component catalog. */
export const astryxLocale: Record<Locale, string> = {
  en: 'en',
  es: 'es-ES',
};

/** Swap the locale segment of a site path (e.g. `/en/docs/x/` -> `/es/docs/x/`). */
export function switchLocalePath(pathname: string, target: Locale): string {
  const parts = pathname.split('/');
  // parts[0] is '' because paths start with '/'
  if (parts.length > 1 && isLocale(parts[1])) {
    parts[1] = target;
    return parts.join('/');
  }
  return `/${target}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}
