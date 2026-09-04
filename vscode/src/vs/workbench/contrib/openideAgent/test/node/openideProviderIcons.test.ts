/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OPENIDE_PROVIDER_BRANDS } from '../../common/openideProviderBranding.js';
import { OPENIDE_REGISTRY_PROVIDER_BRANDS } from '../../common/openideProviderBrandsRegistry.js';

/**
 * The asset name stopped being a union when the registry's 193 marks arrived, so nothing in the
 * type system says a brand points at a file that exists any more. This says it, and says the
 * stronger thing the union never did: a typo, a deleted file or a logo that was never vendored
 * fails here instead of rendering as an empty square in the Providers page.
 */
suite('OpenIDE provider icons', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const iconRoot = join(fileURLToPath(import.meta.url), '../../../browser/media/providerIcons');
	const brands = { ...OPENIDE_PROVIDER_BRANDS, ...OPENIDE_REGISTRY_PROVIDER_BRANDS };

	test('every mark a brand names is on disk', () => {
		const missing: string[] = [];
		for (const [id, brand] of Object.entries(brands)) {
			if (brand.asset && !existsSync(join(iconRoot, brand.asset))) {
				missing.push(`${id} → ${brand.asset}`);
			}
		}
		assert.deepStrictEqual(missing, []);
	});

	test('no mark carries a script or reaches the network', () => {
		// These files are third-party SVGs pulled from a registry. They are inlined into masks and
		// background images, so anything executable or remote in them would be OpenIDE shipping it.
		const offenders: string[] = [];
		const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
			entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.svg') ? [join(dir, entry.name)] : []);
		for (const file of walk(iconRoot)) {
			const text = readFileSync(file, 'utf8').toLowerCase();
			if (text.includes('<script') || text.includes('javascript:') || text.includes('href="http') || text.includes('<foreignobject')) {
				offenders.push(file);
			}
		}
		assert.deepStrictEqual(offenders, []);
	});

	test('every brand has something to draw: a mark, or initials that fit', () => {
		for (const [id, brand] of Object.entries(brands)) {
			assert.ok(brand.name, `${id} has no name`);
			// The monogram is the fallback for a provider with no mark, and it is drawn in a 20px
			// circle: three characters do not fit, and an empty one draws a blank disc.
			assert.ok(brand.initials.length >= 1 && brand.initials.length <= 2, `${id} initials "${brand.initials}"`);
		}
	});

	test('the registry map never shadows a curated brand', () => {
		// The curated entries carry decisions the generator cannot make — Anthropic's terracotta,
		// the Claude spark instead of the wordmark, NVIDIA's green. `resolveProviderBrand` checks
		// the curated map first; this makes sure the two never even collide.
		const collisions = Object.keys(OPENIDE_REGISTRY_PROVIDER_BRANDS).filter(id => id in OPENIDE_PROVIDER_BRANDS);
		assert.deepStrictEqual(collisions, []);
	});
});
