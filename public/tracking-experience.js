'use strict';

(() => {
 const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
 const limit=50;

 function buildSuggester(state){
  const rules=[...(state.trackingRules||[])].sort((a,b)=>b.match.length-a.match.length);
  const history=new Map();
  for(const entry of state.entries){
   if(entry.amount>=0||entry.to||entry.link||entry.refundOf||entry.splits?.length||entry.subscriptionId)continue;
   const description=normalize(entry.description);
   const category=entry.category?.trim();
   if(!description||!category||category.length>60||normalize(category)==='other')continue;
   const observation=history.get(description)||{category,count:0,conflict:false};
   observation.count++;
   if(normalize(observation.category)!==normalize(category))observation.conflict=true;
   history.set(description,observation);
  }
  return description=>{
   const value=normalize(description);
   if(!value)return null;
   const rule=rules.find(item=>value.includes(normalize(item.match)));
   if(rule)return {category:rule.category,source:'rule'};
   const observation=history.get(value);
   return observation?.count>=2&&!observation.conflict?{category:observation.category,source:'history'}:null;
  };
 }

 function watchDraft(description,category,eligible=()=>true,kind=null){
  const baseline=category.value;
  let changedByUser=false;
  let suggestionText;
  category.addEventListener('input',()=>{
   changedByUser=true;
   if(suggestionText)suggestionText.textContent='';
  });
  const suggest=buildSuggester(db);
  const updateCategory=()=>{
   if(changedByUser||!eligible())return;
   const match=suggest(description.value);
   category.value=match?.category||baseline;
   if(!match&&!suggestionText)return;
   if(!suggestionText){
    suggestionText=document.createElement('small');
    suggestionText.className='card-note';
    suggestionText.setAttribute('role','status');
    category.closest('label').append(suggestionText);
   }
   suggestionText.textContent=match?(match.source==='rule'?'Filled by a category rule.':'Suggested from your ledger.'):'';
  };
  description.addEventListener('input',updateCategory);
  kind?.addEventListener('change',updateCategory);
 }

 function validRules(rules){
  if(rules===undefined)return true;
  if(!Array.isArray(rules)||rules.length>limit)return false;
  const keys=new Set();
  return rules.every(rule=>{
   if(!rule||typeof rule.match!=='string'||typeof rule.category!=='string'||!normalize(rule.match)||
    !rule.category.trim()||rule.match.length>100||rule.category.length>60||keys.has(normalize(rule.match)))return false;
   keys.add(normalize(rule.match));
   return true;
  });
 }

 function mergeRules(target,source){
  if(!source.trackingRules?.length)return;
  const rules=new Map((target.trackingRules||[]).map(rule=>[normalize(rule.match),rule]));
  for(const rule of source.trackingRules){
   const key=normalize(rule.match);
   if(!rules.has(key)&&rules.size<limit)rules.set(key,rule);
  }
  target.trackingRules=[...rules.values()];
 }

 function editRule(index){
  const rule=db.trackingRules?.[index];
  popup(rule?'Edit category rule':'Add category rule',
   label('Description contains',input('trackingMatch','maxlength="100" placeholder="e.g. GrabFood"'))+
   label('Set category to',input('trackingCategory','maxlength="60" placeholder="e.g. Dining"'))+
   (rule?'<label class="check-control"><input type="checkbox" id="removeTrackingRule">Remove this rule</label>':''),
   state=>{
    const list=[...(state.trackingRules||[])];
    const old=rule?list.findIndex(item=>normalize(item.match)===normalize(rule.match)):-1;
    if(rule&&old<0)throw Error('This rule was changed. Open it again.');
    if(old>=0)list.splice(old,1);
    if(!$('removeTrackingRule')?.checked){
     list.push({match:$('trackingMatch').value.trim(),category:$('trackingCategory').value.trim()});
     if(!validRules(list))throw Error('Enter a unique description and category. Saldo supports up to 50 rules.');
    }
    state.trackingRules=list;
   });
  $('trackingMatch').value=rule?.match||'';
  $('trackingCategory').value=rule?.category||'';
 }

 function renderRules(){
  $('trackingRules').innerHTML=(db.trackingRules||[]).map((rule,index)=>
   '<div class="row"><span>'+escapeText(rule.match)+'<em>'+escapeText(rule.category)+'</em></span>'+
   '<button type="button" class="light" data-tracking-rule="'+index+'">Edit</button></div>').join('')||
   hint('Add a rule for a merchant or description you see often.');
 }

 function draftFromText(text){
  const parsed=receiptDraft(text);
  // Only use a labeled amount or an amount prefixed by a currency symbol.
  const value='([0-9][0-9,]*(?:\\.\\d{1,2})?)';
  const labeled=new RegExp('(?:total amount|amount sent|amount paid|amount received|amount debited|amount credited|amount)\\s*[:=]?\\s*(?:PHP|₱)?\\s*'+value,'gi');
  const currency=new RegExp('(?:PHP|₱)\\s*'+value,'gi');
  const usable=text.split(/\r?\n/).filter(line=>!/balance|service fee|reference|ref\.? no/i.test(line));
  const labeledAmounts=usable.flatMap(line=>[...line.matchAll(labeled)].map(match=>match[1]));
  const currencyAmounts=usable.flatMap(line=>[...line.matchAll(currency)].map(match=>match[1]));
  const values=[...new Set(labeledAmounts.length?labeledAmounts:currencyAmounts)];
  const amount=values.length===1?values[0].replaceAll(',',''):'';
  const incoming=/\b(received|credited|deposited)\b/i.test(text);
  const outgoing=/\b(sent|paid|debited|purchase|spent)\b/i.test(text);
  return {...parsed,amount,kind:incoming&&!outgoing?'Income':'Expense'};
 }

 const pasteDialog=document.createElement('dialog');
 pasteDialog.setAttribute('aria-labelledby','pasteTitle');
 pasteDialog.innerHTML='<form><div class="heading"><h3 id="pasteTitle">Paste a transaction</h3><button type="button" class="light" aria-label="Close">×</button></div>'+
  '<p class="card-note">Paste a payment or deposit alert. Saldo fills the fields it recognizes for you to review.</p>'+
  '<label>Transaction text<textarea id="transactionAlert" rows="5" maxlength="5000" required></textarea></label><button>Review draft</button></form>';
 document.body.append(pasteDialog);
 pasteDialog.querySelector('button').onclick=()=>pasteDialog.close();
 $('pasteTransaction').onclick=()=>{
  if(needAccount())return;
  $('transactionAlert').value='';
  pasteDialog.showModal();
 };
 pasteDialog.querySelector('form').onsubmit=event=>{
  event.preventDefault();
  const draft=draftFromText($('transactionAlert').value);
  $('transactionAlert').value='';
  pasteDialog.close();
  openForm('entry');
  if(mode!=='entry')return;
  $('title').textContent='Review pasted transaction';
  $('kind').value=draft.kind;
  $('kind').dispatchEvent(new Event('change'));
  $('amount').value=draft.amount;
  $('date').value=draft.date||'';
  $('desc').value=draft.description;
  $('desc').dispatchEvent(new Event('input'));
  receiptFields(draft.reference);
  $('fields').insertAdjacentHTML('afterbegin',hint('Confirm the account, date, amount and transaction type before saving.'));
 };

 $('addTrackingRule').onclick=()=>editRule();
 $('trackingRules').onclick=event=>{
  const button=event.target.closest('[data-tracking-rule]');
  if(button)editRule(Number(button.dataset.trackingRule));
 };
 window.saldoTracking={buildSuggester,watchDraft,validRules,mergeRules};
 const renderBeforeTracking=render;
 render=()=>{renderBeforeTracking();renderRules()};
 renderRules();
})();
