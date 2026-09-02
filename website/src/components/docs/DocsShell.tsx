'use client';

import type {ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {SideNav, SideNavItem, SideNavSection} from '@astryxdesign/core/SideNav';
import {SiteShell} from '@/components/nav/SiteShell';
import type {Locale} from '@/i18n/config';
import type {Dictionary} from '@/i18n/dictionaries';
import type {DocsNavSection} from '@/lib/docs';

interface DocsShellProps {
  locale: Locale;
  dict: Dictionary;
  nav: DocsNavSection[];
  children: ReactNode;
}

function currentSlugFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = pathname.match(/\/docs\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

export function DocsShell({locale, dict, nav, children}: DocsShellProps) {
  const pathname = usePathname();
  const currentSlug = currentSlugFromPath(pathname);

  const sideNav = (
    <SideNav>
      {nav.map(section => (
        <SideNavSection key={section.id} title={dict.docs.sections[section.id].title}>
          {section.items.map(item => (
            <SideNavItem
              key={item.slug}
              label={item.title}
              href={item.href}
              isSelected={item.slug === currentSlug}
            />
          ))}
        </SideNavSection>
      ))}
    </SideNav>
  );

  return (
    <SiteShell locale={locale} dict={dict} current="docs" variant="section" sideNav={sideNav}>
      {children}
    </SiteShell>
  );
}
