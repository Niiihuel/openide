/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { GettingStartedInputSerializer, GettingStartedPage, inWelcomeContext } from './gettingStarted.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { MenuId, registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ContextKeyExpr, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IWalkthroughsService } from './gettingStartedService.js';
import { GettingStartedEditorOptions, GettingStartedInput } from './gettingStartedInput.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { isLinux, isMacintosh, isWindows, OperatingSystem as OS } from '../../../../base/common/platform.js';
import { IExtensionManagementServerService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { StartupPageEditorResolverContribution, StartupPageRunnerContribution } from './startupPage.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { AccessibleViewRegistry } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { GettingStartedAccessibleView } from './gettingStartedAccessibleView.js';
import { AgentSessionsWelcomePage } from '../../welcomeAgentSessions/browser/agentSessionsWelcome.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
// OpenIDE: imports para los comandos de bienvenida (GitHub + importar de VS Code)
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IFileService, FileOperationResult, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { IExtensionGalleryService, IExtensionInfo } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IWorkbenchExtensionManagementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
// OpenIDE: imports para el overlay de bienvenida a pantalla completa
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { $, append, addDisposableListener } from '../../../../base/browser/dom.js';

export * as icons from './gettingStartedIcons.js';

// OpenIDE: comando del step "Conectá con GitHub" del walkthrough de bienvenida.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.signInWithGitHub',
			title: localize2('openide.signInWithGitHub.title', 'OpenIDE: Conectar con GitHub'),
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor) {
		const authenticationService = accessor.get(IAuthenticationService);
		const notificationService = accessor.get(INotificationService);
		try {
			const session = await authenticationService.createSession('github', ['read:user', 'user:email', 'repo']);
			notificationService.info(localize('openide.signInWithGitHub.success', "Conectado a GitHub como {0}.", session.account.label));
		} catch (e) {
			notificationService.error(localize('openide.signInWithGitHub.error', "No se pudo conectar con GitHub: {0}", e instanceof Error ? e.message : String(e)));
		}
	}
});

