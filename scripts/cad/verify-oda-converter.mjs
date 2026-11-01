import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,mkdir,lstat,realpath,rm} from 'node:fs/promises';
const [command,input,expectedHash]=process.argv.slice(2);
if(!command||!input||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw Error('Usage: node verify-oda-converter.mjs /absolute/convert sample.dwg SHA256');
if(!path.isAbsolute(command))throw Error('Absolute converter path required');
const stat=await lstat(command);if(!stat.isFile()||stat.mode&0o022)throw Error('Converter must be a protected regular file');
const actual=await realpath(command);if(actual!==command||!actual.startsWith('/opt/bestcrm-cad/'))throw Error('Unexpected converter location');
const digest=b=>createHash('sha256').update(b).digest('hex');
const source=await readFile(input);if(digest(source)!==expectedHash||!/^AC10\d{2}/.test(source.subarray(0,6).toString('ascii')))throw Error('Sample DWG identity mismatch');
const dir=await mkdtemp(path.join(os.tmpdir(),'bestcrm-cad-'));
try{
 const from=path.join(dir,'input'),to=path.join(dir,'output');await mkdir(from);await mkdir(to);await writeFile(path.join(from,'drawing.dwg'),source,{mode:0o600});
 const started=Date.now();
 try{await promisify(execFile)(command,[from,to,'ACAD2018','DXF','0','1','drawing.dwg'],{shell:false,timeout:90000,maxBuffer:1024*1024,windowsHide:true,env:{...process.env,QT_QPA_PLATFORM:'offscreen'}});}catch(error){console.error(String(error.stderr||error.message).slice(-5000));throw Error('ODA sample conversion failed; BESTCRM configuration has not been changed.');}
 const output=path.join(to,'drawing.dxf'),st=await lstat(output);if(!st.isFile()||st.isSymbolicLink()||st.size>32*1024*1024)throw Error('Invalid conversion output');
 const bytes=await readFile(output),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(!text.includes('04 标注层'))throw Error('Chinese layer name verification failed');
 const lines=text.replaceAll('\r\n','\n').replaceAll('\r','\n').trimEnd().split('\n'),pairs=[];
 for(let i=0;i<lines.length;i+=2)pairs.push([Number(lines[i].trim()),lines[i+1]?.trim()]);
 let record=[],reference=false;
 const inspect=e=>{if(e[0]?.[1]!=='LINE')return;const n=code=>Number(e.find(([c])=>c===code)?.[1]);if(Math.abs(n(10)-257598.5623113725)<1e-5&&Math.abs(n(20)-15592.25050956465)<1e-5&&Math.abs(n(11)-257598.5623113725)<1e-5&&Math.abs(n(21)-12342.25050956465)<1e-5)reference=true;};
 for(const pair of pairs){if(pair[0]===0&&record.length){inspect(record);record=[];}record.push(pair);}inspect(record);
 if(!reference)throw Error('3250mm source reference line was not preserved');
 if(digest(await readFile(input))!==expectedHash)throw Error('Original DWG changed');
 console.log(JSON.stringify({ok:true,converter:command,sourceSha256:expectedHash,outputBytes:bytes.length,elapsedMs:Date.now()-started,chineseLayerVerified:true,referenceLengthMm:3250,originalUnchanged:true},null,2));
 console.log('ODA_CONVERTER_VERIFIED');
}finally{await rm(dir,{recursive:true,force:true});}
