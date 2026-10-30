const asId=value=>Number(value)||0;
const requirementLabel=round=>'R'+Math.max(0,Number(round?.round_no||1)-1);
const basisVersions=basis=>(basis?.technical||[]).flatMap(t=>[t,t.cost]).filter(v=>v?.packageId);

// Build a read-only historical projection; never change the live repository objects.
export function buildOpportunityRevisionPresentation({workspace,opportunity,workPackages=[],attachments=[],requestedRoundId}) {
 if(!workspace)return null;
 const rounds=[...workspace.rounds].sort((a,b)=>Number(a.round_no)-Number(b.round_no));
 const current=rounds.find(r=>!r.closed_at)||null;
 const requested=requestedRoundId==null||requestedRoundId===''?null:String(requestedRoundId);
 const selected=requested===null?current:requested==='0'?rounds.find(r=>r.revision_kind==='initial')||null:rounds.find(r=>String(r.id)===requested);
 if(requested!==null&&requested!=='0'&&!selected)throw Object.assign(Error('需求轮次不存在。'),{statusCode:404});
 const historical=Boolean((selected&&selected.closed_at)||(!selected&&current));
 const linked=workspace.linkedAttachments||[];
 const linkedIds=new Set(linked.map(a=>asId(a.id)));
 const selectedQuotes=workspace.quotes.filter(q=>asId(q.revision_round_id)===asId(selected?.id));
 const basis=historical?(selected?.closed_basis||selectedQuotes[0]?.approval_basis||selected?.baseline):workspace.basis;
 const frozen=basisVersions(basis);
 const getOrigin=version=>{
  if(!version)return null;
  if(version.revisionRoundId)return rounds.find(r=>asId(r.id)===asId(version.revisionRoundId));
  return rounds.find(r=>[r.closed_basis,...workspace.quotes.filter(q=>asId(q.revision_round_id)===asId(r.id)).map(q=>q.approval_basis)].some(b=>basisVersions(b).some(v=>asId(v.versionId)===asId(version.id))));
 };
 const projected=workPackages.filter(w=>!historical||frozen.some(v=>asId(v.packageId)===asId(w.id))).map(w=>{
  const snapshot=frozen.find(v=>asId(v.packageId)===asId(w.id));
  let version=historical?(w.versionHistory||[]).find(v=>asId(v.id)===asId(snapshot?.versionId)):w.latestVersion;
  if(historical&&snapshot&&version){
   version={...version,status:snapshot.status,files:(snapshot.files||[]).map(f=>({...version.files.find(v=>asId(v.id)===asId(f.attachmentId)),id:asId(f.attachmentId),originalName:f.name,status:f.status,supersededByAttachmentId:null,reviewNote:f.reviewNote||'',reviewedAt:f.reviewedAt,submittedAt:f.submittedAt,carriedFromAttachmentId:f.carriedFromAttachmentId}))};
  }
  if(version){version={...version,files:version.files.map(file=>{
   if(!file.carriedFromAttachmentId)return file;
   const priorVersion=workPackages.flatMap(p=>p.versionHistory||[]).find(v=>v.files?.some(f=>asId(f.id)===asId(file.carriedFromAttachmentId)));
   const priorRound=getOrigin(priorVersion);
   return {...file,requirementRef:{description:priorRound?'沿用'+requirementLabel(priorRound)+'已批版':'沿用原已批文件'}};
  })};}
  const origin=getOrigin(version);
  const sourceLabel=origin?requirementLabel(origin):!rounds.length?'R0':'历史未标需求';
  const selectedLabel=requirementLabel(selected);
  const carried=Boolean(version&&origin&&asId(origin.id)!==asId(selected?.id));
  const pendingRevision=Boolean(carried&&selected?.revision_kind==='technical'&&!historical);
  return {...w,latestVersion:version,versionHistory:historical?(version?[version]:[]):w.versionHistory,
   requirementRef:{label:selectedLabel,sourceLabel,description:pendingRevision?'待本轮修订':carried?'沿用'+sourceLabel+'已批版':version?'本轮修订':'未上传',historical}};
 });
 return {rounds,current,selected,historical,label:requirementLabel(selected),currentLabel:requirementLabel(current),
  selectedQuotes,workPackages:projected,basis,
  text:selected?.revision_kind==='initial'||!selected?[historical?(selected?.closed_basis?.requirementText||selected?.feedback||opportunity.requirement):opportunity.requirement,...(workspace.requirementTexts||[]).filter(t=>selected&&asId(t.revision_round_id)===asId(selected.id)).map(t=>t.requirement_text)].filter(Boolean).join('\n'):selected.feedback,
  unassignedRequirementTexts:(workspace.requirementTexts||[]).filter(t=>!t.revision_round_id),
  linkedAttachments:linked.filter(a=>asId(a.revision_round_id)===asId(selected?.id)&&!a.retired_at),
  unassignedAttachments:attachments.filter(a=>['requirement','other','commercial_quote'].includes(a.category)&&!linkedIds.has(asId(a.id))),
  requirementLabel};
}
