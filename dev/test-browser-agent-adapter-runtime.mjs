// Copyright (c) OpenIDE. Licensed under the MIT License.
// Real Playwright contract test. Run inside result-fhs/bin/openide-build on NixOS.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'vscode/package.json'));
const { chromium } = require('playwright-core');
const { PlaywrightBrowserAgentAdapter } = await import('../vscode/out/vs/platform/browserView/node/playwrightBrowserAgentAdapter.js');
const server = http.createServer((request, response) => {
	response.setHeader('Content-Type', 'text/html');
	response.end(`<!doctype html><title>Browser agent fixture</title>
	<style>body{font:20px system-ui;margin:40px}input,button,a{display:block;margin:20px;padding:12px}input{margin-left:25vw}section{height:1600px}</style>
	<label>Search<input aria-label="Search"></label><input type="password" aria-label="Private token">
	<button onclick="document.body.dataset.clicked='yes'">Continue</button><a href="/next">Next</a>
	<iframe srcdoc="<button style='margin:25px'>Inside frame</button>"></iframe><section></section><p>Bottom</p>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let adapter;
try {
	browser = await chromium.launch({ headless: true, executablePath: require('playwright').chromium.executablePath(), args: ['--no-sandbox'] });
	const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	const events = [];
	const originalListeners = ['request', 'framenavigated', 'close'].map(event => page.listenerCount(event));
	adapter = new PlaywrightBrowserAgentAdapter('test-owner', 'test-page', page, event => events.push(event));
	await adapter.run(async observed => {
		await observed.goto(`${origin}/?token=secret`);
		await observed.getByRole('textbox', { name: 'Search' }).click();
		await observed.getByRole('textbox', { name: 'Search' }).fill('never include this input');
		await observed.getByRole('button', { name: 'Continue' }).click();
		await observed.mouse.wheel(0, 300);
	}, { toolCallId: 'tool-first', executionId: 'execution-first' });
	assert.equal(await page.locator('body').getAttribute('data-clicked'), 'yes');
	assert.equal(await page.getByRole('textbox', { name: 'Search' }).inputValue(), 'never include this input');
	assert.deepEqual(events.filter(event => event.phase === 'started').map(event => event.action), ['wait', 'navigate', 'click', 'type', 'click', 'scroll']);
	assert.ok(events.find(event => event.action === 'click').target.width > 0);
	assert.equal(events.find(event => event.action === 'type').target.label, 'Search');
	assert.deepEqual(events[0].viewport, { width: 1000, height: 700, deviceScaleFactor: 2 });
	await adapter.run(async observed => {
		await observed.getByLabel('Private token').fill('sk-password-secret');
		await observed.getByRole('link', { name: 'Next' }).click();
		await observed.waitForURL(`${origin}/next`);
		await observed.frameLocator('iframe').getByRole('button').click();
		await observed.screenshot();
	}, { toolCallId: 'tool-second' });
	assert.equal(page.url(), `${origin}/next`);
	const sensitive = events.find(event => event.action === 'type' && event.sensitive);
	assert.ok(sensitive);
	assert.equal(sensitive.target.label, undefined);
	const frameTarget = events.find(event => event.action === 'click' && event.target?.label === 'Inside frame').target;
	const expectedFrameTarget = await page.frameLocator('iframe').getByRole('button').boundingBox();
	assert.deepEqual({ x: frameTarget.x, y: frameTarget.y, width: frameTarget.width, height: frameTarget.height }, expectedFrameTarget);
	assert.ok(events.some(event => event.action === 'navigate' && event.toolCallId === 'tool-second'));
	await adapter.run(async observed => {
		await observed.getByRole('textbox', { name: 'Search' }).hover();
		await observed.setViewportSize({ width: 800, height: 650 });
		await new Promise(resolve => setTimeout(resolve, 250));
	});
	const resized = events.findLast(event => event.action === 'hover' && event.phase === 'updated');
	assert.deepEqual(resized.viewport, { width: 800, height: 650, deviceScaleFactor: 2 });
	assert.equal(resized.target.x, (await page.getByRole('textbox', { name: 'Search' }).boundingBox()).x);
	await assert.rejects(adapter.run(observed => observed.locator('#missing-secret-selector').click({ timeout: 50 })));
	assert.equal(events.at(-1).status, 'error');
	assert.ok(!/sk-password-secret|never include this input|missing-secret-selector|token=secret/.test(JSON.stringify(events)));
	const pause = adapter.run(observed => observed.waitForTimeout(100));
	await new Promise(resolve => setTimeout(resolve, 20));
	adapter.dispose();
	const closedCount = events.length;
	await pause;
	assert.equal(events.length, closedCount);
	assert.equal(events.at(-1).closed, true);
	assert.deepEqual(['request', 'framenavigated', 'close'].map(event => page.listenerCount(event)), originalListeners);
	assert.deepEqual(errors, []);
	console.log(`PASS: ${events.length} real Playwright events; input, click, scroll, navigation, resize, iframe coordinates, screenshot, privacy and lifecycle.`);
} finally {
	adapter?.dispose();
	await browser?.close();
	server.close();
}
