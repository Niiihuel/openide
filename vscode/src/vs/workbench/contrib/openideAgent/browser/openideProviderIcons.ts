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
import { IProviderBrand, OPENIDE_PROVIDER_BRANDS, ProviderBrandAsset, ProviderBrandPaint, resolveProviderBrand } from '../common/openideProviderBranding.js';
import './media/openideProviderIcon.css';

const ICON_ROOT = 'vs/workbench/contrib/openideAgent/browser/media/providerIcons/';

export interface ISerializedProviderIcon {
	readonly name: string;
	readonly initials: string;
	readonly uri?: string;
	readonly paint?: ProviderBrandPaint;
}

let cachedWebviewIcons: Promise<Readonly<Record<string, ISerializedProviderIcon>>> | undefined;
const nativeIconLoads = new Map<string, { state: 'loading' | 'ready' | 'failed'; targets: Map<HTMLElement, IProviderBrand> }>();

function assetBrowserUri(asset: ProviderBrandAsset): string {
	return FileAccess.asBrowserUri(`${ICON_ROOT}${asset}` as Parameters<typeof FileAccess.asBrowserUri>[0]).toString(true);
}

function showProviderMonogram(element: HTMLElement, brand: IProviderBrand): void {
	element.classList.remove('logo-ready', 'logo-image');
	element.classList.add('monogram');
	element.removeAttribute('data-provider-icon-uri');
	element.style.webkitMaskImage = '';
	element.style.maskImage = '';
	element.style.backgroundImage = '';
	element.style.removeProperty('--oi-brand-tint');
	element.textContent = brand.initials;
}

/**
 * Paints the mark the way its brand asks (`IProviderBrand.paint`): a self-coloured SVG as the
 * element's background image, a tinted or plain silhouette through a mask. The mask is the
 * default because it is what makes a third-party logo read as part of the IDE — it takes the
 * surface's ink — and the tint only replaces that ink where the brand's colour is the mark.
 */
function showProviderMark(element: HTMLElement, brand: IProviderBrand, uri: string): void {
	const value = `url("${uri}")`;
	element.classList.remove('monogram');
	element.textContent = '';
	if (brand.paint === 'full') {
		element.classList.remove('logo-ready');
		element.classList.add('logo-image');
		element.style.webkitMaskImage = '';
		element.style.maskImage = '';
		element.style.removeProperty('--oi-brand-tint');
		element.style.backgroundImage = value;
		return;
	}
	element.classList.remove('logo-image');
	element.classList.add('logo-ready');
	element.style.backgroundImage = '';
	element.style.webkitMaskImage = value;
	element.style.maskImage = value;
	if (brand.paint?.tint) {
		element.style.setProperty('--oi-brand-tint', brand.paint.tint);
	} else {
		element.style.removeProperty('--oi-brand-tint');
	}
}

function loadProviderMask(element: HTMLElement, brand: IProviderBrand, uri: string): void {
	element.setAttribute('data-provider-icon-uri', uri);
	const existing = nativeIconLoads.get(uri);
	if (existing?.state === 'ready') {
		showProviderMark(element, brand, uri);
		return;
	}
	showProviderMonogram(element, brand);
	element.setAttribute('data-provider-icon-uri', uri);
	if (existing?.state === 'failed') {
		return;
	}
	if (existing) {
		existing.targets.set(element, brand);
		return;
	}
	const load = { state: 'loading' as const, targets: new Map<HTMLElement, IProviderBrand>([[element, brand]]) };
	nativeIconLoads.set(uri, load);
	const image = element.ownerDocument.createElement('img');
	image.addEventListener('load', () => {
		nativeIconLoads.set(uri, { state: 'ready', targets: new Map() });
		for (const [target, targetBrand] of load.targets) {
			if (target.getAttribute('data-provider-icon-uri') === uri) {
				showProviderMark(target, targetBrand, uri);
			}
		}
		load.targets.clear();
	}, { once: true });
	image.addEventListener('error', () => {
		nativeIconLoads.set(uri, { state: 'failed', targets: new Map() });
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
				result[providerId] = { name: brand.name, initials: brand.initials, uri: brand.asset ? data.get(brand.asset) : undefined, paint: brand.paint };
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
