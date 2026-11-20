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
const transactionsPerPage=25;
const activityDate=new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'UTC'});
const activity={page:0,month:''};
const accountFilter=$('activityAccount');

function transactionType(entry){
 if(entry.to||entry.link)return 'transfer';
 return entry.amount>0?'income':'expense';
}

function filterActivity(entries,{month,account,type,search},accounts){
 const accountNames=new Map(accounts.map(({id,name})=>[id,name]));
 const terms=search.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return entries.filter(entry=>{
  if(month&&!entry.date.startsWith(month))return false;
  if(account&&entry.account!==account&&entry.to!==account)return false;
  if(type&&transactionType(entry)!==type)return false;
  if(!terms.length)return true;
  const text=[entry.description,entry.category,entry.reference,entry.date,accountNames.get(entry.account),accountNames.get(entry.to)].join(' ').toLowerCase();
  return terms.every(term=>text.includes(term));
 }).sort((a,b)=>b.date.localeCompare(a.date));
}

function renderActivity(){
 const {accounts,entries}=db;
 const month=$('month').value;
 if(activity.month!==month){
  activity.month=month;
  activity.page=0;
 }
 const selected=accountFilter.value;
 if(accountFilter.options.length!==accounts.length+1||accounts.some(({id,name},index)=>{
  const option=accountFilter.options[index+1];
  return option?.value!==id||option.text!==name;
 })){
  accountFilter.replaceChildren(new Option('All accounts',''),...accounts.map(a=>new Option(a.name,a.id)));
  if(accounts.some(a=>a.id===selected))accountFilter.value=selected;
 }
 const account=accountFilter.value,type=$('activityType').value,search=$('activitySearch').value;
 const allDates=$('activityRange').value==='all';
 const filtersApplied=Boolean(account||type||search.trim());
 const matches=filterActivity(entries,{month:allDates?null:month,account,type,search},accounts);
 const lastPage=Math.max(0,Math.ceil(matches.length/transactionsPerPage)-1);
 activity.page=Math.min(activity.page,lastPage);
 const offset=activity.page*transactionsPerPage;
 const visible=matches.slice(offset,offset+transactionsPerPage);
 const accountNames=new Map(accounts.map(a=>[a.id,a.name]));
 const displayCount=matches.length===1?'1 transaction':matches.length+' transactions';
 $('activityCount').textContent=lastPage?(offset+1)+'–'+(offset+visible.length)+' of '+displayCount:displayCount;
 $('clearActivity').hidden=!filtersApplied&&!allDates;
 $('activityPages').hidden=!lastPage;
 $('previousActivity').disabled=activity.page===0;
 $('nextActivity').disabled=activity.page===lastPage;
 const currentDate=today();
 let previousDate='';
 $('entries').innerHTML=visible.map(entry=>{
  const kind=transactionType(entry);
  const detail=[accountNames.get(entry.account),entry.link?'Matched transfer':entry.to?'To '+(accountNames.get(entry.to)||'another account'):entry.category].filter(Boolean).join(' · ');
  const value=(kind==='income'?'+':'')+money(entry.amount);
  const date=entry.date;
  const newGroup=date!==previousDate;
  previousDate=date;
  const timestamp=Date.parse(date+'T00:00:00Z');
  const dateLabel=date===currentDate?'Today':Number.isNaN(timestamp)?date:activityDate.format(timestamp);
  const dayHeading=newGroup?'<h3 class="transaction-date"><time datetime="'+escapeText(date)+'">'+escapeText(dateLabel)+'</time></h3>':'';
  return dayHeading+'<div class="row transaction"><span>'+escapeText(entry.description)+'<em>'+escapeText(detail)+'</em></span><b class="transaction-value '+kind+'">'+escapeText(value)+'</b><button type="button" class="light" data-edit="'+escapeText(entry.id)+'" aria-label="'+escapeText('Edit '+entry.description)+'">Edit</button></div>';
 }).join('')||hint(filtersApplied?'No transactions match these filters.':allDates?'Add a transaction to start your history.':'No transactions for the reporting month.');
 $('undoEdit').hidden=!undo||undo.version!==window.saldoAccount.version;
}

function summarizeMonth(entries,month){
 let income=0,spent=0;
 const categories=new Map();
 for(const entry of entries){
  if(!entry.date.startsWith(month)||transactionType(entry)==='transfer')continue;
  if(entry.amount>0)income+=entry.amount;
  if(entry.amount<0){
   spent-=entry.amount;
   categories.set(entry.category,(categories.get(entry.category)||0)-entry.amount);
  }
 }
 return {income,spent,categories};
}

const views={
 overview:'Money overview',
 accounts:'Accounts',
 activity:'Activity',
 planning:'Planning',
 settings:'Settings'
};
const menu=[...document.querySelectorAll('.ledger-nav a')];
const viewPanels=[...document.querySelectorAll('#overview [data-view]')];

function showView(moveFocus=false){
 const section=location.hash.slice(1);
 const view=Object.hasOwn(views,section)?section:'overview';
 $('overview').dataset.currentView=view;
 $('viewTitle').textContent=views[view];
 for(const panel of viewPanels)panel.hidden=!panel.dataset.view.split(' ').includes(view);
 for(const link of menu){
  if(link.hash==='#'+view)link.setAttribute('aria-current','page');
  else link.removeAttribute('aria-current');
 }
 if(moveFocus){
  $('viewTitle').focus({preventScroll:true});
  window.scrollTo(0,0);
 }
}
window.addEventListener('hashchange',()=>showView(true));
showView();

