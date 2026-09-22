// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-chat-elements-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') throw new Error('Use dev/run-virtual-gui.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-elements-'));
const output = path.join(root, '.build/chat-elements-runtime');
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
 await page.evaluate(async base => {
  const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
  const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
  const { IHoverService } = await import(base + 'platform/hover/browser/hover.js');
  const { IFileService } = await import(base + 'platform/files/common/files.js');
  const { IThemeService } = await import(base + 'platform/theme/common/themeService.js');
  const { IConfigurationService } = await import(base + 'platform/configuration/common/configuration.js');
  const { DisposableStore } = await import(base + 'base/common/lifecycle.js');
  const { Event } = await import(base + 'base/common/event.js');
  const { observableValue } = await import(base + 'base/common/observable.js');
  const { MarkdownString } = await import(base + 'base/common/htmlContent.js');
  const { OpenideChatResponseRenderer } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatResponseRenderer.js');
  const { OpenideChatComposerAttachments } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatComposerAttachments.js');
  const { renderImageStrip } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatRequestBubble.js');
  const { createOpenideChatResponseItem } = await import(base + 'workbench/contrib/openideAgent/common/chat/openideChatItem.js');
  registerAction2(class extends Action2 {
   constructor() { super({id:'test.chatElements',title:'Chat Elements Fixture',f1:true}); }
   async run(accessor) {
    const store = new DisposableStore();
    const config = accessor.get(IConfigurationService);
    const themes = accessor.get(IThemeService);
    const host = document.createElement('div'); host.className = 'openide-chat-native elements-fixture';
    host.style.cssText='position:absolute;left:360px;top:60px;bottom:40px;width:640px;z-index:1000;padding:24px;overflow:auto;background:var(--oi-surface);border:1px solid var(--oi-border);border-radius:var(--oi-radius-group)';
    document.querySelector('.monaco-workbench').append(host);
    const user = document.createElement('div'); user.className='openide-chat-request-bubble'; host.append(user);
    const prompt = document.createElement('p'); prompt.textContent='Revisá estas referencias y actualizá el chat con nuestros tokens.'; user.append(prompt);
    const images = document.createElement('div'); images.className='openide-chat-request-images'; user.append(images);
    const renderer=accessor.get(IInstantiationService).createInstance(OpenideChatResponseRenderer,observableValue('width',640),Event.None);
    const template=renderer.renderTemplate(host);
    const composer=document.createElement('div'); composer.className='openide-chat-input-card'; composer.style.marginTop='24px'; host.append(composer);
    const strip=document.createElement('div'); strip.className='openide-chat-attach-strip'; composer.append(strip);
    const input=document.createElement('textarea'); input.className='openide-chat-prompt'; input.placeholder='Preguntá lo que quieras…'; composer.append(input);
    const opened=[];
    const commands={executeCommand:async(...args)=>{opened.push(args);}};
    const attachments = store.add(new OpenideChatComposerAttachments(strip,composer,accessor.get(IHoverService),accessor.get(IFileService),()=>{},commands,()=>input.focus()));
    const canvas=document.createElement('canvas'); canvas.width=180;canvas.height=180;
    const ctx=canvas.getContext('2d');const gradient=ctx.createLinearGradient(0,0,180,180);gradient.addColorStop(0,'#77b8aa');gradient.addColorStop(1,'#425ca4');ctx.fillStyle=gradient;ctx.fillRect(0,0,180,180);ctx.fillStyle='#ffffff';ctx.fillRect(35,50,110,12);ctx.fillRect(35,76,80,8);ctx.fillRect(35,96,100,8);
    const data=canvas.toDataURL('image/png').split(',')[1];
    const files=[{name:'chat-reference.png',mimeType:'image/png',data},{name:'reasoning-layout-with-a-long-filename.png',mimeType:'image/png',data}];
    attachments.restore(files);renderImageStrip(images,files,store,commands);
    let thinking='Voy a revisar la estructura del chat, los adjuntos y cómo se muestran los pasos durante la respuesta.\n\nEl razonamiento necesita un encabezado estable que permita abrir y cerrar el detalle sin perder el hilo.';
    let content=[{kind:'thinking',text:thinking,isComplete:false}];
    const render=(complete=false)=>renderer.renderElement({element:createOpenideChatResponseItem({id:'elements',requestId:'request',content,isComplete:complete,startedAt:Date.now()-8000})},0,template);
    render();
    window.elementsFixture={
     append:()=>{thinking+='\nUn paso más en la revisión.';content=[{kind:'thinking',text:thinking,isComplete:false}];render();},
     long:()=>{thinking='Revisando la estructura y los tokens del chat.\n'.repeat(70);content=[{kind:'thinking',text:thinking,isComplete:false}];render();},
     finish:()=>{content=[{kind:'thinking',text:thinking,isComplete:true,durationMs:8000},{kind:'explore',id:'read',isComplete:true,entries:[{callId:'read',tool:'read_file',target:'chat.css',state:'success'}]},{kind:'markdown',value:new MarkdownString('El chat ya tiene una estructura más clara.\n\n- Razonamiento desplegable y estable.\n- Adjuntos con nombre y vista previa.\n- Acciones conservadas en orden.')}];render(true);},
     waiting:()=>{content=[{kind:'ask',requestId:'ask',questions:[],isComplete:false},{kind:'tool',callId:'tool',name:'browser_evaluate',argumentsJson:'{}',state:'running'}];render();},
     indicatorOff:async()=>{await config.updateValue('openide.chat.workingIndicator',false);content=[{kind:'tool',callId:'tool',name:'browser_evaluate',argumentsJson:'{}',state:'running'}];render();},
     compact:(status='started')=>{content=[{kind:'compaction',status,origin:'automatic',snapshot:{beforeTokens:82000,afterTokens:12000,savingsPercent:85,origin:'automatic'}}];render(status==='completed');},
     subagent:()=>{content=[{kind:'subagent',runId:'worker',title:'Actualizar el chat',status:'running',index:0,total:1,timeline:[
      {sequence:1,timestamp:1,type:'reasoning',message:'Revisé los estilos y la estructura.\nVoy a conservar los tokens existentes.'},
      {sequence:2,timestamp:2,type:'toolStart',toolCallId:'write',toolName:'write_file',argumentsJson:'{"path":"chat.css"}'},
      {sequence:3,timestamp:3,type:'fileChange',fileDiff:{path:'chat.css',created:false,editAdded:2,editRemoved:1,diffLines:[{t:'del',x:'white-space: normal;'},{t:'add',x:'white-space: pre-wrap;'},{t:'add',x:'border-radius: var(--oi-radius-control);'}]}},
      {sequence:4,timestamp:4,type:'toolResult',toolCallId:'write',toolName:'write_file',message:'Cambios guardados.\nVerificación de tipos: correcta.'},
      {sequence:5,timestamp:5,type:'text',message:'Los cambios del chat ya están listos para revisar.'},
      {sequence:6,timestamp:6,type:'reasoning',message:'Estoy comprobando el comportamiento en conversaciones largas.'}
     ]}];render();},
     authoring:async(name,args,state='running')=>{await config.updateValue('openide.chat.workingIndicator',true);content=[{kind:'tool',callId:'authoring',name,argumentsJson:args,state,resultText:state==='error'?'Permission was declined.':state==='success'?'Saved successfully.':undefined}];render(state!=='running');},
     authoringOverview:()=>{content=[
      {kind:'explore',id:'skill-read',isComplete:true,entries:[{callId:'skill-read',tool:'read_file',target:'.agents/skills/design/SKILL.md',state:'success'}]},
      {kind:'tool',callId:'skill-save',name:'skill_save',argumentsJson:JSON.stringify({name:'design',content:'PRIVATE_BODY'}),state:'success',resultText:'Saved successfully.'},
      {kind:'tool',callId:'rule-error',name:'rule_manage',argumentsJson:JSON.stringify({name:'project-style',scope:'project',action:'save'}),state:'error',resultText:'Permission was declined.'},
      {kind:'tool',callId:'memory-cancelled',name:'memory',argumentsJson:JSON.stringify({target:'project',action:'add'}),state:'cancelled'},
      {kind:'tool',callId:'hooks',name:'write_file',argumentsJson:JSON.stringify({path:'.openide/hooks.json',content:'PRIVATE_BODY'}),state:'success',resultText:'Saved successfully.'},
      {kind:'tool',callId:'mcp',name:'mcp_call',argumentsJson:JSON.stringify({tool:'mcp_docs_search',arguments:{token:'PRIVATE_TOKEN'}}),state:'success',resultText:'Found documentation.'}
     ];render(true);},
     protectedApproval:(requestId)=>{content=[{kind:'confirmation',requestId,tool:'rule_manage',title:'Allow saving project rule?',detail:'Project rule: project-style',operationOnly:true}];render();},
     theme:async name=>{const type=name.includes('Light')?'light':'dark';const theme=(await themes.getColorThemes()).find(theme=>theme.type===type);if(!theme)throw new Error('Missing '+type+' theme');await themes.setColorTheme(theme,undefined);if(themes.getColorTheme().type!==type)throw new Error('Theme did not switch');},
     opened,dispose:()=>{renderer.disposeTemplate(template);renderer.dispose();store.dispose();host.remove();}
    };
   }
  });
 }, `vscode-file://vscode-app${root}/vscode/out/vs/`);
 await page.keyboard.press('Control+Shift+KeyP');
 await page.locator('.quick-input-widget input').first().fill('>Chat Elements Fixture');
 await page.locator('.quick-input-list .monaco-list-row').filter({hasText:'Chat Elements Fixture'}).first().waitFor();
 await page.keyboard.press('Enter');
 const fixture=page.locator('.elements-fixture');await fixture.waitFor();
 const details=fixture.locator('.openide-chat-reasoning');const summary=details.locator('summary');const body=details.locator('.openide-chat-think');
 assert.equal(await summary.isVisible(),true);
 assert.equal(await body.evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap');
 assert.ok(await fixture.locator('.openide-attach-name').first().evaluate(el=>el.clientWidth>60),'attachment filename has room to be read');
 assert.equal(await fixture.locator('.openide-chat-response-working:visible').count(),0);
 assert.equal(await fixture.locator('.openide-chat-shimmer:visible').count(),1);
 await fixture.screenshot({path:path.join(output,'reasoning-live-dark.png')});
 await summary.focus();await page.keyboard.press('Enter');
 assert.equal(await body.isVisible(),false);
 await page.evaluate(()=>window.elementsFixture.append());
 assert.equal(await body.isVisible(),false);
 await page.keyboard.press('Enter');assert.equal(await body.isVisible(),true);
 await page.evaluate(()=>window.elementsFixture.long());
 await page.waitForFunction(()=>{const el=document.querySelector('.elements-fixture .openide-chat-think');return el.scrollTop>100;});
 await body.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
 await page.evaluate(()=>window.elementsFixture.append());
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await body.evaluate(el=>el.scrollTop),0,'streamed text does not interrupt reading earlier lines');
 await page.evaluate(()=>window.elementsFixture.finish());
 assert.notEqual(await details.getAttribute('open'),null,'manual expansion survives completion');
 assert.equal(await details.evaluate(el=>el.parentElement.classList.contains('openide-chat-response-parts')),true);
 await summary.click();
 assert.equal(await body.isVisible(),false);
 await fixture.locator('.openide-chat-request-image').first().focus();await page.keyboard.press('Enter');
 await fixture.locator('.openide-attach-preview').first().click();
 assert.equal(await page.evaluate(()=>window.elementsFixture.opened.length),2,'both attachment surfaces open previews');
 assert.equal(await fixture.locator('.openide-attach-name').first().textContent(),'chat-reference.png');
 await fixture.screenshot({path:path.join(output,'completed-dark.png')});
 await fixture.evaluate(el=>el.style.width='320px');
 assert.ok(await fixture.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'narrow transcript has no horizontal overflow');
 assert.ok(await fixture.locator('.openide-attach-chip').last().evaluate(el=>el.getBoundingClientRect().right<=el.parentElement.getBoundingClientRect().right+1));
 await fixture.screenshot({path:path.join(output,'completed-narrow.png')});
 await fixture.locator('.openide-attach-remove').first().focus();await page.keyboard.press('Enter');
 assert.equal(await fixture.locator('.openide-attach-chip').count(),1);
 assert.equal(await fixture.locator('.openide-attach-remove').evaluate(el=>el===document.activeElement),true);
 await fixture.evaluate(el=>el.style.width='640px');
 await page.evaluate(()=>window.elementsFixture.theme('Default Light Modern'));
 await fixture.screenshot({path:path.join(output,'completed-light.png')});
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await details.locator('.openide-chat-reasoning-chevron').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await page.evaluate(()=>window.elementsFixture.waiting());
 assert.equal(await fixture.locator('.openide-chat-tool-activity').isVisible(),true,'pending question does not hide parallel work');
 await page.evaluate(()=>window.elementsFixture.indicatorOff());
 assert.equal(await fixture.locator('.openide-chat-tool-activity').isVisible(),true,'disabling the status indicator does not hide live work');
 await page.evaluate(()=>window.elementsFixture.compact());
 const compaction=fixture.locator('.openide-chat-compaction-card');
 assert.equal(await compaction.getAttribute('role'),'status');
 assert.equal(await fixture.locator('.openide-chat-compaction-running:visible').count(),1);
 assert.equal(await fixture.locator('.openide-chat-response-working:visible').count(),0);
 await fixture.screenshot({path:path.join(output,'compaction-live-light.png')});
 await compaction.evaluate(el=>el.dataset.identity='retained');
 await page.evaluate(()=>window.elementsFixture.compact('completed'));
 assert.equal(await compaction.getAttribute('data-identity'),'retained');
 assert.ok((await compaction.textContent()).includes('85%'));
 assert.equal(await compaction.locator('.openide-chat-shimmer').count(),0);
 await page.evaluate(()=>window.elementsFixture.theme('Default Dark Modern'));
 await page.evaluate(()=>window.elementsFixture.subagent());
 const worker=fixture.locator('.openide-chat-sub');
 await worker.evaluate(el=>{const group=el.closest('details');group.open=true;group.dispatchEvent(new Event('toggle'));});
 await worker.locator('.openide-chat-sub-chevron').click();
 assert.equal(await worker.locator('.openide-chat-sub-tail > *').count(),6);
 const allDetails=worker.locator('details');
 for(const detail of await allDetails.all()) {await detail.evaluate(el=>el.open=true);}
 assert.ok((await worker.textContent()).includes('+white-space: pre-wrap;'));
 await fixture.screenshot({path:path.join(output,'subagent-history-dark.png')});
 await fixture.evaluate(el=>el.style.width='320px');
 assert.ok(await fixture.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'full subagent history fits narrow chat');
 await fixture.screenshot({path:path.join(output,'subagent-history-narrow.png')});
 await fixture.evaluate(el=>{el.style.width='640px';el.scrollTop=0;});
 await page.evaluate(()=>window.elementsFixture.authoring('skill_save','{"name":"design", "content":"PARTIAL_PRIVATE'));
 const status=fixture.locator('.openide-chat-response-working');
 await status.waitFor({state:'visible'});
 assert.match(await status.textContent(),/Saving skill.*design/);
 await page.evaluate(()=>window.elementsFixture.authoring('skill_save','{"name":"design", "content":"PRIVATE_BODY"}','success'));
 const saved=fixture.locator('.openide-chat-tool-authoring');
 await saved.evaluate(el=>{const group=el.closest('details');if(group){group.open=true;group.dispatchEvent(new Event('toggle'));}});
 assert.match(await saved.locator('.openide-chat-part-head').textContent(),/Saved skill.*design/);
 assert.equal(await saved.locator('.openide-chat-shimmer').count(),0);
 assert.ok(!(await saved.locator('.openide-chat-part-head').textContent()).includes('PRIVATE_BODY'));
 await page.evaluate(()=>window.elementsFixture.authoringOverview());
 for(const group of await fixture.locator('details.openide-chat-work-group').all()){await group.evaluate(el=>{el.open=true;el.dispatchEvent(new Event('toggle'));});}
 const toolLabels=await fixture.locator('.openide-chat-part-head').allTextContents();
 assert.ok(toolLabels.some(label=>label.includes('Loaded skill')));
 assert.ok(toolLabels.some(label=>label.includes('Could not save rule')));
 assert.ok(toolLabels.some(label=>label.includes('Updating memory cancelled')));
 assert.ok(toolLabels.some(label=>label.includes('Saved hooks')));
 assert.ok(toolLabels.some(label=>label.includes('Ran MCP tool')&&label.includes('mcp_docs_search')));
 assert.ok(toolLabels.every(label=>!label.includes('PRIVATE_')));
 await fixture.screenshot({path:path.join(output,'authoring-dark.png')});
 await fixture.evaluate(el=>el.style.width='320px');
 assert.ok(await fixture.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'authoring labels fit a narrow chat');
 await fixture.screenshot({path:path.join(output,'authoring-narrow.png')});
 await page.evaluate(()=>window.elementsFixture.theme('Default Light Modern'));
 await fixture.screenshot({path:path.join(output,'authoring-light.png')});
 await fixture.evaluate(el=>el.style.width='640px');
 await page.evaluate(()=>window.elementsFixture.protectedApproval('allow-rule'));
 const approval=fixture.locator('.openide-chat-approval');
 assert.equal(await approval.locator('.openide-chat-approval-scope-trigger').count(),0);
 assert.match(await approval.locator('.openide-chat-approval-scope-fixed').textContent(),/Once|Only this/i);
 assert.deepEqual(await approval.locator('button').allTextContents(),['Deny','Allow']);
 await fixture.screenshot({path:path.join(output,'protected-approval-light.png')});
 await approval.getByRole('button',{name:'Allow',exact:true}).click();
 assert.match(await approval.locator('.openide-chat-approval-status').textContent(),/Allowed/);
 await page.evaluate(()=>window.elementsFixture.protectedApproval('deny-rule'));
 await approval.getByRole('button',{name:'Deny',exact:true}).click();
 assert.match(await approval.locator('.openide-chat-approval-status').textContent(),/Denied/);
 await page.evaluate(()=>window.elementsFixture.dispose());
 console.log(JSON.stringify({stableReasoning:true,manualDisclosure:true,readingScrollPreserved:true,chronologicalOrder:true,keyboardPreviews:true,attachmentNames:true,narrowLayout:true,lightAndDark:true,reducedMotion:true,pendingWorkVisible:true,authoringStreaming:true,protectedOperationApproval:true}));
} finally { if(app) { await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())); await app.close(); } fs.rmSync(tmp,{recursive:true,force:true}); }
