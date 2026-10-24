(()=>{
if(window.collaborationFileDecisionsBound)return;window.collaborationFileDecisionsBound=true;
document.addEventListener('click',event=>{
 const trigger=event.target.closest('[data-file-reject]');if(trigger){const row=document.getElementById(trigger.dataset.fileReject);row.hidden=false;row.querySelector('textarea').focus();}
 const save=event.target.closest('[data-save-rejection]');if(save){const form=save.closest('form'),text=form.elements.note;if(!text.reportValidity()||!text.value.trim())return;form.dataset.savedNote=text.value;form.elements.confirmRejection.value='yes';form.querySelector('[type=submit]').disabled=false;save.textContent='已保存';}
 const cancel=event.target.closest('[data-cancel-rejection]');if(cancel)cancel.closest('tr').hidden=true;
});
document.addEventListener('input',event=>{const form=event.target.closest('[data-file-rejection-form]');if(!form)return;form.elements.confirmRejection.value='';form.querySelector('[type=submit]').disabled=true;form.querySelector('[data-save-rejection]').textContent='保存';});
document.addEventListener('submit',event=>{const form=event.target.closest('[data-file-rejection-form]');if(form&&(form.elements.confirmRejection.value!=='yes'||form.dataset.savedNote!==form.elements.note.value))event.preventDefault();});
})();
