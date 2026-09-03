/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — index arithmetic for the picker's drag-to-reorder.
 *
 *  Kept pure and apart from the service because this is where reordering goes wrong: inserting
 *  always BEFORE the drop target makes "move down one slot" a silent no-op (the item is removed
 *  from in front of the target and put back in front of it) and makes the last position
 *  unreachable. Both are expressible only with an explicit before/after side.
 *--------------------------------------------------------------------------------------------*/

/**
 * Moves `item` next to `target`, on the side given by `after`.
 *
 * The target index is resolved AFTER removing `item`, so it already accounts for the hole the
 * item leaves behind when it travels downwards. An unknown or absent `target` appends, which is
 * what a drop past the end of the list means.
 */
export function moveBeside(list: readonly string[], item: string, target: string | undefined, after: boolean): string[] {
	const next = list.filter(entry => entry !== item);
	const index = target ? next.indexOf(target) : -1;
	if (index < 0) {
		next.push(item);
	} else {
		next.splice(index + (after ? 1 : 0), 0, item);
	}
	return next;
}

/**
 * Folds the order of the currently visible providers back into the stored order.
 *
 * The picker only shows connected providers, so a drag reports an order that omits the
 * disconnected ones. Appending those leftovers would demote a provider to the end of the list
 * just because it happened to be disconnected while something else was dragged; re-inserting
 * each at its stored index keeps its slot for when it comes back.
 */
export function mergeVisibleOrder(visible: readonly string[], stored: readonly string[]): string[] {
	const next = visible.filter((id, index) => visible.indexOf(id) === index);
	stored.forEach((id, index) => {
		if (!next.includes(id)) {
			next.splice(Math.min(index, next.length), 0, id);
		}
	});
	return next;
}

/** Toggles membership in a set persisted as a list, preserving the order of what stays. */
export function toggleMembership(list: readonly string[], key: string): string[] {
	return list.includes(key) ? list.filter(entry => entry !== key) : [...list, key];
}
