/* OpenIDE — shared motion recipes for this isolated prototype. */
(() => {
 const active = new WeakMap();
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 const recipes = {popover:[180,120,4,.97], tooltip:[110,90,2,1], dialog:[200,120,6,.985], swap:[100,60,4,1]};
 function token(name,fallback){return getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;}
 function duration(kind,exit=false){const name=exit?'--oi-motion-exit':kind==='tooltip'?'--oi-motion-tooltip':'--oi-motion-enter';return parseFloat(token(name,exit?'120ms':'180ms'));}
 function cancel(el){active.get(el)?.cancel();active.delete(el);}
 function animate(el,frames,duration,done){
  cancel(el);
  if(reduced.matches){done?.();return;}
  const animation=el.animate(frames,{duration,easing:token('--oi-ease-out','cubic-bezier(0.32, 0.72, 0, 1)'),fill:'both'});active.set(el,animation);
  animation.finished.then(()=>{if(active.get(el)!==animation)return;active.delete(el);animation.cancel();done?.();}).catch(()=>{});
 }
 window.OIMotion={
  reduced,
  enter(el,kind='popover'){const [,,offset,scale]=recipes[kind];cancel(el);el.hidden=false;el.inert=false;animate(el,[{opacity:0,transform:`translateY(${el.dataset.side==='above'?-offset:offset}px) scale(${scale})`},{opacity:1,transform:'translateY(0) scale(1)'}],duration(kind));},
  exit(el,kind='popover',done){const [,,offset,scale]=recipes[kind];el.inert=true;animate(el,[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:`translateY(${el.dataset.side==='above'?-offset:offset}px) scale(${scale})`}],duration(kind,true),()=>{el.hidden=true;el.inert=false;done?.();});},
  cancel,
  swap(el,text){if(el.textContent===text)return;animate(el,[{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-4px)'}],60,()=>{el.textContent=text;animate(el,[{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],100);});}
 };
 document.addEventListener('visibilitychange',()=>document.documentElement.classList.toggle('document-hidden',document.hidden));
})();
