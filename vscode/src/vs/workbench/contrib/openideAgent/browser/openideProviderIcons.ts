/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — brand adapter for native DOM and isolated webviews.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64 } from '../../../../base/common/buffer.js';
import { FileAccess } from '../../../../base/common/network.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IProviderBrand, OPENIDE_PROVIDER_BRANDS, ProviderBrandAsset, resolveProviderBrand } from '../common/openideProviderBranding.js';
import './media/openideProviderIcon.css';

const ICON_ROOT = 'vs/workbench/contrib/openideAgent/browser/media/providerIcons/';

export interface ISerializedProviderIcon {
	readonly name: string;
	readonly initials: string;
	readonly uri?: string;
}

let cachedWebviewIcons: Promise<Readonly<Record<string, ISerializedProviderIcon>>> | undefined;
const nativeIconLoads = new Map<string, { state: 'loading' | 'ready' | 'failed'; targets: Set<HTMLElement> }>();

function assetBrowserUri(asset: ProviderBrandAsset): string {
	return FileAccess.asBrowserUri(`${ICON_ROOT}${asset}` as Parameters<typeof FileAccess.asBrowserUri>[0]).toString(true);
}

function showProviderMonogram(element: HTMLElement, brand: IProviderBrand): void {
	element.classList.remove('logo-ready');
	element.classList.add('monogram');
	element.removeAttribute('data-provider-icon-uri');
	element.style.webkitMaskImage = '';
	element.style.maskImage = '';
	element.textContent = brand.initials;
}

function showProviderMask(element: HTMLElement, uri: string): void {
	const value = `url("${uri}")`;
	element.classList.remove('monogram');
	element.classList.add('logo-ready');
	element.textContent = '';
	element.style.webkitMaskImage = value;
	element.style.maskImage = value;
}

function loadProviderMask(element: HTMLElement, brand: IProviderBrand, uri: string): void {
	element.setAttribute('data-provider-icon-uri', uri);
	const existing = nativeIconLoads.get(uri);
	if (existing?.state === 'ready') {
		showProviderMask(element, uri);
		return;
	}
	showProviderMonogram(element, brand);
	element.setAttribute('data-provider-icon-uri', uri);
	if (existing?.state === 'failed') {
		return;
	}
	if (existing) {
		existing.targets.add(element);
		return;
	}
	const load = { state: 'loading' as const, targets: new Set<HTMLElement>([element]) };
	nativeIconLoads.set(uri, load);
	const image = element.ownerDocument.createElement('img');
	image.addEventListener('load', () => {
		nativeIconLoads.set(uri, { state: 'ready', targets: new Set() });
		for (const target of load.targets) {
			if (target.getAttribute('data-provider-icon-uri') === uri) {
				showProviderMask(target, uri);
			}
		}
		load.targets.clear();
	}, { once: true });
	image.addEventListener('error', () => {
		nativeIconLoads.set(uri, { state: 'failed', targets: new Set() });
		load.targets.clear();
	}, { once: true });
	image.src = uri;
}

export function applyProviderIcon(element: HTMLElement, providerId: string, label = ''): void {
	const brand = resolveProviderBrand(providerId, label);
	element.classList.add('openide-provider-icon');
	element.setAttribute('aria-hidden', 'true');
	element.setAttribute('data-provider-brand', brand.name);
	if (brand.asset) {
		loadProviderMask(element, brand, assetBrowserUri(brand.asset));
	} else {
		showProviderMonogram(element, brand);
	}
}

export function createProviderIcon(document: Document, providerId: string, label = '', className = ''): HTMLElement {
	const element = document.createElement('span');
	if (className) {
		element.className = className;
	}
	applyProviderIcon(element, providerId, label);
	return element;
}

async function readAssetDataUri(fileService: IFileService, asset: ProviderBrandAsset): Promise<string | undefined> {
	try {
		const file = await fileService.readFile(FileAccess.asFileUri(`${ICON_ROOT}${asset}` as Parameters<typeof FileAccess.asFileUri>[0]));
		return `data:image/svg+xml;base64,${encodeBase64(file.value)}`;
	} catch {
		return undefined;
	}
}

/** Cached once per renderer: webviews receive local data URIs and never contact SVGL at runtime. */
export function buildProviderIconData(fileService: IFileService): Promise<Readonly<Record<string, ISerializedProviderIcon>>> {
	if (!cachedWebviewIcons) {
		cachedWebviewIcons = (async () => {
			const assets = [...new Set(Object.values(OPENIDE_PROVIDER_BRANDS).map(brand => brand.asset).filter((asset): asset is ProviderBrandAsset => !!asset))];
			const data = new Map<ProviderBrandAsset, string | undefined>(await Promise.all(assets.map(async asset => [asset, await readAssetDataUri(fileService, asset)] as const)));
			const result: Record<string, ISerializedProviderIcon> = Object.create(null);
			for (const [providerId, brand] of Object.entries(OPENIDE_PROVIDER_BRANDS)) {
				result[providerId] = { name: brand.name, initials: brand.initials, uri: brand.asset ? data.get(brand.asset) : undefined };
			}
			return result;
		})();
	}
	return cachedWebviewIcons;
}

export function serializeProviderIconData(data: Readonly<Record<string, ISerializedProviderIcon>>): string {
	return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function providerBrand(providerId: string, label = ''): IProviderBrand {
	return resolveProviderBrand(providerId, label);
}