// OpenIDE: editores soportados para importar. Todos son forks de VS Code, asi que
// comparten el formato de settings/extensiones; solo cambia la carpeta de datos.
interface OpenIDEEditor { id: string; name: string; appDir: string; extDir: string; logo: string }
const OPENIDE_EDITORS: ReadonlyArray<OpenIDEEditor> = [
	{ id: 'vscode', name: 'VS Code', appDir: 'Code', extDir: '.vscode', logo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxLjAxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMjU2IDI1NCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJTVkc2UTV3TWJOUSIgeDE9IjUwJSIgeDI9IjUwJSIgeTE9IjAlIiB5Mj0iMTAwJSI+PHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI2ZmZiIvPjxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iI2ZmZiIgc3RvcC1vcGFjaXR5PSIwIi8+PC9saW5lYXJHcmFkaWVudD48cGF0aCBpZD0iU1ZHV2haMTJkamsiIGQ9Ik0xODAuODI4IDI1Mi42MDVhMTUuODcgMTUuODcgMCAwIDAgMTIuNjUtLjQ4Nmw1Mi41MDEtMjUuMjYyYTE1Ljk0IDE1Ljk0IDAgMCAwIDkuMDI1LTE0LjM2NFY0MS4xOTdhMTUuOTQgMTUuOTQgMCAwIDAtOS4wMjUtMTQuMzYzbC01Mi41LTI1LjI2M2ExNS44OCAxNS44OCAwIDAgMC0xOC4xMTUgMy4wODRMNzQuODU3IDk2LjM1bC00My43OC0zMy4yMzJhMTAuNjE0IDEwLjYxNCAwIDAgMC0xMy41Ni42MDNMMy40NzYgNzYuNDk0Yy00LjYzIDQuMjExLTQuNjM1IDExLjQ5NS0uMDEyIDE1LjcxM2wzNy45NjcgMzQuNjM4bC0zNy45NjcgMzQuNjM3Yy00LjYyMyA0LjIxOS00LjYxOCAxMS41MDIuMDEyIDE1LjcxNGwxNC4wNDEgMTIuNzcyYTEwLjYxNCAxMC42MTQgMCAwIDAgMTMuNTYuNjA0bDQzLjc4LTMzLjIzM2wxMDAuNTA3IDkxLjY5NWExNS44NSAxNS44NSAwIDAgMCA1LjQ2NCAzLjU3MW0xMC40NjQtMTgzLjY0OWwtNzYuMjYyIDU3Ljg4OWw3Ni4yNjIgNTcuODg4eiIvPjwvZGVmcz48bWFzayBpZD0iU1ZHU0FRNThIMmYiIGZpbGw9IiNmZmYiPjx1c2UgaHJlZj0iI1NWR1doWjEyZGprIi8+PC9tYXNrPjxwYXRoIGZpbGw9IiMwMDY1YTkiIGQ9Ik0yNDYuMTM1IDI2Ljg3M0wxOTMuNTkzIDEuNTc1YTE1Ljg4NSAxNS44ODUgMCAwIDAtMTguMTIzIDMuMDhMMy40NjYgMTYxLjQ4MmMtNC42MjYgNC4yMTktNC42MiAxMS41MDIuMDEyIDE1LjcxNGwxNC4wNSAxMi43NzJhMTAuNjI1IDEwLjYyNSAwIDAgMCAxMy41NjkuNjA0TDIzOC4yMjkgMzMuNDM2YzYuOTQ5LTUuMjcxIDE2LjkzLS4zMTUgMTYuOTMgOC40MDd2LS42MWExNS45NCAxNS45NCAwIDAgMC05LjAyNC0xNC4zNiIgbWFzaz0idXJsKCNTVkdTQVE1OEgyZikiLz48cGF0aCBmaWxsPSIjMDA3YWNjIiBkPSJtMjQ2LjEzNSAyMjYuODE2bC01Mi41NDIgMjUuMjk4YTE1Ljg5IDE1Ljg5IDAgMCAxLTE4LjEyMy0zLjA4TDMuNDY2IDkyLjIwN2MtNC42MjYtNC4yMTgtNC42Mi0xMS41MDIuMDEyLTE1LjcxM2wxNC4wNS0xMi43NzNhMTAuNjI1IDEwLjYyNSAwIDAgMSAxMy41NjktLjYwM2wyMDcuMTMyIDE1Ny4xMzVjNi45NDkgNS4yNzEgMTYuOTMuMzE1IDE2LjkzLTguNDA4di42MTFhMTUuOTQgMTUuOTQgMCAwIDEtOS4wMjQgMTQuMzYiIG1hc2s9InVybCgjU1ZHU0FRNThIMmYpIi8+PHBhdGggZmlsbD0iIzFmOWNmMCIgZD0iTTE5My40MjggMjUyLjEzNGExNS44OSAxNS44OSAwIDAgMS0xOC4xMjUtMy4wODNjNS44ODEgNS44OCAxNS45MzggMS43MTUgMTUuOTM4LTYuNjAzVjExLjI3M2MwLTguMzE4LTEwLjA1Ny0xMi40ODMtMTUuOTM4LTYuNjAyYTE1Ljg5IDE1Ljg5IDAgMCAxIDE4LjEyNS0zLjA4NGw1Mi41MzMgMjUuMjYzYTE1Ljk0IDE1Ljk0IDAgMCAxIDkuMDMgMTQuMzYzVjIxMi41MWMwIDYuMTI1LTMuNTEgMTEuNzA5LTkuMDMgMTQuMzYzeiIgbWFzaz0idXJsKCNTVkdTQVE1OEgyZikiLz48cGF0aCBmaWxsPSJ1cmwoI1NWRzZRNXdNYk5RKSIgZmlsbC1vcGFjaXR5PSIuMjUiIGQ9Ik0xODAuODI4IDI1Mi42MDVhMTUuODcgMTUuODcgMCAwIDAgMTIuNjUtLjQ4Nmw1Mi41LTI1LjI2M2ExNS45NCAxNS45NCAwIDAgMCA5LjAyNi0xNC4zNjNWNDEuMTk3YTE1Ljk0IDE1Ljk0IDAgMCAwLTkuMDI1LTE0LjM2M0wxOTMuNDc3IDEuNTdhMTUuODggMTUuODggMCAwIDAtMTguMTE0IDMuMDg0TDc0Ljg1NyA5Ni4zNWwtNDMuNzgtMzMuMjMyYTEwLjYxNCAxMC42MTQgMCAwIDAtMTMuNTYuNjAzTDMuNDc2IDc2LjQ5NGMtNC42MyA0LjIxMS00LjYzNSAxMS40OTUtLjAxMiAxNS43MTNsMzcuOTY3IDM0LjYzOGwtMzcuOTY3IDM0LjYzN2MtNC42MjMgNC4yMTktNC42MTggMTEuNTAyLjAxMiAxNS43MTRsMTQuMDQxIDEyLjc3MmExMC42MTQgMTAuNjE0IDAgMCAwIDEzLjU2LjYwNGw0My43OC0zMy4yMzNsMTAwLjUwNiA5MS42OTVhMTUuOSAxNS45IDAgMCAwIDUuNDY1IDMuNTcxbTEwLjQ2NC0xODMuNjVsLTc2LjI2MiA1Ny44OWw3Ni4yNjIgNTcuODg4eiIgbWFzaz0idXJsKCNTVkdTQVE1OEgyZikiLz48L3N2Zz4=' },
	{ id: 'cursor', name: 'Cursor', appDir: 'Cursor', extDir: '.cursor', logo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGZpbGw9ImN1cnJlbnRDb2xvciIgZD0iTTExLjUwMy4xMzFMMS44OTEgNS42NzhhLjg0Ljg0IDAgMCAwLS40Mi43MjZ2MTEuMTg4YzAgLjMuMTYyLjU3NS40Mi43MjRsOS42MDkgNS41NWExIDEgMCAwIDAgLjk5OCAwbDkuNjEtNS41NWEuODQuODQgMCAwIDAgLjQyLS43MjRWNi40MDRhLjg0Ljg0IDAgMCAwLS40Mi0uNzI2TDEyLjQ5Ny4xMzFhMS4wMSAxLjAxIDAgMCAwLS45OTYgME0yLjY1NyA2LjMzOGgxOC41NWMuMjYzIDAgLjQzLjI4Ny4yOTcuNTE1TDEyLjIzIDIyLjkxOGMtLjA2Mi4xMDctLjIyOS4wNjQtLjIyOS0uMDZWMTIuMzM1YS41OS41OSAwIDAgMC0uMjk1LS41MWwtOS4xMS01LjI1N2MtLjEwOS0uMDYzLS4wNjQtLjIzLjA2MS0uMjMiLz48L3N2Zz4=' },
	{ id: 'windsurf', name: 'Windsurf', appDir: 'Windsurf', extDir: '.windsurf', logo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGZpbGw9ImN1cnJlbnRDb2xvciIgZD0iTTIzLjU1IDUuMDY3YTIuMTc3IDIuMTc3IDAgMCAwLTIuMTggMi4xNzd2NC44NjdhMS43NyAxLjc3IDAgMCAxLTEuNzYgMS43NmExLjgyIDEuODIgMCAwIDEtMS40NzItLjc2NmwtNC45NzEtNy4xYTIuMiAyLjIgMCAwIDAtMS44MS0uOTQyYy0xLjEzNCAwLTIuMTU0Ljk2NC0yLjE1NCAyLjE1M3Y0Ljg5NmMwIC45NzItLjc5NyAxLjc2LTEuNzYgMS43NmMtLjU3IDAtMS4xMzYtLjI4Ny0xLjQ3Mi0uNzY2TC40MDggNS4xNkEuMjI0LjIyNCAwIDAgMCAwIDUuMjg4djQuMjQ1YzAgLjIxNS4wNjYuNDIzLjE4OC42bDUuNDc1IDcuODE4Yy4zMjQuNDYyLjguODA1IDEuMzUxLjkzYTIuMTY0IDIuMTY0IDAgMCAwIDIuNjQ1LTIuMDk4VjExLjg5YzAtLjk3Mi43ODctMS43NiAxLjc2LTEuNzZoLjAwMmExLjggMS44IDAgMCAxIDEuNDcyLjc2Nmw0Ljk3MiA3LjFhMi4xNzIgMi4xNzIgMCAwIDAgMy45Ni0xLjIxMnYtNC44OTVhMS43NiAxLjc2IDAgMCAxIDEuNzYtMS43NmguMTk1YS4yMi4yMiAwIDAgMCAuMjItLjIyVjUuMjg3YS4yMi4yMiAwIDAgMC0uMjItLjIyWiIvPjwvc3ZnPg==' },
	{ id: 'antigravity', name: 'Antigravity', appDir: 'Antigravity', extDir: '.antigravity', logo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGZpbGw9ImN1cnJlbnRDb2xvciIgZD0iTTE5Ljk0IDIwLjU5YzEuMDkuODIgMi43My4yNyAxLjIzLTEuMjNDMTYuNjcgMTUgMTcuNjIgMyAxMi4wMyAzUzcuMzkgMTUgMi44OSAxOS4zNmMtMS42NCAxLjY0LjE0IDIuMDUgMS4yMyAxLjIzYzQuMjMtMi44NiAzLjk1LTcuOTEgNy45MS03LjkxczMuNjggNS4wNSA3LjkxIDcuOTEiLz48L3N2Zz4=' },
	{ id: 'vscodium', name: 'VSCodium', appDir: 'VSCodium', extDir: '.vscode-oss', logo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGZpbGw9ImN1cnJlbnRDb2xvciIgZD0iTTExLjU4My41NGExLjQ2NyAxLjQ2NyAwIDAgMC0uNDQxIDIuMDMyYzIuNDI2IDMuNzU4IDIuOTk5IDYuNTkyIDIuNzUgOS4wNzVjLTEuMDA0IDQuNzU2LTMuMTg3IDUuNzIxLTUuMDk0IDUuNzIxYy0xLjg2MyAwLTEuMzY0LTMuMDY1LjAzNi0zLjk2MmMuODM2LS41MjIgMS45MDYtLjg2MSAyLjcyOC0uODYxYy44MTQgMCAxLjQ3NC0uNjU4IDEuNDc0LTEuNDdzLS42Ni0xLjQ3LTEuNDc0LTEuNDdjLS45NiAwLTEuOTAxLjIwMi0yLjc4LjU0NWMuMTgtLjg0Ny4yNDYtMS43NjIuMDE0LTIuNzM1Yy0uMzUyLTEuNDc3LTEuMzY3LTIuODg5LTMuMTI4LTQuMjU3YTEuNDc2IDEuNDc2IDAgMCAwLTIuMDY5LjI1NmMtLjUuNjQtLjM4NCAxLjU2NC4yNTkgMi4wNjNjMS40MzUgMS4xMTQgMS45MDggMS45MzkgMi4wNyAyLjYxOHMuMDMyIDEuNDA3LS4yOTMgMi40MDhjLS40MTYgMS4zNDktLjkgMi41NTMtMS4xMSAzLjcwOGMtLjEwNS41NjgtLjExNCAxLjE4Ny0uMTQgMS42OGMtMS4wMzQtMS4wMDYtMS40MzgtMi4zMzYtMS40MzgtNC4yNzljMC0uODExLS42Ni0xLjQ3LTEuNDc0LTEuNDdBMS40NyAxLjQ3IDAgMCAwIDAgMTEuNjEyYzAgMi42NTQuNzc2IDUuMTc5IDIuODU1IDYuODYzYzEuODgzIDEuNzkzIDYuNjcgMS4xMyA2LjY3IDQuMDFjMCAuODEyIDEuMTkgMS4yMDggMi4wMDQgMS4yMDhjLjgzNCAwIDEuODg1LS41NTggMS44ODUtMS4yMDhjMC0zLjI2NyAzLjQ0My01LjI1MyA5LjExLTUuMjQ0QTEuNDcgMS40NyAwIDAgMCAyNCAxNS43NzNhMS40NyAxLjQ3IDAgMCAwLTEuNDctMS40NzNxLS41OC4wMDEtMS4xMzguMDM1Yy42MzQtMS40OS45MTUtMy4xMy44NTctNC45MDNhMS40NzMgMS40NzMgMCAwIDAtMS41MjItMS40MmExLjQ3IDEuNDcgMCAwIDAtMS40MjUgMS41MTdjLjA3NiAyLjMyLS4wMSA0LjM5My0xLjc0IDUuNDg1Yy0uNDkuMzEtMS4wNjIuNTgtMS42MDQuNThjLjQyLTEuMTQ1LjczOC0yLjM1My44NjktMy42NTVjLjA4My0uODMuMDkxLTEuODE4LS4wMDMtMi41ODVjLS4xNDgtMS4xODgtLjMyNS0yLjUzNS4xMjYtMy41NWMuNDA1LS44NzQgMS4zMTMtMS4yNCAyLjY0NS0xLjI0Yy44MTQgMCAxLjQ3My0uNjU5IDEuNDczLTEuNDdzLS42NTktMS40Ny0xLjQ3My0xLjQ3Yy0xLjk4IDAtMy40ODEgMS4wNDItNC4zMzIgMi4zQTI1IDI1IDAgMCAwIDEzLjYyMS45ODFhMS40NzQgMS40NzQgMCAwIDAtMi4wMzctLjQ0eiIvPjwvc3ZnPg==' },
// OpenIDE is its own product. Keep compatibility metadata in source migrations, but do not
// advertise the build system it originally derived from as a user-facing editor choice.
].filter(editor => editor.id !== 'vscodium');

// OpenIDE: previews de tema (mock con la paleta real de cada tema OpenIDE).
interface OpenIDETheme { id: string; label: string; bg: string; sidebar: string; topbar: string; lines: string[] }
const OPENIDE_THEMES: ReadonlyArray<OpenIDETheme> = [
	{ id: 'OpenIDE Dark', label: 'Oscuro nativo', bg: '#141414', sidebar: '#171717', topbar: '#1f1f1f', lines: ['#5a5a5a', '#8a8a8a', '#6e6e6e', '#9a9a9a', '#7a7a7a'] },
	{ id: 'OpenIDE Light', label: 'Claro nativo', bg: '#ffffff', sidebar: '#f3f3f3', topbar: '#ececec', lines: ['#bdbdbd', '#888888', '#a6a6a6', '#999999', '#bdbdbd'] },
];

// OpenIDE: importa settings/keybindings + extensiones de un editor (fork de VS Code).
async function importFromEditor(accessor: ServicesAccessor, editor: OpenIDEEditor): Promise<void> {
	const fileService = accessor.get(IFileService);
	const notificationService = accessor.get(INotificationService);
	const progressService = accessor.get(IProgressService);
	const environmentService = accessor.get(IWorkbenchEnvironmentService);
	const pathService = accessor.get(IPathService);
	const profileService = accessor.get(IUserDataProfileService);
	const galleryService = accessor.get(IExtensionGalleryService);
	const extensionManagementService = accessor.get(IWorkbenchExtensionManagementService);

	// La carpeta del editor de origen comparte el directorio de configuración con
	// OpenIDE; solo cambia el nombre del producto. Derivamos su ruta desde la nuestra
	// para que funcione en Linux/macOS/Windows.
	const configDir = dirname(dirname(environmentService.userRoamingDataHome));
	const stockUserDir = joinPath(configDir, editor.appDir, 'User');
	const userHome = pathService.userHome({ preferLocal: true });
	const stockExtensionsManifest = joinPath(userHome, editor.extDir, 'extensions', 'extensions.json');

	await progressService.withProgress(
		{ location: ProgressLocation.Notification, title: localize('openide.import.progress', "Importando desde {0}…", editor.name) },
		async (progress) => {
			const imported: string[] = [];
			const failed: string[] = [];

			// 1) settings.json y keybindings.json
			const files = [
				['settings.json', profileService.currentProfile.settingsResource],
				['keybindings.json', profileService.currentProfile.keybindingsResource],
			] as const;
			for (const [name, target] of files) {
				try {
					const content = await fileService.readFile(joinPath(stockUserDir, name));
					await fileService.writeFile(target, content.value);
					imported.push(name);
				} catch (e) {
					if (toFileOperationResult(e as Error) !== FileOperationResult.FILE_NOT_FOUND) {
						failed.push(name);
					}
				}
			}

			// 2) Extensiones desde <extDir>/extensions/extensions.json
			try {
				const manifest = await fileService.readFile(stockExtensionsManifest);
				const entries = JSON.parse(manifest.value.toString()) as Array<{ identifier?: { id?: string; uuid?: string } }>;
				const infos: IExtensionInfo[] = [];
				for (const entry of entries) {
					const id = entry.identifier?.id;
					if (id) {
						infos.push({ id, uuid: entry.identifier?.uuid });
					}
				}
				if (infos.length) {
					progress.report({ message: localize('openide.import.extensions', "Instalando {0} extensiones…", infos.length) });
					const gallery = await galleryService.getExtensions(infos, CancellationToken.None);
					const found = new Set(gallery.map(g => g.identifier.id.toLowerCase()));
					for (const info of infos) {
						if (!found.has(info.id.toLowerCase())) {
							failed.push(info.id);
						}
					}
					for (const g of gallery) {
						try {
							await extensionManagementService.installFromGallery(g);
							imported.push(g.identifier.id);
						} catch (e) {
							failed.push(g.identifier.id);
						}
					}
				}
			} catch (e) {
				if (toFileOperationResult(e as Error) !== FileOperationResult.FILE_NOT_FOUND) {
					notificationService.warn(localize('openide.import.noExtensions', "No se pudieron leer las extensiones de {0}.", editor.name));
				}
			}

			if (imported.length) {
				const tail = failed.length
					? ' ' + localize('openide.import.someFailed', "{0} no se pudieron importar (puede que no estén en Open VSX).", failed.length)
					: '';
				notificationService.info(localize('openide.import.done', "Se importaron {0} elementos desde {1}.", imported.length, editor.name) + tail);
			} else if (failed.length) {
				notificationService.warn(localize('openide.import.failed', "No se pudo importar desde {0}.", editor.name));
			} else {
				notificationService.info(localize('openide.import.nothing', "No se encontró una instalación de {0} para importar.", editor.name));
			}
		}
	);
}

// OpenIDE: comando del step "Importá desde otro editor". Acepta el id del editor (default VS Code).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.importFromVSCode',
			title: localize2('openide.importFromVSCode.title', 'OpenIDE: Importar configuración y extensiones de otro editor'),
			category: Categories.Preferences,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, editorId?: string) {
		const editor = OPENIDE_EDITORS.find(e => e.id === editorId) ?? OPENIDE_EDITORS[0];
		await importFromEditor(accessor, editor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.openWalkthrough',
			title: localize2('miWelcome', 'Welcome'),
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 1,
			},
			metadata: {
				description: localize2('minWelcomeDescription', 'Opens a Walkthrough to help you get started in OpenIDE.')
			}
		});
	}

	public run(
		accessor: ServicesAccessor,
		walkthroughID: string | { category: string; step: string } | undefined,
		optionsOrToSide: { toSide?: boolean; inactive?: boolean } | boolean | undefined
	) {
		const editorService = accessor.get(IEditorService);
		const commandService = accessor.get(ICommandService);
		const configurationService = accessor.get(IConfigurationService);
		const chatEntitlementService = accessor.get(IChatEntitlementService);

		const toSide = typeof optionsOrToSide === 'object' ? optionsOrToSide.toSide : optionsOrToSide;
		const inactive = typeof optionsOrToSide === 'object' ? optionsOrToSide.inactive : false;
		const activeEditor = editorService.activeEditor;

		// If no specific walkthrough is requested and agent sessions welcome is preferred, open that instead
		if (!walkthroughID && !chatEntitlementService.sentiment.hidden && configurationService.getValue<string>('workbench.startupEditor') === 'agentSessionsWelcomePage') {
			commandService.executeCommand(AgentSessionsWelcomePage.COMMAND_ID);
			return;
		} else {
			if (walkthroughID) {
				const selectedCategory = typeof walkthroughID === 'string' ? walkthroughID : walkthroughID.category;
				let selectedStep: string | undefined;
				if (typeof walkthroughID === 'object' && 'category' in walkthroughID && 'step' in walkthroughID) {
					selectedStep = `${walkthroughID.category}#${walkthroughID.step}`;
				} else {
					selectedStep = undefined;
				}

				// If the walkthrough is already open just reveal the step
				if (selectedStep && activeEditor instanceof GettingStartedInput && activeEditor.selectedCategory === selectedCategory) {
					activeEditor.showWelcome = false;
					commandService.executeCommand('walkthroughs.selectStep', selectedStep);
					return;
				}

				let options: GettingStartedEditorOptions;
				if (selectedCategory) {
					// Otherwise open the walkthrough editor with the selected category and step
					options = { selectedCategory, selectedStep, showWelcome: false, preserveFocus: toSide ?? false, inactive };
				} else {
					// Open Welcome page
					options = { selectedCategory, selectedStep, showWelcome: true, preserveFocus: toSide ?? false, inactive };
				}
				editorService.openEditor({
					resource: GettingStartedInput.RESOURCE,
					options
				}, toSide ? SIDE_GROUP : undefined);

			} else {
				editorService.openEditor({
					resource: GettingStartedInput.RESOURCE,
					options: { preserveFocus: toSide ?? false, inactive }
				}, toSide ? SIDE_GROUP : undefined);
			}
		}
	}
});

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(GettingStartedInput.ID, GettingStartedInputSerializer);
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		GettingStartedPage,
		GettingStartedPage.ID,
		localize('welcome', "Welcome")
	),
	[
		new SyncDescriptor(GettingStartedInput)
	]
);

