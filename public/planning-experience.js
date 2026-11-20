'use strict';

(() => {
 const heading = (title, actions = '') => '<div class="heading"><h2>' + title + '</h2>' + actions + '</div>';
 const button = (text, action, id = '') => '<button type="button" class="light" data-plan-action="' +
  action + '" data-plan-id="' + escapeText(id) + '">' + escapeText(text) + '</button>';
 const amountInput = (id, min = '.01') => input(id, 'type="number" inputmode="decimal" step=".01" min="' + min + '"');
 const dateInput = id => input(id, 'type="date"');
 const removeInput = '<label class="plan-remove"><input id="planRemove" type="checkbox">Remove this item</label>';
 const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
 const datePattern = /^\d{4}-\d{2}-\d{2}$/;
 const idPattern = /^[A-Za-z0-9-]{1,80}$/;
 const categoryIdentity = category => category.trim().toLowerCase();
 const budgetKey = budget => JSON.stringify([budget.month,categoryIdentity(budget.category)]);
 const renewalKey = (id, date) => JSON.stringify([id,date]);
 const addDays = (date, count) => iso(new Date(Date.parse(date) + count*day));
 const showDate = date => activityDate.format(new Date(date + 'T00:00:00Z'));
 const todayMonth = () => today().slice(0,7);
 const goodDate = date => typeof date === 'string' && datePattern.test(date) &&
  Number.isFinite(Date.parse(date)) && iso(new Date(date)) === date;
 const goodMonth = month => typeof month === 'string' && monthPattern.test(month) && goodDate(month + '-01');
 const goodText = (value, max) => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
 const goodMoney = (value, min) => Number.isSafeInteger(value) && value >= min && value <= 1e13;
 const goodId = value => typeof value === 'string' && idPattern.test(value);

 function monthSpan(start, end) {
  const months = [];
  const cursor = new Date(start.slice(0,7) + '-01T00:00:00Z');
  const endMonth = end.slice(0,7);
  while (iso(cursor).slice(0,7) <= endMonth) {
   months.push(iso(cursor).slice(0,7));
   cursor.setUTCMonth(cursor.getUTCMonth()+1);
  }
  return months;
 }

 function dueItems(state, start, end) {
  const recorded = new Set(state.entries.filter(entry => entry.subscriptionId && entry.renewalDate)
   .map(entry => renewalKey(entry.subscriptionId,entry.renewalDate)));
  const months = monthSpan(start,end);
  const renewals = state.subs.flatMap(sub => months.flatMap(month => dueDates(sub,month))
   .map(date => ({id:sub.id,name:sub.name,account:sub.account,date,amount:sub.amount,renewal:true,
    paid:recorded.has(renewalKey(sub.id,date))})));
  return [...renewals,...(state.plannedBills || [])]
   .filter(item => item.date >= start && item.date <= end && !item.paid)
   .sort((a,b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
 }

 function monthPace(month, now) {
  const cursor = new Date(month + '-01T00:00:00Z');
  cursor.setUTCMonth(cursor.getUTCMonth()+1,0);
  const days = cursor.getUTCDate();
  const currentMonth = now.slice(0,7);
  if (month < currentMonth) return {days,elapsed:days};
  if (month > currentMonth) return {days,elapsed:0};
  return {days,elapsed:Number(now.slice(8))};
 }

 function forecast(state, now, plan) {
  const accounts = state.accounts;
  const ids = new Set(accounts.map(account => account.id));
  let current = accounts.reduce((total,account) => total+account.opening,0);
  let scheduled = 0;
  for (const entry of state.entries) {
   const net = (ids.has(entry.account) ? entry.amount : 0) - (ids.has(entry.to) ? entry.amount : 0);
   if (entry.date <= now) current += net;
   else if (entry.date <= plan.date) scheduled += net;
  }
  const bills = dueItems(state,now,plan.date).reduce((total,item) => total+item.amount,0);
  return {current,scheduled,bills,projected:current+scheduled+plan.income-bills};
 }

 const host = document.createElement('section');
 host.id = 'planningTools';
 host.className = 'grid tools';
 host.dataset.view = 'planning';
 host.setAttribute('aria-label','Bills, payday, budgets, and goals');
 host.innerHTML =
  '<article>' + heading('Upcoming bills',button('Add bill','add-bill')) +
   '<p class="card-note">Unpaid bills and subscription renewals for the next 30 days.</p>' +
   '<div id="planningDue"></div><details id="planningManageBills"><summary>Manage one-time bills</summary><div id="planningBills"></div></details>' +
   '<p id="planningNotice" role="status"></p></article>' +
  '<article>' + heading('Balance through payday',button('Set payday','payday')) +
   '<div id="planningForecast"></div></article>' +
  '<article>' + heading('Monthly category budgets',button('Add budget','add-budget')) +
   label('Budget month',input('planningBudgetMonth','type="month"')) +
   '<p class="card-note" id="planningBudgetDays"></p><div id="planningBudgets"></div></article>' +
  '<article>' + heading('Savings goals',button('Add goal','add-goal')) +
   '<p class="card-note">Track your progress by entering the amount you’ve set aside.</p><div id="planningGoals"></div></article>';
 document.querySelector('#overview [data-view~="planning"]').before(host);
 $('planningBudgetMonth').value = todayMonth();

 function setPlanningVisibility() {
  host.hidden = $('overview').dataset.currentView !== 'planning';
 }

 const editableRow = (title, detail, value, text, action, id) =>
  row(title,detail,value).replace('</div>',button(text,action,id) + '</div>');

 function renderDue() {
  const start = today();
  const items = dueItems(db,start,addDays(start,30));
  const next = items[0];
  $('planningDue').innerHTML = (next ? items.slice(0,10).map((item,index) =>
   editableRow(item.name,(index === 0 ? 'Next up · ' : '') + showDate(item.date),money(item.amount),
    item.renewal ? 'Record renewal' : 'Edit bill',item.renewal ? 'record-renewal' : 'edit-bill',
    item.renewal ? renewalKey(item.id,item.date) : item.id)).join('') :
   hint('No unpaid bills or renewals in the next 30 days.')) +
   (items.length > 10 ? hint(String(items.length-10) + ' more due this period. See the calendar or manage one-time bills below.') : '');
  const bills = [...(db.plannedBills || [])].sort((a,b) => a.date.localeCompare(b.date));
  $('planningManageBills').hidden = !bills.length;
  $('planningBills').innerHTML = bills.map(bill =>
   editableRow(bill.name,showDate(bill.date)+(bill.paid ? ' · Paid' : ''),money(bill.amount),'Edit bill','edit-bill',bill.id)).join('');
 }

 function renderForecast() {
  const plan = db.paydayPlan, now = today();
  if (!plan || plan.date < now) {
   $('planningForecast').innerHTML = hint('Set your next payday and the income you still expect to receive.');
   return;
  }
  const {current,scheduled,bills,projected} = forecast(db,now,plan);
  $('planningForecast').innerHTML =
   row('Projected balance',showDate(plan.date),money(projected)) +
   row('Balance today','Recorded through today',money(current)) +
   (scheduled ? row('Future ledger entries','Already recorded through payday',money(scheduled)) : '') +
   row('Expected income','Still to receive',money(plan.income)) +
   row('Unpaid bills and renewals','Due through payday',money(bills)) +
   hint('This estimate uses recorded transactions and your plans. Mark any one-time bill you’ve already covered as paid.');
 }

 function renderBudgets() {
  const month = $('planningBudgetMonth').value || todayMonth();
  const {days,elapsed} = monthPace(month,today());
  const {categories} = summarizeMonth(db.entries,month);
  const spending = new Map();
  for (const [category,amount] of categories) {
   const key = categoryIdentity(category || 'Other');
   spending.set(key,(spending.get(key) || 0)+amount);
  }
  $('planningBudgetDays').textContent = elapsed + ' of ' + days + ' days elapsed';
  $('planningBudgets').innerHTML = (db.categoryBudgets || []).filter(budget => budget.month === month).map(budget => {
   const spent = spending.get(categoryIdentity(budget.category)) || 0;
   const left = budget.limit-spent;
   const pace = Math.round(budget.limit*elapsed/days);
   const paceNote = spent > pace ? money(spent-pace) + ' ahead of budget pace' : money(pace-spent) + ' within budget pace';
   return '<div class="planning-meter" aria-label="' + escapeText(budget.category) + '">' +
    editableRow(budget.category,money(spent)+' spent of '+money(budget.limit),
     money(Math.abs(left))+(left < 0 ? ' over budget' : ' left'),'Edit','edit-budget',budget.category) +
    '<progress max="' + budget.limit + '" value="' + Math.max(0,Math.min(spent,budget.limit)) +
    '" aria-label="' + escapeText(budget.category+' budget used') + '"></progress><p class="card-note">' + escapeText(paceNote) + '</p></div>';
  }).join('') || hint('Add a category budget to compare this month’s spending with your limit.');
 }

 function renderGoals() {
  $('planningGoals').innerHTML = (db.savingsGoals || []).map(goal =>
   '<div class="planning-meter" aria-label="' + escapeText(goal.name) + '">' +
   editableRow(goal.name,money(goal.saved)+' saved'+(goal.due ? ' · Target date '+showDate(goal.due) : ''),
    money(goal.target),'Edit','edit-goal',goal.id) +
   '<progress max="' + goal.target + '" value="' + Math.min(goal.saved,goal.target) + '" aria-label="' +
   escapeText(goal.name+' savings progress') + '"></progress></div>').join('') ||
   hint('Set a target for your next savings goal.');
 }

 function renderRenewals() {
  const month = $('calMonth').value || todayMonth();
  const names = new Map(db.accounts.map(account => [account.id,account.name]));
  const paid = new Set(db.entries.filter(entry => entry.subscriptionId && entry.renewalDate)
   .map(entry => renewalKey(entry.subscriptionId,entry.renewalDate)));
  const dues = db.subs.flatMap(sub => dueDates(sub,month).map(date => ({sub,date})))
   .sort((a,b) => a.date.localeCompare(b.date));
  const results = dues.map(({sub,date}) => {
   const key = renewalKey(sub.id,date);
   const detail = showDate(date)+' · '+(names.get(sub.account) || 'Missing account');
   return paid.has(key) ? row(sub.name,detail+' · Recorded',money(sub.amount)) :
    editableRow(sub.name,detail,money(sub.amount),'Record renewal','record-renewal',key);
  }).join('');
  $('calendar').innerHTML = (results || hint('No renewals scheduled for this month.')) + db.subs
   .map(sub => '<button class="light" data-sub="' + escapeText(sub.id) + '">Edit ' + escapeText(sub.name) + '</button>').join('');
 }

 function renderPlanning() {
  renderDue();
  renderForecast();
  renderBudgets();
  renderGoals();
  renderRenewals();
 }

 function editBill(id) {
  const bill = (db.plannedBills || []).find(item => item.id === id);
  popup(bill ? 'Edit one-time bill' : 'Add one-time bill',
   label('Bill name',input('planBillName','maxlength="80"')) +
   label('Due date',dateInput('planBillDate')) +
   label('Amount (PHP)',amountInput('planBillAmount')) +
   (bill ? '<label><input id="planBillPaid" type="checkbox">Already paid</label>'+removeInput : ''), state => {
    state.plannedBills ??= [];
    if (bill && $('planRemove').checked) {
     state.plannedBills = state.plannedBills.filter(item => item.id !== id);
     return;
    }
    const name = $('planBillName').value.trim(), date = $('planBillDate').value;
    const amount = cents($('planBillAmount').value);
    if (!goodText(name,80) || !goodDate(date) || !goodMoney(amount,1)) throw Error('Enter a bill name, date, and positive amount.');
    const record = {id:bill?.id || crypto.randomUUID(),name,date,amount,paid:Boolean($('planBillPaid')?.checked)};
    state.plannedBills = state.plannedBills.filter(item => item.id !== record.id);
    state.plannedBills.push(record);
   });
  $('planBillName').value = bill?.name || '';
  $('planBillDate').value = bill?.date || today();
  if (bill) {
   $('planBillAmount').value = bill.amount/100;
   $('planBillPaid').checked = Boolean(bill.paid);
  }
 }

 function editPayday() {
  const plan = db.paydayPlan;
  popup('Set your next payday',label('Payday',dateInput('planPayday')) +
   label('Income still expected (PHP)',amountInput('planPaydayIncome','0')) +
   hint('Include income that you haven’t recorded in your ledger yet. The forecast includes unpaid bills up to 366 days ahead.'),
  state => {
   const now = today(), date = $('planPayday').value, income = cents($('planPaydayIncome').value);
   if (!goodDate(date) || date < now || date > addDays(now,366) || !goodMoney(income,0)) {
    throw Error('Choose a payday within the next 366 days and a nonnegative income amount.');
   }
   state.paydayPlan = {date,income};
  });
  const now = today();
  $('planPayday').value = plan?.date >= now ? plan.date : now;
  $('planPayday').min = now;
  $('planPayday').max = addDays(now,366);
  $('planPaydayIncome').value = plan ? plan.income/100 : '';
 }

 function editBudget(category) {
  const month = $('planningBudgetMonth').value || todayMonth();
  const record = (db.categoryBudgets || []).find(budget => budget.month === month && budget.category === category);
  const suggested = [...new Set([...summarizeMonth(db.entries,month).categories.keys(),'Food','Transport','Groceries','Bills','Shopping','Other'])];
  popup(record ? 'Edit category budget' : 'Add category budget',
   label('Category',input('planCategory','maxlength="60" list="planCategories"') +
    '<datalist id="planCategories">' + options(suggested.filter(Boolean).map(item => [item,item])) + '</datalist>') +
   label('Monthly limit (PHP)',amountInput('planBudgetLimit')) + (record ? removeInput : ''),state => {
    state.categoryBudgets ??= [];
    const oldKey = record ? budgetKey(record) : null;
    if (record && $('planRemove').checked) {
     state.categoryBudgets = state.categoryBudgets.filter(budget => budgetKey(budget) !== oldKey);
     return;
    }
    const item = {month,category:$('planCategory').value.trim(),limit:cents($('planBudgetLimit').value)};
    if (!goodMonth(month) || !goodText(item.category,60) || !goodMoney(item.limit,1)) throw Error('Enter a category and a positive budget limit.');
    const key = budgetKey(item);
    if (key !== oldKey && state.categoryBudgets.some(budget => budgetKey(budget) === key)) {
     throw Error('This category already has a budget for the selected month.');
    }
    state.categoryBudgets = state.categoryBudgets.filter(budget => budgetKey(budget) !== oldKey);
    state.categoryBudgets.push(item);
   });
  if (record) {
   $('planCategory').value = record.category;
   $('planBudgetLimit').value = record.limit/100;
  }
 }

 function editGoal(id) {
  const goal = (db.savingsGoals || []).find(item => item.id === id);
  popup(goal ? 'Edit savings goal' : 'Add savings goal',label('Goal name',input('planGoalName','maxlength="80"')) +
   label('Target (PHP)',amountInput('planGoalTarget')) +
   label('Already saved (PHP)',amountInput('planGoalSaved','0')) +
   label('Target date (optional)','<input type="date" id="planGoalDue">') + (goal ? removeInput : ''),state => {
    state.savingsGoals ??= [];
    if (goal && $('planRemove').checked) {
     state.savingsGoals = state.savingsGoals.filter(item => item.id !== id);
     return;
    }
    const name = $('planGoalName').value.trim(), due = $('planGoalDue').value;
    const target = cents($('planGoalTarget').value), saved = cents($('planGoalSaved').value);
    if (!goodText(name,80) || !goodMoney(target,1) || !goodMoney(saved,0) || (due && !goodDate(due))) {
     throw Error('Enter a goal name, a positive target, and a valid amount saved.');
    }
    const record = {id:goal?.id || crypto.randomUUID(),name,target,saved,due};
    state.savingsGoals = state.savingsGoals.filter(item => item.id !== record.id);
    state.savingsGoals.push(record);
   });
  $('planGoalSaved').value = (goal?.saved || 0)/100;
  if (goal) {
   $('planGoalName').value = goal.name;
   $('planGoalTarget').value = goal.target/100;
   $('planGoalDue').value = goal.due || '';
  }
 }

 async function recordRenewal(control) {
  const [id,date] = JSON.parse(control.dataset.planId);
  const notice = $('planningNotice');
  control.disabled = true;
  notice.textContent = '';
  try {
   await update(state => {
    const sub = state.subs.find(item => item.id === id);
    if (!sub || !dueDates(sub,date.slice(0,7)).includes(date)) throw Error('This renewal is no longer scheduled.');
    if (!state.accounts.some(account => account.id === sub.account && !account.archived)) {
     throw Error('Edit this subscription to select an active payment account.');
    }
    if (state.entries.some(entry => entry.subscriptionId === id && entry.renewalDate === date)) {
     throw Error('This renewal has already been recorded.');
    }
    state.entries.unshift({id:crypto.randomUUID(),description:sub.name,date:today(),account:sub.account,
     amount:-sub.amount,category:'Subscriptions',subscriptionId:id,renewalDate:date});
   });
   notice.textContent = 'Renewal recorded as an expense dated today.';
  } catch (error) {
   notice.textContent = error.message;
  } finally {
   control.disabled = false;
  }
 }

 const actions = {
  'add-bill': () => editBill(),
  'edit-bill': control => editBill(control.dataset.planId),
  'payday': editPayday,
  'add-budget': () => editBudget(),
  'edit-budget': control => editBudget(control.dataset.planId),
  'add-goal': () => editGoal(),
  'edit-goal': control => editGoal(control.dataset.planId),
  'record-renewal': recordRenewal
 };
 function dispatch(event) {
  const control = event.target.closest('[data-plan-action]');
  if (control) actions[control.dataset.planAction]?.(control);
 }

 function validList(list, isValid, key) {
  if (list === undefined) return true;
  return Array.isArray(list) && list.every(isValid) && new Set(list.map(key)).size === list.length;
 }

 function validatePlanningBackup(state) {
  const plan = state.paydayPlan;
  const linked = state.entries.filter(entry => entry.subscriptionId !== undefined || entry.renewalDate !== undefined);
  return validList(state.categoryBudgets,item => Boolean(item) && goodMonth(item.month) &&
    goodText(item.category,60) && goodMoney(item.limit,1),budgetKey) &&
   validList(state.savingsGoals,item => Boolean(item) && goodId(item.id) &&
    goodText(item.name,80) && goodMoney(item.target,1) && goodMoney(item.saved,0) &&
    (item.due === '' || goodDate(item.due)),item => item.id) &&
   validList(state.plannedBills,item => Boolean(item) && goodId(item.id) &&
    goodText(item.name,80) && goodDate(item.date) && goodMoney(item.amount,1) &&
    typeof item.paid === 'boolean',item => item.id) &&
   validList(linked,entry => goodId(entry.subscriptionId) && goodDate(entry.renewalDate),
    entry => renewalKey(entry.subscriptionId,entry.renewalDate)) &&
   (plan === undefined || Boolean(plan) && goodDate(plan.date) && goodMoney(plan.income,0));
 }

 function mergePlanningBackup(target, source) {
  for (const [field,key] of [['categoryBudgets',budgetKey],['savingsGoals',item => item.id],['plannedBills',item => item.id]]) {
   if (!source[field]?.length) continue;
   target[field] ??= [];
   const existing = new Set(target[field].map(key));
   target[field].push(...source[field].filter(item => !existing.has(key(item))));
  }
  if (source.paydayPlan && !target.paydayPlan) target.paydayPlan = source.paydayPlan;
 }

 window.saldoPlanningTools = {validateBackup:validatePlanningBackup,mergeBackup:mergePlanningBackup};
 host.addEventListener('click',dispatch);
 $('calendar').addEventListener('click',dispatch);
 $('planningBudgetMonth').onchange = () => {
  if (!$('planningBudgetMonth').value) $('planningBudgetMonth').value = todayMonth();
  renderBudgets();
 };
 const renderExisting = renderFeatures;
 renderFeatures = () => {
  renderExisting();
  renderPlanning();
 };
 $('calMonth').onchange = renderFeatures;
 window.addEventListener('hashchange',setPlanningVisibility);
 setPlanningVisibility();
 renderPlanning();
})();
