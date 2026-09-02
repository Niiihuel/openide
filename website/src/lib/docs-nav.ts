/**
 * Documentation structure. Section ids map to `dictionary.docs.sections`;
 * slugs map to `content/docs/<locale>/<slug>.md`. Order here is the order in
 * the sidebar and in the previous/next pager.
 */
export type DocsSectionId =
  | 'using'
  | 'agent'
  | 'extensions'
  | 'privacy'
  | 'contributing'
  | 'reference';

export interface DocsSectionDef {
  id: DocsSectionId;
  slugs: readonly string[];
}

export const docsSections: readonly DocsSectionDef[] = [
  {
    id: 'using',
    slugs: [
      'getting-started',
      'installation',
      'usage',
      'keyboard-shortcuts',
      'updates',
      'migration',
      'troubleshooting',
    ],
  },
  {
    id: 'agent',
    slugs: ['agent', 'agent-providers', 'agent-workspace', 'agent-extensibility'],
  },
  {
    id: 'extensions',
    slugs: ['extensions', 'extensions-compatibility', 'github-copilot', 'accounts-authentication'],
  },
  {
    id: 'privacy',
    slugs: ['privacy', 'telemetry'],
  },
  {
    id: 'contributing',
    slugs: ['contributing', 'fork-architecture', 'building', 'reliability', 'theming-surfaces'],
  },
  {
    id: 'reference',
    slugs: ['other-resources'],
  },
];

export const allDocSlugs: readonly string[] = docsSections.flatMap(s => s.slugs);

export function sectionOfSlug(slug: string): DocsSectionId | undefined {
  return docsSections.find(s => s.slugs.includes(slug))?.id;
}
