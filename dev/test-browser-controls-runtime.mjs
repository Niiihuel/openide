// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-chat-waiting-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') throw new Error('Use dev/run-virtual-gui.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-waiting-'));
const output = path.join(root, '.build/browser-controls-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace')); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'openide.memory.captureMode': 'off' }));
let app;
try {
 app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
 const page = await app.firstWindow();
 page.on('pageerror', error => console.error(error));
 page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
 await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
 await page.evaluate(async base=>{
  const {applyOpenideSurfaceCss}=await import(base+'workbench/contrib/openideAgent/browser/openideSurfaceStyle.js');applyOpenideSurfaceCss();
  const {Action2,registerAction2}=await import(base+'platform/actions/common/actions.js');
  const {IContextViewService}=await import(base+'platform/contextview/browser/contextView.js');
  const {IThemeService}=await import(base+'platform/theme/common/themeService.js');
  const {OpenideComposerPopover}=await import(base+'workbench/contrib/openideAgent/browser/chat/openideComposerMenu.js');
  const {OpenideSettingsDropdown}=await import(base+'workbench/contrib/openideSettings/browser/openideSettingsDropdown.js');
  const {BrowserCssInspectorContribution}=await import(base+'workbench/contrib/browserView/electron-browser/features/browserInspectorFeature.js');
  registerAction2(class extends Action2 {
   constructor(){super({id:'test.browserControls',title:'Browser Controls Fixture',f1:true});}
   run(accessor){
    const context=accessor.get(IContextViewService),theme=accessor.get(IThemeService);
    const root=document.createElement('div');root.className='browser-root controls-fixture';root.style.cssText='position:absolute;left:350px;top:200px;width:440px;height:360px;z-index:100;background:var(--oi-surface);padding:16px';document.querySelector('.monaco-workbench').append(root);
    const toolbar=root.appendChild(document.createElement('div'));toolbar.className='browser-emulation-toolbar';
    const dropdown=new OpenideSettingsDropdown([{label:'Auto (76%)'},{label:'50%'},{label:'100%'}],0,context,'Scale');dropdown.render(toolbar);
    const panel=root.appendChild(document.createElement('div'));panel.className='browser-inspector-panel';
    const rows=panel.appendChild(document.createElement('div'));
    const inspector=Object.create(BrowserCssInspectorContribution.prototype);
    Object.assign(inspector,{_store:{isDisposed:false},contextViewService:context,themeService:theme,colorPopover:new OpenideComposerPopover(context),colorPickerOpen:false,suppressColorPickerResync:false,liveStyleQueue:Promise.resolve(),panel:{element:panel},data:{computedStyles:{}},editor:{window},clipboardService:{writeText(){}},getColorTokens:async()=>[],queueLiveStyle(property,value){window.browserControls.applied.push({property,value});}});
    function render(){rows.replaceChildren();const row=rows.appendChild(document.createElement('div'));row.className='browser-inspector-editable-property';row.style.width='360px';row.append('color');const control=inspector.createColorControl('color','rgb(237, 237, 237)');row.append(control);}
    inspector.render=render;
    window.browserControls={applied:[],dropdown,inspector,dispose(){inspector.colorPopover.dispose();dropdown.dispose();root.remove();}};
    render();
   }
  });
 },`vscode-file://vscode-app${root}/vscode/out/vs/`);
 await page.keyboard.press('Control+Shift+KeyP');await page.locator('.quick-input-widget input').first().fill('>Browser Controls Fixture');await page.locator('.quick-input-list .monaco-list-row').filter({hasText:'Browser Controls Fixture'}).first().waitFor();await page.keyboard.press('Enter');
 const fixture=page.locator('.controls-fixture');await fixture.waitFor();
 const scale=fixture.getByRole('button',{name:'Scale',exact:true});await scale.click();
 await page.evaluate(()=>window.browserControls.dropdown.setOptions([{label:'Auto (80%)'},{label:'50%'},{label:'100%'}],0));
 assert.equal(await scale.getAttribute('aria-expanded'),'true');
 await page.getByRole('button',{name:'50%',exact:true}).click();assert.equal(await scale.textContent(),'50%');
 const swatch=fixture.locator('.browser-inspector-color-swatch');await swatch.click();
 const picker=page.locator('.browser-inspector-color-picker');await picker.waitFor();
 const first=await picker.boundingBox();assert(first.x>200&&first.y>50,JSON.stringify(first));
 await swatch.click();await picker.waitFor({state:'hidden'});
 await swatch.click();await picker.waitFor();
 const second=await picker.boundingBox();assert(second.x>200&&second.y>50,JSON.stringify(second));
 assert.equal(await page.locator('.openide-menu[role="dialog"]').count(),1);
 const paint=await page.locator('.openide-menu[role="dialog"]').evaluate(el=>({background:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius}));assert.notEqual(paint.background,'rgba(0, 0, 0, 0)');assert.notEqual(paint.radius,'0px');
 await page.screenshot({path:path.join(output,'color-popover.png')});
 await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});
 await page.evaluate(()=>window.browserControls.dispose());
 console.log('PASS: shared scale dropdown updates while open; color picker toggles/reopens at its anchor and closes with Escape.');
}finally{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});}
