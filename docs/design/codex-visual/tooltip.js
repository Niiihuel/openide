/* OpenIDE prototype hover lifecycle. Production keeps IHoverService. */
// Track the tooltip owner, not bubbled events from its text/icon descendants.
let tipOwner=null,tipOpenTimer,tipCloseTimer,lastTipShown=0;
function hideTip(){
 clearTimeout(tipOpenTimer);clearTimeout(tipCloseTimer);
 if(tipOwner){const ids=(tipOwner.getAttribute('aria-describedby')||'').split(' ').filter(id=>id&&id!=='tooltip');if(ids.length)tipOwner.setAttribute('aria-describedby',ids.join(' '));else tipOwner.removeAttribute('aria-describedby');}
 tipOwner=null;if(!$('#tooltip').hidden)OIMotion.exit($('#tooltip'),'tooltip');
}
function showTip(e){
 const target=e.target.closest?.('[data-tip]');
 if(e.target.closest?.('#tooltip')){clearTimeout(tipCloseTimer);return;}
 if(!target)return;
 clearTimeout(tipCloseTimer);if(target===tipOwner)return;
 const warm=!$('#tooltip').hidden||Date.now()-lastTipShown<200;
 hideTip();tipOwner=target;
 tipOpenTimer=setTimeout(()=>{
  if(tipOwner!==target||!target.isConnected){hideTip();return;}
  const tip=$('#tooltip');tip.textContent=target.dataset.tip;OIMotion.cancel(tip);tip.hidden=false;tip.inert=false;
  const rect=target.getBoundingClientRect();
  const position=OIOverlay.layout(rect,{width:tip.offsetWidth,height:tip.offsetHeight},{width:innerWidth,height:innerHeight},{preferred:'above'});
  if(!position){hideTip();return;}
  tip.style.left=position.left+'px';tip.style.top=position.top+'px';tip.dataset.side=position.side;
  tip.style.setProperty('--tip-pointer-x',Math.max(12,Math.min(position.width-12,(rect.left+rect.right)/2-position.left))+'px');
  tip.style.transformOrigin=position.side==='above'?'center bottom':'center top';
  const ids=new Set((target.getAttribute('aria-describedby')||'').split(' ').filter(Boolean));ids.add('tooltip');target.setAttribute('aria-describedby',[...ids].join(' '));
  lastTipShown=Date.now();OIMotion.enter(tip,'tooltip');
 },warm?0:450);
}
function leaveTip(e){
 const next=e.relatedTarget;
 if(next&&(tipOwner?.contains(next)||$('#tooltip').contains(next)))return;
 // A short grace period bridges the pointer gap and supports reading the hover itself.
 clearTimeout(tipCloseTimer);tipCloseTimer=setTimeout(hideTip,100);
}
document.addEventListener('pointerover',showTip);document.addEventListener('pointerout',leaveTip);
document.addEventListener('focusin',showTip);document.addEventListener('focusout',leaveTip);
document.addEventListener('pointerdown',hideTip);
