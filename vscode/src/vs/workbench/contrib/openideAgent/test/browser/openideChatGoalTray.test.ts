/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenideGoal } from '../../../../../platform/openideAgentHost/common/openideGoal.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { createChatTray } from '../../browser/chat/openideChatTray.js';
import { OpenideChatGoalTray } from '../../browser/chat/parts/openideChatGoalTray.js';
import { IOpenideGoalService } from '../../browser/openideGoalService.js';

suite('OpenIDE Goal Tray', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function goal(sessionId: string): IOpenideGoal {
		return { id: sessionId, sessionId, objective: `Objective ${sessionId}`, revision: 1, version: 1, status: 'paused', reason: '', createdAt: 1, updatedAt: 1, turns: 1, maxTurns: 10, criteria: [{ id: 'c1', text: 'Inspect result', verified: false, evidenceIds: [] }], reports: [], evidence: [], runIds: [] };
	}

	function create(service: Partial<IOpenideGoalService>, dialogs: Partial<IDialogService> = {}, continueGoal: (sessionId: string, objective: string) => Promise<boolean> = async () => true) {
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IOpenideGoalService, service);
		instantiation.stub(IHoverService, NullHoverService);
		instantiation.stub(IDialogService, dialogs);
		instantiation.stub(IQuickInputService, {});
		instantiation.stub(INotificationService, {});
		const host = mainWindow.document.createElement('div');
		const tray = store.add(instantiation.createInstance(OpenideChatGoalTray, host, continueGoal));
		return { host, tray };
	}

	test('late restoration and events from another conversation never replace the visible goal', async () => {
		const events = store.add(new Emitter<{ sessionId: string; goal: IOpenideGoal | undefined }>());
		const old = new DeferredPromise<IOpenideGoal>();
		const { host, tray } = create({
			onDidChange: events.event,
			get: async (sessionId: string) => sessionId === 'old' ? old.p : goal(sessionId),
		});
		const first = tray.setSession('old', false);
		await tray.setSession('current', false);
		events.fire({ sessionId: 'old', goal: goal('old') });
		await old.complete(goal('old'));
		await first;
		assert.strictEqual(host.querySelector('.openide-chat-goal-objective')?.textContent, 'Objective current');
	});

	test('manual review requires confirmation and remains bound to the original conversation', async () => {
		const events = store.add(new Emitter<{ sessionId: string; goal: IOpenideGoal | undefined }>());
		const confirmation = new DeferredPromise<{ confirmed: boolean }>();
		const recorded: string[] = [];
		const { host, tray } = create({
			onDidChange: events.event, get: async (id: string) => goal(id),
			confirmCriterion: async (sessionId: string, id: string) => { recorded.push(`${sessionId}:${id}`); },
		}, { confirm: () => confirmation.p });
		await tray.setSession('old', false);
		host.querySelector<HTMLButtonElement>('[data-goal-action="toggle"]')!.click();
		host.querySelector<HTMLButtonElement>('[data-goal-action="criterion-c1"]')!.click();
		assert.deepStrictEqual(recorded, []);
		await tray.setSession('current', false);
		await confirmation.complete({ confirmed: true });
		await Promise.resolve();
		assert.deepStrictEqual(recorded, ['old:c1']);
	});

	test('CLI restoration does not advertise an OpenIDE goal footer or send a turn', async () => {
		const events = store.add(new Emitter<{ sessionId: string; goal: IOpenideGoal | undefined }>());
		let sends = 0;
		const { host, tray } = create({
			onDidChange: events.event, get: async () => undefined,
		}, {}, async () => { sends++; return true; });
		await tray.setSession('cli', true);
		assert.deepStrictEqual({ sends, hidden: tray.domNode.classList.contains('hidden'), create: !!host.querySelector('[data-goal-action="create"]') }, { sends: 0, hidden: true, create: false });
	});

	test('resume requires an active goal and uses the revised objective', async () => {
		for (const status of ['paused', 'active'] as const) {
			const events = store.add(new Emitter<{ sessionId: string; goal: IOpenideGoal | undefined }>());
			let resumed = false;
			const requests: string[] = [];
			const { host, tray } = create({
				onDidChange: events.event,
				get: async () => resumed ? { ...goal('session'), objective: 'Revised objective', status } : goal('session'),
				resume: async () => { resumed = true; },
			}, {}, async (_sessionId, objective) => { requests.push(objective); return true; });
			await tray.setSession('session', false);
			host.querySelector<HTMLButtonElement>('[data-goal-action="toggle"]')!.click();
			host.querySelector<HTMLButtonElement>('[data-goal-action="resume"]')!.click();
			await timeout(0);
			assert.deepStrictEqual(requests, status === 'active' ? ['Revised objective'] : []);
		}
	});

	test('screen reader announcement does not occupy visible layout', async () => {
		const events = store.add(new Emitter<{ sessionId: string; goal: IOpenideGoal | undefined }>());
		const { host, tray } = create({ onDidChange: events.event, get: async () => goal('session') });
		mainWindow.document.body.append(host);
		try {
			await tray.setSession('session', false);
			const announcement = host.querySelector<HTMLElement>('[aria-live="polite"]')!;
			const rect = announcement.getBoundingClientRect();
			assert.ok(announcement.textContent && rect.width <= 1 && rect.height <= 1);
		} finally { host.remove(); }
	});


	test('CLI resume is gated by the current adapter capability and does not follow another session', async () => {
		const events = store.add(new Emitter<{ sessionId: string; goal: IOpenideGoal | undefined }>());
		const { host, tray } = create({ onDidChange: events.event, get: async () => goal('cli') });
		await tray.setSession('cli', true);
		host.querySelector<HTMLButtonElement>('[data-goal-action="toggle"]')!.click();
		const disabled = () => host.querySelector<HTMLButtonElement>('[data-goal-action="resume"]')!.disabled;
		assert.strictEqual(disabled(), true);
		tray.setCliSupport('other', true);
		assert.strictEqual(disabled(), true);
		tray.setCliSupport('cli', true);
		assert.strictEqual(disabled(), false);
		tray.setCliSupport('cli', false, 'Disconnected');
		assert.strictEqual(disabled(), true);
	});

	test('goal shares composer expansion and remains collapsed through report refreshes', async () => {
		const events = store.add(new Emitter<{ sessionId: string; goal: IOpenideGoal | undefined }>());
		const { host, tray } = create({ onDidChange: events.event, get: async () => goal('session') });
		await tray.setSession('session', false);
		const files = store.add(createChatTray(host, 'files', 'files'));
		let heights = 0;
		store.add(tray.onDidChangeHeight(() => heights++));
		const toggle = () => host.querySelector<HTMLButtonElement>('[data-goal-action="toggle"]')!;
		toggle().click();
		assert.strictEqual(toggle().getAttribute('aria-expanded'), 'true');
		const before = heights;
		files.setExpanded(true);
		assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false');
		assert.ok(heights > before);
		assert.strictEqual(host.querySelector('.openide-chat-goal-body'), null);
		events.fire({ sessionId: 'session', goal: { ...goal('session'), reason: 'New report' } });
		assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false');
		assert.strictEqual(files.toggle.getAttribute('aria-expanded'), 'true');
		toggle().click();
		assert.strictEqual(toggle().getAttribute('aria-expanded'), 'true');
		assert.strictEqual(files.toggle.getAttribute('aria-expanded'), 'false');
		assert.ok(host.querySelector('.openide-chat-goal-body')!.textContent!.includes('New report'));
	});

});
