/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ModernUIContribution } from '../../browser/modernUI.contribution.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';

suite('OpenIDE Modern UI', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	test('applies product styling to existing and newly opened containers', () => {
		const main = document.createElement('div');
		const auxiliary = document.createElement('div');
		const added = store.add(new Emitter<{ container: HTMLElement }>());
		store.add(new ModernUIContribution({ containers: [main], onDidAddContainer: added.event } as unknown as IWorkbenchLayoutService));
		added.fire({ container: auxiliary });
		for (const container of [main, auxiliary]) {
			assert.ok(container.classList.contains('modern-ui'));
			assert.ok(container.classList.contains('modern-ui-tabs'));
			assert.ok(container.classList.contains('modern-ui-notifications-dialogs'));
			assert.ok(!container.classList.contains('modern-ui-compact'));
		}
	});
	test('stops applying styling after disposal', () => {
		const added = store.add(new Emitter<{ container: HTMLElement }>());
		const contribution = new ModernUIContribution({ containers: [], onDidAddContainer: added.event } as unknown as IWorkbenchLayoutService);
		contribution.dispose();
		const container = document.createElement('div');
		added.fire({ container });
		assert.strictEqual(container.className, '');
	});
});
