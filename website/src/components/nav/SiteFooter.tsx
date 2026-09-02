'use client';

import Image from 'next/image';
import {Section} from '@astryxdesign/core/Section';
import {Center} from '@astryxdesign/core/Center';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Link} from '@astryxdesign/core/Link';
import type {Locale} from '@/i18n/config';
import type {Dictionary} from '@/i18n/dictionaries';
import {site} from '@/lib/site';

export function SiteFooter({locale, dict}: {locale: Locale; dict: Dictionary}) {
  return (
    <Section variant="transparent" dividers={['top']} padding={0}>
      <Center axis="horizontal">
        <VStack width="100%" maxWidth={1120} paddingInline={6} paddingBlock={8} gap={6}>
          <HStack gap={6} wrap="wrap" hAlign="between" vAlign="start">
            <VStack gap={2} maxWidth={420}>
              <HStack gap={2} vAlign="center">
                <Image src="/openide.svg" alt="" width={24} height={24} />
                <Text weight="semibold">{site.name}</Text>
              </HStack>
              <Text color="secondary">{dict.footer.tagline}</Text>
            </VStack>
            <HStack gap={4} wrap="wrap">
              <Link href={`/${locale}/docs/`} isStandalone color="primary">
                {dict.footer.docs}
              </Link>
              <Link href={site.releases} isStandalone isExternalLink color="primary">
                {dict.footer.releases}
              </Link>
              <Link href={site.issues} isStandalone isExternalLink color="primary">
                {dict.footer.issues}
              </Link>
              <Link href={site.discussions} isStandalone isExternalLink color="primary">
                {dict.footer.discussions}
              </Link>
              <Link href={site.license} isStandalone isExternalLink color="primary">
                {dict.footer.license}
              </Link>
            </HStack>
          </HStack>
          <Text type="supporting">{dict.footer.builtWith}</Text>
        </VStack>
      </Center>
    </Section>
  );
}
