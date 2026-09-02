import version from './version.json';

export const site = {
  name: 'OpenIDE',
  /** Public URL of the deployed site. Set NEXT_PUBLIC_SITE_URL when deploying. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  repo: 'https://github.com/Niiihuel/openide',
  releases: 'https://github.com/Niiihuel/openide/releases',
  latestRelease: 'https://github.com/Niiihuel/openide/releases/latest',
  issues: 'https://github.com/Niiihuel/openide/issues',
  newIssue: 'https://github.com/Niiihuel/openide/issues/new?labels=bug&template=bug_report.md',
  discussions: 'https://github.com/Niiihuel/openide/discussions',
  license: 'https://github.com/Niiihuel/openide/blob/master/LICENSE',
  openVsx: 'https://open-vsx.org/',
  /** Path inside the repository where the website content lives (for "edit this page"). */
  contentPath: 'website/content/docs',
  version: version.version,
  channel: version.channel,
  codeOss: version.codeOss,
} as const;
