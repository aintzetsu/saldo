'use strict';
const sameReference=(a,b)=>Boolean(a&&b)&&a.replace(/[\s-]/g,'').toUpperCase()===b.replace(/[\s-]/g,'').toUpperCase();
function receiptFields(reference=''){
 $('fields').insertAdjacentHTML('beforeend',label('Receipt reference (optional)','<input id="receiptRef" maxlength="80">')+'<label id="dupLabel" hidden><input type="checkbox" id="allowDuplicate">Keep separate despite matching reference</label>');
 const field=$('receiptRef');field.value=reference;
 field.oninput=()=>{$('allowDuplicate').checked=false;$('dupLabel').hidden=!db.entries.some(e=>e.id!==editId&&sameReference(e.reference,field.value))};field.oninput();
}
$('entries').onclick=e=>{
 const id=e.target.closest('[data-edit]')?.dataset.edit;if(!id)return;
 const entry=db.entries.find(x=>x.id===id);openForm('entry');editId=id;
 $('title').textContent='Edit transaction';$('kind').value=entry.to?'Transfer':entry.amount>0?'Income':'Expense';$('kind').onchange();
 $('acct').value=entry.account;if(entry.to)$('to').value=entry.to;$('date').value=entry.date;$('desc').value=entry.description;$('cat').value=entry.category;
 $('amount').value=Math.abs(entry.amount)/100;receiptFields(entry.reference);
 if(entry.link)$('fields').insertAdjacentHTML('beforeend',hint('Changing the account, date, amount, or transfer type will release the matched pair for review.'));
};
$('undoEdit').onclick=async()=>{
 try{await update(s=>{if(!undo||undo.version!==window.saldoAccount.version)throw Error('The ledger changed after that edit.');s.entries=structuredClone(undo.entries)});undo=null;render()}
 catch(e){alert(e.message)}
};
function chooseFile(accept){
 return new Promise(resolve=>{const f=document.createElement('input');f.type='file';f.accept=accept;f.onchange=()=>resolve(f.files[0]);f.oncancel=()=>resolve(null);f.click()});
}
function validateBackup(file){
 const reject=()=>{throw Error('Choose a valid Saldo ledger backup.')};
 if(file?.format!=='saldo-backup-v1')reject();
 const s=file.ledger,validId=x=>typeof x==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(x)&&!(x in Object.prototype);
 const str=x=>typeof x==='string',num=Number.isSafeInteger,dt=x=>str(x)&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
 for(const list of [s?.accounts,s?.entries,s?.subs??[]])if(!Array.isArray(list)||list.some(x=>!validId(x?.id))||new Set(list.map(x=>x.id)).size!==list.length)reject();
 const accounts=new Set(s.accounts.map(a=>a.id)),entries=new Set(s.entries.map(e=>e.id));
 if(s.accounts.some(a=>!str(a.name)||!str(a.type)||!num(a.opening)||(a.archived!=null&&typeof a.archived!=='boolean')))reject();
 if(s.entries.some(e=>!accounts.has(e.account)||!dt(e.date)||!num(e.amount)||!str(e.category)||!str(e.description)||(e.to&&(!accounts.has(e.to)||e.to===e.account))||(e.link&&!entries.has(e.link))||(e.reference&&!str(e.reference))))reject();
 if((s.subs??[]).some(x=>!str(x.name)||!accounts.has(x.account)||!dt(x.start)||!num(x.amount)||!['Monthly','Weekly','Yearly'].includes(x.freq)))reject();
 if(s.budget!=null&&!num(s.budget))reject();
 for(const [id,c] of Object.entries(s.checks??{}))if(!accounts.has(id)||!dt(c?.date)||!num(c.expected)||!num(c.actual))reject();
 for(const list of [s.dismissed??[],s.ignored??[]])if(!Array.isArray(list)||list.some(x=>!str(x)))reject();
 if(window.saldoTransactionTools?.validateEntries(s.entries)===false)reject();
 window.saldoTransactionTools?.validateMappings(s.csvMappings);
 if(s.quickExpenseAccount!=null&&!accounts.has(s.quickExpenseAccount))reject();
 if(s.reconciliations!=null&&(Array.isArray(s.reconciliations)||typeof s.reconciliations!=='object'||
  Object.entries(s.reconciliations).some(([id,record])=>!accounts.has(id)||!dt(record?.date)||!num(record.actual)||
    !Array.isArray(record.ids)||record.ids.some(x=>!validId(x))||new Set(record.ids).size!==record.ids.length)))reject();
 if(window.saldoPlanningTools?.validateBackup(s)===false)reject();
 return s;
}
function mergeBackup(target,source){
 const counts=[];
 for(const field of ['accounts','entries','subs']){
  const ids=new Set(target[field].map(x=>x.id));
  const renewals=field==='entries'?new Set(target.entries.filter(entry=>entry.subscriptionId).map(entry=>JSON.stringify([entry.subscriptionId,entry.renewalDate]))):null;
  const added=(source[field]||[]).filter(entry=>!ids.has(entry.id)&&(!renewals||!entry.subscriptionId||!renewals.has(JSON.stringify([entry.subscriptionId,entry.renewalDate]))));
  target[field].push(...added);counts.push(added.length);
 }
 target.checks={...source.checks,...target.checks};target.budget??=source.budget;
 for(const key of ['ignored','dismissed'])target[key]=[...new Set([...target[key],...(source[key]||[])])];
 if(source.quickExpenseAccount&&!target.quickExpenseAccount)target.quickExpenseAccount=source.quickExpenseAccount;
 if(source.reconciliations)target.reconciliations={...source.reconciliations,...target.reconciliations};
 if(source.csvMappings?.length){
  const presets=new Map(source.csvMappings.map(preset=>[preset.name.toLowerCase(),preset]));
  for(const preset of target.csvMappings||[])presets.set(preset.name.toLowerCase(),preset);
  target.csvMappings=[...presets.values()].slice(-30);
 }
 window.saldoPlanningTools?.mergeBackup(target,source);
 if(window.saldoTransactionTools?.validateEntries(target.entries)===false)throw Error('This backup conflicts with the split or refund details in your existing ledger.');
 return counts;
}
$('exportLedger').onclick=()=>{
 const backup={format:'saldo-backup-v1',ledger:read()};
 const file=new Blob([JSON.stringify(backup)],{type:'application/json'});
 const url=URL.createObjectURL(file);
 const link=document.createElement('a');
 link.href=url;
 link.download='saldo-ledger-'+today()+'.json';
 document.body.append(link);
 link.click();
 link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 $('toolStatus').textContent='Backup prepared. It contains your ledger data. Store it somewhere private.';
};

