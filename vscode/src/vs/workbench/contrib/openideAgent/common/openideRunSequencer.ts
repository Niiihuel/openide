/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Serializes operations while preserving each operation's own result or error.
 * A failed operation never poisons the queue for later work.
 */
export class OpenideRunSequencer {
	private tail: Promise<void> = Promise.resolve();

	queue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		this.tail = result.then(() => undefined, () => undefined);
		return result;
	}
}
