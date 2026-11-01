import path from 'node:path';
import {cadMeasurementMetadata} from '../utils/cadMeasurement.mjs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, rm, lstat, realpath} from 'node:fs/promises';
import os from 'node:os';
import {resolveStoredPath} from './attachmentFileService.mjs';

const runFile=promisify(execFile);
const failure=(message,statusCode=422)=>Object.assign(new Error(message),{statusCode});
export const CAD_MAX_BYTES=32*1024*1024;
export function isCadAttachment(attachment){return /\.(dwg|dxf)$/i.test(attachment?.originalName||'');}

// Work with group-code pairs, not HTML. Layout isolation keeps model/paper entities separate.
export function prepareCadDxf(buffer,selectedLayout=null){
 if(buffer.length>CAD_MAX_BYTES)throw failure('图纸超过32MB预览限制，请下载后查看。',413);
 if(buffer.subarray(0,22).toString('ascii').startsWith('AutoCAD Binary DXF'))throw failure('暂不支持二进制DXF，请另存为ASCII DXF后上传。');
 const head=buffer.subarray(0,65536).toString('latin1');
 const version=Number(/\$ACADVER\s*\n\s*1\s*\n\s*AC(\d{4})/.exec(head.replaceAll('\r\n','\n'))?.[1]||0);
 // R2007+ DXF uses UTF-8 even when $DWGCODEPAGE still names a legacy page.
 const encoding=version>=1021?undefined:/ANSI_936|ANSI_950|ANSI_932/i.exec(head)?.[0]?.toUpperCase();
 const decoder=new TextDecoder(encoding==='ANSI_936'?'gb18030':encoding==='ANSI_950'?'big5':encoding==='ANSI_932'?'shift_jis':'utf-8',{fatal:!encoding});
 let text;try{text=decoder.decode(buffer);}catch{throw failure('无法读取图纸编码，请上传已解密的ASCII DXF或DWG。');}
 text=text.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').replaceAll('\r','\n').trimEnd();
 const lines=text.split('\n');
 if(lines.length%2||lines.length>2000000)throw failure('DXF结构无效或图纸过于复杂。');
 const pairs=[];for(let i=0;i<lines.length;i+=2){const code=Number(lines[i].trim());if(!/^\s*\d+\s*$/.test(lines[i])||!Number.isInteger(code)||code>1071)throw failure('不是可读取的DXF，请先解密后上传。');pairs.push([code,lines[i+1]]);}
 if(!pairs.some(([c,v])=>c===2&&v.trim()==='ENTITIES')||pairs.at(-1)?.[1].trim()!=='EOF')throw failure('DXF缺少实体段或文件结束标记，请确认文件已解密且完整。');
 let start=-1,end=-1;
 for(let i=0;i<pairs.length-1;i++)if(pairs[i][0]===0&&pairs[i][1].trim()==='SECTION'&&pairs[i+1][0]===2&&pairs[i+1][1].trim()==='ENTITIES'){start=i+2;for(let j=start;j<pairs.length;j++)if(pairs[j][0]===0&&pairs[j][1].trim()==='ENDSEC'){end=j;break;}break;}
 if(start<0||end<0)throw failure('DXF实体段不完整。');
 const entities=[];let record=[];
 for(const pair of pairs.slice(start,end)){if(pair[0]===0&&record.length){entities.push(record);record=[];}record.push(pair);}if(record.length)entities.push(record);
 if(entities.length>200000)throw failure('实体数量超过预览限制，请下载后查看。',413);
 const val=(entity,code)=>entity.find(([c])=>c===code)?.[1]?.trim();
 const layoutMap=new Map();let compoundLayout=null;
 for(const e of entities){
  const type=val(e,0),own=val(e,410)||(val(e,67)==='1'?'Layout1':'Model');
  layoutMap.set(e,['VERTEX','ATTRIB','SEQEND'].includes(type)&&compoundLayout?compoundLayout:own);
  if(type==='POLYLINE'||(type==='INSERT'&&val(e,66)==='1'))compoundLayout=own;
  else if(!['VERTEX','ATTRIB'].includes(type))compoundLayout=null;
 }
 const layoutOf=e=>layoutMap.get(e);
 const layouts=[...new Set(['Model',...entities.map(layoutOf)])];
 if(layouts.length>100)throw failure('图纸布局数量超过预览限制。',413);
 const layout=selectedLayout===null?layouts[0]:String(selectedLayout);
 if(!layouts.includes(layout))throw failure('图纸布局不存在。',404);
 const warnings=[];
 if(entities.some(e=>['VIEWPORT','IMAGE','OLE2FRAME','ACAD_PROXY_ENTITY'].includes(val(e,0))))warnings.push('包含视口、外部图片或代理对象；预览可能不完整，请结合原图核对。');
 if(pairs.some(([c,v])=>c===0&&v.trim()==='BLOCK')&&pairs.some(([c,v])=>c===1&&/\.(dwg|dxf)$/i.test(v.trim())))warnings.push('外部参照不会自动加载，请上传绑定外部参照后的图纸。');
 if(layout!=='Model')warnings.push('当前展示布局内实体，不重建纸空间视口中的模型投影。');
 // Unicode DXF values and block definitions are retained; only top-level ENTITIES are selected.
 const filtered=[...pairs.slice(0,start),...entities.filter(e=>layoutOf(e)===layout).flat(),...pairs.slice(end)];
 const output=Buffer.from(filtered.map(([c,v])=>`${c}\n${v}`).join('\n')+'\n','utf8');
 return {buffer:output,layout,layouts,warnings,entityCount:entities.filter(e=>layoutOf(e)===layout).length,measurement:cadMeasurementMetadata(pairs,entities.filter(e=>layoutOf(e)===layout),layout)};
}

