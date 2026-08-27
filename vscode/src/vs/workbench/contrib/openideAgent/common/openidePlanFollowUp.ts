/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Explicit user decision for a request sent while Plan is still working. */
export type PlanFollowUpDisposition = 'integrate' | 'replace';

export function normalizePlanFollowUpDisposition(value: unknown): PlanFollowUpDisposition | undefined {
	return value === 'integrate' || value === 'replace' ? value : undefined;
}

/**
 * Turns an operational composer action into an instruction portable to any model.
 * It depends on neither tool calling nor provider-specific metadata: the user's visible text is
 * kept separately and this contract is only used as the turn's modelText.
 */
export function buildPlanFollowUpPrompt(instruction: string, disposition: PlanFollowUpDisposition): string {
	const request = instruction.trim();
	if (disposition === 'replace') {
		return [
			'[REEMPLAZO DEL PLAN EN CURSO]',
			'El usuario decidió reemplazar la tarea que estabas planificando. Tomá la solicitud siguiente como el nuevo objetivo principal; no mezcles tareas del objetivo anterior salvo contexto técnico que siga siendo necesario.',
			'Explorá lo necesario y generá un plan completo nuevo siguiendo las reglas del modo Plan.',
			'',
			'Solicitud nueva:',
			request,
		].join('\n');
	}

	return [
		'[ACTUALIZACIÓN DEL PLAN EN CURSO]',
		'El usuario indicó que esta solicitud está relacionada con la tarea que estabas planificando. Integrala al mismo objetivo y generá una versión completa y coherente del plan; no la conviertas en una tarea separada.',
		'Conservá las decisiones y hallazgos anteriores que sigan siendo válidos, corregí los que entren en conflicto y evitá repetir exploración ya resuelta. No guardes esta petición transitoria en la memoria duradera del proyecto.',
		'',
		'Nueva instrucción a integrar:',
		request,
	].join('\n');
}
