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
import { rewindForSilentModeTransition } from '../../common/openideModeTransition.js';
import { buildPlanFollowUpPrompt, normalizePlanFollowUpDisposition } from '../../common/openidePlanFollowUp.js';
import { OPENIDE_BUILTIN_PROVIDERS, resolveProviders } from '../../common/openideProviderCatalog.js';
import { OPENIDE_PROVIDER_BRANDS, resolveProviderBrand } from '../../common/openideProviderBranding.js';
import { isToolCallingUnsupportedError, modelIdsFromProviderResponse, providerModelCapabilityKey } from '../../common/openideProviderCapabilities.js';
import { openAIReasoningBody } from '../../common/openideReasoning.js';
import { getReasoningStaleTimeoutFloor, resolveStreamStaleTimeoutSeconds } from '../../common/openideReasoningTimeouts.js';
import { normalizeCodexUsageJson, normalizeGrokUsageJson } from '../../common/openideUsage.js';
import { OpenideRunSequencer } from '../../common/openideRunSequencer.js';
import { DEFAULT_AGENT_ITERATIONS, isOutputLimitStopReason, resolveAgentIterationLimit } from '../../common/openideRunLimits.js';
import { OpenideToolCallGuard, repairToolArgumentsJson, validateToolArguments } from '../../common/openideToolGuardrails.js';
import { breakdownTotal, computeContextBreakdown, estimateConversationTokens, estimateMessageTokens, estimateTextTokens, estimateToolsTokens } from '../../common/openideTokens.js';
import { getOpenideCanvasHtml } from '../../browser/openideCanvasHtml.js';
import { queryTerms } from '../../browser/openideCodebaseQueryService.js';
import { listableCatalogId, parseModelsDevCatalog } from '../../browser/openideModelCatalog.js';
import { formatContextTokens, formatCostPerMillion, humanizeModelId } from '../../common/openideModelDisplay.js';
import { mergeVisibleOrder, moveBeside, toggleMembership } from '../../common/openidePickerOrder.js';

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
		assert.strictEqual(classifyProviderError('This model does not support function calling').shouldDropTools, true);
	});

	test('detects tool capability errors without misclassifying invalid tool arguments', () => {
		assert.strictEqual(isToolCallingUnsupportedError('Model does not support tool calling'), true);
		assert.strictEqual(isToolCallingUnsupportedError('Unsupported parameter: tools'), true);
		assert.strictEqual(isToolCallingUnsupportedError('Invalid schema for function read_file'), false);
		assert.strictEqual(
			providerModelCapabilityKey('OpenRouter', 'https://openrouter.ai/api/v1/', 'X/Model'),
			'OpenRouter\0https://openrouter.ai/api/v1\0x/model',
		);
		assert.deepStrictEqual(modelIdsFromProviderResponse({ data: [{ id: 'b' }, { id: 'a' }] }), ['a', 'b']);
		assert.deepStrictEqual(modelIdsFromProviderResponse({ models: { 'gemini-high': {}, 'gemini-low': {} } }), ['gemini-high', 'gemini-low']);
	});

	test('keeps operational tools out of slash while preserving explicit context', () => {
		assert.strictEqual(isSlashVisibleCapability('skill'), true);
		assert.strictEqual(isSlashVisibleCapability('command'), true);
		assert.strictEqual(isSlashVisibleCapability('tool'), false);
		assert.strictEqual(isSlashVisibleCapability('mcp'), false);
	});

	test('assigns a stable visual identity to every built-in provider', () => {
		for (const provider of OPENIDE_BUILTIN_PROVIDERS) {
			assert.ok(OPENIDE_PROVIDER_BRANDS[provider.id], `Missing provider brand: ${provider.id}`);
			const brand = resolveProviderBrand(provider.id, provider.label);
			assert.ok(brand.name);
			assert.match(brand.initials, /^[A-Z0-9+]{1,2}$/);
		}
		assert.strictEqual(resolveProviderBrand('custom-openai', 'OpenAI privado').asset, 'openai.svg');
		assert.strictEqual(resolveProviderBrand('my-company', 'Acme Cloud').initials, 'AC');
	});

	test('turns explicit plan follow-up decisions into provider-neutral prompts', () => {
		assert.strictEqual(normalizePlanFollowUpDisposition('integrate'), 'integrate');
		assert.strictEqual(normalizePlanFollowUpDisposition('replace'), 'replace');
		assert.strictEqual(normalizePlanFollowUpDisposition('after'), undefined);

		const integrated = buildPlanFollowUpPrompt('Añadí pruebas de migración.', 'integrate');
		assert.match(integrated, /ACTUALIZACIÓN DEL PLAN EN CURSO/);
		assert.match(integrated, /mismo objetivo/);
		assert.match(integrated, /No guardes esta petición transitoria en la memoria duradera/);
		assert.match(integrated, /Añadí pruebas de migración\./);

		const replaced = buildPlanFollowUpPrompt('Planificá el nuevo indexador.', 'replace');
		assert.match(replaced, /REEMPLAZO DEL PLAN EN CURSO/);
		assert.match(replaced, /nuevo objetivo principal/);
		assert.match(replaced, /Planificá el nuevo indexador\./);
	});

	test('rewinds mode triage to the original user turn without creating another prompt', () => {
		const messages = [
			{ role: 'user' as const, content: 'Refactorizá el almacenamiento.', messageId: 'request', executionMode: 'agent' as const },
			{ role: 'assistant' as const, content: '', toolCalls: [{ id: 'mode', name: 'suggest_mode', argumentsJson: '{"mode":"plan"}' }] },
			{ role: 'tool' as const, content: 'Aceptado', toolCallId: 'mode' },
		];
		const user = rewindForSilentModeTransition(messages, 'plan');
		assert.strictEqual(user?.messageId, 'request');
		assert.strictEqual(user?.executionMode, 'plan');
		assert.strictEqual(messages.length, 1);
		assert.strictEqual(messages[0].role, 'user');
	});

	test('canvas html exposes wireframe and choice primitives without neon strokes', () => {
		const html = getOpenideCanvasHtml('test-nonce', 'OpenideCanvas.mount(function(){return null});', [], {});
		assert.match(html, /\.oc-wireframe\b/);
		assert.match(html, /\.oc-wireframe-box\b/);
		assert.match(html, /\.oc-wireframe-line\b/);
		assert.match(html, /\.oc-wireframe-text\b/);
		assert.match(html, /\.oc-choice\b/);
		// The global API is checked by NAME, not by the `Key:Value` shape the source had: the
		// transpiler collapses it to the shorthand (`{ Wireframe }`) and rewrites the quotes, so
		// pinning the formatting was pinning a build detail. What matters is that the primitive is
		// published on the global object the user's canvas consumes.
		const globals = /OpenideCanvas\s*=\s*\{([\s\S]*?)\}/.exec(html)?.[1] ?? '';
		assert.match(globals, /\bWireframe\b/);
		assert.match(globals, /\bChoice\b/);
		assert.match(html, /type:\s*['"]canvasChoice['"]/);
		// neutral palette: stroke variables derive from foreground, not from textLink (neon/purple)
		assert.doesNotMatch(html, /stroke:\s*theme\.accent\.primary/);
		// CSP endurecido: base-uri/form-action/frame-ancestors bloqueados
		assert.match(html, /base-uri 'none'/);
		assert.match(html, /form-action 'none'/);
	});

	test('extracts useful graph vocabulary from natural language and code identifiers', () => {
		assert.deepStrictEqual(queryTerms('Quiero revisar OpenideCodebaseGraph y auth_provider antes de editar'), ['revisar', 'openide', 'codebase', 'graph', 'auth', 'provider', 'editar']);
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
		assert.strictEqual(resolveAgentIterationLimit(10), 25);
		assert.strictEqual(resolveAgentIterationLimit(80), 80);
		assert.strictEqual(resolveAgentIterationLimit(1000), 500);
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

	test('normalizes Codex and Grok account usage windows', () => {
		const codex = normalizeCodexUsageJson({
			rate_limit: {
				primary_window: { used_percent: 17, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
				secondary_window: { used_percent: 42, limit_window_seconds: 604_800, reset_at: 1_800_604_800 },
			},
		});
		const grok = normalizeGrokUsageJson({
			config: {
				creditUsagePercent: 9,
				currentPeriod: { end: '2027-01-02T03:04:05.000Z' },
			},
		});

		assert.deepStrictEqual(codex.windows.map(window => ({ label: window.label, usedPercent: window.usedPercent, limitMinutes: window.limitMinutes })), [
			{ label: 'Session', usedPercent: 17, limitMinutes: 300 },
			{ label: 'Weekly', usedPercent: 42, limitMinutes: 10_080 },
		]);
		assert.deepStrictEqual(grok.windows.map(window => ({ label: window.label, usedPercent: window.usedPercent, resetsAt: window.resetsAt })), [
			{ label: 'Weekly', usedPercent: 9, resetsAt: Date.parse('2027-01-02T03:04:05.000Z') },
		]);
		const grokZero = normalizeGrokUsageJson({ config: {
			currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2027-01-01T00:00:00Z', end: '2027-01-08T00:00:00Z' },
			billingPeriodStart: '2027-01-01T00:00:00Z',
			billingPeriodEnd: '2027-01-08T00:00:00Z',
		} });
		assert.strictEqual(grokZero.windows[0]?.usedPercent, 0);
	});

	test('resolves models.dev entries by exact id, like opencode', () => {
		const registry = parseModelsDevCatalog({
			openai: {
				models: {
					'gpt-5.6-sol': {
						name: 'GPT-5.6 Sol',
						limit: { context: 922_000, input: 400_000, output: 128_000 },
						modalities: { input: ['text', 'image'], output: ['text'] },
						reasoning: true, tool_call: true,
						cost: { input: 0.2, output: 1.2 },
						reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }],
					},
					'gpt-4.1-2024-01-01': { limit: { context: 1_000_000 }, tool_call: true },
				},
			},
			anthropic: {
				models: {
					'claude-sonnet-4-5': {
						limit: { context: 200_000, output: 64_000 },
						reasoning: true, tool_call: true,
						reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens' }],
					},
					'claude-3-opus': { limit: { context: 200_000 }, status: 'deprecated', tool_call: true },
				},
			},
		});

		// `limit.input` is the usable prompt budget and wins over `limit.context`.
		assert.strictEqual(registry.limits('openai', 'gpt-5.6-sol').contextLimit, 400_000);
		assert.strictEqual(registry.limits('openai', 'gpt-5.6-sol').vision, true);
		// The registry is kept verbatim, so the whole entry is readable — not a compacted subset.
		assert.strictEqual(registry.model('openai', 'gpt-5.6-sol')?.name, 'GPT-5.6 Sol');
		assert.strictEqual(registry.model('openai', 'gpt-5.6-sol')?.cost?.output, 1.2);

		// Exact match only: an id the registry does not publish is a miss, never a silent
		// substitution onto a similar model's limits.
		assert.deepStrictEqual(registry.limits('anthropic', 'claude-sonnet-4-5-20250929'), {});
		assert.deepStrictEqual(registry.suggestions('anthropic', 'claude-sonnet-4-5-20250929'), ['claude-sonnet-4-5']);

		// Graded effort vs a plain on/off toggle — the picker offers one or the other.
		assert.deepStrictEqual(registry.reasoning('openai', 'gpt-5.6-sol')?.efforts, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
		assert.strictEqual(registry.reasoning('anthropic', 'claude-sonnet-4-5')?.toggle, true);
		assert.deepStrictEqual(registry.reasoning('anthropic', 'claude-sonnet-4-5')?.efforts, []);
		// A model with no reasoning_options must stay `undefined`, not an empty offer.
		assert.strictEqual(registry.reasoning('openai', 'gpt-4.1-2024-01-01'), undefined);

		// Unknown model/provider is "unknown", never "unsupported".
		assert.deepStrictEqual(registry.limits('ollama', 'llama3.2'), {});
		assert.deepStrictEqual(registry.limits('my-custom-provider', 'gemini-proxy-model'), {});
	});

	test('translates only Antigravity ids, which the registry does not publish', () => {
		const registry = parseModelsDevCatalog({
			google: { models: { 'gemini-3.1-pro': { limit: { context: 1_048_576 } }, 'gemini-3.6-flash': { limit: { context: 1_000_000 } } } },
			anthropic: { models: { 'claude-opus-4-6': { limit: { context: 200_000 } } } },
		});

		// The gateway appends the effort to the id and renames models; both must still find limits.
		assert.strictEqual(registry.limits('antigravity-oauth', 'gemini-3.6-flash-high').contextLimit, 1_000_000);
		assert.strictEqual(registry.limits('antigravity-oauth', 'gemini-pro-agent').contextLimit, 1_048_576);
		assert.strictEqual(registry.limits('antigravity-oauth', 'claude-opus-4-6-thinking').contextLimit, 200_000);
		// The same suffix on a normal provider is NOT stripped: there it would be a different model.
		assert.deepStrictEqual(registry.limits('gemini', 'gemini-3.6-flash-high'), {});
	});

	test('lists registry models only where the provider maps 1:1', () => {
		const registry = parseModelsDevCatalog({
			openai: { models: { 'gpt-5.5': {}, 'gpt-4-32k': { status: 'deprecated' } } },
			anthropic: { models: { 'claude-sonnet-4-5': {} } },
		});

		// Deprecated ids stay out of the picker.
		assert.deepStrictEqual(registry.modelsFor('openai'), ['gpt-5.5']);
		// A subscription backend lists its upstream catalog: it serves a subset, but offering one
		// model and hiding the rest is worse than an occasional rejection at run time.
		assert.deepStrictEqual(registry.modelsFor('openai-codex'), ['gpt-5.5']);
		assert.strictEqual(listableCatalogId('openai-codex'), 'openai');
		assert.strictEqual(listableCatalogId('copilot'), 'github-copilot');
		// Local runtimes serve whatever was pulled, and Antigravity is not published by the
		// registry at all: for both, live discovery is the only truth.
		assert.deepStrictEqual(registry.modelsFor('ollama'), []);
		assert.deepStrictEqual(registry.modelsFor('antigravity-oauth'), []);
	});

	test('survives a malformed registry payload without losing the good providers', () => {
		const registry = parseModelsDevCatalog({
			openai: { models: { 'gpt-5.5': { limit: { context: 400_000 } } } },
			broken: { models: 'not-an-object' },
			alsoBroken: null,
		});
		assert.deepStrictEqual(registry.modelsFor('openai'), ['gpt-5.5']);
		assert.strictEqual(registry.isEmpty, false);
		assert.strictEqual(parseModelsDevCatalog(null).isEmpty, true);
		assert.strictEqual(parseModelsDevCatalog([]).isEmpty, true);
	});

	test('reorders the picker in both directions, including onto the last slot', () => {
		const list = ['a', 'b', 'c', 'd'];

		// Moving DOWN is the case an insert-before-only drop cannot express: removing the item and
		// putting it back in front of its neighbour lands it exactly where it started.
		assert.deepStrictEqual(moveBeside(list, 'a', 'b', true), ['b', 'a', 'c', 'd']);
		assert.deepStrictEqual(moveBeside(list, 'a', 'b', false), ['a', 'b', 'c', 'd']);
		// Moving UP.
		assert.deepStrictEqual(moveBeside(list, 'd', 'b', false), ['a', 'd', 'b', 'c']);
		assert.deepStrictEqual(moveBeside(list, 'd', 'b', true), ['a', 'b', 'd', 'c']);
		// The last slot is only reachable by dropping AFTER the final entry.
		assert.deepStrictEqual(moveBeside(list, 'a', 'd', true), ['b', 'c', 'd', 'a']);
		// Dropping onto itself, or past the end, must not corrupt the list.
		assert.deepStrictEqual(moveBeside(list, 'b', 'b', true), ['a', 'c', 'd', 'b']);
		assert.deepStrictEqual(moveBeside(list, 'b', undefined, false), ['a', 'c', 'd', 'b']);
		assert.deepStrictEqual(moveBeside(list, 'b', 'missing', false), ['a', 'c', 'd', 'b']);
		assert.deepStrictEqual(moveBeside([], 'a', undefined, false), ['a']);
	});

	test('keeps a disconnected provider in place when the visible ones are reordered', () => {
		// The picker only reports connected providers, so `openai` (disconnected) is absent from the
		// drag result. Appending leftovers would demote it to the end for reasons the user never
		// expressed; it must keep its stored slot for when it reconnects.
		assert.deepStrictEqual(
			mergeVisibleOrder(['copilot', 'groq'], ['groq', 'openai', 'copilot']),
			['copilot', 'openai', 'groq'],
		);
		// Nothing stored yet: the visible order IS the order.
		assert.deepStrictEqual(mergeVisibleOrder(['a', 'b'], []), ['a', 'b']);
		// A duplicate arriving from the webview must not create two rows for one provider.
		assert.deepStrictEqual(mergeVisibleOrder(['a', 'b', 'a'], []), ['a', 'b']);

		assert.deepStrictEqual(toggleMembership(['a', 'b'], 'a'), ['b']);
		assert.deepStrictEqual(toggleMembership(['a'], 'b'), ['a', 'b']);
	});

	test('presents a model with a name, a context size and a price', () => {
		// models.dev publishes `name` for almost everything; the humanizer only covers what it does not.
		assert.strictEqual(humanizeModelId('gpt-5.6-sol'), 'GPT-5.6 Sol');
		assert.strictEqual(humanizeModelId('claude-sonnet-4-5'), 'Claude Sonnet 4.5');
		assert.strictEqual(humanizeModelId('anthropic/claude-fable-5'), 'Claude Fable 5');
		assert.strictEqual(humanizeModelId('llama3.3:70b'), 'Llama3.3 (70b)');
		assert.strictEqual(humanizeModelId(''), '');

		assert.strictEqual(formatContextTokens(500_000, 'en'), '500K');
		assert.strictEqual(formatContextTokens(1_000_000, 'en'), '1M');
		assert.strictEqual(formatContextTokens(1_100_000, 'en'), '1.1M');
		// No published limit renders as nothing, never as a fabricated size.
		assert.strictEqual(formatContextTokens(undefined, 'en'), '');
		assert.strictEqual(formatContextTokens(0, 'en'), '');

		assert.strictEqual(formatCostPerMillion(0.2, 'en'), '$0.20');
		assert.strictEqual(formatCostPerMillion(undefined, 'en'), '—');
	});

	test('advertises voice only for providers with an explicit audio model', () => {
		const builtin = new Map(OPENIDE_BUILTIN_PROVIDERS.map(entry => [entry.id, entry]));
		assert.strictEqual(builtin.get('gemini')?.voiceModel, 'gemini-3.5-flash');
		assert.strictEqual(builtin.get('openai')?.voiceModel, 'gpt-audio-mini');
		assert.strictEqual(builtin.get('openai-codex')?.voiceModel, undefined);
		assert.strictEqual(builtin.get('xai-oauth')?.voiceModel, undefined);
		const custom = resolveProviders([{ id: 'speech-gateway', baseUrl: 'https://voice.example/v1', voiceModel: 'audio-model' }]);
		assert.strictEqual(custom.find(entry => entry.id === 'speech-gateway')?.voiceModel, 'audio-model');
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
