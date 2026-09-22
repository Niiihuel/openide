/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillPath = path.join(root, '.openide/skills/openide-canvas/SKILL.md');
const sourcePath = path.join(root, 'vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentSkills.ts');
const markdown = fs.readFileSync(skillPath, 'utf8');
const source = fs.readFileSync(sourcePath, 'utf8');
const escaped = markdown.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
const declaration = `export const BUILTIN_CANVAS_SKILL = \`${escaped}\`;`;
const pattern = /export const BUILTIN_CANVAS_SKILL = `[\s\S]*?`;(?=\n\nexport class OpenideAgentSkills)/;
if (!pattern.test(source)) {
	throw new Error('Could not find the built-in Canvas skill declaration.');
}
const updated = source.replace(pattern, () => declaration);
if (process.argv.includes('--check')) {
	if (updated !== source) {
		throw new Error('Built-in Canvas skill is out of sync. Run: node dev/sync-canvas-skill.mjs');
	}
} else if (updated !== source) {
	fs.writeFileSync(sourcePath, updated);
}
