import type {DocsSectionId} from '@/lib/docs-nav';

export interface Dictionary {
  meta: {
    title: string;
    description: string;
    docsTitle: string;
    docsDescription: string;
  };
  nav: {
    label: string;
    home: string;
    docs: string;
    download: string;
    github: string;
    releases: string;
    openNavigation: string;
    menuTitle: string;
  };
  theme: {
    switchToDark: string;
    switchToLight: string;
  };
  locale: {
    label: string;
    change: string;
  };
  landing: {
    eyebrow: string;
    title: string;
    tagline: string;
    download: string;
    readDocs: string;
    status: string;
    stable: string;
    codeOssBase: string;
    demo: {
      title: string;
      userMessage: string;
      assistantMessage: string;
      toolSummary: string;
      composerPlaceholder: string;
      modelLabel: string;
    };
    about: {
      title: string;
      body: string;
      metaVersion: string;
      metaBase: string;
      metaChannel: string;
      metaLicense: string;
      metaGallery: string;
      metaPlatforms: string;
      platforms: string;
    };
    agent: {
      title: string;
      intro: string;
      modesLabel: string;
      modes: string[];
      features: Array<{title: string; description: string}>;
    };
    editor: {
      title: string;
      intro: string;
      items: Array<{title: string; description: string}>;
    };
    install: {
      title: string;
      intro: string;
      platformLabel: string;
      linux: string;
      windows: string;
      linuxSteps: string;
      windowsSteps: string;
      linuxNote: string;
      windowsNote: string;
      allReleases: string;
      guide: string;
    };
    privacy: {
      title: string;
      body: string;
      link: string;
    };
    contribute: {
      title: string;
      body: string;
      repo: string;
      discussions: string;
      guide: string;
    };
  };
  footer: {
    tagline: string;
    docs: string;
    releases: string;
    issues: string;
    discussions: string;
    license: string;
    builtWith: string;
  };
  docs: {
    title: string;
    intro: string;
    onThisPage: string;
    previous: string;
    next: string;
    editOnGitHub: string;
    breadcrumbHome: string;
    breadcrumbDocs: string;
    browseAll: string;
    sections: Record<DocsSectionId, {title: string; description: string}>;
  };
  notFound: {
    title: string;
    body: string;
    backHome: string;
  };
}

