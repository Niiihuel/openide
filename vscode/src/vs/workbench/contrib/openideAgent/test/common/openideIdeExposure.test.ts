/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	externalToolName,
	internalToolName,
	constrainExternalToolArgs,
	externalToolDescription,
	isBlockingExternalTool,
	isExposedToExternalAgents,
	OPENIDE_EXTERNAL_TOOL_PREFIX,
} from '../../common/openideIdeExposure.js';

/**
 * This is a security boundary, not a preference. Each test names something an external CLI must
 * or must not be able to reach through OpenIDE's MCP door.
 */
suite('OpenIDE — which tools an external agent sees', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the browser family is exposed: it is what the CLI does not have', () => {
		assert.ok(isExposedToExternalAgents('browser_navigate'));
		assert.ok(isExposedToExternalAgents('browser_screenshot'));
		assert.ok(isExposedToExternalAgents('browser_playwright'));
		// Recording a flow as video is the clearest case of "only OpenIDE can do this": the CLI's
		// own Playwright has no window on screen to record.
		assert.ok(isExposedToExternalAgents('browser_record_start'));
		assert.ok(isExposedToExternalAgents('browser_record_stop'));
	});

	test('writing files and running commands NEVER', () => {
		// A tool that crosses this door does NOT go through openideApproval.ts: the only brake is
		// the CLI's own prompt. For disk and shell that is not enough.
		for (const blocked of ['write_file', 'edit_file', 'delete_file', 'rename_file', 'run_command', 'terminal_send']) {
			assert.equal(isExposedToExternalAgents(blocked), false, blocked);
		}
	});

	test('third-party MCP servers are not re-proxied', () => {
		assert.equal(isExposedToExternalAgents('mcp_github_create_issue'), false);
	});

	test('what the CLI already ships is left out even when it is harmless', () => {
		// Not danger, budget: every duplicate spends prompt the agent could have used on something
		// only OpenIDE knows how to do.
		for (const redundant of ['read_file', 'list_files', 'search_text', 'find_files', 'get_diagnostics']) {
			assert.equal(isExposedToExternalAgents(redundant), false, redundant);
		}
	});

	test('tools that ask the user for something are not exposed', () => {
		assert.equal(isExposedToExternalAgents('ask_user'), false);
		assert.equal(isExposedToExternalAgents('update_todos'), false);
	});

	test('the namespace avoids clashing with a compatibility tool', () => {
		assert.equal(externalToolName('browser_navigate'), 'openide_browser_navigate');
		assert.equal(internalToolName('openide_browser_navigate'), 'browser_navigate');
		assert.equal(internalToolName('openFile'), undefined);
		assert.ok(OPENIDE_EXTERNAL_TOOL_PREFIX.endsWith('_'));
	});

	test('project_map_query and plan_save are exposed, one for its capability and one for its surface', () => {
		assert.ok(isExposedToExternalAgents('project_map_query'));
		assert.ok(isExposedToExternalAgents('plan_save'));
	});

	test('plan_save is the only blocking one', () => {
		// Blocking means main has to hold the JSON-RPC id open for a long time and — this is the
		// part that matters — resolve it anyway if the window closes first.
		assert.ok(isBlockingExternalTool('plan_save'));
		assert.equal(isBlockingExternalTool('project_map_query'), false);
		assert.equal(isBlockingExternalTool('browser_click'), false);
	});

	test('an external agent reads WHY it should use our browser and not its own', () => {
		// Without this, a CLI that can already start Playwright has no reason to pick ours and will
		// open a headless one, which renders a page the user is not looking at.
		const original = 'Hace click con Playwright en la vista previa nativa.';
		const external = externalToolDescription('browser_click', original);
		assert.ok(external.endsWith(original));
		assert.ok(external.length > original.length);
		assert.ok(/OPEN inside OpenIDE|the user is actually looking at/.test(external));
	});

	test('the recorder tells an external agent it MEASURES, not just that it records', () => {
		// A CLI has no recorder of its own, so it has no prior for what one returns. Left as "records
		// video" it would take the tape and squint at it; the findings are the reason it is better
		// than a screenshot, and an agent only uses what the description promises.
		const external = externalToolDescription('browser_record_stop', 'Stops the recording.');
		assert.ok(/MEASURES/.test(external), external);
		assert.ok(/millisecond to look at/.test(external));
		assert.ok(/place to look, not a verdict/.test(external));
	});

	test('browser_check_visual says what it answers that a screenshot cannot', () => {
		const external = externalToolDescription('browser_check_visual', 'Measures the page.');
		assert.ok(/WCAG AA/.test(external), external);
		assert.ok(/ALONGSIDE browser_screenshot/.test(external));
		// It must not fall through to the generic browser blurb, which says nothing about measuring.
		assert.ok(!/not a fresh instance/.test(external));
	});

	test('plan_save warns that it blocks and that it comes back edited', () => {
		const external = externalToolDescription('plan_save', 'Guarda el plan.');
		assert.ok(/BLOCKING/.test(external));
		assert.ok(/AFTER their edits/.test(external));
	});

	test('a tool with no extra context is left unchanged', () => {
		assert.equal(externalToolDescription('read_file', 'Lee un archivo.'), 'Lee un archivo.');
	});

	test('the PROJECT memory is opened up; the user\'s global one is not', () => {
		// The project target is shared knowledge about this repo, which is exactly the point. The
		// global one is a personal preferences file with nothing to do with this workspace: the blast
		// radius is the user's entire setup and the benefit is zero.
		assert.ok(isExposedToExternalAgents('memory'));
		assert.deepEqual(constrainExternalToolArgs('memory', { target: 'user', action: 'add', content: 'x' }),
			{ target: 'project', action: 'add', content: 'x' });
		assert.deepEqual(constrainExternalToolArgs('memory', { action: 'remove' }), { target: 'project', action: 'remove' });
	});

	test('constrain does not touch other tools\' arguments', () => {
		const args = { selector: '#login', target: 'user' };
		assert.deepEqual(constrainExternalToolArgs('browser_click', args), args);
	});

	test('the shared memory tells the agent to MAINTAIN it, not just to read it', () => {
		// It is the whole reason for exposing it: models do not write memory on their own, so the
		// behaviour is bought in the description or it is not bought at all.
		const external = externalToolDescription('memory', 'Memoria persistente.');
		assert.ok(/MEMORY\.md/.test(external));
		assert.ok(/other CLIs|harness/.test(external));
		assert.ok(/openide_memory_read/.test(external));
	});

	test('the name round-trips faithfully', () => {
		for (const name of ['browser_click', 'browser_read_dom']) {
			assert.equal(internalToolName(externalToolName(name)), name);
		}
	});
});
