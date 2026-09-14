/* OpenIDE adapter. Third-party selector is preserved verbatim in vendor/ with its MIT license. */
class OpenideModelSelector extends ChatGPTModelSelector {
 connectedCallback(){
  super.connectedCallback();this.dataset.input=document.documentElement.dataset.input||'pointer';
  if(!this.shadowRoot.querySelector('[data-openide-style]')){
   const style=document.createElement('style');style.dataset.openideStyle='';style.textContent=`
    :host{--ink:var(--oi-text,#ededed);--ink-2:var(--oi-secondary,#a1a1a1);--ink-3:#777;--track:#434343;--pill-bg:transparent;--pill-bg-hover:var(--oi-hover);--card:var(--oi-popover);--hairline:var(--oi-border);--blue:var(--oi-accent);--ultra-text:#b79bff;--r-card:var(--oi-radius-popover);--r-row:var(--oi-radius-control);--ease-out:var(--oi-ease-out);--ease-swap:var(--oi-ease-swap);--spring:var(--oi-ease-spring);font-family:var(--oi-font);color:var(--ink)}
    .pill{width:var(--selector-trigger-width,210px);max-width:100%;height:30px;padding-left:8px;padding-right:24px}.pill .label{font-size:13px;font-weight:400}.pill .chev{right:8px}.pill:active{scale:1}
    .popover{position:fixed;bottom:auto;width:min(260px,calc(100vw - 24px))!important;z-index:130;border:1px solid var(--oi-border-overlay);box-shadow:var(--oi-shadow-popover);max-height:calc(100vh - 24px);overflow:hidden;transform-origin:center bottom;transition:opacity var(--oi-motion-exit) ease,scale var(--oi-motion-exit) ease,translate var(--oi-motion-exit) ease,height var(--oi-motion-morph) var(--ease-out)}
    :host([data-input=pointer]) .popover :focus{outline:none!important;box-shadow:none!important}
    :host([data-input=pointer]) .slider:focus-visible::after{display:none}
    .back-btn,.adv-chip,.row{border-radius:var(--oi-radius-control)}
    .back-btn:hover,.adv-chip:hover{color:var(--ink);background:var(--pill-bg-hover)}
    [hidden]{display:none!important}.model-choice,.model-back{width:100%;display:flex;align-items:center;gap:8px;min-height:30px;padding:6px 10px;font-size:13px;border-radius:var(--oi-radius-control);text-align:left;color:var(--ink)}.model-choice+.model-choice{margin-top:2px}.model-choice:hover,.model-back:hover{background:var(--pill-bg-hover)}.model-choice:focus-visible,.model-back:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}.model-choice .selected{margin-left:auto}.model-back{color:var(--ink-2);font-size:12px;margin-bottom:5px}.model-search{box-sizing:border-box;width:100%;height:30px;padding:5px 9px;margin:0 0 7px;border:1px solid var(--oi-border-overlay);border-radius:var(--oi-radius-control);background:#242424;color:var(--ink);font:13px var(--oi-font);outline:none}.model-search:hover{border-color:var(--oi-border-hover)}.model-search::placeholder{color:var(--ink-2)}.model-search:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}.model-empty{font-size:12px;color:var(--ink-2);padding:8px 10px;margin:0}.row[data-row=model]{cursor:pointer}.row[data-row=model]:hover{background:var(--pill-bg-hover)}
    .popover:not(.is-open){translate:0 var(--oi-overlay-enter-y,4px)}
    .popover.is-open{transition:opacity var(--oi-motion-enter) var(--ease-out),scale var(--oi-motion-enter) var(--ease-out),translate var(--oi-motion-enter) var(--ease-out),height var(--oi-motion-morph) var(--ease-out)}
    .row{height:32px}.row .k,.row .v{font-size:13px;font-weight:400}.row[data-row=effort]{cursor:pointer}.row[data-row=effort]:hover{background:var(--oi-hover)}.row:focus-visible,select:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}
    .model-options{color:var(--ink-2);background:var(--card);border:0;max-width:140px;font:13px var(--oi-font)}.adv-chip,.back-btn{font-size:12px}.view{transition:opacity var(--oi-motion-enter) var(--ease-swap),translate var(--oi-motion-enter) var(--ease-swap)}.view.is-hidden{filter:none;height:0;padding-block:0;overflow:clip;visibility:hidden}.menu-stagger .row,.menu-stagger .adv-chip-wrap{animation-duration:var(--oi-motion-morph)}
    .popover{padding:var(--oi-scroll-inset,6px)}
    .oi-scroll-body{position:relative;min-height:0;overflow:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:auto;scrollbar-width:thin;scrollbar-color:#ffffff24 transparent}
    .view-menu{padding:2px 2px 0}.model-back{position:sticky;top:0;background:var(--card);z-index:1}
    ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#ffffff24;border-radius:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-button{display:none}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.popover{scale:1;translate:0 0}}
    @media(forced-colors:active){.popover,.pill,.track,.knob{border:1px solid CanvasText}.popover{background:Canvas;color:CanvasText}.fill{background:Highlight!important}}
   `;this.shadowRoot.append(style);
   const root=this.shadowRoot;
   this._scroll=document.createElement('div');this._scroll.className='oi-scroll-body';this._scroll.append(this.$menu,this.$advanced);this.$popover.append(this._scroll);
   root.querySelector('.popover').setAttribute('aria-label','Modelo y esfuerzo');
   const modelRow=root.querySelector('[data-row=model]');modelRow.querySelector('.k').textContent='Modelo';modelRow.setAttribute('role','button');modelRow.tabIndex=0;modelRow.setAttribute('aria-expanded','false');
   this._summaryNodes=[...this.$menu.children];this._models=document.createElement('div');this._models.className='model-list';this._models.hidden=true;this._models.setAttribute('role','region');this._models.setAttribute('aria-label','Elegir modelo');
   const back=document.createElement('button');back.className='model-back';back.textContent='← Seleccionar modelo';back.addEventListener('click',()=>this._setModelList(false));this._models.append(back);
   this._modelSearch=document.createElement('input');this._modelSearch.type='search';this._modelSearch.className='model-search';this._modelSearch.placeholder='Buscar modelos…';this._modelSearch.setAttribute('aria-label','Buscar modelos');this._models.append(this._modelSearch);
   this._modelOptions=document.createElement('div');this._modelOptions.className='model-options-list';this._modelOptions.setAttribute('role','menu');this._modelOptions.setAttribute('aria-label','Modelos disponibles');this._models.append(this._modelOptions);
   this._modelEmpty=document.createElement('p');this._modelEmpty.className='model-empty';this._modelEmpty.textContent='No se encontraron modelos';this._modelEmpty.hidden=true;this._modelEmpty.setAttribute('role','status');this._models.append(this._modelEmpty);
   this._modelSearch.addEventListener('input',()=>{const query=this._modelSearch.value.toLocaleLowerCase().trim();let count=0;this._modelOptions.querySelectorAll('[data-model]').forEach(option=>{option.hidden=!option.dataset.model.toLocaleLowerCase().includes(query);if(!option.hidden)count++;});this._modelEmpty.hidden=count>0;this._place?.();});
   for(const name of ['GPT-6 Astra','GPT-5.6 Sol','GPT-5.6 Terra','GPT-5.6 Luna','GPT-5.5','GPT-5.3 Codex Spark','Claude','Modelo local']){const option=document.createElement('button');option.className='model-choice';option.dataset.model=name;option.setAttribute('role','menuitemradio');option.textContent=name;const check=document.createElement('span');check.className='selected';check.textContent='✓';check.setAttribute('aria-hidden','true');option.append(check);option.addEventListener('click',()=>{this.setAttribute('model-name',name);this.dispatchEvent(new CustomEvent('modelchange',{bubbles:true,detail:name}));this._setModelList(false);});this._modelOptions.append(option);}
   this.$menu.append(this._models);modelRow.addEventListener('click',()=>this._setModelList(true));modelRow.addEventListener('keydown',e=>{if(['Enter',' ','ArrowRight'].includes(e.key)){e.preventDefault();this._setModelList(true);}});
   this.addEventListener('keydown',e=>{if(this._modelsVisible&&e.key==='Escape'){e.stopImmediatePropagation();e.preventDefault();this._setModelList(false);}else if(this._modelsVisible&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){if(root.activeElement===this._modelSearch&&!['ArrowDown','ArrowUp'].includes(e.key))return;e.stopImmediatePropagation();e.preventDefault();const items=[...this._modelOptions.querySelectorAll('button')].filter(n=>!n.hidden);if(!items.length)return;const i=items.indexOf(root.activeElement);const n=e.key==='Home'?0:e.key==='End'?items.length-1:i<0?(e.key==='ArrowDown'?0:items.length-1):(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[n].focus({preventScroll:true});items[n].scrollIntoView({block:'nearest'});}},true);
   const effort=root.querySelector('[data-row=effort]');effort.querySelector('.k').textContent='Esfuerzo';effort.setAttribute('role','button');effort.tabIndex=0;effort.addEventListener('click',()=>this.$advChip.click());effort.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.$advChip.click();}});
   const speed=root.querySelector('[data-row=speed]');speed.querySelector('.k').textContent='Velocidad';speed.querySelector('.v').textContent='Según proveedor';speed.querySelector('.c').remove();
   for(const button of [this.$advChip,this.$backBtn])button.childNodes[0].textContent=button===this.$advChip?'Avanzado ':'Volver ';
   this.$slider.setAttribute('aria-label','Esfuerzo de razonamiento');root.querySelector('#slider-desc').textContent='Usá las flechas para cambiar el esfuerzo. Inicio y Fin seleccionan los extremos.';
   root.querySelector('.hdr-labels').innerHTML='<span>Más rápido</span><span>Más razonamiento</span>';root.querySelector('.hdr-warning span').textContent='Mayor consumo de uso';
   this.$advanced.inert=true;
  }
  this._place=()=>{
   if(!this.$popover.classList.contains('is-open')){if(this._modelsVisible)this._setModelList(false,false);return;}
   const r=this.$pill.getBoundingClientRect();
   const view=this.$menu.classList.contains('is-hidden')?this.$advanced:this.$menu;
   const height=view.offsetHeight+14;
   const position=OIOverlay.layout(r,{width:this.$popover.offsetWidth,height},{width:innerWidth,height:innerHeight});
   if(!position){this._hide?.();return;}
   this.$popover.dataset.side=position.side;
   const scrollLimit=Math.max(0,position.height-14)+'px';if(this._scroll.style.maxHeight!==scrollLimit)this._scroll.style.maxHeight=scrollLimit;
   const overflow=height>position.height?'auto':'hidden';if(this._scroll.style.overflowY!==overflow)this._scroll.style.overflowY=overflow;
   const above=position.side==='above';
   const styles={height:height+'px',left:position.left+'px',top:above?'auto':(r.bottom+8)+'px',bottom:above?(innerHeight-r.top+8)+'px':'auto',maxHeight:position.maxHeight+'px',overflow:'hidden',transformOrigin:above?'center bottom':'center top'};
   for(const [key,value] of Object.entries(styles))if(this.$popover.style[key]!==value)this.$popover.style[key]=value;
   const offset=above?'-4px':'4px';if(this.$popover.style.getPropertyValue('--oi-overlay-enter-y')!==offset)this.$popover.style.setProperty('--oi-overlay-enter-y',offset);

  };
  this._observer=new MutationObserver(this._place);this._observer.observe(this.$popover,{attributes:true,attributeFilter:['style','class']});
  this._sizeObserver=new ResizeObserver(this._place);this._sizeObserver.observe(this.$popover);
  this._hide=()=>{if(this.$pill.getAttribute('aria-expanded')==='true')this.$pill.click();};
  this._onScroll=e=>{if(!e.composedPath().includes(this.$popover))this._hide();};
  this._onVisibility=()=>{if(document.hidden)this._hide();};
  window.addEventListener('resize',this._hide);document.addEventListener('scroll',this._onScroll,true);document.addEventListener('visibilitychange',this._onVisibility);
  this._onFocus=e=>{if(!e.composedPath().includes(this))this._hide();};document.addEventListener('focusin',this._onFocus);
 }
 _setModelList(show,focus=true){
  this._modelsVisible=show;if(show){this._modelSearch.value='';this._modelEmpty.hidden=true;this._modelOptions.querySelectorAll('[data-model]').forEach(n=>n.hidden=false);}for(const node of this._summaryNodes)node.hidden=show;this._models.hidden=!show;
  const row=this.shadowRoot.querySelector('[data-row=model]');row.setAttribute('aria-expanded',show);
  this._models.querySelectorAll('[data-model]').forEach(button=>{const selected=button.dataset.model===this.getAttribute('model-name');button.setAttribute('aria-checked',selected);button.querySelector('.selected').hidden=!selected;});
  if(this.$popover.classList.contains('is-open')){this._place?.();}
  if(show)OIMotion.enter(this._models);else OIMotion.cancel(this._models);
  if(focus&&(show||this.dataset.input==='keyboard'))(show?this._modelSearch:row)?.focus({preventScroll:true});
 }
 disconnectedCallback(){this._observer?.disconnect();this._sizeObserver?.disconnect();window.removeEventListener('resize',this._hide);document.removeEventListener('scroll',this._onScroll,true);document.removeEventListener('visibilitychange',this._onVisibility);document.removeEventListener('focusin',this._onFocus);super.disconnectedCallback();}
}
customElements.define('openide-model-selector',OpenideModelSelector);
