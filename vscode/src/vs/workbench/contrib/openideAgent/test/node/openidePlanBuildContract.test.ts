/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Build spinner switched off a few milliseconds after starting. The cause: whoever launches
 * the Build run first calls `cancelCurrentRun()` to close the previous run, and that function
 * called `failPlanBuild()` — which clears the SERVICE's state, not a local field. The previous
 * attempted fix saved and restored `this._planBuild` around the call, but that only restored
 * the field: the service had already forgotten the build, so the breadcrumb
 * went back to "Build" instantly and `finishPlanBuild` ended up a no-op (the plan never
 * llegaba a `status: completado`).
 *
 * The native migration moved the run lifecycle out of `OpenideChatView` and into
 * `OpenideChatController`, and with it the shape of the fix: there is no `cancelCurrentRun` nor a
 * `keepPlanBuild` flag any more. What replaced them is stronger — a build cannot start while
 * another run is live, and settling reports to the SERVICE exactly once — so the assertions below
 * pin THAT, which is the property the bug actually violated.
 *
 * The controller drags in half the workbench through its imports, so this is verified against the
 * source. Same approach as openideSettingsContract: it does not test runtime behaviour, it tests
 * that the shape that broke it cannot come back without someone noticing.
 */
suite('OpenIDE plan build contract', () => {

	// A static contract over the REPO: it runs from `out/` (ESM, no `__dirname`) but reads `.ts`
	// sources, so it has to map back to `src/`. Same idiom as `openideSettingsContract.test.ts`.
	const sourceDir = import.meta.dirname.replace(`${path.sep}out${path.sep}`, `${path.sep}src${path.sep}`);
	const controller = fs.readFileSync(path.join(sourceDir, '..', '..', 'browser', 'chat', 'openideChatController.ts'), 'utf8');
	const agentService = fs.readFileSync(path.join(sourceDir, '..', '..', 'browser', 'openideAgentService.ts'), 'utf8');

	test('the turn ENDS when the plan is saved: the decision is the user\'s', () => {
		// Without this cut the model received the plan_save result and kept working: it
		// started implementing without anyone pressing Build, until it hit the fact that plan mode
		// has no write tools. It looked as if the plan started by itself.
		const stop = agentService.slice(agentService.indexOf("if (call.name === 'plan_save'"));
		assert.strictEqual(stop.length > 0, true, 'the turn cut after plan_save is missing');
		const block = stop.slice(0, 420);
		assert.strictEqual(/onEvent\(\{ type: 'done', reason: 'plan-saved' \}\)/.test(block), true, 'it has to close the turn');
		assert.strictEqual(/\breturn;/.test(block), true, 'and leave the loop, not merely report');
		assert.strictEqual(block.includes("!out.startsWith('Error')"), true, 'a failed plan_save may not close the turn');
	});

	test('a Build cannot start on top of a live run', () => {
		// This is what makes the old bug structurally impossible: back then a launch cancelled the
		// previous run and that cancellation cleared the service's build state. Now a build simply
		// cannot begin while something else is running, so there is no cancellation to survive.
		const body = controller.slice(controller.indexOf('private buildPlan('), controller.indexOf('private settlePlanBuild('));
		assert.strictEqual(body.length > 0, true, 'buildPlan was not found in the controller');
		// Spelled per CONVERSATION since runs stopped belonging to whichever tab was on screen: the
		// busy flag and the pending build moved onto the conversation record. The invariant is the
		// same one, and this assert kept naming fields that no longer exist — so it failed on every
		// run and stopped saying anything about the contract it guards.
		assert.strictEqual(/if \(conversation\.busy \|\| conversation\.planBuild \|\| this\._barrier\.isActive\)/.test(body), true,
			'buildPlan has to refuse to start on top of a live run');
		// And refusing has to TELL the editor, or its Build button spins forever.
		assert.strictEqual(body.includes('this.agentService.failPlanBuild('), true,
			'refusing without telling the editor leaves the Build button spinning forever');
	});

	test('the Build state is settled in the SERVICE, and exactly once', () => {
		// The heart of the original bug: restoring a local field does not recover the service's
		// state. Settling has to go through the service, and it has to be idempotent — `launchRun`
		// settles on both edges (the promise and the failure handler) and only the first may
		// resolve the editor's pending Build.
		const body = controller.slice(controller.indexOf('private settlePlanBuild('));
		const block = body.slice(0, 520);
		assert.strictEqual(/conversation\.planBuild = undefined;/.test(block), true, 'it has to clear the state before reporting');
		assert.strictEqual(block.includes('this.agentService.failPlanBuild('), true, 'the failure is reported to the service');
		assert.strictEqual(block.includes('this.agentService.finishPlanBuild('), true, 'the success is reported to the service');
		// Clearing BEFORE reporting is what makes a second call a no-op.
		assert.strictEqual(block.indexOf('conversation.planBuild = undefined;') < block.indexOf('failPlanBuild('), true,
			'if it reports before clearing, two calls settle the Build twice');
	});

});
