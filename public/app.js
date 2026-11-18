'use strict';
const $=id=>document.getElementById(id);
const dbKey='saldo-ledger-v1', dialog=document.querySelector('dialog');
const money=c=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(c/100);
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Manila'});
const empty=()=>({accounts:[],entries:[]});
function read(){const state=structuredClone(window.saldoAccount.data);state.entries.forEach((e,i)=>e.id??='legacy-'+i);state.checks??={};state.subs??=[];state.dismissed??=[];state.ignored??=[];return state}
let db=read(),mode='',editId=null,undo=null;
const escapeText=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function row(title,detail,value){return '<div class="row"><span>'+escapeText(title)+'<em>'+escapeText(detail)+'</em></span><b>'+escapeText(value)+'</b></div>'}
const hint=s=>'<div class="empty">'+s+'</div>';
function render(){
 const balances=new Map(db.accounts.map(a=>[a.id,a.opening]));
 for(const e of db.entries){balances.set(e.account,balances.get(e.account)+e.amount);if(e.to)balances.set(e.to,balances.get(e.to)-e.amount)}
 $('total').textContent=money([...balances.values()].reduce((a,b)=>a+b,0));
 $('count').textContent=db.accounts.length+' tracked account'+(db.accounts.length===1?'':'s');
 $('accountList').innerHTML=db.accounts.map(a=>row(a.name,a.type+' · Manual',money(balances.get(a.id)))).join('')||hint('Add GCash or a bank account with its opening balance to start your ledger.');
 const entries=db.entries.filter(e=>e.date.startsWith($('month').value)).sort((a,b)=>b.date.localeCompare(a.date));
 let income=0,spent=0;const cats=new Map();
 for(const e of entries){if(e.to||e.link)continue;if(e.amount>0)income+=e.amount;else{spent-=e.amount;cats.set(e.category,(cats.get(e.category)||0)-e.amount)}}
 $('income').textContent=money(income);$('spent').textContent=money(spent);
 $('categories').innerHTML=[...cats].sort((a,b)=>b[1]-a[1]).map(([k,v])=>row(k,Math.round(100*v/spent)+'% of spending',money(v))).join('')||hint('Your expense categories will appear here.');
 const name=id=>db.accounts.find(a=>a.id===id)?.name||'';
 $('entries').innerHTML=entries.map(e=>row(e.description,e.date+' · '+name(e.account)+(e.link?' · Matched transfer':e.to?' → '+name(e.to):' · '+e.category),money(e.amount)).replace('</b></div>','</b><button type="button" class="light" data-edit="'+escapeText(e.id)+'">Edit</button></div>')).join('')||hint('No transactions for this month.');
 $('undoEdit').hidden=!undo||undo.version!==window.saldoAccount.version;
 if(typeof renderFeatures==='function')renderFeatures();
}
$('month').value=today().slice(0,7);$('month').onchange=render;
const label=(name,field)=>'<label>'+name+field+'</label>';
const input=(id,attrs='')=>'<input required id="'+id+'" '+attrs+'>';
const options=items=>items.map(([value,title])=>'<option value="'+escapeText(value)+'">'+escapeText(title)+'</option>').join('');
function select(id,items){return '<select id="'+id+'">'+options(items)+'</select>'}
function openForm(kind){
 editId=null;mode=kind;$('error').textContent='';const accounts=db.accounts.map(a=>[a.id,a.name]);
 if(kind!=='account'&&!accounts.length){openForm('account');$('error').textContent='Add your first account to continue.';return}
 $('title').textContent={account:'Add account',entry:'Add transaction',csv:'Import transactions'}[kind];
 let fields=label('Account',select('acct',accounts));
 if(kind==='account')fields=label('Account name',input('name','maxlength="70" placeholder="e.g. GCash or BPI savings"'))+label('Account type',select('type',[['Bank','Bank'],['E-wallet','E-wallet'],['Cash','Cash wallet']]))+label('Opening balance (PHP)',input('opening','type="number" step=".01" value="0"'))+hint('Use the balance immediately before your first recorded transaction.');
 if(kind==='entry')fields+=label('Type',select('kind',['Expense','Income','Transfer'].map(k=>[k,k])))+'<div id="dest" hidden>'+label('Destination account',select('to',accounts))+'</div>'+label('Date',input('date','type="date" value="'+today()+'"'))+label('Amount (PHP)',input('amount','type="number" step=".01" min=".01"'))+label('Description',input('desc','maxlength="140"'))+'<div id="catField">'+label('Category',input('cat','value="Other" maxlength="60"'))+'</div>';
 if(kind==='csv')fields+=hint('Choose a UTF-8 CSV with columns date,description,amount,category. Use YYYY-MM-DD dates and negative amounts for expenses. Review possible transfers and duplicates after import. Matching imported rows are skipped.')+label('CSV file',input('file','type="file" accept=".csv,text/csv"'));
 $('fields').innerHTML=fields;$('save').textContent=kind==='csv'?'Import transactions':'Save';
 if(kind==='entry')$('kind').onchange=()=>{const transfer=$('kind').value==='Transfer';$('dest').hidden=!transfer;$('catField').hidden=transfer;$('cat').required=!transfer};
 dialog.showModal()
}
function cents(raw){if(!/^-?\d+(\.\d{1,2})?$/.test(raw.trim()))throw Error('Enter an amount with up to two decimal places.');const n=Math.round(Number(raw)*100);if(!Number.isSafeInteger(n)||Math.abs(n)>1e13)throw Error('Amount exceeds the supported range.');return n}
function parseCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
 else if(c===','&&!quoted){row.push(cell.trim());cell=''}else if(c==='\n'&&!quoted){row.push(cell.trim());rows.push(row);row=[];cell=''}else cell+=c}
 if(quoted)throw Error('Unclosed quote in CSV.');row.push(cell.trim());rows.push(row);return rows.filter(r=>r.some(Boolean))
}
function imported(text,account){
 const [headers,...rows]=parseCSV(text.replace(/^\uFEFF/,''));if(headers?.join(',').toLowerCase()!=='date,description,amount,category'||!rows.length)throw Error('Check the column headers and include at least one transaction.');
 const occurrences=new Map();
 return rows.map((r,i)=>{const [date,description,raw,category]=r;
 if(r.length!==4||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!description)throw Error('Check date and columns on row '+(i+2)+'.');
 const amount=cents(raw);if(!amount)throw Error('Zero amount on row '+(i+2)+'.');
 const signature=JSON.stringify([account,date,description,amount,category]);const n=occurrences.get(signature)||0;occurrences.set(signature,n+1);return {account,date,description,amount,category:category||'Other',key:JSON.stringify([signature,n])}})
}
$('form').onsubmit=async ev=>{ev.preventDefault();$('save').disabled=true;
 try{let batch,oldEntries;if(mode==='csv')batch=imported(await $('file').files[0].text(),$('acct').value);
 await navigator.locks.request(dbKey,async()=>{const next=read();
 if(mode==='account'){const name=$('name').value.trim();if(!name)throw Error('Enter an account name.');next.accounts.push({id:crypto.randomUUID(),name,type:$('type').value,opening:cents($('opening').value)})}
 if(mode==='entry'){const account=$('acct').value,kind=$('kind').value,to=kind==='Transfer'?$('to').value:null;if(to===account)throw Error('Choose a different destination account.');const description=$('desc').value.trim();if(!description)throw Error('Enter a description.');const record={account,to,description,date:$('date').value,category:$('cat').value.trim()||'Other',amount:cents($('amount').value)*(kind==='Income'?1:-1)};
 const ref=$('receiptRef');if(ref){record.reference=ref.value.trim();if(record.reference&&next.entries.some(e=>e.id!==editId&&sameReference(e.reference,record.reference))&&!$('allowDuplicate').checked)throw Error('This reference already exists. Check Keep separate to save it anyway.')}
 if(editId){oldEntries=structuredClone(next.entries);const existing=next.entries.find(e=>e.id===editId);if(!existing)throw Error('Entry no longer exists.');if(existing.link&&(record.account!==existing.account||record.amount!==existing.amount||record.to||record.date!==existing.date)){const other=next.entries.find(e=>e.id===existing.link);if(other)delete other.link;delete existing.link}Object.assign(existing,record)}else next.entries.unshift(record)}
 if(batch){const known=new Set([...next.ignored,...next.entries.map(e=>e.key)]);const fresh=batch.filter(e=>!known.has(e.key));if(!fresh.length)throw Error('All rows have already been imported.');next.entries.push(...fresh)}
 for(const e of next.entries)e.id??=crypto.randomUUID();await saveLedger(next);db=next;if(oldEntries)undo={version:window.saldoAccount.version,entries:oldEntries}});
 if(mode==='entry')$('month').value=$('date').value.slice(0,7);if(batch)$('month').value=batch.map(e=>e.date).sort().at(-1).slice(0,7);dialog.close();render()
 }catch(err){$('error').textContent=err.message}finally{$('save').disabled=false}};
$('newAccount').onclick=()=>openForm('account');$('newEntry').onclick=()=>openForm('entry');$('importBtn').onclick=()=>openForm('csv');$('close').onclick=()=>dialog.close();render();
