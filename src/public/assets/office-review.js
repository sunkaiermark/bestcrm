(() => {
 const status=document.getElementById('office-review-status');
 if(!window.DocsAPI){status.textContent='文档服务连接失败，请稍后重试。';return;}
 const config=JSON.parse(document.getElementById('office-review-config').textContent);
 config.events={onAppReady(){status.textContent='仅批注模式已就绪，原文不可修改。';},onDocumentStateChange(event){status.textContent=event.data?'批注有改动，请点击编辑器保存。':'批注已同步至文档服务，正在等待归档确认。';},onError(){status.textContent='批注编辑器发生错误，请保留窗口并联系管理员。';}};
 new window.DocsAPI.DocEditor('office-review-editor',config);
 let savedId=status.dataset.savedId;
 const timer=setInterval(async()=>{try{const r=await fetch('/office-review/'+encodeURIComponent(status.dataset.sessionId)+'/status',{credentials:'same-origin'});if(!r.ok){status.textContent='审核权限或文件状态已变化，请保留窗口并刷新商机核实。';return;}const data=await r.json();if(data.savedId&&String(data.savedId)!==savedId){savedId=String(data.savedId);status.textContent='批注已归档：'+new Date(data.savedAt).toLocaleString()+'。可关闭窗口，再回商机退回或批准。';}}catch{/* Retry transient failures. */}},5000);
 window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
})();
