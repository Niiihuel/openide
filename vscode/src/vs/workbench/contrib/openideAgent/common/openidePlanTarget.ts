/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — resolves a plan's execution target. A pure, dependency-free module so that ONE
 *  single definition of "which model runs this plan" exists: it is used by the breadcrumb button
 *  and by buildPlan. When each applied its own fallback, the button showed the word "Model"
 *  while Build started with the provider default — two different answers to the same question,
 *  with no way to notice the difference until the turn had already run.
 *--------------------------------------------------------------------------------------------*/

export interface IPlanFrontmatterTarget {
	readonly execProvider?: string;
	readonly execModel?: string;
}

export interface IPlanTargetContext {
	/** Active chat provider ('' when none is connected). */
	readonly activeProviderId: string;
	/** Model chosen in the chat for a given provider ('' when the user never chose one). */
	readonly modelForProvider: (providerId: string) => string;
	/** Default model from the provider catalog ('' when it declares none). */
	readonly defaultModelForProvider: (providerId: string) => string;
}

export interface IPlanTarget {
	readonly providerId: string;
	readonly model: string;
}

/**
 * Frontmatter wins: if the plan pinned execProvider/execModel, that is honored. If it did not,
 * the plan runs with whatever the chat uses — which is why picking a model in the chat is
 * reflected in the plan without touching the .md. The catalog default is the last resort.
 */
export function resolvePlanTarget(frontmatter: IPlanFrontmatterTarget, context: IPlanTargetContext): IPlanTarget {
	const providerId = frontmatter.execProvider || context.activeProviderId;
	const model = frontmatter.execModel || context.modelForProvider(providerId) || context.defaultModelForProvider(providerId) || '';
	return { providerId, model };
}
