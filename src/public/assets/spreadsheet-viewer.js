(()=>{
 const shell=document.getElementById('spreadsheet-viewer-shell');if(!shell)return;
 const status=document.getElementById('spreadsheet-viewer-status'),fallback=document.getElementById('spreadsheet-viewer-fallback'),fullscreen=document.getElementById('spreadsheet-viewer-fullscreen');
 let slowTimer;
 const failed=()=>{clearTimeout(slowTimer);status.textContent='工作簿预览暂时无法加载，请重试或下载原文件查看。';fallback.hidden=false;};
 fullscreen.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(shell.requestFullscreen)await shell.requestFullscreen();else status.textContent='当前浏览器不支持全屏，可使用工作簿内的缩放工具。';}catch{status.textContent='无法进入全屏，可使用工作簿内的缩放工具。';}});
 document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'退出全屏':'全屏预览';});
 function start(){try{
  if(!window.DocsAPI?.DocEditor)return failed();
  const config=JSON.parse(document.getElementById('spreadsheet-viewer-config').textContent);
  config.events={onAppReady(){status.textContent='文档服务已连接，正在加载工作簿…';},onDocumentReady(){clearTimeout(slowTimer);status.textContent='只读预览，可在工作簿中切换工作表和调整缩放。';fallback.hidden=true;},onError:failed};
  new window.DocsAPI.DocEditor('spreadsheet-viewer-editor',config);
 }catch{failed();}}
 slowTimer=setTimeout(()=>{status.textContent='工作簿加载较慢，可以继续等待，或下载原文件查看。';fallback.hidden=false;},30000);
 if(window.DocsAPI?.DocEditor)start();else{const script=document.createElement('script');script.src=shell.dataset.officeApiUrl;script.onload=start;script.onerror=failed;document.head.append(script);}
})();
