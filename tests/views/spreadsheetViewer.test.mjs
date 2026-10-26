import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM} from 'jsdom';
const html='<section id="spreadsheet-viewer-shell" data-office-api-url="https://docs.example.invalid/api.js"><button id="spreadsheet-viewer-fullscreen">全屏预览</button><p id="spreadsheet-viewer-status"></p><div id="spreadsheet-viewer-editor"></div><div id="spreadsheet-viewer-fallback" hidden></div></section><script id="spreadsheet-viewer-config" type="application/json">{"document":{"permissions":{"edit":false}},"editorConfig":{"mode":"view"}}</script>';
test('viewer starts with read-only settings and shows useful ready/error states',async()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'});try{
 let options;dom.window.DocsAPI={DocEditor:function(id,config){assert.equal(id,'spreadsheet-viewer-editor');options=config;config.events.onDocumentReady();}};
 dom.window.eval(await readFile('src/public/assets/spreadsheet-viewer.js','utf8'));
 assert.equal(options.document.permissions.edit,false);assert.equal(options.editorConfig.mode,'view');
 const d=dom.window.document;assert.match(d.getElementById('spreadsheet-viewer-status').textContent,/只读预览/);assert.equal(d.getElementById('spreadsheet-viewer-fallback').hidden,true);
 options.events.onError({data:{errorDescription:'<script>untrusted</script>'}});assert.equal(d.getElementById('spreadsheet-viewer-fallback').hidden,false);assert.doesNotMatch(d.getElementById('spreadsheet-viewer-status').textContent,/untrusted/);
 d.getElementById('spreadsheet-viewer-fullscreen').click();await Promise.resolve();assert.match(d.getElementById('spreadsheet-viewer-status').textContent,/不支持全屏/);
 }finally{dom.window.close();}
});
