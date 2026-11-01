import test from 'node:test';
import assert from 'node:assert/strict';
import {measureCadPoints,cadMeasurementMetadata,nearestCadAnchor} from '../../src/utils/cadMeasurement.mjs';
import {prepareCadDxf} from '../../src/services/cadPreviewService.mjs';
test('CAD distance uses geometry coordinates, converts units and applies calibration',()=>{
 const a={x:10000000,y:-2000000},b={x:10000003,y:-1999996};
 assert.deepEqual(measureCadPoints(a,b,{sourceUnit:4}),{distance:5,horizontal:3,vertical:4,unit:'mm',unitAssumed:false});
 assert.equal(measureCadPoints(a,b,{sourceUnit:4,targetUnit:6}).distance,.005);
 assert.equal(measureCadPoints(a,b,{sourceUnit:4,scale:2}).distance,10);
 assert.equal(measureCadPoints({x:0,y:0},{x:1,y:0},{sourceUnit:1,targetUnit:4}).distance,25.4);
 assert.equal(measureCadPoints(a,b,{sourceUnit:0,targetUnit:4}).unitAssumed,true);
 assert.equal(measureCadPoints(a,a).distance,0);
 for(const scale of [0,-1,NaN,Infinity,1e10])assert.throws(()=>measureCadPoints(a,b,{scale}));
 assert.throws(()=>measureCadPoints({x:NaN,y:0},b));
});
test('CAD reads only header units and extracts visible planar endpoints and circle centers',()=>{
 const pairs=[[0,'SECTION'],[2,'HEADER'],[9,'$INSUNITS'],[70,'4'],[0,'ENDSEC']];
 const entities=[[[0,'LINE'],[8,'Pipes'],[10,'10'],[20,'20'],[11,'30'],[21,'40']],[[0,'CIRCLE'],[8,'Tank'],[10,'50'],[20,'50'],[40,'5']],[[0,'LINE'],[60,'1'],[10,'99'],[20,'99'],[11,'100'],[21,'100']],[[0,'LINE'],[30,'5'],[10,'1'],[20,'1'],[11,'2'],[21,'2']]];
 const data=cadMeasurementMetadata(pairs,entities,'Model');assert.equal(data.unitCode,4);assert.equal(data.anchors.length,3);assert.equal(data.anchors[2].kind,'圆心');
 assert.equal(nearestCadAnchor(data.anchors,{x:10.1,y:20},1,new Set(['Pipes'])).x,10);
 assert.equal(nearestCadAnchor(data.anchors,{x:50,y:50},1,new Set(['Pipes'])),null);
 assert.equal(nearestCadAnchor(data.anchors,{x:100,y:100},1),null);
 assert.equal(cadMeasurementMetadata(pairs,entities,'图纸1').enabled,false);assert.equal(cadMeasurementMetadata(pairs,entities,'图纸1').anchors.length,0);
 assert.equal(cadMeasurementMetadata([[9,'$INSUNITS'],[70,'4']],[],'Model').unitCode,0);
});
test('CAD arc endpoints use degree angles and metadata travels with selected layout',()=>{
 const raw=[0,'SECTION',2,'HEADER',9,'$INSUNITS',70,4,0,'ENDSEC',0,'SECTION',2,'ENTITIES',0,'ARC',10,10,20,10,40,5,50,0,51,90,0,'LINE',410,'Paper',67,1,10,0,20,0,11,10,21,10,0,'ENDSEC',0,'EOF'].join('\n')+'\n';
 const model=prepareCadDxf(Buffer.from(raw));assert.equal(model.measurement.unitCode,4);assert.equal(model.measurement.anchors.length,3);assert.equal(model.measurement.anchors[1].x,15);assert.equal(model.measurement.anchors[2].y,15);
 const paper=prepareCadDxf(Buffer.from(raw),'Paper');assert.equal(paper.measurement.enabled,false);assert.deepEqual(paper.measurement.anchors,[]);
});
test('paper polyline vertices never become model measurement targets and nonplanar polyline snapping is skipped',()=>{
 const raw=[0,'SECTION',2,'ENTITIES',0,'POLYLINE',410,'Paper',67,1,70,0,0,'VERTEX',10,10,20,20,0,'VERTEX',10,30,20,40,0,'SEQEND',0,'ENDSEC',0,'EOF'].join('\n')+'\n';
 const model=prepareCadDxf(Buffer.from(raw));assert.equal(model.entityCount,0);assert.deepEqual(model.measurement.anchors,[]);
 const paper=prepareCadDxf(Buffer.from(raw),'Paper');assert.match(paper.buffer.toString(),/VERTEX/);assert.equal(paper.entityCount,4);
 const entities=[[[0,'POLYLINE'],[230,'-1']],[[0,'VERTEX'],[10,'10'],[20,'20']],[[0,'SEQEND']]];
 assert.deepEqual(cadMeasurementMetadata([],entities,'Model').anchors,[]);
});
