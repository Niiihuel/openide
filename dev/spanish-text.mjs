/**
 * One Spanish detector, shared by the audits that need one.
 *
 * It lived inside `audit-comment-language.mjs` until `audit-prompt-language.mjs` needed the same
 * judgement. Two copies would have drifted, and the second copy started out weaker: it only looked
 * for accented characters, so it read "Cancela solo el subagente indicado." as English.
 *
 * The word lists are deliberately conservative. Homographs that are also English words (no, a, e,
 * o, si, me, he, son, van, la, in, is, as, use) are absent, so a line is only flagged on real
 * evidence and English prose about Spanish topics does not trip it.
 */

const ACCENTED = /[áéíóúñÁÉÍÓÚÑ¿¡]/;

/** Spanish function words that are not also English words. */
const SPANISH_WORDS = new Set([
	'que', 'para', 'porque', 'cuando', 'donde', 'pero', 'sino', 'desde', 'hasta',
	'entre', 'sobre', 'cada', 'este', 'esta', 'esto', 'eso', 'esos', 'esas',
	'aca', 'aqui', 'asi', 'solo', 'tambien', 'siempre', 'nunca', 'hay', 'del',
	'los', 'las', 'una', 'uno', 'con', 'sin', 'por', 'como', 'mas', 'menos',
	'hace', 'hacer', 'ser', 'estar', 'tiene', 'tienen', 'puede', 'pueden',
	'debe', 'deben', 'queda', 'quedan', 'vuelve', 'devuelve', 'muestra', 'usa',
	'evita', 'deja', 'permite', 'permiten', 'exige', 'exigen', 'sirve', 'viene',
	'pone', 'saca', 'corta', 'rompe', 'arregla', 'otros', 'otras', 'otro',
	'otra', 'mismo', 'misma', 'nada', 'todo', 'toda', 'todos', 'todas', 'cual',
	'cuyo', 'cuya', 'segun', 'aunque', 'mientras', 'entonces', 'luego',
	'ademas', 'incluso', 'tras', 'bajo', 'ante', 'hacia', 'durante', 'sean',
	'ahora', 'antes', 'despues', 'ya', 'lo', 'al', 'se', 'es', 'el', 'de', 'en',
	'un', 'y', 'su', 'sus', 'le', 'les', 'nos', 'muy', 'ni', 'sea',
	'propio', 'propia', 'cualquier', 'ninguna', 'ningun', 'alguna',
]);

/** One of these alone is enough — none of them is an English word. */
const STRONG = new Set([
	'porque', 'aunque', 'mientras', 'ademas', 'sino', 'tambien', 'siempre',
	'nunca', 'entonces', 'segun', 'cualquier', 'devuelve', 'queda', 'permite',
	'exige', 'despues', 'aqui', 'aca', 'asi',
]);

/**
 * Extra vocabulary for detecting Spanish in USER-VISIBLE STRINGS and model-facing text.
 *
 * Deliberately NOT used for comments. An English comment legitimately quotes a Spanish UI label
 * ("revisar el cambio", `archivo.ts (12-40)`), and adding these to the comment detector flagged
 * twenty such comments as untranslated when they were already English prose.
 */
const STRING_STRONG = new Set([
	'cancela', 'cancelar', 'seleccion', 'seleccionar', 'archivo', 'archivos',
	'carpeta', 'carpetas', 'vacio', 'vacia', 'guardar', 'guarda', 'cerrar',
	'abrir', 'abri', 'elegi', 'buscar', 'ruta', 'rutas', 'errores', 'ninguno',
	'conectado', 'conectar', 'proveedor', 'proveedores', 'ajustes', 'mensaje',
	'mensajes', 'conversacion', 'herramienta', 'herramientas', 'usuario',
]);

/** True when the line reads as Spanish: an accent, one unmistakable word, or three common ones. */
export function isSpanish(line) {
	if (ACCENTED.test(line)) { return true; }
	const words = new Set(line.toLowerCase().match(/[a-z]+/g) ?? []);
	for (const w of words) { if (STRONG.has(w)) { return true; } }
	let hits = 0;
	for (const w of words) { if (SPANISH_WORDS.has(w)) { hits++; } }
	return hits >= 3;
}

/**
 * Like `isSpanish`, plus the vocabulary that only makes sense when the text IS the string rather
 * than prose describing one. Use this for UI strings, tool schemas and prompts.
 */
export function isSpanishString(text) {
	if (isSpanish(text)) { return true; }
	const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
	for (const w of words) { if (STRING_STRONG.has(w)) { return true; } }
	return false;
}
