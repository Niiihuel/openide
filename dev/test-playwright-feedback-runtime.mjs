// Copyright (c) OpenIDE. Licensed under the MIT License.
// Real Playwright, native browser frames and Workbench DOM feedback on an isolated display.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const html = fs.readFileSync(path.join(root, 'dev/fixtures/browser-agent.html'));
const server = http.createServer((_request, response) => {
	response.setHeader('Content-Type', 'text/html');
	response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-playwright-feedback-'));
const output = path.join(root, '.build/playwright-feedback-runtime');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'));
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'openide.memory.captureMode': 'off',
	'openide.agent.notifications.enabled': false,
}));
let app;
const errors = [];
async function test() {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'),
		cwd: path.join(root, 'vscode'),
		args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000,
	});
	const ide = await app.firstWindow();
	ide.on('pageerror', error => errors.push(error.message));
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IConfigurationService } = await import(base + 'platform/configuration/common/configuration.js');
		const { IFileService } = await import(base + 'platform/files/common/files.js');
		const { IEnvironmentService } = await import(base + 'platform/environment/common/environment.js');
		const { IPlaywrightService } = await import(base + 'platform/browserView/common/playwrightService.js');
		const { IWorkbenchThemeService } = await import(base + 'workbench/services/themes/common/workbenchThemeService.js');
		const { IBrowserViewWorkbenchService } = await import(base + 'workbench/contrib/browserView/common/browserView.js');
		const { IBrowserAgentSessionService } = await import(base + 'workbench/contrib/browserView/common/browserAgentSessionService.js');
		const { IOpenideNativeServices } = await import(base + 'workbench/contrib/openideAgent/common/openideNativeServices.js');
		const { OpenideBrowserAutomation } = await import(base + 'workbench/contrib/openideAgent/browser/openideBrowserTools.js');
		const { getWindows } = await import(base + 'base/browser/dom.js');
		const { CancellationToken } = await import(base + 'base/common/cancellation.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.playwrightFeedback', title: 'Playwright Feedback Fixture', f1: true }); }
			async run(accessor) {
				const commands = accessor.get(ICommandService), browsers = accessor.get(IBrowserViewWorkbenchService), playwright = accessor.get(IPlaywrightService);
				const theme = accessor.get(IWorkbenchThemeService);
				const sessions = accessor.get(IBrowserAgentSessionService);
				const automation = new OpenideBrowserAutomation(accessor.get(IOpenideNativeServices), accessor.get(IConfigurationService), browsers, playwright, accessor.get(IFileService), accessor.get(IEnvironmentService));
				const tools = new Map(); automation.registerTools({ registerTool: tool => tools.set(tool.def.name, tool) });
				const events = [], activity = [];
				const activityListener = playwright.onDidChangeActivity(event => activity.push(event));
				const eventListener = playwright.onDidBrowserAgentEvent(event => events.push(event));
				window.feedback = {
						events, activity,
						calls: 0,
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					async navigate(targetURL) {
						const target = [...getWindows()].map(entry => entry.window).find(window => window.document.querySelector('.openide-agent-window'));
						await browsers.openPreview(targetURL, undefined, { targetWindowId: target.vscodeWindowId, reveal: true });
					},
						async run(args) { return tools.get('browser_playwright').invoke(args, CancellationToken.None, { toolCallId: `browser-fixture-${++this.calls}`, conversationId: 'browser-fixture' }); },
					start(args) { this.result = undefined; this.run(args).then(result => this.result = result, error => this.result = 'FAILED: ' + error.message); },
					name: () => browsers.getPreview()?.getName(),
						pageId: () => browsers.getPreview()?.id,
						state: () => sessions.sessionForPage(browsers.getPreview()?.id)?.state,
						linkedSession: id => sessions.sessionForToolCall(id)?.sessionId,
						async lightTheme() {
							const light = (await theme.getColorThemes()).find(candidate => candidate.type === 'light');
							if (!light) { throw new Error('Light theme is unavailable'); }
							await theme.setColorTheme(light, undefined);
						},
						async highContrast() {
							const highContrast = (await theme.getColorThemes()).find(candidate => candidate.type === 'hcDark');
							if (!highContrast) { throw new Error('High contrast theme is unavailable'); }
							await theme.setColorTheme(highContrast, undefined);
						},
						zoomIn: () => browsers.getPreview().model.zoomIn(),
					async dispose() { activityListener.dispose(); eventListener.dispose(); await playwright.disposeSession('openide-native-browser'); },
				};
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Playwright Feedback Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Playwright Feedback Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.feedback);
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.feedback.open());
	const agent = await opened;
	agent.on('pageerror', error => errors.push(error.message));
	await agent.locator('.openide-chat-input-card textarea').waitFor();
	const agentWindowId = await agent.evaluate(() => window.vscodeWindowId);
	const resizeAgent = (width, height) => app.evaluate(({ BrowserWindow }, { id, width, height }) => BrowserWindow.fromId(id).setContentSize(width, height), { id: agentWindowId, width, height });
	await resizeAgent(1440, 900);
	await ide.evaluate(url => window.feedback.navigate(url), url);
	await agent.locator('.browser-container').waitFor();
	const read = async expression => app.evaluate(async ({ webContents }, { url, expression }) => {
		const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url));
		return page?.executeJavaScript(expression);
	}, { url, expression });
	for (let attempt = 0; attempt < 80 && !(await read('!!document.querySelector("#search")')); attempt++) { await new Promise(resolve => setTimeout(resolve, 100)); }
	if (process.env.OPENIDE_TEST_COMPLETED_GEOMETRY_ONLY === '1') {
		assert.match(await ide.evaluate(() => window.feedback.run({ code: `await page.locator('#search').click(); return 'completed';`, timeoutMs: 15000 })), /completed/);
		await agent.waitForFunction(() => document.querySelector('.browser-agent-overlay[data-status="completed"]')?.classList.contains('settled'));
		const before = await ide.evaluate(() => window.feedback.state());
		const nativeBefore = await read('({ width: innerWidth, height: innerHeight })');
		await resizeAgent(1150, 760);
		await ide.evaluate(() => window.feedback.zoomIn());
		let nativeAfter;
		let stateAfter;
		for (let attempt = 0; attempt < 80; attempt++) {
			nativeAfter = await read('({ width: innerWidth, height: innerHeight })');
			stateAfter = await ide.evaluate(() => window.feedback.state());
			if ((nativeAfter.width !== nativeBefore.width || nativeAfter.height !== nativeBefore.height)
				&& stateAfter.viewport.width === nativeAfter.width && stateAfter.viewport.height === nativeAfter.height) { break; }
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		fs.writeFileSync(path.join(output, 'completed-geometry.json'), JSON.stringify({ before, nativeBefore, after: stateAfter, nativeAfter }, null, 2));
		assert.notDeepEqual(nativeAfter, nativeBefore, 'the completed browser really changed viewport');
		assert.deepEqual({ width: stateAfter.viewport.width, height: stateAfter.viewport.height, status: stateAfter.status }, { ...nativeAfter, status: 'completed' }, 'completed geometry tracks resize and zoom without restarting the agent');
		assert.equal(stateAfter.completedAt, before.completedAt, 'idle geometry does not change the recorded completion time');
		const target = await read('(()=>{const r=document.querySelector("#search").getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height };})()');
		const point = await agent.locator('.browser-agent-overlay').evaluate((overlay, { target, viewport }) => {
			const bounds = overlay.getBoundingClientRect();
			const scale = Math.min(bounds.width / viewport.width, bounds.height / viewport.height);
			return { x: bounds.x + (bounds.width - viewport.width * scale) / 2 + (target.x + target.width / 2) * scale,
				y: bounds.y + (bounds.height - viewport.height * scale) / 2 + (target.y + target.height / 2) * scale };
		}, { target, viewport: nativeAfter });
		await agent.mouse.click(point.x, point.y);
		await agent.keyboard.type('Completed resize input');
		for (let attempt = 0; attempt < 30 && !(await read('document.querySelector("#search").value === "Completed resize input"')); attempt++) { await new Promise(resolve => setTimeout(resolve, 50)); }
		assert.equal(await read('document.querySelector("#search").value'), 'Completed resize input', 'click and keyboard input stay aligned after an idle resize');
		assert.equal(await ide.evaluate(() => window.feedback.state().status), 'completed', 'user input does not restart the agent');
		await agent.screenshot({ path: path.join(output, 'browser-agent-completed-resize.png') });
		await ide.evaluate(() => window.feedback.dispose());
		await agent.locator('.browser-agent-overlay').waitFor({ state: 'detached' });
		assert.deepEqual(errors, []);
		console.log('PASS: completed geometry follows resize/zoom, preserves completed state and keeps user input aligned.');
		return;
	}
	await agent.evaluate(() => {
		window.overlaySamples = [];
		window.overlayClicks = [];
		window.sampleOverlay = true;
		let observedOverlay;
		const snapshot = (overlay, time = performance.now()) => {
			const cursor = overlay.querySelector('.browser-agent-cursor');
			const glyph = cursor?.querySelector('.browser-agent-cursor-glyph');
			const target = overlay.querySelector('.browser-agent-target');
			const rect = element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
			const cursorTransform = cursor && new DOMMatrixReadOnly(getComputedStyle(cursor).transform);
			const bounds = rect(overlay);
			return {
				time,
				action: overlay.dataset.action, status: overlay.dataset.status, sequence: Number(overlay.dataset.sequence),
				click: overlay.dataset.lastClick, hud: overlay.querySelector('.browser-agent-label')?.textContent,
				box: target && !target.hidden ? rect(target) : undefined,
				cursor: cursor && !cursor.hidden ? rect(cursor) : undefined,
				hotspot: cursorTransform && { x: bounds.x + cursorTransform.e, y: bounds.y + cursorTransform.f },
				glyph: glyph && { ...rect(glyph), image: getComputedStyle(glyph).backgroundImage },
				ripples: [...overlay.querySelectorAll('.browser-agent-ripple')].filter(ripple => Number(getComputedStyle(ripple).opacity) > .01).map(ripple => {
					const box = rect(ripple); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
				}),
				trails: [...overlay.querySelectorAll('.browser-agent-trail')].filter(trail => !trail.hidden && getComputedStyle(trail).display !== 'none').length,
				overlay: bounds, nodes: overlay.querySelectorAll('*').length,
			};
		};
		window.overlayClickObserver = new MutationObserver(() => {
			if (observedOverlay?.dataset.lastClick) { window.overlayClicks.push(snapshot(observedOverlay)); }
		});
		const sample = (time = performance.now()) => {
			const overlay = document.querySelector('.browser-agent-overlay');
			if (overlay && window.overlaySamples.length < 5000) {
				if (observedOverlay !== overlay) {
					window.overlayClickObserver.disconnect(); observedOverlay = overlay;
					window.overlayClickObserver.observe(overlay, { attributes: true, attributeFilter: ['data-last-click'] });
				}
				window.overlaySamples.push(snapshot(overlay, time));
			}
			if (window.sampleOverlay) { requestAnimationFrame(sample); }
		};
		sample();
	});
	const pause = 'await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));';
	const secret = 'fixture-password-never-in-hud';
	const code = `await page.goto(${JSON.stringify(url)}); ${pause}
		await page.evaluate(() => {
			const button = document.querySelector('#start');
			button.style.borderWidth = '5px 2px 3px 7px';
			button.addEventListener('click', event => { window.lastOffsetClick = { x: event.clientX, y: event.clientY }; });
		});
		await page.getByRole('button', {name:'Start', exact:true}).click({position:{x:8,y:6}}); ${pause}
		await page.getByRole('textbox', {name:'Search', exact:true}).fill('Kept value'); ${pause}
		await page.locator('#password').fill(${JSON.stringify(secret)}); ${pause}
		await page.getByRole('button', {name:'Continue', exact:true}).click(); ${pause}
		await page.mouse.wheel(0, 140); ${pause} return 'finished';`;
	await ide.evaluate(code => window.feedback.start({ code, timeoutMs: 100 }), code);
	await ide.waitForFunction(() => window.feedback.name()?.startsWith('Playwright ·') || window.feedback.result !== undefined);
	if (!(await ide.evaluate(() => window.feedback.name()?.startsWith('Playwright ·')))) {
		throw new Error(JSON.stringify(await ide.evaluate(() => ({ result: window.feedback.result, name: window.feedback.name(), events: window.feedback.events, activity: window.feedback.activity }))));
	}
	await agent.locator('.browser-agent-overlay').waitFor();
	await ide.waitForFunction(() => window.feedback.result !== undefined);
	const deferred = await ide.evaluate(() => window.feedback.result);
	assert.match(deferred, /Run still pending:/);
	assert.equal(await ide.evaluate(() => window.feedback.name().startsWith('Playwright ·')), true, 'deferral preserves active state');
	await agent.screenshot({ path: path.join(output, 'browser-agent-dark.png') });
	await ide.waitForFunction(() => !window.feedback.name()?.startsWith('Playwright ·'), {}, { timeout: 30000 });
	const id = deferred.match(/Run still pending: ([^.]+)\./)[1];
	assert.match(await ide.evaluate(id => window.feedback.run({ deferredResultId: id, timeoutMs: 2000 }), id), /finished/);
	const events = await ide.evaluate(() => window.feedback.events);
	assert.equal(await ide.evaluate(() => window.feedback.linkedSession('browser-fixture-1')), events[0].sessionId, 'tool call resolves to the browser session');
	const samples = await agent.evaluate(() => window.overlaySamples);
	for (const action of ['navigate', 'click', 'type', 'scroll']) {
		assert.ok(events.some(event => event.action === action), `${action} has a runtime-independent event`);
		assert.ok(samples.some(sample => sample.action === action), `${action} appears in the Workbench overlay`);
	}
	assert.ok(samples.some(sample => sample.click), 'click feedback reaches its final position');
	assert.ok(samples.some(sample => sample.box), 'target highlight is visible');
	assert.equal(JSON.stringify({ events, samples }).includes(secret), false, 'events and HUD never expose typed secrets');
	assert.ok(samples.some(sample => sample.action === 'type' && sample.hud === 'Typing…'), 'sensitive field uses generic typing copy');
	assert.deepEqual(await read('({started:fixture.started,submitted:fixture.submitted,value:document.querySelector("#search").value,scrolled:scrollY>0})'), { started: 1, submitted: 1, value: 'Kept value', scrolled: true });
	const offsetClick = events.find(event => event.action === 'click' && event.phase === 'completed' && event.target?.label === 'Start');
	const actualClick = await read('window.lastOffsetClick');
	assert.ok(offsetClick && Math.abs(offsetClick.point.x - actualClick.x) < 1 && Math.abs(offsetClick.point.y - actualClick.y) < 1, 'explicit locator position respects the real padding-box click hotspot');
	const nodeCounts = samples.filter(sample => sample.nodes).map(sample => sample.nodes);
	assert.equal(Math.max(...nodeCounts), Math.min(...nodeCounts), 'ripple/trail nodes are reused');
	const cursorSamples = samples.filter(sample => sample.cursor);
	assert.ok(cursorSamples.length > 0, 'a native cursor is visible during real actions');
	assert.ok(samples.some(sample => sample.action === 'navigate' && sample.cursor), 'the cursor is already visible during navigation before the first pointer action');
	assert.ok(cursorSamples.every(sample => Math.abs(sample.cursor.width - 20) < .01 && Math.abs(sample.cursor.height - 20) < .01), `cursor keeps the requested 20 CSS pixel size: ${JSON.stringify([...new Set(cursorSamples.map(sample => `${sample.cursor.width}x${sample.cursor.height}`))])}`);
	assert.ok(cursorSamples.every(sample => sample.glyph?.image.includes('.svg')), 'cursor uses its packaged Bibata vector glyph');
	const renderedPoint = (event, sample) => {
		const scale = Math.min(sample.overlay.width / event.viewport.width, sample.overlay.height / event.viewport.height);
		return {
			x: sample.overlay.x + (sample.overlay.width - event.viewport.width * scale) / 2 + event.point.x * scale,
			y: sample.overlay.y + (sample.overlay.height - event.viewport.height * scale) / 2 + event.point.y * scale,
		};
	};
	const clickSamples = await agent.evaluate(() => window.overlayClicks);
	assert.ok(clickSamples.length > 0, 'the click ripple is observed at its start');
	for (const sample of clickSamples) {
		const event = events.find(event => event.sequence === Number(sample.click));
		if (!event?.point || !event.viewport) { continue; }
		const expected = renderedPoint(event, sample);
		assert.ok(Math.hypot(sample.hotspot.x - expected.x, sample.hotspot.y - expected.y) < 2, 'click starts when the pointer hotspot reaches the real action point');
		assert.ok(sample.ripples.some(ripple => Math.hypot(ripple.x - expected.x, ripple.y - expected.y) < 2), 'click ripple is centered on the pointer hotspot');
	}
	// Short pauses deliberately retarget the pointer before its current motion ends.
	// The fixture uses the public Playwright mouse API, not synthetic overlay events.
	await agent.evaluate(() => { window.overlaySamples.length = 0; });
	const motionEventOffset = await ide.evaluate(() => window.feedback.events.length);
	const motionCode = `
		await page.mouse.move(40, 50);
		await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 650)));
		const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
		await page.mouse.move(viewport.width * .82, viewport.height * .42);
		await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 70)));
		await page.mouse.move(viewport.width * .28, viewport.height * .64);
		await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 70)));
		await page.mouse.move(viewport.width * .67, viewport.height * .27);
		await page.evaluate(() => new Promise(resolve => { window.releaseCursorMotion = resolve; }));
		return 'moved';`;
	await ide.evaluate(code => window.feedback.start({ code, timeoutMs: 100 }), motionCode);
	await agent.waitForFunction(() => [...document.querySelectorAll('.browser-agent-trail')].some(trail => !trail.hidden && getComputedStyle(trail).display !== 'none'));
	await agent.screenshot({ path: path.join(output, 'browser-agent-cursor-moving.png') });
	for (let attempt = 0; attempt < 100 && !(await read('typeof window.releaseCursorMotion === "function"')); attempt++) { await new Promise(resolve => setTimeout(resolve, 30)); }
	const motionEvents = (await ide.evaluate(offset => window.feedback.events.slice(offset), motionEventOffset)).filter(event => event.action === 'move' && event.phase === 'completed');
	assert.equal(motionEvents.length, 4, 'each public mouse move reaches the event contract');
	const lastMove = motionEvents.at(-1);
	await agent.waitForFunction(event => {
		const overlay = document.querySelector('.browser-agent-overlay');
		const cursor = overlay?.querySelector('.browser-agent-cursor');
		if (!cursor) { return false; }
		const bounds = overlay.getBoundingClientRect(), matrix = new DOMMatrixReadOnly(getComputedStyle(cursor).transform);
		const scale = Math.min(bounds.width / event.viewport.width, bounds.height / event.viewport.height);
		return Math.abs(matrix.e - ((bounds.width - event.viewport.width * scale) / 2 + event.point.x * scale)) < 1
			&& Math.abs(matrix.f - ((bounds.height - event.viewport.height * scale) / 2 + event.point.y * scale)) < 1;
	}, lastMove, { timeout: 3000 });
	const motionSamples = (await agent.evaluate(() => window.overlaySamples)).filter(sample => sample.action === 'move' && sample.hotspot);
	const intermediatePositions = new Set(motionSamples.map(sample => `${Math.round(sample.hotspot.x)},${Math.round(sample.hotspot.y)}`));
	assert.ok(intermediatePositions.size >= 10, 'consecutive moves render intermediate positions');
	const frameDeltas = motionSamples.slice(1).map((sample, index) => ({
		time: sample.time - motionSamples[index].time,
		distance: Math.hypot(sample.hotspot.x - motionSamples[index].hotspot.x, sample.hotspot.y - motionSamples[index].hotspot.y),
	}));
	assert.ok(frameDeltas.filter(delta => delta.time > 0 && delta.time <= 35).every(delta => delta.distance / delta.time < 8), 'retargeting remains continuous without frame-sized teleports');
	await agent.screenshot({ path: path.join(output, 'browser-agent-bibata-20.png') });
	fs.writeFileSync(path.join(output, 'cursor-motion.json'), JSON.stringify({ events: motionEvents, samples: motionSamples, clickSamples }, null, 2));
	await read('window.releaseCursorMotion()');
	await ide.waitForFunction(() => !window.feedback.name()?.startsWith('Playwright ·'));
	const rapidStartSequence = await ide.evaluate(() => window.feedback.events.at(-1).sequence);
	await agent.evaluate(() => { window.overlaySamples.length = 0; });
	const rapidCode = `
		await page.locator('#search').click();
		await page.locator('#search').fill('Rapid input');
		await page.keyboard.press('ArrowLeft');
		await page.locator('#start').hover();
		await page.locator('#search').focus();
		await page.mouse.wheel(0, 20);
		await page.screenshot();
		return 'rapid actions completed';`;
	assert.match(await ide.evaluate(code => window.feedback.run({ code, timeoutMs: 15000 }), rapidCode), /rapid actions completed/);
	const rapidActions = ['click', 'type', 'keypress', 'hover', 'focus', 'scroll', 'screenshot', 'success'];
	await agent.waitForFunction(({ actions, sequence }) => actions.every(action => window.overlaySamples.some(sample => sample.sequence > sequence && sample.action === action)), { actions: rapidActions, sequence: rapidStartSequence }, { timeout: 6000 });
	const rapidSamples = await agent.evaluate(sequence => window.overlaySamples.filter(sample => sample.sequence > sequence), rapidStartSequence);
	const observedRapidActions = [...new Set(rapidSamples.map(sample => sample.action))].filter(action => rapidActions.includes(action));
	assert.deepEqual(observedRapidActions, rapidActions, 'fast Playwright steps remain visible in execution order after the runtime settles');
	fs.writeFileSync(path.join(output, 'rapid-actions.json'), JSON.stringify(rapidSamples, null, 2));
	const navigate = await ide.evaluate(url => window.feedback.run({ code: `await page.goto(${JSON.stringify(url + 'settings')}); await page.getByRole('button',{name:'Start',exact:true}).click(); return 'navigated';`, timeoutMs: 15000 }), url);
	assert.match(navigate, /navigated/);
	assert.equal(await read('document.title'), 'Settings fixture');
	assert.equal(await read('fixture.started'), 1);
	// Keep a real execution alive while the Workbench resizes and the user types
	// through the frame surface. No event fixture or fake Playwright page is involved.
	await ide.evaluate(url => window.feedback.start({ code: `await page.goto(${JSON.stringify(url)}); await page.getByRole('textbox',{name:'Search',exact:true}).click(); await page.evaluate(() => new Promise(resolve => { window.releaseReducedMove = resolve; })); await page.mouse.move(35, 45); await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50))); await page.mouse.click(35, 45); await page.evaluate(() => new Promise(resolve => { window.releaseHold = resolve; })); return 'released';`, timeoutMs: 100 }), url);
	for (let attempt = 0; attempt < 100 && !(await read('typeof window.releaseReducedMove === "function"')); attempt++) { await new Promise(resolve => setTimeout(resolve, 50)); }
	await agent.locator('.browser-agent-overlay[data-action="click"]').waitFor();
	const viewport = () => read('({width:innerWidth,height:innerHeight})');
	const overlaySize = () => agent.locator('.browser-agent-overlay').evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
	const waitForOverlayResize = previous => agent.waitForFunction(previous => {
		const overlay = document.querySelector('.browser-agent-overlay');
		return overlay && (overlay.clientWidth !== previous.width || overlay.clientHeight !== previous.height);
	}, previous);
	const waitForViewportChange = async previous => {
		for (let attempt = 0; attempt < 100; attempt++) {
			const current = await viewport();
			if (current.width !== previous.width || current.height !== previous.height) { return; }
			await new Promise(resolve => setTimeout(resolve, 30));
		}
		assert.fail('Native browser viewport did not change with the Workbench surface');
	};
	const assertTargetAligned = async () => {
		const expected = await read('({target:(()=>{const r=document.querySelector("#search").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})(),width:innerWidth,height:innerHeight})');
		await agent.waitForFunction(expected => {
			const overlay = document.querySelector('.browser-agent-overlay');
			const target = overlay?.querySelector('.browser-agent-target');
			if (!overlay || !target || target.hidden) { return false; }
			const bounds = overlay.getBoundingClientRect(), actual = target.getBoundingClientRect();
			const scale = Math.min(bounds.width / expected.width, bounds.height / expected.height);
			const left = bounds.x + (bounds.width - expected.width * scale) / 2 + expected.target.x * scale;
			const top = bounds.y + (bounds.height - expected.height * scale) / 2 + expected.target.y * scale;
			return Math.abs(actual.x - left) < 3 && Math.abs(actual.y - top) < 3 && Math.abs(actual.width - expected.target.width * scale) < 3 && Math.abs(actual.height - expected.target.height * scale) < 3;
		}, expected, { timeout: 5000 });
	};
	await assertTargetAligned();
	await agent.screenshot({ path: path.join(output, 'browser-agent-dark.png') });
	const beforeResize = await overlaySize();
	await resizeAgent(1150, 760);
	await waitForOverlayResize(beforeResize);
	await assertTargetAligned();
	await agent.screenshot({ path: path.join(output, 'browser-agent-narrow.png') });
	const beforeZoom = await viewport();
	await ide.evaluate(() => window.feedback.zoomIn());
	await waitForViewportChange(beforeZoom);
	await assertTargetAligned();
	await agent.screenshot({ path: path.join(output, 'browser-agent-zoom.png') });
	await ide.evaluate(() => window.feedback.lightTheme());
	await agent.waitForFunction(() => document.querySelector('.monaco-workbench')?.classList.contains('vs'));
	await agent.screenshot({ path: path.join(output, 'browser-agent-light.png') });
	await ide.evaluate(() => window.feedback.highContrast());
	await agent.waitForFunction(() => document.querySelector('.monaco-workbench')?.classList.contains('hc-black'));
	await agent.screenshot({ path: path.join(output, 'browser-agent-high-contrast.png') });
	await agent.emulateMedia({ reducedMotion: 'reduce' });
	const beforeReducedResize = await overlaySize();
	await resizeAgent(1280, 800);
	await waitForOverlayResize(beforeReducedResize);
	await assertTargetAligned();
	assert.equal(await agent.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
	const mirror = agent.locator('.browser-agent-surface');
	const inputBox = await agent.locator('.browser-agent-target').boundingBox();
	await agent.evaluate(() => { window.overlaySamples.length = 0; });
	await read('window.releaseReducedMove()');
	for (let attempt = 0; attempt < 100 && !(await read('typeof window.releaseHold === "function"')); attempt++) { await new Promise(resolve => setTimeout(resolve, 30)); }
	await agent.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const reducedSamples = await agent.evaluate(() => window.overlaySamples.filter(sample => sample.action === 'move' || sample.action === 'click'));
	assert.ok(reducedSamples.length > 0, 'reduced-motion still represents real pointer actions');
	assert.ok(reducedSamples.every(sample => sample.trails === 0 && sample.ripples.length === 0), 'reduced-motion disables trails and click pulses');
	assert.ok(new Set(reducedSamples.map(sample => `${Math.round(sample.hotspot.x)},${Math.round(sample.hotspot.y)}`)).size <= 2, 'reduced-motion moves directly without intermediate positions');
	await agent.screenshot({ path: path.join(output, 'browser-agent-reduced-motion.png') });
	await agent.mouse.click(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2);
	await mirror.focus();
	await agent.keyboard.type('User still has control');
	for (let attempt = 0; attempt < 50 && !(await read('document.querySelector("#search").value === "User still has control"')); attempt++) { await new Promise(resolve => setTimeout(resolve, 50)); }
	assert.equal(await read('document.querySelector("#search").value'), 'User still has control', 'keyboard input reaches the existing native browser while the overlay is visible');
	await read('window.releaseHold()');
	await ide.waitForFunction(() => !window.feedback.name()?.startsWith('Playwright ·'));
	await agent.waitForFunction(() => {
		const overlay = document.querySelector('.browser-agent-overlay[data-status="completed"]');
		return overlay?.classList.contains('settled') && !overlay.querySelector('.browser-agent-cursor').hidden
			&& Number(getComputedStyle(overlay.querySelector('.browser-agent-hud')).opacity) > .1;
	}, {}, { timeout: 6000 });
	await agent.screenshot({ path: path.join(output, 'browser-agent-completed.png') });
	const failure = await ide.evaluate(() => window.feedback.run({ code: "await page.getByRole('button',{name:'Missing',exact:true}).click({timeout:350});", timeoutMs: 10000 }));
	assert.match(failure, /Missing|Timeout/);
	await ide.waitForFunction(() => window.feedback.events.some(event => event.action === 'error'));
	await ide.waitForFunction(() => !window.feedback.name()?.startsWith('Playwright ·'));
	await ide.evaluate(() => window.feedback.dispose());
	await agent.locator('.browser-agent-overlay').waitFor({ state: 'detached' });
	const nativeFocus = () => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url))?.isFocused(), url);
	for (let attempt = 0; attempt < 30 && !(await nativeFocus()); attempt++) { await new Promise(resolve => setTimeout(resolve, 50)); }
	assert.equal(await nativeFocus(), true, 'closing the mirror returns focused user input to the native browser');
	await agent.evaluate(() => { window.sampleOverlay = false; window.overlayClickObserver.disconnect(); });
	assert.deepEqual(errors, []);
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, cursorSize: 20, continuousRetargeting: true, rapidActionOrder: rapidActions, clickHotspotAlignment: true, persistentCompletedFeedback: true, deferredLifecycle: true, navigation: true, actions: true, secretRedaction: true, boundedNodes: true, resizeAlignment: true, zoomAlignment: true, themes: ['dark', 'light', 'highContrast'], reducedMotion: true, nativeUserInput: true, errors: true, events }, null, 2));
	console.log('PASS: real Playwright events, Bibata 20px cursor, continuous retargeting, rapid action order, click hotspot, click/type/scroll/navigation, deferred completion, privacy, resize/zoom alignment, themes, reduced motion, user input, errors and lifecycle.');
}
try {
	await test();
} catch (error) {
	const diagnostics = { error: String(error), windows: [] };
	for (const page of app?.windows() ?? []) {
		const state = await page.evaluate(() => ({
			result: window.feedback?.result,
			events: window.feedback?.events?.slice(-20),
			samples: window.overlaySamples?.slice(-20),
		})).catch(() => ({}));
		diagnostics.windows.push(state);
		if (state.samples) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
	}
	fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify(diagnostics, null, 2));
	throw error;
} finally {
	if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); }
	server.close();
	fs.rmSync(tmp, { recursive: true, force: true });
}
