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
suite('OpenIDE — qué tools ve un agente externo', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('la familia browser sí: es lo que el CLI no tiene', () => {
		assert.ok(isExposedToExternalAgents('browser_navigate'));
		assert.ok(isExposedToExternalAgents('browser_screenshot'));
		assert.ok(isExposedToExternalAgents('browser_playwright'));
	});

	test('escribir archivos y correr comandos NUNCA', () => {
		// A tool that crosses this door does NOT go through openideApproval.ts: the only brake is
		// the CLI's own prompt. For disk and shell that is not enough.
		for (const blocked of ['write_file', 'edit_file', 'delete_file', 'rename_file', 'run_command', 'terminal_send']) {
			assert.equal(isExposedToExternalAgents(blocked), false, blocked);
		}
	});

	test('los servers MCP de terceros no se re-proxean', () => {
		assert.equal(isExposedToExternalAgents('mcp_github_create_issue'), false);
	});

	test('lo que el CLI ya trae queda afuera aunque sea inofensivo', () => {
		// Not danger, budget: every duplicate spends prompt the agent could have used on something
		// only OpenIDE knows how to do.
		for (const redundant of ['read_file', 'list_files', 'search_text', 'find_files', 'get_diagnostics']) {
			assert.equal(isExposedToExternalAgents(redundant), false, redundant);
		}
	});

	test('las tools que piden algo al usuario no se exponen', () => {
		assert.equal(isExposedToExternalAgents('ask_user'), false);
		assert.equal(isExposedToExternalAgents('update_todos'), false);
	});

	test('el namespace evita chocar con una tool de compatibilidad', () => {
		assert.equal(externalToolName('browser_navigate'), 'openide_browser_navigate');
		assert.equal(internalToolName('openide_browser_navigate'), 'browser_navigate');
		assert.equal(internalToolName('openFile'), undefined);
		assert.ok(OPENIDE_EXTERNAL_TOOL_PREFIX.endsWith('_'));
	});

	test('project_map_query y plan_save sí, uno por capacidad y otro por superficie', () => {
		assert.ok(isExposedToExternalAgents('project_map_query'));
		assert.ok(isExposedToExternalAgents('plan_save'));
	});

	test('plan_save es la única que bloquea', () => {
		// Blocking means main has to hold the JSON-RPC id open for a long time and — this is the
		// part that matters — resolve it anyway if the window closes first.
		assert.ok(isBlockingExternalTool('plan_save'));
		assert.equal(isBlockingExternalTool('project_map_query'), false);
		assert.equal(isBlockingExternalTool('browser_click'), false);
	});

	test('un agente externo lee POR QUÉ usar nuestro browser y no el suyo', () => {
		// Without this, a CLI that can already start Playwright has no reason to pick ours and will
		// open a headless one, which renders a page the user is not looking at.
		const original = 'Hace click con Playwright en la vista previa nativa.';
		const external = externalToolDescription('browser_click', original);
		assert.ok(external.endsWith(original));
		assert.ok(external.length > original.length);
		assert.ok(/ABIERTO|usuario/.test(external));
	});

	test('plan_save avisa que bloquea y que vuelve editado', () => {
		const external = externalToolDescription('plan_save', 'Guarda el plan.');
		assert.ok(/BLOQUEANTE/.test(external));
		assert.ok(/DESPUÉS de sus ediciones/.test(external));
	});

	test('una tool sin contexto extra queda igual', () => {
		assert.equal(externalToolDescription('read_file', 'Lee un archivo.'), 'Lee un archivo.');
	});

	test('la memoria de PROYECTO se abre; la global del usuario no', () => {
		// The project target is shared knowledge about this repo, which is exactly the point. The
		// global one is a personal preferences file with nothing to do with this workspace: the blast
		// radius is the user's entire setup and the benefit is zero.
		assert.ok(isExposedToExternalAgents('memory'));
		assert.deepEqual(constrainExternalToolArgs('memory', { target: 'user', action: 'add', content: 'x' }),
			{ target: 'project', action: 'add', content: 'x' });
		assert.deepEqual(constrainExternalToolArgs('memory', { action: 'remove' }), { target: 'project', action: 'remove' });
	});

	test('constrain no toca los argumentos de otras tools', () => {
		const args = { selector: '#login', target: 'user' };
		assert.deepEqual(constrainExternalToolArgs('browser_click', args), args);
	});

	test('la memoria compartida le dice al agente que la MANTENGA, no solo que la lea', () => {
		// It is the whole reason for exposing it: models do not write memory on their own, so the
		// behaviour is bought in the description or it is not bought at all.
		const external = externalToolDescription('memory', 'Memoria persistente.');
		assert.ok(/MEMORY\.md/.test(external));
		assert.ok(/otros CLI|harness/.test(external));
		assert.ok(/openide_memory_read/.test(external));
	});

	test('el viaje de ida y vuelta del nombre es fiel', () => {
		for (const name of ['browser_click', 'browser_read_dom']) {
			assert.equal(internalToolName(externalToolName(name)), name);
		}
	});
});
