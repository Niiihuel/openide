/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isHardlineDeniedCommand, isSensitiveToolPath, toolApprovalAllowKey } from '../../common/openideApprovalPolicy.js';
import { isSlashVisibleCapability, IToolApprovalRequest } from '../../common/openideAgentTypes.js';
import { buildCompactionTranscript, buildStructuredSummaryMessage, compactionSavingsRatio, planContextCompaction, shouldCompactContext } from '../../common/openideContextCompaction.js';
import { classifyProviderError } from '../../common/openideErrorClassifier.js';
import { fallbackStepKey, parseFallbackChain, parseProviderModelTarget } from '../../common/openideFallback.js';
import { normalizeModelForProvider } from '../../common/openideModelNormalize.js';
import { openAIReasoningBody } from '../../common/openideReasoning.js';
import { getReasoningStaleTimeoutFloor, resolveStreamStaleTimeoutSeconds } from '../../common/openideReasoningTimeouts.js';
import { OpenideRunSequencer } from '../../common/openideRunSequencer.js';
import { DEFAULT_AGENT_ITERATIONS, isOutputLimitStopReason, resolveAgentIterationLimit } from '../../common/openideRunLimits.js';
import { OpenideToolCallGuard, repairToolArgumentsJson, validateToolArguments } from '../../common/openideToolGuardrails.js';
import { breakdownTotal, computeContextBreakdown, estimateConversationTokens, estimateMessageTokens, estimateTextTokens, estimateToolsTokens } from '../../common/openideTokens.js';
import { getOpenideChatHtml } from '../../browser/openideChatHtml.js';
import { getOpenideCanvasHtml } from '../../browser/openideCanvasHtml.js';

