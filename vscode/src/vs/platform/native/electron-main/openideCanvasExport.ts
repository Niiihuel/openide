/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Readable } from 'stream';
import { BrowserWindow } from 'electron';
import { VSBuffer } from '../../../base/common/buffer.js';
interface SlideItem {
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
	color: string;
	fill: string;
	size: number;
	kind: string;
	image?: Buffer;
	shape?: string;
	points?: number[][];
	rotation?: number;
	padding?: number;
	stroke?: string;
	font?: string;
	centered?: boolean;
}
interface SlidePage {
	title: string;
	width: number;
	height: number;
	items: SlideItem[];
	background?: string;
}
const xml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const color = (value: string, fallback = '202321'): string => { if (/^#[0-9a-f]{6}$/i.test(value)) {
	return value.slice(1);
} const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value); return match ? match.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('') : fallback; };
const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xml(target)}"/>`;
const relationships = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main', p = 'http://schemas.openxmlformats.org/presentationml/2006/main', r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
/** Editable DrawingML text/shapes; imported images and 3D views remain image objects. */
export async function createCanvasPptx(pages: SlidePage[], title: string): Promise<VSBuffer> {
	const { ZipFile } = await import('yazl');
	const archive = new ZipFile();
	const entries = new Map<string, string | Buffer>();
	let imageIndex = 0;
	entries.set('_rels/.rels', relationships(rel('rId1', 'officeDocument', 'ppt/presentation.xml') + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'));
	entries.set('docProps/core.xml', `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>OpenIDE</dc:creator></cp:coreProperties>`);
	entries.set('ppt/presentation.xml', `<p:presentation xmlns:a="${a}" xmlns:r="${r}" xmlns:p="${p}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="10058400" cy="6400800" type="custom"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
	entries.set('ppt/_rels/presentation.xml.rels', relationships(rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml') + pages.map((_, i) => rel(`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`)).join('')));
	entries.set('ppt/slideMasters/slideMaster1.xml', `<p:sldMaster xmlns:a="${a}" xmlns:r="${r}" xmlns:p="${p}"><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
	entries.set('ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships(rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml') + rel('rId2', 'theme', '../theme/theme1.xml')));
	entries.set('ppt/slideLayouts/slideLayout1.xml', `<p:sldLayout xmlns:a="${a}" xmlns:r="${r}" xmlns:p="${p}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
	entries.set('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships(rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')));
	const scheme = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
	entries.set('ppt/theme/theme1.xml', `<a:theme xmlns:a="${a}" name="OpenIDE"><a:themeElements><a:clrScheme name="OpenIDE">${scheme.map((name, i) => `<a:${name}><a:srgbClr val="${i % 2 ? 'FFFFFF' : '202321'}"/></a:${name}>`).join('')}</a:clrScheme><a:fontScheme name="OpenIDE"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="OpenIDE"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`);
	for (const [index, page] of pages.entries()) {
		let relations = rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml');
		let shapes = '';
		const scale = Math.min(10058400 / page.width, 6400800 / page.height);
		const emu = (n: number) => Math.round(n * scale);
		for (const [i, item] of page.items.entries()) {
			const id = i + 2, xfrm = `<a:xfrm rot="${Math.round((item.rotation ?? 0) * 60000)}"><a:off x="${emu(item.x)}" y="${emu(item.y)}"/><a:ext cx="${Math.max(1, emu(item.width))}" cy="${Math.max(1, emu(item.height))}"/></a:xfrm>`;
			if (item.image) {
				const name = `image${++imageIndex}.png`;
				entries.set(`ppt/media/${name}`, item.image);
				const rid = `rId${i + 2}`;
				relations += rel(rid, 'image', `../media/${name}`);
				shapes += `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xml(item.text || 'Canvas image')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
				continue;
			}
			const fill = item.fill && item.fill !== 'rgba(0, 0, 0, 0)' ? `<a:solidFill><a:srgbClr val="${color(item.fill)}"/></a:solidFill>` : '<a:noFill/>';
			shapes += `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(item.kind + ' ' + id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="${item.shape === 'ellipse' ? 'ellipse' : item.shape === 'arrow' ? 'rightArrow' : item.shape === 'line' ? 'line' : 'rect'}"><a:avLst/></a:prstGeom>${fill}<a:ln>${item.stroke ? `<a:solidFill><a:srgbClr val="${color(item.stroke)}"/></a:solidFill>` : '<a:noFill/>'}</a:ln></p:spPr><p:txBody><a:bodyPr anchor="${item.centered ? 'ctr' : 't'}" wrap="${item.kind === 'button' ? 'none' : 'square'}" lIns="${emu(item.padding ?? 0)}" tIns="${emu(item.padding ?? 0)}" rIns="${emu(item.padding ?? 0)}" bIns="${emu(item.padding ?? 0)}"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${item.text.split('\n').map(line => `<a:p><a:pPr algn="${item.centered ? 'ctr' : 'l'}"/><a:r><a:rPr lang="en-US" sz="${Math.max(100, Math.round(item.size * 100 * scale / 12700))}"><a:solidFill><a:srgbClr val="${color(item.color)}"/></a:solidFill><a:latin typeface="${xml(item.font ?? 'Arial')}"/></a:rPr><a:t xml:space="preserve">${xml(line)}</a:t></a:r><a:endParaRPr/></a:p>`).join('')}</p:txBody></p:sp>`;
		}
		entries.set(`ppt/slides/slide${index + 1}.xml`, `<p:sld xmlns:a="${a}" xmlns:r="${r}" xmlns:p="${p}"><p:cSld name="${xml(page.title)}"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color(page.background ?? '#ffffff')}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
		entries.set(`ppt/slides/_rels/slide${index + 1}.xml.rels`, relationships(relations));
	}
	entries.set('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${pages.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`);
	const chunks: Buffer[] = [];
	let bytes = 0;
	const output = new Promise<VSBuffer>((resolve, reject) => { archive.outputStream.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 30000000) {
		(archive.outputStream as Readable).destroy(new Error('PPTX exceeds export budget.'));
	}
	else {
		chunks.push(chunk);
	} }); archive.outputStream.once('error', reject); archive.outputStream.once('end', () => resolve(VSBuffer.wrap(Buffer.concat(chunks)))); });
	for (const [name, data] of entries) {
		archive.addBuffer(typeof data === 'string' ? Buffer.from(data) : data, name);
	}
	archive.end();
	return output;
}
/** Runs inside the isolated export renderer. Rasterize only the object's pixels, never its neighbors. */
async function snapshotCanvasPage(index: number) {
	const page = document.querySelectorAll<HTMLElement>('.export-page')[index];
	const pageRect = page.getBoundingClientRect();
	const elements = Array.from(page.querySelectorAll<HTMLElement>('[data-node]'));
	if (!elements.length && page.querySelector('svg')) {
		elements.push(page);
	}
	const items = [];
	for (const element of elements) {
		const control = element.querySelector<HTMLButtonElement>('button');
		const el = control ?? element, rect = el.getBoundingClientRect(), style = getComputedStyle(el), svg = el.querySelector('svg');
		const kind = element.className.includes('kind-') ? element.className.split('kind-')[1].split(' ')[0] : 'model';
		const shape = svg?.querySelector('ellipse') ? 'ellipse' : svg?.querySelector('path') ? 'arrow' : svg?.querySelector('line') ? 'line' : 'rectangle';
		const text = svg?.querySelector('text')?.textContent ?? Array.from(el.childNodes).filter(child => !(child instanceof Element && child.hasAttribute('data-node'))).map(child => child instanceof HTMLElement ? child.innerText : child.textContent ?? '').join('');
		const matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
		const rotation = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
		const width = el.offsetWidth, height = el.offsetHeight;
		let imageData: string | undefined;
		if (['image', 'model', 'path'].includes(kind)) {
			const image = new Image();
			const canvas = document.createElement('canvas');
			canvas.width = Math.min(4000, Math.max(1, Math.ceil(width)));
			canvas.height = Math.min(8000, Math.max(1, Math.ceil(height)));
			if (canvas.width * canvas.height > 16000000) {
				throw new Error('Object exceeds raster export budget.');
			}
			const imported = el.querySelector('img');
			if (imported) {
				image.src = imported.src;
			}
			else if (svg) {
				const copy = svg.cloneNode(true) as SVGSVGElement;
				copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
				copy.setAttribute('width', String(canvas.width));
				copy.setAttribute('height', String(canvas.height));
				image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));
			}
			if (image.src) {
				await image.decode();
				const context = canvas.getContext('2d')!;
				const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
				const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
				context.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
				imageData = canvas.toDataURL('image/png');
			}
		}
		items.push({ x: rect.x - pageRect.x + (rect.width - width) / 2, y: rect.y - pageRect.y + (rect.height - height) / 2, width, height, rotation, text, color: svg?.querySelector('text')?.getAttribute('fill') || style.color, fill: svg?.querySelector('rect,ellipse')?.getAttribute('fill') || (shape === 'arrow' ? style.color : style.backgroundColor), size: parseFloat(style.fontSize), padding: control ? 0 : parseFloat(style.paddingLeft) || 0, font: style.fontFamily.split(',')[0].replace(/['"]/g, ''), stroke: parseFloat(style.borderWidth) > 0 ? style.borderColor : shape === 'line' ? style.color : undefined, kind, shape, imageData, centered: !!control || !!svg?.querySelector('text') });
	}
	return { title: page.getAttribute('aria-label') || 'Canvas', width: page.scrollWidth, height: page.scrollHeight, background: getComputedStyle(page).backgroundColor, items };
}
let exporting = false;
/** Isolated, bounded native document renderer. No Node, network, downloads or host permissions. */
export async function exportCanvasDocument(html: string, format: 'pdf' | 'pptx', title: string): Promise<VSBuffer> {
	if (exporting) {
		throw new Error('A Canvas document export is already running.');
	}
	if (typeof html !== 'string' || Buffer.byteLength(html) > 32000000 || !['pdf', 'pptx'].includes(format)) {
		throw new Error('Invalid Canvas export request.');
	}
	exporting = true;
	let window: BrowserWindow | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		window = new BrowserWindow({ show: false, width: 1120, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `canvas-export-${Date.now()}-${Math.random()}` } });
		const contents = window.webContents;
		contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
		contents.session.on('will-download', event => event.preventDefault());
		contents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
		contents.setWindowOpenHandler(() => ({ action: 'deny' }));
		contents.on('will-navigate', event => event.preventDefault());
		const work = async () => {
			await contents.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
			await contents.executeJavaScript('document.fonts.ready.then(()=>Promise.all(Array.from(document.images,image=>image.decode().catch(()=>{}))))');
			const sizes = await contents.executeJavaScript('Array.from(document.querySelectorAll(".export-page"),p=>({width:p.scrollWidth,height:p.scrollHeight}))') as {
				width: number;
				height: number;
			}[];
			if (!sizes.length || sizes.length > 50 || sizes.some(s => s.width > 4000 || s.height > 8000)) {
				throw new Error('Export requires 1–50 pages within the page resource budget.');
			}
			const height = Math.max(...sizes.map(s => s.height));
			if (format === 'pdf') {
				await contents.executeJavaScript(`{const style=document.createElement('style');style.nonce=document.querySelector('style[nonce]')?.nonce||'';style.textContent='body{background:white}@page {size:1100px ${height}px;margin:0}';document.head.appendChild(style);}`);
				const bytes = await contents.printToPDF({ printBackground: true, preferCSSPageSize: true, generateTaggedPDF: true });
				if (bytes.length > 30000000) {
					throw new Error('PDF exceeds export budget.');
				}
				return VSBuffer.wrap(bytes);
			}
			window!.setContentSize(1120, Math.min(8100, height + 40));
			const pages: SlidePage[] = [];
			for (let index = 0; index < sizes.length; index++) {
				await contents.executeJavaScript(`document.querySelectorAll('.export-page')[${index}].scrollIntoView();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
				const page = await contents.executeJavaScript(`(${snapshotCanvasPage.toString()})(${index})`) as SlidePage & {
					items: (SlideItem & {
						imageData?: string;
					})[];
				};
				for (const item of page.items) {
					if (item.imageData) {
						item.image = Buffer.from(item.imageData.split(',')[1], 'base64');
						delete item.imageData;
					}
				}
				pages.push(page);
			}
			return createCanvasPptx(pages, title);
		};
		return await Promise.race([work(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Canvas document export exceeded 30 seconds.')), 30000); })]);
	}
	finally {
		clearTimeout(timer);
		window?.destroy();
		exporting = false;
	}
}
