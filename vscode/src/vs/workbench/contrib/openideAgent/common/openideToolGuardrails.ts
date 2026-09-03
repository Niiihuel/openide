/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — guardrails deterministas para llamadas repetidas y argumentos JSON incompletos.
 *--------------------------------------------------------------------------------------------*/

export interface IToolLoopDecision {
	readonly occurrence: number;
	readonly warn: boolean;
	readonly block: boolean;
}

const IGNORED_REPEAT_TOOLS = new Set(['update_todos']);

function stableSignature(name: string, argumentsJson: string): string {
	return `${name}\u0000${argumentsJson.trim().replace(/\s+/g, ' ')}`;
}

export class OpenideToolCallGuard {
	private readonly occurrences = new Map<string, number>();

	inspect(name: string, argumentsJson: string): IToolLoopDecision {
		if (IGNORED_REPEAT_TOOLS.has(name)) {
			return { occurrence: 1, warn: false, block: false };
		}
		const signature = stableSignature(name, argumentsJson);
		const occurrence = (this.occurrences.get(signature) ?? 0) + 1;
		this.occurrences.set(signature, occurrence);
		return {
			occurrence,
			warn: occurrence === 3,
			block: occurrence >= 4,
		};
	}
}

function matchesJsonType(value: unknown, type: string): boolean {
	switch (type) {
		case 'object': return !!value && typeof value === 'object' && !Array.isArray(value);
		case 'array': return Array.isArray(value);
		case 'string': return typeof value === 'string';
		case 'number': return typeof value === 'number' && Number.isFinite(value);
		case 'integer': return typeof value === 'number' && Number.isInteger(value);
		case 'boolean': return typeof value === 'boolean';
		case 'null': return value === null;
		default: return true;
	}
}

export function validateToolArguments(parameters: object, value: unknown): string[] {
	const schema = parameters as Record<string, unknown>;
	const errors: string[] = [];
	if (schema.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
		return ['los argumentos deben ser un objeto JSON'];
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return errors;
	}
	const record = value as Record<string, unknown>;
	for (const key of Array.isArray(schema.required) ? schema.required : []) {
		if (typeof key === 'string' && (!(key in record) || record[key] === undefined || record[key] === null || record[key] === '')) {
			errors.push(`falta el parámetro requerido "${key}"`);
		}
	}
	const properties = schema.properties && typeof schema.properties === 'object'
		? schema.properties as Record<string, unknown>
		: {};
	for (const [key, propertyValue] of Object.entries(properties)) {
		if (!(key in record) || !propertyValue || typeof propertyValue !== 'object') {
			continue;
		}
		const property = propertyValue as Record<string, unknown>;
		const acceptedTypes = Array.isArray(property.type) ? property.type : [property.type];
		if (acceptedTypes.some(type => typeof type === 'string') && !acceptedTypes.some(type => typeof type === 'string' && matchesJsonType(record[key], type))) {
			errors.push(`"${key}" tiene un tipo inválido`);
		}
		if (Array.isArray(property.enum) && !property.enum.some(item => Object.is(item, record[key]))) {
			errors.push(`"${key}" debe ser uno de: ${property.enum.map(String).join(', ')}`);
		}
	}
	return errors;
}

/** Reparaciones conservadoras: fences, texto alrededor del objeto y trailing commas. */
export function repairToolArgumentsJson(value: string): string | undefined {
	const original = String(value ?? '').trim();
	if (!original) {
		return '{}';
	}
	try {
		JSON.parse(original);
		return original;
	} catch {
		// continues with bounded repairs
	}

	let candidate = original
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '')
		.trim();
	const firstObject = candidate.indexOf('{');
	const lastObject = candidate.lastIndexOf('}');
	if (firstObject >= 0 && lastObject > firstObject) {
		candidate = candidate.slice(firstObject, lastObject + 1);
	}
	candidate = candidate.replace(/,\s*([}\]])/g, '$1');
	try {
		JSON.parse(candidate);
		return candidate;
	} catch {
		return undefined;
	}
}
