import {DxfViewer} from 'dxf-viewer';
import {createCadMeasurement} from './measurement.mjs';
const workspace=document.querySelector('#cad-workspace');
const canvas=document.querySelector('#cad-canvas');
const message=document.querySelector('#cad-message');
const warning=document.querySelector('#cad-warnings');
const layouts=document.querySelector('#cad-layout');
const list=document.querySelector('#cad-layer-list');
let viewer,requestController,worker,blobUrl,measurement,sequence=0;
const notices=new Set();
function showWarnings(){warning.textContent=[...notices].join('\n');warning.hidden=!notices.size;}
function fit(){const b=viewer?.GetBounds(),o=viewer?.GetOrigin();if(b&&o){viewer.FitView(b.minX-o.x,b.maxX-o.x,b.minY-o.y,b.maxY-o.y);viewer.Render();}}
function zoom(scale){const c=viewer?.GetCamera();if(c){c.zoom=Math.min(10000,Math.max(.0001,c.zoom*scale));c.updateProjectionMatrix();viewer.Render();}}
function controls(enabled){for(const id of ['cad-fit','cad-in','cad-out'])document.getElementById(id).disabled=!enabled;layouts.disabled=!enabled;}
async function load(layout){
 const seq=++sequence;measurement?.destroy();measurement=null;requestController?.abort();worker?.terminate();if(blobUrl)URL.revokeObjectURL(blobUrl);viewer?.Destroy();viewer=null;
 controls(false);notices.clear();showWarnings();list.replaceChildren();message.classList.remove('is-error');message.textContent='正在读取图纸…';
 const controller=new AbortController();requestController=controller;const timeout=setTimeout(()=>controller.abort(),110000);
 try{
  const source=new URL(workspace.dataset.source,location.href);if(source.origin!==location.origin)throw Error('图纸地址无效。');if(layout)source.searchParams.set('layout',layout);
  const response=await fetch(source,{credentials:'same-origin',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('登录已失效，请返回商机重新登录。');
  const data=await response.json();if(!response.ok)throw Error(data.error||'图纸读取失败。');if(seq!==sequence)return;
  layouts.replaceChildren(...data.layouts.map(name=>{const option=document.createElement('option');option.value=name;option.textContent=name==='Model'?'模型':name;return option;}));layouts.value=data.layout;
  for(const text of data.warnings)notices.add(text);showWarnings();
  viewer=new DxfViewer(canvas,{autoResize:true,antialias:true});if(!viewer.HasRenderer())throw Error('浏览器不支持WebGL，请更换浏览器或下载查看。');
  viewer.Subscribe('message',event=>{if(event.detail?.level==='warn'){notices.add('部分实体或文字无法完整显示，请结合原图核对。');showWarnings();}});
  blobUrl=URL.createObjectURL(new Blob([data.dxf],{type:'text/plain;charset=utf-8'}));
  await Promise.race([new Promise((_,reject)=>{const abort=()=>reject(new DOMException('Cancelled','AbortError'));if(controller.signal.aborted)abort();else controller.signal.addEventListener('abort',abort,{once:true});}),viewer.Load({url:blobUrl,fonts:[location.origin+'/assets/cad-fonts/NotoSansSC-Regular.ttf'],workerFactory:()=>{worker=new Worker('/assets/cad-preview-worker.js',{type:'module'});return worker;},progressCbk:phase=>{message.textContent=phase==='font'?'正在加载文字字体…':'正在解析图纸…';}})]);
  if(seq!==sequence)return;
  if(!viewer.GetBounds()){message.textContent='当前布局没有可显示的二维实体。';}else{message.textContent='拖动平移 · 滚轮或双指缩放';}
  for(const layer of viewer.GetLayers(true)){
   const row=document.createElement('label'),box=document.createElement('input'),name=document.createElement('span');box.type='checkbox';box.checked=layer.visible;name.textContent=layer.displayName||layer.name;name.title=name.textContent;box.addEventListener('change',()=>viewer.ShowLayer(layer.name,box.checked));row.append(box,name);list.append(row);
  }
  controls(true);
  measurement=createCadMeasurement({viewer,container:canvas,metadata:data.measurement||{enabled:false,unitCode:0,anchors:[]}});
 }catch(error){if(seq!==sequence)return;worker?.terminate();viewer?.Destroy();viewer=null;message.classList.add('is-error');message.textContent=error.name==='AbortError'?'图纸加载超时，请稍后重新打开。':error.message;}
 finally{clearTimeout(timeout);if(seq===sequence&&blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}}
}
document.getElementById('cad-fit').addEventListener('click',fit);
document.getElementById('cad-in').addEventListener('click',()=>zoom(1.35));document.getElementById('cad-out').addEventListener('click',()=>zoom(1/1.35));
layouts.addEventListener('change',()=>load(layouts.value));
document.getElementById('cad-layers-toggle').addEventListener('click',event=>{const panel=document.getElementById('cad-layers');panel.hidden=!panel.hidden;event.currentTarget.setAttribute('aria-expanded',String(!panel.hidden));});
document.getElementById('cad-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await workspace.requestFullscreen();}catch{message.textContent='当前浏览器不支持全屏。';}});
window.addEventListener('pagehide',()=>{sequence++;measurement?.destroy();requestController?.abort();worker?.terminate();viewer?.Destroy();if(blobUrl)URL.revokeObjectURL(blobUrl);});
load();
