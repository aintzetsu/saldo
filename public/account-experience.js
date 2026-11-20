'use strict';

(() => {
 const activeAccounts=(state=db)=>state.accounts.filter(account=>account.archived!==true);
 const accountTypes=[['Bank','Bank'],['E-wallet','E-wallet'],['Cash','Cash wallet']];
 const posting=(entry,id)=>(entry.account===id?entry.amount:0)-(entry.to===id?entry.amount:0);
 const belongsTo=(entry,id)=>entry.account===id||entry.to===id;
 const make=(name,attrs={})=>Object.assign(document.createElement(name),attrs);
 const addOnboarding=make('article',{id:'saldoOnboarding',className:'tools'});
 addOnboarding.dataset.view='overview';
 $('overview').querySelector('.intro').after(addOnboarding);
 viewPanels.push(addOnboarding);

 const saveNotice=make('div',{id:'saldoSaveNotice',className:'actions tools'});
 const saveMessage=make('p',{id:'saldoSaveMessage'});
 saveMessage.setAttribute('role','status');
 saveMessage.setAttribute('aria-live','polite');
 const undoSave=make('button',{type:'button',className:'light',textContent:'Undo transaction'});
 undoSave.hidden=true;
 saveNotice.append(saveMessage,undoSave);
 addOnboarding.before(saveNotice);
 const activityContext=make('div',{id:'accountActivityContext',className:'tools'});
 $('entries').before(activityContext);
 const baseRender=render;
 const baseRenderActivity=renderActivity;
 const baseOpenForm=openForm;
 const submitLedger=saveLedger;
 const showEditedEntry=$('entries').onclick;
 const scanReceipt=$('receiptBtn').onclick;
 let editing=null;
 let latestSave=null;

 function accountRecord(account){
  const id=escapeText(account.id), name=escapeText(account.name), amount=escapeText(money(balance(db,account.id)));
  const type=escapeText(account.type)+(account.archived===true?' · Archived':'');
  return '<div class="account-record row">'+
   '<a class="account-record-main" href="#activity" data-account-activity="'+id+'"><span>'+name+'<em>'+type+'</em></span>'+
   '<b class="account-record-amount">'+amount+'</b></a>'+
   '<div class="actions account-record-actions"><button type="button" class="light" data-account-edit="'+id+'" aria-label="'+escapeText('Edit '+account.name)+'">Edit</button>'+
   (account.archived===true
    ?'<button type="button" class="light" data-account-restore="'+id+'" aria-label="'+escapeText('Restore '+account.name)+'">Restore</button>'
    :'<button type="button" class="light" data-account-reconcile="'+id+'" aria-label="'+escapeText('Reconcile '+account.name)+'">Reconcile</button>')+
   '</div></div>';
 }

 function renderAccountList(){
  const active=activeAccounts();
  const archived=db.accounts.filter(account=>account.archived===true);
  const expanded=$('archivedAccounts')?.open;
  const condensed=($('overview').dataset.currentView||'overview')==='overview';
  $('accountList').innerHTML=(active.map(accountRecord).join('')||hint(archived.length
   ?'Restore an archived account or add an account to record new transactions.'
   :'Add a bank account, e-wallet, or cash wallet with its opening balance.'))+
   (archived.length?'<details id="archivedAccounts"'+(expanded?' open':'')+'><summary>Archived accounts ('+archived.length+')</summary>'+
    '<p class="empty">Archived accounts keep their history and stay in the combined balance.</p>'+archived.map(accountRecord).join('')+'</details>':'');
  $('accountList').classList.toggle('compact-account-list',condensed);
  $('startLedger').hidden=active.length>0;
  $('startLedger').textContent=db.accounts.length?'Add account':'Add your first account';
  $('quick').hidden=$('newEntry').hidden=!active.length;
  $('newAccount').hidden=!active.length;
  $('cashBtn').hidden=active.some(account=>account.type==='Cash');
 }

 function dismissKey(){return 'saldo-checklist-dismissed-'+window.saldoAccount.owner}
 function checklistDismissed(){
  try{return localStorage.getItem(dismissKey())==='1'}catch{return false}
 }
 function renderChecklist(){
  const hasBudget=db.budget!=null||Boolean(db.categoryBudgets&&Object.keys(db.categoryBudgets).length);
  const steps=[
   {label:'Add an account',done:db.accounts.length>0,action:'account'},
   {label:'Record a transaction',done:db.entries.length>0,action:'transaction'},
   {label:'Set a budget',done:hasBudget,action:'budget'}
  ];
  const completed=steps.filter(step=>step.done).length;
  addOnboarding.hidden=($('overview').dataset.currentView||'overview')!=='overview'||completed===steps.length||checklistDismissed();
  if(addOnboarding.hidden)return;
  addOnboarding.innerHTML='<div class="heading"><h2>Get started</h2><button type="button" class="light" data-checklist="dismiss">Dismiss</button></div>'+
   '<p class="checklist-status">'+completed+' of '+steps.length+' complete</p>'+
   '<ol class="checklist">'+steps.map(step=>'<li>'+
    (step.done?'<span>'+step.label+' <span class="checklist-status">· Done</span></span>'
     :'<button type="button" class="light" data-checklist="'+step.action+'">'+step.label+'</button>')+
    '</li>').join('')+'</ol>';
 }
 addOnboarding.onclick=event=>{
  const action=event.target.closest('[data-checklist]')?.dataset.checklist;
  if(action==='dismiss'){
   try{localStorage.setItem(dismissKey(),'1')}catch{}
   addOnboarding.hidden=true;
  }
  if(action==='account')openForm('account');
  if(action==='transaction')openForm('entry');
  if(action==='budget')$('budgetBtn').click();
 };

 function editAccount(id){
  const account=db.accounts.find(item=>item.id===id);
  if(!account)return;
  const types=accountTypes.some(([type])=>type===account.type)?accountTypes:[...accountTypes,[account.type,account.type]];
  popup('Edit account',label('Account name',input('editAccountName','maxlength="70"'))+
   label('Account type',select('editAccountType',types))+
   label('Opening balance (PHP)',input('editAccountOpening','type="number" step=".01"'))+
   '<p id="openingPreview" role="status"></p>'+
   '<p class="empty">Changing the opening balance also changes the running balance for earlier transactions.</p>'+
   (account.archived===true?'':'<label class="check-control"><input id="archiveAccount" type="checkbox">Archive this account</label>'+
   '<p class="empty">Archived accounts are unavailable for new transactions. Their balances and history remain available.</p>'),
   state=>{
    const current=state.accounts.find(item=>item.id===id);
    if(!current)throw Error('This account no longer exists.');
    const name=$('editAccountName').value.trim();
    if(!name)throw Error('Enter an account name.');
    current.name=name;
    current.type=$('editAccountType').value;
    current.opening=cents($('editAccountOpening').value);
    if($('archiveAccount')?.checked)current.archived=true;
   });
  $('editAccountName').value=account.name;
  $('editAccountType').value=account.type;
  const opening=$('editAccountOpening'), currentBalance=balance(db,id);
  opening.value=(account.opening/100).toFixed(2);
  opening.oninput=()=>{
   try{
    const updated=currentBalance+cents(opening.value)-account.opening;
    $('openingPreview').textContent=updated===currentBalance
     ?'Current balance: '+money(currentBalance)
     :'Current balance: '+money(currentBalance)+' → '+money(updated);
   }catch{$('openingPreview').textContent='Enter a valid opening balance to see the updated balance.'}
  };
  opening.oninput();
 }

 function runningBalances(state,id){
  const account=state.accounts.find(item=>item.id===id);
  if(!account)return new Map();
  // The activity list is newest-first and preserves saved order for ties.
  const chronological=state.entries.filter(entry=>belongsTo(entry,id)).reverse().sort((a,b)=>a.date.localeCompare(b.date));
  let value=account.opening;
  return new Map(chronological.map(entry=>{
   value+=posting(entry,id);
   return [entry.id,{value,delta:posting(entry,id),incoming:entry.to===id}];
  }));
 }

 function renderRunningBalances(){
  const id=$('activityAccount').value, account=db.accounts.find(item=>item.id===id);
  activityContext.hidden=!account;
  if(!account)return;
  activityContext.textContent=account.name+' · Current balance '+money(balance(db,id));
  const balances=runningBalances(db,id);
  for(const button of $('entries').querySelectorAll('[data-edit]')){
   const record=balances.get(button.dataset.edit);
   const line=button.closest('.transaction');
   if(!record||!line)continue;
   const detail=line.querySelector('em');
   if(record.incoming){
    const amount=line.querySelector('.transaction-value');
    if(amount)amount.textContent=(record.delta>0?'+':'')+money(record.delta);
    const transaction=db.entries.find(entry=>entry.id===button.dataset.edit);
    const source=db.accounts.find(item=>item.id===transaction?.account);
    if(detail&&source)detail.textContent='From '+source.name;
   }
   const running=make('span',{className:'running-balance',textContent:'Running balance '+money(record.value)});
   detail?.append(running);
  }
 }

 function showAccountActivity(id){
  $('clearActivity').click();
  window.saldoTransactionTools?.resetDates();
  $('activityRange').value='all';
  $('activityAccount').value=id;
  resetActivityPage();
  if(location.hash!=='#activity')location.hash='activity';
 }

 $('accountList').onclick=async event=>{
  const node=event.target.closest('[data-account-activity],[data-account-edit],[data-account-restore],[data-account-reconcile]');
  if(!node)return;
  const {accountActivity,accountEdit,accountRestore,accountReconcile}=node.dataset;
  if(accountActivity){
   event.preventDefault();
   showAccountActivity(accountActivity);
  }
  if(accountEdit)editAccount(accountEdit);
  if(accountReconcile)openStatement(accountReconcile);
  if(accountRestore){
   try{
    await update(state=>{
     const current=state.accounts.find(item=>item.id===accountRestore);
     if(!current)throw Error('This account no longer exists.');
     delete current.archived;
    });
   }catch(error){alert(error.message)}
  }
 };

 function openStatement(id){
  const account=db.accounts.find(item=>item.id===id);
  if(!account)return;
  const saved=db.reconciliations?.[id];
  const selected=new Set(saved?.ids||[]);
  const accountEntries=db.entries.filter(entry=>belongsTo(entry,id)).sort((a,b)=>b.date.localeCompare(a.date));
  let page=0;
  const pageSize=20;
  popup('Reconcile '+account.name,
   label('Statement ending date',input('statementDate','type="date"'))+
   label('Statement ending balance (PHP)',input('statementBalance','type="number" step=".01"'))+
   '<p class="empty">Check transactions that appear on the statement. The cleared balance starts with this account’s opening balance.</p>'+
   '<div id="statementDifference" role="status"></div><div id="statementEntries" class="reconcile-list"></div>'+
   '<div class="actions"><button type="button" class="light" id="statementPrevious">Previous</button>'+
   '<span id="statementPage"></span><button type="button" class="light" id="statementNext">Next</button></div>',
   state=>{
    const closingDate=$('statementDate').value;
    const current=state.accounts.find(item=>item.id===id);
    if(!current)throw Error('This account no longer exists.');
    const ending=cents($('statementBalance').value);
    const ids=state.entries.filter(entry=>entry.date<=closingDate&&belongsTo(entry,id)&&selected.has(entry.id)).map(entry=>entry.id);
    state.reconciliations??={};
    Object.defineProperty(state.reconciliations,id,{value:{date:closingDate,actual:ending,ids},enumerable:true,configurable:true,writable:true});
   });
  const date=$('statementDate'), amount=$('statementBalance'), list=$('statementEntries');
  date.value=saved?.date||today();
  if(saved&&Number.isSafeInteger(saved.actual))amount.value=(saved.actual/100).toFixed(2);
  const eligible=()=>accountEntries.filter(entry=>entry.date<=date.value);
  function showDifference(){
   const cleared=eligible().reduce((sum,entry)=>sum+(selected.has(entry.id)?posting(entry,id):0),account.opening);
   const expected=$('statementDifference');
   let difference='Enter the ending balance to calculate the difference.';
   if(amount.value){
    try{difference='Remaining difference '+money(cents(amount.value)-cleared)}catch{}
   }
   expected.textContent='Cleared balance '+money(cleared)+' · '+difference;
  }
  function showStatementPage(){
   const items=eligible(), last=Math.max(0,Math.ceil(items.length/pageSize)-1);
   page=Math.min(last,page);
   list.innerHTML=items.slice(page*pageSize,(page+1)*pageSize).map(entry=>
    '<label class="reconcile-line"><input type="checkbox" data-statement-id="'+escapeText(entry.id)+'"'+(selected.has(entry.id)?' checked':'')+'>'+
    '<span>'+escapeText(entry.description)+' <small>'+escapeText(entry.date)+'</small></span><b>'+escapeText(money(posting(entry,id)))+'</b></label>'
   ).join('')||hint('No transactions through this date.');
   $('statementPrevious').disabled=page===0;
   $('statementNext').disabled=page===last;
   $('statementPage').textContent=(page+1)+' / '+(last+1);
   showDifference();
  }
  list.onchange=event=>{
   const field=event.target;
   if(!field.dataset.statementId)return;
   if(field.checked)selected.add(field.dataset.statementId);
   else selected.delete(field.dataset.statementId);
   showDifference();
  };
  date.onchange=()=>{page=0;showStatementPage()};
  amount.oninput=showDifference;
  $('statementPrevious').onclick=()=>{page=Math.max(0,page-1);showStatementPage()};
  $('statementNext').onclick=()=>{page++;showStatementPage()};
  showStatementPage();
 }

 function restrictAccounts(selectField,retainedIds){
  for(const option of Array.from(selectField.options)){
   if(!retainedIds.includes(option.value))option.remove();
  }
 }
 openForm=function(kind){
  const active=activeAccounts();
  if((kind==='entry'||kind==='csv')&&!active.length&&!editing){
   baseOpenForm('account');
   $('error').textContent='Add or restore an account before recording transactions.';
   return;
  }
  baseOpenForm(kind);
  if(mode!=='entry'&&mode!=='csv')return;
  const editAccounts=[editing?.account,editing?.to];
  const retained=[...active.map(account=>account.id),...editAccounts];
  restrictAccounts($('acct'),retained);
  if($('to'))restrictAccounts($('to'),retained);
 };
 $('entries').onclick=event=>{
  const id=event.target.closest('[data-edit]')?.dataset.edit;
  editing=id?db.entries.find(entry=>entry.id===id):null;
  try{return showEditedEntry(event)}finally{editing=null}
 };
 $('receiptBtn').onclick=async event=>{
  if(!activeAccounts().length){openForm('entry');return}
  await scanReceipt(event);
  if(dialog.open&&mode==='entry'&&$('acct')&&!$('acct').value)$('acct').selectedIndex=0;
 };

 quickExpense=function(){
  const accounts=activeAccounts();
  if(!accounts.length){openForm('entry');return}
  const expenses=db.entries.filter(entry=>entry.amount<0&&!entry.to&&!entry.link).sort((a,b)=>b.date.localeCompare(a.date));
  const recentCategories=[...new Set(expenses.slice(0,70).map(entry=>entry.category).filter(Boolean))].slice(0,12);
  const categories=[...new Set([...recentCategories,'Food','Transport','Groceries','Bills','Shopping','Other'])];
  const lastAccount=accounts.find(account=>account.id===db.quickExpenseAccount)
   ||accounts.find(account=>account.id===expenses.find(entry=>accounts.some(account=>account.id===entry.account))?.account)
   ||accounts[0];
  popup('Quick expense',
   label('Amount (PHP)',input('qAmount','type="number" inputmode="decimal" min=".01" step=".01" autofocus'))+
   label('Account',select('qAccount',accounts.map(account=>[account.id,account.name])))+
   label('Category',input('qCat','list="quickCategories" maxlength="60"'))+
   '<datalist id="quickCategories">'+options(categories.map(category=>[category,category]))+'</datalist>'+
   label('Note (optional)','<input id="qNote" maxlength="140">'),
   state=>{
    const account=$('qAccount').value,category=$('qCat').value.trim()||'Other';
    if(!activeAccounts(state).some(item=>item.id===account))throw Error('Choose an active account.');
    state.quickExpenseAccount=account;
    state.entries.unshift({id:crypto.randomUUID(),description:$('qNote').value.trim()||category,account,category,date:today(),amount:-cents($('qAmount').value)});
    $('month').value=today().slice(0,7);
   });
  $('qAccount').value=lastAccount.id;
  $('qCat').value=recentCategories[0]||'Food';
  window.saldoTracking?.watchDraft($('qNote'),$('qCat'));
 };
 $('quick').onclick=()=>quickExpense();
 if(extra.open&&$('qAmount')){
  const amount=$('qAmount').value;
  extra.close();
  quickExpense();
  if($('qAmount'))$('qAmount').value=amount;
 }

 function refreshSaveNotice(){
  undoSave.hidden=!latestSave||latestSave.version!==window.saldoAccount.version;
  saveNotice.hidden=undoSave.hidden&&!saveMessage.textContent;
 }
 saveLedger=async function(data){
  const before=read();
  let added=null;
  if(data.entries.length===before.entries.length+1){
   const {entries:priorEntries,quickExpenseAccount:priorQuick,...priorFields}=before;
   const {entries:newEntries,quickExpenseAccount:nextQuick,...nextFields}=data;
   if(JSON.stringify(priorFields)===JSON.stringify(nextFields)){
    const oldIds=new Set(priorEntries.map(entry=>entry.id));
    const additions=newEntries.filter(entry=>!oldIds.has(entry.id));
    if(additions.length===1&&additions[0].id&&JSON.stringify(newEntries.filter(entry=>oldIds.has(entry.id)))===JSON.stringify(priorEntries)){
     added={id:additions[0].id,priorQuick,nextQuick};
    }
   }
  }
  const result=await submitLedger(data);
  latestSave=added?{...added,version:window.saldoAccount.version}:null;
  saveMessage.textContent=added?'Transaction saved.':'';
  refreshSaveNotice();
  return result;
 };
 undoSave.onclick=async()=>{
  const target=latestSave;
  if(!target)return;
  undoSave.disabled=true;
  try{
   await update(state=>{
    if(target.version!==window.saldoAccount.version)throw Error('The ledger changed after that transaction.');
    if(!state.entries.some(entry=>entry.id===target.id))throw Error('This transaction no longer exists.');
    state.entries=state.entries.filter(entry=>entry.id!==target.id);
    if(state.quickExpenseAccount===target.nextQuick){
     if(target.priorQuick==null)delete state.quickExpenseAccount;
     else state.quickExpenseAccount=target.priorQuick;
    }
   });
   saveMessage.textContent='Transaction undone.';
  }catch(error){saveMessage.textContent=error.message}
  finally{undoSave.disabled=false;refreshSaveNotice()}
 };

 renderActivity=function(){baseRenderActivity();renderRunningBalances()};
 render=function(){
  baseRender();
  renderAccountList();
  renderChecklist();
  refreshSaveNotice();
 };
 window.addEventListener('hashchange',()=>{renderAccountList();renderChecklist()});
 window.saldoAccountExperience={activeAccounts,showAccountActivity,runningBalances};
 render();
})();
