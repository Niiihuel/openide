/* OpenIDE — shared anchored overlay geometry for the visual prototype. */
(function(root){
 function layout(anchor,size,viewport,{gap=8,margin=12,preferred='below'}={}){
  const below=Math.max(0,viewport.height-margin-anchor.bottom-gap);
  const above=Math.max(0,anchor.top-margin-gap);
  const fits={below:below>=size.height,above:above>=size.height};
  const other=preferred==='below'?'above':'below';
  const side=fits[preferred]?preferred:fits[other]?other:below>=above?'below':'above';
  const available=side==='below'?below:above;
  if(available<=0||anchor.bottom<0||anchor.top>viewport.height)return null;
  const height=Math.min(size.height,available),width=Math.min(size.width,Math.max(0,viewport.width-2*margin));
  return {side,width,height,maxHeight:available,left:Math.max(margin,Math.min(anchor.left,viewport.width-margin-width)),top:side==='below'?anchor.bottom+gap:anchor.top-gap-height};
 }
 root.OIOverlay={layout};
 if(typeof module!=='undefined')module.exports={layout};
 if(typeof document!=='undefined'){
  function modality(value){document.documentElement.dataset.input=value;document.querySelectorAll('openide-model-selector').forEach(el=>el.dataset.input=value);}
  modality('pointer');
  document.addEventListener('pointerdown',()=>modality('pointer'),true);
  document.addEventListener('keydown',e=>{if(['Tab','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter',' ','Home','End'].includes(e.key))modality('keyboard');},true);
 }
})(globalThis);
