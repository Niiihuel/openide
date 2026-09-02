'use client';

import {usePathname, useRouter} from 'next/navigation';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {Icon} from '@astryxdesign/core/Icon';
import {GlobeIcon} from '@/components/icons';
import {locales, localeNames, switchLocalePath, type Locale} from '@/i18n/config';
import type {Dictionary} from '@/i18n/dictionaries';

export function LocaleSwitcher({locale, dict}: {locale: Locale; dict: Dictionary}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <DropdownMenu
      button={{
        label: localeNames[locale],
        variant: 'ghost',
        size: 'sm',
        tooltip: dict.locale.change,
        icon: <Icon icon={GlobeIcon} size="sm" />,
      }}
      alignment="end"
      menuWidth={180}
      items={locales.map(target => ({
        id: target,
        label: localeNames[target],
        endContent: target === locale ? <Icon icon="check" size="sm" /> : undefined,
        onClick: () => {
          if (target !== locale) {
            router.push(switchLocalePath(pathname ?? `/${locale}/`, target));
          }
        },
      }))}
    />
  );
}
