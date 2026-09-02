'use client';

import {useMemo, type ReactNode} from 'react';
import {Layout, LayoutContent, LayoutPanel} from '@astryxdesign/core/Layout';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Divider} from '@astryxdesign/core/Divider';
import {Markdown} from '@astryxdesign/core/Markdown';
import {Outline, useOutlineFromMarkdown} from '@astryxdesign/core/Outline';
import {Breadcrumbs, BreadcrumbItem} from '@astryxdesign/core/Breadcrumbs';
import {Link} from '@astryxdesign/core/Link';
import {Grid} from '@astryxdesign/core/Grid';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Icon} from '@astryxdesign/core/Icon';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import type {Locale} from '@/i18n/config';
import type {Dictionary} from '@/i18n/dictionaries';
import type {Doc, DocsNavItem} from '@/lib/docs';

interface DocArticleProps {
  locale: Locale;
  dict: Dictionary;
  doc: Doc;
  sectionTitle: string;
  previous: DocsNavItem | null;
  next: DocsNavItem | null;
  editUrl: string;
}

/**
 * Resolves the link targets used in the Markdown sources:
 * - `/docs/<slug>/` is prefixed with the current locale
 * - `#anchor` and absolute URLs pass through
 */
function resolveHref(href: string, locale: Locale): string {
  if (href.startsWith('/docs/')) {
    return `/${locale}${href.endsWith('/') ? href : `${href}/`}`;
  }
  if (href.startsWith('/') && !href.startsWith(`/${locale}/`)) {
    return `/${locale}${href}`;
  }
  return href;
}

function isExternalHref(href: string): boolean {
  return /^(https?:)?\/\//i.test(href) || href.startsWith('mailto:');
}

function PagerCard({
  item,
  label,
  align,
}: {
  item: DocsNavItem;
  label: string;
  align: 'start' | 'end';
}) {
  return (
    <ClickableCard href={item.href} label={`${label}: ${item.title}`} padding={4}>
      <VStack gap={1} hAlign={align}>
        <HStack gap={1} vAlign="center">
          {align === 'start' ? <Icon icon="chevronLeft" size="xsm" color="secondary" /> : null}
          <Text type="supporting">{label}</Text>
          {align === 'end' ? <Icon icon="chevronRight" size="xsm" color="secondary" /> : null}
        </HStack>
        <Text weight="semibold" justify={align}>
          {item.title}
        </Text>
      </VStack>
    </ClickableCard>
  );
}

export function DocArticle({
  locale,
  dict,
  doc,
  sectionTitle,
  previous,
  next,
  editUrl,
}: DocArticleProps) {
  const outline = useOutlineFromMarkdown(doc.body);
  const isWide = useMediaQuery('(min-width: 1180px)');

  const components = useMemo(
    () => ({
      link: function DocLink({href, children}: {href: string; children: ReactNode}) {
        if (isExternalHref(href)) {
          return (
            <Link href={href} isExternalLink>
              {children}
            </Link>
          );
        }
        return <Link href={resolveHref(href, locale)}>{children}</Link>;
      },
    }),
    [locale],
  );

  const hasOutline = outline.length > 1;

  return (
    <Layout
      height="auto"
      contentWidth={1280}
      content={
        <LayoutContent padding={8} isScrollable={false}>
          <VStack gap={6} maxWidth={820}>
            <Breadcrumbs variant="supporting">
              <BreadcrumbItem href={`/${locale}/`}>{dict.docs.breadcrumbHome}</BreadcrumbItem>
              <BreadcrumbItem href={`/${locale}/docs/`}>{dict.docs.breadcrumbDocs}</BreadcrumbItem>
              <BreadcrumbItem isCurrent>{sectionTitle}</BreadcrumbItem>
            </Breadcrumbs>
            <VStack gap={2}>
              <Heading level={1} type="display-3" textWrap="balance">
                {doc.title}
              </Heading>
              {doc.description ? (
                <Text type="large" weight="normal" color="secondary" textWrap="pretty">
                  {doc.description}
                </Text>
              ) : null}
            </VStack>
            <Divider />
            <Markdown headingLevelStart={2} contentWidth={820} components={components}>
              {doc.body}
            </Markdown>
            <Divider />
            <Grid columns={{minWidth: 240, max: 2}} gap={3}>
              {previous ? (
                <PagerCard item={previous} label={dict.docs.previous} align="start" />
              ) : (
                <VStack />
              )}
              {next ? <PagerCard item={next} label={dict.docs.next} align="end" /> : <VStack />}
            </Grid>
            <HStack>
              <Link href={editUrl} isExternalLink isStandalone color="secondary">
                {dict.docs.editOnGitHub}
              </Link>
            </HStack>
          </VStack>
        </LayoutContent>
      }
      end={
        isWide && hasOutline ? (
          <LayoutPanel width={260} padding={8} isScrollable={false} label={dict.docs.onThisPage}>
            <VStack gap={2} style={{position: 'sticky', top: 'var(--spacing-12)'}}>
              <Text type="label" color="secondary">
                {dict.docs.onThisPage}
              </Text>
              <Outline items={outline} density="compact" offset={64} label={dict.docs.onThisPage} />
            </VStack>
          </LayoutPanel>
        ) : undefined
      }
    />
  );
}
