const clean=(value,max)=>String(value||'').trim().slice(0,max);
export function normalizeProjectContacts(value) {
 let rows=value;
 if(typeof rows==='string'){if(rows.length>60000)throw Error('项目联系人内容过长');try{rows=JSON.parse(rows);}catch{throw Error('项目联系人格式不正确');}}
 if(!Array.isArray(rows)||rows.length>30)throw Error('项目联系人最多30人');
 return rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('项目联系人格式不正确');
  const name=clean(row.name,100),company=clean(row.company,200),role=clean(row.role,200);
  const values=Array.isArray(row.emails)?row.emails:String(row.emails||'').split(/[;；,，\s]+/);
  if(values.length>10)throw Error('每位联系人最多10个邮箱');
  const emails=[...new Set(values.map(x=>String(x).trim().toLowerCase()).filter(Boolean))];
  if(emails.some(x=>x.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)))throw Error('项目联系人邮箱格式不正确');
  return {name,company,role,emails};
 }).filter(row=>row.name||row.company||row.role||row.emails.length).map(row=>{if(!row.name)throw Error('请填写项目联系人姓名，身份不明时请填写待确认');return row;});
}
export const projectContactKey=row=>JSON.stringify([row.name,row.company,row.role,row.emails]);
