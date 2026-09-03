#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  OpenIDE — visual check of the running IDE, driven by Playwright.
 *
 *  Typecheck and unit tests never execute the workbench DOM, so every visual regression in this
 *  migration was found by a human taking a screenshot. This closes that loop: it launches the dev
 *  build, drives the chat, and writes PNGs plus the renderer console log.
 *
 *  On NixOS it has to run inside the FHS env, same as scripts/code.sh:
 *      ./result-fhs/bin/openide-build -c "node dev/visual-check.mjs"
 *
 *  Two modes:
 *
 *    --attach[=PORT]   connects to an IDE ALREADY running with --remote-debugging-port and, by
 *                      default, reloads its window first. This is the one to use while iterating:
 *                      `npm run watch-client-transpile` keeps out/ fresh, CSS hot-reloads on its
 *                      own (see platform/cssDev), and TypeScript needs only a window reload — not
 *                      a restart of the whole app.
 *    (default)         launches a fresh IDE, drives it, and closes it.
 *
 *  Flags:
 *      --prompt="..."              sends this prompt and waits for a reply
 *      --open=history|models|mode|usage  clicks that control first, so popovers can be captured
 *      --out=DIR                   where the PNGs go (default: .build/visual-check)
 *      --checks                    asserts the native chat's wiring end to end and fails the run
 *      --scenario=NAME|all         drives the CONFIGURED MODEL through real requests and asserts
 *                                  what they render (diagram | plan | terminal | tools)
 *      --no-reload                 with --attach, screenshot the window as it is
 *      --keep                      leave the IDE open at the end
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createRequire } from 'module';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const VSCODE = join(REPO, 'vscode');
const ELECTRON = join(VSCODE, '.build/electron/openide');
/** The dev build keeps its user data here — same path scripts/code.sh ends up using. */
const USER_SETTINGS = join(homedir(), '.config/code-oss-dev/User/settings.json');

// playwright-core lives in vscode/node_modules, not at the repo root where this script sits.
const { _electron, chromium } = createRequire(join(VSCODE, 'package.json'))('playwright-core');

const args = Object.fromEntries(process.argv.slice(2)
	.filter(a => a.startsWith('--'))
	.map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));

const outDir = join(REPO, String(args.out ?? '.build/visual-check'));
const shots = [];

function log(msg) { process.stdout.write(`[visual-check] ${msg}\n`); }


async function shot(page, name) {
	const file = join(outDir, `${String(shots.length).padStart(2, '0')}-${name}.png`);
	await page.screenshot({ path: file });
	shots.push(file);
	log(`captura ${name}`);
}

/** Attaches to a running IDE over CDP and returns its workbench page. */
async function attach(port, attempts = 12) {
	// Retries because the window may be mid-reload: during it the page exists but the workbench
	// is not mounted yet, and another visual-check running in parallel makes that likely.
	for (let i = 0; i < attempts; i++) {
		const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
		if (browser) {
			for (const context of browser.contexts()) {
				for (const page of context.pages()) {
					if (await page.locator('.monaco-workbench').count().catch(() => 0)) { return { browser, page }; }
				}
			}
			await browser.close();
		}
		await new Promise(r => setTimeout(r, 5_000));
	}
	throw new Error(`me conecte al puerto ${port} pero ninguna pagina monto .monaco-workbench en ${attempts * 5}s`);
}

/**
 * End-to-end assertions against the RUNNING IDE.
 *
 * The unit tests build each component against stub services in a detached DOM. What they cannot
 * reach is the wiring: that the pane really mounts the native widget, that the command really finds
 * it, and that nothing throws while the workbench boots with all of it. Every one of those is a
 * seam between files that typecheck perfectly on their own.
 */
const checks = [];

