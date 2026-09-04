/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Strings for the OpenIDE surfaces that live outside the chat contribution: the update commands
 * and their status notifications, the composer's rejection messages, and the OpenIDE sections of
 * the Settings table of contents.
 *
 * They used to go through VS Code's `localize()` with the SPANISH text as the default, which no
 * language pack can ever translate away. Spread into the same `STRINGS` object as the rest, so
 * `t()` and `OpenideStringKey` still see one flat dictionary.
 */

export const OPENIDE_SURFACE_STRINGS = {
	// ---- Update commands
	'update.check': { es: 'OpenIDE: Buscar actualizaciones', en: 'OpenIDE: Check for Updates' },
	'update.download': { es: 'OpenIDE: Descargar actualización', en: 'OpenIDE: Download Update' },
	'update.install': { es: 'OpenIDE: Instalar actualización', en: 'OpenIDE: Install Update' },
	'update.restart': { es: 'OpenIDE: Reiniciar y actualizar', en: 'OpenIDE: Restart and Update' },
	'update.recover': { es: 'OpenIDE: Restaurar versión anterior', en: 'OpenIDE: Restore Previous Version' },
	// ---- Update status notifications
	'update.status.checking': { es: 'Buscando actualizaciones de {0}…', en: 'Checking for {0} updates…' },
	'update.status.available': { es: '{0} {1} está disponible.', en: '{0} {1} is available.' },
	'update.status.downloading': { es: 'Descargando {0}…', en: 'Downloading {0}…' },
	'update.status.verifying': { es: 'Verificando firma y SHA-256…', en: 'Verifying signature and SHA-256…' },
	'update.status.downloaded': { es: 'Actualización descargada y verificada.', en: 'Update downloaded and verified.' },
	'update.status.ready': { es: 'Actualización lista. Reiniciá para instalarla.', en: 'Update ready. Restart to install it.' },
	'update.status.recovery': { es: 'Hay una versión anterior disponible para recuperación.', en: 'A previous version is available for recovery.' },
	'update.status.disabled': { es: 'Las actualizaciones automáticas no están disponibles en esta instalación.', en: 'Automatic updates are not available in this installation.' },
	'update.status.upToDate': { es: '{0} está actualizado.', en: '{0} is up to date.' },
	// ---- Composer rejections
	'chat.queue.disabled': { es: 'La cola está desactivada (openide.chat.queue.enabled). Esperá a que termine el turno o detenelo para enviar.', en: 'The queue is off (openide.chat.queue.enabled). Wait for the turn to finish, or stop it, to send.' },
	'chat.references.full': { es: 'Ya hay {0} archivos referenciados. Quitá uno antes de agregar otro.', en: '{0} files are already referenced. Remove one before adding another.' },
	// ---- Settings table of contents
	'settingsToc.agent': { es: 'Agente IA', en: 'AI Agent' },
	'settingsToc.agentProviders': { es: 'Proveedores de IA', en: 'AI providers' },
	'settingsToc.agentChat': { es: 'Chat y ejecución', en: 'Chat and execution' },
	'settingsToc.agentVoice': { es: 'Voz', en: 'Voice' },
	'settingsToc.agentContext': { es: 'Contexto y límites', en: 'Context and limits' },
	'settingsToc.agentCommands': { es: 'Comandos', en: 'Commands' },
	'settingsToc.agentQuickCommands': { es: 'Comandos rápidos de terminal', en: 'Terminal quick commands' },
	'settingsToc.agentSubagents': { es: 'Subagentes', en: 'Subagents' },
	'settingsToc.agentNotifications': { es: 'Notificaciones', en: 'Notifications' },
	'settingsToc.agentBrowser': { es: 'Navegador', en: 'Browser' },
	'settingsToc.agentImport': { es: 'Importar configuración', en: 'Import settings' },
	'settingsToc.agentAdvanced': { es: 'Modelos y avanzado', en: 'Models and advanced' },
	// ---- Accounts menu (activity bar) and the Settings account block, while signed out
	'accounts.signInWithGitHub': { es: 'Iniciar sesión con GitHub', en: 'Sign in with GitHub' },
	'accounts.signedOut': { es: 'Sin sesión iniciada', en: 'Not signed in' },
	'accounts.signingIn': { es: 'Iniciando sesión…', en: 'Signing in…' },
	'accounts.profile': { es: 'Perfil {0}', en: '{0} profile' },
	'accounts.profileWithAccount': { es: '{0} · perfil {1}', en: '{0} · {1} profile' },
} as const;
