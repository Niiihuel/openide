/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideChatContent, isOpenideChatToolContent } from './openideChatContent.js';

export interface IOpenideChatWebPreview {
	readonly url: string;
	readonly title: string;
}

/** Recover the native navigation result from live calls and saved transcripts alike. */
export function webPreviewFromTool(content: IOpenideChatContent): IOpenideChatWebPreview | undefined {
	if (!isOpenideChatToolContent(content) || content.name !== 'browser_navigate' || content.state !== 'success') { return undefined; }
	const match = /^OK: loaded (\S+) \(title: ([\s\S]*)\)\.$/.exec(content.resultText ?? '');
	if (!match) { return undefined; }
	try {
		const url = new URL(match[1]);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { return undefined; }
		return { url: url.href, title: match[2] === 'untitled' ? '' : match[2].trim() };
	} catch { return undefined; }
}
