'use strict';
const day=86400000;
const iso=d=>d.toISOString().slice(0,10);
function week(date){
 const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
 return [iso(d),iso(new Date(+d+6*day))];
}
function balance(state,id){
 return state.entries.reduce((sum,e)=>sum+(e.account===id?e.amount:0)-(e.to===id?e.amount:0),state.accounts.find(a=>a.id===id).opening);
}
function dueDates(s,month){
 const [y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate(),dates=[];
 for(let i=1;i<=last;i++){
  const date=month+'-'+String(i).padStart(2,'0');
  if(date<s.start)continue;
  const dueDay=Math.min(Number(s.start.slice(8)),last);
  if(s.freq==='Weekly'?(Date.parse(date)-Date.parse(s.start))%(7*day)===0:i===dueDay&&(s.freq==='Monthly'||month.slice(5)===s.start.slice(5,7)))dates.push(date);
 }
 return dates;
}
function candidates(state){
 const groups=new Map(),result=[],dismissed=new Set(state.dismissed);
 for(const e of state.entries){
  if(e.to||e.link)continue;
  const size=Math.abs(e.amount),group=groups.get(size)||[];
  for(const a of group){
   const days=Math.abs(Date.parse(e.date)-Date.parse(a.date))/day;
   const dup=e.account===a.account&&e.amount===a.amount&&days===0;
   const transfer=e.account!==a.account&&e.amount===-a.amount&&days<=2;
   const key=JSON.stringify([a.id,e.id].sort());
   if((dup||transfer)&&!dismissed.has(key))result.push({a,b:e,key,dup});
  }
  group.push(e);groups.set(size,group);
 }
 return result;
}
function resolvePair(state,key,action){
 const pair=candidates(state).find(p=>p.key===key);
 if(!pair)throw Error('This pair has already been reviewed.');
 const {a,b,dup}=pair;
 if(action==='dismiss'){state.dismissed.push(key);return}
 if(!dup&&action==='link'){a.link=b.id;b.link=a.id;return}
 if(dup&&['first','second'].includes(action)){
  const discard=action==='first'?b:a;if(discard.key)state.ignored.push(discard.key);
  state.entries=state.entries.filter(e=>e.id!==discard.id);return;
 }
 throw Error('Unknown review action.');
}
function weekly(state,date){
 const [start,end]=week(date),cats=new Map();let spent=0;
 for(const e of state.entries){
  if(e.date<start||e.date>end||e.amount>=0||e.to||e.link)continue;
  spent-=e.amount;cats.set(e.category,(cats.get(e.category)||0)-e.amount);
 }
 return {start,end,spent,top:[...cats].sort((a,b)=>b[1]-a[1])[0]};
}
async function update(fn){
 await navigator.locks.request(dbKey,async()=>{const next=read();fn(next);await saveLedger(next);db=next});render();
}
const extra=document.createElement('dialog');
extra.innerHTML='<form><div class="heading"><h3></h3><button type="button" class="light" aria-label="Close">×</button></div><section></section><p role="alert"></p><button>Save</button></form>';document.body.append(extra);
extra.querySelector('button').onclick=()=>extra.close();
function popup(title,fields,save){
 extra.querySelector('h3').textContent=title;extra.querySelector('section').innerHTML=fields;const error=extra.querySelector('p');error.textContent='';
 extra.querySelector('form').onsubmit=async ev=>{ev.preventDefault();const btn=extra.querySelector('button:last-child[type=submit]')||extra.querySelector('form>button');btn.disabled=true;
 try{await update(save);extra.close()}catch(e){error.textContent=e.message}finally{btn.disabled=false}};
 extra.showModal();
}
function accountOptions(){return db.accounts.map(a=>[a.id,a.name])}
function needAccount(){if(db.accounts.length)return false;openForm('account');$('error').textContent='Add your first account to get started.';return true}
function quickExpense(){
 if(needAccount())return;
 const accounts=accountOptions().sort((a,b)=>Number(/gcash/i.test(b[1]))-Number(/gcash/i.test(a[1])));
 popup('Quick expense',label('Amount (PHP)',input('qAmount','type="number" inputmode="decimal" min=".01" step=".01" autofocus'))+label('Account',select('qAccount',accounts))+label('Category',select('qCat',['Food','Transport','Groceries','Bills','Shopping','Other'].map(x=>[x,x])))+label('Note (optional)','<input id="qNote" maxlength="140">'),s=>{
 s.entries.unshift({id:crypto.randomUUID(),description:$('qNote').value.trim()||$('qCat').value,account:$('qAccount').value,category:$('qCat').value,date:today(),amount:-cents($('qAmount').value)});$('month').value=today().slice(0,7)
 });
}
function openSub(id){
 if(needAccount())return;
 const s=db.subs.find(x=>x.id===id);
 popup(s?'Edit subscription':'Add subscription',label('Name',input('sName','maxlength="80"'))+label('Amount (PHP)',input('sAmount','type="number" min=".01" step=".01"'))+label('Pay from',select('sAcct',accountOptions()))+label('First renewal',input('sDate','type="date"'))+label('Repeat',select('freq',['Monthly','Weekly','Yearly'].map(x=>[x,x])))+(s?label('Remove subscription','<input id="removeSub" type="checkbox">'):''),state=>{
 if(id&&$('removeSub').checked){state.subs=state.subs.filter(x=>x.id!==id);return}
 const name=$('sName').value.trim();if(!name)throw Error('Enter a subscription name.');
 const record={id:id||crypto.randomUUID(),name,amount:cents($('sAmount').value),account:$('sAcct').value,start:$('sDate').value,freq:$('freq').value};
 state.subs=state.subs.filter(x=>x.id!==record.id);state.subs.push(record)
 });
 $('sDate').value=s?.start||today();if(s){$('sName').value=s.name;$('sAmount').value=s.amount/100;$('sAcct').value=s.account;$('freq').value=s.freq}
}
function renderFeatures(){
 const name=id=>db.accounts.find(a=>a.id===id)?.name||'';
 const w=weekly(db,$('weekDate').value||today());
 $('weekly').innerHTML=row('Total spent',w.start+' to '+w.end,money(w.spent))+(w.top?row('Top category',w.top[0],money(w.top[1])):'')+(db.budget!=null?row('Budget remaining','Weekly budget '+money(db.budget),money(db.budget-w.spent)):'');
 $('checks').innerHTML=db.accounts.map(a=>{
 const c=db.checks[a.id];if(!c)return row(a.name,'First check due','Unchecked');
 const age=(Date.parse(today())-Date.parse(c.date))/day;
 return row(a.name,c.date+' · '+(age>=7?'Weekly check due':'Checked')+' · observed '+money(c.actual),c.actual===c.expected?'Matched':money(c.actual-c.expected)+' difference')
 }).join('')||hint('Add an account to compare its balance.');
 $('cashBtn').hidden=db.accounts.some(a=>a.type==='Cash');
 const month=$('calMonth').value||today().slice(0,7);
 const dues=db.subs.flatMap(s=>dueDates(s,month).map(date=>({s,date}))).sort((a,b)=>a.date.localeCompare(b.date));
 $('calendar').innerHTML=(dues.length?dues.map(({s,date})=>row(s.name,date+' · '+name(s.account),money(s.amount))).join(''):hint('No renewals scheduled for this month.'))+db.subs.map(s=>'<button class="light" data-sub="'+escapeText(s.id)+'">Edit '+escapeText(s.name)+'</button>').join('');
 const pairs=candidates(db);const detail=e=>escapeText(e.date+' · '+name(e.account)+' · '+e.description+' · '+money(e.amount));
 $('review').innerHTML=pairs.map(({a,b,key,dup})=>'<div class="reviewItem" data-pair="'+escapeText(key)+'"><h4>'+(dup?'Possible duplicate':'Possible transfer')+'</h4><p>1. '+detail(a)+'</p><p>2. '+detail(b)+'</p>'+(dup?'<button data-act="first">Keep first only</button><button data-act="second">Keep second only</button>':'<button data-act="link">Match transfer</button>')+'<button class="light" data-act="dismiss">Keep separate</button></div>').join('')||hint('No potential transfers or duplicates to review.');
}
$('weekDate').value=today();$('calMonth').value=today().slice(0,7);$('weekDate').onchange=$('calMonth').onchange=renderFeatures;
$('quick').onclick=quickExpense;
$('cashBtn').onclick=()=>{openForm('account');$('type').value='Cash';$('name').value='Cash wallet';$('opening').focus()};
$('budgetBtn').onclick=()=>popup('Weekly budget',label('Amount (PHP)',input('bAmount','type="number" min="0" step=".01" value="'+(db.budget==null?'':db.budget/100)+'"')),s=>{s.budget=cents($('bAmount').value)});
$('checkBtn').onclick=()=>{if(needAccount())return;popup('Check balance',label('Account',select('cAcct',accountOptions()))+label('Balance shown in app or cash counted (PHP)',input('actual','type="number" step=".01"'))+hint('Checking records the difference and leaves your ledger balance unchanged.'),s=>{const id=$('cAcct').value;s.checks[id]={date:today(),actual:cents($('actual').value),expected:balance(s,id)}})};
$('subBtn').onclick=()=>openSub();$('calendar').onclick=e=>{if(e.target.dataset.sub)openSub(e.target.dataset.sub)};
$('review').onclick=async e=>{const action=e.target.dataset.act;if(!action)return;try{await update(s=>resolvePair(s,e.target.closest('[data-pair]').dataset.pair,action))}catch(err){render();alert(err.message)}};
renderFeatures();if(new URLSearchParams(location.search).get('quick')==='expense')quickExpense();
