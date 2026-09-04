/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFlowFrame, IFlowMark, IFlowVideoResult, flowSlug, formatFlowTime, openideRecorderRuntime, parseVideoMarker, pickKeyFrames, recorderRuntimeSource, videoMarker } from '../../common/openideBrowserRecorder.js';

suite('OpenIDE browser recorder', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const source = recorderRuntimeSource();

	test('the runtime is self-contained: it runs in a vm context with no Node globals', () => {
		// The Playwright service compiles it in a bare `vm` context. Anything that is not a JS
		// builtin or `page` is undefined there and fails at the first frame, silently.
		assert.strictEqual(source.includes('import '), false);
		assert.strictEqual(/\brequire\(/.test(source), false);
		assert.strictEqual(/\bBuffer\b/.test(source), false);
		assert.strictEqual(/\bsetTimeout\b/.test(source), false);
		assert.strictEqual(/\bprocess\b/.test(source), false);
		// The property key is inlined as a literal, not referenced from module scope.
		assert.strictEqual(source.includes('__openideFlowRecorder'), true);
	});

	test('every screencast frame is acknowledged, kept or not', () => {
		// Without the ack Chromium stops sending after a handful of frames; the recording would
		// "work" and hold three pictures.
		assert.strictEqual(source.includes('Page.screencastFrameAck'), true);
		assert.strictEqual(source.includes('Page.startScreencast'), true);
		assert.strictEqual(source.includes('Page.stopScreencast'), true);
	});

	test('status on a page that never recorded is empty, not an error', async () => {
		const page: Record<string, unknown> = {};
		const status = await openideRecorderRuntime(page, 'status') as { active: boolean; frames: number };
		assert.strictEqual(status.active, false);
		assert.strictEqual(status.frames, 0);
	});

	test('a recorder drives the CDP session it opened and stops it once', async () => {
		const sent: string[] = [];
		let handler: ((event: unknown) => void) | undefined;
		let detached = 0;
		const session = {
			on: (name: string, fn: (event: unknown) => void) => { assert.strictEqual(name, 'Page.screencastFrame'); handler = fn; },
			send: async (method: string) => { sent.push(method); },
			detach: async () => { detached++; },
		};
		const page: Record<string, unknown> = { context: () => ({ newCDPSession: async () => session }) };

		const started = await openideRecorderRuntime(page, 'start', { fps: 10, label: 'login' }) as { active: boolean; label: string; marks: IFlowMark[] };
		assert.strictEqual(started.active, true);
		assert.strictEqual(started.label, 'login');
		assert.deepStrictEqual(started.marks.map(mark => mark.kind), ['start']);
		assert.strictEqual(sent.includes('Page.startScreencast'), true);

		// A second start does not open a second screencast.
		const again = await openideRecorderRuntime(page, 'start', { label: 'other' }) as { alreadyActive?: boolean; label: string };
		assert.strictEqual(again.alreadyActive, true);
		assert.strictEqual(again.label, 'login');
		assert.strictEqual(sent.filter(method => method === 'Page.startScreencast').length, 1);

		// Frames come in, get acked, and are kept at most at the target rate.
		assert.ok(handler);
		handler({ sessionId: 1, data: 'AAAA', metadata: { deviceWidth: 640, deviceHeight: 480 } });
		handler({ sessionId: 2, data: 'BBBB', metadata: { deviceWidth: 640, deviceHeight: 480 } });
		await Promise.resolve();
		assert.strictEqual(sent.filter(method => method === 'Page.screencastFrameAck').length, 2);
		let status = await openideRecorderRuntime(page, 'status') as { frames: number; width: number };
		assert.strictEqual(status.frames, 1, 'two frames inside one period keep one');
		assert.strictEqual(status.width, 640);

		await openideRecorderRuntime(page, 'mark', { label: 'Botón Entrar', kind: 'click' });
		const stopped = await openideRecorderRuntime(page, 'stop') as { active: boolean; marks: IFlowMark[] };
		assert.strictEqual(stopped.active, false);
		assert.deepStrictEqual(stopped.marks.map(mark => mark.kind), ['start', 'click', 'end']);
		assert.strictEqual(sent.includes('Page.stopScreencast'), true);
		assert.strictEqual(detached, 1);

		// Stopping again is harmless, and a frame arriving late is ignored.
		await openideRecorderRuntime(page, 'stop');
		handler({ sessionId: 3, data: 'CCCC', metadata: {} });
		status = await openideRecorderRuntime(page, 'status') as { frames: number; width: number };
		assert.strictEqual(status.frames, 1);

		const taken = await openideRecorderRuntime(page, 'take', { from: 0, count: 10 }) as { frames: IFlowFrame[]; total: number };
		assert.strictEqual(taken.total, 1);
		assert.strictEqual(taken.frames[0].data, 'AAAA');

		await openideRecorderRuntime(page, 'discard');
		assert.strictEqual(page['__openideFlowRecorder'], undefined);
		await assert.rejects(() => openideRecorderRuntime(page, 'mark', { label: 'x' }));
	});

	test('pickKeyFrames takes the first frame after the action settled', () => {
		const frames: IFlowFrame[] = [0, 100, 200, 300, 400, 500].map(t => ({ t, data: `f${t}`, width: 1, height: 1 }));
		const marks: IFlowMark[] = [
			{ t: 0, label: 'login', kind: 'start' },
			{ t: 120, label: 'Botón Entrar', kind: 'click' },
			{ t: 480, label: 'end', kind: 'end' },
		];
		const keys = pickKeyFrames(frames, marks, 140);
		assert.deepStrictEqual(keys.map(key => key.frame.t), [0, 300, 500]);
		assert.strictEqual(keys[1].mark.label, 'Botón Entrar');
	});

	test('pickKeyFrames collapses marks that land on the same frame and survives a short recording', () => {
		const frames: IFlowFrame[] = [{ t: 0, data: 'a', width: 1, height: 1 }, { t: 1000, data: 'b', width: 1, height: 1 }];
		const marks: IFlowMark[] = [
			{ t: 0, label: 'start', kind: 'start' },
			{ t: 10, label: 'one', kind: 'click' },
			{ t: 20, label: 'two', kind: 'type' },
			{ t: 5000, label: 'late', kind: 'mark' },
		];
		const keys = pickKeyFrames(frames, marks, 0);
		// start → frame 0; one → frame 1000; two → same frame, so it replaces one; late → last.
		assert.deepStrictEqual(keys.map(key => [key.frame.t, key.mark.label]), [[0, 'start'], [1000, 'late']]);
		assert.deepStrictEqual(pickKeyFrames([], marks, 0), []);
	});

	test('the video marker round-trips and keeps the note', () => {
		const result: IFlowVideoResult = {
			id: 'rec-1', label: 'login', dir: '/tmp/x', videoPath: '/tmp/x/flow.webm', sheetPath: '/tmp/x/sheet.jpg', manifestPath: '/tmp/x/manifest.json',
			durationMs: 1234, width: 640, height: 480, fps: 12, frameCount: 9, truncated: false,
			sheet: { mimeType: 'image/jpeg', data: 'QUJD' },
			keyFrames: [{ file: '/tmp/x/frames/01-start.jpg', t: 0, label: 'login', kind: 'start', data: 'QUJD' }, { file: '/tmp/x/frames/02-end.jpg', t: 1200, label: 'end', kind: 'end' }],
		};
		const text = videoMarker(result, 'Flow recorded.\nSteps:\n 1. 00:00.0 start');
		const parsed = parseVideoMarker(text);
		assert.ok(parsed);
		assert.deepStrictEqual(parsed.video, result);
		assert.strictEqual(parsed.note.startsWith('Flow recorded.'), true);
		assert.strictEqual(parseVideoMarker('OK: nothing here'), undefined);
		assert.strictEqual(parseVideoMarker('[[openide-video:{"bogus":true}]]\nx'), undefined);
	});

	test('time and slug helpers', () => {
		assert.strictEqual(formatFlowTime(0), '00:00.0');
		assert.strictEqual(formatFlowTime(1234), '00:01.2');
		assert.strictEqual(formatFlowTime(61_500), '01:01.5');
		assert.strictEqual(flowSlug('Botón Guardar'), 'boton-guardar');
		assert.strictEqual(flowSlug('   '), 'flow');
		assert.strictEqual(flowSlug('!!!', 'click'), 'click');
	});
});
