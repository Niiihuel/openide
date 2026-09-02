import {defaultLocale, locales, localeNames} from '@/i18n/config';
import {site} from '@/lib/site';

/**
 * The site is exported statically, so `/` cannot redirect on the server.
 * A tiny inline script picks the visitor's language before anything paints;
 * without JavaScript the meta refresh and the links below still work.
 */
const redirectScript = `(function(){var b=${JSON.stringify(site.basePath)};var l=(navigator.language||'').toLowerCase();var t=l.indexOf('es')===0?'es':'${defaultLocale}';location.replace(b+'/'+t+'/');})();`;

export default function RootRedirectPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{__html: redirectScript}} />
      <noscript>
        <meta httpEquiv="refresh" content={`0; url=${site.basePath}/${defaultLocale}/`} />
      </noscript>
      <ul>
        {locales.map(locale => (
          <li key={locale}>
            <a href={`${site.basePath}/${locale}/`} hrefLang={locale}>
              {localeNames[locale]}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
