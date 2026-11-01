import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createRequire,isBuiltin} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url));
const target=path.resolve(here,'../../src/public/assets');
// Read through Node so managed/encrypted developer workspaces are supported too.
const managedFiles={name:'node-file-reader',setup(builder){
 builder.onResolve({filter:/.*/},args=>{if(isBuiltin(args.path)){if(args.path!=='fs')throw Error('Unexpected browser builtin '+args.path);return {path:'browser-empty-fs',namespace:'empty'};}return {path:args.kind==='entry-point'?path.resolve(args.path):createRequire(args.importer).resolve(args.path).replace(/three\.cjs$/,"three.module.js"),namespace:'node-read'};});
 builder.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'export default {};',loader:'js'}));
 builder.onLoad({filter:/.*/,namespace:'node-read'},async args=>{const contents=await readFile(args.path,'utf8');if(contents.includes('\0'))throw Error('Unreadable build source: '+args.path);return {contents,loader:args.path.endsWith('.json')?'json':'js'};});
}};
for(const [entry,name]of [['viewer.mjs','cad-preview.js'],['worker.mjs','cad-preview-worker.js']]){
 const result=await build({entryPoints:[path.join(here,entry)],outfile:path.join(target,name),bundle:true,minify:true,format:'esm',target:'es2022',legalComments:'eof',plugins:[managedFiles],write:false});
 for(const output of result.outputFiles)await writeFile(output.path,output.contents);
}
const licenses=[];
for(const name of ['dxf-viewer','three','earcut','loglevel','opentype.js','string.prototype.codepointat','tiny-inflate']){
 const dir=path.join(here,'node_modules',name);let pkg;try{pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));}catch{continue;}
 let license='';for(const f of ['LICENSE','LICENSE.txt','LICENSE.md']){try{license=await readFile(path.join(dir,f),'utf8');break;}catch{}}
 licenses.push(`${name} ${pkg.version}\nhttps://registry.npmjs.org/${name}/-/${name}-${pkg.version}.tgz\n${license}`);
}
await mkdir(path.join(target,'cad-fonts'),{recursive:true});
await writeFile(path.join(target,'cad-third-party-notices.txt'),licenses.join('\n\n----------------\n\n'));
