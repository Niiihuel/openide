// Copyright (c) OpenIDE. Licensed under the MIT License.
// Native controls in main and auxiliary windows; all state lives in a temporary profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {_electron}=createRequire(path.join(root,'vscode/package.json'))('playwright-core');
if(process.env.OPENIDE_TEST_VIRTUAL_DISPLAY!=='1') throw Error('Use dev/run-virtual-gui.mjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'openide-controls-'));
const output=path.join(root,'.build/workbench-controls-runtime');
fs.mkdirSync(path.join(tmp,'profile/User'),{recursive:true});fs.mkdirSync(path.join(tmp,'workspace'));fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(tmp,'profile/User/settings.json'),JSON.stringify({'security.workspace.trust.enabled':false,'workbench.startupEditor':'none','workbench.colorTheme':'OpenIDE Dark'}));
let app;const errors=[];
try {
 app=await _electron.launch({executablePath:path.join(root,'vscode/.build/electron/openide'),cwd:path.join(root,'vscode'),args:['.',path.join(tmp,'workspace'),'--user-data-dir',path.join(tmp,'profile'),'--shared-data-dir',path.join(tmp,'shared'),'--extensions-dir',path.join(tmp,'extensions'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--no-sandbox','--ozone-platform=x11'],env:{...process.env,VSCODE_DEV:'1'},timeout:90000});
 const ide=await app.firstWindow();ide.on('pageerror',e=>errors.push(e.message));
 await ide.waitForSelector('.monaco-workbench',{timeout:90000});
 await ide.evaluate(async base=>{
  const {Action2,registerAction2}=await import(base+'platform/actions/common/actions.js');
  const {IAuxiliaryWindowService}=await import(base+'workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.js');
  const {IWorkbenchThemeService}=await import(base+'workbench/services/themes/common/workbenchThemeService.js');
  const {IContextMenuService}=await import(base+'platform/contextview/browser/contextView.js');
  const {InputBox}=await import(base+'base/browser/ui/inputbox/inputBox.js');
  const {FindInput}=await import(base+'base/browser/ui/findinput/findInput.js');
  const {Button,ButtonWithDropdown}=await import(base+'base/browser/ui/button/button.js');
  const {DisposableStore}=await import(base+'base/common/lifecycle.js');
  const {defaultInputBoxStyles,defaultButtonStyles,defaultToggleStyles}=await import(base+'platform/theme/browser/defaultStyles.js');
  const {openideSearchBoxStyles,openideButtonStyles}=await import(base+'workbench/contrib/openideAgent/browser/openideControlStyles.js');
  registerAction2(class extends Action2 {
   constructor(){super({id:'test.workbenchControls',title:'Workbench Controls Fixture',f1:true});}
   run(accessor){
    const windows=accessor.get(IAuxiliaryWindowService),theme=accessor.get(IWorkbenchThemeService),context=accessor.get(IContextMenuService);
    const stores=[];let clicks=0;
    const render=container=>{
     const store=new DisposableStore();stores.push(store);
     const host=document.createElement('section');host.className='controls-fixture';host.style.cssText='position:absolute;inset:100px 24px auto;max-width:620px;z-index:999;background:var(--oi-surface);color:var(--oi-text);padding:24px;display:grid;gap:16px;font-size:13px;';container.append(host);
     const row=(name,label)=>{const row=document.createElement('div');row.dataset.control=name;row.style.cssText='display:grid;grid-template-columns:130px minmax(0,1fr);align-items:center;gap:16px;';const text=document.createElement('span');text.textContent=label;row.append(text);const content=document.createElement('div');row.append(content);host.append(row);return content;};
     store.add(new InputBox(row('native-search','Native search'),undefined,{placeholder:'Filter files…',ariaLabel:'Native search',inputBoxStyles:defaultInputBoxStyles}));
     store.add(new InputBox(row('product-search','Shared search'),undefined,{placeholder:'Search settings…',ariaLabel:'Shared search',inputBoxStyles:openideSearchBoxStyles}));
     store.add(new FindInput(row('find','Find in files'),undefined,{label:'Find in files',placeholder:'Find',showCommonFindToggles:true,inputBoxStyles:defaultInputBoxStyles,toggleStyles:defaultToggleStyles}));
     const invalid=store.add(new InputBox(row('invalid','Validation'),undefined,{ariaLabel:'Validation',inputBoxStyles:defaultInputBoxStyles}));invalid.value='Invalid expression';invalid.showMessage({type:3,content:'Invalid expression'});
     for(const [name,label,options] of [['native-button','Native button',{...defaultButtonStyles,secondary:true}],['product-button','Shared button',{...openideButtonStyles,secondary:true}],['primary','Primary action',defaultButtonStyles],['disabled','Disabled action',{...defaultButtonStyles,secondary:true}]]) {
      const button=store.add(new Button(row(name,label),options));button.label=name==='primary'?'Continue':'Open';if(name==='disabled')button.enabled=false;store.add(button.onDidClick(()=>clicks++));
     }
     const split=store.add(new ButtonWithDropdown(row('split','Split button'),{...defaultButtonStyles,secondary:true,contextMenuProvider:context,actions:[{id:'fixture.alt',label:'Alternative',enabled:true,run:async()=>clicks++}]}));split.label='Open';
     const icon=document.createElement('button');icon.className='oi-dock-action';icon.setAttribute('aria-label','Icon action');icon.style.cssText='width:28px;height:28px;border:0;';const glyph=document.createElement('span');glyph.className='codicon codicon-folder';icon.append(glyph);row('icon','Icon action').append(icon);
     return host;
    };
    try { render(document.querySelector('.monaco-workbench')); } catch(error) { window.workbenchControlsError=error.stack; throw error; }
    window.workbenchControls={clicks:()=>clicks,open:async()=>{const aux=await windows.open({bounds:{width:760,height:850},nativeTitlebar:true});await aux.whenStylesHaveLoaded;render(aux.container);},theme:async kind=>{const all=await theme.getColorThemes();const target=kind==='contrast'?all.find(t=>t.type==='hc')??all.find(t=>/High Contrast/.test(t.label)):all.find(t=>t.label===kind);if(!target)throw Error('Missing theme '+kind);await theme.setColorTheme(target,'preview');return target.label;},dispose:()=>stores.forEach(s=>s.dispose())};
   }
  });
 },`vscode-file://vscode-app${root}/vscode/out/vs/`);
 await ide.keyboard.press('Control+Shift+KeyP');await ide.locator('.quick-input-widget input').first().fill('>Workbench Controls Fixture');await ide.locator('.quick-input-list .monaco-list-row').filter({hasText:'Workbench Controls Fixture'}).first().waitFor();await ide.keyboard.press('Enter');await ide.waitForFunction(()=>window.workbenchControls||window.workbenchControlsError);assert.equal(await ide.evaluate(()=>window.workbenchControlsError),undefined);
 const [agent]=await Promise.all([app.waitForEvent('window'),ide.evaluate(()=>window.workbenchControls.open())]);agent.on('pageerror',e=>errors.push(e.message));await agent.locator('.controls-fixture').waitFor();
 const summary=[];
 for(const theme of ['OpenIDE Dark','OpenIDE Light','contrast']){
  const label=await ide.evaluate(t=>window.workbenchControls.theme(t),theme);
  for(const [name,page] of [['ide',ide],['agent',agent]]){
   await page.mouse.move(0,0);await page.waitForTimeout(200);
   const snapshot=await page.locator('.controls-fixture').evaluate(host=>Object.fromEntries(['native-search','product-search','find','native-button','product-button','disabled','invalid','split','icon'].map(name=>{const row=host.querySelector(`[data-control="${name}"]`);const el=row.querySelector('.monaco-inputbox,.monaco-button,.oi-dock-action');const s=getComputedStyle(el),r=el.getBoundingClientRect();return[name,{radius:s.borderTopLeftRadius,background:s.backgroundColor,border:s.borderTopColor,height:r.height,width:r.width,opacity:s.opacity}];})));
   assert.equal(snapshot['native-search'].radius,'12px');assert.equal(snapshot.find.radius,'12px');assert.equal(snapshot['native-button'].radius,'12px');assert.equal(snapshot.icon.radius,'7px');
   assert.equal(snapshot['native-search'].background,snapshot['product-search'].background);assert.equal(snapshot['native-search'].border,snapshot['product-search'].border);assert.equal(snapshot['native-button'].background,snapshot['product-button'].background);assert.equal(snapshot['native-button'].border,snapshot['native-search'].border);
   const invalid=page.locator('[data-control=invalid] .monaco-inputbox');await invalid.hover();await page.waitForTimeout(150);assert.equal(await invalid.evaluate(el=>getComputedStyle(el).borderTopColor),snapshot.invalid.border,'validation border survives neutral hover styling');
   const input=page.getByRole('textbox',{name:'Native search',exact:true});await input.fill('filter');await input.press('Tab');assert.equal(await input.inputValue(),'filter');
   const native=page.locator('[data-control=native-button] .monaco-button');await native.hover();await page.waitForTimeout(150);const bounds=await native.boundingBox();assert.equal(bounds.width,snapshot['native-button'].width);assert.equal(bounds.height,snapshot['native-button'].height,'hover does not relayout');
   const before=await ide.evaluate(()=>window.workbenchControls.clicks());await native.press('Enter');assert.equal(await ide.evaluate(()=>window.workbenchControls.clicks()),before+1,'native keyboard action remains connected');
   const split=page.locator('[data-control=split]');assert.equal(await split.locator('.monaco-dropdown-button').evaluate(el=>getComputedStyle(el).borderTopLeftRadius),'0px');
   await page.screenshot({path:path.join(output,`${name}-${theme.replaceAll(' ','-')}.png`)});summary.push({window:name,theme:label,snapshot});
  }
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(summary,null,2));console.log('PASS: shared native controls in both windows, dark/light/high contrast, validation, keyboard, split seams and stable hover geometry.');
 await ide.evaluate(()=>window.workbenchControls.dispose());
} catch(error) { console.error(error); throw error; } finally {if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});}
