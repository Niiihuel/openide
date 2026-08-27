/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — work memory del Project Map: qué entidades del grafo resultaron útiles en turnos
 *  anteriores, con decaimiento temporal. Núcleo puro (sin DI ni storage) para poder testearlo
 *  con un `now` inyectable y que la salida sea determinista.
 *
 *  Idea portada de Graphify: el outcome de una respuesta es señal gratis que hoy se tira. Una
 *  lección vieja pesa menos sola (half-life 30 días) — el conocimiento sobre código que cambió
 *  se desvanece sin que nadie lo purgue a mano.
 *--------------------------------------------------------------------------------------------*/

export type LearningState = 'preferred' | 'tentative' | 'contested';

export interface ILearningEntry {
	/** Suma ponderada de señales positivas. */
	pos: number;
	/** Suma ponderada de señales negativas. */
	neg: number;
	/** Timestamp de la última señal (base del decaimiento). */
	lastAt: number;
}

export const LEARNING_HALF_LIFE_DAYS = 30;
/** Bajo este peso la entrada no aporta nada y se poda (≈4 half-lives ≈ 120 días). */
export const LEARNING_EPSILON = 0.06;
/** Señales positivas ponderadas necesarias para pasar de `tentative` a `preferred`. */
const MIN_CORROBORATION = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clave estable de un nodo: SIN número de línea, para que la lección sobreviva a las ediciones
 *  (el `id` del grafo incluye la línea y se invalidaría con cualquier cambio arriba del archivo). */
export function learningKey(uri: string, qualifiedNameOrName: string): string {
	return `${uri}#${qualifiedNameOrName}`;
}

/** Peso de una señal según su antigüedad: 0.5^(días/30). */
export function decayWeight(lastAt: number, now: number): number {
	if (!lastAt || lastAt > now) { return 1; }
	return Math.pow(0.5, (now - lastAt) / DAY_MS / LEARNING_HALF_LIFE_DAYS);
}

/** Aplica una señal a una entrada, decayendo primero lo acumulado hasta ahora. */
export function applySignal(entry: ILearningEntry | undefined, weight: number, now: number): ILearningEntry {
	const decay = entry ? decayWeight(entry.lastAt, now) : 1;
	const pos = (entry ? entry.pos * decay : 0) + Math.max(0, weight);
	const neg = (entry ? entry.neg * decay : 0) + Math.max(0, -weight);
	// Redondeo estable: evita que el punto flotante haga ruido en tests y en el JSON persistido.
	return { pos: round(pos), neg: round(neg), lastAt: now };
}

function round(value: number): number { return Math.round(value * 1e6) / 1e6; }

/** Clasificación de Graphify: contested si hay señal en ambos sentidos; preferred requiere
 *  corroboración (2+), una sola señal positiva es apenas tentative. Sólo-negativo no se expone
 *  (no se le dice al modelo "esto no sirve", simplemente no se lo destaca). */
export function classify(entry: ILearningEntry, now: number): LearningState | undefined {
	const decay = decayWeight(entry.lastAt, now);
	const pos = entry.pos * decay;
	const neg = entry.neg * decay;
	if (pos < LEARNING_EPSILON && neg < LEARNING_EPSILON) { return undefined; }
	if (pos >= LEARNING_EPSILON && neg >= LEARNING_EPSILON) { return 'contested'; }
	if (pos >= MIN_CORROBORATION) { return 'preferred'; }
	if (pos >= LEARNING_EPSILON) { return 'tentative'; }
	return undefined;
}

/** True si la entrada ya no aporta señal y puede podarse. */
export function isExpired(entry: ILearningEntry, now: number): boolean {
	const decay = decayWeight(entry.lastAt, now);
	return entry.pos * decay < LEARNING_EPSILON && entry.neg * decay < LEARNING_EPSILON;
}

/** Poda las entradas expiradas. Devuelve un mapa nuevo (no muta el original). */
export function pruneExpired(entries: ReadonlyMap<string, ILearningEntry>, now: number): Map<string, ILearningEntry> {
	const out = new Map<string, ILearningEntry>();
	for (const [key, entry] of entries) {
		if (!isExpired(entry, now)) { out.set(key, entry); }
	}
	return out;
}
