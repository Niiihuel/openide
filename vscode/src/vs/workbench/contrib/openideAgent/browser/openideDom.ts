/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';

/** Auxiliary windows forbid creating elements in their JavaScript context. Keep the main
 * window's element prototypes while assigning the requested document before callers use it. */
export function createOpenideElement<K extends keyof HTMLElementTagNameMap>(document: Document, tagName: K): HTMLElementTagNameMap[K] {
	const element = mainWindow.document.createElement(tagName);
	return document === mainWindow.document ? element : document.adoptNode(element);
}
