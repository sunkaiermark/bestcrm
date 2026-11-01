import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCadPreviewService,prepareCadDxf} from '../../src/services/cadPreviewService.mjs';
const pairs=[0,'SECTION',2,'ENTITIES',0,'LINE',8,'Pipe',10,0,20,0,11,100,21,100,0,'CIRCLE',8,'Tank',10,50,20,50,40,20,0,'TEXT',8,'Text',10,10,20,10,40,5,1,'测试管线',0,'LINE',410,'图纸1',67,1,10,0,20,0,11,10,21,0,0,'VIEWPORT',410,'图纸1',67,1,0,'ENDSEC',0,'EOF'];
const dxf=Buffer.from(pairs.join('\n')+'\n');
test('modern UTF-8 DXF ignores stale ANSI codepage while older DXF uses its declared Chinese encoding',()=>{
 const header=v=>`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\n${v}\n9\n$DWGCODEPAGE\n3\nANSI_936\n0\nENDSEC\n`;
 const modern=prepareCadDxf(Buffer.from(header('AC1032')+pairs.join('\n')+'\n'));
 assert.match(modern.buffer.toString('utf8'),/测试管线/);assert.doesNotMatch(modern.buffer.toString('utf8'),/\ufffd/);
 const legacy=Buffer.concat([Buffer.from(header('AC1018')+'0\nSECTION\n2\nENTITIES\n0\nTEXT\n10\n0\n20\n0\n40\n5\n1\n'),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from('\n0\nENDSEC\n0\nEOF\n')]);
 assert.match(prepareCadDxf(legacy).buffer.toString('utf8'),/中文/);
});
test('CAD isolates layouts, preserves text and warns about unsupported viewport projections',()=>{
 const p=prepareCadDxf(dxf);assert.deepEqual(p.layouts,['Model','图纸1']);assert.equal(p.entityCount,3);assert.match(p.buffer.toString(),/测试管线/);assert.doesNotMatch(p.buffer.toString(),/VIEWPORT/);assert.ok(p.warnings.length);
 const paper=prepareCadDxf(dxf,'图纸1');assert.equal(paper.entityCount,2);assert.doesNotMatch(paper.buffer.toString(),/测试管线/);assert.ok(paper.warnings.some(s=>s.includes('模型投影')));
 assert.throws(()=>prepareCadDxf(dxf,'other'),e=>e.statusCode===404);
});
test('CAD rejects encrypted, binary, malformed, truncated and oversized files',()=>{
 for(const b of [Buffer.from('encrypted'),Buffer.from('AutoCAD Binary DXF\r\n\x1a\0'),Buffer.from('0\nSECTION\n2\nENTITIES\n'),Buffer.from('0\nSECTION\n2\nENTITIES\nbad\nX\n0\nEOF\n')])assert.throws(()=>prepareCadDxf(b));
 assert.throws(()=>prepareCadDxf(Buffer.alloc(32*1024*1024+1)),e=>e.statusCode===413);
});
test('CAD source verifies hash and refuses retired files, traversal and unconfigured DWG conversion',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cad-test-'));try{
  await writeFile(path.join(root,'test.dxf'),dxf);await writeFile(path.join(root,'test.dwg'),'AC1032test');
  const svc=createCadPreviewService({uploadDir:root}),a={id:7,originalName:'test.dxf',storedPath:'test.dxf',sha256:createHash('sha256').update(dxf).digest('hex')};
  assert.equal((await svc.preview(a)).entityCount,3);await assert.rejects(svc.preview({...a,sha256:'0'.repeat(64)}),e=>e.statusCode===409);
  await assert.rejects(svc.preview({...a,retiredAt:new Date()}),e=>e.statusCode===404);await assert.rejects(svc.preview({...a,storedPath:'../test.dxf'}),e=>e.statusCode===404);
  await assert.rejects(svc.preview({id:8,originalName:'test.dwg',storedPath:'test.dwg'}),e=>e.statusCode===503);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('DWG uses isolated fixed arguments, no shell, cleans temporary files, preserves original',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cad-test-'));let temporary;
 try{
  const source=Buffer.from('AC1032test');await writeFile(path.join(root,'source.dwg'),source);
  const svc=createCadPreviewService({uploadDir:root,converterCommand:path.join(root,'converter'),exec:async(command,args,opts)=>{
   assert.equal(opts.shell,false);assert.equal(opts.timeout,90000);assert.deepEqual(args.slice(2),['ACAD2018','DXF','0','1','drawing.dwg']);temporary=path.dirname(args[0]);assert.deepEqual(await readFile(path.join(args[0],'drawing.dwg')),source);await writeFile(path.join(args[1],'drawing.dxf'),dxf);
  }});
  assert.equal((await svc.preview({id:8,originalName:'malicious;file.dwg',storedPath:'source.dwg'})).entityCount,3);
  await assert.rejects(access(temporary));assert.deepEqual(await readFile(path.join(root,'source.dwg')),source);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('DWG conversion failures clean temporary files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cad-test-'));let temporary;
 try{await writeFile(path.join(root,'x.dwg'),'AC1032test');const svc=createCadPreviewService({uploadDir:root,converterCommand:path.join(root,'converter'),exec:async(_c,args)=>{temporary=path.dirname(args[0]);throw Error('timeout');}});await assert.rejects(svc.preview({id:2,originalName:'x.dwg',storedPath:'x.dwg'}),e=>e.statusCode===502);await assert.rejects(access(temporary));}finally{await rm(root,{recursive:true,force:true});}
});
