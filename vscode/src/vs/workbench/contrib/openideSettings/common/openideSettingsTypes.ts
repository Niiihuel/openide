/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — presentation contracts for the product-owned Settings experience.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { ISetting, SettingValueType } from '../../../services/preferences/common/preferences.js';

export interface IOpenideSettingValueState {
	readonly effective: unknown;
	readonly defaultValue: unknown;
	readonly targetValue: unknown;
	readonly configured: boolean;
	readonly policyValue: unknown;
	readonly overrideIdentifiers: readonly string[];
}

export interface IOpenideSettingItem {
	readonly key: string;
	readonly label: string;
	readonly category: string;
	readonly groupId: string;
	readonly description: string;
	readonly type: SettingValueType;
	readonly schemaType?: string | string[];
	readonly setting: ISetting;
	readonly scope?: ConfigurationScope;
	readonly extensionId?: string;
	/** The extension's display name, for the navigation. */
	readonly extensionLabel?: string;
	readonly tags: readonly string[];
	readonly restricted: boolean;
	readonly deprecated: boolean;
	readonly value: IOpenideSettingValueState;
}

export interface IOpenideSettingsViewState {
	target: ConfigurationTarget;
	folderUri?: URI;
	query: string;
	category: string;
	language?: string;
}

/** Shared semantic shape for the Settings table of contents. The DOM implementation and the
 * advanced OpenIDE pages both consume the same hierarchy instead of inventing flat sidebars. */
export interface IOpenideSettingsNavigationEntry {
	readonly id: string;
	readonly label: string;
	readonly settings?: readonly string[];
	readonly command?: string;
	readonly children?: readonly IOpenideSettingsNavigationEntry[];
	/** Resolvable (breadcrumb, category validation) but never painted in the sidebar. A section
	 *  whose index page IS the directory of its sub-pages (Providers) sets this so fifteen
	 *  provider names do not flood the global navigation. */
	readonly hidden?: boolean;
}
