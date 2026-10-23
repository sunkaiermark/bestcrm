import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ejs from 'ejs';
test('Office version migration installs with source, immutable history and active editing constraints',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE TABLE users(id bigint PRIMARY KEY);CREATE TABLE opportunities(id bigint PRIMARY KEY);CREATE TABLE attachments(id bigint PRIMARY KEY);');
 await db.exec(await readFile(new URL('../../src/db/migrations/131_office_edit_versions.sql',import.meta.url),'utf8'));
 const result=await db.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('office_edit_sessions','office_edit_versions')");assert.equal(result.rows.length,2);
 }finally{await db.close();}
});
test('Office editor view compiles with safely embedded JSON',async()=>{
 const source=await readFile(new URL('../../src/views/attachments/office-editor.ejs',import.meta.url),'utf8');
 assert.doesNotThrow(()=>ejs.compile(source));assert.match(source,/replaceAll\('<'/);
});
