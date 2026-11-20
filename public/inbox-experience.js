'use strict';

(() => {
 const host=$('activityInbox');
 if(!host)return;

 host.innerHTML='<div class="heading"><h2 id="inboxTitle">Activity Inbox</h2>'+
  '<div class="actions"><button type="button" class="light" id="inboxRefresh">Refresh inbox</button>'+
  '<button type="button" class="light" id="inboxSettings">iPhone capture</button></div></div>'+
  '<p class="card-note" id="inboxCaptureStatus"></p>'+
  '<p class="card-note" id="inboxNotice" role="status"></p>'+
  '<div id="inboxPending"></div>'+
  '<details id="inboxHistory" hidden><summary>Recently reviewed</summary><div id="inboxReviewed"></div></details>';

 const editor=document.createElement('dialog');
 editor.setAttribute('aria-labelledby','inboxEditorTitle');
 editor.innerHTML='<form><div class="heading"><h3 id="inboxEditorTitle"></h3>'+
  '<button type="button" class="light" id="inboxEditorClose" aria-label="Close">×</button></div>'+
  '<div id="inboxEditorFields"></div><p id="inboxEditorError" role="alert"></p>'+
  '<div class="actions" id="inboxEditorActions"></div></form>';
 document.body.append(editor);

 const editorForm=editor.querySelector('form');
 const notice=$('inboxNotice');
 const reasons={
  pending:'Needs review',
  saved:'Saved',
  dismissed:'Dismissed',
  matched:'Matched'
 };
 const snapshot=()=>db.trackingInbox||{};
 const itemRows=()=>Array.isArray(snapshot().items)?snapshot().items:[];
 const activeAccounts=()=>db.accounts.filter(account=>!account.archived);
 const accountName=id=>db.accounts.find(account=>account.id===id)?.name||'Unassigned account';
 const hasMoney=value=>Number.isSafeInteger(value)&&value!==0;
 const showAmount=value=>hasMoney(value)?money(value):'Amount needed';
 const showDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'Date needed';
 let busy=false;
 let refreshing=false;

 function inboxError(error){
  return error?.status===409?'This inbox or ledger changed. Refresh it and try again.':error?.message||'The inbox request failed.';
 }

 async function request(action,fields={}){
  return navigator.locks.request(dbKey,async()=>{
   const body=action?{action,...fields,version:window.saldoAccount.version}:undefined;
   const response=await inboxRequest(body);
   acceptInboxSnapshot(response);
   return response;
  });
 }

 function setBusy(value){
  busy=value;
  $('inboxEditorClose').disabled=value;
  for(const button of $('inboxEditorActions').querySelectorAll('button'))button.disabled=value;
  $('inboxRefresh').disabled=value||refreshing;
  $('inboxSettings').disabled=value;
 }

 function closeEditor(){
  if(!busy)editor.close();
 }
 $('inboxEditorClose').onclick=closeEditor;
 editor.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
 editor.addEventListener('close',()=>{
  editorForm.onsubmit=null;
  $('inboxEditorFields').replaceChildren();
  $('inboxEditorActions').replaceChildren();
  $('inboxEditorError').textContent='';
 });

 function showEditor(title,contents,actions,submit){
  $('inboxEditorTitle').textContent=title;
  $('inboxEditorFields').innerHTML=contents;
  $('inboxEditorActions').innerHTML=actions;
  $('inboxEditorError').textContent='';
  editorForm.onsubmit=event=>{event.preventDefault();if(!busy)submit?.()};
  if(!editor.open)editor.showModal();
 }

 async function submitEditor(action,fields,success,onSuccess){
  setBusy(true);
  try{
   const response=await request(action,fields);
   notice.textContent=success;
   setBusy(false);
   if(onSuccess)onSuccess(response);
   else editor.close();
  }catch(error){
   $('inboxEditorError').textContent=inboxError(error);
  }finally{
   setBusy(false);
  }
 }

 function row(item,pending){
  const line=[showDate(item.date),accountName(item.accountId),showAmount(item.amount)].join(' · ');
  return '<div class="row inbox-item">'+
   '<span>'+escapeText(item.description||'Transaction alert')+'<em>'+escapeText(line)+'</em>'+
   (item.reason&&pending?'<em>'+escapeText(item.reason)+'</em>':'')+'</span>'+
   (pending?'<button type="button" class="light" data-inbox-review="'+escapeText(item.id)+'">Review</button>':
    '<small>'+escapeText(reasons[item.status]||'Reviewed')+'</small>')+'</div>';
 }

 function renderInbox(){
  const {source}=snapshot();
  $('inboxCaptureStatus').textContent=source
   ?(source.label||'iPhone alerts')+' · '+accountName(source.accountId)+' · '+(source.autoSave?'Trusted matches auto-save':'Review all alerts')
   :'Send iPhone alerts or import a statement to collect transactions for review.';
  const items=itemRows();
  const pending=items.filter(item=>item.status==='pending');
  const recent=items.filter(item=>item.status!=='pending').slice(0,8);
  $('inboxPending').innerHTML=pending.length
   ?'<p class="card-note">'+pending.length+' '+(pending.length===1?'draft':'drafts')+' to review</p>'+pending.map(item=>row(item,true)).join('')
   :hint('No drafts to review.');
  $('inboxHistory').hidden=!recent.length;
  $('inboxReviewed').innerHTML=recent.map(item=>row(item,false)).join('');
 }

 function showKey(key){
  showEditor('Connect iPhone Shortcuts',
   '<p>Copy this capture key now. Saldo shows it once.</p>'+
   '<label for="inboxCaptureKey">Capture key</label>'+
   '<input id="inboxCaptureKey" type="text" readonly autocomplete="off" spellcheck="false">'+
   '<label for="inboxCaptureEndpoint">Endpoint</label><input id="inboxCaptureEndpoint" type="text" readonly>'+
   '<ol><li>In Shortcuts, create a <strong>Message</strong> or <strong>Email</strong> automation. Filter by the specific sender and alert wording. Use <strong>Run Immediately</strong> if available.</li>'+
   '<li>Add <strong>Get Contents of URL</strong> with the endpoint above. Choose <strong>POST</strong>.</li>'+
   '<li>Add an <strong>Authorization</strong> header. Enter <strong>Bearer</strong>, a space, and the capture key.</li>'+
   '<li>Choose a <strong>JSON</strong> request body. Set <strong>action</strong> to <strong>inboxCapture</strong> and <strong>text</strong> to the alert text from the shortcut input. For auto-save, include <strong>sender</strong> using the same sender you configured in Saldo.</li>'+
   '<li>Run a test alert, then open Saldo and refresh the Activity Inbox.</li></ol>'+
   '<p class="card-note">Keep the key in your personal shortcut. Use a shortcut that accepts shared text if your iPhone does not supply the alert body to the automation.</p>',
   '<button type="button" class="light" id="copyInboxKey">Copy capture key</button>'+
    '<button type="button" class="light" id="copyInboxEndpoint">Copy endpoint</button>'+
    '<button type="button" id="finishInboxKey">Done</button>');
  const field=$('inboxCaptureKey'),endpoint=$('inboxCaptureEndpoint');
  field.value=key;
  endpoint.value=new URL('/api/account',location.origin).href;
  const copy=async(input,message)=>{
   try{
    await navigator.clipboard.writeText(input.value);
    $('inboxEditorError').textContent=message;
   }catch{
    input.select();
    $('inboxEditorError').textContent='Copy the selected text.';
   }
  };
  $('copyInboxKey').onclick=()=>copy(field,'Capture key copied.');
  $('copyInboxEndpoint').onclick=()=>copy(endpoint,'Endpoint copied.');
  $('finishInboxKey').onclick=closeEditor;
  field.focus();
 }

 function confirmRevoke(){
  showEditor('Revoke iPhone capture',
   '<p>The current Shortcut key will stop accepting alerts. Existing drafts remain in the inbox.</p>',
   '<button type="submit">Revoke capture key</button><button type="button" class="light" id="cancelInboxRevoke">Cancel</button>',
   ()=>submitEditor('inboxRevoke',{},'iPhone capture key revoked.'));
  $('cancelInboxRevoke').onclick=showSetup;
 }

 function showSetup(){
  const source=snapshot().source;
  const accounts=activeAccounts();
  if(!accounts.length){
   showEditor('iPhone capture',hint('Add an active account before connecting iPhone alerts.'),
    '<button type="button" id="inboxNoAccountsDone">Done</button>');
   $('inboxNoAccountsDone').onclick=closeEditor;
   return;
  }
  const configured=Boolean(source);
  showEditor('iPhone capture',
   '<p>Connect one trusted sender’s alerts to a Saldo account. Each alert arrives in your Activity Inbox.</p>'+
   '<label>Source name<input id="inboxSourceLabel" maxlength="80" placeholder="Bank payment alerts" required></label>'+
   '<label>Account'+select('inboxSourceAccount',accounts.map(account=>[account.id,account.name]))+'</label>'+
   '<label>Expected sender<input id="inboxSourceSender" type="text" maxlength="120" placeholder="Exact sender in the shortcut" autocomplete="off"></label>'+
   '<label class="check-control"><input type="checkbox" id="inboxSourceAuto">Auto-save clear matches from this source</label>'+
   '<p class="card-note">Auto-save requires the expected sender. Ambiguous alerts, possible duplicates, and transfers wait for review.</p>'+
   (configured?'<p class="card-note">Replacing the key or changing the linked account means updating the key in Shortcuts.</p>':''),
   '<button type="submit">'+(configured?'Save capture settings':'Create capture key')+'</button>'+
   (configured?'<button type="button" class="light" id="inboxRotateKey">Replace key</button>'+
    '<button type="button" class="light" id="inboxRevokeKey">Revoke key</button>':''),
   ()=>configure(false));
  const label=$('inboxSourceLabel'),account=$('inboxSourceAccount'),auto=$('inboxSourceAuto'),sender=$('inboxSourceSender');
  label.value=source?.label||'';
  sender.value=source?.sender||'';
  if(accounts.some(item=>item.id===source?.accountId))account.value=source.accountId;
  auto.checked=Boolean(source?.autoSave);
  auto.onchange=()=>{sender.required=auto.checked};
  auto.onchange();
  function configure(rotate){
   if(busy||!editorForm.reportValidity())return;
   if(!label.value.trim()){
    $('inboxEditorError').textContent='Enter a source name.';
    label.focus();
    return;
   }
   if(auto.checked&&!sender.value.trim()){
    $('inboxEditorError').textContent='Enter the exact sender for auto-save.';
    sender.focus();
    return;
   }
   submitEditor('inboxConfigure',{label:label.value.trim(),accountId:account.value,sender:sender.value.trim(),autoSave:auto.checked,rotate},
    'iPhone capture settings saved.',response=>{
     if(response.captureKey)showKey(response.captureKey);
     else editor.close();
    });
  }
  if(configured){
   $('inboxRotateKey').onclick=()=>configure(true);
   $('inboxRevokeKey').onclick=confirmRevoke;
  }
 }

 function showReview(item){
  const accounts=activeAccounts();
  if(!accounts.length){
   showEditor('Review transaction draft',hint('Add an active account before saving drafts.'),
    '<button type="button" class="light" id="inboxDismissDraft">Dismiss draft</button>');
   $('inboxDismissDraft').onclick=()=>submitEditor('inboxReview',{id:item.id,decision:'dismiss'},'Draft dismissed.');
   return;
  }
  const matchId=item.duplicateOf||item.transferOf;
  const possibleMatches=item.transferPending?itemRows():db.entries;
  const candidate=matchId&&possibleMatches.find(entry=>entry.id===matchId);
  const matchLabel=item.duplicateOf?'Use existing transaction':'Match transfer';
  const needsConfirmation=Boolean(matchId);
  showEditor('Review transaction draft',
   (item.reason?'<p class="card-note">'+escapeText(item.reason)+'</p>':'')+
   (candidate?'<p class="card-note"><strong>Suggested match</strong> '+escapeText([candidate.description,accountName(candidate.account),showDate(candidate.date),showAmount(candidate.amount)].join(' · '))+'</p>':'')+
   '<label>Account'+select('inboxReviewAccount',accounts.map(account=>[account.id,account.name]))+'</label>'+
   '<label>Description<input id="inboxReviewDescription" maxlength="140" required></label>'+
   '<label>Date<input id="inboxReviewDate" type="date" required></label>'+
   '<label>Amount in PHP<input id="inboxReviewAmount" type="number" step=".01" inputmode="decimal" required></label>'+
   '<p class="card-note">Use a negative amount for money out and a positive amount for money in.</p>'+
   '<label>Reference<input id="inboxReviewReference" maxlength="100"></label>'+
   '<label>Category<input id="inboxReviewCategory" maxlength="60"></label>'+
   (needsConfirmation?'<label class="check-control"><input type="checkbox" id="inboxSaveSeparate">Save separately from the suggested match</label>':''),
   '<button type="submit">Save transaction</button>'+
   (matchId?'<button type="button" class="light" id="inboxMatchDraft">'+matchLabel+'</button>':'')+
   '<button type="button" class="light" id="inboxDismissDraft">Dismiss draft</button>',
   ()=>review('save'));
  if(accounts.some(account=>account.id===item.accountId))$('inboxReviewAccount').value=item.accountId;
  $('inboxReviewDescription').value=item.description||'';
  $('inboxReviewDate').value=item.date||'';
  $('inboxReviewAmount').value=hasMoney(item.amount)?String(item.amount/100):'';
  $('inboxReviewReference').value=item.reference||'';
  $('inboxReviewCategory').value=item.category||'';
  $('inboxDismissDraft').onclick=()=>submitEditor('inboxReview',{id:item.id,decision:'dismiss'},'Draft dismissed.');
  if(matchId)$('inboxMatchDraft').onclick=()=>review('match');

  function review(decision){
   if(busy||!editorForm.reportValidity())return;
   if(decision==='save'&&needsConfirmation&&!$('inboxSaveSeparate').checked){
    $('inboxEditorError').textContent='Choose the suggested match or confirm this should be saved separately.';
    return;
   }
   let amount;
   try{
    amount=cents($('inboxReviewAmount').value);
    if(!amount)throw Error('Enter a nonzero amount.');
   }catch(error){
    $('inboxEditorError').textContent=error.message;
    return;
   }
   submitEditor('inboxReview',{
    id:item.id,decision,
    accountId:$('inboxReviewAccount').value,
    description:$('inboxReviewDescription').value.trim(),
    date:$('inboxReviewDate').value,
    amount,
    reference:$('inboxReviewReference').value.trim(),
    category:$('inboxReviewCategory').value.trim()||'Other',
    allowPossibleDuplicate:Boolean($('inboxSaveSeparate')?.checked)
   },decision==='match'?(item.duplicateOf?'Linked to the existing transaction.':'Transfer matched.'):'Transaction saved.');
  }
 }

 $('inboxPending').onclick=event=>{
  const button=event.target.closest('[data-inbox-review]');
  const item=button&&itemRows().find(item=>item.id===button.dataset.inboxReview&&item.status==='pending');
  if(item)showReview(item);
 };
 $('inboxSettings').onclick=showSetup;

 async function refresh(announce=true){
  if(busy||refreshing||(!announce&&document.querySelector('dialog[open]')))return;
  refreshing=true;
  $('inboxRefresh').disabled=true;
  try{
   await request();
   if(announce)notice.textContent='Inbox refreshed.';
  }catch(error){
   if(announce)notice.textContent=inboxError(error);
  }finally{
   refreshing=false;
   $('inboxRefresh').disabled=busy;
  }
 }
 $('inboxRefresh').onclick=()=>refresh();
 const refreshActivity=()=>{
  if(!document.hidden&&location.hash==='#activity')refresh(false);
 };
 window.addEventListener('hashchange',refreshActivity);
 document.addEventListener('visibilitychange',refreshActivity);

 const renderBeforeInbox=render;
 render=()=>{renderBeforeInbox();renderInbox()};
 window.saldoInbox={request,refresh,render:renderInbox};
 renderInbox();
})();
