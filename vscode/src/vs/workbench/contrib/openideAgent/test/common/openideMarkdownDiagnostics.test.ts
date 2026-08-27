/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { validateOpenideMarkdown } from '../../common/openideMarkdownDiagnostics.js';

suite('OpenIDE Markdown diagnostics', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts the structures used by the Markdown smoke test', () => {
		const report = validateOpenideMarkdown([
			'# Título',
			'',
			'## Comprobaciones',
			'- [x] Editar',
			'- [ ] Previsualizar',
			'',
			'[documentación](docs/usage.md)',
			'![logo](icons/openide.png)',
			'',
			'```ts',
			'const answer = 42;',
			'```',
		].join('\n'));

		assert.deepStrictEqual(report.diagnostics, []);
		assert.deepStrictEqual(report.stats, {
			headings: 2,
			links: 2,
			images: 1,
			tasks: 2,
			completedTasks: 1,
			codeBlocks: 1,
		});
	});

	test('reports structural problems with one-based locations', () => {
		const report = validateOpenideMarkdown([
			'# Inicio',
			'#### Salto',
			'[enlace](javascript:alert(1))',
			'```ts',
			'const unfinished = true;',
		].join('\n'));

		assert.deepStrictEqual(report.diagnostics.map(item => ({ severity: item.severity, line: item.line })), [
			{ severity: 'warning', line: 2 },
			{ severity: 'error', line: 3 },
			{ severity: 'error', line: 4 },
		]);
		assert.match(report.diagnostics[0].message, /H1 a H4/);
		assert.match(report.diagnostics[1].message, /esquema no seguro/);
		assert.match(report.diagnostics[2].message, /no está cerrado/);
	});

	test('ignores Markdown-looking text inside fenced code', () => {
		const report = validateOpenideMarkdown([
			'```md',
			'#### Esto no es un encabezado',
			'- [ ] Esto no es una tarea',
			'[javascript](javascript:alert(1))',
			'```',
		].join('\n'));

		assert.deepStrictEqual(report.diagnostics, []);
		assert.deepStrictEqual(report.stats, { headings: 0, links: 0, images: 0, tasks: 0, completedTasks: 0, codeBlocks: 1 });
	});
});