export function createCadPreviewService({uploadDir,converterCommand='',exec=runFile,maxBytes=CAD_MAX_BYTES}={}){
 const active=new Map();
 async function source(attachment){
  if(!isCadAttachment(attachment)||attachment.retiredAt)throw failure('图纸不存在或已移除。',404);
  const p=resolveStoredPath(uploadDir,attachment.storedPath);if(!p)throw failure('图纸不存在。',404);
  const root=await realpath(uploadDir);let st;try{st=await lstat(p);}catch(e){if(e.code==='ENOENT')throw failure('图纸原文件不存在。',404);throw e;}
  const actual=await realpath(p);
  if(st.isSymbolicLink()||!st.isFile()||!actual.startsWith(root+path.sep))throw failure('图纸存储路径无效。',404);
  if(st.size>maxBytes)throw failure('图纸超过32MB预览限制，请下载后查看。',413);
  const data=await readFile(p);if(data.length>maxBytes)throw failure('图纸超过预览限制。',413);
  const hash=createHash('sha256').update(data).digest('hex');
  if(attachment.sha256&&hash!==String(attachment.sha256).trim())throw failure('图纸校验失败，请联系管理员。',409);
  return {data,hash};
 }
 async function converted(attachment,input){
  if(/\.dxf$/i.test(attachment.originalName))return input.data;
  if(!/^AC10\d{2}/.test(input.data.subarray(0,6).toString('ascii')))throw failure('DWG格式无法识别，请确认已解密后上传。');
  if(!converterCommand)throw failure('DWG预览转换器尚未配置；可先上传ASCII DXF进行预览。',503);
  if(!path.isAbsolute(converterCommand))throw failure('DWG转换器必须配置为绝对路径。',503);
  const key=`${attachment.id}:${input.hash}`;
  if(active.has(key))return active.get(key);
  if(active.size>=2)throw failure('图纸预览繁忙，请稍后重试。',429);
  const task=(async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),'bestcrm-cad-'));
   try{
    const from=path.join(dir,'input'),to=path.join(dir,'output');await mkdir(from);await mkdir(to);
    await writeFile(path.join(from,'drawing.dwg'),input.data,{mode:0o600});
    try{await exec(converterCommand,[from,to,'ACAD2018','DXF','0','1','drawing.dwg'],{shell:false,timeout:90000,maxBuffer:1024*1024,windowsHide:true,env:{...process.env,QT_QPA_PLATFORM:'offscreen'}});}catch{throw failure('DWG转换失败或超时，请核查转换器及图纸版本。',502);}
    const output=path.join(to,'drawing.dxf');let st;try{st=await lstat(output);}catch{throw failure('DWG转换器未生成DXF预览。',502);}
    if(!st.isFile()||st.isSymbolicLink()||st.size>maxBytes)throw failure('DWG预览结果无效或过大。',502);
    return await readFile(output);
   }finally{await rm(dir,{recursive:true,force:true});}
  })();active.set(key,task);try{return await task;}finally{active.delete(key);}
 }
 return {async preview(attachment,layout=null){const input=await source(attachment);const result=prepareCadDxf(await converted(attachment,input),layout);return {...result,sha256:input.hash};}};
}
