'use strict';

(() => {
 const opener=$('importGcashPdf');
 if(!opener)return;

 const maxBatch=150;
 const maxPages=80;
 const pageSize=20;
 const baseUrl='/vendor/pdfjs/';
 const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 const tableLabels=[/\bdate\b/i,/\bdescription\b/i,/\breference\b/i,/\bdebit\b/i,/\bcredit\b/i,/\bbalance\b/i];
 const currencyPattern=/^(?:PHP\s*|₱\s*)?([−-]?)(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/i;
 const referencePattern=/^[A-Z0-9][A-Z0-9-]{5,39}$/i;
 const isoDatePattern=/^(\d{4})-(\d{2})-(\d{2})(?=$|\s)/;
 const namedDatePattern=/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})(?=$|\s)/i;
 const timePattern=/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i;

 function validDate(date){
  const timestamp=Date.parse(date+'T00:00:00Z');
  return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===date;
 }

 function printedDate(value){
  const iso=value.match(isoDatePattern);
  if(iso)return validDate(iso[0])?iso[0]:'';
  const named=value.match(namedDatePattern);
  if(!named)return '';
  const month=months.indexOf(named[1].slice(0,3).toLowerCase())+1;
  if(!month)return '';
  const date=named[3]+'-'+String(month).padStart(2,'0')+'-'+named[2].padStart(2,'0');
  return validDate(date)?date:'';
 }

 function timeKey(value){
  const parts=value.match(timePattern);
  if(!parts)return null;
  const hour=Number(parts[1]), minute=Number(parts[2]);
  if(hour<1||hour>12||minute>59)return null;
  return (hour%12+(parts[3].toUpperCase()==='PM'?12:0))*60+minute;
 }

 function toCents(text){
  const match=text.match(currencyPattern);
  if(!match)return null;
  const value=Number(match[2].replaceAll(',',''))*100+Number(match[3]);
  return Number.isSafeInteger(value)&&value<=1e13?(match[1]?-value:value):null;
 }

 function readItems(items){
  return items.filter(item=>typeof item.str==='string'&&item.str.trim()&&Array.isArray(item.transform))
   .map(item=>({text:item.str.normalize('NFKC').trim(),x:item.transform[4],y:item.transform[5],width:item.width||0}))
   .filter(item=>Number.isFinite(item.x)&&Number.isFinite(item.y)&&Number.isFinite(item.width))
   .sort((a,b)=>b.y-a.y||a.x-b.x);
 }

 function labelPosition(items,pattern){
  for(const item of items){
   const match=item.text.match(pattern);
   if(match)return item.x+item.width*(match.index+match[0].length/2)/item.text.length;
  }
  return null;
 }

 function findLayout(items){
  for(const debit of items.filter(item=>/\bdebit\b/i.test(item.text))){
   const header=items.filter(item=>Math.abs(debit.y-item.y)<=8).sort((a,b)=>a.x-b.x);
   const centers=tableLabels.map(pattern=>labelPosition(header,pattern));
   if(centers.some(center=>center===null)||centers.some((center,i)=>i>0&&center-centers[i-1]<12))continue;
   const edges=centers.slice(1).map((center,index)=>(center+centers[index])/2);
   return {edges,headerY:Math.min(...header.filter(item=>tableLabels.some(pattern=>pattern.test(item.text))).map(item=>item.y))};
  }
  return null;
 }

 function getColumn(item,edges){
  const center=item.x+item.width/2;
  const first=edges.findIndex(edge=>center<edge);
  if(first===-1)return 5;
  // Long descriptions and date strings can extend towards the next column.
  if(first<=2&&item.x<edges[1]&&center>=edges[0]&&!printedDate(item.text))return 1;
  if(item.x<edges[0]&&printedDate(item.text))return 0;
  return first;
 }

 function groupLines(items){
  const lines=[];
  for(const item of items){
   const line=lines.at(-1);
   if(line&&Math.abs(line.y-item.y)<=2.4)line.items.push(item);
   else lines.push({y:item.y,items:[item]});
  }
  for(const line of lines)line.items.sort((a,b)=>a.x-b.x);
  return lines;
 }

 function numberCell(items){
  const tokens=items.map(item=>item.text).filter(text=>!/^[-—–]$/.test(text));
  if(!tokens.length)return {valid:true,value:null};
  const value=toCents(tokens.join(' '));
  return {valid:value!==null,value};
 }

 function parseRow(lines,layout,date,pageNumber){
  const columns=Array.from({length:6},()=>[]);
  for(const line of lines){
   const text=line.items.map(item=>item.text).join(' ');
   if(/^(?:page\s+\d|ending balance\b|total (?:debit|credit)\b|transaction history\b)/i.test(text))break;
   for(const item of line.items)columns[getColumn(item,layout.edges)].push(item);
  }
  const description=columns[1].map(item=>item.text).join(' ').replace(/\s+/g,' ').trim();
  const reference=columns[2].map(item=>item.text).join('').replace(/\s+/g,'');
  const time=timeKey(columns[0].map(item=>item.text).join(' '));
  const debit=numberCell(columns[3]),credit=numberCell(columns[4]),balance=numberCell(columns[5]);
  let reason='';
  if(!description||description.length>140)reason='Description could not be separated from the statement columns.';
  else if(!referencePattern.test(reference)||!/(?:\d.*){4}/.test(reference))reason='Transaction reference is missing or unclear.';
  else if(!debit.valid||!credit.valid||!balance.valid||balance.value===null||Boolean(debit.value)===Boolean(credit.value)){
   reason='Debit, credit, or balance could not be read confidently.';
  }
  const amount=credit.value?Math.abs(credit.value):-Math.abs(debit.value||0);
  return {description,date,amount,balance:balance.value,reference,time,pageNumber,reason};
 }

 function parsePage(items,layout,pageNumber){
  const lines=groupLines(items.filter(item=>item.y<layout.headerY-2));
  const starts=[];
  for(let index=0;index<lines.length;index++){
   const candidate=lines[index].items.filter(item=>item.x<layout.edges[0]).map(item=>item.text).join(' ');
   const date=printedDate(candidate);
   if(date)starts.push({index,date});
  }
  return starts.map(({index,date},position)=>parseRow(lines.slice(index,starts[position+1]?.index),layout,date,pageNumber));
 }

 function chronologicalOrder(rows){
  let increasing=0,decreasing=0;
  for(let index=1;index<rows.length;index++){
   const previous=rows[index-1],current=rows[index];
   const delta=current.date.localeCompare(previous.date)||
    (previous.time!==null&&current.time!==null?current.time-previous.time:0);
   if(delta>0)increasing++;
   if(delta<0)decreasing++;
  }
  if(increasing&&decreasing)return null;
  // The personal statement normally runs oldest-first.
  return decreasing?[...rows].reverse():rows;
 }

 function crossCheckBalances(rows){
  const ordered=chronologicalOrder(rows);
  if(!ordered)return;
  for(let index=1;index<ordered.length;index++){
   const previous=ordered[index-1],current=ordered[index];
   if(!current.reason&&previous.balance!==null&&current.pageNumber===previous.pageNumber&&
    current.balance-previous.balance!==current.amount)current.reason='The amount or direction does not match the printed balance.';
  }
 }

 function prepareSelections(rows){
  const repeats=new Set(),seen=new Set();
  const identity=item=>item.reference.replace(/-/g,'').toUpperCase()+':'+Math.sign(item.amount);
  for(const item of rows){
   if(item.reason)continue;
   const key=identity(item);
   if(seen.has(key))repeats.add(key);
   seen.add(key);
  }
  let count=0;
  for(const item of rows){
   if(!item.reason&&repeats.has(identity(item)))item.reason='This reference appears more than once for the same direction.';
   item.selected=!item.reason&&count++<maxBatch;
  }
 }

 async function readStatement(file,password){
  const pdf=await import(baseUrl+'pdf.mjs');
  pdf.GlobalWorkerOptions.workerSrc=baseUrl+'pdf.worker.mjs';
  const task=pdf.getDocument({
   data:new Uint8Array(await file.arrayBuffer()),password,
   cMapUrl:baseUrl+'cmaps/',cMapPacked:true,standardFontDataUrl:baseUrl+'standard_fonts/',
   isEvalSupported:false,useWasm:false,disableFontFace:true,enableXfa:false,
   stopAtErrors:true
  });
  try{
   const document=await task.promise;
   if(document.numPages>maxPages)throw Error('Choose a statement with up to 80 pages. Request a shorter date range in GCash.');
   const rows=[];
   let layout=null,matchedTitle=false,itemCount=0,pagesWithoutTable=0;
   for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
    const page=await document.getPage(pageNumber);
    const {items}=await page.getTextContent();
    itemCount+=items.length;
    if(itemCount>75000)throw Error('Choose a shorter date range for this statement.');
    const positioned=readItems(items);
    const title=positioned.map(item=>item.text).join(' ');
    if(/\bgcash\b/i.test(title)&&/\btransaction\s+history\b/i.test(title))matchedTitle=true;
    const current=findLayout(positioned);
    if(current)layout=current;
    if(layout){
     // A continuation page may omit the column headings.
     const pageRows=parsePage(positioned,current||{edges:layout.edges,headerY:Infinity},pageNumber);
     if(pageRows.length)rows.push(...pageRows);
     else if(!current)pagesWithoutTable++;
    }else pagesWithoutTable++;
    page.cleanup();
   }
   if(!matchedTitle||!rows.length)throw Error('The personal GCash transaction table could not be recognized. Choose the original text-based GCash transaction history PDF.');
   crossCheckBalances(rows);
   prepareSelections(rows);
   return {rows,pagesWithoutTable};
  }finally{
   await task.destroy().catch(()=>{});
  }
 }

 const importer=document.createElement('dialog');
 importer.setAttribute('aria-labelledby','gcashPdfTitle');
 importer.innerHTML='<form><div class="heading"><h3 id="gcashPdfTitle">Import GCash PDF</h3>'+
  '<button type="button" class="light" aria-label="Close">×</button></div><section id="gcashPdfFields"></section>'+
  '<p id="gcashPdfError" role="status"></p><button type="submit" id="gcashPdfSubmit"></button></form>';
 document.body.append(importer);
 const form=importer.querySelector('form'),close=form.querySelector('button'),fields=$('gcashPdfFields');
 const status=$('gcashPdfError'),submit=$('gcashPdfSubmit'),title=$('gcashPdfTitle');
 let busy=false;
 close.onclick=()=>{if(!busy)importer.close()};
 importer.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
 importer.addEventListener('close',()=>{
  if(importer.open)return;
  fields.replaceChildren();
  status.textContent='';
  form.onsubmit=null;
 });

 function setBusy(value){
  busy=value;
  close.disabled=value;
  submit.disabled=value;
 }

 function preview(result,account){
  const {rows,pagesWithoutTable}=result;
  title.textContent='Review GCash statement';
  fields.innerHTML='<p>Selected rows go to the Activity Inbox for review. The PDF and its password stay on this device.</p>'+
   (pagesWithoutTable?'<p class="card-note">No transaction table was recognized on '+pagesWithoutTable+
    (pagesWithoutTable===1?' page.':' pages.')+' Check the original before importing.</p>':'')+
   '<p id="gcashPdfSummary" aria-live="polite"></p><div class="actions">'+
   '<button type="button" class="light" id="selectGcashRows">Select remaining rows</button>'+
   '<button type="button" class="light" id="clearGcashRows">Clear selection</button></div>'+
   '<div id="gcashPdfRows"></div><div class="actions">'+
   '<button type="button" class="light" id="gcashPrevPage">Previous</button>'+
   '<span id="gcashRowPage"></span><button type="button" class="light" id="gcashNextPage">Next</button></div>';
  submit.textContent='Send selected rows to Inbox';
  let page=0;
  const list=$('gcashPdfRows');
  const skipped=rows.filter(item=>item.reason).length;
  const ready=()=>rows.filter(item=>!item.reason&&!item.sent);
  const selected=()=>ready().filter(item=>item.selected);
  const showCount=()=>{
   const count=selected().length;
   $('gcashPdfSummary').textContent=count+' selected of '+ready().length+' remaining · '+skipped+' need manual entry';
   submit.disabled=busy||count===0||count>maxBatch;
  };
  function showPage(){
   const offset=page*pageSize;
   list.innerHTML=rows.slice(offset,offset+pageSize).map((item,index)=>{
    const detail=item.reason||item.reference+' · '+money(item.amount);
    const text=escapeText(item.date+' · '+(item.description||'Statement row'))+
     '<small>'+escapeText(item.sent?'Checked by Activity Inbox':detail)+'</small>';
    if(item.reason||item.sent)return '<div class="row gcash-statement-row"><span>'+text+'</span></div>';
    return '<label class="reconcile-line gcash-statement-row">'+
     '<input type="checkbox" data-gcash-index="'+(offset+index)+'"'+(item.selected?' checked':'')+'>'+
     '<span>'+text+'</span></label>';
   }).join('');
   $('gcashPrevPage').disabled=page===0;
   $('gcashNextPage').disabled=offset+pageSize>=rows.length;
   $('gcashRowPage').textContent=(offset+1)+'–'+Math.min(rows.length,offset+pageSize)+' of '+rows.length;
   showCount();
  }
  list.onchange=event=>{
   const field=event.target;
   if(field.dataset.gcashIndex===undefined)return;
   if(field.checked&&selected().length>=maxBatch){
    field.checked=false;
    status.textContent='Select up to 150 transactions per batch.';
    return;
   }
   rows[Number(field.dataset.gcashIndex)].selected=field.checked;
   status.textContent='';
   showCount();
  };
  $('selectGcashRows').onclick=()=>{
   ready().forEach((item,index)=>{item.selected=index<maxBatch});
   showPage();
  };
  $('clearGcashRows').onclick=()=>{
   for(const item of ready())item.selected=false;
   showPage();
  };
  $('gcashPrevPage').onclick=()=>{if(!busy){page--;showPage()}};
  $('gcashNextPage').onclick=()=>{if(!busy){page++;showPage()}};
  form.onsubmit=async event=>{
   event.preventDefault();
   const batch=selected();
   if(busy||!batch.length||batch.length>maxBatch)return;
   setBusy(true);
   fields.inert=true;
   status.textContent='Checking references and sending rows to the Inbox…';
   try{
    const rows=batch.map(({description,date,amount,reference})=>({description,date,amount,reference}));
    const result=await window.saldoInbox.request('inboxImport',{accountId:account,rows});
    for(const item of batch){item.sent=true;item.selected=false}
    const {staged,skipped}=result.summary;
    status.textContent=staged+' added to Inbox · '+skipped+' already captured.';
    ready().forEach((item,index)=>{item.selected=index<maxBatch});
   }catch(error){status.textContent=error.message||'The selected rows could not be sent to the Inbox.'}
   finally{
    fields.inert=false;
    setBusy(false);
    showPage();
   }
  };
  status.textContent='';
  showPage();
 }

 opener.onclick=()=>{
  if(importer.open)return;
  const accounts=db.accounts.filter(item=>!item.archived&&item.type==='E-wallet');
  if(!accounts.length){
   openForm('account');
   if($('type'))$('type').value='E-wallet';
   $('error').textContent='Add or restore your GCash e-wallet before importing its statement.';
   return;
  }
  if(!window.saldoInbox?.request){
   alert('The Activity Inbox could not load. Refresh Saldo and try again.');
   return;
  }
  title.textContent='Import GCash PDF';
  fields.innerHTML='<p>Choose your personal GCash transaction history PDF. Saldo reads it on this device.</p>'+
   label('GCash e-wallet',select('gcashPdfAccount',accounts.map(item=>[item.id,item.name])))+
   label('Statement PDF','<input id="gcashPdfFile" type="file" accept="application/pdf,.pdf" required>')+
   label('PDF password (if required)','<input id="gcashPdfPassword" type="password" autocomplete="off" maxlength="128">');
  const preferred=accounts.find(item=>/g\s*cash/i.test(item.name));
  if(preferred)$('gcashPdfAccount').value=preferred.id;
  submit.textContent='Read statement';
  submit.disabled=false;
  form.onsubmit=async event=>{
   event.preventDefault();
   if(busy)return;
   const file=$('gcashPdfFile').files[0];
   if(!file)return;
   if(file.size>15*1024*1024){status.textContent='Choose a PDF under 15 MB.';return}
   const account=$('gcashPdfAccount').value;
   const passwordInput=$('gcashPdfPassword'),password=passwordInput.value;
   passwordInput.value='';
   setBusy(true);
   fields.inert=true;
   status.textContent='Reading the statement on this device…';
   let parsed;
   try{
    parsed=await readStatement(file,password);
   }catch(error){
    if(error.name==='PasswordException')status.textContent='Enter the PDF password from the GCash email and try again.';
    else if(error.name==='InvalidPDFException'||error.name==='UnexpectedResponseException')status.textContent='This file could not be opened. Choose a personal GCash transaction history PDF.';
    else if(error instanceof TypeError||error instanceof SyntaxError)status.textContent='This browser could not read the PDF. Try an up-to-date browser or import a CSV.';
    else status.textContent=error.message||'The statement could not be read.';
   }finally{
    fields.inert=false;
    setBusy(false);
   }
   if(parsed)preview(parsed,account);
  };
  status.textContent='';
  importer.showModal();
 };
})();
