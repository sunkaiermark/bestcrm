import { randomUUID } from 'node:crypto';
import { mkdir,writeFile,rename,rm,readFile } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { Readable } from 'node:stream';
import { fail,parse,evidenceSchema,safeJson } from './contracts.mjs';
import { sha256 } from './auth.mjs';
export const mimeExtensions={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','text/plain':'txt','audio/wav':'wav','audio/mpeg':'mp3'};
export function validMagic(buffer,mime){
 if(mime==='application/pdf')return buffer.subarray(0,5).toString()==='%PDF-';
 if(mime==='image/png')return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
 if(mime==='audio/wav')return buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WAVE';
 if(mime==='audio/mpeg')return buffer.subarray(0,3).toString()==='ID3'||(buffer[0]===255&&(buffer[1]&224)===224);
 if(mime==='text/plain'){try{new TextDecoder('utf-8',{fatal:true}).decode(buffer);return !buffer.includes(0);}catch{return false;}}
 return false;
}
export async function parseEvidence(req){
 const stream=Readable.from(req.body);stream.headers=req.headers;stream.method=req.method;
 await new Promise((resolve,reject)=>multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:1,fields:1,fieldSize:10000,parts:3}}).single('file')(stream,{},e=>e?reject(e):resolve()));
 if(!stream.file||!stream.body?.metadata||Object.keys(stream.body).length!==1)fail(422,'invalid_multipart');
 const meta=parse(evidenceSchema,safeJson(Buffer.from(stream.body.metadata)));
 const file=stream.file;
 const decodedName=Buffer.from(file.originalname,'latin1').toString('utf8');
 if((file.originalname!==meta.file_name&&decodedName!==meta.file_name)||file.mimetype!==meta.mime_type||file.size!==meta.file_size||path.extname(meta.file_name).toLowerCase()!=='.'+mimeExtensions[meta.mime_type])fail(422,'file_metadata_mismatch');
 if(sha256(file.buffer)!==meta.sha256)fail(422,'file_hash_mismatch');
 if(!validMagic(file.buffer,meta.mime_type))fail(422,'file_type_mismatch');
 return{meta,buffer:file.buffer};
}
export async function stageEvidence({buffer,meta,root,scanner}){
 if(!scanner?.scanFile)fail(503,'scanner_unavailable');
 const quarantine=path.resolve(root,'.quarantine');await mkdir(quarantine,{recursive:true,mode:0o700});
 const key=randomUUID()+'.'+mimeExtensions[meta.mime_type];const staged=path.join(quarantine,key);const target=path.resolve(root,key);
 await writeFile(staged,buffer,{flag:'wx',mode:0o600});
 try{const scan=await scanner.scanFile(staged,{sha256:meta.sha256,fileSize:meta.file_size});if(scan?.verdict!=='clean')fail(scan?.verdict==='malware'?422:503,scan?.verdict==='malware'?'malware_detected':'scan_failed');await rename(staged,target);return{key,target};}catch(e){await rm(staged,{force:true});throw e;}
}
export async function readEvidence(root,e){if(!/^[a-f0-9-]{36}\.[a-z0-9]+$/.test(e.storage_key))fail(404,'evidence_not_found');const file=await readFile(path.resolve(root,e.storage_key));if(file.length!==Number(e.file_size)||sha256(file)!==e.sha256)fail(409,'evidence_integrity_failed');return file;}
