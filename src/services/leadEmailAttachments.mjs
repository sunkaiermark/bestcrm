export function sourceEmailAttachments(thread) {
 const seen=new Set(),result=[];
 for(const message of thread?.messages||[])for(const attachment of message.attachments||[]){
  const id=Number(attachment.id);
  if(!Number.isSafeInteger(id)||id<=0||seen.has(id)||attachment.isInline===true||attachment.contentDisposition==='inline')continue;
  seen.add(id);result.push({id,originalName:String(attachment.originalName||'Attachment'),fileSize:Number(attachment.fileSize)||0,threadId:Number(thread.id),messageId:Number(message.id)});
 }
 return result;
}