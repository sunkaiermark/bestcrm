import { JSDOM } from 'jsdom';
const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const kids = (n, tag) => [...(n?.children || [])].filter(c => c.localName === tag);
const one = (n, tag) => kids(n,tag)[0];
const a = (n,k) => n?.getAttribute(k) ?? n?.getAttribute(`w:${k}`) ?? '';
const v = (n,k) => a(one(n,k),'val');
const number = (s, fallback=0, max=2000) => s !== '' && Number.isFinite(Number(s)) ? Math.max(0,Math.min(max,Number(s))) : fallback;
const color = s => /^[a-f\d]{6}$/i.test(s) ? `#${s}` : /^[a-f\d]{8}$/i.test(s) ? `#${s.slice(2)}` : '';
function parse(xml) { if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) return null; try {return new JSDOM(xml,{contentType:'text/xml'});} catch {return null;} }
function css(p) {
  if (!p) return '';
  const rules=[];
  for (const [tag,rule,on,off] of [['b','font-weight','700','400'],['i','font-style','italic','normal'],['u','text-decoration','underline','none']]) if(one(p,tag)) rules.push(`${rule}:${['0','false','off','none'].includes(v(p,tag))?off:on}`);
  if(v(p,'sz')) rules.push(`font-size:${number(v(p,'sz'),24,144)/2}pt`);
  const fg=color(v(p,'color')); if(fg) rules.push(`color:${fg}`);
  const bg=color(a(one(p,'shd'),'fill')); if(bg) rules.push(`background-color:${bg}`);
  const align=v(p,'jc'); if(['left','center','right','both'].includes(align)) rules.push(`text-align:${align==='both'?'justify':align}`);
  const spacing=one(p,'spacing');
  for(const [key,side] of [['before','top'],['after','bottom']]) if(a(spacing,key)) rules.push(`margin-${side}:${number(a(spacing,key),0,1440)/20}pt`);
  return rules.join(';');
}
export function wordHtml(xml, stylesXml='') {
  const dom=parse(xml), styleDom=parse(stylesXml); if(!dom) return '';
  try {
    const styles=new Map([...(styleDom?.window.document.getElementsByTagNameNS('*','style')||[])].map(s=>[a(s,'styleId'),s]));
    function paragraphStyle(n) {
      const chain=[],seen=new Set(); let s=styles.get(v(one(n,'pPr'),'pStyle'));
      while(s&&!seen.has(s)&&chain.length<12){seen.add(s);chain.unshift(s);s=styles.get(v(s,'basedOn'));}
      return chain;
    }
    function inline(n){
      if(n.localName==='t') return esc(n.textContent);
      if(n.localName==='tab') return '&#9;';
      if(['br','cr'].includes(n.localName)) return '<br>';
      if(['del','instrText','pPr','rPr'].includes(n.localName)) return '';
      const content=[...n.children].map(inline).join('');
      return n.localName==='r'?`<span style="${css(one(n,'rPr'))}">${content}</span>`:content;
    }
    function block(n,depth=0){
      if(depth>20) return '';
      if(n.localName==='p'){
        const styles=paragraphStyle(n), props=[...styles.map(s=>one(s,'pPr')),one(n,'pPr')];
        const outline=props.map(p=>v(p,'outlineLvl')).filter(s=>s!=='').at(-1);
        const heading=outline!==undefined?Math.min(6,number(outline)+1):Number(v(one(n,'pPr'),'pStyle').match(/heading\s*([1-6])/i)?.[1]);
        const tag=heading?`h${heading}`:'p';
        return `<${tag} style="${[...props,...styles.map(s=>one(s,'rPr'))].map(css).join(';')}">${inline(n)||'<br>'}</${tag}>`;
      }
      if(n.localName==='tbl'){
        const active=new Map(),rows=[];
        for(const row of kids(n,'tr')){
          let col=0; const cells=[];
          for(const cell of kids(row,'tc')){
            const pr=one(cell,'tcPr'), span=Math.max(1,number(v(pr,'gridSpan'),1,100)), merge=one(pr,'vMerge');
            if(merge&&a(merge,'val')!=='restart'&&active.has(col)){active.get(col).rows++;col+=span;continue;}
            const c={span,rows:1,html:[...cell.children].map(b=>block(b,depth+1)).join(''),style:css(pr)};
            cells.push(c);if(merge)active.set(col,c);else active.delete(col);col+=span;
          } rows.push(cells);
        }
        const widths=kids(one(n,'tblGrid'),'gridCol').map(c=>number(a(c,'w'),1,30000)), total=widths.reduce((x,y)=>x+y,0);
        return `<table class="office-word-table">${total?`<colgroup>${widths.map(w=>`<col style="width:${w/total*100}%">`).join('')}</colgroup>`:''}<tbody>${rows.map(row=>`<tr>${row.map(c=>`<td colspan="${c.span}" rowspan="${c.rows}" style="${c.style}">${c.html}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      }
      return ['sdt','sdtContent','customXml'].includes(n.localName)?[...n.children].map(b=>block(b,depth+1)).join(''):'';
    }
    const body=dom.window.document.getElementsByTagNameNS('*','body')[0];
    return [...(body?.children||[])].map(n=>block(n)).join('');
  } finally {dom.window.close();styleDom?.window.close();}
}
export function sheetLayout(xml, stylesXml, sheet, date1904=false){
  const dom=parse(xml), sd=parse(stylesXml);if(!dom)return {...sheet,html:''};
  try{
    const all=tag=>[...dom.window.document.getElementsByTagNameNS('*',tag)],root=sd?.window.document.documentElement;
    const fonts=kids(one(root,'fonts'),'font'),fills=kids(one(root,'fills'),'fill'),xfs=kids(one(root,'cellXfs'),'xf');
    const formats=new Map(kids(one(root,'numFmts'),'numFmt').map(n=>[Number(a(n,'numFmtId')),a(n,'formatCode')]));
    const count=sheet.columnLabels.length,widths=Array(count).fill(120),metadata=new Map(all('c').map(c=>[a(c,'r'),c]));
    for(const col of all('col'))for(let c=Math.max(0,number(a(col,'min'))-1);c<Math.min(count,number(a(col,'max')));c++)widths[c]=number(a(col,'width'),16,100)*7+5;
    const merges=[],covered=new Set(),rows=new Map(sheet.rows.map(r=>[r.number,r])),maxRow=Math.max(0,...rows.keys(),...all('row').map(r=>number(a(r,'r'),0,1000000)));
    for(const m of all('mergeCell')){
      const match=a(m,'ref').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);if(!match)continue;
      const col=s=>[...s.toUpperCase()].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)-1;
      const c1=col(match[1]),c2=Math.min(count-1,col(match[3])),r1=Number(match[2]),r2=Math.min(maxRow,Number(match[4]));
      if(c1>=count||r1>maxRow||r2-r1>1000||r2<r1||c2<c1)continue;
      merges.push({c1,c2,r1,r2});for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++)if(r!==r1||c!==c1)covered.add(`${r}:${c}`);
    }
    const rowNumbers=new Set(rows.keys());for(const m of merges)for(let r=m.r1;r<=m.r2;r++)rowNumbers.add(r);
    const rowMeta=new Map(all('row').map(r=>[Number(a(r,'r')),r]));
    const output=[...rowNumbers].sort((x,y)=>x-y).map(r=>{
      const cells=[];
      for(let c=0;c<count;c++){
        if(covered.has(`${r}:${c}`))continue;
        const source=metadata.get(`${sheet.columnLabels[c]}${r}`),xf=xfs[number(a(source,'s'))],font=fonts[number(a(xf,'fontId'))],fill=fills[number(a(xf,'fillId'))],rules=[];
        if(one(font,'b'))rules.push('font-weight:700');if(one(font,'i'))rules.push('font-style:italic');
        const fg=color(a(one(font,'color'),'rgb')),bg=color(a(one(one(fill,'patternFill'),'fgColor'),'rgb'));
        if(fg)rules.push(`color:${fg}`);if(bg)rules.push(`background-color:${bg}`);
        const alignment=one(xf,'alignment'),horizontal=a(alignment,'horizontal');if(['left','center','right','justify'].includes(horizontal))rules.push(`text-align:${horizontal}`);
        const vertical=a(alignment,'vertical');if(['top','center','bottom'].includes(vertical))rules.push(`vertical-align:${vertical==='center'?'middle':vertical}`);
        let value=rows.get(r)?.cells[c]??'';
        const id=Number(a(xf,'numFmtId')),fmt=formats.get(id)||'',numeric=value!==''&&Number.isFinite(Number(value))&&!['s','inlineStr','str','b'].includes(a(source,'t'));
        if(numeric&&((id>=14&&id<=22)||/[yd]/i.test(fmt.replace(/"[^"]*"|\[[^\]]*\]/g,'')))){
          const date=new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30)+Number(value)*86400000);
          if(Number.isFinite(date.getTime()))value=date.toISOString().slice(0,10)+((id>=18&&id<=22)||/h|s/i.test(fmt)?` ${date.toISOString().slice(11,19)}`:'');
        }else if(numeric&&(id===9||id===10||fmt.includes('%')))value=`${(Number(value)*100).toFixed(id===9?0:2)}%`;
        else if(numeric&&[2,4].includes(id))value=Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:id===4});
        const merge=merges.find(m=>m.r1===r&&m.c1===c);
        cells.push(`<td${merge?` colspan="${merge.c2-c+1}" rowspan="${merge.r2-r+1}"`:''} style="${rules.join(';')}">${esc(value)}</td>`);
      }
      const height=number(a(rowMeta.get(r),'ht'),0,200);
      return `<tr${height?` style="height:${height}pt"`:''}><th scope="row">${r}</th>${cells.join('')}</tr>`;
    });
    return {...sheet,html:`<colgroup><col style="width:44px">${widths.map(w=>`<col style="width:${w}px">`).join('')}</colgroup><thead><tr><th>#</th>${sheet.columnLabels.map(c=>`<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${output.join('')}</tbody>`};
  }finally{dom.window.close();sd?.window.close();}
}
