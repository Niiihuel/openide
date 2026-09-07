/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** One model row in the picker, already formatted for display. The webview receives this over
 *  postMessage and renders it verbatim — it never sees the models.dev registry. */
export interface IOpenidePickerModel {
	/** Raw id, exactly as it must be sent to the provider. */
	readonly id: string;
	/** models.dev `name` when published, otherwise a humanized id. */
	readonly name: string;
	/** Context window, locale-formatted (`500 mil`). Empty when the model publishes none. */
	readonly context: string;
	readonly toolCall: boolean;
	readonly reasoning: boolean;
	readonly input: string[];
	readonly output: string[];
	readonly costIn: string;
	readonly costOut: string;
	/** `false` for subscription and local models, which publish no price. */
	readonly hasCost: boolean;
	/** Effort levels this model accepts. Empty means it grades nothing. */
	readonly efforts: string[];
	/** Thinking is on/off rather than graded. */
	readonly toggle: boolean;
}

export interface IOpenidePickerGroup {
	readonly id: string;
	readonly label: string;
	readonly defaultModel: string;
	readonly models: IOpenidePickerModel[];
}