const monthLabel=new Intl.DateTimeFormat('en-PH',{month:'short',timeZone:'UTC'});
const fullMonthLabel=new Intl.DateTimeFormat('en-PH',{month:'long',year:'numeric',timeZone:'UTC'});

function renderTrend(entries,month){
 const [year,monthNumber]=month.split('-').map(Number);
 const periods=Array.from({length:6},(_,index)=>{
  const date=new Date(0);
  date.setUTCFullYear(year,monthNumber-6+index,1);
  return {date,key:date.toISOString().slice(0,7),amount:0};
 });
 const byMonth=new Map(periods.map(period=>[period.key,period]));
 for(const entry of entries){
  if(entry.amount>=0||transactionType(entry)==='transfer')continue;
  const period=byMonth.get(entry.date.slice(0,7));
  if(period)period.amount-=entry.amount;
 }
 const maximum=Math.max(...periods.map(period=>period.amount));
 const container=$('spendingTrend');
 if(!maximum){
  container.innerHTML=hint('Your expenses for this period will appear here.');
  return;
 }
 const bars=periods.map(period=>{
  const label=fullMonthLabel.format(period.date);
  const value=money(period.amount);
  return '<div class="trend-month" title="'+escapeText(label+': '+value)+'">'+
   '<div class="trend-track"><span class="'+(period.key===month?'is-selected':'')+'" style="height:'+(100*period.amount/maximum)+'%"></span></div>'+
   '<span>'+escapeText(monthLabel.format(period.date))+'</span></div>';
 }).join('');
 const rows=periods.map(period=>row(fullMonthLabel.format(period.date),'',money(period.amount))).join('');
 container.innerHTML='<div class="trend-chart" aria-hidden="true">'+bars+'</div>'+
  '<details class="trend-values"><summary>View monthly totals</summary>'+rows+'</details>';
}

function renderRecent(entries,accounts){
 const accountNames=new Map(accounts.map(a=>[a.id,a.name]));
 const month=$('month').value;
 const recent=entries.filter(entry=>entry.date.startsWith(month)).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
 $('recentEntries').innerHTML=recent.map(entry=>{
  const kind=transactionType(entry);
  const description=accountNames.get(entry.account)||'';
  const detail=[entry.date,description,kind==='transfer'?'Transfer':entry.category].filter(Boolean).join(' · ');
  return row(entry.description,detail,(kind==='income'?'+':'')+money(entry.amount));
 }).join('')||hint('No transactions for the reporting month.');
}

function render(){
 const hasAccounts=db.accounts.length>0;
 $('startLedger').hidden=hasAccounts;
 $('newEntry').hidden=$('quick').hidden=!hasAccounts;
 $('newAccount').hidden=!hasAccounts;
 const balances=new Map(db.accounts.map(a=>[a.id,a.opening]));
 for(const entry of db.entries){
  if(balances.has(entry.account))balances.set(entry.account,balances.get(entry.account)+entry.amount);
  if(balances.has(entry.to))balances.set(entry.to,balances.get(entry.to)-entry.amount);
 }
 $('total').textContent=money([...balances.values()].reduce((a,b)=>a+b,0));
 $('count').textContent=db.accounts.length+' tracked account'+(db.accounts.length===1?'':'s');
 $('accountList').innerHTML=db.accounts.map(a=>row(a.name,a.type,money(balances.get(a.id)))).join('')||hint('Add a bank account, e-wallet, or cash wallet with its opening balance.');
 const {income,spent,categories}=summarizeMonth(db.entries,$('month').value);
 $('income').textContent=money(income);
 $('spent').textContent=money(spent);
 $('netFlow').textContent=money(income-spent);
 $('netFlow').dataset.direction=income<spent?'negative':income>spent?'positive':'neutral';
 $('categories').innerHTML=[...categories].sort((a,b)=>b[1]-a[1]).map(([category,value])=>{
  const percent=Math.round(100*value/spent);
  return '<div class="category"><div><span>'+escapeText(category)+'</span><strong>'+escapeText(money(value))+'</strong><small>'+percent+'%</small></div><progress aria-label="'+escapeText(category+' share of spending')+'" value="'+value+'" max="'+spent+'"></progress></div>';
 }).join('')||hint('Expense categories will appear here for the reporting month.');
 renderActivity();
 renderTrend(db.entries,$('month').value);
 renderRecent(db.entries,db.accounts);
 if(typeof renderFeatures==='function')renderFeatures();
}

$('month').value=today().slice(0,7);
$('month').onchange=()=>{
 if(!$('month').value)$('month').value=today().slice(0,7);
 render();
};
function resetActivityPage(){
 activity.page=0;
 renderActivity();
}
$('activitySearch').oninput=resetActivityPage;
for(const id of ['activityRange','activityAccount','activityType'])$(id).onchange=resetActivityPage;
$('clearActivity').onclick=()=>{
 $('activitySearch').value='';
 $('activityRange').value='month';
 accountFilter.value='';
 $('activityType').value='';
 resetActivityPage();
 $('activitySearch').focus();
};
$('previousActivity').onclick=()=>{activity.page=Math.max(0,activity.page-1);renderActivity()};
$('nextActivity').onclick=()=>{activity.page++;renderActivity()};

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
$('startLedger').onclick=$('newAccount').onclick=()=>openForm('account');$('newEntry').onclick=()=>openForm('entry');$('importBtn').onclick=()=>openForm('csv');$('close').onclick=()=>dialog.close();render();