suite('OpenIDE agent common', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('classifies provider errors and caps retry delays', () => {
		assert.deepStrictEqual(classifyProviderError('HTTP 401 unauthorized').kind, 'auth');
		assert.deepStrictEqual(classifyProviderError('HTTP 402 payment required').kind, 'billing');
		assert.deepStrictEqual(classifyProviderError('HTTP 503 internal server error').kind, 'transient');
		assert.deepStrictEqual(classifyProviderError('connection refused').kind, 'fatal');
		assert.strictEqual(classifyProviderError('HTTP 429; retry after 10 minutes').retryAfterMs, 120_000);
		assert.strictEqual(classifyProviderError('maximum context length exceeded').shouldCompact, true);
		assert.strictEqual(classifyProviderError('HTTP 429: service temporarily overloaded').reason, 'overloaded');
		assert.strictEqual(classifyProviderError('This model does not support image input').shouldDropImages, true);
		assert.strictEqual(classifyProviderError('HTTP 404: Requested entity was not found.', { status: 404, providerId: 'antigravity-oauth', model: 'gemini-old', stage: 'streamGenerateContent' }).reason, 'model-not-found');
		assert.strictEqual(classifyProviderError('HTTP 404: project does not exist', { status: 404, stage: 'loadCodeAssist' }).reason, 'project-not-found');
		assert.strictEqual(classifyProviderError('HTTP 404: model retired', { status: 404, model: 'old' }).reason, 'model-retired');
	});

	test('keeps operational tools out of slash while preserving explicit context', () => {
		assert.strictEqual(isSlashVisibleCapability('skill'), true);
		assert.strictEqual(isSlashVisibleCapability('command'), true);
		assert.strictEqual(isSlashVisibleCapability('tool'), false);
		assert.strictEqual(isSlashVisibleCapability('mcp'), false);
	});

	test('canvas html exposes wireframe and choice primitives without neon strokes', () => {
		const html = getOpenideCanvasHtml('test-nonce', 'OpenideCanvas.mount(function(){return null});', [], {});
		assert.match(html, /\.oc-wireframe\b/);
		assert.match(html, /\.oc-wireframe-box\b/);
		assert.match(html, /\.oc-wireframe-line\b/);
		assert.match(html, /\.oc-wireframe-text\b/);
		assert.match(html, /\.oc-choice\b/);
		assert.match(html, /Wireframe:Wireframe/);
		assert.match(html, /Choice:Choice/);
		assert.match(html, /type:'canvasChoice'/);
		// neutral palette: stroke variables derivan del foreground, no de textLink (neón/morado)
		assert.doesNotMatch(html, /stroke:\s*theme\.accent\.primary/);
		// CSP endurecido: base-uri/form-action/frame-ancestors bloqueados
		assert.match(html, /base-uri 'none'/);
		assert.match(html, /form-action 'none'/);
	});

	test('emits syntactically valid chat webview JavaScript', () => {
		const html = getOpenideChatHtml('test-nonce', '');
		const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
		assert.strictEqual(scripts.length, 1);
		assert.doesNotThrow(() => new Function(scripts[0]));
		assert.match(html, /function handleTodoUpdate\(items\)/);
		assert.match(html, /appendTodoUpdate\(lastTodos\)/);
		assert.match(html, /\.turn-todos\s*\{[\s\S]*?width: calc\(100% - 20px\)/);
		assert.match(html, /id="capabilityStrip"/);
		assert.match(html, /function composerPayload\(inputText, capabilities, links\)/);
		assert.match(html, /capability\.kind === 'mcp'/); // transcripts históricos conservan chips MCP
		assert.match(html, /\.tool-activity/);
		                assert.match(html, /className = 'part tool-activity/);
		                assert.doesNotMatch(html, /kindBadge\.textContent = visualKind\.label/);
		                // Aprobaciones concedidas no dejan card "Write file · TOOL · permitido":
		                                // la edit-card/tool-activity con shimmer es la representación canónica.
		                                assert.doesNotMatch(html, /decision-row/);
		                                assert.doesNotMatch(html, /DECISION_LABEL/);
		                                assert.doesNotMatch(html, /'permitido'/);
		                                assert.match(html, /function addDecisionRow\(name, decision\)/);
		                                assert.match(html, /if \(decision !== 'deny'\) \{ return; \}/);
		                                assert.match(html, /className = 'decision-line deny'/);
		                assert.match(html, /if \(name === 'run_command'\)/);
		                assert.match(html, /if \(isEdit\)/);
		assert.match(html, /name === 'delegate_task' \|\| name === 'review_changes'/);
		assert.match(html, /before\.match\(\/\(\^\|\\s\)\\\/\(/);
		assert.match(html, /openide-marquee[\s\S]*?infinite alternate/);
		assert.match(html, /type: 'rollback', requestId: requestId, messageId:/);
		assert.match(html, /case 'rollbackCommitted':/);
		assert.match(html, /restoreThread\(m\.messages \|\| \[\]\);[\s\S]*hydrateRollbackComposer/);
		assert.doesNotMatch(html, /case 'rollbackComposer':/);
		assert.doesNotMatch(html, /promptEl\.value = bodyText; selectedCapabilities/);
		assert.match(html, /type: 'editAndResend', messageId:/);
		// Cambios de modo y aprobación de planes son flags operativas: jamás agregan otro user bubble.
		const suggestStart = html.indexOf("function renderSuggestMode(m)");
		const suggestEnd = html.indexOf('// ---- composer ----', suggestStart);
		assert.doesNotMatch(html.slice(suggestStart, suggestEnd), /dispatchSend\(/);
		const planBuildStart = html.indexOf("case 'planBuildStart':");
		const planBuildEnd = html.indexOf("case 'resendEdited':", planBuildStart);
		assert.doesNotMatch(html.slice(planBuildStart, planBuildEnd), /dispatchSend\(/);
		assert.match(html.slice(planBuildStart, planBuildEnd), /setBusy\(true\)/);
		assert.match(html, /\['max', 'Max'\]/);
		assert.match(html, /compactSubagentTokens\(tokenTotal\) \+ ' tokens'/);
	});

	test('estimates text, tool and image context consistently', () => {
		assert.strictEqual(estimateTextTokens('12345'), 2);
		const message = { role: 'user' as const, content: 'hello', images: [{ mimeType: 'image/png', data: 'x' }] };
		assert.strictEqual(estimateConversationTokens([message]), estimateMessageTokens(message));
		const nativeTool = {
			name: 'read_file',
			description: 'Read a file',
			parameters: { type: 'object' },
		};
		const mcpTool = {
			name: 'mcp_figma_read',
			description: 'Read Figma',
			parameters: { type: 'object' },
		};
		assert.ok(estimateToolsTokens([nativeTool]) > 0);
		const breakdown = computeContextBreakdown('system', '', 'skills', [nativeTool, mcpTool], []);
		assert.strictEqual(breakdown.tools, estimateToolsTokens([nativeTool]));
		assert.strictEqual(breakdown.mcp, estimateToolsTokens([mcpTool]));
		assert.strictEqual(breakdownTotal(breakdown), Object.values(breakdown).reduce((total, value) => total + value, 0));
	});

	test('keeps approval policy fail-closed for dangerous inputs', () => {
		assert.strictEqual(isHardlineDeniedCommand('rm -rf /'), true);
		assert.strictEqual(isHardlineDeniedCommand('sudo shutdown now'), true);
		assert.strictEqual(isHardlineDeniedCommand('npm test'), false);
		assert.strictEqual(isSensitiveToolPath('/workspace/.env.local'), true);
		assert.strictEqual(isSensitiveToolPath('C:\\Users\\dev\\.ssh\\config'), true);
		assert.strictEqual(isSensitiveToolPath('/workspace/src/config.ts'), false);
	});

	test('plans compaction by token budget without orphaning tool results', () => {
		const messages = [
			{ role: 'user' as const, content: 'initial objective '.repeat(2000) },
			{ role: 'assistant' as const, content: 'working' },
			{ role: 'user' as const, content: 'next '.repeat(1000) },
			{ role: 'assistant' as const, content: '', toolCalls: [{ id: '1', name: 'read_file', argumentsJson: '{"path":"a"}' }] },
			{ role: 'tool' as const, toolCallId: '1', content: 'result '.repeat(500) },
			...Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `recent-${index} `.repeat(100) })),
		];
		const plan = planContextCompaction(messages, 20_000, { tailRatio: 0.1, minimumTailMessages: 4 });
		assert.ok(plan);
		assert.notStrictEqual(plan.tail[0].role, 'tool');
		assert.ok(buildCompactionTranscript(plan.source, 2000).length <= 2050);
		const compacted = [buildStructuredSummaryMessage('## Objetivo\nContinuar.'), ...plan.tail];
		assert.ok(compactionSavingsRatio(plan.beforeTokens, compacted) > 0);
		assert.strictEqual(shouldCompactContext(6000, 10_000, 0.6), true);
	});

	test('repairs conservative tool JSON and blocks exact loops', () => {
		assert.strictEqual(repairToolArgumentsJson('```json\n{"path":"a",}\n```'), '{"path":"a"}');
		assert.strictEqual(repairToolArgumentsJson('prefix {"path":"a"} suffix'), '{"path":"a"}');
		assert.strictEqual(repairToolArgumentsJson('{"path":'), undefined);

		const guard = new OpenideToolCallGuard();
		assert.strictEqual(guard.inspect('read_file', '{"path":"a"}').block, false);
		assert.strictEqual(guard.inspect('read_file', '{"path":"a"}').block, false);
		assert.strictEqual(guard.inspect('read_file', '{"path":"a"}').warn, true);
		assert.strictEqual(guard.inspect('read_file', '{"path":"a"}').block, true);
		assert.deepStrictEqual(validateToolArguments({
			type: 'object',
			required: ['path'],
			properties: { path: { type: 'string' }, mode: { type: 'string', enum: ['read', 'write'] } },
		}, { path: 3, mode: 'delete' }), [
			'"path" tiene un tipo inválido',
			'"mode" debe ser uno de: read, write',
		]);
	});

	test('maps reasoning effort by provider protocol quirks', () => {
		assert.deepStrictEqual(
			openAIReasoningBody('openrouter', 'https://openrouter.ai/api/v1', 'anthropic/claude-sonnet-5', 'high'),
			{ reasoning: { effort: 'high' } },
		);
		assert.deepStrictEqual(
			openAIReasoningBody('openai', 'https://api.openai.com/v1', 'gpt-5.4', 'xhigh'),
			{ reasoning_effort: 'high' },
		);
		assert.deepStrictEqual(
			openAIReasoningBody('openai', 'https://api.openai.com/v1', 'gpt-5.4', 'max'),
			{ reasoning_effort: 'high' },
		);
		assert.deepStrictEqual(
			openAIReasoningBody('openrouter', 'https://openrouter.ai/api/v1', 'anthropic/claude-sonnet-5', 'max'),
			{ reasoning: { effort: 'high' } },
		);
		assert.deepStrictEqual(
			openAIReasoningBody('openrouter', 'https://openrouter.ai/api/v1', 'anthropic/claude-sonnet-5', 'none'),
			{ reasoning: { enabled: false } },
		);
		assert.deepStrictEqual(
			openAIReasoningBody('nvidia-nim', 'https://integrate.api.nvidia.com/v1', 'deepseek-ai/deepseek-r1', 'none'),
			{ chat_template_kwargs: { enable_thinking: false } },
		);
		assert.deepStrictEqual(
			openAIReasoningBody('nvidia-nim', 'https://integrate.api.nvidia.com/v1', 'deepseek-ai/deepseek-r1', ''),
			{},
		);
	});

	test('applies stale timeout floors only to reasoning families', () => {
		assert.strictEqual(getReasoningStaleTimeoutFloor('openai/o3-mini-2025-01-31'), 300);
		assert.strictEqual(getReasoningStaleTimeoutFloor('community/llama-4-70b-o1-preview'), undefined);
		assert.strictEqual(getReasoningStaleTimeoutFloor('gpt-4o'), undefined);
		assert.strictEqual(resolveStreamStaleTimeoutSeconds('deepseek/deepseek-r1', 180, 'high'), 600);
		assert.strictEqual(resolveStreamStaleTimeoutSeconds('deepseek/deepseek-r1', 180, 'none'), 180);
	});

	test('keeps long agent runs and recognizes provider output limits', () => {
		assert.strictEqual(resolveAgentIterationLimit(undefined), DEFAULT_AGENT_ITERATIONS);
		assert.strictEqual(resolveAgentIterationLimit(10), Number.POSITIVE_INFINITY);
		assert.strictEqual(resolveAgentIterationLimit(1000), Number.POSITIVE_INFINITY);
		assert.strictEqual(isOutputLimitStopReason('length'), true);
		assert.strictEqual(isOutputLimitStopReason('max_tokens'), true);
		assert.strictEqual(isOutputLimitStopReason('MAX_OUTPUT_TOKENS'), true);
		assert.strictEqual(isOutputLimitStopReason('incomplete'), true);
		assert.strictEqual(isOutputLimitStopReason('stop'), false);
		assert.strictEqual(isOutputLimitStopReason('completed'), false);
	});

	test('normalizes model-aware fallback chains with legacy compatibility', () => {
		const chain = parseFallbackChain([
			{ providerId: 'openrouter', model: 'anthropic/claude-sonnet-5' },
			{ provider: 'groq', model: 'qwen/qwen3-32b' },
			{ providerId: 'openrouter', model: 'anthropic/claude-sonnet-5' },
		], ['ollama']);
		assert.deepStrictEqual(chain, [
			{ providerId: 'openrouter', model: 'anthropic/claude-sonnet-5' },
			{ providerId: 'groq', model: 'qwen/qwen3-32b' },
		]);
		assert.strictEqual(fallbackStepKey(chain[0]), 'openrouter\u0000anthropic/claude-sonnet-5');
		assert.deepStrictEqual(parseFallbackChain([], ['ollama']), [{ providerId: 'ollama' }]);
		assert.deepStrictEqual(parseProviderModelTarget('openrouter/google/gemini-2.5-flash'), {
			providerId: 'openrouter',
			model: 'google/gemini-2.5-flash',
		});
	});

	test('normalizes aggregator slugs only for direct providers', () => {
		assert.strictEqual(normalizeModelForProvider('anthropic/claude-sonnet-5', { id: 'anthropic' }), 'claude-sonnet-5');
		assert.strictEqual(normalizeModelForProvider('anthropic/claude-sonnet-5', { id: 'openrouter' }), 'anthropic/claude-sonnet-5');
		assert.strictEqual(normalizeModelForProvider('', { id: 'deepseek', defaultModel: 'deepseek-chat' }), 'deepseek-chat');
	});

	test('scopes terminal allowlist entries to the exact command', () => {
		const request = (command: string): IToolApprovalRequest => ({
			tool: 'run_command',
			risk: 'exec',
			title: 'Run command',
			command,
		});

		assert.strictEqual(toolApprovalAllowKey(request('npm   test')), 'exec:npm test');
		assert.notStrictEqual(
			toolApprovalAllowKey(request('sudo apt update')),
			toolApprovalAllowKey(request('sudo rm -rf ./build')),
		);
	});

	test('serializes runs and recovers after failures', async () => {
		const sequencer = new OpenideRunSequencer();
		const gate = new DeferredPromise<void>();
		const events: string[] = [];
		const first = sequencer.queue(async () => {
			events.push('first:start');
			await gate.p;
			events.push('first:end');
		});
		const second = sequencer.queue(async () => {
			events.push('second');
			throw new Error('expected');
		});
		const third = sequencer.queue(async () => {
			events.push('third');
			return 3;
		});

		await Promise.resolve();
		assert.deepStrictEqual(events, ['first:start']);
		gate.complete();
		await first;
		await assert.rejects(second, /expected/);
		assert.strictEqual(await third, 3);
		assert.deepStrictEqual(events, ['first:start', 'first:end', 'second', 'third']);
	});
});
