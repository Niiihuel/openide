/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IConfig {
	// The client ID of the GitHub OAuth app
	gitHubClientId: string;
	gitHubClientSecret?: string;
}

// For easy access to mixin client ID and secret
//
// NOTE: GitHub client secrets cannot be secured when running in a native client so in other words, the client secret is
// not really a secret... so we allow the client secret in code. It is brought in before we publish VS Code. Reference:
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app#client-secrets
export const Config: IConfig = {
	// OpenIDE's own OAuth app (https://github.com/settings/developers), so the GitHub
	// consent screen shows OpenIDE instead of Visual Studio Code. Requires "Enable Device
	// Flow" on the app: without a client secret the device code flow is the only one left
	// for an unsupported client. See `getFlows` in ./flows.ts.
	gitHubClientId: 'Ov23li4DUJIoCYvb0UdZ'
};
