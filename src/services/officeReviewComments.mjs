import {JSDOM} from 'jsdom';
import {readOfficePackageParts} from '../utils/attachmentPreview.mjs';
const elements=(root,name)=>Array.from(root.getElementsByTagNameNS('*',name));
const attr=(node,name)=>Array.from(node.attributes||[]).find(a=>a.localName===name)?.value||'';
function xml(value){if(/<!DOCTYPE|<!ENTITY/i.test(value))throw Error('Unsupported Office XML');return new JSDOM(value,{contentType:'text/xml'}).window.document;}
export function extractOfficeReviewComments(buffer,extension){
 const parts=new Map(readOfficePackageParts(buffer).map(p=>[p.name,p.data.toString('utf8')]));const comments=[];
 if(extension==='.docx'){
  if(!parts.has('word/comments.xml'))return [];
  const document=xml(parts.get('word/document.xml'));const active=new Map(),quotes=new Map();
  for(const node of Array.from(document.getElementsByTagName('*'))){const id=attr(node,'id');if(node.localName==='commentRangeStart')active.set(id,true);if(node.localName==='commentRangeEnd')active.delete(id);if(node.localName==='t')for(const key of active.keys())quotes.set(key,(quotes.get(key)||'')+node.textContent);}
  for(const node of elements(xml(parts.get('word/comments.xml')),'comment'))comments.push({id:attr(node,'id'),author:attr(node,'author'),date:attr(node,'date'),location:quotes.get(attr(node,'id'))||'文档批注',text:elements(node,'t').map(n=>n.textContent).join('\n')});
 }else if(extension==='.xlsx'){
  const sheetNames=new Map();
  if(parts.has('xl/workbook.xml')&&parts.has('xl/_rels/workbook.xml.rels')){
   const relationships=elements(xml(parts.get('xl/_rels/workbook.xml.rels')),'Relationship');
   for(const sheet of elements(xml(parts.get('xl/workbook.xml')),'sheet')){const rel=relationships.find(r=>attr(r,'Id')===attr(sheet,'id'));if(rel){const target=attr(rel,'Target').replace(/^\/?xl\//,'');sheetNames.set(target,attr(sheet,'name'));}}
  }
  const locations=new Map();
  for(const [name,value] of parts)if(/^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(name)){
   const sheetPart=name.replace('/_rels/','/').replace(/\.rels$/,'').replace(/^xl\//,'');
   for(const rel of elements(xml(value),'Relationship'))if(/\/comments$/.test(attr(rel,'Type'))){let target=attr(rel,'Target');target=target.startsWith('/')?target.slice(1):new URL(target,'https://office.test/xl/worksheets/').pathname.slice(1);locations.set(target,sheetNames.get(sheetPart)||sheetPart);}
  }
  for(const [name,value] of parts)if(/^xl\/(?:comments\/)?comments?\d*\.xml$/i.test(name)){
   const root=xml(value),authors=elements(root,'author').map(n=>n.textContent);
   for(const node of elements(root,'comment'))comments.push({id:name+':'+attr(node,'ref'),author:authors[Number(attr(node,'authorId'))]||'',date:'',location:(locations.get(name)||name)+'!'+attr(node,'ref'),text:elements(node,'t').map(n=>n.textContent).join('')});
  }
 }else throw Error('Unsupported Office review format');
 if(comments.length>1000||JSON.stringify(comments).length>500000)throw Error('Too many review comments');
 return comments.map(c=>({...c,location:c.location.slice(0,2000),text:c.text.slice(0,20000)}));
}
