import {CAD_UNITS,measureCadPoints,nearestCadAnchor} from '../../src/utils/cadMeasurement.mjs';

export function createCadMeasurement({viewer,container,metadata}){
 const toggle=document.getElementById('cad-measure'),panel=document.getElementById('cad-measure-panel');
 const result=document.getElementById('cad-measure-result'),hint=document.getElementById('cad-measure-hint');
 const unit=document.getElementById('cad-measure-unit'),scale=document.getElementById('cad-measure-scale');
 const snap=document.getElementById('cad-measure-snap'),clear=document.getElementById('cad-measure-clear');
 const canvas=viewer.GetCanvas();
 const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');overlay.classList.add('cad-measure-overlay');overlay.setAttribute('aria-hidden','true');container.append(overlay);
 let active=false,points=[],hover=null,down=null,raf=null,destroyed=false;const pointers=new Set();
 const formatter=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3});
 unit.replaceChildren(...[...new Set([metadata.unitCode,0,4,5,6,1,2])].map(code=>{const option=document.createElement('option');option.value=code;option.textContent=CAD_UNITS[code]?.label||'图纸单位';return option;}));unit.value=metadata.unitCode;
 toggle.disabled=!metadata.enabled||!viewer.GetBounds();toggle.title=metadata.enabled?'按图纸坐标测量':'纸空间比例未验证，暂不开放测量';panel.hidden=true;
 const visible=()=>new Set(viewer.GetLayers().filter(l=>l.visible).map(l=>l.name));
 const picked=event=>{
  const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*canvas.clientWidth/rect.width,y=(event.clientY-rect.top)*canvas.clientHeight/rect.height;
  const p=viewer.CanvasToSceneCoord(x,y),o=viewer.GetOrigin(),world={x:p.x+o.x,y:p.y+o.y};
  const next=viewer.CanvasToSceneCoord(x+10,y),tolerance=Math.abs(next.x-p.x);
  return snap.checked?nearestCadAnchor(metadata.anchors||[],world,tolerance,visible())||world:world;
 };
 const svgElement=(tag,attributes)=>{const node=document.createElementNS(overlay.namespaceURI,tag);for(const [k,v]of Object.entries(attributes))node.setAttribute(k,String(v));return node;};
 function draw(){
  raf=null;if(destroyed)return;overlay.replaceChildren();
  if(!active)return;
  const origin=viewer.GetOrigin(),project=p=>viewer.SceneToCanvasCoord(p.x-origin.x,p.y-origin.y);
  const ends=points.length===1&&hover?[points[0],hover]:points;
  if(ends.length===2){const a=project(ends[0]),b=project(ends[1]);overlay.append(svgElement('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'cad-measure-line'}));}
  for(const point of ends){const p=project(point);overlay.append(svgElement('circle',{cx:p.x,cy:p.y,r:point.kind?6:4,class:'cad-measure-point'}));}
  if(hover&&hover.kind&&points.length!==1){const p=project(hover);overlay.append(svgElement('rect',{x:p.x-6,y:p.y-6,width:12,height:12,class:'cad-measure-snap-marker'}));}
 }
 const redraw=()=>{if(!raf)raf=requestAnimationFrame(draw);};
 function display(){
  try{
   if(!scale.validity.valid||!scale.value.trim())throw Error('请输入大于0的有效校准比例。');
   const b=points[1]||(points.length===1?hover:null);
   if(!points[0]||!b){result.textContent='距离 —　水平 —　垂直 —';return;}
   const m=measureCadPoints(points[0],b,{scale:Number(scale.value),sourceUnit:metadata.unitCode,targetUnit:Number(unit.value)});
   result.textContent=`距离 ${formatter.format(m.distance)} ${m.unit}　水平 ${formatter.format(m.horizontal)} ${m.unit}　垂直 ${formatter.format(m.vertical)} ${m.unit}`;
   result.dataset.distance=String(m.distance);result.dataset.horizontal=String(m.horizontal);result.dataset.vertical=String(m.vertical);
   if(m.unitAssumed)hint.textContent='原图未定义单位；当前单位为手动指定，必要时调整校准比例。';
  }catch(e){result.textContent=e.message;delete result.dataset.distance;delete result.dataset.horizontal;delete result.dataset.vertical;}
 }
 function reset(){points=[];hover=null;down=null;delete result.dataset.distance;delete result.dataset.horizontal;delete result.dataset.vertical;hint.textContent='依次点选两点；显示捕捉标记时为端点／圆心，其他位置为自由选点。';display();redraw();}
 function setActive(value){active=value;toggle.setAttribute('aria-pressed',String(active));panel.hidden=!active;container.classList.toggle('is-measuring',active);reset();}
 const onToggle=()=>setActive(!active),onClear=()=>reset();
 toggle.addEventListener('click',onToggle);clear.addEventListener('click',onClear);scale.addEventListener('input',display);unit.addEventListener('change',display);
 const onDown=e=>{pointers.add(e.pointerId);if(pointers.size>1){down=null;return;}if(active&&e.isPrimary&&e.button===0){down={x:e.clientX,y:e.clientY,id:e.pointerId};}};
 const onMove=e=>{if(!active)return;if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)down=null;if(e.isPrimary){hover=picked(e);if(points.length<2){hint.textContent=hover.kind?`捕捉：${hover.kind}`:'自由选点';display();redraw();}}};
 const onUp=e=>{const click=down&&down.id===e.pointerId&&pointers.size===1&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<=5;pointers.delete(e.pointerId);down=null;if(!active||!click)return;if(points.length===2)points=[];const point=picked(e);points.push(point);hover=null;hint.textContent=points.length===1?`已选起点${point.kind?'（'+point.kind+'）':''}，请选择终点。`:`测量完成${points.some(p=>!p.kind)?'（含自由选点）':''}；再次点选开始下一次测量。`;display();redraw();};
 const onCancel=e=>{pointers.delete(e.pointerId);down=null;};
 const onKey=e=>{if(e.key==='Escape'&&active){e.preventDefault();setActive(false);}};
 canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointercancel',onCancel);window.addEventListener('keydown',onKey);
 viewer.Subscribe('viewChanged',redraw);viewer.Subscribe('resized',redraw);
 reset();
 return {destroy(){destroyed=true;if(raf)cancelAnimationFrame(raf);toggle.removeEventListener('click',onToggle);clear.removeEventListener('click',onClear);scale.removeEventListener('input',display);unit.removeEventListener('change',display);canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointermove',onMove);canvas.removeEventListener('pointerup',onUp);canvas.removeEventListener('pointercancel',onCancel);window.removeEventListener('keydown',onKey);viewer.Unsubscribe('viewChanged',redraw);viewer.Unsubscribe('resized',redraw);overlay.remove();panel.hidden=true;toggle.disabled=true;toggle.setAttribute('aria-pressed','false');container.classList.remove('is-measuring');}};
}
