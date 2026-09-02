'use client';

import {useState, type ComponentProps, type ComponentType, type ReactNode} from 'react';
import {Center} from '@astryxdesign/core/Center';
import {Section} from '@astryxdesign/core/Section';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Card} from '@astryxdesign/core/Card';
import {Layout, LayoutContent, LayoutHeader} from '@astryxdesign/core/Layout';
import {Grid} from '@astryxdesign/core/Grid';
import {NavIcon} from '@astryxdesign/core/NavIcon';
import {Token} from '@astryxdesign/core/Token';
import {List, ListItem} from '@astryxdesign/core/List';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {Link} from '@astryxdesign/core/Link';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Markdown} from '@astryxdesign/core/Markdown';
import {
  ChatComposer,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
} from '@astryxdesign/core/Chat';
import {
  ArrowRightIcon,
  ChartIcon,
  CpuIcon,
  CursorIcon,
  DatabaseIcon,
  DocumentIcon,
  DownloadIcon,
  EyeIcon,
  GitHubIcon,
  PuzzleIcon,
  SparklesIcon,
  TerminalIcon,
  UsersIcon,
} from '@/components/icons';
import {SiteShell} from '@/components/nav/SiteShell';
import {SiteFooter} from '@/components/nav/SiteFooter';
import type {Locale} from '@/i18n/config';
import type {Dictionary} from '@/i18n/dictionaries';
import {site} from '@/lib/site';

type SvgIcon = ComponentType<ComponentProps<'svg'>>;

const AGENT_FEATURE_ICONS: SvgIcon[] = [
  SparklesIcon,
  CpuIcon,
  TerminalIcon,
  EyeIcon,
  CursorIcon,
  DocumentIcon,
  ChartIcon,
  DatabaseIcon,
  PuzzleIcon,
];

/** Centers a section's content and caps its width, one content line per region. */
function Container({
  children,
  gap = 8,
  paddingBlock = 10,
}: {
  children: ReactNode;
  gap?: 4 | 6 | 8 | 10;
  paddingBlock?: 6 | 8 | 10;
}) {
  return (
    <Center axis="horizontal">
      <VStack width="100%" maxWidth={1120} paddingInline={6} paddingBlock={paddingBlock} gap={gap}>
        {children}
      </VStack>
    </Center>
  );
}

function Hero({locale, dict}: {locale: Locale; dict: Dictionary}) {
  const t = dict.landing;
  return (
    <Container gap={10}>
      <VStack gap={6} hAlign="center">
        <Text type="label" color="accent" justify="center">
          {t.eyebrow}
        </Text>
        <VStack gap={4} hAlign="center" maxWidth={820}>
          <Heading level={1} type="display-1" justify="center" textWrap="balance">
            {t.title}
          </Heading>
          <Text type="large" weight="normal" color="secondary" justify="center" textWrap="pretty">
            {t.tagline}
          </Text>
        </VStack>
        <HStack gap={3} wrap="wrap" hAlign="center">
          <Button
            label={t.download}
            variant="primary"
            size="lg"
            href={site.latestRelease}
            target="_blank"
            rel="noopener noreferrer"
            icon={<Icon icon={DownloadIcon} size="sm" color="inherit" />}
          />
          <Button
            label={t.readDocs}
            variant="secondary"
            size="lg"
            href={`/${locale}/docs/`}
            endContent={<Icon icon={ArrowRightIcon} size="sm" color="inherit" />}
          />
        </HStack>
        <HStack gap={2} vAlign="center">
          <StatusDot variant="success" label={t.stable} />
          <Text type="supporting">
            {t.status} {site.version} · {t.codeOssBase} {site.codeOss}
          </Text>
        </HStack>
      </VStack>
      <AgentDemo dict={dict} />
    </Container>
  );
}

