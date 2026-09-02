'use client';

import type {ReactNode} from 'react';
import NextLink from 'next/link';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import {LinkProvider} from '@astryxdesign/core/Link';
import esES from '@astryxdesign/core/locales/es-ES.json';
import {astryxLocale, type Locale} from '@/i18n/config';
import {ThemeModeProvider, useThemeMode} from './theme-mode';

const astryxMessages = {'es-ES': esES};

function ThemedApp({locale, children}: {locale: Locale; children: ReactNode}) {
  const {mode} = useThemeMode();
  return (
    <Theme theme={neutralTheme} mode={mode}>
      <InternationalizationProvider locale={astryxLocale[locale]} messages={astryxMessages}>
        <LinkProvider component={NextLink}>{children}</LinkProvider>
      </InternationalizationProvider>
    </Theme>
  );
}

export function AppProviders({locale, children}: {locale: Locale; children: ReactNode}) {
  return (
    <ThemeModeProvider>
      <ThemedApp locale={locale}>{children}</ThemedApp>
    </ThemeModeProvider>
  );
}
