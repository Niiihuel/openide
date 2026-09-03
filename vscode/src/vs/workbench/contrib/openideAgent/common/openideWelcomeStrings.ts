/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The welcome surfaces' vocabulary, in the two languages the product ships.
 *
 * Covers OpenIDE's first-run overlay (`openideWelcomeOverlay.ts`), the empty-window cover page
 * inside the native Welcome editor (`gettingStarted.ts`), and the commands the walkthrough drives
 * — GitHub sign-in and "import from another editor" (`gettingStarted.contribution.ts`).
 *
 * These used to go through VS Code's `localize()` with the SPANISH text as the default, which is
 * backwards: that argument is the English source a language pack translates *from*, so no pack
 * could ever match and an English IDE rendered the welcome screen in Spanish. They live here
 * instead, behind `t()`, which follows `openide.language`.
 *
 * Spread into the same `STRINGS` object as `openideStrings.ts`, so `t()` and `OpenideStringKey`
 * see one flat dictionary.
 */
export const OPENIDE_WELCOME_STRINGS = {
	// -- Overlay chrome ---------------------------------------------------------------------
	'welcome.title': { es: 'Bienvenido a {0}', en: 'Welcome to {0}' },
	'welcome.skip': { es: 'Omitir', en: 'Skip' },
	'welcome.prev': { es: 'Anterior', en: 'Back' },
	'welcome.next': { es: 'Siguiente', en: 'Next' },
	'welcome.finish': { es: 'Empezar', en: 'Get started' },
	'welcome.goToStep': { es: 'Paso {0} de {1}', en: 'Step {0} of {1}' },

	// -- Step 1: theme ----------------------------------------------------------------------
	'welcome.step1.title': { es: 'Elegí tu tema', en: 'Pick your theme' },
	'welcome.step1.desc': { es: 'Tu editor, sin telemetría y a tu manera. Empezá eligiendo cómo se ve.', en: 'Your editor, with no telemetry, your way. Start by choosing how it looks.' },
	'welcome.theme.dark': { es: 'Oscuro nativo', en: 'Native dark' },
	'welcome.theme.light': { es: 'Claro nativo', en: 'Native light' },

	// -- Step 2: GitHub ---------------------------------------------------------------------
	'welcome.step2.title': { es: 'Conectá con GitHub', en: 'Connect to GitHub' },
	'welcome.step2.desc': { es: 'Iniciá sesión para clonar, sincronizar y publicar tus repositorios sin salir del editor.', en: 'Sign in to clone, sync and publish your repositories without leaving the editor.' },
	'welcome.gh.connect': { es: 'Conectar con GitHub', en: 'Connect to GitHub' },
	'welcome.gh.connecting': { es: 'Conectando… seguí los pasos de GitHub', en: 'Connecting… follow the steps on GitHub' },
	'welcome.gh.connected': { es: 'Conectado como {0}', en: 'Connected as {0}' },
	'welcome.gh.success': { es: 'Conectado a GitHub como {0}.', en: 'Connected to GitHub as {0}.' },
	'welcome.gh.error': { es: 'No se pudo conectar con GitHub: {0}', en: 'Could not connect to GitHub: {0}' },

	// -- Step 3: import from another editor --------------------------------------------------
	'welcome.step3.title': { es: 'Traé tu configuración', en: 'Bring your configuration' },
	'welcome.step3.desc': { es: 'Ajustes, atajos y extensiones, desde el editor que ya venías usando.', en: 'Settings, keybindings and extensions, from the editor you were already using.' },
	'welcome.import.btn': { es: 'Importar', en: 'Import' },
	'welcome.import.searching': { es: 'Buscando editores instalados…', en: 'Looking for installed editors…' },
	'welcome.import.unknown': { es: 'Sin detectar en el PATH', en: 'Not detected on the PATH' },
	'welcome.import.found': { es: '{0} de {1} detectados en el PATH.', en: '{0} of {1} detected on the PATH.' },
	'welcome.import.none': { es: 'No se encontró ninguno en el PATH. Podés importar igual si sabés que está instalado.', en: 'None were found on the PATH. You can still import if you know one is installed.' },
	'welcome.import.probeFailed': { es: 'No se pudo revisar el PATH. Elegí el editor a mano.', en: 'The PATH could not be checked. Pick the editor by hand.' },
	'welcome.import.progress': { es: 'Importando desde {0}…', en: 'Importing from {0}…' },
	'welcome.import.extensions': { es: 'Instalando {0} extensiones…', en: 'Installing {0} extensions…' },
	'welcome.import.noExtensions': { es: 'No se pudieron leer las extensiones de {0}.', en: 'The extensions from {0} could not be read.' },
	'welcome.import.someFailed': { es: '{0} no se pudieron importar (puede que no estén en Open VSX).', en: '{0} could not be imported (they may not be on Open VSX).' },
	'welcome.import.done': { es: 'Se importaron {0} elementos desde {1}.', en: 'Imported {0} items from {1}.' },
	'welcome.import.failed': { es: 'No se pudo importar desde {0}.', en: 'Could not import from {0}.' },
	'welcome.import.nothing': { es: 'No se encontró una instalación de {0} para importar.', en: 'No {0} installation was found to import from.' },

	// -- Step 4: updates ---------------------------------------------------------------------
	'welcome.step4.title': { es: 'Actualizaciones', en: 'Updates' },
	'welcome.step4.desc': { es: 'OpenIDE se actualiza solo, y verifica cada build antes de instalarlo.', en: 'OpenIDE updates itself, and verifies every build before installing it.' },
	'welcome.update.channelInsider': { es: 'Canal insider', en: 'Insider channel' },
	'welcome.update.channelStable': { es: 'Canal estable', en: 'Stable channel' },
	'welcome.update.cardTitle': { es: 'Actualizaciones firmadas, de punta a punta', en: 'Signed updates, end to end' },
	'welcome.update.f1.title': { es: 'Firma verificada antes de bajar nada', en: 'Signature verified before anything is downloaded' },
	'welcome.update.f1.desc': { es: 'El manifest viene firmado con Ed25519 y se valida contra la clave del producto.', en: 'The manifest is signed with Ed25519 and validated against the product key.' },
	'welcome.update.f2.title': { es: 'SHA-256 y tamaño exactos', en: 'Exact SHA-256 and size' },
	'welcome.update.f2.desc': { es: 'El artefacto descargado se compara byte a byte con lo que el manifest declara.', en: 'The downloaded artifact is compared byte for byte against what the manifest declares.' },
	'welcome.update.f3.title': { es: 'Vuelta atrás si algo sale mal', en: 'Roll back if something goes wrong' },
	'welcome.update.f3.desc': { es: 'La versión anterior queda guardada y se puede restaurar desde la paleta de comandos.', en: 'The previous version is kept and can be restored from the command palette.' },
	'welcome.update.check': { es: 'Buscar ahora', en: 'Check now' },
	'welcome.update.checking': { es: 'Buscando actualizaciones…', en: 'Checking for updates…' },
	'welcome.update.available': { es: '{0} {1} está disponible.', en: '{0} {1} is available.' },
	'welcome.update.downloading': { es: 'Descargando la actualización…', en: 'Downloading the update…' },
	'welcome.update.verifying': { es: 'Verificando la firma y el SHA-256…', en: 'Verifying the signature and the SHA-256…' },
	'welcome.update.downloaded': { es: 'Actualización descargada y verificada.', en: 'Update downloaded and verified.' },
	'welcome.update.ready': { es: 'Actualización lista. Reiniciá para instalarla.', en: 'Update ready. Restart to install it.' },
	'welcome.update.disabled': { es: 'Las actualizaciones automáticas no están disponibles en esta instalación.', en: 'Automatic updates are not available in this installation.' },
	'welcome.update.idle': { es: 'Estás en la última versión.', en: 'You are on the latest version.' },

	// -- Empty-window cover page --------------------------------------------------------------
	'welcome.empty.tagline': { es: 'Tu entorno de desarrollo', en: 'Your development environment' },
	'welcome.empty.openProject': { es: 'Abrir proyecto', en: 'Open project' },
	'welcome.empty.cloneRepo': { es: 'Clonar repositorio', en: 'Clone repository' },
	'welcome.empty.connectSsh': { es: 'Conectar por SSH', en: 'Connect over SSH' },
	'welcome.empty.recent': { es: 'Proyectos recientes', en: 'Recent projects' },
	'welcome.empty.noRecent': { es: 'Todavía no hay proyectos recientes.', en: 'No recent projects yet.' },

	// -- Command titles -----------------------------------------------------------------------
	'welcome.cmd.signInGitHub': { es: 'OpenIDE: Conectar con GitHub', en: 'OpenIDE: Connect to GitHub' },
	'welcome.cmd.importFromEditor': { es: 'OpenIDE: Importar configuración y extensiones de otro editor', en: 'OpenIDE: Import settings and extensions from another editor' },
	'welcome.cmd.showWelcome': { es: 'OpenIDE: Mostrar bienvenida', en: 'OpenIDE: Show welcome' },
} as const;
