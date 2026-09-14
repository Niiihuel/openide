const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function fixture(){
 let now=1000,id=0,enters=0,exits=0;const timers=new Map(),listeners={};
 const element=(parent=null)=>({parent,isConnected:true,hidden:true,dataset:{tip:'Ayuda'},attrs:{},offsetWidth:120,offsetHeight:30,
  style:{setProperty(){}},closest(selector){return selector==='[data-tip]'?(parent||this):null;},
  contains(other){return other===this||other?.parent===this;},
  getAttribute(n){return this.attrs[n]??null;},setAttribute(n,v){this.attrs[n]=v;},removeAttribute(n){delete this.attrs[n];},
  getBoundingClientRect(){return {left:50,right:90,top:100,bottom:130};}});
 const tip=element();tip.closest=()=>tip;tip.dataset={};
 const context={document:{addEventListener(name,fn){listeners[name]=fn;}},Date:{now:()=>now},
  $:()=>tip,innerWidth:600,innerHeight:500,
  setTimeout(fn,delay){timers.set(++id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);},
  OIMotion:{cancel(){},enter(){tip.hidden=false;enters++;},exit(){tip.hidden=true;exits++;}},
  OIOverlay:{layout:()=>({left:20,top:62,width:120,height:30,side:'above'})}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/tooltip.js','utf8'),context);
 function advance(ms){now+=ms;for(const [key,timer] of [...timers])if(timer.at<=now){timers.delete(key);timer.fn();}}
 return {element,tip,listeners,advance,counts:()=>({enters,exits})};
}
test('crossing label and icon keeps the same delay and does not replay the tooltip',()=>{
 const f=fixture(),owner=f.element(),label=f.element(owner),icon=f.element(owner);
 f.listeners.pointerover({target:label});f.advance(300);
 f.listeners.pointerout({target:label,relatedTarget:icon});f.listeners.pointerover({target:icon});f.advance(150);
 assert.equal(f.tip.hidden,false);assert.equal(f.counts().enters,1);
 f.listeners.pointerout({target:icon,relatedTarget:label});f.listeners.pointerover({target:label});f.advance(500);
 assert.deepEqual(f.counts(),{enters:1,exits:0});
});
test('pointer can cross the gap and read the tooltip without closing it',()=>{
 const f=fixture(),owner=f.element();f.listeners.pointerover({target:owner});f.advance(450);
 f.listeners.pointerout({target:owner,relatedTarget:null});f.advance(50);
 f.listeners.pointerover({target:f.tip});f.advance(100);assert.equal(f.tip.hidden,false);
 f.listeners.pointerout({target:f.tip,relatedTarget:null});f.advance(100);assert.equal(f.tip.hidden,true);
});
test('toolbar transfer is immediate and closing removes only its own aria description',()=>{
 const f=fixture(),a=f.element(),b=f.element();a.attrs['aria-describedby']='help';
 f.listeners.focusin({target:a});f.advance(450);assert.equal(a.attrs['aria-describedby'],'help tooltip');
 f.listeners.focusout({target:a,relatedTarget:b});f.listeners.focusin({target:b});f.advance(0);
 assert.equal(f.counts().enters,2);assert.equal(a.attrs['aria-describedby'],'help');
 f.listeners.pointerdown({target:b});assert.equal(b.attrs['aria-describedby'],undefined);assert.equal(f.tip.hidden,true);
});
test('leaving before delay or removing the owner prevents a stale tooltip',()=>{
 const f=fixture(),a=f.element();f.listeners.pointerover({target:a});f.advance(100);
 f.listeners.pointerout({target:a,relatedTarget:null});f.advance(100);f.advance(500);
 assert.equal(f.counts().enters,0);
 const b=f.element();f.listeners.pointerover({target:b});b.isConnected=false;f.advance(450);assert.equal(f.counts().enters,0);
});
