/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Private-use codepoints owned by OpenIDE.
 *
 * Keep this table synchronized with `resources/openide-icons/openide-icon-overrides.json`.
 * The icon validator enforces uniqueness, upstream isolation, and glyph coverage.
 */
export const openideProductIconCodepoints = {
	'openide-chat': 0xf200,
	'openide-agent-tree': 0xf201,
	'openide-mode-agent': 0xf202,
	'openide-mode-plan': 0xf203,
	'openide-mode-ask': 0xf204,
	'browser-css-layout-picker': 0xf205,
	'openide-plan-execution-model': 0xf206,
} as const;
