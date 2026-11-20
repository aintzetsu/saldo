'use strict';

(() => {
 const isDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 const purchase=entry=>entry&&entry.amount<0&&!entry.to&&!entry.link&&!entry.refundOf;
 const activeAccounts=()=>db.accounts.filter(account=>!account.archived);
 const splitsFor=entry=>entry.splits?.length?entry.splits:[{category:entry.category,amount:-entry.amount}];

 function validateSplits(entry) {
  if(entry.splits==null)return;
  if(!purchase(entry)||!Array.isArray(entry.splits)||entry.splits.length<2||entry.splits.length>20)throw Error('A split expense needs 2 to 20 categories.');
  const names=new Set();
  let total=0;
  for(const part of entry.splits){
   if(typeof part?.category!=='string'||!part.category.trim()||part.category.length>60||!Number.isSafeInteger(part.amount)||part.amount<=0)throw Error('Enter a category and a positive amount for each split.');
   const name=part.category.trim().toLowerCase();
   if(names.has(name))throw Error('Use each category once in a split.');
   names.add(name);
   total+=part.amount;
  }
  if(!Number.isSafeInteger(total)||total!==-entry.amount)throw Error('Split amounts must add up to the expense amount.');
 }

 function validateEntries(entries) {
  const byId=new Map(entries.map(entry=>[entry.id,entry]));
  const refunded=new Map();
  for(const entry of entries){
   validateSplits(entry);
   if(entry.refundOf==null)continue;
   const original=byId.get(entry.refundOf);
   if(!purchase(original)||entry.to||entry.link||entry.amount<=0||entry.account!==original.account||entry.date<original.date)throw Error('The refund must use the original purchase account and occur on or after its date.');
   const total=(refunded.get(original.id)||0)+entry.amount;
   if(!Number.isSafeInteger(total)||total>-original.amount)throw Error('Refunds cannot exceed the original purchase.');
   refunded.set(original.id,total);
  }
 }

 // Allocate in refund order against the remaining portions, using integer
 // remainders so even a series of small refunds cancels a fully refunded split.
 function allocateRefunds(original,refunds) {
  const allocations=new Map();
  const remaining=splitsFor(original).map(part=>({...part}));
  for(const refund of refunds){
   const remainingTotal=remaining.reduce((sum,part)=>sum+part.amount,0);
   if(remainingTotal<=0||refund.amount<=0)continue;
   const amount=Math.min(refund.amount,remainingTotal), divisor=BigInt(remainingTotal);
   const shares=remaining.map((part,index)=>{
    const numerator=BigInt(part.amount)*BigInt(amount);
    return {index,amount:Number(numerator/divisor),remainder:numerator%divisor};
   });
   let leftover=amount-shares.reduce((sum,share)=>sum+share.amount,0);
   const remainderOrder=[...shares].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
   for(const share of remainderOrder){
    if(!leftover)break;
    if(share.amount<remaining[share.index].amount){
     share.amount++;
     leftover--;
    }
   }
   const changes=[];
   for(const share of shares){
    if(!share.amount)continue;
    const part=remaining[share.index];
    part.amount-=share.amount;
    changes.push([part.category,-share.amount]);
   }
   allocations.set(refund.id,changes);
  }
  return allocations;
 }

 const allocationCache=new WeakMap();
 function refundAllocations(byId) {
  if(allocationCache.has(byId))return allocationCache.get(byId);
  const grouped=new Map();
  for(const entry of byId.values())if(entry.refundOf&&entry.amount>0){
   const group=grouped.get(entry.refundOf)||[];
   group.push(entry);
   grouped.set(entry.refundOf,group);
  }
  const result=new Map();
  for(const [id,refunds] of grouped){
   const original=byId.get(id);
   if(!purchase(original))continue;
   refunds.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
   for(const [refundId,allocation] of allocateRefunds(original,refunds))result.set(refundId,allocation);
  }
  allocationCache.set(byId,result);
  return result;
 }

 function categoryChanges(entry,byId) {
  if(entry.to||entry.link)return [];
  if(entry.refundOf&&entry.amount>0)return refundAllocations(byId).get(entry.id)||[[entry.category,-entry.amount]];
  if(entry.amount<0)return splitsFor(entry).map(part=>[part.category,part.amount]);
  return [];
 }

 function addSplitPart(category='',amount='') {
  const list=$('splitParts'), item=document.createElement('div');
  item.className='actions split-part';
  item.innerHTML='<label>Category<input class="split-category" maxlength="60"></label>'+
    '<label>Amount (PHP)<input class="split-amount" type="number" inputmode="decimal" min="0.01" step="0.01"></label>'+
    '<button class="light" type="button">Remove</button>';
  item.querySelector('.split-category').value=category;
  item.querySelector('.split-amount').value=amount;
  item.querySelector('button').onclick=()=>{
   if(list.children.length<=2)return;
   item.remove();
   refreshSplitParts();
   $('splitAdd').focus();
  };
  list.append(item);
 }

 function refreshSplitParts() {
  const editor=$('splitExpense'), toggle=$('splitToggle');
  const previous=editor.dataset.ineligible==='true';
  editor.hidden=previous||$('kind').value!=='Expense';
  const expanded=!editor.hidden&&toggle.checked;
  $('splitEditor').hidden=!expanded;
  const list=$('splitParts');
  for(const field of list.querySelectorAll('input'))field.required=expanded;
  for(const button of list.querySelectorAll('button'))button.disabled=list.children.length<=2;
  $('splitAdd').disabled=list.children.length>=20;
 }

 function addSplitEditor() {
  $('fields').insertAdjacentHTML('beforeend','<section id="splitExpense">'+
   '<label class="check-label"><input id="splitToggle" type="checkbox">Split across categories</label>'+
   '<div id="splitEditor" hidden><div id="splitParts"></div><button id="splitAdd" class="light" type="button">Add category</button>'+
   '<p class="empty">Split amounts must match the transaction total.</p></div></section>');
  addSplitPart();
  addSplitPart();
  $('splitToggle').addEventListener('change',()=>{
   if($('splitToggle').checked&&!$('splitParts').querySelector('.split-category').value&&$('cat').value!=='Other'){
    $('splitParts').querySelector('.split-category').value=$('cat').value;
   }
   refreshSplitParts();
  });
  $('splitAdd').onclick=()=>{
   addSplitPart();
   refreshSplitParts();
   $('splitParts').lastElementChild.querySelector('input').focus();
  };
  $('kind').addEventListener('change',refreshSplitParts);
  refreshSplitParts();
 }

 function originalWithDraft(record,state,id) {
  const current=state.entries.find(entry=>entry.id===id);
  if(!current)return;
  if(current.refundOf){
   record.refundOf=current.refundOf;
   record.category=state.entries.find(entry=>entry.id===current.refundOf)?.category||current.category;
  }
  if(current.link)record.link=current.link;
 }

 function applyDraft(record,state,id) {
  originalWithDraft(record,state,id);
  const editor=$('splitExpense');
  record.splits=null;
  if(editor&&!editor.hidden&&$('splitToggle').checked){
   record.splits=[...$('splitParts').children].map(item=>({
    category:item.querySelector('.split-category').value.trim(),
    amount:cents(item.querySelector('.split-amount').value)
   }));
   record.category=record.splits[0].category;
  }
  // The base editor releases a matched transfer when its transaction details
  // change. Do not reinsert the original link into its saved draft.
  delete record.link;
  const current=state.entries.find(entry=>entry.id===id);
  const currentLink=current?.link;
  const keepsLink=currentLink&&record.account===current.account&&record.amount===current.amount&&!record.to&&record.date===current.date;
  const candidate={...current,...record,id,...(currentLink?{link:keepsLink?currentLink:null}:{})};
  const rows=id?state.entries.map(entry=>entry.id===id?candidate:entry):[...state.entries,candidate];
  validateEntries(rows);
 }

 function refundRemaining(state,original) {
  return -original.amount-state.entries.reduce((sum,entry)=>sum+(entry.refundOf===original.id?entry.amount:0),0);
 }

 function showRefund(entry) {
  const limit=refundRemaining(db,entry);
  if(limit<=0)return;
  dialog.close();
  popup('Record refund',hint('Original purchase '+escapeText(entry.description)+' · '+money(limit)+' refundable.')+
   label('Refund amount (PHP)',input('refundAmount','type="number" inputmode="decimal" step="0.01" min="0.01" max="'+limit/100+'"'))+
   label('Refund date',input('refundDate','type="date" min="'+escapeText(entry.date)+'"'))+
   label('Description',input('refundDescription','maxlength="140"')),state=>{
    const original=state.entries.find(candidate=>candidate.id===entry.id);
    if(!purchase(original))throw Error('The original purchase is no longer available.');
    if(state.accounts.find(account=>account.id===original.account)?.archived)throw Error('Restore this account before recording a refund.');
    const amount=cents($('refundAmount').value);
    const description=$('refundDescription').value.trim();
    const date=$('refundDate').value;
    if(!description||!isDate(date)||amount<=0)throw Error('Enter a refund description, date, and positive amount.');
    const added={id:crypto.randomUUID(),account:original.account,date,description,category:original.category,amount,refundOf:original.id};
    validateEntries([added,...state.entries]);
    state.entries.unshift(added);
   });
  $('refundDate').value=today()<entry.date?entry.date:today();
  $('refundDescription').value=('Refund for '+entry.description).slice(0,140);
 }

 const baseOpenForm=openForm;
 openForm=kind=>{
  baseOpenForm(kind);
  if(kind==='entry'&&$('kind')&&!$('splitExpense'))addSplitEditor();
 };
 const baseEdit=$('entries').onclick;
 $('entries').onclick=event=>{
  baseEdit.call($('entries'),event);
  const entry=db.entries.find(candidate=>candidate.id===editId);
  if(!event.target.closest('[data-edit]')||!entry||!$('splitExpense'))return;
  $('splitExpense').dataset.ineligible=String(Boolean(entry.link||entry.refundOf));
  if(entry.splits?.length){
   $('splitToggle').checked=true;
   $('splitParts').replaceChildren();
   for(const part of entry.splits)addSplitPart(part.category,part.amount/100);
  }
  refreshSplitParts();
  if(entry.refundOf){
   const original=db.entries.find(candidate=>candidate.id===entry.refundOf);
   $('fields').insertAdjacentHTML('beforeend',hint('Refund for '+escapeText(original?.description||'the original purchase')+'.'));
  }
  if(!purchase(entry))return;
  const remaining=refundRemaining(db,entry);
  const refunded=-entry.amount-remaining;
  if(refunded){
   $('fields').insertAdjacentHTML('beforeend',hint('Refunded '+money(refunded)+' · Net purchase cost '+money(remaining)+'.'));
  }
  if(remaining>0&&!db.accounts.find(account=>account.id===entry.account)?.archived){
   $('fields').insertAdjacentHTML('beforeend','<button class="light" type="button" id="recordRefund">Record refund</button>');
   $('recordRefund').onclick=()=>showRefund(entry);
  }
 };

 $('activityRange').add(new Option('Custom dates','custom'));
 document.querySelector('.activity-filters').insertAdjacentHTML('afterend','<div id="customActivityDates" class="actions" hidden>'+
  '<label>From<input id="activityFrom" type="date"></label><label>To<input id="activityTo" type="date"></label>'+
  '<p id="customDateStatus" role="status"></p></div>');
 const customDates=$('customActivityDates');
 for(const id of ['activityFrom','activityTo'])$(id).addEventListener('change',resetActivityPage);
 function dateFilters() {
  customDates.hidden=$('activityRange').value!=='custom';
  if(customDates.hidden)return {};
  const from=$('activityFrom').value,to=$('activityTo').value;
  $('customDateStatus').textContent=from&&to&&from>to?'The end date must be on or after the start date.':'';
  return {from,to};
 }
 function resetDates() {
  $('activityFrom').value=$('activityTo').value='';
  $('customDateStatus').textContent='';
 }
 $('clearActivity').addEventListener('click',resetDates);

 function quoteCSV(value,number=false) {
  const cell=String(value??'');
  const safe=!number&&/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(cell)?"'"+cell:cell;
  return '"'+safe.replaceAll('"','""')+'"';
 }

 function ledgerCSV(entries,state) {
  const names=new Map(state.accounts.map(account=>[account.id,account.name]));
  const byId=new Map(state.entries.map(entry=>[entry.id,entry]));
  const rows=entries.map(entry=>[
   entry.date,entry.description,(entry.amount/100).toFixed(2),entry.category,
   names.get(entry.account),transactionType(entry),names.get(entry.to),entry.reference,
   entry.splits?.map(part=>part.category+' '+(part.amount/100).toFixed(2)).join('; '),byId.get(entry.refundOf)?.description
  ].map((value,index)=>quoteCSV(value,index===2)).join(','));
  return '\uFEFFdate,description,amount,category,account,type,destination,reference,splits,refund_for\r\n'+rows.join('\r\n')+'\r\n';
 }

 $('importBtn').insertAdjacentHTML('afterend','<button id="exportActivity" type="button" class="light">Export CSV</button>');
 $('activityCount').insertAdjacentHTML('afterend','<p id="activityFileStatus" role="status"></p>');
 const fileStatus=$('activityFileStatus');
 $('exportActivity').onclick=()=>{
  const rows=getActivityEntries();
  if(!rows.length){
   fileStatus.textContent='There are no matching transactions to export.';
   return;
  }
  const url=URL.createObjectURL(new Blob([ledgerCSV(rows,db)],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='saldo-transactions-'+today()+'.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  fileStatus.textContent=rows.length+' transactions exported.';
 };

 const headings={
  date:['date','transaction date','posted date','posting date','value date'],
  description:['description','details','merchant','particulars','transaction details','memo'],
  amount:['amount','transaction amount','net amount'],
  debit:['debit','withdrawal','withdrawals','money out'],
  credit:['credit','deposit','deposits','money in'],
  category:['category','transaction category']
 };
 const trimHeader=value=>value.toLowerCase().replace(/[_.-]/g,' ').replace(/\s+/g,' ').trim();
 function detectColumns(headers) {
  return Object.fromEntries(Object.entries(headings).map(([field,aliases])=>[
   field,headers.findIndex(header=>aliases.includes(trimHeader(header)))
  ]));
 }

 function normalizeCSVDate(value,format) {
  if(format==='ymd'&&isDate(value))return value;
  const match=value.match(/^(\d{1,4})[-/]([0-9]{1,2})[-/]([0-9]{1,4})$/);
  if(!match)throw Error('Check the date format.');
  const [,first,second,third]=match;
  const [year,month,day]=format==='ymd'?[first,second,third]:format==='mdy'?[third,first,second]:[third,second,first];
  const date=year+'-'+month.padStart(2,'0')+'-'+day.padStart(2,'0');
  if(year.length!==4||!isDate(date))throw Error('Choose the date format used in this file.');
  return date;
 }

 function csvCents(value) {
  let clean=(value||'').trim().replace(/^(?:PHP|₱)\s*/i,'');
  if(!clean)return 0;
  if(/^\(.+\)$/.test(clean))clean='-'+clean.slice(1,-1);
  clean=clean.replace(/^\+/,'').replace(/^-?\./,match=>match[0]==='-'?'-0.':'0.');
  if(clean.includes(',')){
   if(!/^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(clean))throw Error('Use a decimal point for amounts.');
   clean=clean.replaceAll(',','');
  }
  return cents(clean);
 }

 function csvEntries(records,mapping,state) {
  const known=new Set([...state.ignored,...state.entries.map(entry=>entry.key)]);
  const potential=new Set(state.entries.filter(entry=>entry.account===mapping.account).map(entry=>JSON.stringify([entry.date,entry.amount])));
  const occurrences=new Map();
  return records.map((record,index)=>{
   const value=field=>record[mapping.fields[field]]||'';
   const item={row:index+2,description:value('description')};
   try{
    const date=normalizeCSVDate(value('date'),mapping.dateFormat);
    const category=value('category');
    const debit=mapping.amountStyle==='columns'?csvCents(value('debit')):0;
    const credit=mapping.amountStyle==='columns'?csvCents(value('credit')):0;
    if(debit&&credit)throw Error('Use either a debit or a credit on each row.');
    const amount=mapping.amountStyle==='columns'?Math.abs(credit)-Math.abs(debit):csvCents(value('amount'))*(mapping.amountStyle==='expense'?-1:1);
    if(!amount)throw Error('Enter a nonzero amount.');
    if(!item.description||item.description.length>140||category.length>60)throw Error('Check the description and category lengths.');
    const signature=JSON.stringify([mapping.account,date,item.description,amount,category]);
    const occurrence=occurrences.get(signature)||0;
    occurrences.set(signature,occurrence+1);
    const key=JSON.stringify([signature,occurrence]);
    const entry={account:mapping.account,date,description:item.description,amount,category:category||'Other',key};
    if(known.has(key))return {...item,entry,status:'skipped',reason:'Already imported'};
    if(potential.has(JSON.stringify([date,amount])))return {...item,entry,status:'possible',reason:'Possible duplicate'};
    return {...item,entry,status:'ready',reason:'Ready to add'};
   }catch(error){
    return {...item,status:'invalid',reason:error.message};
   }
  });
 }

 const csvDialog=document.createElement('dialog');
 csvDialog.setAttribute('aria-labelledby','csvTitle');
 document.body.append(csvDialog);
 function csvForm(title,fields,submitLabel) {
  csvDialog.innerHTML='<form><div class="heading"><h3 id="csvTitle">'+title+'</h3>'+
   '<button class="light" id="csvClose" type="button" aria-label="Close">×</button></div>'+
   fields+'<p id="csvError" role="alert"></p><button id="csvSubmit">'+submitLabel+'</button></form>';
  $('csvClose').onclick=()=>csvDialog.close();
  return csvDialog.querySelector('form');
 }

 function rememberMapping(state,headers,mapping) {
  if(!mapping.name)return;
  const previous=(state.csvMappings||[]).filter(entry=>entry.name.toLowerCase()!==mapping.name.toLowerCase());
  const saved={
   name:mapping.name,
   dateFormat:mapping.dateFormat,
   amountStyle:mapping.amountStyle,
   columns:Object.fromEntries(Object.entries(mapping.fields).map(([role,index])=>[role,headers[index]||null]))
  };
  state.csvMappings=[...previous,saved].slice(-30);
 }

 function showMapping(headers,records,previous) {
  const saved=db.csvMappings||[];
  const columns=[['-1','No column'],...headers.map((title,index)=>[index,title])];
  const fields=Object.keys(headings);
  const list=fields.map(field=>'<div data-map-role="'+field+'">'+label(field[0].toUpperCase()+field.slice(1)+' column',select('csvColumn'+field,columns))+'</div>').join('');
  const form=csvForm('Map CSV columns',
   label('Import into',select('csvDestination',activeAccounts().map(account=>[account.id,account.name])))+
   (saved.length?label('Use a saved mapping',select('csvSaved',[['','Choose a source'],...saved.map((preset,index)=>[index,preset.name])])):'')+
   label('Date format',select('csvDateFormat',[['ymd','Year / month / day'],['mdy','Month / day / year'],['dmy','Day / month / year']]))+
   label('Amounts',select('csvAmountStyle',[['signed','Negative expenses, positive income'],['expense','Positive expenses, negative income'],['columns','Separate debit and credit columns']]))+
   list+label('Remember mapping as (optional)','<input id="csvSourceName" maxlength="70" placeholder="e.g. GCash export">'),
   'Preview transactions');
  function updateAmountFields(){
   const combined=$('csvAmountStyle').value!=='columns';
   csvDialog.querySelector('[data-map-role="amount"]').hidden=!combined;
   for(const role of ['credit','debit'])csvDialog.querySelector('[data-map-role="'+role+'"]').hidden=combined;
  }
  function fill(preset) {
   const detected=detectColumns(headers);
   for(const field of fields){
    const remembered=preset?.columns?.[field];
    const index=typeof remembered==='string'?headers.findIndex(header=>trimHeader(header)===trimHeader(remembered)):detected[field];
    $('csvColumn'+field).value=String(preset?.fields?.[field]??index);
   }
   if(preset?.account)$('csvDestination').value=preset.account;
   $('csvDateFormat').value=preset?.dateFormat||'ymd';
   $('csvAmountStyle').value=preset?.amountStyle||(detected.amount<0&&detected.debit>=0&&detected.credit>=0?'columns':'signed');
   $('csvSourceName').value=preset?.name||'';
   updateAmountFields();
  }
  $('csvAmountStyle').onchange=updateAmountFields;
  if($('csvSaved'))$('csvSaved').onchange=()=>fill(saved[$('csvSaved').value]);
  fill(previous);
  form.onsubmit=event=>{
   event.preventDefault();
   const mapping={
    account:$('csvDestination').value,
    dateFormat:$('csvDateFormat').value,
    amountStyle:$('csvAmountStyle').value,
    name:$('csvSourceName').value.trim(),
    fields:Object.fromEntries(fields.map(field=>[field,Number($('csvColumn'+field).value)]))
   };
   const required=['date','description',...(mapping.amountStyle==='columns'?['debit','credit']:['amount'])];
   if(!mapping.account||required.some(field=>mapping.fields[field]<0)){
    $('csvError').textContent='Choose an account and map each required column.';
    return;
   }
   const selected=[...required,'category'].map(field=>mapping.fields[field]).filter(index=>index>=0);
   if(new Set(selected).size!==selected.length){
    $('csvError').textContent='Choose a different column for each field.';
    return;
   }
   showCSVPreview(headers,records,mapping);
  };
 }

 function showCSVPreview(headers,records,mapping) {
  const previewVersion=window.saldoAccount.version;
  const rows=csvEntries(records,mapping,db),counts={ready:0,skipped:0,possible:0,invalid:0};
  for(const item of rows)counts[item.status]++;
  const form=csvForm('Preview CSV import',
   '<p>'+counts.ready+' ready · '+counts.skipped+' skipped · '+counts.possible+' possible duplicates · '+counts.invalid+' invalid</p>'+
   label('Show rows',select('csvRowsFilter',[['all','All rows'],['ready','Ready'],['skipped','Skipped'],['possible','Possible duplicates'],['invalid','Invalid']]))+
   '<div id="csvPreviewRows"></div><div class="actions"><button id="csvPrevious" class="light" type="button">Previous rows</button>'+
   '<button id="csvNext" class="light" type="button">Next rows</button><span id="csvPageStatus"></span></div>'+
   (counts.possible?'<label class="check-label"><input id="csvKeepPossible" type="checkbox">Include possible duplicates</label>':'')+
   (counts.invalid?'<p class="empty">Invalid rows are skipped. Select Invalid above to see why.</p>':'')+
   '<p><button class="light" id="csvBack" type="button">Back to mapping</button></p>',
   'Confirm import');
  let page=0;
  const pageSize=8;
  function renderRows(){
   const filter=$('csvRowsFilter').value;
   const visible=filter==='all'?rows:rows.filter(item=>item.status===filter);
   const offset=page*pageSize;
   $('csvPreviewRows').innerHTML=visible.slice(offset,offset+pageSize).map(item=>row(
    'Row '+item.row+' · '+(item.description||'Unnamed transaction'),
    item.reason+(item.entry?' · '+item.entry.date:''),
    item.entry?money(item.entry.amount):''
   )).join('')||hint('No rows in this group.');
   $('csvPrevious').disabled=!page;
   $('csvNext').disabled=offset+pageSize>=visible.length;
   $('csvPageStatus').textContent=visible.length?'Rows '+(offset+1)+'–'+Math.min(offset+pageSize,visible.length)+' of '+visible.length:'';
  }
  $('csvRowsFilter').onchange=()=>{page=0;renderRows()};
  $('csvPrevious').onclick=()=>{page--;renderRows()};
  $('csvNext').onclick=()=>{page++;renderRows()};
  $('csvBack').onclick=()=>showMapping(headers,records,mapping);
  function updateButton() {
   $('csvSubmit').disabled=!counts.ready&&!$('csvKeepPossible')?.checked;
  }
  if($('csvKeepPossible'))$('csvKeepPossible').onchange=updateButton;
  renderRows();
  updateButton();
  form.onsubmit=async event=>{
   event.preventDefault();
   const add=rows.filter(item=>item.status==='ready'||(item.status==='possible'&&$('csvKeepPossible')?.checked)).map(item=>item.entry);
   if(!add.length)return;
   const button=$('csvSubmit');
   button.disabled=true;
   try{
    await update(state=>{
     if(window.saldoAccount.version!==previewVersion)throw Error('The ledger changed. Preview the CSV again.');
     if(!state.accounts.some(account=>account.id===mapping.account&&!account.archived))throw Error('Choose an active account.');
     state.entries.push(...add.map(entry=>({...entry,id:crypto.randomUUID()})));
     rememberMapping(state,headers,mapping);
    });
    $('month').value=add.map(entry=>entry.date).sort().at(-1).slice(0,7);
    csvDialog.close();
    render();
    fileStatus.textContent=add.length+' transactions imported. '+(rows.length-add.length)+' skipped.';
   }catch(error){
    $('csvError').textContent=error.message;
   }finally{
    button.disabled=false;
   }
  };
 }

 $('importBtn').onclick=async()=>{
  if(!activeAccounts().length){
   openForm('account');
   $('error').textContent='Add an active account before importing transactions.';
   return;
  }
  try{
   const file=await chooseFile('.csv,text/csv');
   if(!file)return;
   if(file.size>2000000)throw Error('Choose a CSV under 2 MB.');
   const [headers,...records]=parseCSV((await file.text()).replace(/^\uFEFF/,''));
   if(!headers?.length||!records.length||headers.length>80||records.length>10000)throw Error('Use a CSV with a header row and up to 10,000 transactions.');
   if(headers.some(header=>!header||header.length>100)||new Set(headers.map(trimHeader)).size!==headers.length)throw Error('Give each CSV column a unique header.');
   showMapping(headers,records);
   csvDialog.showModal();
   fileStatus.textContent='';
  }catch(error){fileStatus.textContent=error.message}
 };

 function validateMappings(mappings) {
  if(mappings==null)return;
  if(!Array.isArray(mappings)||mappings.length>30||mappings.some(preset=>
   !preset||typeof preset.name!=='string'||!preset.name.trim()||preset.name.length>70||
   !['ymd','mdy','dmy'].includes(preset.dateFormat)||!['signed','expense','columns'].includes(preset.amountStyle)||
   !preset.columns||Object.keys(headings).some(field=>preset.columns[field]!=null&&(typeof preset.columns[field]!=='string'||preset.columns[field].length>100))
  ))throw Error('Choose a backup with valid CSV mappings.');
 }

 window.saldoTransactionTools={applyDraft,dateFilters,resetDates,validateEntries,validateMappings};
 window.transactionCategoryChanges=categoryChanges;
})();
