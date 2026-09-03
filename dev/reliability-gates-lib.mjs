import fs from 'node:fs';
import path from 'node:path';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MATURITY = new Set(['experimental', 'soak', 'blocking']);
const ALLOWED_PLATFORMS = new Set(['linux', 'darwin', 'win32', 'web', 'remote']);
const REQUIRED_STRING_FIELDS = ['id', 'owner', 'layer', 'maturity', 'invariant', 'demotionRule'];
const REQUIRED_ARRAY_FIELDS = ['platforms', 'commands', 'tests', 'knownGaps', 'promotionCriteria'];
const GATE_KEYS = new Set([...REQUIRED_STRING_FIELDS, ...REQUIRED_ARRAY_FIELDS]);

function isNonEmptyString(value) {
	return typeof value === 'string' && value.trim().length > 0;
}

function validateRelativePath(root, value, field, index, errors) {
	if (!isNonEmptyString(value)) {
		errors.push(`gates[${index}].${field} contiene una ruta vacía.`);
		return;
	}
	const windowsUnsafe = path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith('\\');
	if (path.isAbsolute(value) || windowsUnsafe || value.split(/[\\/]/).includes('..')) {
		errors.push(`gates[${index}].${field} debe usar una ruta relativa segura: ${value}`);
		return;
	}
	const candidate = path.join(root, value);
	if (!fs.existsSync(candidate)) {
		errors.push(`gates[${index}].${field} no existe: ${value}`);
		return;
	}
	let rootReal;
	let candidateReal;
	try { rootReal = fs.realpathSync(root); candidateReal = fs.realpathSync(candidate); }
	catch { errors.push(`gates[${index}].${field} no se pudo resolver: ${value}`); return; }
	const relative = path.relative(rootReal, candidateReal);
	if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		errors.push(`gates[${index}].${field} sale del workspace: ${value}`);
		return;
	}
	if (!fs.statSync(candidateReal).isFile()) {
		errors.push(`gates[${index}].${field} debe apuntar a un archivo: ${value}`);
	}
}

export function validateReliabilityRegistry(registry, root) {
	const errors = [];
	if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
		return ['El registry debe ser un objeto JSON.'];
	}
	const rootKeys = Object.keys(registry);
	for (const key of rootKeys) {
		if (key !== 'schemaVersion' && key !== 'gates') { errors.push(`Campo raíz no permitido: ${key}`); }
	}
	if (registry.schemaVersion !== 1) { errors.push('schemaVersion debe ser exactamente 1.'); }
	if (!Array.isArray(registry.gates) || registry.gates.length === 0) {
		errors.push('gates debe ser un array no vacío.');
		return errors;
	}
	const ids = new Set();
	for (let index = 0; index < registry.gates.length; index++) {
		const gate = registry.gates[index];
		if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
			errors.push(`gates[${index}] debe ser un objeto.`);
			continue;
		}
		for (const key of Object.keys(gate)) {
			if (!GATE_KEYS.has(key)) { errors.push(`gates[${index}] contiene un campo no permitido: ${key}`); }
		}
		for (const field of REQUIRED_STRING_FIELDS) {
			if (!isNonEmptyString(gate[field])) { errors.push(`gates[${index}].${field} debe ser un string no vacío.`); }
		}
		if (isNonEmptyString(gate.id)) {
			if (!ID_PATTERN.test(gate.id)) { errors.push(`gates[${index}].id no es kebab-case: ${gate.id}`); }
			if (ids.has(gate.id)) { errors.push(`Gate duplicado: ${gate.id}`); }
			ids.add(gate.id);
		}
		if (isNonEmptyString(gate.maturity) && !MATURITY.has(gate.maturity)) {
			errors.push(`gates[${index}].maturity inválido: ${gate.maturity}`);
		}
		for (const field of REQUIRED_ARRAY_FIELDS) {
			const blockingPromotionCriteria = field === 'promotionCriteria' && gate.maturity === 'blocking';
			if (!Array.isArray(gate[field]) || (!blockingPromotionCriteria && gate[field].length === 0)) {
				errors.push(`gates[${index}].${field} debe ser un array${blockingPromotionCriteria ? '' : ' no vacío'}.`);
				continue;
			}
			if (blockingPromotionCriteria && gate[field].length !== 0) {
				errors.push(`gates[${index}].promotionCriteria debe estar vacío cuando maturity es blocking.`);
			}
			for (const value of gate[field]) {
				if (!isNonEmptyString(value)) { errors.push(`gates[${index}].${field} contiene un valor vacío.`); }
			}
		}
		if (Array.isArray(gate.platforms)) {
			const platforms = new Set();
			for (const platform of gate.platforms) {
				if (!ALLOWED_PLATFORMS.has(platform)) { errors.push(`gates[${index}].platforms contiene un valor inválido: ${platform}`); }
				if (platforms.has(platform)) { errors.push(`gates[${index}].platforms contiene un duplicado: ${platform}`); }
				platforms.add(platform);
			}
		}
		if (Array.isArray(gate.commands) && new Set(gate.commands).size !== gate.commands.length) {
			errors.push(`gates[${index}].commands contiene duplicados.`);
		}
		if (Array.isArray(gate.tests)) {
			for (const testPath of gate.tests) { validateRelativePath(root, testPath, 'tests', index, errors); }
		}
	}
	return errors;
}

export function readReliabilityRegistry(file) {
	let raw;
	try { raw = fs.readFileSync(file, 'utf8'); }
	catch (error) { throw new Error(`No se pudo leer ${file}: ${error instanceof Error ? error.message : String(error)}`); }
	try { return JSON.parse(raw); }
	catch (error) { throw new Error(`JSON inválido en ${file}: ${error instanceof Error ? error.message : String(error)}`); }
}
