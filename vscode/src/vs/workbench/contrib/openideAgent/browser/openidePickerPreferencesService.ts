/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { mergeVisibleOrder, moveBeside, toggleMembership } from '../common/openidePickerOrder.js';

export const IOpenidePickerPreferencesService = createDecorator<IOpenidePickerPreferencesService>('openidePickerPreferences');
export interface IOpenidePickerPreferencesService {
	readonly _serviceBrand: undefined;
	getPickerFavorites(): string[];
	togglePickerFavorite(key: string): Promise<void>;
	reorderPickerFavorite(key: string, targetKey: string | undefined, after?: boolean): Promise<void>;
	getPickerRecents(): string[];
	recordPickerUse(key: string): Promise<void>;
	getProviderOrder(): string[];
	setProviderOrder(order: string[]): Promise<void>;
	getCollapsedSections(): string[];
	toggleCollapsedSection(key: string): Promise<void>;
	readonly onDidChange: Event<void>;
}

/** User-owned model picker preferences, persisted independently of agent execution. */
export class OpenidePickerPreferencesService extends Disposable implements IOpenidePickerPreferencesService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;
	constructor(@IStorageService private readonly storageService: IStorageService) { super(); }

	// ---- picker state (favorites, recents, provider order, collapsed sections) ----
	// All APPLICATION-scoped: collapsing a provider or starring a model is a preference about the
	// tool, not about a folder, so it must not reset when the window changes workspace.

	private static readonly STORAGE_FAVORITES = 'openide.agent.picker.favorites';

	private static readonly STORAGE_RECENTS = 'openide.agent.picker.recents';

	private static readonly STORAGE_PROVIDER_ORDER = 'openide.agent.picker.providerOrder';

	private static readonly STORAGE_COLLAPSED = 'openide.agent.picker.collapsed';

	/** Enough to cover a session's worth of switching without pushing the provider groups
	 *  off-screen. opencode's picker keeps a comparable window. */
	private static readonly RECENTS_LIMIT = 5;

	private readStringList(key: string): string[] {
		try {
			const parsed = JSON.parse(this.storageService.get(key, StorageScope.APPLICATION) || '[]');
			return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
		} catch {
			return [];			// entrada corrupta: se reconstruye sola con el próximo uso
		}
	}

	private writeStringList(key: string, values: string[]): void {
		this.storageService.store(key, JSON.stringify(values), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	getPickerFavorites(): string[] {
		return this.readStringList(OpenidePickerPreferencesService.STORAGE_FAVORITES);
	}

	/** Toggles a favorite. New favorites go last so the user's manual order is never disturbed. */
	async togglePickerFavorite(key: string): Promise<void> {
		this.writeStringList(OpenidePickerPreferencesService.STORAGE_FAVORITES, toggleMembership(this.getPickerFavorites(), key));
	}

	/** Moves `key` next to `targetKey`, on the side `after` selects. */
	async reorderPickerFavorite(key: string, targetKey: string | undefined, after = false): Promise<void> {
		this.writeStringList(OpenidePickerPreferencesService.STORAGE_FAVORITES, moveBeside(this.getPickerFavorites(), key, targetKey, after));
	}

	getPickerRecents(): string[] {
		return this.readStringList(OpenidePickerPreferencesService.STORAGE_RECENTS);
	}

	async recordPickerUse(key: string): Promise<void> {
		const next = [key, ...this.getPickerRecents().filter(entry => entry !== key)].slice(0, OpenidePickerPreferencesService.RECENTS_LIMIT);
		this.writeStringList(OpenidePickerPreferencesService.STORAGE_RECENTS, next);
	}

	getProviderOrder(): string[] {
		return this.readStringList(OpenidePickerPreferencesService.STORAGE_PROVIDER_ORDER);
	}

	/** Persists the order of the providers the picker can see. A disconnected provider is absent
	 *  from that list, so its stored slot is re-inserted here — otherwise reordering anything while
	 *  one is disconnected would silently demote it to the end once it comes back. */
	async setProviderOrder(visible: string[]): Promise<void> {
		this.writeStringList(OpenidePickerPreferencesService.STORAGE_PROVIDER_ORDER, mergeVisibleOrder(visible, this.getProviderOrder()));
	}

	getCollapsedSections(): string[] {
		return this.readStringList(OpenidePickerPreferencesService.STORAGE_COLLAPSED);
	}

	async toggleCollapsedSection(key: string): Promise<void> {
		// Presence means collapsed; anything unknown defaults to expanded.
		this.writeStringList(OpenidePickerPreferencesService.STORAGE_COLLAPSED, toggleMembership(this.getCollapsedSections(), key));
	}
}

registerSingleton(IOpenidePickerPreferencesService, OpenidePickerPreferencesService, InstantiationType.Delayed);
