// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-hover-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-hover-'));
const output = path.join(root, '.build/agent-window-hover-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace')); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom', 'workbench.hover.delay': 200 }));
let app; const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	const ide = await app.firstWindow(); ide.on('pageerror', error => { errors.push(error.message); console.error(error); });
	ide.on('console', msg => { if(msg.type()==='error' && !msg.text().includes('No default agent registered')) { errors.push(msg.text()); console.error(msg.text()); } });
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id:'test.agentHover',title:'Agent Hover Fixture',f1:true }); }
			async run(accessor) { const commands=accessor.get(ICommandService); window.agentHoverFixture = { open: () => commands.executeCommand('openide.agent.openAgentWindow') }; }
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Agent Hover Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({hasText:'Agent Hover Fixture'}).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.agentHoverFixture);
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.agentHoverFixture.open());
	const agent = await opened;
	agent.on('pageerror',error=>errors.push(error.message));
	agent.on('console',message=>{ if(message.type()==='error') { console.error(message.text()); if(!message.text().includes('No default agent registered')) errors.push(message.text()); } });
	await agent.locator('.openide-agent-window-actions').waitFor();
	const iconState = element => { const style = element.ownerDocument.defaultView.getComputedStyle(element), glyph = element.ownerDocument.defaultView.getComputedStyle(element, '::before'); return { size:style.fontSize, family:glyph.fontFamily, content:glyph.content, mask:glyph.maskImage }; };
	const mainSidebar = ide.locator('.part.titlebar .action-toolbar-container .action-label.codicon').first();
	await mainSidebar.waitFor();
	const agentSidebar = agent.locator('.openide-agent-window-header [aria-controls="openide-agent-window-sidebar"] .codicon').first();
	const mainIcon = await mainSidebar.evaluate(iconState), agentIcon = await agentSidebar.evaluate(iconState);
	assert.equal(agentIcon.family, mainIcon.family, 'agent glyph uses the native product icon font');
	assert.equal(agentIcon.size, mainIcon.size, 'agent icon size equals native toolbar');
	const nativeEquivalent = await ide.evaluate(() => { const icon=document.createElement('span'); icon.className='codicon codicon-layout-sidebar-left'; document.querySelector('.part.titlebar').append(icon); const style=getComputedStyle(icon,'::before'); const value={family:style.fontFamily,content:style.content}; icon.remove(); return value; });
	assert.equal(agentIcon.content,nativeEquivalent.content,'agent sidebar uses same product theme glyph for open state');
	const chromeSizes = await agent.locator('.openide-agent-window-header .openide-agent-window-chrome-action, .openide-agent-window-actions .openide-agent-window-chrome-action').evaluateAll(buttons=>buttons.filter(button=>button.getClientRects().length).map(button=>({label:button.getAttribute("aria-label"),width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height,padding:getComputedStyle(button).padding})));
	assert.ok(chromeSizes.every(size=>size.width===24 && size.height===24 && size.padding==='0px'),`all icon-only shell actions reuse shared 24px head buttons: ${JSON.stringify(chromeSizes)}`);

	const header = agent.locator('.openide-agent-window-header [aria-controls="openide-agent-window-sidebar"]');
	await agent.locator('.openide-agent-window-title').hover();
	await agent.waitForTimeout(250);
	assert.equal(await header.evaluate(element=>getComputedStyle(element).backgroundColor),'rgba(0, 0, 0, 0)','expanded control has no permanent hover fill');
	await header.hover();
	const headerTip=agent.locator('.monaco-hover').filter({hasText:await header.getAttribute('aria-label')}).last();
	await headerTip.waitFor({state:'visible'});
	const headerBounds=await header.boundingBox(), tipBounds=await headerTip.boundingBox();
	assert.ok(tipBounds.y >= headerBounds.y+headerBounds.height,'header tooltip opens below');
	const hoverColor=await header.evaluate(element=>getComputedStyle(element).backgroundColor);
	const expectedHover=await header.evaluate(element=>{const original=element.style.background; element.style.background='var(--vscode-toolbar-hoverBackground)';const color=getComputedStyle(element).backgroundColor;element.style.background=original;return color;});
	assert.equal(hoverColor,expectedHover,'header reuses shared hover color');
	await agent.screenshot({path:path.join(output,'header-hover.png')});

	await agent.locator('.openide-agent-window-title').hover();await agent.waitForTimeout(250);
	const row=agent.locator('.openide-agent-window-context-section').first().locator('.openide-agent-window-context-row').nth(2);
	await row.hover();
	await agent.waitForTimeout(650);
	assert.equal(await agent.locator('.monaco-hover:visible').count(),0,'readable context row has no duplicate tooltip');
	const longLabel='A very long background terminal command that must reveal its complete name';
	await row.evaluate((element,label)=>{element.setAttribute('aria-label',label);element.querySelector('.openide-agent-window-row-label').textContent=label;},longLabel);
	await agent.locator('.openide-agent-window-title').hover();await row.hover();
	const contextTip=agent.locator('.monaco-hover').filter({hasText:longLabel}).last();
	await contextTip.waitFor({state:'visible'});
	const rowBounds=await row.boundingBox(), contextBounds=await contextTip.boundingBox();
	assert.ok(contextBounds.y+contextBounds.height <= rowBounds.y+2,'clipped row tooltip opens above');
	await agent.screenshot({path:path.join(output,'context-hover.png')});

	const placement = await agent.locator('.openide-agent-window-header').evaluate(el => ({
		first: el.firstElementChild.getAttribute('aria-controls'), last: el.lastElementChild.getAttribute('aria-controls'),
		count: document.querySelectorAll('.openide-agent-window-actions [aria-controls="openide-agent-window-sidebar"], .openide-agent-window-actions [aria-controls="openide-agent-window-workspace"]').length,
	}));
	assert.deepEqual(placement,{first:'openide-agent-window-sidebar',last:'openide-agent-window-workspace',count:0});
	const right = agent.locator('.openide-agent-window-header [aria-controls="openide-agent-window-workspace"]');
	await header.click();
	assert.equal(await header.getAttribute('aria-expanded'),'false');
	await header.press('Enter');
	assert.equal(await header.getAttribute('aria-expanded'),'true');
	await right.click();
	assert.equal(await right.getAttribute('aria-expanded'),'true');
	await right.press('Space');
	assert.equal(await right.getAttribute('aria-expanded'),'false');
	await agent.keyboard.press('Control+KeyB');
	assert.equal(await header.getAttribute('aria-expanded'),'false');
	await agent.keyboard.press('Control+KeyB');
	assert.equal(await header.getAttribute('aria-expanded'),'true');


	assert.deepEqual(errors,[],'native hover supports auxiliary DOM');
	const result={centralHeaderToggles:true,mouseAndKeyboardToggles:true,shared24pxControls:true,nativeProductIconGlyph:true,headerBelow:true,headerGlobalHover:true,expandedNeutral:true,readableRowNoTooltip:true,clippedRowTooltipAbove:true};
	fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally { if(app) { await app.close(); } fs.rmSync(tmp,{recursive:true,force:true}); }
