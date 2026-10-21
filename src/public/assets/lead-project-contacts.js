(() => {
 const root=document.getElementById('lead-project-contacts');if(!root)return;
 const form=root.closest('form'),hidden=document.getElementById('lead-project-contacts-value'),body=document.getElementById('lead-project-contact-rows'),status=document.getElementById('lead-project-contact-status');
 let rows=[];try{rows=JSON.parse(hidden.value);}catch{}
 const sync=()=>{hidden.value=JSON.stringify(rows);document.getElementById('lead-project-contact-count').textContent=rows.length;};
 function render(){body.replaceChildren();rows.forEach((row,index)=>{
  const tr=document.createElement('tr');
  for(const [key,label,max]of [['name','联系人',100],['company','所属公司',200],['role','项目职责',200],['emails','邮箱，使用分号分隔',2600]]){
   const td=document.createElement('td'),input=document.createElement('input');input.type='text';input.maxLength=max;input.value=key==='emails'?(row.emails||[]).join('; '):row[key]||'';input.setAttribute('aria-label',label+' '+(index+1));input.title=input.value;
   input.addEventListener('input',()=>{row[key]=key==='emails'?input.value.split(/[;；,，\s]+/).filter(Boolean):input.value;delete row.source;delete row.sourceThreadId;delete row.evidence;const label=tr.lastElementChild?.firstChild;if(label){label.textContent='人工录入';label.title='';}input.title=input.value;sync();});td.append(input);tr.append(td);
  }
  const actions=document.createElement('td'),source=document.createElement('span');source.textContent=row.source==='ai_email'?'来源邮件':row.source==='ai_pending'?'AI待审阅':'人工录入';source.title=row.evidence||'';const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.setAttribute('aria-label','移除联系人 '+(index+1));remove.addEventListener('click',()=>{rows.splice(index,1);render();});actions.append(source,remove);tr.append(actions);body.append(tr);
 });sync();}
 function add(row){if(rows.length>=30){status.textContent='项目联系人最多30人';return;}rows.push(row);render();root.open=true;}
 document.getElementById('lead-project-contact-add').onclick=()=>add({name:'',company:'',role:'',emails:[]});
 document.getElementById('lead-project-contact-main').onclick=()=>{const get=name=>form.elements.namedItem(name)?.value.trim()||'';const row={name:get('contactName'),company:get('companyName'),role:'',emails:get('contactEmail')?[get('contactEmail')]:[]};if(!row.name){status.textContent='请先填写主联系人姓名';return;}if(rows.some(item=>item.name===row.name&&item.emails?.some(email=>row.emails.includes(email)))){status.textContent='该主联系人已在清单中';return;}add(row);};
 root.addEventListener('lead-ai-contacts',event=>{let added=0;for(const candidate of event.detail||[]){if(rows.length>=30)break;const same=rows.some(item=>JSON.stringify([item.name,item.company,item.role,item.emails])===JSON.stringify([candidate.name,candidate.company,candidate.role,candidate.emails]));if(!same){rows.push({...candidate,source:'ai_pending'});added++;}}render();if(added)root.open=true;status.textContent=added?'已加入'+added+'位AI提取联系人，请核对姓名、邮箱归属和职责。':'没有新增可确认的项目联系人；原清单保留。';});
 form.addEventListener('submit',event=>{sync();for(const row of rows){const populated=row.name||row.company||row.role||row.emails.length;if(populated&&!row.name.trim()){event.preventDefault();root.open=true;status.textContent='请填写项目联系人姓名，身份不明时请填写待确认';return;}if(row.emails.length>10||row.emails.some(email=>email.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))){event.preventDefault();root.open=true;status.textContent='请检查联系人邮箱，最多10个，以分号分隔';return;}}});render();
})();
