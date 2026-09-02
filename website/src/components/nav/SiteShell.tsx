'use client';

import type {ReactNode} from 'react';
import Image from 'next/image';
import {AppShell} from '@astryxdesign/core/AppShell';
import {TopNav, TopNavHeading, TopNavItem} from '@astryxdesign/core/TopNav';
import {HStack} from '@astryxdesign/core/Stack';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {SideNavItem, SideNavSection} from '@astryxdesign/core/SideNav';
import {GitHubIcon} from '@/components/icons';
import type {Locale} from '@/i18n/config';
import type {Dictionary} from '@/i18n/dictionaries';
import {site} from '@/lib/site';
import {LocaleSwitcher} from './LocaleSwitcher';
import {ThemeToggle} from './ThemeToggle';

export type SiteSection = 'home' | 'docs';

interface SiteShellProps {
  locale: Locale;
  dict: Dictionary;
  current: SiteSection;
  /** Optional side navigation (docs). */
  sideNav?: ReactNode;
  /** Content for the mobile drawer when there is no side nav. */
  mobileContent?: ReactNode;
  variant?: 'wash' | 'surface' | 'section' | 'elevated';
  children: ReactNode;
}

export function SiteShell({
  locale,
  dict,
  current,
  sideNav,
  mobileContent,
  variant = 'surface',
  children,
}: SiteShellProps) {
  const homeHref = `/${locale}/`;
  const docsHref = `/${locale}/docs/`;

  const drawerContent = mobileContent ?? (
    <SideNavSection title={dict.nav.menuTitle} isHeaderHidden>
      <SideNavItem label={dict.nav.home} href={homeHref} isSelected={current === 'home'} />
      <SideNavItem label={dict.nav.docs} href={docsHref} isSelected={current === 'docs'} />
      <SideNavItem label={dict.nav.releases} href={site.releases} />
      <SideNavItem label={dict.nav.github} href={site.repo} />
    </SideNavSection>
  );

  return (
    <AppShell
      height="auto"
      contentPadding={0}
      variant={variant}
      sideNav={sideNav}
      mobileNav={{
        breakpoint: 'md',
        content: sideNav ? undefined : drawerContent,
      }}
      topNav={
        <TopNav
          label={dict.nav.label}
          heading={
            <TopNavHeading
              heading={site.name}
              headingHref={homeHref}
              logo={<Image src="/openide.svg" alt="" width={28} height={28} priority />}
            />
          }
          startContent={
            <>
              <TopNavItem label={dict.nav.home} href={homeHref} isSelected={current === 'home'} />
              <TopNavItem label={dict.nav.docs} href={docsHref} isSelected={current === 'docs'} />
            </>
          }
          endContent={
            <HStack gap={1} vAlign="center">
              <LocaleSwitcher locale={locale} dict={dict} />
              <ThemeToggle dict={dict} />
              <Button
                label={dict.nav.github}
                tooltip={dict.nav.github}
                variant="ghost"
                isIconOnly
                icon={<Icon icon={GitHubIcon} size="sm" />}
                href={site.repo}
                target="_blank"
                rel="noopener noreferrer"
              />
            </HStack>
          }
        />
      }>
      {children}
    </AppShell>
  );
}