const category = localize2('welcome', "Welcome");

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'welcome.goBack',
			title: localize2('welcome.goBack', 'Go Back'),
			category,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Escape,
				when: inWelcomeContext
			},
			precondition: ContextKeyExpr.equals('activeEditor', 'gettingStartedPage'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const editorPane = editorService.activeEditorPane;
		if (editorPane instanceof GettingStartedPage) {
			editorPane.escape();
		}
	}
});

CommandsRegistry.registerCommand({
	id: 'walkthroughs.selectStep',
	handler: (accessor, stepID: string) => {
		const editorService = accessor.get(IEditorService);
		const editorPane = editorService.activeEditorPane;
		if (editorPane instanceof GettingStartedPage) {
			editorPane.selectStepLoose(stepID);
		} else {
			console.error('Cannot run walkthroughs.selectStep outside of walkthrough context');
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'welcome.markStepComplete',
			title: localize('welcome.markStepComplete', "Mark Step Complete"),
			category,
		});
	}

	run(accessor: ServicesAccessor, arg: string) {
		if (!arg) { return; }
		const gettingStartedService = accessor.get(IWalkthroughsService);
		gettingStartedService.progressStep(arg);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'welcome.markStepIncomplete',
			title: localize('welcome.markStepInomplete', "Mark Step Incomplete"),
			category,
		});
	}

	run(accessor: ServicesAccessor, arg: string) {
		if (!arg) { return; }
		const gettingStartedService = accessor.get(IWalkthroughsService);
		gettingStartedService.deprogressStep(arg);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'welcome.showAllWalkthroughs',
			title: localize2('welcome.showAllWalkthroughs', 'Open Walkthrough...'),
			category,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 3,
			},
		});
	}

	private async getQuickPickItems(
		contextService: IContextKeyService,
		gettingStartedService: IWalkthroughsService
	): Promise<IQuickPickItem[]> {
		const categories = await gettingStartedService.getWalkthroughs();
		return categories
			.filter(c => contextService.contextMatchesRules(c.when))
			.map(x => ({
				id: x.id,
				label: x.title,
				detail: x.description,
				description: x.source,
			}));
	}

	async run(accessor: ServicesAccessor) {
		const commandService = accessor.get(ICommandService);
		const contextService = accessor.get(IContextKeyService);
		const quickInputService = accessor.get(IQuickInputService);
		const gettingStartedService = accessor.get(IWalkthroughsService);
		const extensionService = accessor.get(IExtensionService);

		const disposables = new DisposableStore();
		const quickPick = disposables.add(quickInputService.createQuickPick());
		quickPick.canSelectMany = false;
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;
		quickPick.placeholder = localize('pickWalkthroughs', 'Select a walkthrough to open');
		quickPick.items = await this.getQuickPickItems(contextService, gettingStartedService);
		quickPick.busy = true;
		disposables.add(quickPick.onDidAccept(() => {
			const selection = quickPick.selectedItems[0];
			if (selection) {
				commandService.executeCommand('workbench.action.openWalkthrough', selection.id);
			}
			quickPick.hide();
		}));
		disposables.add(quickPick.onDidHide(() => disposables.dispose()));
		await extensionService.whenInstalledExtensionsRegistered();
		disposables.add(gettingStartedService.onDidAddWalkthrough(async () => {
			quickPick.items = await this.getQuickPickItems(contextService, gettingStartedService);
		}));
		quickPick.show();
		quickPick.busy = false;
	}
});

