/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — EditorInput for the full-screen diagram viewer. It opens in the NATIVE MODAL
 *  editor part (the same one Settings uses) via MODAL_GROUP.
 *
 *  It carries the diagram SOURCE, not a rendered picture: the native viewer draws it again with
 *  the same engine the chat uses (browser/diagrams), by DOM, so nothing is ever injected as
 *  markup. Images (screenshots) travel as a data/file URI. The `html` variant only exists for the
 *  callers that still hand over rendered markup; it is shown as an image and never parsed.
 *  No serializer: it is not restored across sessions.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { EditorInputCapabilities } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export type OpenideDiagramPayload =
	| { readonly kind: 'source'; readonly source: string }
	| { readonly kind: 'image'; readonly uri: string; readonly alt?: string }
	| { readonly kind: 'html'; readonly html: string };

/**
 * Accepts what the `openide.diagram.fullscreen` command receives: the typed payload, or one of
 * the legacy strings (`<img src=…>` from the screenshot part, rendered `<svg>` from the plan
 * webview). The legacy strings are classified here so every caller lands on the same viewer.
 */
export function toOpenideDiagramPayload(value: unknown): OpenideDiagramPayload | undefined {
	if (value && typeof value === 'object') {
		const candidate = value as Partial<{ kind: string; source: string; uri: string; html: string; alt: string }>;
		if (candidate.kind === 'source' && typeof candidate.source === 'string' && candidate.source) {
			return { kind: 'source', source: candidate.source };
		}
		if (candidate.kind === 'image' && typeof candidate.uri === 'string' && candidate.uri) {
			return { kind: 'image', uri: candidate.uri, alt: typeof candidate.alt === 'string' ? candidate.alt : undefined };
		}
		if (candidate.kind === 'html' && typeof candidate.html === 'string' && candidate.html) {
			return { kind: 'html', html: candidate.html };
		}
		return undefined;
	}
	if (typeof value !== 'string' || !value) {
		return undefined;
	}
	const img = /^\s*<img\s[^>]*src="([^"]+)"/i.exec(value);
	if (img) {
		return { kind: 'image', uri: img[1] };
	}
	return { kind: 'html', html: value };
}

export class OpenideDiagramInput extends EditorInput {

	static readonly ID = 'workbench.input.openideDiagram';

	constructor(
		readonly payload: OpenideDiagramPayload,
		private readonly title: string,
	) {
		super();
	}

	override get typeId(): string {
		return OpenideDiagramInput.ID;
	}

	override get resource(): URI {
		return URI.from({ scheme: 'openide-diagram', path: '/diagrama' });
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.RequiresModal;
	}

	override getName(): string {
		return this.title || 'Diagrama';
	}

	override matches(other: EditorInput): boolean {
		return other instanceof OpenideDiagramInput && JSON.stringify(other.payload) === JSON.stringify(this.payload);
	}
}
