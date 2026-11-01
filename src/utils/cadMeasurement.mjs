// All distances use drawing coordinates. Pixel coordinates are only used for picking tolerance.
export const CAD_UNITS = Object.freeze({
 0:{label:'图纸单位',meters:null},1:{label:'in',meters:.0254},2:{label:'ft',meters:.3048},
 3:{label:'mi',meters:1609.344},4:{label:'mm',meters:.001},5:{label:'cm',meters:.01},
 6:{label:'m',meters:1},7:{label:'km',meters:1000},8:{label:'微英寸',meters:2.54e-8},
 9:{label:'mil',meters:2.54e-5},10:{label:'yd',meters:.9144},11:{label:'Å',meters:1e-10},
 12:{label:'nm',meters:1e-9},13:{label:'μm',meters:1e-6},14:{label:'dm',meters:.1},
 15:{label:'dam',meters:10},16:{label:'hm',meters:100},17:{label:'Gm',meters:1e9},
 18:{label:'AU',meters:149597870700},19:{label:'光年',meters:9460730472580800},
 20:{label:'pc',meters:3.085677581491367e16},21:{label:'美制测量英尺',meters:1200/3937},
 22:{label:'美制测量英寸',meters:100/3937},23:{label:'美制测量码',meters:3600/3937},24:{label:'美制测量英里',meters:6336000/3937}
});

export function measureCadPoints(a,b,{scale=1,sourceUnit=0,targetUnit=sourceUnit}={}){
 if(![a?.x,a?.y,b?.x,b?.y,scale].every(Number.isFinite)||scale<=0||scale>1e9)throw new Error('测量坐标或校准比例无效。');
 const source=CAD_UNITS[sourceUnit]||CAD_UNITS[0],target=CAD_UNITS[targetUnit]||CAD_UNITS[0];
 const factor=scale*(source.meters&&target.meters?source.meters/target.meters:1);
 const horizontal=Math.abs(b.x-a.x)*factor,vertical=Math.abs(b.y-a.y)*factor;
 const distance=Math.hypot(horizontal,vertical);
 if(![distance,horizontal,vertical].every(Number.isFinite))throw new Error('测量数值超出范围。');
 return {distance,horizontal,vertical,unit:target.label,unitAssumed:!source.meters&&Boolean(target.meters)};
}

export function cadMeasurementMetadata(pairs,entities,layout){
 let inHeader=false,unitCode=0;
 for(let i=0;i<pairs.length;i++){
  const [c,v]=pairs[i];
  if(c===0&&v.trim()==='SECTION')inHeader=pairs[i+1]?.[0]===2&&pairs[i+1]?.[1].trim()==='HEADER';
  if(inHeader&&c===9&&v.trim()==='$INSUNITS'&&pairs[i+1]?.[0]===70){const n=Number(pairs[i+1][1]);if(CAD_UNITS[n])unitCode=n;}
  if(inHeader&&c===0&&v.trim()==='ENDSEC')inHeader=false;
 }
 const anchors=[];let truncated=false,polylineLayer=null,skipPolyline=false;
 const value=(e,code)=>e.find(([c])=>c===code)?.[1]?.trim();
 const number=(e,code,fallback=NaN)=>{const v=value(e,code);return v===undefined?fallback:Number(v);};
 const point=(e,x,y)=>({x:number(e,x),y:number(e,y)});
 const add=(p,kind,layer)=>{if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return;if(anchors.length>=20000){truncated=true;return;}anchors.push({...p,kind,layer});};
 for(const e of entities){
  const type=value(e,0),layer=value(e,8)||polylineLayer||'0';
  if(type==='POLYLINE'){polylineLayer=layer;skipPolyline=Boolean(number(e,70,0)&(8|16|64))||number(e,60,0)===1||number(e,30,0)!==0||number(e,210,0)!==0||number(e,220,0)!==0||number(e,230,1)!==1;continue;}
  if(type==='SEQEND'){polylineLayer=null;skipPolyline=false;continue;}
  // Avoid incorrect snapping on hidden entities, 3D geometry, OCS transforms or unexpanded blocks.
  if(number(e,60,0)===1||number(e,30,0)!==0||number(e,31,0)!==0||number(e,38,0)!==0||number(e,210,0)!==0||number(e,220,0)!==0||number(e,230,1)!==1)continue;
  if(type==='LINE'){add(point(e,10,20),'端点',layer);add(point(e,11,21),'端点',layer);}
  else if(type==='VERTEX'&&!skipPolyline)add(point(e,10,20),'端点',layer==='0'&&polylineLayer?polylineLayer:layer);
  else if(type==='LWPOLYLINE'){let x=null;for(const [c,v]of e){if(c===10)x=Number(v);if(c===20&&x!==null){add({x,y:Number(v)},'端点',layer);x=null;}}}
  else if(type==='CIRCLE'||type==='ARC'){
   const center=point(e,10,20);add(center,'圆心',layer);
   if(type==='ARC'){const r=number(e,40);if(Number.isFinite(r)&&r>=0)for(const angle of [number(e,50),number(e,51)])if(Number.isFinite(angle))add({x:center.x+r*Math.cos(angle*Math.PI/180),y:center.y+r*Math.sin(angle*Math.PI/180)},'端点',layer);}
  }
 }
 return {enabled:layout==='Model',unitCode,unitLabel:CAD_UNITS[unitCode].label,anchors:layout==='Model'?anchors:[],snapTruncated:truncated};
}

export function nearestCadAnchor(anchors,point,tolerance,visibleLayers=null){
 if(!Number.isFinite(tolerance)||tolerance<=0)return null;
 let best=null,distance=tolerance;
 for(const a of anchors){if(visibleLayers&&!visibleLayers.has(a.layer))continue;const d=Math.hypot(a.x-point.x,a.y-point.y);if(Number.isFinite(d)&&d<distance){distance=d;best=a;}}
 return best;
}
