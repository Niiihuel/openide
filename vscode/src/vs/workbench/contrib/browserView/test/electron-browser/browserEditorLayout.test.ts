/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { clampBrowserContainerLayout } from '../../electron-browser/browserEditor.js';

suite('Browser editor layout', () => {
	test('keeps the native browser surface inside its dock', () => {
		assert.deepStrictEqual(
			clampBrowserContainerLayout({ left: -0.25, top: 4, width: 920, height: 700 }, { width: 800, height: 600 }),
			{ left: 0, top: 4, width: 800, height: 596 },
		);
		assert.deepStrictEqual(
			clampBrowserContainerLayout({ left: 760, top: 580, width: 200, height: 100, emulation: { scale: 0.5 } }, { width: 800, height: 600 }),
			{ left: 760, top: 580, width: 40, height: 20, emulation: { scale: 0.5 } },
		);
	});
});
