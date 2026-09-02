'use client';

import {Layout, LayoutContent} from '@astryxdesign/core/Layout';
import {VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Grid} from '@astryxdesign/core/Grid';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Divider} from '@astryxdesign/core/Divider';
import type {Locale} from '@/i18n/config';
import type {Dictionary} from '@/i18n/dictionaries';
import type {DocsNavSection} from '@/lib/docs';

interface DocsIndexProps {
  locale: Locale;
  dict: Dictionary;
  nav: DocsNavSection[];
}

export function DocsIndex({dict, nav}: DocsIndexProps) {
  return (
    <Layout
      height="auto"
      contentWidth={1120}
      content={
        <LayoutContent padding={8} isScrollable={false}>
          <VStack gap={10}>
            <VStack gap={3} maxWidth={720}>
              <Heading level={1} type="display-3" textWrap="balance">
                {dict.docs.title}
              </Heading>
              <Text type="large" weight="normal" color="secondary" textWrap="pretty">
                {dict.docs.intro}
              </Text>
            </VStack>
            <Divider />
            {nav.map(section => {
              const meta = dict.docs.sections[section.id];
              return (
                <VStack key={section.id} gap={4}>
                  <VStack gap={1}>
                    <Heading level={2}>{meta.title}</Heading>
                    <Text color="secondary">{meta.description}</Text>
                  </VStack>
                  <Grid columns={{minWidth: 260, max: 3}} gap={3}>
                    {section.items.map(item => (
                      <ClickableCard key={item.slug} href={item.href} label={item.title} padding={4}>
                        <VStack gap={1}>
                          <Text weight="semibold">{item.title}</Text>
                          {item.description ? (
                            <Text color="secondary" maxLines={3} hasTruncateTooltip={false}>
                              {item.description}
                            </Text>
                          ) : null}
                        </VStack>
                      </ClickableCard>
                    ))}
                  </Grid>
                </VStack>
              );
            })}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
