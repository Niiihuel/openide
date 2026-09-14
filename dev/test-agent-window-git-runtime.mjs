// Copyright (c) OpenIDE. Licensed under the MIT License.
// All Git mutations target an isolated temporary repository. Never use the user's checkout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-git-'));
const workspace = path.join(tmp, 'workspace'), output = path.join(root, '.build/agent-window-git-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true }); fs.mkdirSync(workspace); fs.mkdirSync(output, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' }).trim();
git('init', '-b', 'main'); git('config', 'user.name', 'Agent Window Test'); git('config', 'user.email', 'agent-window-test@example.invalid');
fs.writeFileSync(path.join(workspace, 'current.ts'), 'export const value = 1;\n'); for(let i=0;i<8;i++) fs.writeFileSync(path.join(workspace,`scroll-${i}.ts`),Array.from({length:80},(_,n)=>`export const value${n} = ${n};`).join('\n')); git('add', '.'); git('commit', '-m', 'Base fixture'); git('branch', 'base');
fs.writeFileSync(path.join(workspace, 'current.ts'), 'export const value = 2;\n'); for(let i=0;i<8;i++) fs.appendFileSync(path.join(workspace,`scroll-${i}.ts`),'\nexport const changed = true;\n'); git('add', '.'); git('commit', '-m', 'Current fixture');
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom', 'git.enabled': true, 'git.autofetch': false, 'git.confirmSync': false }));
let app; const errors = [];
try {
 app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', workspace, '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
 const ide = await app.firstWindow(); ide.on('pageerror', error => { errors.push(error.message); console.error(error); });
 await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
 await ide.evaluate(async ({ base, workspace }) => {
  const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
  const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
  const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
  const { IAuxiliaryWindowService } = await import(base + 'workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.js');
  const { CancellationToken } = await import(base + 'base/common/cancellation.js');
  const { ITextModelService } = await import(base + 'editor/common/services/resolverService.js');
  const { collectAgentWindowSCMComparisons, resolveAgentWindowChangeStats, sumAgentWindowChangeStats } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentWindowChangeStats.js');
  const { ISCMService } = await import(base + 'workbench/contrib/scm/common/scm.js');
  const { OpenideAgentWindowEditors } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentWindowEditors.js');
  const { OpenideAgentWindowGit } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentWindowGit.js');
  registerAction2(class extends Action2 {
   constructor() { super({ id: 'test.agentGit', title: 'Agent Git Fixture', f1: true }); }
   async run(accessor) {
    const instantiation = accessor.get(IInstantiationService), windows = accessor.get(IAuxiliaryWindowService), scm = accessor.get(ISCMService), commands = accessor.get(ICommandService), models = accessor.get(ITextModelService);
    const repo = () => [...scm.repositories].find(repository => repository.provider.rootUri?.path === workspace);
    let helper, host;
    window.agentGitFixture = {
     stats: async () => { const comparisons=collectAgentWindowSCMComparisons(repo().provider.groups); const entries=await Promise.all(comparisons.map(comparison=>resolveAgentWindowChangeStats(comparison,models,CancellationToken.None))); return { files:comparisons.length,entries,total:sumAgentWindowChangeStats(entries.map(entry=>entry??{})) }; },
     state: () => ({ ready: !!repo()?.provider.historyProvider.get(), branch: repo()?.provider.historyProvider.get()?.historyItemRef.get()?.name, staged: repo()?.provider.groups.find(group => group.id === 'index')?.resources.length ?? 0, unstaged: repo()?.provider.groups.filter(group => ['workingTree', 'untracked'].includes(group.id)).reduce((sum, group) => sum + group.resources.length, 0), draft: repo()?.input.value }),
     open: async () => { const aux = await windows.open({ bounds: { width: 1050, height: 760 }, nativeTitlebar: true }); await aux.whenStylesHaveLoaded; host = instantiation.createInstance(OpenideAgentWindowEditors, aux.window.vscodeWindowId); helper = instantiation.createInstance(OpenideAgentWindowGit, aux.container, { getRepository: repo, openComparison: input => host.openEditor(input) }); aux.onUnload(() => { helper.dispose(); host.dispose(); }); },
     branches: () => helper.showBranches(), compare: () => helper.showCompare(), commit: () => helper.showCommit(), close: () => host.close(), refresh: () => commands.executeCommand('git.refresh', repo().provider.rootUri),
    };
   }
  });
 }, { base: `vscode-file://vscode-app${root}/vscode/out/vs/`, workspace });
 await ide.keyboard.press('Control+Shift+KeyP'); await ide.locator('.quick-input-widget input').first().fill('>Agent Git Fixture'); await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Agent Git Fixture' }).first().waitFor(); await ide.keyboard.press('Enter');
 await ide.waitForFunction(() => window.agentGitFixture?.state().ready, { timeout: 90000 }); console.log('Native Git ready');
 const opened = app.waitForEvent('window'); await ide.evaluate(() => window.agentGitFixture.open()); const agent = await opened; agent.on('pageerror', error => errors.push(error.message));
 const pick = label => agent.locator('.quick-input-list .monaco-list-row').filter({ hasText: label }).first();
 await ide.evaluate(() => window.agentGitFixture.branches()); await pick('base').waitFor(); assert.equal(await agent.locator('.quick-input-backdrop').count(),1); await agent.screenshot({ path: path.join(output, 'branches.png') }); await pick('base').click(); await ide.waitForFunction(() => window.agentGitFixture.state().branch === 'base'); assert.equal(git('branch', '--show-current'), 'base');
 await ide.evaluate(() => window.agentGitFixture.branches()); await pick('main').click(); await ide.waitForFunction(() => window.agentGitFixture.state().branch === 'main'); assert.equal(git('branch', '--show-current'), 'main'); console.log('Native branch checkout passed');
 await ide.evaluate(() => window.agentGitFixture.compare()); await agent.locator('.openide-agent-git-ref').filter({hasText:'base'}).first().click(); await agent.screenshot({path:path.join(output,'compare-form.png')}); await agent.getByRole('button',{name:'Review differences',exact:true}).click(); await agent.locator('.multiDiffEditor').first().waitFor(); await agent.locator('.monaco-diff-editor').first().waitFor(); assert.equal(await ide.locator('.monaco-modal-editor-block').count(), 0); const scroll=agent.locator('.multiDiffEditor > div > .monaco-scrollable-element > .scrollbar.vertical');
 const header=agent.locator('.multiDiffEditor .header-content').first();
 const action=header.locator('.actions .action-label.codicon').first();
 await action.hover();
 const headerVisual=await header.evaluate(el=>{
  const action=el.querySelector('.actions .action-label.codicon'), collapse=el.querySelector('.collapse-button a');
  const a=action.getBoundingClientRect(),c=collapse.getBoundingClientRect();
  return { height:parseFloat(getComputedStyle(el).height), actionWidth:parseFloat(getComputedStyle(action).width), actionHeight:parseFloat(getComputedStyle(action).height), sameCenter:Math.abs((a.top+a.height/2)-(c.top+c.height/2))<1, hit:action.contains(document.elementFromPoint(a.left+a.width/2,a.top+a.height/2)), background:getComputedStyle(el).backgroundColor, surface:getComputedStyle(el).getPropertyValue('--oi-surface').trim() };
 });
 assert.deepEqual({height:headerVisual.height,actionWidth:headerVisual.actionWidth,actionHeight:headerVisual.actionHeight,sameCenter:headerVisual.sameCenter,hit:headerVisual.hit},{height:40,actionWidth:24,actionHeight:24,sameCenter:true,hit:true},'comparison header preserves virtual geometry and centered local action hover');
 const surfaceColor=await header.evaluate(el=>{const probe=el.cloneNode(false);probe.style.backgroundColor='var(--oi-surface, var(--vscode-editor-background))';el.appendChild(probe);const color=getComputedStyle(probe).backgroundColor;probe.remove();return color;});
 assert.equal(headerVisual.background,surfaceColor,'comparison reuses the Changes surface token');
 const collapse=header.locator('.collapse-button a');
 await collapse.click();
 await agent.waitForFunction(()=>document.querySelector('.multiDiffEditor .header').classList.contains('collapsed'));
 await collapse.click();
 await agent.waitForFunction(()=>!document.querySelector('.multiDiffEditor .header').classList.contains('collapsed'));
 await action.hover();
 await agent.screenshot({path:path.join(output,'comparison-header-hover.png')});
 const sb=await scroll.boundingBox(); await agent.mouse.move(sb.x+sb.width/2,sb.y+10); await agent.waitForTimeout(200);
 assert.equal(await scroll.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.right-4,r.top+15));}),true,'sticky file headers must not intercept the scrollbar');
 const thumb=await scroll.locator('.slider').boundingBox();
 await agent.mouse.move(thumb.x+thumb.width/2,thumb.y+thumb.height/2); await agent.mouse.down(); await agent.mouse.move(thumb.x+thumb.width/2,sb.y+sb.height-10,{steps:12}); await agent.mouse.up();
 await agent.waitForFunction(()=>{const el=document.querySelector('.multiDiffEditor > div > .monaco-scrollable-element > .scrollbar.vertical > .slider');return el.getBoundingClientRect().top>el.parentElement.getBoundingClientRect().top+1;});
 await agent.screenshot({ path: path.join(output, 'comparison.png') }); await ide.evaluate(() => window.agentGitFixture.close()); console.log('Native branch comparison passed');
 fs.writeFileSync(path.join(workspace, 'current.ts'), 'export const value = 3;\n'); git('add', 'current.ts'); fs.writeFileSync(path.join(workspace, 'unstaged.txt'), 'Keep this untracked.\n');
 await ide.evaluate(() => window.agentGitFixture.refresh()); await ide.waitForFunction(() => window.agentGitFixture.state().staged === 1 && window.agentGitFixture.state().unstaged === 1);
 assert.deepEqual(await ide.evaluate(() => window.agentGitFixture.stats()), { files:2, entries:[{added:1,removed:1},{added:1,removed:0}], total:{added:2,removed:1} });
 fs.writeFileSync(path.join(workspace,'current.ts'),'export const value = 4;\nexport const extra = true;\n');
 await ide.evaluate(() => window.agentGitFixture.refresh()); await ide.waitForFunction(() => window.agentGitFixture.state().unstaged === 2);
 const combined=await ide.evaluate(() => window.agentGitFixture.stats()); assert.equal(combined.files,2); assert.deepEqual(combined.total,{added:3,removed:1},'staged and working edits compose once');
 fs.writeFileSync(path.join(workspace,'current.ts'),'export const value = 3;\n'); await ide.evaluate(() => window.agentGitFixture.refresh()); await ide.waitForFunction(() => window.agentGitFixture.state().unstaged === 1);
 await ide.evaluate(() => window.agentGitFixture.commit()); await agent.locator('.openide-agent-git-message').waitFor(); await agent.locator('.openide-agent-git-message').fill('Agent native staged commit'); assert.match(await agent.locator('.quick-input-backdrop').evaluate(el=>getComputedStyle(el).backdropFilter),/blur/); assert.ok(await agent.locator('.openide-agent-git-message').evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth))>0); await agent.locator('.openide-agent-git-include-label').hover(); assert.equal(await agent.locator('.openide-agent-git-include-label').evaluate(el=>getComputedStyle(el).paddingLeft),'8px'); await agent.screenshot({ path: path.join(output, 'commit.png') });
 const box=await agent.locator('.openide-agent-git-form').boundingBox(); const viewport=await agent.evaluate(()=>({width:innerWidth,height:innerHeight})); assert.ok(box.x>=0 && box.x+box.width<=viewport.width+1 && box.y+box.height<=viewport.height+1,JSON.stringify({box,viewport}));
 for (const width of [720,460]) { await agent.setViewportSize({width,height:700}); await agent.waitForTimeout(100); const bounds=await agent.locator('.openide-agent-git-form').boundingBox(); const viewport=await agent.evaluate(()=>({width:innerWidth,height:innerHeight})); assert.ok(bounds.x>=0 && bounds.x+bounds.width<=viewport.width+1 && bounds.y+bounds.height<=viewport.height+1,JSON.stringify({bounds,viewport})); await agent.screenshot({path:path.join(output,`commit-${width}.png`)}); }
 await agent.setViewportSize({width:1050,height:760});
 await agent.keyboard.press('Escape'); await agent.locator('.openide-agent-git-form').waitFor({state:'hidden'}); await ide.evaluate(()=>window.agentGitFixture.commit()); assert.equal(await agent.locator('textarea.openide-agent-git-message').inputValue(),'Agent native staged commit');
 await agent.locator('[data-action=commit]').click();
 await ide.waitForFunction(() => window.agentGitFixture.state().staged === 0 && window.agentGitFixture.state().draft === ''); assert.equal(git('log', '-1', '--format=%s'), 'Agent native staged commit'); assert.equal(git('status', '--porcelain'), '?? unstaged.txt');

 const remote=path.join(tmp,'remote.git'); execFileSync('git',['init','--bare',remote]); git('remote','add','origin',remote); git('push','-u','origin','main');
 await ide.evaluate(() => window.agentGitFixture.refresh());
 await ide.evaluate(() => window.agentGitFixture.commit());
 await agent.locator('.openide-agent-git-message').fill('Include remaining changes and push');
 assert.equal(await agent.getByRole('checkbox',{name:'Include unstaged changes'}).getAttribute('aria-checked'),'true');
 await agent.locator('[data-action=commitPush]').click();
 await agent.locator('.openide-agent-git-form').waitFor({state:'hidden'});
 assert.equal(git('log','-1','--format=%s'),'Include remaining changes and push');
 assert.equal(git('status','--porcelain'),'');
 assert.equal(execFileSync('git',['--git-dir',remote,'rev-parse','refs/heads/main'],{encoding:'utf8'}).trim(),git('rev-parse','HEAD'),'commit and push updates only the isolated local remote');
 assert.deepEqual(errors, []); const result = { realNativeGitExtension: true, accurateLineTotals:true, stagedWorkingDeduplicated:true, localBranchCheckout: true, nativeAuxiliaryBranchComparison: true, nativeCommitForm: true, sharedSCMDraft: true, stagedOnlyCommit: true, commitAndPush:true, unstagedPreserved: true, userRepositoryUntouched: true }; fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { if (app) { await app.close(); } fs.rmSync(tmp, { recursive: true, force: true }); }