CommandsRegistry.registerCommand({
	id: 'welcome.newWorkspaceChat',
	handler: (accessor, stepID: string) => {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand('workbench.action.chat.open', { mode: 'agent', query: '#new ', isPartialQuery: true });
	}
});

export const WorkspacePlatform = new RawContextKey<'mac' | 'linux' | 'windows' | 'webworker' | undefined>('workspacePlatform', undefined, localize('workspacePlatform', "The platform of the current workspace, which in remote or serverless contexts may be different from the platform of the UI"));
class WorkspacePlatformContribution {

	static readonly ID = 'workbench.contrib.workspacePlatform';

	constructor(
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IContextKeyService private readonly contextService: IContextKeyService,
	) {
		this.remoteAgentService.getEnvironment().then(env => {
			const remoteOS = env?.os;

			const remotePlatform = remoteOS === OS.Macintosh ? 'mac'
				: remoteOS === OS.Windows ? 'windows'
					: remoteOS === OS.Linux ? 'linux'
						: undefined;

			if (remotePlatform) {
				WorkspacePlatform.bindTo(this.contextService).set(remotePlatform);
			} else if (this.extensionManagementServerService.localExtensionManagementServer) {
				if (isMacintosh) {
					WorkspacePlatform.bindTo(this.contextService).set('mac');
				} else if (isLinux) {
					WorkspacePlatform.bindTo(this.contextService).set('linux');
				} else if (isWindows) {
					WorkspacePlatform.bindTo(this.contextService).set('windows');
				}
			} else if (this.extensionManagementServerService.webExtensionManagementServer) {
				WorkspacePlatform.bindTo(this.contextService).set('webworker');
			} else {
				console.error('Error: Unable to detect workspace platform');
			}
		});
	}
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		'workbench.welcomePage.walkthroughs.openOnInstall': {
			scope: ConfigurationScope.MACHINE,
			type: 'boolean',
			default: true,
			description: localize('workbench.welcomePage.walkthroughs.openOnInstall', "When enabled, an extension's walkthrough will open upon install of the extension.")
		},
		'workbench.welcomePage.extraAnnouncements': {
			scope: ConfigurationScope.MACHINE,
			type: 'boolean',
			default: true,
			description: localize('workbench.welcomePage.extraAnnouncements', "When enabled, the get started page loads additional announcements from OpenIDE's repository."),
			tags: ['usesOnlineServices']
		},
		'workbench.startupEditor': {
			'scope': ConfigurationScope.RESOURCE,
			'type': 'string',
			'enum': ['none', 'welcomePage', 'readme', 'newUntitledFile', 'welcomePageInEmptyWorkbench', 'terminal', 'agentSessionsWelcomePage'],
			'enumDescriptions': [
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.none' }, "Start without an editor."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePage' }, "Open the Welcome page, with content to aid in getting started with OpenIDE and extensions."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.readme' }, "Open the README when opening a folder that contains one, fallback to 'welcomePage' otherwise. Note: This is only observed as a global configuration, it will be ignored if set in a workspace or folder configuration."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.newUntitledFile' }, "Open a new untitled text file (only applies when opening an empty window)."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePageInEmptyWorkbench' }, "Open the Welcome page when opening an empty workbench."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.terminal' }, "Open a new terminal in the editor area."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.agentSessionsWelcomePage' }, "Open the Agent Sessions Welcome page. Will override the workbench secondary side bar visibility settings."),
			],
			// OpenIDE muestra su portada únicamente cuando no hay una carpeta/workspace. En
			// proyectos reales no roba foco ni reemplaza el estado vacío normal del editor.
			'default': 'none',
			'description': localize('workbench.startupEditor', "Controls which editor is shown at startup, if none are restored from the previous session."),
			'experiment': { mode: 'auto' },
			agentsWindow: { default: 'none', readOnly: true },
		},
		'workbench.welcomePage.preferReducedMotion': {
			scope: ConfigurationScope.APPLICATION,
			type: 'boolean',
			default: false,
			deprecationMessage: localize('deprecationMessage', "Deprecated, use the global `workbench.reduceMotion`."),
			description: localize('workbench.welcomePage.preferReducedMotion', "When enabled, reduce motion in welcome page.")
		},
		'workbench.welcomePage.experimentalOnboarding': {
			scope: ConfigurationScope.APPLICATION,
			type: 'boolean',
			default: true,
			tags: ['experimental'],
			description: localize('workbench.welcomePage.experimentalOnboarding', "When enabled, show the new onboarding experience instead of the classic walkthrough on first launch."),
			experiment: {
				mode: 'auto'
			}
		}
	}
});

