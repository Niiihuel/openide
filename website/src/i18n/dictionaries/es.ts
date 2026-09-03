import type {Dictionary} from './en';

export const es: Dictionary = {
  meta: {
    title: 'OpenIDE — un IDE abierto con el agente integrado en el editor',
    description:
      'OpenIDE es una distribución de VS Code con licencia libre y un agente de IA integrado en el workbench: herramientas nativas, vista previa local, planes y memoria persistente del código.',
    docsTitle: 'Documentación de OpenIDE',
    docsDescription:
      'Instalá, configurá y extendé OpenIDE: el agente, los proveedores, las extensiones, la privacidad, las actualizaciones y cómo compilar el producto desde el código fuente.',
  },
  nav: {
    label: 'Navegación principal',
    home: 'Inicio',
    docs: 'Docs',
    download: 'Descargar',
    github: 'GitHub',
    releases: 'Releases',
    openNavigation: 'Abrir navegación',
    menuTitle: 'Menú',
  },
  theme: {
    switchToDark: 'Cambiar a modo oscuro',
    switchToLight: 'Cambiar a modo claro',
  },
  locale: {
    label: 'Idioma',
    change: 'Cambiar idioma',
  },
  landing: {
    eyebrow: 'Código abierto · Basado en Code OSS',
    title: 'El IDE abierto con un agente integrado en el editor',
    tagline:
      'OpenIDE es una distribución de Visual Studio Code con licencia libre. El asistente de IA no es una extensión: es parte del producto, con herramientas nativas del workspace, vista previa local, revisión de cambios, planes y memoria persistente del código.',
    download: 'Descargar',
    readDocs: 'Leer la documentación',
    status: 'Estable',
    stable: 'Canal estable',
    codeOssBase: 'Code OSS',
    demo: {
      title: 'Chat del agente',
      userMessage:
        'El formulario de checkout pierde el estado cuando el usuario vuelve atrás. Encontrá la causa y arreglalo sin tocar la capa de API.',
      assistantMessage:
        'El formulario se vuelve a montar porque las keys de `CheckoutStep` cambian en cada render. Moví la key al id del paso, agregué un test de regresión y abrí la vista previa para que verifiques el flujo.',
      toolSummary: '2 archivos editados · 1 comando ejecutado · vista previa localhost abierta',
      composerPlaceholder: 'Pedile al agente que cambie, explique o revise tu código…',
      modelLabel: 'Modo Agent',
    },
    about: {
      title: '¿Qué es OpenIDE?',
      body: 'OpenIDE conserva el editor que ya conocés, compatible con la arquitectura, las extensiones y el flujo de trabajo de VS Code, y suma una experiencia de agente integrada profundamente en el workbench. El código fuente completo vive en el repositorio: las funcionalidades, la marca y los valores por defecto se mantienen directamente sobre el árbol de Code OSS, sin parches.',
      metaVersion: 'Versión',
      metaBase: 'Base Code OSS',
      metaChannel: 'Canal',
      metaLicense: 'Licencia',
      metaGallery: 'Galería de extensiones',
      metaPlatforms: 'Plataformas',
      platforms: 'Linux y Windows (macOS compilando desde el código fuente)',
    },
    agent: {
      title: 'Un agente que es parte del producto',
      intro:
        'El agente vive como una contribución nativa del workbench, no como una extensión. Tiene acceso a todo lo que el editor sabe sobre tu proyecto.',
      modesLabel: 'Modos de operación',
      modes: ['Agent', 'Plan', 'Ask', 'Fork'],
      features: [
        {
          title: 'Chat con modos de operación',
          description:
            'Una conversación en el panel derecho con los modos Agent, Plan, Ask y Fork, más una revisión adversarial de los cambios antes de hacer commit.',
        },
        {
          title: 'Multiproveedor',
          description:
            'Anthropic, OpenAI, Gemini, OpenRouter, Codex y más mediante OAuth o API keys, además de cualquier endpoint compatible con OpenAI como Ollama o un proxy corporativo. Las credenciales van a SecretStorage, nunca a settings.json.',
        },
        {
          title: 'Herramientas del workspace',
          description:
            'Leer y editar archivos, ejecutar comandos, navegar el código a través del índice del language server y seguir un flujo git seguro con commits atómicos.',
        },
        {
          title: 'Vista previa localhost',
          description:
            'Un navegador integrado para tu aplicación en ejecución, con capturas, snapshots accesibles, DevTools e interacción con Playwright sobre la vista previa visible.',
        },
        {
          title: 'Pick & Polish',
          description:
            'Seleccioná visualmente elementos de tu aplicación en ejecución y adjuntá su selector, HTML, estilos y captura al chat para refinar la interfaz.',
        },
        {
          title: 'Planes',
          description:
            'Diseñá antes de escribir código. Los planes se abren en un editor dedicado con tareas interactivas y selección de modelo por plan.',
        },
        {
          title: 'Canvas',
          description:
            'Artefactos analíticos visuales con tablas, gráficos y diagramas independientes, guardados junto a tu proyecto.',
        },
        {
          title: 'Memoria del código',
          description:
            'Un grafo 3D de las relaciones de tu proyecto y memoria persistente entre sesiones.',
        },
        {
          title: 'MCP, hooks y skills',
          description:
            'Servidores Model Context Protocol, hooks de shell del usuario y procedimientos reutilizables del proyecto, siempre detrás de un consentimiento explícito.',
        },
      ],
    },
    editor: {
      title: 'Un editor familiar con valores por defecto abiertos',
      intro: 'Todo lo que hace productivo a VS Code, sin las partes propietarias.',
      items: [
        {
          title: 'Base VS Code',
          description:
            'Mantiene la compatibilidad con la arquitectura, las extensiones y el flujo de trabajo de Visual Studio Code.',
        },
        {
          title: 'Galería Open VSX y sin telemetría',
          description:
            'Binarios con licencia libre, sin la telemetría propietaria de Microsoft y con Open VSX como galería de extensiones.',
        },
        {
          title: 'Código fuente canónico completo',
          description:
            'El código del producto vive en el repositorio y un build nunca reinicia ni reemplaza ese árbol.',
        },
        {
          title: 'Versionado independiente',
          description:
            'Los números de versión siguen la base de Code OSS más una revisión de OpenIDE, así las extensiones siguen siendo compatibles mientras OpenIDE publica de forma independiente.',
        },
      ],
    },
    install: {
      title: 'Instalar OpenIDE',
      intro:
        'Los builds se publican en GitHub Releases para Linux y Windows. Elegí tu plataforma para ver el camino más rápido.',
      platformLabel: 'Plataforma',
      linux: 'Linux',
      windows: 'Windows',
      linuxSteps:
        '# Descargá el AppImage del último release y luego:\nchmod +x OpenIDE-*.AppImage\n./OpenIDE-*.AppImage\n\n# O extraé el tarball y ejecutá el binario:\ntar -xzf OpenIDE-linux-x64-*.tar.gz\n./OpenIDE-linux-x64/bin/openide',
      windowsSteps:
        '# 1. Descargá el instalador de Windows del último release.\n# 2. Ejecutá el instalador y seguí el asistente.\n# 3. Opcionalmente activá "Open with OpenIDE" en el menú contextual del Explorador.\n\n# Desde una terminal, una vez instalado:\nopenide .',
      linuxNote:
        'El AppImage es el build que el actualizador integrado puede reemplazar por sí solo. En NixOS ejecutalo a través del wrapper FHS descrito en la documentación.',
      windowsNote:
        'Los instaladores de Windows se publican actualmente sin firmar, así que SmartScreen puede mostrar una advertencia. Verificá el checksum publicado junto a cada release.',
      allReleases: 'Todos los releases',
      guide: 'Guía de instalación',
    },
    privacy: {
      title: 'Privado por defecto',
      body: 'OpenIDE no incorpora endpoints de telemetría de Microsoft. Las comprobaciones de actualización hablan únicamente con el feed firmado del repositorio del proyecto, y cada proveedor de IA es algo que vos habilitás y configurás.',
      link: 'Leer la política de privacidad',
    },
    contribute: {
      title: 'Construido a la vista de todos',
      body: 'El código fuente completo, los scripts de build y la pipeline de release son públicos. Reportá errores, discutí ideas o enviá un pull request.',
      repo: 'Ver en GitHub',
      discussions: 'Sumarte a las discusiones',
      guide: 'Guía de contribución',
    },
  },
  footer: {
    tagline: 'Un IDE abierto basado en VS Code, con un agente de IA integrado en el producto.',
    docs: 'Documentación',
    releases: 'Releases',
    issues: 'Issues',
    discussions: 'Discusiones',
    license: 'Licencia MIT',
    builtWith: 'Basado en Code OSS. Sin afiliación con Microsoft.',
  },
  docs: {
    title: 'Documentación',
    intro:
      'Todo sobre instalar, usar y extender OpenIDE, desde el primer arranque hasta compilar el producto desde el código fuente.',
    onThisPage: 'En esta página',
    previous: 'Anterior',
    next: 'Siguiente',
    editOnGitHub: 'Editar esta página en GitHub',
    breadcrumbHome: 'Inicio',
    breadcrumbDocs: 'Docs',
    browseAll: 'Ver todas las páginas',
    sections: {
      using: {
        title: 'Usar OpenIDE',
        description: 'Instalación, primeros pasos, actualizaciones, migración y resolución de problemas.',
      },
      agent: {
        title: 'Agente',
        description: 'Modos, proveedores, herramientas del workspace, MCP, hooks, skills y memoria.',
      },
      extensions: {
        title: 'Extensiones',
        description: 'Open VSX, galerías alternativas, compatibilidad y cuentas.',
      },
      privacy: {
        title: 'Privacidad',
        description: 'Qué envía OpenIDE, qué no envía nunca y cómo verificarlo.',
      },
      contributing: {
        title: 'Contribuir',
        description: 'Cómo está armado el fork, cómo compilarlo y qué invariantes protegen un release.',
      },
      reference: {
        title: 'Referencia',
        description: 'Otros recursos y preguntas menos frecuentes.',
      },
    },
  },
  notFound: {
    title: 'Página no encontrada',
    body: 'La página que buscás no existe o se movió.',
    backHome: 'Volver al inicio',
  },
};