export const en: Dictionary = {
  meta: {
    title: 'OpenIDE — an open IDE with the agent built into the editor',
    description:
      'OpenIDE is a freely-licensed distribution of VS Code with an AI agent integrated into the workbench: native tools, local preview, plans and persistent codebase memory.',
    docsTitle: 'OpenIDE documentation',
    docsDescription:
      'Install, configure and extend OpenIDE: the agent, providers, extensions, privacy, updates and how to build the product from source.',
  },
  nav: {
    label: 'Main navigation',
    home: 'Home',
    docs: 'Docs',
    download: 'Download',
    github: 'GitHub',
    releases: 'Releases',
    openNavigation: 'Open navigation',
    menuTitle: 'Menu',
  },
  theme: {
    switchToDark: 'Switch to dark mode',
    switchToLight: 'Switch to light mode',
  },
  locale: {
    label: 'Language',
    change: 'Change language',
  },
  landing: {
    eyebrow: 'Open source · Built on Code OSS',
    title: 'The open IDE with an agent built into the editor',
    tagline:
      'OpenIDE is a freely-licensed distribution of Visual Studio Code. The AI assistant is not an extension: it is part of the product, with native workspace tools, a local preview, change review, plans and persistent codebase memory.',
    download: 'Download',
    readDocs: 'Read the docs',
    status: 'Stable',
    stable: 'Stable channel',
    codeOssBase: 'Code OSS',
    demo: {
      title: 'Agent chat',
      userMessage:
        'The checkout form loses its state when the user goes back. Find the cause and fix it without touching the API layer.',
      assistantMessage:
        'The form is remounted because `CheckoutStep` keys change on every render. I moved the key to the step id, added a regression test and opened the preview so you can verify the flow.',
      toolSummary: 'Edited 2 files · ran 1 command · opened localhost preview',
      composerPlaceholder: 'Ask the agent to change, explain or review your code…',
      modelLabel: 'Agent mode',
    },
    about: {
      title: 'What is OpenIDE?',
      body: 'OpenIDE keeps the editor you already know, compatible with the VS Code architecture, extensions and workflow, and adds an agent experience integrated deeply into the workbench. The full source lives in the repository: features, branding and defaults are maintained directly on top of the Code OSS tree, without patches.',
      metaVersion: 'Version',
      metaBase: 'Code OSS base',
      metaChannel: 'Channel',
      metaLicense: 'License',
      metaGallery: 'Extension gallery',
      metaPlatforms: 'Platforms',
      platforms: 'Linux and Windows (macOS builds from source)',
    },
    agent: {
      title: 'An agent that is part of the product',
      intro:
        'The agent lives as a native workbench contribution, not as an extension. It has access to everything the editor knows about your project.',
      modesLabel: 'Operating modes',
      modes: ['Agent', 'Plan', 'Ask', 'Fork'],
      features: [
        {
          title: 'Chat with operating modes',
          description:
            'A conversation in the right dock with Agent, Plan, Ask and Fork modes, plus adversarial review of the changes before committing.',
        },
        {
          title: 'Multi-provider',
          description:
            'Anthropic, OpenAI, Gemini, OpenRouter, Codex and more through OAuth or API keys, plus any OpenAI-compatible endpoint such as Ollama or a corporate proxy. Credentials go to SecretStorage, never to settings.json.',
        },
        {
          title: 'Workspace tools',
          description:
            'Read and edit files, run commands, navigate the codebase through the language server index and follow a safe git flow with atomic commits.',
        },
        {
          title: 'Localhost preview',
          description:
            'An integrated browser for your running app with screenshots, accessible snapshots, DevTools and Playwright-driven interaction over the visible preview.',
        },
        {
          title: 'Pick & Polish',
          description:
            'Visually select elements of your running app and attach their selector, HTML, styles and screenshot to the chat to refine the UI.',
        },
        {
          title: 'Plans',
          description:
            'Design before writing code. Plans open in a dedicated editor with interactive tasks and per-plan model selection.',
        },
        {
          title: 'Canvas',
          description:
            'Visual analytical artifacts with tables, charts and standalone diagrams, stored next to your project.',
        },
        {
          title: 'Codebase memory',
          description:
            'A 3D graph of the relationships in your project and persistent memory across sessions.',
        },
        {
          title: 'MCP, hooks and skills',
          description:
            'Model Context Protocol servers, user shell hooks and reusable project procedures, always behind explicit consent.',
        },
      ],
    },
    editor: {
      title: 'A familiar editor with open defaults',
      intro: 'Everything that makes VS Code productive, without the proprietary parts.',
      items: [
        {
          title: 'VS Code base',
          description:
            'Keeps compatibility with the architecture, extensions and workflow of Visual Studio Code.',
        },
        {
          title: 'Open VSX gallery and no telemetry',
          description:
            'Freely-licensed binaries with no Microsoft proprietary telemetry and Open VSX as the extension gallery.',
        },
        {
          title: 'Complete canonical source',
          description:
            'The product code lives in the repository and a build never resets or replaces that tree.',
        },
        {
          title: 'Independent versioning',
          description:
            'Version numbers follow the Code OSS base plus an OpenIDE revision, so extensions stay compatible while OpenIDE releases independently.',
        },
      ],
    },
    install: {
      title: 'Install OpenIDE',
      intro:
        'Builds are published on GitHub Releases for Linux and Windows. Pick your platform to see the quickest path.',
      platformLabel: 'Platform',
      linux: 'Linux',
      windows: 'Windows',
      linuxSteps:
        '# Download the AppImage from the latest release, then:\nchmod +x OpenIDE-*.AppImage\n./OpenIDE-*.AppImage\n\n# Or extract the tarball and run the binary:\ntar -xzf OpenIDE-linux-x64-*.tar.gz\n./OpenIDE-linux-x64/bin/openide',
      windowsSteps:
        '# 1. Download the Windows installer from the latest release.\n# 2. Run the installer and follow the wizard.\n# 3. Optionally enable "Open with OpenIDE" in the Explorer context menu.\n\n# From a terminal, once installed:\nopenide .',
      linuxNote:
        'The AppImage is the build that the integrated updater can replace by itself. On NixOS run it through the FHS wrapper described in the docs.',
      windowsNote:
        'Windows installers are currently published unsigned, so SmartScreen may show a warning. Verify the checksum published next to each release.',
      allReleases: 'All releases',
      guide: 'Installation guide',
    },
    privacy: {
      title: 'Private by default',
      body: 'OpenIDE does not embed Microsoft telemetry endpoints. Update checks talk only to the signed feed of the project repository, and every AI provider is something you enable and configure yourself.',
      link: 'Read the privacy policy',
    },
    contribute: {
      title: 'Built in the open',
      body: 'The complete source, the build scripts and the release pipeline are public. Report bugs, discuss ideas or send a pull request.',
      repo: 'View on GitHub',
      discussions: 'Join the discussions',
      guide: 'Contributing guide',
    },
  },
  footer: {
    tagline: 'An open IDE built on VS Code, with an AI agent built into the product.',
    docs: 'Documentation',
    releases: 'Releases',
    issues: 'Issues',
    discussions: 'Discussions',
    license: 'MIT License',
    builtWith: 'Built on Code OSS. Not affiliated with Microsoft.',
  },
  docs: {
    title: 'Documentation',
    intro:
      'Everything about installing, using and extending OpenIDE, from the first launch to building the product from source.',
    onThisPage: 'On this page',
    previous: 'Previous',
    next: 'Next',
    editOnGitHub: 'Edit this page on GitHub',
    breadcrumbHome: 'Home',
    breadcrumbDocs: 'Docs',
    browseAll: 'Browse all pages',
    sections: {
      using: {
        title: 'Using OpenIDE',
        description: 'Installation, first steps, updates, migration and troubleshooting.',
      },
      agent: {
        title: 'Agent',
        description: 'Modes, providers, workspace tools, MCP, hooks, skills and memory.',
      },
      extensions: {
        title: 'Extensions',
        description: 'Open VSX, alternative galleries, compatibility and accounts.',
      },
      privacy: {
        title: 'Privacy',
        description: 'What OpenIDE sends, what it never sends, and how to verify it.',
      },
      contributing: {
        title: 'Contributing',
        description: 'How the fork is laid out, how to build it and which invariants protect a release.',
      },
      reference: {
        title: 'Reference',
        description: 'Other resources and less common questions.',
      },
    },
  },
  notFound: {
    title: 'Page not found',
    body: 'The page you are looking for does not exist or has moved.',
    backHome: 'Back to home',
  },
};
