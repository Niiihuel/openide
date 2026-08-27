/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The breadcrumb height lives in TWO places that have to agree:
 *   - `BreadcrumbsControl.HEIGHT` (TS): what the editor group RESERVES in the layout.
 *   - `editortitlecontrol.css`: what actually gets PAINTED.
 *
 * When they diverge, the difference is left as a dead band below the breadcrumb — the path
 * on top, a gap underneath, and any bottom border floating over nothing. It really happened:
 * raising the constant from 22 to 28 left 6 dead px because the CSS was still at 22, and no
 * test caught it because the test bench forced the height instead of reading it from the product.
 */
suite('OpenIDE breadcrumb height', () => {

	// Two things, and both broke module LOADING — which in mocha aborts the whole runner and
	// leaves the entire node suite unexecuted, not just this test:
	//
	// 1. `import.meta.dirname`, not `__dirname`: the build emits ESM and `package.json` declares
	//    `"type": "module"`, so `__dirname` does not exist.
	// 2. This is a static contract over the REPO, but it runs from `out/`, where no `.ts` files
	//    live. It has to map back to `src/`, like `openideSettingsContract.test.ts` does.
	//
	// The depth was wrong too: from `contrib/openideAgent/test/node` it is four hops up to
	// `workbench/`, not five. Five pointed at `vs/browser/parts/editor`, which does not exist.
	const compiledDir = import.meta.dirname;
	const sourceDir = compiledDir.replace(`${path.sep}out${path.sep}`, `${path.sep}src${path.sep}`);
	const editorRoot = path.join(sourceDir, '..', '..', '..', '..', 'browser', 'parts', 'editor');
	const control = fs.readFileSync(path.join(editorRoot, 'breadcrumbsControl.ts'), 'utf8');
	const css = fs.readFileSync(path.join(editorRoot, 'media', 'editortitlecontrol.css'), 'utf8');

	/** Default tab font size, the basis of the generated calc() rules. */
	const TABS_FONT_SIZE = 13;

	function declaredHeight(): number {
		const match = /static readonly HEIGHT = (\d+)/.exec(control);
		assert.notStrictEqual(match, null, 'no se encontró BreadcrumbsControl.HEIGHT');
		return Number(match![1]);
	}

	function paintedHeights(): number[] {
		const out: number[] = [];
		const blocks = css.split('}');
		for (const block of blocks) {
			// Only the breadcrumb box's rules, not its children's (icon-label, etc.).
			if (!/\.breadcrumbs-control\s*\{/.test(block + '}')) { continue; }
			if (/\.breadcrumbs-control\s+\./.test(block)) { continue; }
			const px = /height:\s*(\d+(?:\.\d+)?)px/.exec(block);
			if (px) { out.push(Number(px[1])); continue; }
			const calc = /height:\s*calc\(var\(--vscode-workbench-tabs-font-size\)\s*\*\s*([\d.]+)\)/.exec(block);
			if (calc) { out.push(Math.round(Number(calc[1]) * TABS_FONT_SIZE)); }
		}
		return out;
	}

	test('lo que se reserva y lo que se pinta miden lo mismo', () => {
		const reservado = declaredHeight();
		const pintados = paintedHeights();
		assert.strictEqual(pintados.length > 0, true, 'el CSS del title control debe fijar la altura del breadcrumb');
		for (const pintado of pintados) {
			assert.strictEqual(pintado, reservado, `el CSS pinta ${pintado}px y el layout reserva ${reservado}px: la diferencia es una banda muerta`);
		}
	});

	test('los controles del plan caben con aire dentro de la fila', () => {
		// They have to FLOAT: if they measure the same as the row, the breadcrumb reads as a button bar.
		//
		// The rule lives in OpenIDE's own stylesheet, not in upstream's `breadcrumbscontrol.css` —
		// which is where fork-owned styles belong — and the control is a chip now, not a bare
		// `button`. Matching the class instead of the element is also what keeps this from breaking
		// again the next time the markup changes.
		const openideCss = fs.readFileSync(path.join(sourceDir, '..', '..', 'browser', 'media', 'openideChat.css'), 'utf8');
		const chip = /\.openide-plan-breadcrumb-actions\s+\.openide-plan-model-chip\s*\{[\s\S]*?height:\s*(\d+)px/.exec(openideCss);
		assert.notStrictEqual(chip, null, 'no se encontró la altura del chip del plan');
		const aire = declaredHeight() - Number(chip![1]);
		assert.strictEqual(aire >= 6, true, `sólo ${aire}px de aire total: los controles llenan la fila`);
	});

	test('the breadcrumb does not draw a rule against the editor', () => {
		// The rule split the view in two. The reported "glued to the code" feeling was caused by a
		// background block, not by the missing border.
		const breadcrumbCss = fs.readFileSync(path.join(editorRoot, 'media', 'breadcrumbscontrol.css'), 'utf8');
		const reglas = breadcrumbCss.split('}').filter(block => /\.breadcrumbs-control\s*\{/.test(block + '}') && !/\.breadcrumbs-control\s+\./.test(block));
		for (const regla of reglas) {
			assert.strictEqual(/border-bottom:\s*[^;]*\d/.test(regla), false, 'volvió el borde inferior del breadcrumb');
		}
	});
});