function AgentDemo({dict}: {dict: Dictionary}) {
  const t = dict.landing.demo;
  return (
    <Center axis="horizontal">
      <Card padding={0} width="100%" maxWidth={820} elevation="low">
        <Layout
          height="auto"
          header={
            <LayoutHeader hasDivider>
              <HStack gap={3} vAlign="center" hAlign="between" paddingInline={4} paddingBlock={2}>
                <HStack gap={2} vAlign="center">
                  <Icon icon={SparklesIcon} size="sm" color="accent" />
                  <Text type="label">{t.title}</Text>
                </HStack>
                <Token label={t.modelLabel} size="sm" />
              </HStack>
            </LayoutHeader>
          }
          content={
            <LayoutContent padding={4} isScrollable={false}>
              <VStack gap={4}>
                <ChatMessageList density="compact" align="top">
                  <ChatMessage sender="user">
                    <ChatMessageBubble>{t.userMessage}</ChatMessageBubble>
                  </ChatMessage>
                  <ChatMessage sender="assistant">
                    <ChatMessageBubble
                      variant="ghost"
                      metadata={
                        <ChatMessageMetadata
                          footer={<Text type="supporting">{t.toolSummary}</Text>}
                        />
                      }>
                      <Markdown density="compact" headingLevelStart={4}>
                        {t.assistantMessage}
                      </Markdown>
                    </ChatMessageBubble>
                  </ChatMessage>
                </ChatMessageList>
                <ChatComposer
                  placeholder={t.composerPlaceholder}
                  onSubmit={() => {}}
                  isDisabled
                  elevation="none"
                  density="compact"
                />
              </VStack>
            </LayoutContent>
          }
        />
      </Card>
    </Center>
  );
}

function About({dict}: {dict: Dictionary}) {
  const t = dict.landing.about;
  return (
    <Section variant="transparent" padding={0} dividers={['top']}>
      <Container>
        <Grid columns={{minWidth: 320, max: 2}} gap={10} align="start">
          <VStack gap={3}>
            <Heading level={2}>{t.title}</Heading>
            <Text color="secondary" textWrap="pretty">
              {t.body}
            </Text>
          </VStack>
          <MetadataList columns="single" label={{position: 'start', width: 160}}>
            <MetadataListItem label={t.metaVersion}>
              <Text hasTabularNumbers>{site.version}</Text>
            </MetadataListItem>
            <MetadataListItem label={t.metaBase}>
              <Text hasTabularNumbers>{site.codeOss}</Text>
            </MetadataListItem>
            <MetadataListItem label={t.metaChannel}>
              <Text>{site.channel}</Text>
            </MetadataListItem>
            <MetadataListItem label={t.metaLicense}>
              <Link href={site.license} isExternalLink>
                MIT
              </Link>
            </MetadataListItem>
            <MetadataListItem label={t.metaGallery}>
              <Link href={site.openVsx} isExternalLink>
                Open VSX
              </Link>
            </MetadataListItem>
            <MetadataListItem label={t.metaPlatforms}>
              <Text>{t.platforms}</Text>
            </MetadataListItem>
          </MetadataList>
        </Grid>
      </Container>
    </Section>
  );
}

function AgentFeatures({dict}: {dict: Dictionary}) {
  const t = dict.landing.agent;
  return (
    <Section variant="muted" padding={0}>
      <Container>
        <VStack gap={4} maxWidth={720}>
          <Heading level={2}>{t.title}</Heading>
          <Text color="secondary" textWrap="pretty">
            {t.intro}
          </Text>
          <HStack gap={2} wrap="wrap" vAlign="center">
            <Text type="supporting">{t.modesLabel}</Text>
            {t.modes.map(mode => (
              <Token key={mode} label={mode} size="sm" />
            ))}
          </HStack>
        </VStack>
        <Grid columns={{minWidth: 280, max: 3}} gap={8} align="start">
          {t.features.map((feature, index) => {
            const FeatureIcon = AGENT_FEATURE_ICONS[index % AGENT_FEATURE_ICONS.length];
            return (
              <VStack key={feature.title} gap={3}>
                <NavIcon icon={<Icon icon={FeatureIcon} size="sm" />} />
                <VStack gap={1}>
                  <Text weight="semibold">{feature.title}</Text>
                  <Text color="secondary" textWrap="pretty">
                    {feature.description}
                  </Text>
                </VStack>
              </VStack>
            );
          })}
        </Grid>
      </Container>
    </Section>
  );
}

function EditorFeatures({dict}: {dict: Dictionary}) {
  const t = dict.landing.editor;
  return (
    <Container>
      <Grid columns={{minWidth: 320, max: 2}} gap={10} align="start">
        <VStack gap={3}>
          <Heading level={2}>{t.title}</Heading>
          <Text color="secondary" textWrap="pretty">
            {t.intro}
          </Text>
        </VStack>
        <List hasDividers density="spacious">
          {t.items.map(item => (
            <ListItem
              key={item.title}
              label={item.title}
              description={<Text color="secondary">{item.description}</Text>}
            />
          ))}
        </List>
      </Grid>
    </Container>
  );
}