registerWorkbenchContribution2(WorkspacePlatformContribution.ID, WorkspacePlatformContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(StartupPageEditorResolverContribution.ID, StartupPageEditorResolverContribution, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(StartupPageRunnerContribution.ID, StartupPageRunnerContribution, WorkbenchPhase.AfterRestored);

AccessibleViewRegistry.register(new GettingStartedAccessibleView());

// OpenIDE: inyecta un SVG (data URI base64) como nodo inline, de forma segura
// (sin innerHTML/Trusted Types). Asi los iconos monocromos heredan el color del tema.
// OpenIDE: pinta el logo de un editor. El de VS Code es a color (<img>); los
// monocromos usan mask-image para tomar el color del texto/tema actual.
function openideAppendLogo(parent: HTMLElement, editor: OpenIDEEditor, size: number): void {
	if (editor.id === 'vscode') {
		const img = append(parent, $('img')) as HTMLImageElement;
		img.src = editor.logo;
		img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;`;
	} else {
		const el = append(parent, $('div'));
		el.style.cssText = `width:${size}px;height:${size}px;background-color:currentColor;-webkit-mask:url("${editor.logo}") center/contain no-repeat;mask:url("${editor.logo}") center/contain no-repeat;`;
	}
}

// OpenIDE: overlay de bienvenida a pantalla completa, como WIZARD de 3 pasos
// (un paso visible a la vez), con puntos al centro y Anterior/Siguiente a los lados.
function showOpenIDEWelcomeOverlay(commandService: ICommandService, configurationService: IConfigurationService, authenticationService: IAuthenticationService): void {
	// Evitar duplicados si ya hay un overlay abierto.
	if (mainWindow.document.querySelector('.openide-welcome-overlay')) {
		return;
	}

	const store = new DisposableStore();
	let current = 0;
	// Montar dentro de .monaco-workbench para que las variables --vscode-* (colores del
	// tema) cascadeen al overlay y se actualicen en vivo al cambiar de tema.
	const overlayHost = (mainWindow.document.querySelector('.monaco-workbench') as HTMLElement) ?? mainWindow.document.body;
	const overlay = append(overlayHost, $('.openide-welcome-overlay'));
	const dismiss = () => { store.dispose(); overlay.remove(); };

	overlay.style.cssText = [
		'position:fixed', 'inset:0', 'z-index:2147483646',
		'display:flex', 'flex-direction:column',
		'background:var(--vscode-editor-background, #1e1e1e)',
		'color:var(--vscode-foreground, #cccccc)',
		'font-family:var(--vscode-font-family, sans-serif)'
	].join(';');

	// "Saltar" en la esquina superior derecha
	const skip = append(overlay, $('a'));
	skip.style.cssText = 'position:absolute;top:18px;right:26px;cursor:pointer;color:var(--vscode-textLink-foreground, #3794ff);font-size:13px;';
	skip.textContent = localize('openide.overlay.skip', "Saltar");
	store.add(addDisposableListener(skip, 'click', () => dismiss()));

	// Zona central: header + paso activo
	const body = append(overlay, $('div'));
	body.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:auto;padding:48px 32px;';
	const inner = append(body, $('div'));
	inner.style.cssText = 'width:100%;max-width:700px;display:flex;flex-direction:column;align-items:center;';

	const logo = append(inner, $('div'));
	logo.style.cssText = 'font-size:50px;line-height:1;';
	logo.textContent = '🚀';
	const title = append(inner, $('h1'));
	title.style.cssText = 'margin:10px 0 0;font-size:27px;font-weight:600;text-align:center;';
	title.textContent = localize('openide.overlay.title', "Bienvenido a OpenIDE");

	// Area donde se dibuja el paso activo
	const stepArea = append(inner, $('div'));
	stepArea.style.cssText = 'width:100%;margin-top:30px;min-height:300px;display:flex;flex-direction:column;align-items:center;';

	const stepHeader = (host: HTMLElement, t: string, d: string) => {
		const h = append(host, $('h2'));
		h.style.cssText = 'font-size:19px;font-weight:600;margin:0;text-align:center;';
		h.textContent = t;
		const p = append(host, $('p'));
		p.style.cssText = 'opacity:0.8;margin:6px 0 24px;text-align:center;font-size:13px;max-width:520px;';
		p.textContent = d;
	};

	// ---- Paso 1: tema (previews nativos estilo VS Code) ----
	const renderThemeStep = (host: HTMLElement) => {
		stepHeader(host, localize('openide.overlay.step1.title', "Elegí tu tema"), localize('openide.overlay.step1.desc', "Tu editor, sin telemetría y a tu manera. Empezá eligiendo cómo se ve."));
		const row = append(host, $('div'));
		row.style.cssText = 'display:flex;gap:24px;flex-wrap:wrap;justify-content:center;';
		const tiles: HTMLElement[] = [];
		const currentTheme = configurationService.getValue<string>('workbench.colorTheme');
		for (const theme of OPENIDE_THEMES) {
			const tile = append(row, $('div'));
			tile.style.cssText = 'cursor:pointer;border-radius:8px;padding:6px;border:2px solid transparent;';
			const prev = append(tile, $('div'));
			prev.style.cssText = `width:210px;height:132px;border-radius:5px;overflow:hidden;border:1px solid var(--vscode-widget-border, #303031);background:${theme.bg};display:flex;flex-direction:column;`;
			const top = append(prev, $('div'));
			top.style.cssText = `height:16px;background:${theme.topbar};`;
			const bodyRow = append(prev, $('div'));
			bodyRow.style.cssText = 'flex:1;display:flex;';
			const side = append(bodyRow, $('div'));
			side.style.cssText = `width:42px;background:${theme.sidebar};`;
			const code = append(bodyRow, $('div'));
			code.style.cssText = 'flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:7px;';
			const lineWidths = ['70%', '45%', '85%', '55%', '38%'];
			for (let li = 0; li < theme.lines.length; li++) {
				const ln = append(code, $('div'));
				ln.style.cssText = `height:6px;border-radius:3px;width:${lineWidths[li % lineWidths.length]};background:${theme.lines[li]};`;
			}
			const lbl = append(tile, $('div'));
			lbl.style.cssText = 'text-align:center;font-size:13px;margin-top:8px;';
			lbl.textContent = theme.label;
			tiles.push(tile);
			if (currentTheme === theme.id) {
				tile.style.borderColor = 'var(--vscode-focusBorder, #0e639c)';
			}
			store.add(addDisposableListener(tile, 'click', () => {
				configurationService.updateValue('workbench.colorTheme', theme.id);
				for (const t of tiles) { t.style.borderColor = 'transparent'; }
				tile.style.borderColor = 'var(--vscode-focusBorder, #0e639c)';
			}));
		}
	};

	// ---- Paso 2: GitHub (con estado conectado) ----
	const renderGitHubStep = (host: HTMLElement) => {
		stepHeader(host, localize('openide.overlay.step2.title', "Conectá con GitHub"), localize('openide.overlay.step2.desc', "Iniciá sesión para clonar, sincronizar y publicar tus repositorios sin salir del editor."));
		const status = append(host, $('div'));
		status.style.cssText = 'display:flex;align-items:center;gap:10px;min-height:40px;';
		const render = async () => {
			status.textContent = '';
			let connected: string | undefined;
			try {
				const sessions = await authenticationService.getSessions('github');
				if (sessions.length) {
					connected = sessions[0].account.label;
				}
			} catch {
				// el proveedor puede no estar listo
			}
			if (connected) {
				const ok = append(status, $('span.codicon.codicon-check'));
				ok.style.cssText = 'color:var(--vscode-testing-iconPassed, #73c991);font-size:20px;';
				const lbl = append(status, $('span'));
				lbl.style.cssText = 'font-size:14px;';
				lbl.textContent = localize('openide.overlay.gh.connected', "Conectado como {0}", connected);
			} else {
				const btn = append(status, $('button'));
				btn.style.cssText = 'cursor:pointer;border:none;border-radius:5px;padding:9px 18px;display:flex;align-items:center;gap:8px;font-size:14px;background:var(--vscode-button-background, #0e639c);color:var(--vscode-button-foreground, #fff);';
				const ic = append(btn, $('span.codicon.codicon-github'));
				ic.style.cssText = 'font-size:17px;';
				const lbl = append(btn, $('span'));
				lbl.textContent = localize('openide.overlay.gh.connect', "Conectar con GitHub");
				store.add(addDisposableListener(btn, 'click', async () => {
					lbl.textContent = localize('openide.overlay.gh.connecting', "Conectando… seguí los pasos de GitHub");
					(btn as HTMLButtonElement).disabled = true;
					try {
						await authenticationService.createSession('github', ['read:user', 'user:email', 'repo']);
					} catch {
						// cancelado o fallo
					}
					render();
				}));
			}
		};
		render();
	};

	// ---- Paso 3: importar desde otro editor (grid de logos) ----
	const renderImportStep = (host: HTMLElement) => {
		stepHeader(host, localize('openide.overlay.step3.title', "Importá desde otro editor"), localize('openide.overlay.step3.desc', "Traé tus configuraciones, atajos y extensiones. Elegí desde qué editor."));
		const grid = append(host, $('div'));
		grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:16px;justify-content:center;';

		// Boton "Importar" (debajo del grid), deshabilitado hasta elegir un editor.
		const actions = append(host, $('div'));
		actions.style.cssText = 'margin-top:24px;display:flex;justify-content:center;';
		const importBtn = append(actions, $('button')) as HTMLButtonElement;
		importBtn.style.cssText = 'border:none;border-radius:5px;padding:9px 26px;font-size:14px;background:var(--vscode-button-background, #0e639c);color:var(--vscode-button-foreground, #fff);opacity:0.45;cursor:default;transition:opacity .15s ease;';
		importBtn.textContent = localize('openide.overlay.import.btn', "Importar");
		importBtn.disabled = true;

		const tiles = new Map<string, HTMLElement>();
		let selected: OpenIDEEditor | undefined;
		const select = (editor: OpenIDEEditor) => {
			selected = editor;
			for (const [id, t] of tiles) {
				const on = id === editor.id;
				t.style.borderColor = on ? 'var(--vscode-focusBorder, #0e639c)' : 'var(--vscode-widget-border, #303031)';
				t.style.transform = on ? 'scale(1.06)' : 'scale(1)';
				t.style.backgroundColor = on ? 'var(--vscode-list-activeSelectionBackground, #094771)' : 'var(--vscode-button-secondaryBackground, #2a2d2e)';
			}
			importBtn.disabled = false;
			importBtn.style.opacity = '1';
			importBtn.style.cursor = 'pointer';
		};

		for (const editor of OPENIDE_EDITORS) {
			const tile = append(grid, $('div'));
			tile.style.cssText = 'cursor:pointer;width:108px;display:flex;flex-direction:column;align-items:center;gap:12px;padding:18px 8px;border:1px solid var(--vscode-widget-border, #303031);border-radius:10px;background-color:var(--vscode-button-secondaryBackground, #2a2d2e);transition:transform .15s ease, border-color .15s ease, background-color .15s ease;';
			const iconWrap = append(tile, $('div'));
			iconWrap.style.cssText = 'width:40px;height:40px;display:flex;align-items:center;justify-content:center;';
			openideAppendLogo(iconWrap, editor, 40);
			const name = append(tile, $('div'));
			name.style.cssText = 'font-size:12px;';
			name.textContent = editor.name;
			tiles.set(editor.id, tile);
			store.add(addDisposableListener(tile, 'click', () => select(editor)));
			// hover minimalista (solo si no esta seleccionado)
			store.add(addDisposableListener(tile, 'mouseenter', () => { if (selected?.id !== editor.id) { tile.style.borderColor = 'var(--vscode-focusBorder, #0e639c)'; } }));
			store.add(addDisposableListener(tile, 'mouseleave', () => { if (selected?.id !== editor.id) { tile.style.borderColor = 'var(--vscode-widget-border, #303031)'; } }));
		}

		store.add(addDisposableListener(importBtn, 'click', () => {
			if (selected) {
				commandService.executeCommand('openide.importFromVSCode', selected.id);
			}
		}));
	};

	const steps = [renderThemeStep, renderGitHubStep, renderImportStep];

	// ---- Barra de navegacion (abajo) ----
	const nav = append(overlay, $('div'));
	nav.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:18px 36px;border-top:1px solid var(--vscode-widget-border, #303031);';

	const prevBtn = append(nav, $('button'));
	prevBtn.style.cssText = 'cursor:pointer;background:transparent;border:none;color:var(--vscode-foreground);font-size:14px;display:flex;align-items:center;gap:6px;';
	append(prevBtn, $('span.codicon.codicon-chevron-left'));
	const prevLbl = append(prevBtn, $('span'));
	prevLbl.textContent = localize('openide.overlay.prev', "Anterior");

	const dots = append(nav, $('div'));
	dots.style.cssText = 'display:flex;gap:11px;';
	const dotEls: HTMLElement[] = [];
	for (let i = 0; i < steps.length; i++) {
		const dot = append(dots, $('div'));
		dot.style.cssText = 'width:9px;height:9px;border-radius:50%;cursor:pointer;background:var(--vscode-descriptionForeground, #888);';
		const idx = i;
		dotEls.push(dot);
		store.add(addDisposableListener(dot, 'click', () => { current = idx; renderCurrent(); }));
	}

	const nextBtn = append(nav, $('button'));
	nextBtn.style.cssText = 'cursor:pointer;border:none;border-radius:5px;padding:8px 20px;font-size:14px;background:var(--vscode-button-background, #0e639c);color:var(--vscode-button-foreground, #fff);display:flex;align-items:center;gap:6px;';
	const nextLbl = append(nextBtn, $('span'));
	const nextIc = append(nextBtn, $('span.codicon.codicon-chevron-right'));

	function renderCurrent() {
		stepArea.textContent = '';
		steps[current](stepArea);
		for (let i = 0; i < dotEls.length; i++) {
			const active = i === current;
			dotEls[i].style.opacity = active ? '1' : '0.4';
			dotEls[i].style.background = active ? 'var(--vscode-button-background, #0e639c)' : 'var(--vscode-descriptionForeground, #888)';
		}
		prevBtn.style.visibility = current === 0 ? 'hidden' : 'visible';
		const last = current === steps.length - 1;
		nextLbl.textContent = last ? localize('openide.overlay.finish', "Empezar") : localize('openide.overlay.next', "Siguiente");
		nextIc.style.display = last ? 'none' : '';
	}

	store.add(addDisposableListener(prevBtn, 'click', () => { if (current > 0) { current--; renderCurrent(); } }));
	store.add(addDisposableListener(nextBtn, 'click', () => { if (current < steps.length - 1) { current++; renderCurrent(); } else { dismiss(); } }));
	store.add(addDisposableListener(overlay, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') { dismiss(); }
	}));

	renderCurrent();
	overlay.tabIndex = -1;
	overlay.focus();
}

// OpenIDE: muestra el overlay de bienvenida en el primer arranque (instalacion nueva).
class OpenIDEWelcomeOverlayContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openideWelcomeOverlay';

	private static readonly STORAGE_KEY = 'openide.welcomeShown';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
	) {
		super();
		this.maybeShow();
	}

	private async maybeShow(): Promise<void> {
		if (this.environmentService.skipWelcome) {
			return;
		}
		if (this.storageService.getBoolean(OpenIDEWelcomeOverlayContribution.STORAGE_KEY, StorageScope.APPLICATION, false)) {
			return;
		}
		// Solo en una instalacion nueva (primer arranque real).
		if (!this.storageService.isNew(StorageScope.APPLICATION)) {
			this.storageService.store(OpenIDEWelcomeOverlayContribution.STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
			return;
		}
		await this.lifecycleService.when(LifecyclePhase.Restored);
		this.storageService.store(OpenIDEWelcomeOverlayContribution.STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		showOpenIDEWelcomeOverlay(this.commandService, this.configurationService, this.authenticationService);
	}
}
registerWorkbenchContribution2(OpenIDEWelcomeOverlayContribution.ID, OpenIDEWelcomeOverlayContribution, WorkbenchPhase.AfterRestored);

// OpenIDE: comando para abrir la bienvenida a pantalla completa cuando quieras.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.showWelcome',
			title: localize2('openide.showWelcome.title', 'OpenIDE: Mostrar bienvenida'),
			category: Categories.Help,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor) {
		showOpenIDEWelcomeOverlay(accessor.get(ICommandService), accessor.get(IConfigurationService), accessor.get(IAuthenticationService));
	}
});


