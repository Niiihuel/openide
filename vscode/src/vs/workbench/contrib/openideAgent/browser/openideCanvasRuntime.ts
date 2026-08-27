/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — Canvas runtime. It lives in a REAL TypeScript file and is embedded into the webview
 *  with Function.prototype.toString(): it used to be a string inside a template literal, where a
 *  backtick closed the literal and backslashes were consumed silently (\s became s, splitting
 *  class names at the letter "s"). Here the code is code.
 *
 *  The function is SELF-CONTAINED on purpose: it is serialized and executed inside the webview's
 *  iframe, so it cannot reference anything from the module (imports, external constants) — that
 *  fuera de alcance al stringificarla.
 *--------------------------------------------------------------------------------------------*/

/** Virtual tree node: text, number, or an element with a type and props. */
export type CanvasVNode = string | number | boolean | null | undefined | ICanvasElement | CanvasVNode[];

export interface ICanvasElement {
	readonly type: string | symbol | CanvasComponent;
	readonly props: ICanvasProps;
}

/** A component's prop bag. Heterogeneous by definition (each component defines its own), but
 *  bounded: the values are `unknown` except the ones the renderer does know about. */
export interface ICanvasProps {
	children?: CanvasVNode[];
	style?: Record<string, string | number | undefined>;
	className?: string;
	id?: string;
	title?: string;
	// The index stays permissive because each component defines its own heterogeneous props;
	// it is the same criterion React uses for props. What is seriously typed is the renderer's
	// CORE (CanvasVNode, h, dom, setProp, the component signature), which is where the
	// invariants live and where the real bugs showed up.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
}

export type CanvasComponent = (props: ICanvasProps) => CanvasVNode;

/**
 * Runtime body. Serialized with toString() and executed inside the webview.
 */
