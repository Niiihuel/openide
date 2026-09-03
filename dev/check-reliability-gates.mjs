#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReliabilityRegistry, validateReliabilityRegistry } from './reliability-gates-lib.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const file = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.join(scriptDir, 'reliability-gates.json');

try {
	const registry = readReliabilityRegistry(file);
	const errors = validateReliabilityRegistry(registry, root);
	if (errors.length) {
		console.error(`Reliability gates inválidos (${errors.length}):\n- ${errors.join('\n- ')}`);
		process.exitCode = 1;
	} else {
		const counts = registry.gates.reduce((result, gate) => {
			result[gate.maturity] = (result[gate.maturity] ?? 0) + 1;
			return result;
		}, {});
		console.log(`Reliability gates: OK (${registry.gates.length}; blocking=${counts.blocking ?? 0}, soak=${counts.soak ?? 0}, experimental=${counts.experimental ?? 0})`);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