function Install({locale, dict}: {locale: Locale; dict: Dictionary}) {
  const t = dict.landing.install;
  const [platform, setPlatform] = useState<'linux' | 'windows'>('linux');
  const steps = platform === 'linux' ? t.linuxSteps : t.windowsSteps;
  const note = platform === 'linux' ? t.linuxNote : t.windowsNote;

  return (
    <Section variant="transparent" padding={0} dividers={['top']}>
      <Container gap={6}>
        <VStack gap={3} maxWidth={720}>
          <Heading level={2}>{t.title}</Heading>
          <Text color="secondary" textWrap="pretty">
            {t.intro}
          </Text>
        </VStack>
        <VStack gap={4}>
          <SegmentedControl
            label={t.platformLabel}
            value={platform}
            onChange={value => setPlatform(value as 'linux' | 'windows')}>
            <SegmentedControlItem value="linux" label={t.linux} />
            <SegmentedControlItem value="windows" label={t.windows} />
          </SegmentedControl>
          <CodeBlock code={steps} language="bash" width="100%" hasLanguageLabel={false} isWrapped />
          <Text type="supporting" textWrap="pretty">
            {note}
          </Text>
        </VStack>
        <HStack gap={3} wrap="wrap">
          <Button
            label={t.allReleases}
            variant="primary"
            href={site.releases}
            target="_blank"
            rel="noopener noreferrer"
            icon={<Icon icon={GitHubIcon} size="sm" color="inherit" />}
          />
          <Button label={t.guide} variant="secondary" href={`/${locale}/docs/installation/`} />
        </HStack>
      </Container>
    </Section>
  );
}

function Privacy({locale, dict}: {locale: Locale; dict: Dictionary}) {
  const t = dict.landing.privacy;
  return (
    <Section variant="muted" padding={0}>
      <Container gap={4} paddingBlock={8}>
        <VStack gap={3} maxWidth={720}>
          <Heading level={2}>{t.title}</Heading>
          <Text color="secondary" textWrap="pretty">
            {t.body}
          </Text>
          <HStack>
            <Link href={`/${locale}/docs/privacy/`} isStandalone>
              {t.link}
            </Link>
          </HStack>
        </VStack>
      </Container>
    </Section>
  );
}

function Contribute({locale, dict}: {locale: Locale; dict: Dictionary}) {
  const t = dict.landing.contribute;
  return (
    <Container gap={6}>
      <VStack gap={4} hAlign="center">
        <NavIcon icon={<Icon icon={UsersIcon} size="sm" />} />
        <Heading level={2} justify="center">
          {t.title}
        </Heading>
        <VStack maxWidth={640}>
          <Text color="secondary" justify="center" textWrap="pretty">
            {t.body}
          </Text>
        </VStack>
        <HStack gap={3} wrap="wrap" hAlign="center">
          <Button
            label={t.repo}
            variant="primary"
            href={site.repo}
            target="_blank"
            rel="noopener noreferrer"
            icon={<Icon icon={GitHubIcon} size="sm" color="inherit" />}
          />
          <Button
            label={t.discussions}
            variant="secondary"
            href={site.discussions}
            target="_blank"
            rel="noopener noreferrer"
          />
          <Button label={t.guide} variant="ghost" href={`/${locale}/docs/contributing/`} />
        </HStack>
      </VStack>
    </Container>
  );
}

export function LandingPage({locale, dict}: {locale: Locale; dict: Dictionary}) {
  return (
    <SiteShell locale={locale} dict={dict} current="home" variant="surface">
      <VStack gap={0}>
        <Hero locale={locale} dict={dict} />
        <About dict={dict} />
        <AgentFeatures dict={dict} />
        <EditorFeatures dict={dict} />
        <Install locale={locale} dict={dict} />
        <Privacy locale={locale} dict={dict} />
        <Contribute locale={locale} dict={dict} />
        <SiteFooter locale={locale} dict={dict} />
      </VStack>
    </SiteShell>
  );
}
