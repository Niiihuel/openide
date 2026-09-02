/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — seqmap (```seqmap fence): the sequence-diagram member of the typed-map family
 *  (openideNodeMaps.ts). Same Archify model — authored semantics, actionable diagnostics,
 *  deterministic layout — but its own shape, because a sequence is not a graph: actors are
 *  COLUMNS, time flows DOWN, and the order of the steps array IS the layout. Kinds reuse the
 *  archmap vocabulary so one palette and one legend serve both.
 *--------------------------------------------------------------------------------------------*/

import { INodeMapDiagnostic, NODE_MAP_KINDS } from './openideNodeMaps.js';

export interface ISeqMapActor {
	readonly id: string;
	readonly label: string;
	/** The archmap vocabulary (frontend | backend | database | cloud | security | messagebus | external). */
	readonly kind: string;
	readonly sublabel?: string;
}

export interface ISeqMapStep {
	readonly from: string;
	readonly to: string;
	readonly label: string;
	/** A response going back; drawn dashed, like Archify's returns. */
	readonly reply: boolean;
	readonly dashed: boolean;
}

export interface ISeqMapSpec {
	readonly type: 'seqmap';
	readonly title?: string;
	readonly actors: readonly ISeqMapActor[];
	readonly steps: readonly ISeqMapStep[];
}

export interface ISeqMapParseResult {
	readonly spec?: ISeqMapSpec;
	readonly diagnostics: readonly INodeMapDiagnostic[];
}

export function looksLikeSeqMap(source: string): boolean {
	const head = source.trimStart();
	return head.startsWith('{') && head.includes('"seqmap"');
}

const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const DENSITY_ACTORS = 8;
const DENSITY_STEPS = 24;

export function parseSeqMap(source: string): ISeqMapParseResult {
	const diagnostics: INodeMapDiagnostic[] = [];
	const error = (code: string, subject: string, message: string, fix?: string): void => {
		diagnostics.push({ code, severity: 'error', subject, message, fix });
	};
	const warn = (code: string, subject: string, message: string, fix?: string): void => {
		diagnostics.push({ code, severity: 'warning', subject, message, fix });
	};

	let raw: unknown;
	try {
		raw = JSON.parse(source);
	} catch (e) {
		error('map/json', 'source', `JSON inválido: ${e instanceof Error ? e.message : String(e)}`);
		return { diagnostics };
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		error('map/json', 'source', 'la fuente debe ser un objeto JSON');
		return { diagnostics };
	}
	const doc = raw as Record<string, unknown>;
	if (doc.type !== 'seqmap') {
		error('map/type', 'type', 'falta "type": "seqmap"');
		return { diagnostics };
	}
	const kinds: readonly string[] = NODE_MAP_KINDS.archmap;
	const title = typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : undefined;

	const actors: ISeqMapActor[] = [];
	const seenIds = new Set<string>();
	const rawActors = Array.isArray(doc.actors) ? doc.actors : undefined;
	if (!rawActors || rawActors.length < 2) {
		error('map/actors', 'actors', 'actors debe ser un array con al menos dos participantes');
		return { diagnostics };
	}
	rawActors.forEach((value, index) => {
		const subject = `actors[${index}]`;
		if (!value || typeof value !== 'object') {
			error('map/actor', subject, 'cada actor debe ser un objeto {id, label, kind}');
			return;
		}
		const actor = value as Record<string, unknown>;
		const id = typeof actor.id === 'string' ? actor.id.trim() : '';
		if (!id || !ID_PATTERN.test(id)) {
			error('map/actor-id', subject, 'id requerido: string estable con [A-Za-z0-9_.-]');
			return;
		}
		if (seenIds.has(id)) {
			error('map/actor-id', id, 'id duplicado');
			return;
		}
		const label = typeof actor.label === 'string' ? actor.label.trim() : '';
		if (!label) {
			error('map/actor-label', id, 'label requerido y no vacío');
			return;
		}
		const kind = typeof actor.kind === 'string' ? actor.kind.trim().toLowerCase() : '';
		if (!kinds.includes(kind)) {
			error('map/actor-kind', id, `kind "${String(actor.kind ?? '')}" no soportado`, `usá uno de: ${kinds.join(', ')}`);
			return;
		}
		const sublabel = typeof actor.sublabel === 'string' && actor.sublabel.trim() ? actor.sublabel.trim() : undefined;
		seenIds.add(id);
		actors.push({ id, label, kind, sublabel });
	});

	const steps: ISeqMapStep[] = [];
	const rawSteps = Array.isArray(doc.steps) ? doc.steps : undefined;
	if (!rawSteps || !rawSteps.length) {
		error('map/steps', 'steps', 'steps debe ser un array con al menos un mensaje');
		return { diagnostics };
	}
	rawSteps.forEach((value, index) => {
		const subject = `steps[${index}]`;
		if (!value || typeof value !== 'object') {
			error('map/step', subject, 'cada paso debe ser un objeto {from, to, label}');
			return;
		}
		const step = value as Record<string, unknown>;
		const from = typeof step.from === 'string' ? step.from.trim() : '';
		const to = typeof step.to === 'string' ? step.to.trim() : '';
		if (!seenIds.has(from) || !seenIds.has(to)) {
			error('map/step-endpoint', `${from || '?'}→${to || '?'}`, 'from y to deben referir ids de actors declarados', `ids declarados: ${[...seenIds].join(', ')}`);
			return;
		}
		// A message without text is a line with no meaning; a sequence lives on its labels.
		const label = typeof step.label === 'string' ? step.label.trim() : '';
		if (!label) {
			error('map/step-label', `${from}→${to}`, 'label requerido: qué viaja en el mensaje');
			return;
		}
		steps.push({ from, to, label, reply: step.reply === true, dashed: step.dashed === true || step.reply === true });
	});

	if (actors.length > DENSITY_ACTORS) {
		warn('map/density', 'actors', `${actors.length} actores; una secuencia legible tiene ≤ ${DENSITY_ACTORS}`);
	}
	if (steps.length > DENSITY_STEPS) {
		warn('map/density', 'steps', `${steps.length} pasos; contá UNA interacción, no todas`);
	}

	if (diagnostics.some(d => d.severity === 'error')) {
		return { diagnostics };
	}
	return { spec: { type: 'seqmap', title, actors, steps }, diagnostics };
}

// ---------------------------------- layout ----------------------------------

export interface ISeqMapPlacedActor extends ISeqMapActor {
	/** Centre of the actor's card. */
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

export interface ISeqMapPlacedStep extends ISeqMapStep {
	readonly fromX: number;
	readonly toX: number;
	readonly y: number;
	/** A message from an actor to itself, drawn as a small loop beside its lifeline. */
	readonly self: boolean;
}

export interface ISeqMapLayout {
	readonly width: number;
	readonly height: number;
	readonly actors: readonly ISeqMapPlacedActor[];
	readonly steps: readonly ISeqMapPlacedStep[];
	/** Where the lifelines end (below the last step). */
	readonly lifelineBottom: number;
}

const COLUMN_AIR = 74;
const ACTOR_TOP = 16;
const STEP_GAP = 48;
/** Air between the actor row and the first message. */
const HEAD_AIR = 44;
const PAD_X = 44;

const CHAR_W = 6.6;
const SUB_CHAR_W = 5.4;

/** Label-aware actor card, sized like the node maps': the text lives inside the shape. */
function measureActor(actor: ISeqMapActor): { w: number; h: number } {
	const textW = Math.max(actor.label.length * CHAR_W, (actor.sublabel?.length ?? 0) * SUB_CHAR_W);
	return {
		w: Math.max(96, Math.min(190, Math.round(textW) + 34)),
		h: actor.sublabel ? 50 : 38,
	};
}

/** Trivially deterministic: columns in declaration order, one row per step in authored order. */
export function layoutSeqMap(spec: ISeqMapSpec): ISeqMapLayout {
	const sizes = spec.actors.map(measureActor);
	const tallest = sizes.reduce((max, size) => Math.max(max, size.h), 38);
	const centers: number[] = [];
	let cursor = PAD_X;
	sizes.forEach((size, index) => {
		centers.push(cursor + size.w / 2);
		cursor += size.w + COLUMN_AIR;
		if (index === sizes.length - 1) { cursor -= COLUMN_AIR; }
	});
	const columnOf = new Map(spec.actors.map((actor, index) => [actor.id, centers[index]]));
	const actors: ISeqMapPlacedActor[] = spec.actors.map((actor, index) => ({
		...actor,
		x: centers[index],
		y: ACTOR_TOP + tallest / 2,
		w: sizes[index].w,
		h: sizes[index].h,
	}));
	const firstStepY = ACTOR_TOP + tallest + HEAD_AIR;
	const steps: ISeqMapPlacedStep[] = spec.steps.map((step, index) => ({
		...step,
		fromX: columnOf.get(step.from)!,
		toX: columnOf.get(step.to)!,
		y: firstStepY + index * STEP_GAP,
		self: step.from === step.to,
	}));
	const lifelineBottom = firstStepY + spec.steps.length * STEP_GAP;
	return {
		width: cursor + PAD_X,
		height: lifelineBottom + 24,
		actors,
		steps,
		lifelineBottom,
	};
}
