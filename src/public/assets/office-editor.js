(() => {
  const status=document.getElementById('office-save-status');
  if(!window.DocsAPI){status.textContent='文档服务连接失败，请稍后重试。';return;}
  const config=JSON.parse(document.getElementById('office-editor-config').textContent);
  config.events={onAppReady(){status.textContent='编辑器已就绪。保存后将在后台生成新版本，未修改不增加版本。';},onDocumentStateChange(event){status.textContent=event.data?'有未保存的修改，请点击保存。':'修改已同步到文档服务，版本归档以服务器记录为准。';},onError(){status.textContent='编辑器发生错误，请保留当前窗口并联系管理员。';}};
  new window.DocsAPI.DocEditor('office-editor',config);
  let version=Number(status.dataset.versionNo);
  const poll=async()=>{
    try {const r=await fetch('/office-editor/'+encodeURIComponent(status.dataset.sessionId)+'/status',{credentials:'same-origin'});if(!r.ok)return;const data=await r.json();if(data.versionNo>version){version=data.versionNo;status.textContent='已保存新版本 V'+version+'。刷新页面可查看版本记录。';}}
    catch { /* Keep editing available during a transient status check failure. */ }
  };
  const timer=setInterval(poll,5000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
})();