function check(name, ok, detail = '') {
	checks.push({ name, ok: !!ok, detail });
	log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Runs a workbench command the way a user does, so the palette entry is part of what is tested. */
async function runCommand(page, title) {
	await page.keyboard.press('Control+Shift+KeyP');
	await page.waitForTimeout(700);
	await page.keyboard.type(title, { delay: 12 });
	await page.waitForTimeout(900);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(1_200);
}

async function runChecks(page) {
	// 1. The native renderer is the one that mounted. Everything below is meaningless otherwise:
	//    with `webview` the chat is an overlay and none of these selectors exist.
	const native = page.locator('.openide-chat-native').first();
	check('el chat nativo esta montado', await native.count() > 0);
	if (!await native.count()) { return; }

	check('el composer tiene su textarea', await page.locator('.openide-chat-composer textarea').count() > 0);

	// 1b. A restored conversation has to be VISIBLE, not merely present. The list measures rows with
	//     `supportDynamicHeights`, and a row measured while the pane is still detached caches a
	//     height of zero — items in the tree, nothing on screen, no error anywhere.
	const transcript = await page.evaluate(() => {
		const root = document.querySelector('.openide-chat-native');
		const rows = [...(root?.querySelectorAll('.monaco-list-row') ?? [])];
		const box = e => { const b = e?.getBoundingClientRect(); return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : 'n/a'; };
		return {
			rows: rows.length,
			zeroHeight: rows.filter(r => r.getBoundingClientRect().height === 0).length,
			text: rows.reduce((n, r) => n + (r.textContent ?? '').trim().length, 0),
			// The geometry is what tells a list with no items apart from a list with no ROOM.
			root: box(root),
			host: box(root?.querySelector('.openide-chat-list-host')),
			hostStyle: (root?.querySelector('.openide-chat-list-host'))?.style.height ?? '',
			composer: box(root?.querySelector('.openide-chat-dock')),
			rowsContainer: box(root?.querySelector('.monaco-list-rows')),
			scrollHeight: (root?.querySelector('.monaco-list-rows'))?.scrollHeight ?? -1,
		};
	});
	log('transcripcion: ' + JSON.stringify(transcript));
	if (transcript.rows) {
		check('ninguna fila restaurada quedo con altura 0', transcript.zeroHeight === 0, `${transcript.zeroHeight}/${transcript.rows} en cero`);
		check('las filas restauradas tienen contenido', transcript.text > 0, `${transcript.text} caracteres`);
		// Restoring lands on the LAST turn. Same invariant the scenarios check after a reply: the
		// tail lock has to survive the widget's own scrolling, or the conversation opens in the
		// middle of its own history.
		const tail = await tailState(page);
		log('cola tras restaurar: ' + JSON.stringify(tail));
		check('la conversacion restaurada abre en su ultimo turno', tail.atBottom !== false, JSON.stringify(tail));
	} else {
		log('la conversacion activa esta vacia: no hay transcripcion que verificar');
	}

	// 2. Trays are absent-or-hidden on an idle chat. A tray that paints itself with nothing in it is
	//    the failure mode both of them were written to avoid.
	for (const [name, selector] of [['archivos', '.openide-chat-files-tray'], ['terminales', '.openide-chat-terms-tray']]) {
		const tray = page.locator(selector).first();
		const present = await tray.count() > 0;
		const hidden = present ? await tray.evaluate(e => e.classList.contains('hidden')) : true;
		check(`la bandeja de ${name} no ocupa espacio en reposo`, hidden, present ? 'montada y oculta' : 'no montada');
	}

	// 3. The context panel, through the real command → view pane → widget → panel path. This is the
	//    routing added for the native renderer and the one thing no unit test can exercise.
	await runCommand(page, 'Uso de contexto');
	const panel = page.locator('.openide-chat-context-panel').first();
	const open = await panel.count() > 0 && !await panel.evaluate(e => e.classList.contains('hidden'));
	check('el comando abre el panel de contexto nativo', open);
	if (open) {
		await shot(page, 'context-panel');
		const shape = await panel.evaluate(e => ({
			head: e.querySelector('.openide-chat-context-head')?.textContent?.trim() ?? '',
			meta: [...e.querySelectorAll('.openide-chat-context-meta span')].map(s => s.textContent),
			bars: e.querySelectorAll('.openide-chat-context-bar').length,
			segs: e.querySelectorAll('.openide-chat-context-seg').length,
			fills: e.querySelectorAll('.openide-chat-context-fill').length,
			rows: [...e.querySelectorAll('.openide-chat-context-row')].map(r => [
				r.querySelector('.openide-chat-context-label')?.textContent,
				r.querySelector('.openide-chat-context-value')?.textContent,
			].join('=')),
		}));
		log('panel: ' + JSON.stringify(shape));
		check('el panel dice de que habla', shape.head.includes('Uso de contexto'), shape.head);
		check('el panel muestra el porcentaje y los tokens', shape.meta.length === 2, JSON.stringify(shape.meta));
		// Exactly one bar, and exactly one of the two ways of drawing it.
		check('hay una sola barra', shape.bars === 1, `bars=${shape.bars}`);
		check('la barra es segmentada O es un fill, nunca las dos', (shape.segs > 0) !== (shape.fills > 0), `segs=${shape.segs} fills=${shape.fills}`);
		check('estan las tres filas exactas del pie', ['Entrada', 'Salida', 'Total'].every(l => shape.rows.some(r => r.startsWith(l + '='))), JSON.stringify(shape.rows));

		// Closing is part of the contract: the command toggles.
		await runCommand(page, 'Uso de contexto');
		const stillOpen = await panel.count() > 0 && !await panel.evaluate(e => e.classList.contains('hidden'));
		check('el comando vuelve a cerrarlo', !stillOpen);
	}
}

/** True while a run is in flight: the send button becomes a stop button. */
async function isBusy(page) {
	return await page.locator('.openide-composer-send.running').count() > 0;
}

/**
 * Sends a prompt and waits for the RUN to finish rather than for a fixed delay.
 *
 * A timeout is not a failure by itself — a long tool chain legitimately outlives it — so it is
 * reported and the assertions run against whatever is on screen by then.
 */
async function ask(page, prompt, { timeoutMs = 180_000 } = {}) {
	const input = page.locator('.openide-chat-composer textarea').first();
	await input.click();
	await input.fill(prompt);
	await page.keyboard.press('Enter');
	log(`enviado: ${prompt.slice(0, 70)}${prompt.length > 70 ? '…' : ''}`);

	// Wait for it to START, so a slow first token is not read as "already finished".
	const startedAt = Date.now();
	while (Date.now() - startedAt < 30_000 && !await isBusy(page)) {
		await page.waitForTimeout(250);
	}
	while (Date.now() - startedAt < timeoutMs && await isBusy(page)) {
		await page.waitForTimeout(1_000);
	}
	const seconds = Math.round((Date.now() - startedAt) / 1000);
	if (await isBusy(page)) { log(`el turno sigue corriendo despues de ${seconds}s; sigo igual`); }
	else { log(`turno terminado en ${seconds}s`); }
	// The last rows are rendered asynchronously (code tokenization, diagrams).
	await page.waitForTimeout(2_500);
}

/** Answers a native approval card, if one is on screen. Returns what it clicked. */
async function approveIfAsked(page) {
	const card = page.locator('.openide-chat-approval').last();
	if (!await card.count()) { return undefined; }
	const allow = card.locator('.openide-chat-abtn.primary').first();
	if (!await allow.count()) { return undefined; }
	const title = (await card.locator('.openide-chat-approval-title').textContent())?.trim() ?? '';
	await allow.click();
	log(`aprobado: ${title}`);
	await page.waitForTimeout(1_500);
	return title;
}

/**
 * Whether the transcript is pinned to its last row.
 *
 * A chat that answers below the fold is a chat that looks like it did not answer. The list arms a
 * tail lock on send precisely so the reply stays in view as its rows are measured.
 */
async function tailState(page) {
	return await page.evaluate(() => {
		// The list scrolls by TRANSFORM, not by scrollTop, so the DOM's own scroll numbers are all
		// zero and meaningless here. The widget's own verdict is the class it puts on its container.
		const list = document.querySelector('.openide-chat-native .openide-chat-list');
		if (!list) { return { known: false }; }
		const rows = [...list.querySelectorAll('.monaco-list-row')];
		const view = list.querySelector('.monaco-list');
		const viewBottom = view?.getBoundingClientRect().bottom ?? 0;
		const lastBottom = rows.at(-1)?.getBoundingClientRect().bottom ?? 0;
		return {
			known: true,
			atBottom: list.classList.contains('openide-chat-list-at-bottom'),
			rendered: rows.length,
			// How far the last RENDERED row ends below the viewport; large means it is cut off.
			overflow: Math.round(lastBottom - viewBottom),
		};
	});
}

/** What the transcript is made of right now, by content-part class. */
async function transcriptParts(page) {
	return await page.evaluate(() => {
		const root = document.querySelector('.openide-chat-native');
		const counts = {};
		const selectors = {
			markdown: '.openide-chat-markdown',
			// Tool calls and the "Exploring" group are both activity rows; the group is a <details>.
			tool: '.openide-chat-tool-activity',
			explore: '.openide-chat-activity-group',
			terminal: '.openide-chat-term-card',
			edit: '.openide-chat-edit-card',
			todos: '.openide-chat-todos-card',
			plan: '.openide-chat-plan-wrap',
			canvas: '.openide-chat-canvas-card',
			diagram: '.openide-chat-diagram',
			approval: '.openide-chat-approval',
			ask: '.openide-chat-ask',
			notice: '.openide-chat-notice-row',
			unrendered: '.openide-chat-unrendered',
			termsTray: '.openide-chat-terms-tray:not(.hidden)',
			filesTray: '.openide-chat-files-tray:not(.hidden)',
		};
		for (const [name, selector] of Object.entries(selectors)) {
			counts[name] = root?.querySelectorAll(selector).length ?? 0;
		}
		return counts;
	});
}

/**
 * Real requests against the configured model.
 *
 * Everything up to here runs without a provider: it asserts the wiring, not the product. These
 * scenarios are the other half — a plan card only exists because `plan_save` ran, and no stub can
 * tell you whether the card the model's output produces is the card the user wanted.
 */
async function checkPinnedToTail(page) {
	const tail = await tailState(page);
	log('cola: ' + JSON.stringify(tail));
	if (!tail.known) { return; }
	check('la respuesta quedo a la vista (lista anclada al final)', tail.atBottom, JSON.stringify(tail));
}

async function runScenarios(page, only) {
	const scenarios = {
		diagram: async () => {
			await ask(page, 'Dibujame un diagrama mermaid simple del flujo: Usuario -> API -> Base de datos -> API -> Usuario. Solo el bloque ```mermaid, sin explicacion.');
			const parts = await transcriptParts(page);
			log('partes: ' + JSON.stringify(parts));
			check('el fence mermaid se dibujo como diagrama', parts.diagram > 0, `diagram=${parts.diagram}`);
			// The whole point of the split: the source must NOT be sitting in the prose as a fence.
			const raw = await page.evaluate(() => {
				const root = document.querySelector('.openide-chat-native');
				return [...(root?.querySelectorAll('.openide-chat-markdown code') ?? [])]
					.filter(c => (c.textContent ?? '').includes('graph ') || (c.textContent ?? '').includes('flowchart ')).length;
			});
			check('el markdown ya no muestra el fuente mermaid', raw === 0, `bloques con fuente=${raw}`);
			check('no quedo ninguna parte sin renderer', parts.unrendered === 0);
			await checkPinnedToTail(page);
			await shot(page, 'escenario-diagrama');
		},

		plan: async () => {
			await ask(page, 'Entra en modo plan: crea un plan corto (3 tareas) para agregar un endpoint de health check al server. Usa plan_save.');
			await approveIfAsked(page);
			const parts = await transcriptParts(page);
			log('partes: ' + JSON.stringify(parts));
			check('el plan aparecio como card en vivo', parts.plan > 0, `plan=${parts.plan}`);
			if (parts.plan > 0) {
				const card = await page.evaluate(() => {
					const wrap = document.querySelector('.openide-chat-plan-wrap');
					return {
						label: wrap?.querySelector('.openide-chat-plan-label')?.textContent?.trim() ?? '',
						file: wrap?.querySelector('.openide-chat-plan-file')?.textContent?.trim() ?? '',
						title: wrap?.querySelector('.openide-chat-plan-title')?.textContent?.trim() ?? '',
						tasks: wrap?.querySelectorAll('.openide-chat-plan-task').length ?? 0,
						build: !!wrap?.querySelector('.openide-chat-plan-build'),
						reject: !!wrap?.querySelector('.openide-chat-plan-reject'),
					};
				});
				log('card del plan: ' + JSON.stringify(card));
				check('la card es la definitiva, no el esqueleto', card.label === 'Plan preparado', card.label);
				check('la card nombra el archivo del plan', card.file.endsWith('.md'), card.file);
				check('la card ofrece Build y Rechazar', card.build && card.reject);
				check('la card lista las tareas parseadas', card.tasks > 0, `tareas=${card.tasks}`);
			}
			check('no quedo ninguna parte sin renderer', parts.unrendered === 0);
			await checkPinnedToTail(page);
			await shot(page, 'escenario-plan');
		},

		terminal: async () => {
			await ask(page, 'Corre en segundo plano, con run_command y background:true, el comando: python3 -m http.server 8099');
			await approveIfAsked(page);
			await page.waitForTimeout(4_000);
			const parts = await transcriptParts(page);
			log('partes: ' + JSON.stringify(parts));
			check('la bandeja de terminales en background aparecio', parts.termsTray > 0, `tray=${parts.termsTray}`);
			if (parts.termsTray > 0) {
				const tray = await page.evaluate(() => {
					const t = document.querySelector('.openide-chat-terms-tray');
					return {
						count: t?.querySelector('.openide-chat-terms-count')?.textContent ?? '',
						rows: [...(t?.querySelectorAll('.openide-chat-terms-label') ?? [])].map(r => r.textContent),
					};
				});
				log('bandeja: ' + JSON.stringify(tray));
				check('la bandeja nombra el comando que corre', tray.rows.some(r => (r ?? '').includes('http.server')), JSON.stringify(tray.rows));
			}
			await shot(page, 'escenario-terminal');

			// Killing it from the tray is half the feature, and it must leave nothing running on the
			// user's machine either way. Guarded: this step once took the page down with it, and a
			// crash here would otherwise be reported as "the tray failed".
			const stop = page.locator('.openide-chat-terms-stop').first();
			if (await stop.count()) {
				// Hover first, like a user: the button is `opacity: 0` until the row is hovered.
				await page.locator('.openide-chat-terms-row').first().hover().catch(() => undefined);
				await page.waitForTimeout(300);
				try {
					await stop.click();
					await page.waitForTimeout(2_500);
					const after = await transcriptParts(page);
					check('al matarla, la fila se va de la bandeja', after.termsTray === 0, `tray=${after.termsTray}`);
				} catch (err) {
					check('matar la terminal no tira la ventana', false, String(err?.message ?? err).split('\n')[0]);
				}
			}
		},

		canvas: async () => {
			// `canvas_write` needs a whole .canvas.tsx, so the prompt spells out the contract the tool
			// documents (one file, only the openide/canvas import, data embedded, default export).
			await ask(page, 'Cargá la skill openide-canvas y con canvas_write creá un canvas llamado "ventas-demo": un único .canvas.tsx que importe solo de openide/canvas, con los datos embebidos y default export. Que muestre una tabla de 3 filas de ventas ficticias. No abras nada mas.', { timeoutMs: 240_000 });
			await approveIfAsked(page);
			await page.waitForTimeout(3_000);
			const parts = await transcriptParts(page);
			log('partes: ' + JSON.stringify(parts));
			check('el canvas aparecio como card en vivo', parts.canvas > 0, `canvas=${parts.canvas}`);
			if (parts.canvas > 0) {
				const card = await page.evaluate(() => {
					const c = document.querySelector('.openide-chat-canvas-card');
					return {
						head: c?.querySelector('.openide-chat-canvas-head span')?.textContent?.trim() ?? '',
						title: c?.querySelector('.openide-chat-canvas-title')?.textContent?.trim() ?? '',
						path: c?.querySelector('.openide-chat-canvas-path')?.textContent?.trim() ?? '',
						open: !!c?.querySelector('.openide-chat-canvas-open'),
					};
				});
				log('card del canvas: ' + JSON.stringify(card));
				// The live event knows whether the file existed; a restored card says only "Canvas".
				check('la card distingue creado de actualizado', card.head === 'Canvas creado' || card.head === 'Canvas actualizado', card.head);
				check('la card nombra el archivo .canvas.tsx', card.path.endsWith('.canvas.tsx'), card.path);
				check('la card ofrece abrirlo', card.open);
			}
			check('no quedo ninguna parte sin renderer', parts.unrendered === 0);
			await checkPinnedToTail(page);
			await shot(page, 'escenario-canvas');
		},

		approval: async () => {
			// An exec tool that is NOT on the allowlist: the run parks on a promise until the card is
			// answered, so this is the one scenario where a broken card hangs the turn forever.
			//
			// It only proves anything when the profile's permission mode is `ask`. With `auto-edit`
			// or `auto-all` the engine approves without asking and no card can ever appear — the run
			// below then reports that, instead of a failure it would be dishonest to call one. The
			// card's own behaviour is covered deterministically in
			// test/browser/openideChatConfirmationPart.test.ts.
			const input = page.locator('.openide-chat-composer textarea').first();
			await input.click();
			await input.fill('Ejecuta con run_command (primer plano, sin background) el comando: echo hola-desde-openide');
			await page.keyboard.press('Enter');
			log('enviado: pedido de run_command que necesita aprobacion');

			// Wait for the card OR for the run to finish: if the tool was auto-approved there will
			// never be a card, and hanging for 90s to then report "no card" hides which of the two
			// happened.
			const card = page.locator('.openide-chat-approval').last();
			const deadline = Date.now() + 90_000;
			while (Date.now() < deadline && !await card.count()) {
				await page.waitForTimeout(500);
				if (Date.now() - deadline > -85_000 && !await isBusy(page) && !await card.count()) {
					// Started and already finished, with no card in between.
					const settled = await page.waitForTimeout(1_500).then(() => card.count());
					if (!settled) { break; }
				}
			}
			const parts0 = await transcriptParts(page);
			log('partes al esperar la card: ' + JSON.stringify(parts0));
			await shot(page, 'escenario-aprobacion');
			if (!await card.count()) {
				// The command ran with no card in between: the engine did not ask, so the permission
				// mode is not `ask` and there is nothing here to assert.
				if (parts0.terminal > 0) {
					log('el comando se auto-aprobo (permissionMode != ask): este escenario no aplica en este perfil');
					return;
				}
				check('la aprobacion aparecio como card', false, JSON.stringify({ terminal: parts0.terminal, markdown: parts0.markdown, notice: parts0.notice }));
				return;
			}
			check('la aprobacion aparecio como card', true);
			const shape = await page.evaluate(() => {
				const c = document.querySelectorAll('.openide-chat-approval');
				const last = c[c.length - 1];
				return {
					title: last?.querySelector('.openide-chat-approval-title')?.textContent?.trim() ?? '',
					command: last?.querySelector('.openide-chat-approval-cmd')?.textContent?.trim() ?? '',
					buttons: [...(last?.querySelectorAll('.openide-chat-abtn') ?? [])].map(b => b.textContent?.trim()),
				};
			});
			log('card de aprobacion: ' + JSON.stringify(shape));
			check('la card dice que se va a ejecutar', shape.command.includes('echo hola-desde-openide'), shape.command);
			check('la card ofrece al menos permitir y denegar', shape.buttons.length >= 2, JSON.stringify(shape.buttons));

			// Answering it has to UNBLOCK the run — the whole reason the part exists.
			await approveIfAsked(page);
			const finished = Date.now() + 90_000;
			while (Date.now() < finished && await isBusy(page)) { await page.waitForTimeout(1_000); }
			check('responder la card destraba el turno', !await isBusy(page));
			await page.waitForTimeout(2_000);
			const parts = await transcriptParts(page);
			log('partes: ' + JSON.stringify(parts));
			check('el comando aprobado dejo su terminal en el transcript', parts.terminal > 0, `terminal=${parts.terminal}`);
			await shot(page, 'escenario-aprobacion-resuelta');
		},

		tools: async () => {
			await ask(page, 'Lee el archivo package.json de la raiz y decime en una linea el campo "name". Nada mas.');
			const parts = await transcriptParts(page);
			log('partes: ' + JSON.stringify(parts));
			check('la lectura se agrupo en "Explorando"', parts.explore > 0 || parts.tool > 0, JSON.stringify({ explore: parts.explore, tool: parts.tool }));
			check('la respuesta tiene prosa', parts.markdown > 0);
			check('no quedo ninguna parte sin renderer', parts.unrendered === 0);
			await checkPinnedToTail(page);
			await shot(page, 'escenario-tools');
		},
	};

	for (const [name, run] of Object.entries(scenarios)) {
		if (only && only !== 'all' && only !== name) { continue; }
		log(`--- escenario: ${name} ---`);
		await run();
	}
}

async function main() {
	mkdirSync(outDir, { recursive: true });

	let app;
	let browser;
	let page;

	if (args.attach) {
		const port = args.attach === true ? 9222 : Number(args.attach);
		log(`adjuntando a la IDE en el puerto ${port}…`);
		({ browser, page } = await attach(port));
		if (args.reload) {
			// Reloading re-runs the renderer against the freshly transpiled out/, which is the
			// whole point of not restarting the app. It has to go through the workbench command:
			// location.reload() on a vscode-file:// page never comes back.
			log('recargando la ventana…');
			await page.keyboard.press('Control+KeyR');
			await browser.close();
			await new Promise(r => setTimeout(r, 12_000));
			// The reload tears down the CDP target, so the old page handle is dead.
			({ browser, page } = await attach(port));
		}
	} else {
		if (!existsSync(ELECTRON)) {
			throw new Error(`no encuentro el Electron de desarrollo en ${ELECTRON}. Corré scripts/code.sh una vez primero.`);
		}
		log('lanzando la IDE…');
		app = await _electron.launch({
			executablePath: ELECTRON,
			args: ['.', '--disable-extension=vscode.vscode-api-tests', '--skip-welcome', '--skip-release-notes'],
			cwd: VSCODE,
			env: { ...process.env, VSCODE_DEV: '1' },
			timeout: 0,
		});
		page = await app.firstWindow();
	}
	// The renderer console is where a crash in the native chat shows up; the terminal only gets
	// the main process. Collecting it is the difference between "se ve raro" and a stack.
	const console_ = [];
	page.on('console', m => console_.push(`[${m.type()}] ${m.text()}`));
	page.on('pageerror', e => console_.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

	await page.waitForSelector('.monaco-workbench', { timeout: 120_000 });
	log('workbench listo');
	await page.waitForTimeout(6_000);			// deja asentar el layout y la restauracion de sesion
	await shot(page, 'workbench');

	// The chat lives in the auxiliary bar. Its pane is the only one carrying the openide chat root.
	const chat = page.locator('.openide-chat-native').first();
	if (await chat.count()) {
		await chat.screenshot({ path: join(outDir, 'chat.png') }).catch(() => undefined);
		shots.push(join(outDir, 'chat.png'));
		log('captura chat');
	} else {
		log('no encontre el panel del chat (¿esta cerrado el auxiliary bar?)');
	}

	// Popovers only exist while open, so a capture that never clicks one can never show a bug in
	// it. Every popover regression so far had to be reported by hand for exactly this reason.
	if (args.open) {
		const triggers = {
			history: '.openide-chat-header [title*="istorial"], .openide-chat-header .codicon-history',
			models: '.openide-chat-composer [class*="model"], .openide-chat-composer .codicon-chevron-down',
			mode: '.openide-chat-composer [class*="mode"]',
			// The usage roster hangs off the status bar, not off the chat: it is the one popover a
			// user can open without the dock ever having been shown.
			usage: '#openide\\.agent\\.usage, .statusbar-item:has(> .openide-status-provider-icon)',
		};
		const sel = triggers[String(args.open)];
		const trigger = sel ? page.locator(sel).first() : undefined;
		if (trigger && await trigger.count()) {
			await trigger.click();
			await page.waitForTimeout(900);
			await shot(page, `popover-${args.open}`);
			// Geometry of the popover against its host panel: the numbers say whether it overflows,
			// which a screenshot alone leaves ambiguous.
			const geo = await page.evaluate(() => {
				const panel = document.querySelector('.openide-chat-native');
				const pops = [...document.querySelectorAll('.context-view, .monaco-menu-container, [class*="openide-chat"][class*="popover"], [class*="openide-chat"][class*="menu"]')]
					.filter(e => e.getBoundingClientRect().width > 40);
				const r = e => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
				return { panel: panel ? r(panel) : null, popovers: pops.map(e => ({ cls: String(e.className).slice(0, 60), ...r(e) })) };
			});
			log('geometria: ' + JSON.stringify(geo));
		} else {
			log(`no encontre el disparador para --open=${args.open}`);
		}
	}

	if (args.checks) {
		await runChecks(page);
	}

	if (args.scenario) {
		await runScenarios(page, String(args.scenario));
	}

	if (args.prompt) {
		const input = page.locator('.openide-chat-composer textarea').first();
		if (await input.count()) {
			await input.click();
			await input.fill(String(args.prompt));
			await page.keyboard.press('Enter');
			log(`enviado: ${args.prompt}`);
			await page.waitForTimeout(20_000);
			await shot(page, 'respuesta');
		} else {
			log('no encontre el composer para escribir');
		}
	}

	const logFile = join(outDir, 'renderer-console.log');
	writeFileSync(logFile, console_.join('\n'));
	const errors = console_.filter(l => l.startsWith('[error]') || l.startsWith('[pageerror]'));
	log(`consola del renderer → ${logFile} (${errors.length} errores)`);
	for (const e of errors.slice(0, 10)) { process.stdout.write(`  ${e.split('\n')[0]}\n`); }

	// Attached mode never closes the IDE: it is the window the user is looking at.
	if (browser) { await browser.close(); }
	else if (app && !args.keep) { await app.close(); }
	const failed = checks.filter(c => !c.ok);
	if (checks.length) { log(`checks: ${checks.length - failed.length}/${checks.length} en verde`); }
	log(`listo. ${shots.length} capturas en ${outDir}`);
	process.exit(errors.length || failed.length ? 1 : 0);
}

main().catch(err => { process.stderr.write(`[visual-check] fallo: ${err?.stack ?? err}\n`); process.exit(1); });