$('migrate').onclick=async()=>{
 try{
  const file=await chooseFile('.json,application/json');if(!file)return;if(file.size>3000000)throw Error('Choose a backup under 3 MB.');
  const source=validateBackup(JSON.parse(await file.text())),counts=mergeBackup(read(),source);
  popup('Preview ledger import',row('Accounts','New records',counts[0])+row('Transactions','New records',counts[1])+row('Subscriptions','New records',counts[2])+hint('Matching record IDs are skipped. Existing budget and balance checks take priority.'),state=>{mergeBackup(state,source)});
 }catch(e){$('toolStatus').textContent=e.message}
};
function receiptDraft(text){
 const lines=text.split(/\n/).map(s=>s.trim()).filter(Boolean);
 const moneyPattern=/(?:PHP|₱|P)\s*([\d,]+\.\d{2})|\b([\d,]+\.\d{2})\b/i;
 const amounts=lines.filter(x=>!/fee|balance|reference/i.test(x));
 const total=amounts.find(x=>/total amount|amount sent|amount paid/i.test(x)&&moneyPattern.test(x))||amounts.find(x=>moneyPattern.test(x));
 const match=total?.match(moneyPattern);
 const ref=text.match(/(?:ref(?:erence)?\.?\s*(?:no\.?|number|#)?)[ :#\t]*\s*([0-9][0-9 -]{5,}[0-9])/i);
 const date=text.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+20\d{2}\b/i)?.[0]||text.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
 return {amount:(match?.[1]||match?.[2]||'').replaceAll(',',''),reference:ref?.[1]?.trim()||'',date:date&&Number.isFinite(Date.parse(date+' 12:00 UTC'))?new Date(date+' 12:00 UTC').toISOString().slice(0,10):'',description:text.match(/(?:paid to|sent to|merchant)[:\s]+([^\n]+)/i)?.[1]?.trim()||''};
}
$('receiptBtn').onclick=async()=>{
 if(needAccount())return;
 const file=await chooseFile('image/*');if(!file)return;
 const btn=$('receiptBtn');btn.disabled=true;btn.textContent='Reading receipt…';
 let worker,parsed={},failure=false;
 try{
  if(file.size>20000000)throw Error('Image too large.');
  if(!window.Tesseract)await new Promise((ok,fail)=>{const s=document.createElement('script');s.src='/assets/ocr.js';s.onload=ok;s.onerror=fail;document.head.append(s)});
  worker=await Tesseract.createWorker('eng',1,{workerPath:'/assets/worker.min.js',corePath:'/assets',langPath:'/assets',workerBlobURL:false});
  parsed=receiptDraft((await worker.recognize(file)).data.text);
 }catch{failure=true}finally{if(worker)await worker.terminate();btn.disabled=false;btn.textContent='Scan receipt'}
 openForm('entry');$('title').textContent='Review receipt';const gcash=db.accounts.find(a=>/gcash/i.test(a.name));if(gcash)$('acct').value=gcash.id;
 $('amount').value=parsed.amount||'';$('date').value=parsed.date||'';$('desc').value=parsed.description||'';receiptFields(parsed.reference);
 $('fields').insertAdjacentHTML('afterbegin',hint(failure?'Could not read this image. Enter the details below or close to retry.':'Check the amount, date, recipient and transaction type before saving.'));
};
