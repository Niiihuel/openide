/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niihuel and OpenIDE contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProductService } from './productService.js';

/**
 * OpenIDE carries two version numbers, and they answer different questions.
 *
 * `productService.version` is the Code OSS API level. It is written into `vscode/package.json` at
 * build time and it is what `extensionValidator.isEngineValid` checks every extension's
 * `engines.vscode` range against. It must keep tracking upstream or the extension gallery stops
 * serving us anything.
 *
 * `productService.openideVersion` is what the product calls itself. It moves when OpenIDE ships,
 * not when Microsoft does.
 *
 * Every surface a user reads should show the second, and mention the first only as context. These
 * helpers exist so that rule lives in one place instead of being re-decided at each call site.
 */

/** The version OpenIDE calls itself. Falls back to the API version in a build that predates the split. */
export function getOpenideVersion(productService: IProductService): string {
	return productService.openideVersion || productService.version;
}

/**
 * The version for About-style surfaces, e.g. `1.0.0 (VS Code 1.121.0)`. The base is worth showing:
 * it is the number a user needs when checking whether an extension will run.
 */
export function getOpenideDisplayVersion(productService: IProductService): string {
	const version = getOpenideVersion(productService);
	if (!productService.openideVersion || productService.openideVersion === productService.version) {
		return version;
	}
	return `${version} (VS Code ${productService.version})`;
}
