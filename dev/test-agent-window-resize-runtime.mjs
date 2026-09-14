// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-resize-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-resize-'));
const output = path.join(root, '.build/agent-window-resize-runtime');
const fileCount = 400;
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace/src'), { recursive: true });
fs.mkdirSync(output, { recursive: true });
for (let index = 0; index < fileCount; index++) {
	fs.writeFileSync(path.join(tmp, `workspace/src/change-${index}.ts`), `export const value${index} = ${index};\n`);
}
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom',
	'window.controlsStyle': 'custom',
	'openide.memory.captureMode': 'off',
	'openide.agent.notifications.enabled': false,
}));
let app;
const runtimeErrors = [];
const measurements = [];
const observeErrors = page => {
	page.on('pageerror', error => { runtimeErrors.push(error.message); console.error(error); });
	page.on('console', message => {
		if (message.type() === 'error' && !message.text().includes('No default agent registered')) {
			runtimeErrors.push(message.text()); console.error(message.text());
		}
	});
};
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'),
		cwd: path.join(root, 'vscode'),
		args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000,
	});
	const ide = await app.firstWindow();
	observeErrors(ide);
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async ({ base, fileCount, workspace }) => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		const { OpenideChangesInput } = await import(base + 'workbench/contrib/openideAgent/browser/openideChangesEditor.js');
		const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { URI } = await import(base + 'base/common/uri.js');
		const { IEditorWorkerService } = await import(base + 'editor/common/services/editorWorker.js');
		const { IModelService } = await import(base + 'editor/common/services/model.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.agentResize', title: 'Agent Resize Fixture', f1: true }); }
			async run(accessor) {
				try {
				const commands = accessor.get(ICommandService);
				const views = accessor.get(IViewsService);
				const instantiation = accessor.get(IInstantiationService);
				const editors = accessor.get(IEditorService);
				const models = accessor.get(IModelService);
				const worker = accessor.get(IEditorWorkerService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Resize fixture', send: false });
				const view = views.getViewWithId('workbench.view.openideChat.view');
				const widget = view._widget.value;
				const messages = [{ role: 'user', content: 'Keep this conversation while resizing', messageId: 'resize-request' }, { role: 'assistant', content: 'The existing conversation survives panel resizing.' }];
				const session = view._widget.value.sessionStore.createBackground('Resize fixture', messages);
				widget.refreshSessions();
				widget.openSession(session);
				let baselineReads = 0;
				let workerCalls = 0, releaseWorker;
				const compute = worker.computeDiff.bind(worker);
				worker.computeDiff = async (...args) => {
					if (args[0].path.startsWith('/openide-review-baseline/')) {
						workerCalls++;
						if (workerCalls === 1) { await new Promise(resolve => { releaseWorker = resolve; }); }
					}
					return compute(...args);
				};
				const files = Array.from({ length: fileCount }, (_, index) => ({
					resource: URI.file(workspace + `/src/change-${index}.ts`),
					path: `src/change-${index}.ts`, added: 1, removed: 0,
					baseline: async () => { baselineReads++; return 'export const previous = true;\n'; },
					open: () => {},
				}));
				const review = instantiation.createInstance(OpenideChangesInput, 'resize-scm-fixture', files);
				window.agentResizeFixture = {
					openReview: async () => { await editors.openEditor(review, { pinned: true }); },
					baselineReads: () => baselineReads,
					workerCalls: () => workerCalls,
					releaseWorker: () => releaseWorker?.(),
					burst: () => {
						for (let update = 0; update < 100; update++) { review.update(files.map(file => ({ ...file, added: update }))); }
						review.update([...review.files, { ...files[0], resource: URI.file(workspace + '/src/late.ts'), path: 'src/late.ts' }]);
					},
					content: () => view._widget.value.sessionStore.messagesOf(session),
					loadedReviewModels: () => models.getModels().filter(model => /\/src\/change-\d+\.ts$/.test(model.uri.path)).map(model => model.uri.toString()),
				};
				} catch (error) { console.error('Resize fixture failed', error.stack); throw error; }
			}
		});
	}, { base: `vscode-file://vscode-app${root}/vscode/out/vs/`, fileCount, workspace: path.join(tmp, 'workspace') });
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Agent Resize Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Agent Resize Fixture' }).first().waitFor();
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Agent Resize Fixture' }).first().click();
	await ide.waitForFunction(() => !!window.agentResizeFixture);
	const opened = app.waitForEvent('window', { timeout: 30000 });
	await ide.locator('.part.titlebar .openide-window-switcher').click();
	const agent = await opened;
	observeErrors(agent);
	await agent.locator('.openide-agent-window .openide-chat-input-card').waitFor();
	await agent.setViewportSize({ width: 1440, height: 900 });
	await agent.bringToFront();
	await agent.locator('.openide-agent-window-chat .openide-chat-input-card textarea').click();
	await ide.evaluate(() => window.agentResizeFixture.openReview());
	await agent.waitForFunction(count => document.querySelectorAll('.openide-changes-file.collapsed').length === count, fileCount);
	assert.equal(await agent.locator('.openide-changes-editor .monaco-editor').count(), 0, '400 collapsed files do not mount 400 editors');
	assert.deepEqual(await ide.evaluate(() => window.agentResizeFixture.loadedReviewModels()), [], 'collapsed review never loads file models');
	const input = agent.locator('.openide-agent-window-chat .openide-chat-input-card textarea');
	const draft = 'Preserve this draft through resize, hide and show';
	await input.fill(draft);
	const contentBefore = await ide.evaluate(() => window.agentResizeFixture.content());
	const settleFrames = () => agent.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const sash = index => agent.locator('.openide-agent-window > .monaco-sash.vertical').nth(index);
	const geometry = () => agent.evaluate(() => {
		const root = document.querySelector('.openide-agent-window');
		const panel = document.querySelector('.openide-agent-window-workspace');
		return { width: panel.getBoundingClientRect().width, x: panel.getBoundingClientRect().x, rootWidth: root.clientWidth, preferred: parseFloat(root.style.getPropertyValue('--agent-context-width')) };
	});
	const pointerDrag = async (index, delta, steps = 36) => {
		const box = await sash(index).boundingBox();
		assert.ok(box, `sash ${index} is visible`);
		const x = box.x + box.width / 2, y = box.y + box.height / 2;
		await agent.mouse.move(x, y);
		await agent.mouse.down();
		await agent.mouse.move(x + delta, y, { steps });
		await agent.mouse.up();
		await settleFrames();
	};
	// Make both grid variables differ from their registered initial values.
	await pointerDrag(0, 32);
	await agent.evaluate(() => {
		const list = document.querySelector('.openide-changes-files');
		const rows = [...list.querySelectorAll('.openide-changes-file')];
		const state = { list, rows, observer: undefined, childChanges: 0 };
		state.observer = new MutationObserver(records => { state.childChanges += records.length; });
		state.observer.observe(list, { childList: true });
		window.agentResizeDOM = state;
	});
	const assertStableDOM = async () => {
		const state = await agent.evaluate(() => {
			const { list, rows, observer } = window.agentResizeDOM;
			const current = [...document.querySelectorAll('.openide-changes-files .openide-changes-file')];
			const changes = observer.takeRecords();
			const rootStyle = getComputedStyle(document.querySelector('.openide-agent-window'));
			const rowStyle = getComputedStyle(current[0]);
			return {
				sameList: document.querySelector('.openide-changes-files') === list,
				sameRows: rows.length === current.length && rows.every((row, index) => row === current[index]),
				childChanges: window.agentResizeDOM.childChanges + changes.length,
				rootWidths: ['--agent-sidebar-width', '--agent-context-width'].map(name => rootStyle.getPropertyValue(name).trim()),
				rowWidths: ['--agent-sidebar-width', '--agent-context-width'].map(name => rowStyle.getPropertyValue(name).trim()),
			};
		});
		assert.ok(state.sameList && state.sameRows, 'drag preserves the Changes list and all 400 row nodes');
		assert.equal(state.childChanges, 0, 'drag does not repopulate the file list');
		assert.deepEqual(state.rowWidths, ['248px', '288px'], 'grid widths do not inherit into review rows');
		assert.ok(state.rootWidths.every((value, index) => value !== state.rowWidths[index]), 'changed grid widths stay scoped to the root');
		assert.equal(await input.inputValue(), draft);
		assert.equal(await agent.locator('.openide-changes-file.collapsed').count(), fileCount);
		assert.equal(await agent.locator('.openide-changes-editor .monaco-editor').count(), 0);
	};
	const cdp = await agent.context().newCDPSession(agent);
	await cdp.send('Performance.enable');
	const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
	const measuredDrag = async (name, delta) => {
		const before = await geometry();
		const startMetrics = await metrics();
		const start = performance.now();
		await pointerDrag(1, delta);
		const elapsedMs = performance.now() - start;
		const endMetrics = await metrics();
		const after = await geometry();
		const metricDelta = Object.fromEntries(['LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'TaskDuration'].map(key => [key, endMetrics[key] - startMetrics[key]]));
		assert.ok(Object.values(metricDelta).every(value => Number.isFinite(value) && value >= 0), 'CDP metrics report valid deltas');
		measurements.push({ name, pointerDelta: delta, pointerSteps: 36, elapsedMs, before, after, metricDelta });
		await assertStableDOM();
		return { before, after };
	};
	// Interior drags verify the final pointer position is applied, including pointer-up flush.
	for (const delta of [120, -80, 70, -110]) {
		const { before, after } = await measuredDrag('interior', delta);
		assert.ok(Math.abs(after.width - (before.width - delta)) <= 2, JSON.stringify({ delta, before, after }));
	}
	const minimum = await measuredDrag('minimum', 400);
	assert.ok(Math.abs(minimum.after.width - 360) <= 2, 'right panel reaches its minimum width');
	const maximum = await measuredDrag('maximum', -650);
	assert.ok(maximum.after.width > minimum.after.width + 300, 'right panel expands from minimum to its maximum');
	assert.ok(maximum.after.width <= 1001, 'right panel respects its maximum');
	await measuredDrag('return-to-interior', 210);
	fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify({ scenario: '400 collapsed Changes files; isolated dev Electron; real mouse input', viewport: { width: 1440, height: 900 }, fileCount, measurements }, null, 2));
	await agent.screenshot({ path: path.join(output, 'wide.png') });
	// At narrow widths the panel occupies available space; hide/show must retain its state.
	await agent.setViewportSize({ width: 640, height: 760 });
	await settleFrames();
	const panel = agent.locator('.openide-agent-window-workspace');
	const panelBox = await panel.boundingBox();
	assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 641, JSON.stringify(panelBox));
	const toggle = agent.getByRole('button', { name: 'Toggle workspace panel', exact: true });
	await toggle.click();
	await panel.waitFor({ state: 'hidden' });
	assert.equal(await input.inputValue(), draft);
	await toggle.click();
	await panel.waitFor({ state: 'visible' });
	assert.equal(await agent.locator('.openide-changes-file.collapsed').count(), fileCount);
	await agent.screenshot({ path: path.join(output, 'narrow.png') });
	await agent.setViewportSize({ width: 1440, height: 900 });
	await settleFrames();
	await assertStableDOM();
	assert.deepEqual(await ide.evaluate(() => window.agentResizeFixture.content()), contentBefore, 'conversation survives resize and hide/show');
	assert.deepEqual(await ide.evaluate(() => window.agentResizeFixture.loadedReviewModels()), [], 'resize and hide/show do not load collapsed models');
	assert.equal(await ide.evaluate(() => window.agentResizeFixture.baselineReads()), 0, 'collapsed review never reads baselines');
	// Assert intermediate editor sizes while the mouse remains down, including a live diff.
	await agent.locator('.openide-changes-file').first().locator('button').first().click();
	await agent.locator('.openide-changes-file .monaco-editor').first().waitFor();
	await ide.waitForFunction(() => window.agentResizeFixture.workerCalls() === 1);
	// Exercise input and frame delivery before releasing the worker; no monitor-dependent FPS floor.
	await input.fill(draft + ' while the diff is pending');
	assert.equal(await input.inputValue(), draft + ' while the diff is pending');
	await settleFrames();
	await input.fill(draft);
	await ide.evaluate(() => window.agentResizeFixture.releaseWorker());
	await agent.locator('.openide-review-added-line, .openide-review-modified-line').first().waitFor();
	const dragBox = await sash(1).boundingBox();
	const dragX = dragBox.x + dragBox.width / 2, dragY = dragBox.y + dragBox.height / 2;
	await agent.mouse.move(dragX, dragY); await agent.mouse.down();
	const liveSizes = [];
	for (const delta of [60, 120, 0, -60]) {
		await agent.mouse.move(dragX + delta, dragY, { steps: 4 });
		await settleFrames();
		const size = await agent.evaluate(() => {
			const width = selector => document.querySelector(selector).getBoundingClientRect().width;
			return { host: width('.openide-agent-window-editor-host'), review: width('.openide-changes-editor'), diff: width('.openide-changes-code .monaco-editor'), diffHost: width('.openide-changes-file:not(.collapsed) .openide-changes-code') };
		});
		liveSizes.push(size);
		assert.ok(Math.abs(size.host - size.review) <= 2, `Review follows host during drag: ${JSON.stringify(size)}`);
		assert.ok(Math.abs(size.diff - size.diffHost) <= 2, `Expanded diff follows host during drag: ${JSON.stringify(size)}`);
	}
	await agent.mouse.up();
	assert.ok(Math.abs(liveSizes[0].review - liveSizes[1].review) > 40, 'review resizes before pointer-up');
	assert.equal(await ide.evaluate(() => window.agentResizeFixture.baselineReads()), 1, 'only expanded file loads a baseline');
	await agent.evaluate(() => {
		window.agentResizeDOM.editor = document.querySelector('.openide-changes-code .monaco-editor');
	});
	await ide.evaluate(() => window.agentResizeFixture.burst());
	await agent.waitForFunction(() => document.querySelectorAll('.openide-changes-file').length === 401);
	const retained = await agent.evaluate(() => {
		const state = window.agentResizeDOM;
		return state.rows.every(row => row.isConnected) && state.editor === document.querySelector('.openide-changes-code .monaco-editor');
	});
	assert.equal(retained, true, '100 updates and a new file retain all 400 rows and the expanded editor');
	assert.equal(await ide.evaluate(() => window.agentResizeFixture.workerCalls()), 1, 'resize and metadata updates do not recompute the diff');
	await agent.evaluate(() => window.agentResizeDOM.observer.disconnect());
	await cdp.detach();
	assert.deepEqual(runtimeErrors, []);
	const result = { collapsedFiles: fileCount, lazyModels: true, finalPointerApplied: true, expandedDiffResizesDuringDrag: true, stableRows: true, nonInheritedWidths: true, narrowHideShow: true, draftAndConversationPreserved: true, measurements: 'metrics.json' };
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
