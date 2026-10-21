(() => {
 const form=document.getElementById('lead-submission-form'),dialog=document.getElementById('lead-ai-dialog');if(!form||!dialog)return;
 const byId=id=>document.getElementById(id),field=name=>form.elements.namedItem(name),report=field('customerAnalysisReport');
 const notice=message=>{byId('lead-ai-status').textContent=message;byId('lead-ai-dialog-status').textContent=message;};
 const contextNames=['companyName','companyWebsite','transactionRole','endUserName','endUserWebsite','projectLocation'];
 const context=()=>Object.fromEntries(contextNames.map(name=>[name,field(name)?.value||'']));
 const csrf=()=>form.querySelector('[name=_csrf]')?.value||'';
 let pending=false,usedAi=false,reportRequest=0;
 const grow=element=>{element.style.height='auto';element.style.height=Math.max(44,element.scrollHeight)+'px';};
 function renderReport(){const root=byId('lead-analysis-document');root.replaceChildren();const headings=['执行摘要','交易角色与采购关系','最终用户分析','项目关联判断','待核实事项','建议行动','信息来源'];for(const line of report.value.split('\n').filter(text=>text.trim())){const clean=line.trim().replace(/^#+\s*/,'').replace(/^(?:[一二三四五六七]+、|\d+[.、)]\s*)/,'');const index=headings.indexOf(clean);const node=document.createElement(index>=0?'h3':'p');node.textContent=index>=0?['一、','二、','三、','四、','五、','六、','七、'][index]+clean:line;root.append(node);}root.hidden=false;report.hidden=true;byId('lead-analysis-edit').hidden=false;byId('lead-analysis-edit').textContent='编辑报告';}
 function clearReport(){reportRequest++;report.value='';report.hidden=false;byId('lead-analysis-document').hidden=true;byId('lead-analysis-edit').hidden=true;grow(report);}
 function sourcePayload(){return {attachmentDraftToken:field('attachmentDraftToken').value,leadId:dialog.dataset.leadId||'',aiEmailThreadId:dialog.dataset.emailThreadId||''};}
 async function api(action,payload){const response=await fetch('/lead-submissions/ai/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify({...sourcePayload(),...payload})});const content=await response.text();let result;try{result=JSON.parse(content);}catch{throw Error('请求未完成，请刷新页面或人工填写。');}if(!response.ok)throw Error(result.error||'AI处理失败。');return result;}
 function setBusy(value){pending=value;for(const id of ['lead-ai-analyze','lead-ai-research'])if(byId(id))byId(id).disabled=value;}
 byId('lead-ai-open')?.addEventListener('click',()=>dialog.showModal());
 byId('lead-ai-close').onclick=()=>dialog.close();
 byId('lead-analysis-edit').onclick=()=>{if(report.hidden){report.hidden=false;byId('lead-analysis-document').hidden=true;byId('lead-analysis-edit').textContent='完成编辑';grow(report);}else renderReport();};
 byId('lead-ai-analyze')?.addEventListener('click',async()=>{
  if(!byId('lead-ai-consent').checked)return notice('请先勾选允许将邮件提交至豆包。');
  if(!confirm('AI将整理来源邮件并填写当前字段，请在提交前核对。是否继续？'))return;
  setBusy(true);notice('正在整理邮件，请稍候…');
  try{const result=await api('analyze',{consent:true,email:byId('lead-ai-email')?.value||''});
   const map={company:'companyName',website:'companyWebsite',contact:'contactName',email:'contactEmail',phone:'contactPhone',country:'country',transactionRole:'transactionRole',endUserName:'endUserName',endUserWebsite:'endUserWebsite',projectLocation:'projectLocation'};
   for(const [key,name]of Object.entries(map)){const control=field(name),value=result.fields[key]?.value;if(!control||!value)continue;if(control instanceof HTMLSelectElement&&!Array.from(control.options).some(option=>option.value===value))continue;control.value=value;}
   field('requirementText').value=result.requirement;grow(field('requirementText'));clearReport();usedAi=true;dialog.close();
   const qualification={qualified:'具备潜在线索特征',uncertain:'需要人工判断',non_business:'可能属于非业务邮件'};
   notice((qualification[result.qualification]||'待人工判断')+'：'+result.reason+' 请审阅后按现有流程提交。');
  }catch(error){notice(error.message);}finally{setBusy(false);}
 });
 byId('lead-ai-research')?.addEventListener('click',async()=>{
  if(!byId('lead-ai-search-consent').checked){dialog.showModal();return notice('请先勾选允许使用询价方和最终用户信息进行联网调查，然后点击完成，再生成报告。');}
  const input=context(),snapshot=JSON.stringify(input),request=++reportRequest;
  if(!input.companyName&&!input.companyWebsite)return notice('请先填写询价方公司名称或官网。');
  setBusy(true);notice('正在调查客户和最终用户，请稍候…');
  try{const result=await api('research',{consent:true,context:input});if(snapshot!==JSON.stringify(context())||request!==reportRequest)throw Error('客户信息已变化，请重新生成报告。');report.value=result.text;usedAi=true;renderReport();notice(result.notice||'报告已生成，请人工核对来源与结论。');}catch(error){notice(error.message);}finally{setBusy(false);}
 });
 form.addEventListener('input',event=>{if(event.target.matches('textarea')&&!event.target.hidden)grow(event.target);if(contextNames.includes(event.target.name)&&report.value){clearReport();notice('客户或交易关系已变化，旧报告已清空，请重新生成。');}});
 form.addEventListener('change',event=>{if(!contextNames.includes(event.target.name))return;if(field('transactionRole').value==='end_user'){field('endUserName').value=field('companyName').value;field('endUserWebsite').value=field('companyWebsite').value;}if(report.value){clearReport();notice('交易关系已变化，请重新生成报告。');}});
 form.addEventListener('submit',event=>{if(pending){event.preventDefault();notice('AI仍在处理，请等待完成后再提交。');return;}if(usedAi&&!confirm('请确认已审阅AI整理的需求、客户信息和报告，继续提交审核？')){event.preventDefault();return;}field('aiReviewed').value='1';});
 byId('lead-analysis-read').onclick=()=>{if(!report.value.trim())return notice('暂无报告可朗读。');if(!window.speechSynthesis)return notice('当前浏览器不支持朗读。');window.speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(report.value);speech.lang='zh-CN';window.speechSynthesis.speak(speech);notice('正在使用浏览器朗读报告。');};
 if(report.value.trim())renderReport();else grow(report);
 if(dialog.dataset.emailThreadId&&!dialog.dataset.leadId&&byId('lead-ai-analyze'))dialog.showModal();
})();