export function openideCanvasRuntimeMain(): void {
const vscode = (globalThis as unknown as { acquireVsCodeApi(): { postMessage(message: unknown): void } }).acquireVsCodeApi();
	const root = document.getElementById('root')!;
	// The persisted state is no longer interpolated into the code: the host publishes it in this
	// global BEFORE running the runtime. It is the only host → runtime channel at startup.
	const bootState = (globalThis as unknown as { __openideCanvasState?: Record<string, unknown> }).__openideCanvasState;
	let currentComponent: unknown = null, hookIndex = 0; void hookIndex; let persisted: Record<string, unknown> = bootState && typeof bootState === 'object' ? bootState : {};
const Fragment=Symbol('Fragment');
function flat(input: CanvasVNode | CanvasVNode[], out: CanvasVNode[]): CanvasVNode[] {(Array.isArray(input)?input:[input]).forEach(function(v: CanvasVNode){if(Array.isArray(v))flat(v,out);else if(v!==null&&v!==undefined&&v!==false&&v!==true)out.push(v)});return out}
function h(type: string | symbol | CanvasComponent, props?: ICanvasProps | null, ...rest: CanvasVNode[]): ICanvasElement {
		const children = flat(rest, []);
		return { type: type, props: Object.assign({}, props || {}, { children: children }) };
	}
/* SVG needs createElementNS: with createElement the <svg> ends up in the XHTML namespace, not
   es un SVGElement y NO SE DIBUJA — por eso los gráficos del canvas nunca se veían. El modo
   svg se propaga a los hijos, porque el namespace lo define el ancestro, no el tag. */
const SVG_NS='http://www.w3.org/2000/svg';
/* SVG attributes that ARE camelCase; the rest are converted to kebab-case (strokeWidth →
   stroke-width), que es como los espera el parser. */
const SVG_CAMEL: Record<string, number> = {viewBox:1,preserveAspectRatio:1,markerWidth:1,markerHeight:1,markerUnits:1,refX:1,refY:1,gradientUnits:1,gradientTransform:1,patternUnits:1,spreadMethod:1,startOffset:1,textLength:1,lengthAdjust:1,clipPathUnits:1,maskUnits:1,primitiveUnits:1,baseFrequency:1,numOctaves:1,stdDeviation:1,pathLength:1};
function svgAttr(key: string): string {return SVG_CAMEL[key]?key:key.replace(/[A-Z]/g,function(c){return '-'+c.toLowerCase()})}
function setProp(el: Element, key: string, value: unknown, isSvg: boolean): void {
		// Dynamic access to the element: the prop name is decided by the canvas at runtime.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const node = el as any;
		if(key==='children'||key==='key'||value==null)return;if(key==='style'&&typeof value==='object'){Object.assign(node.style,value as object);return}if(key.startsWith('on')&&typeof value==='function'){el.addEventListener(key.slice(2).toLowerCase(),value as EventListener);return}if(isSvg){el.setAttribute(key==='className'?'class':svgAttr(key),String(value));return}if(key==='className'){node.className=value;return}if(key==='checked'||key==='disabled'||key==='selected'){node[key]=!!value;return}if(key in node&&key!=='list'&&key!=='form'){try{node[key]=value;return}catch(e){}}el.setAttribute(key,String(value))}
function dom(v: CanvasVNode, svgMode?: boolean): Node {if(typeof v==='string'||typeof v==='number')return document.createTextNode(String(v));if(!v||v===true)return document.createComment('');if(Array.isArray(v)){const frag=document.createDocumentFragment();v.forEach(function(child: CanvasVNode){frag.appendChild(dom(child,svgMode))});return frag}if(v.type===Fragment){const f=document.createDocumentFragment();(v.props.children||[]).forEach(function(c: CanvasVNode){f.appendChild(dom(c,svgMode))});return f}if(typeof v.type==='function'){const prev=currentComponent;currentComponent=v.type;hookIndex=0;let out;try{out=v.type(v.props||{})}finally{currentComponent=prev}return dom(out,svgMode)}const isSvg=svgMode||v.type==='svg';const tag = (v as ICanvasElement).type as string;
		const el=isSvg?document.createElementNS(SVG_NS,tag):document.createElement(tag);const nodeProps = (v as ICanvasElement).props||{};
		Object.keys(nodeProps).forEach(function(k: string){setProp(el,k,nodeProps[k],isSvg)});(nodeProps.children||[]).forEach(function(c: CanvasVNode){el.appendChild(dom(c,isSvg&&tag!=='foreignObject'))});return el as Node}
let Top: CanvasComponent | null = null;function render(){if(!Top)return;root.replaceChildren(dom(h(Top,null)))}
function mount(component: CanvasComponent){Top=component;render()}
const states: Record<string, unknown> = {};function useCanvasState(key: string, def: unknown): [unknown, (action: unknown) => void] {if(!(key in states))states[key]=(key in persisted?persisted[key]:def);const value=states[key];function set(action: unknown){states[key]=typeof action==='function'?action(states[key]):action;persisted[key]=states[key];vscode.postMessage({type:'stateWrite',state:persisted});render()}return [value,set]}
function useCanvasAction(){return function(action: { type?: string; choiceId?: string; label?: string } | null){if(!action||typeof action!=='object')return;if(action.type==='canvasChoice'){const choiceId=String(action.choiceId||'').slice(0,160),label=String(action.label||'').trim().slice(0,1000);if(!choiceId||!label)return;action={type:'canvasChoice',choiceId:choiceId,label:label}}vscode.postMessage({type:'action',action:action})}}
const theme={kind:document.body.classList.contains('vscode-light')?'light':'dark',text:{primary:'var(--vscode-editor-foreground)',secondary:'var(--vscode-descriptionForeground)',tertiary:'var(--vscode-disabledForeground)',quaternary:'var(--vscode-disabledForeground)',link:'var(--vscode-textLink-foreground)',onAccent:'var(--vscode-button-foreground)'},bg:{editor:'var(--vscode-editor-background)',chrome:'var(--vscode-sideBar-background)',elevated:'var(--vscode-editorWidget-background)'},fill:{primary:'var(--vscode-list-activeSelectionBackground)',secondary:'var(--vscode-list-hoverBackground)',tertiary:'var(--vscode-editorWidget-background)',quaternary:'var(--vscode-input-background)'},stroke:{primary:'var(--vscode-panel-border)',secondary:'var(--vscode-widget-border)',tertiary:'var(--vscode-panel-border)'},accent:{primary:'var(--vscode-textLink-foreground)',control:'var(--vscode-button-background)'},diff:{added:'var(--openide-green)',removed:'var(--openide-red)'},palette:{}};(theme as unknown as Record<string, unknown>).tokens=theme;theme.palette=theme.palette;function useHostTheme(){return theme}
/* Forwards the element's IDENTITY props to the real tag: className (merged with
   el que ponga el propio componente), id, title y los atributos data- y aria-. Sin esto un
   canvas no podia marcar sus elementos y los selectores del Design Mode salian posicionales
   (div > section:nth-of-type(2)), que le dicen poco al agente sobre que componente tocar. */
function ident(p: ICanvasProps, base?: string): ICanvasProps {const out: ICanvasProps = {};if(!p)return base?{className:base}:out;const cls=[base,p.className].filter(Boolean).join(' ');if(cls)out.className=cls;if(p.id)out.id=p.id;if(p.title)out.title=p.title;Object.keys(p).forEach(function(k: string){if(k.indexOf('data-')===0||k.indexOf('aria-')===0)out[k]=p[k]});return out}
function mergeStyle(a?: Record<string, string | number | undefined>, b?: Record<string, string | number | undefined>): Record<string, string | number | undefined> {return Object.assign({},a||{},b||{})}
function box(tag: string, base: Record<string, string | number>){return function(p: ICanvasProps){p=p||{};return h(tag,Object.assign({},p,{style:mergeStyle(base,p.style)}),p.children)}}
const Stack=box('div',{display:'flex',flexDirection:'column'}), Row=function(p: ICanvasProps){return h('div',Object.assign({style:mergeStyle({display:'flex',gap:(p.gap==null?8:p.gap)+'px',alignItems:p.align||'center',justifyContent:p.justify==='space-between'?'space-between':p.justify||'flex-start',flexWrap:p.wrap?'wrap':'nowrap'},p.style)},ident(p)),p.children)}, Grid=function(p: ICanvasProps){return h('div',Object.assign({style:mergeStyle({display:'grid',gridTemplateColumns:typeof p.columns==='number'?'repeat('+p.columns+',minmax(0,1fr))':p.columns,gap:(p.gap==null?12:p.gap)+'px',alignItems:p.align||'stretch'},p.style)},ident(p)),p.children)};
function withGap(C: CanvasComponent){return function(p: ICanvasProps){p=p||{};return h(C,Object.assign({},p,{style:mergeStyle({gap:(p.gap==null?12:p.gap)+'px'},p.style)}),p.children)}}const StackGap=withGap(Stack);
const H1=box('h1',{fontSize:'24px',lineHeight:'30px',margin:'0 0 8px',fontWeight:'600'}),H2=box('h2',{fontSize:'18px',lineHeight:'24px',margin:'0 0 6px',fontWeight:'600'}),H3=box('h3',{fontSize:'16px',lineHeight:'22px',margin:'0 0 4px',fontWeight:'600'});
function Text(p: ICanvasProps){return h(String(p.as||'p'),Object.assign({style:mergeStyle({margin:0,color:p.tone==='secondary'?theme.text.secondary:p.tone==='tertiary'?theme.text.tertiary:theme.text.primary,fontSize:p.size==='small'?'12px':'14px',fontWeight:({medium:500,semibold:600,bold:700} as Record<string, number>)[String(p.weight)]||400,fontStyle:p.italic?'italic':'normal'},p.style)},ident(p)),p.children)}
function Card(p: ICanvasProps){return h('section',Object.assign({style:mergeStyle({border:'1px solid '+theme.stroke.primary,borderRadius:'8px',background:theme.bg.elevated,overflow:'hidden'},p.style)},ident(p)),p.children)}
function CardHeader(p: ICanvasProps){return h('div',Object.assign({style:mergeStyle({display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',padding:'11px 14px',borderBottom:'1px solid '+theme.stroke.tertiary,fontWeight:600},p.style)},ident(p)),h('span',null,p.children),p.trailing)}
const CardBody=box('div',{padding:'14px'}), Divider=box('hr',{border:0,borderTop:'1px solid var(--vscode-panel-border)',width:'100%',margin:'4px 0'});function Spacer(){return h('span',{style:{flex:'1 1 auto'}})}
function Button(p: ICanvasProps){return h('button',Object.assign({type:'button',disabled:p.disabled,onClick:p.onClick,style:mergeStyle({border:p.variant==='ghost'?'none':'1px solid '+theme.stroke.primary,borderRadius:'5px',padding:'5px 10px',cursor:'pointer',background:p.variant==='primary'?theme.accent.control:'var(--vscode-button-secondaryBackground)',color:p.variant==='primary'?theme.text.onAccent:'var(--vscode-button-secondaryForeground)'},p.style)},ident(p)),p.children)}
function Link(p: ICanvasProps){return h('a',Object.assign({href:p.href||'#',onClick:function(e: Event){if(p.onClick){e.preventDefault();p.onClick()}else if(p.href){e.preventDefault();vscode.postMessage({type:'action',action:{type:'openLink',url:p.href}})}},style:mergeStyle({color:theme.text.link,cursor:'pointer'},p.style)},ident(p)),p.children)}
function Pill(p: ICanvasProps){return h('span',Object.assign({style:mergeStyle({display:'inline-flex',padding:'2px 7px',borderRadius:'999px',fontSize:p.size==='sm'?'11px':'12px',background:theme.fill.secondary,color:theme.text.secondary},p.style)},ident(p)),p.children)}
function Stat(p: ICanvasProps){return h('div',Object.assign({style:p.style},ident(p)),h(Text,{size:'small',tone:'secondary'},p.label),h('div',{style:{fontSize:'22px',fontWeight:600,color:p.tone==='accent'?theme.accent.primary:theme.text.primary}},p.value),p.caption&&h(Text,{size:'small',tone:'tertiary'},p.caption))}
function Callout(p: ICanvasProps){return h('div',Object.assign({style:mergeStyle({padding:'10px 12px',borderLeft:'3px solid '+theme.accent.primary,background:theme.fill.tertiary},p.style)},ident(p)),p.title&&h(H3,null,p.title),p.children)}
const Code=box('pre',{fontFamily:'var(--vscode-editor-font-family)',whiteSpace:'pre-wrap',padding:'10px',background:'var(--vscode-textCodeBlock-background)',borderRadius:'5px',overflow:'auto'});
function Table(p: ICanvasProps){if(!p.rows||!p.rows.length)return null;return h('div',{style:mergeStyle({overflow:'auto',border:p.framed===false?'none':'1px solid '+theme.stroke.primary,borderRadius:p.framed===false?0:'6px'},p.style)},h('table',{className:'oc-table'},h('thead',null,h('tr',null,p.headers.map(function(x: string,i: number){return h('th',{style:{textAlign:(p.columnAlign||[])[i]||'left'}},x)}))),h('tbody',null,p.rows.map(function(row: string[],ri: number){return h('tr',{style:p.striped&&ri%2?{background:theme.fill.tertiary}:undefined},p.headers.map(function(_: string,i: number){return h('td',{style:{textAlign:(p.columnAlign||[])[i]||'left'}},row[i])}))}))))}
/* Chart engine: axes with a "round" scale, grid, legend and native tooltips. The
   anterior dibujaba sólo las barras/línea sobre un viewBox fijo, sin ejes ni referencia de
   magnitud, así que un gráfico no se podía leer sin adivinar los valores. */
	interface IChartSeries { name?: string; data: number[] }
	interface IChartSlice { label: string; value: number }
const CHART_TOKENS=[['--vscode-charts-blue','#3794ff'],['--vscode-charts-green','#89d185'],['--vscode-charts-orange','#d18616'],['--vscode-charts-purple','#b180d7'],['--vscode-charts-red','#f14c4c'],['--vscode-charts-yellow','#cca700']];
function chartColor(i: number){const t=CHART_TOKENS[i%CHART_TOKENS.length];return 'var('+t[0]+', '+t[1]+')'}
/* "Round" step (1, 2, 5 × 10^n): the axis ticks land on numbers that read well. */
function niceStep(range: number, count: number){if(!(range>0))return 1;const raw=range/Math.max(1,count),mag=Math.pow(10,Math.floor(Math.log(raw)/Math.LN10)),n=raw/mag;return (n>5?10:n>2?5:n>1?2:1)*mag}
function fmtNumber(v: number){const a=Math.abs(v);if(a>=1e9)return (v/1e9).toFixed(1).replace(/\.0$/,'')+'B';if(a>=1e6)return (v/1e6).toFixed(1).replace(/\.0$/,'')+'M';if(a>=1e3)return (v/1e3).toFixed(1).replace(/\.0$/,'')+'k';return String(Math.round(v*1000)/1000)}
function tip(text: string){return h('title',null,text)}
function chartLegend(names: string[], y: number, width: number){const items: CanvasVNode[] = [],perRow=Math.max(1,Math.floor(width/150));names.forEach(function(name: string,i: number){const col=i%perRow,row=Math.floor(i/perRow),x=12+col*Math.min(160,width/perRow);items.push(h('rect',{x:x,y:y+row*20-10,width:11,height:11,rx:2,fill:chartColor(i)}));items.push(h('text',{x:x+17,y:y+row*20,className:'oc-legend'},name))});return items}
function chart(kind: string, p: ICanvasProps){
	p=p||{};
	const width=720,height=Math.max(160,p.height||280);
	if(kind==='pie'){
		const data=(p.data||[]).filter(function(d: IChartSlice){return !!d&&Number(d.value)>0});
		if(!data.length)return null;
		const total=data.reduce(function(a: number,d: IChartSlice){return a+Number(d.value)},0)||1;
		const cx=height/2+8,cy=height/2,outer=Math.min(cx,cy)-18,inner=p.donut===false?0:outer*0.58;
		const shapes: CanvasVNode[] = [];let angle=-Math.PI/2;
		data.forEach(function(d: IChartSlice,i: number){
			const value=Number(d.value),sweep=value/total*Math.PI*2,next=angle+sweep,large=sweep>Math.PI?1:0;
			const x1=cx+outer*Math.cos(angle),y1=cy+outer*Math.sin(angle),x2=cx+outer*Math.cos(next),y2=cy+outer*Math.sin(next);
			let path;
			if(inner>0){
				const i1=cx+inner*Math.cos(next),j1=cy+inner*Math.sin(next),i2=cx+inner*Math.cos(angle),j2=cy+inner*Math.sin(angle);
				path='M'+x1+' '+y1+' A'+outer+' '+outer+' 0 '+large+' 1 '+x2+' '+y2+' L'+i1+' '+j1+' A'+inner+' '+inner+' 0 '+large+' 0 '+i2+' '+j2+' Z';
			} else { path='M'+cx+' '+cy+' L'+x1+' '+y1+' A'+outer+' '+outer+' 0 '+large+' 1 '+x2+' '+y2+' Z'; }
			const percent=Math.round(value/total*1000)/10;
			shapes.push(h('path',{d:path,fill:chartColor(i),className:'oc-slice'},tip(d.label+': '+fmtNumber(value)+' ('+percent+'%)')));
			angle=next;
		});
		/* The legend goes ON THE RIGHT with its value and percentage: previously the labels
		   apilaban sobre el dibujo en posiciones fijas y se pisaban entre sí. */
		const legendX=height+24;
		data.forEach(function(d: IChartSlice,i: number){
			const y=32+i*24,percent=Math.round(Number(d.value)/total*1000)/10;
			shapes.push(h('rect',{x:legendX,y:y-9,width:10,height:10,rx:2,fill:chartColor(i)}));
			shapes.push(h('text',{x:legendX+16,y:y,className:'oc-legend'},d.label));
			shapes.push(h('text',{x:width-12,y:y,textAnchor:'end',className:'oc-legend oc-strong'},fmtNumber(Number(d.value))+' · '+percent+'%'));
		});
		if(inner>0){shapes.push(h('text',{x:cx,y:cy-2,textAnchor:'middle',className:'oc-donut-total'},fmtNumber(total)));shapes.push(h('text',{x:cx,y:cy+14,textAnchor:'middle',className:'oc-legend'},p.totalLabel||'Total'))}
		return h('svg',{className:'oc-chart',viewBox:'0 0 '+width+' '+height,role:'img','aria-label':p.label||'Gráfico de torta',style:mergeStyle({width:'100%'},p.style)},shapes);
	}
	const cats=p.categories||[],series=(p.series||[]).filter(function(s: IChartSeries){return !!s&&!!s.data});
	if(!cats.length||!series.length)return null;
	const stacked=!!p.stacked&&kind==='bar';
	const values: number[] = [];
	if(stacked){cats.forEach(function(_: string,i: number){let sum=0;series.forEach(function(s: IChartSeries){sum+=Number(s.data[i])||0});values.push(sum)})}
	else{series.forEach(function(s: IChartSeries){(s.data||[]).forEach(function(v: number){values.push(Number(v)||0)})})}
	const rawMax=Math.max.apply(Math,values.concat([0])),rawMin=Math.min.apply(Math,values.concat([0]));
	const step=niceStep(rawMax-rawMin||Math.abs(rawMax)||1,4);
	const top=Math.ceil(rawMax/step)*step||step,bottom=Math.min(0,Math.floor(rawMin/step)*step);
	const span=top-bottom||1;
	const legendRows=series.length>1?Math.ceil(series.length/Math.max(1,Math.floor((width-24)/150))):0;
	const padL=64,padR=16,padT=16,padB=38+legendRows*20;
	const plotW=width-padL-padR,plotH=height-padT-padB;
	const yOf=function(v: number){return padT+plotH-((v-bottom)/span)*plotH};
	const shapes: CanvasVNode[] = [];
	// Grid + Y axis: the magnitude reference that did not exist before.
	for(let value=bottom;value<=top+1e-9;value+=step){
		const y=yOf(value);
		shapes.push(h('line',{x1:padL,y1:y,x2:padL+plotW,y2:y,className:value===0?'oc-axis':'oc-grid'}));
		shapes.push(h('text',{x:padL-10,y:y+4.5,textAnchor:'end',className:'oc-tick'},fmtNumber(value)));
	}
	shapes.push(h('line',{x1:padL,y1:padT,x2:padL,y2:padT+plotH,className:'oc-axis'}));
	const slot=plotW/cats.length;
	// Etiquetas del eje X salteadas si no entran, para no quedar ilegibles superpuestas.
	const every=Math.max(1,Math.ceil(cats.length/Math.max(1,Math.floor(plotW/68))));
	cats.forEach(function(c: string,i: number){if(i%every)return;shapes.push(h('text',{x:padL+i*slot+slot/2,y:padT+plotH+19,textAnchor:'middle',className:'oc-tick'},String(c)))});
	if(kind==='bar'){
		const groups=stacked?1:series.length;
		const barWidth=Math.max(2,slot*0.7/groups);
		const offsets=cats.map(function(){return {up:0,down:0}});
		series.forEach(function(s: IChartSeries,si: number){
			(s.data||[]).forEach(function(raw: number,i: number){
				const value=Number(raw)||0;
				let y,barHeight,x;
				if(stacked){
					x=padL+i*slot+(slot-barWidth)/2;
					const base=value>=0?offsets[i].up:offsets[i].down;
					const from=yOf(base),to=yOf(base+value);
					y=Math.min(from,to);barHeight=Math.abs(to-from);
					if(value>=0){offsets[i].up+=value}else{offsets[i].down+=value}
				} else {
					x=padL+i*slot+(slot-barWidth*groups)/2+si*barWidth;
					const zero=yOf(0),point=yOf(value);
					y=Math.min(zero,point);barHeight=Math.abs(point-zero);
				}
				shapes.push(h('rect',{x:x,y:y,width:Math.max(1,barWidth-1),height:Math.max(1,barHeight),rx:2,fill:chartColor(si),className:'oc-bar'},tip((s.name?s.name+' · ':'')+cats[i]+': '+fmtNumber(value))));
				if(p.showValues&&!stacked&&barHeight>0){shapes.push(h('text',{x:x+barWidth/2,y:y-4,textAnchor:'middle',className:'oc-tick'},fmtNumber(value)))}
			});
		});
	} else {
		series.forEach(function(s: IChartSeries,si: number){
			const points=(s.data||[]).map(function(v: number,i: number){return [padL+i*slot+slot/2,yOf(Number(v)||0)] as [number, number]});
			if(!points.length)return;
			if(p.area){
				const area='M'+points[0][0]+' '+yOf(bottom)+' L'+points.map(function(pt: [number, number]){return pt[0]+' '+pt[1]}).join(' L')+' L'+points[points.length-1][0]+' '+yOf(bottom)+' Z';
				shapes.push(h('path',{d:area,fill:chartColor(si),className:'oc-area'}));
			}
			shapes.push(h('polyline',{points:points.map(function(pt: [number, number]){return pt[0]+','+pt[1]}).join(' '),fill:'none',stroke:chartColor(si),strokeWidth:2,strokeLinejoin:'round',strokeLinecap:'round'}));
			points.forEach(function(pt: [number, number],i: number){shapes.push(h('circle',{cx:pt[0],cy:pt[1],r:3,fill:chartColor(si),className:'oc-point'},tip((s.name?s.name+' · ':'')+cats[i]+': '+fmtNumber(Number(s.data[i])||0))))});
		});
	}
	if(legendRows){shapes.push.apply(shapes,chartLegend(series.map(function(s: IChartSeries,i: number){return s.name||('Serie '+(i+1))}),height-legendRows*20+8,width-24))}
	return h('svg',{className:'oc-chart',viewBox:'0 0 '+width+' '+height,role:'img','aria-label':p.label||'Gráfico',style:mergeStyle({width:'100%'},p.style)},shapes);
}
function BarChart(p: ICanvasProps){return chart('bar',p)}function LineChart(p: ICanvasProps){return chart('line',p)}function PieChart(p: ICanvasProps){return chart('pie',p)}
function TextInput(p: ICanvasProps){return h('input',{value:p.value||'',placeholder:p.placeholder,disabled:p.disabled,type:p.type||'text',onInput:function(e: Event){p.onChange&&p.onChange((e.target as HTMLInputElement).value)},style:mergeStyle({background:'var(--vscode-input-background)',color:'var(--vscode-input-foreground)',border:'1px solid var(--vscode-input-border)',padding:'5px 8px',borderRadius:'4px'},p.style)})}function Select(p: ICanvasProps){return h('select',{value:p.value,disabled:p.disabled,onChange:function(e: Event){p.onChange&&p.onChange((e.target as HTMLInputElement).value)},style:p.style},p.placeholder&&h('option',{value:''},p.placeholder),(p.options||[]).map(function(o: { value: string; label: string; disabled?: boolean }){return h('option',{value:o.value,disabled:o.disabled},o.label)}))}function Checkbox(p: ICanvasProps){return h('label',{style:mergeStyle({display:'inline-flex',gap:'7px',alignItems:'center'},p.style)},h('input',{type:'checkbox',checked:p.checked,disabled:p.disabled,onChange:function(e: Event){p.onChange&&p.onChange((e.target as HTMLInputElement).checked)}}),p.label)}function Toggle(p: ICanvasProps){return h(Checkbox,p)}
function CollapsibleSection(p: ICanvasProps){const pair=useCanvasState('__collapse_'+(p.title||''),p.defaultExpanded!==false);const expanded=pair[0] as boolean;return h('section',{style:p.style},h('button',{type:'button',onClick:function(){pair[1](!expanded)},style:{border:0,background:'transparent',color:theme.text.primary,padding:'4px 0',fontWeight:600,cursor:'pointer'}},(pair[0]?'▾ ':'▸ '),p.title),expanded&&p.children as CanvasVNode)}
function UsageBar(p: ICanvasProps){const total=(p.segments||[]).reduce(function(a: number,s: { value?: number },s2?: unknown){return a+(Number(s.value)||0)},0)||1;return h('div',{style:p.style},h('div',{style:{display:'flex',height:'8px',overflow:'hidden',borderRadius:'4px',background:theme.fill.secondary}},(p.segments||[]).map(function(s: { label?: string; value: number },i: number){return h('span',{title:s.label,style:{width:(s.value/total*100)+'%',background:i?theme.text.secondary:theme.accent.primary}})})))}
function DiffStats(p: ICanvasProps){return h(Row,{gap:8},p.additions?h('span',{style:{color:theme.diff.added}},'+'+p.additions):null,p.deletions?h('span',{style:{color:theme.diff.removed}},'-'+p.deletions):null)}function DiffView(p: ICanvasProps){return h('div',{style:mergeStyle({fontFamily:'var(--vscode-editor-font-family)',fontSize:'12px'},p.style)},(p.lines||[]).map(function(l: { type?: string; lineNumber?: number; content?: string }){return h('div',{style:{padding:'1px 8px',whiteSpace:'pre',background:l.type==='added'?'var(--vscode-diffEditor-insertedLineBackground)':l.type==='removed'?'var(--vscode-diffEditor-removedLineBackground)':'transparent'}},l.lineNumber==null?'':String(l.lineNumber).padStart(4)+' ',l.type==='added'?'+ ':l.type==='removed'?'- ':'  ',l.content)}))}
function TodoList(p: ICanvasProps){if(!p.todos||!p.todos.length)return null;return h(StackGap,{gap:4,style:p.style},p.todos.map(function(t: { status?: string; content?: string }){return h('button',{type:'button',onClick:function(){p.onTodoClick&&p.onTodoClick(t)},style:{display:'flex',gap:'8px',border:0,background:'transparent',color:theme.text.primary,padding:'4px',textAlign:'left',cursor:'pointer'}},t.status==='completed'?'✓':'○',t.content)}))}function TodoListCard(p: ICanvasProps){return h(Card,{style:p.style},h(CardHeader,null,(p.todos||[]).filter(function(t: { status?: string }){return t.status==='completed'}).length+' of '+(p.todos||[]).length+' Done'),h(CardBody,null,h(TodoList,p)))}
function Wireframe(p: ICanvasProps){return h('section',Object.assign({style:p.style,'aria-label':p.label||'Wireframe'},ident(p,'oc-wireframe')),p.children)}
function WireframeBox(p: ICanvasProps){return h('div',Object.assign({style:mergeStyle({minHeight:p.height?p.height+'px':undefined},p.style)},ident(p,'oc-wireframe-box')),p.label||p.children)}
function WireframeLine(p: ICanvasProps){return h('span',{className:'oc-wireframe-line',style:mergeStyle({width:p.width||'100%'},p.style),'aria-hidden':'true'})}
function WireframeText(p: ICanvasProps){return h('span',{className:'oc-wireframe-text',style:p.style},p.children||p.label)}
/* Button that runs a prompt in the chat. With send=false it leaves the text in the composer for
   que el usuario lo revise antes de mandarlo; por defecto se envía solo. */
function PromptButton(p: ICanvasProps){p=p||{};return h('button',Object.assign({type:'button',disabled:p.disabled,title:p.prompt||'',onClick:function(){const prompt=String(p.prompt||'').trim().slice(0,4000);if(!prompt)return;vscode.postMessage({type:'action',action:{type:'runPrompt',prompt:prompt,send:p.send!==false}})},style:p.style},ident(p,'oc-prompt-btn'+(p.variant==='primary'?' primary':''))),p.children||p.label||'Preguntar al agente')}
function Choice(p: ICanvasProps){return h('button',Object.assign({type:'button',onClick:function(){p.onSelect&&p.onSelect(p.id)},'aria-pressed':p.selected?'true':'false',style:p.style},ident(p,'oc-choice'+(p.selected?' selected':'')),{id:undefined}),h('span',{className:'oc-choice-mark','aria-hidden':'true'}),h('span',{className:'oc-choice-copy'},h('span',{className:'oc-choice-title'},p.title||p.children),p.description&&h('span',{className:'oc-choice-description'},p.description)))}
/* Design Mode: select an element of the canvas and send it to the agent, just like the
   Pick & Polish del navegador. Reusa ese contrato ({selector, html, estilos, rect}) para que
   el chat lo adjunte por el mismo camino y no haya dos mecanismos que mantener. */
let designOn = false, designHover: Element | null = null;
const designBox=document.createElement('div');designBox.className='oc-pick-box';designBox.hidden=true;
const designTag=document.createElement('div');designTag.className='oc-pick-tag';designTag.hidden=true;
const designBar=document.createElement('div');designBar.className='oc-pick-bar';designBar.hidden=true;
designBar.textContent='Design Mode · clic para elegir un elemento · Esc para salir';
function cssPath(el: Element | null){
	/* Stable and SHORT selector: the id when there is one, otherwise the tag+class+:nth-of-type chain
	   hasta el contenedor raíz. El agente lo usa para ubicar el componente en el fuente. */
	const parts=[];
	while(el&&el.nodeType===1&&el!==root&&parts.length<6){
		if(el.id){parts.unshift('#'+el.id);break}
		let part=el.tagName.toLowerCase();
		const cls=(el.getAttribute('class')||'').trim().split(/\s+/).filter(Boolean).slice(0,2);
		if(cls.length)part+='.'+cls.join('.');
		const parent=el.parentElement;
		if(parent){
			/* The :nth-of-type is added ONLY when tag+class are not enough to tell it apart from its
			   hermanos. Ponerlo siempre ensuciaba selectores ya unicos (div.cabecera:nth-of-type(1))
			   y le quitaba al agente la pista de que componente es. El indice sigue siendo el de
			   TIPO, que es lo que cuenta :nth-of-type. */
			const sig=function(c: Element){const k=(c.getAttribute('class')||'').trim().split(/\s+/).filter(Boolean).slice(0,2).join('.');return c.tagName+(k?'.'+k:'')};
			const mine=sig(el);
			const ambiguo=Array.prototype.filter.call(parent.children,function(c: Element){return sig(c)===mine}).length>1;
			if(ambiguo){
				const mismoTag=Array.prototype.filter.call(parent.children,function(c: Element){return c.tagName===(el as Element).tagName});
				part+=':nth-of-type('+(mismoTag.indexOf(el)+1)+')';
			}
		}
		parts.unshift(part);el=parent;
	}
	return parts.join(' > ')||'#root';
}
function designStyles(el: Element){
	const cs=getComputedStyle(el),keys=['display','position','width','height','margin','padding','color','background-color','font-size','font-weight','line-height','border','border-radius','gap','flex-direction','justify-content','align-items','grid-template-columns','text-align','opacity'];
	return keys.map(function(k: string){return k+': '+cs.getPropertyValue(k)}).filter(function(line: string){return !/: (auto|none|normal|0px|rgba\(0, 0, 0, 0\))$/.test(line)}).join('\n');
}
function designPaint(el: Element){
	const r=el.getBoundingClientRect();
	designBox.hidden=false;designTag.hidden=false;
	designBox.style.left=r.left+'px';designBox.style.top=r.top+'px';designBox.style.width=r.width+'px';designBox.style.height=r.height+'px';
	designTag.textContent=el.tagName.toLowerCase()+(el.getAttribute('class')?'.'+String(el.getAttribute('class')).trim().split(/\s+/)[0]:'')+' · '+Math.round(r.width)+'×'+Math.round(r.height);
	// The label goes ABOVE unless it does not fit, so it does not clash with the top edge.
	designTag.style.left=Math.max(4,r.left)+'px';
	designTag.style.top=(r.top>22?r.top-20:r.bottom+4)+'px';
}
function designMove(e: MouseEvent){
	if(!designOn)return;
	const el=document.elementFromPoint(e.clientX,e.clientY);
	if(!el||el===designHover||el===designBox||el===designTag||el===designBar||!root.contains(el))return;
	designHover=el;designPaint(el);
}
function designClick(e: MouseEvent){
	if(!designOn)return;
	e.preventDefault();e.stopPropagation();
	const el=designHover||document.elementFromPoint(e.clientX,e.clientY);
	if(!el||!root.contains(el))return;
	const r=el.getBoundingClientRect();
	vscode.postMessage({type:'action',action:{type:'designPick',
		selector:cssPath(el),
		html:el.outerHTML.slice(0,4000),
		styles:designStyles(el),
		rect:{x:Math.round(r.left),y:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)}}});
	setDesign(false);
}
function designKey(e: KeyboardEvent){if(e.key==='Escape'&&designOn){setDesign(false)}}
function setDesign(on: boolean){
	designOn=!!on;designHover=null;
	document.body.classList.toggle('oc-picking',designOn);
	designBox.hidden=!designOn;designTag.hidden=!designOn;designBar.hidden=!designOn;
	if(!designOn){designBox.hidden=true;designTag.hidden=true}
	vscode.postMessage({type:'designMode',active:designOn});
}
document.addEventListener('mousemove',designMove,true);
document.addEventListener('click',designClick,true);
document.addEventListener('keydown',designKey,true);
window.addEventListener('scroll',function(){if(designOn&&designHover)designPaint(designHover)},true);
document.body.appendChild(designBox);document.body.appendChild(designTag);document.body.appendChild(designBar);
const designToggle=document.createElement('button');
designToggle.type='button';designToggle.className='oc-pick-toggle';
designToggle.title='Design Mode: elegir un elemento y mandarselo al agente';
designToggle.textContent='Design Mode';
designToggle.addEventListener('click',function(e: Event){e.stopPropagation();setDesign(!designOn)});
document.body.appendChild(designToggle);
const fullBtn=document.createElement('button');
fullBtn.type='button';fullBtn.className='oc-full-toggle';
fullBtn.title='Ver el canvas a pantalla completa (presentación)';
fullBtn.textContent='Pantalla completa';
fullBtn.addEventListener('click',function(e: Event){e.stopPropagation();vscode.postMessage({type:'action',action:{type:'toggleFullscreen'}})});
document.body.appendChild(fullBtn);
// The host can also turn it on (command/shortcut), not just the button.
window.addEventListener('message',function(e: MessageEvent){const m=e.data||{};if(m.type==='setDesignMode'){setDesign(!!m.active)}});
(window as unknown as Record<string, unknown>).OpenideCanvas={h:h,Fragment:Fragment,mount:mount,Stack:StackGap,Row:Row,Grid:Grid,Spacer:Spacer,Divider:Divider,H1:H1,H2:H2,H3:H3,Text:Text,Card:Card,CardHeader:CardHeader,CardBody:CardBody,Button:Button,Link:Link,Pill:Pill,Stat:Stat,Callout:Callout,Code:Code,Table:Table,mergeStyle:mergeStyle,BarChart:BarChart,LineChart:LineChart,PieChart:PieChart,useHostTheme:useHostTheme,useCanvasState:useCanvasState,useCanvasAction:useCanvasAction,TextInput:TextInput,Select:Select,Checkbox:Checkbox,Toggle:Toggle,CollapsibleSection:CollapsibleSection,UsageBar:UsageBar,DiffStats:DiffStats,DiffView:DiffView,TodoList:TodoList,TodoListCard:TodoListCard,Wireframe:Wireframe,WireframeBox:WireframeBox,WireframeLine:WireframeLine,WireframeText:WireframeText,Choice:Choice,PromptButton:PromptButton};
}