// OpenIDE: ajustes de layout estilo "islas flotantes".
// Las superficies salen de colores de producto registrados en el theme service. Así no
// heredamos tintes incompatibles de sideBar/panel ni mezclamos el theme con colores fijos.
const OPENIDE_LAYOUT_CSS = `
.monaco-workbench {
	--openide-island-gap: 5px;
	--openide-island-radius: 12px;
	--openide-island-outer-radius: 17px;
}
.monaco-workbench .part.activitybar,
.monaco-workbench .part.titlebar {
	background-color: transparent !important;
	border: none !important;
	box-shadow: none !important;
}
/* la status bar (footer) se funde con el fondo pero conserva su linea superior */
.monaco-workbench .part.statusbar {
	background-color: transparent !important;
}
/* matar la linea vertical del activity bar (borde ::before) */
.monaco-workbench .activitybar.bordered::before {
	border: none !important;
}
/* El fondo entre islas sigue el theme mediante un color semántico de OpenIDE. */
.monaco-workbench {
	background-color: var(--vscode-openide-workbenchBackground, var(--vscode-activityBar-background)) !important;
}
.monaco-workbench .part.sidebar,
.monaco-workbench .part.panel,
.monaco-workbench .part.auxiliarybar,
.monaco-workbench .part.editor {
	border: var(--openide-island-gap) solid transparent !important;
	border-radius: var(--openide-island-outer-radius) !important;
	background-clip: padding-box !important;
	overflow: hidden !important;
	box-shadow: none !important; /* SIN líneas (pedido explícito): las islas se leen solo por tonalidad contra el void */
}
/* Todas las islas comparten una superficie; el contenido conserva sus tokens de texto,
   selección, inputs y estados propios del theme. */
.monaco-workbench .part.editor,
.monaco-workbench .part.sidebar,
.monaco-workbench .part.auxiliarybar,
.monaco-workbench .part.panel,
.monaco-workbench .part.sidebar > .title,
.monaco-workbench .part.auxiliarybar > .title {
	background-color: var(--vscode-openide-islandBackground, var(--vscode-editor-background)) !important;
}
/* Los hijos del editor también se recortan. Esto cubre Monaco y evita que una capa de
   contenido rectangular vuelva a pintar las esquinas inferiores de la isla. */
.monaco-workbench .part.editor:not(.modal-editor-part) > .content {
	border-radius: var(--openide-island-radius) !important;
	overflow: hidden !important;
}
/* quitar lineas internas de headers/secciones de los docks */
.monaco-workbench .part.sidebar .composite.title,
.monaco-workbench .part.auxiliarybar .composite.title,
.monaco-workbench .part.panel .composite.title,
.monaco-workbench .pane-header,
.monaco-workbench .pane .pane-header,
.monaco-workbench .split-view-view > .pane > .pane-header {
	border: none !important;
	box-shadow: none !important;
}
/* tabs del editor sin borde inferior (header integrado) */
.monaco-workbench .part.editor > .content .editor-group-container > .title {
	border-bottom: none !important;
	box-shadow: none !important;
}
`;

class OpenIDELayoutContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openideLayout';

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
	) {
		super();
		const style = mainWindow.document.createElement('style');
		style.id = 'openide-layout';
		style.textContent = OPENIDE_LAYOUT_CSS;
		mainWindow.document.head.appendChild(style);
		this._register(toDisposable(() => style.remove()));
		// Forzar un relayout para que las action bars recalculen su overflow con el
		// ancho reducido por los gaps de las islas (si no, recortan iconos como "Collapse Folders").
		this.layoutService.layout();
	}
}
registerWorkbenchContribution2(OpenIDELayoutContribution.ID, OpenIDELayoutContribution, WorkbenchPhase.AfterRestored);
