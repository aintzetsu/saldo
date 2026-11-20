import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';

const MAX_LEDGER_BYTES = 2_000_000;
const MAX_PENDING = 250;
const MAX_PDF_ROWS = 150;
const HOUR = 3_600_000;
const DAY = HOUR * 24;
const captureKeyPattern = /^([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const emailOrPhoneSecret = /\b(?:otp|one[- ]time (?:password|pin|passcode)|verification code|security code|authentication code|never share (?:your |this )?(?:pin|code)|do not share (?:your |this )?(?:pin|code))\b/i;
const incompleteStatus = /\b(?:pending|scheduled|declined|failed|reversed|cancel(?:led|ed)|unsuccessful)\b/i;
const matchableDescription = /\b(?:cash[- ]?in|cash[- ]?out|transfer(?:red)?|sent|received|send money)\b/i;
const transferAlert = /\b(?:cash[- ]?in|cash[- ]?out|transfer(?:red)?|send money|instapay|pesonet)\b/i;
const digest = value => createHash('sha256').update(value).digest('hex');
const normalized = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const asText = (value, max) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const normalizedRef = value => {
 const result = asText(value,80).replace(/[^a-z0-9]/gi,'').toUpperCase();
 return result.length >= 6 ? result : '';
};
const datesBetween = (a,b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
const formatToday = now => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Manila'}).format(now);
const validDate = value => typeof value === 'string' && datePattern.test(value) &&
 Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const validAmount = value => Number.isSafeInteger(value) && value !== 0 && Math.abs(value) <= 1e13;
const conflict = error => error?.name === 'BlobPreconditionFailedError' || error?.constructor?.name === 'BlobPreconditionFailedError';
const activeAccount = (state,id) => typeof id === 'string' && state.accounts.some(account => account.id === id && !account.archived);

class InboxError extends Error {
 constructor(status,message) {
  super(message);
  this.status = status;
 }
}

function requireThat(condition,status,message) {
 if (!condition) throw new InboxError(status,message);
}

export function isInboxAction(action) {
 return ['inboxConfigure','inboxRevoke','inboxReview','inboxImport'].includes(action);
}

export function publicInboxLedger(state) {
 if (!state?.trackingInbox) return state;
 const {source,items} = state.trackingInbox;
 return {
  ...state,
  trackingInbox: {
   source: source ? {label:source.label, accountId:source.accountId, sender:source.sender, autoSave:source.autoSave} : null,
   items
  }
 };
}

export function protectInboxSave(incoming, savedState) {
 const {...state} = incoming;
 delete state.trackingInbox;
 if (savedState?.trackingInbox) state.trackingInbox = savedState.trackingInbox;
 return state;
}

function inboxFor(state) {
 state.trackingInbox ??= {source:null,items:[],events:[]};
 return state.trackingInbox;
}

function parseCurrency(value) {
 const clean = value.replaceAll(',','');
 if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null;
 const [whole,fraction = ''] = clean.split('.');
 const amount = Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
 return validAmount(amount) ? amount : null;
}

export function parseCaptureAlert(text) {
 const lines = text.normalize('NFKC').replace(/\r/g,'').split('\n');
 const usable = lines.filter(line => !/\b(?:balance|fee|reference|ref\.?\s*no)\b/i.test(line));
 const raw = '([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)(?![0-9.,])';
 const currency = 'PHP|₱';
 const labeled = new RegExp('(?:total amount|amount (?:sent|paid|received|debited|credited)|amount)\\s*[:=–-]?\\s*(?:' + currency + ')?\\s*' + raw, 'gi');
 const withCurrency = new RegExp('(?:' + currency + ')\\s*' + raw, 'gi');
 const values = expression => [...new Set(usable.flatMap(line => [...line.matchAll(expression)]
  .map(match => parseCurrency(match[1])).filter(value => value !== null)))];
 const labeledAmounts = values(labeled);
 const currencyAmounts = values(withCurrency);
 const amounts = [...new Set([...labeledAmounts,...currencyAmounts])];
 const incoming = /\b(?:received|credited|deposited|incoming)\b/i.test(text);
 const outgoing = /\b(?:sent|paid|debited|spent|purchase|withdraw(?:al|n)?)\b/i.test(text);
 const observedDate = [...new Set(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])];
 const date = observedDate.length === 1 && validDate(observedDate[0]) ? observedDate[0] : null;
 const reference = asText(text.match(/\b(?:reference(?:\s+(?:number|no\.?))?|ref\.?\s*(?:no\.?|#)?)\s*[:#=–-]?\s*([a-z0-9][a-z0-9-]{5,79})\b/i)?.[1],80);
 const merchant = text.match(/\b(?:merchant|paid to|sent to|received from|description)\s*[:=]?\s*([^\r\n]{1,100})/i)?.[1];
 const description = asText(merchant,100) || (incoming && !outgoing ? 'Incoming payment alert' : 'Transaction alert');
 const amount = amounts.length === 1 && incoming !== outgoing ? (incoming ? amounts[0] : -amounts[0]) : null;
 const unclear = incompleteStatus.test(text);
 const completed = /\b(?:paid|debited|credited|deposited|successful|completed|received|sent)\b/i.test(text);
 const possibleTransfer = transferAlert.test(text);
 return {
  description,date,amount,reference,
  reliable: !unclear && !possibleTransfer && completed && Boolean(merchant && date && amount && normalizedRef(reference)),
  reason: unclear ? 'The alert may describe an incomplete or reversed transaction.'
   : possibleTransfer ? 'The alert mentions a transfer. Confirm both sides before recording it.'
   : !date || amount === null ? 'Confirm the amount, direction, and date from your original alert.'
   : 'Review the details from your alert before saving.'
 };
}

function ruleCategory(state, description, amount) {
 if (amount >= 0 || !Array.isArray(state.trackingRules)) return 'Other';
 const clean = normalized(description);
 const rule = state.trackingRules
  .filter(item => typeof item?.category === 'string' && normalized(item?.match) && clean.includes(normalized(item.match)))
  .sort((a,b) => normalized(b.match).length - normalized(a.match).length)[0];
 return asText(rule?.category,60) || 'Other';
}

function matching(state,draft,items) {
 const result = {};
 if (!validAmount(draft.amount) || !validDate(draft.date)) return result;
 const sharedRef = item => {
  const reference = normalizedRef(draft.reference);
  return Boolean(reference && reference === normalizedRef(item.reference));
 };
 const samePosting = item => item.accountId === draft.accountId && item.amount === draft.amount;
 const near = item => datesBetween(item.date,draft.date) <= 2;
 const similar = item => normalized(item.description) === normalized(draft.description);
 const pending = items.filter(item => item.id !== draft.id && item.status === 'pending');
 const postings = [];
 for (const entry of state.entries) {
  if (entry.amount !== draft.amount && entry.amount !== -draft.amount &&
   !(entry.account === draft.accountId && sharedRef(entry))) continue;
  postings.push({...entry,accountId:entry.account,pending:false,transferReady:!entry.to&&!entry.link&&!entry.refundOf&&!entry.splits?.length&&!entry.subscriptionId});
  if (entry.to) postings.push({...entry,accountId:entry.to,amount:-entry.amount,pending:false,transferReady:false});
 }
 for (const item of pending) postings.push({...item,pending:true,transferReady:!item.possibleDuplicate&&!item.duplicateOf});

 const duplicateExact = postings.filter(item => samePosting(item) && near(item) && sharedRef(item));
 if (duplicateExact.length) return {exactDuplicate:true,duplicateOf:duplicateExact[0].id,duplicatePending:duplicateExact[0].pending};

 const duplicate = postings.filter(item => item.accountId === draft.accountId && near(item) &&
  (sharedRef(item) || (samePosting(item) && item.date === draft.date && similar(item))));
 if (duplicate.length) return {
  possibleDuplicate:true,
  ...(duplicate.length === 1 ? {duplicateOf:duplicate[0].id,duplicatePending:duplicate[0].pending} : {})
 };

 const opposite = postings.filter(item => item.accountId !== draft.accountId && item.amount === -draft.amount && near(item) && item.transferReady);
 const strong = opposite.filter(sharedRef);
 const possible = strong.length ? strong : opposite.filter(item => !normalizedRef(draft.reference) || !normalizedRef(item.reference) ||
  matchableDescription.test(item.description) || matchableDescription.test(draft.description));
 if (possible.length) Object.assign(result,{
  possibleTransfer:true,
  ...(possible.length === 1 ? {transferOf:possible[0].id,transferPending:possible[0].pending} : {})
 });
 return result;
}

function annotate(state,draft,items) {
 for (const field of ['exactDuplicate','possibleDuplicate','duplicateOf','duplicatePending','possibleTransfer','transferOf','transferPending']) delete draft[field];
 const match = matching(state,draft,items);
 Object.assign(draft,match);
 draft.reason = match.exactDuplicate || match.possibleDuplicate ? 'A similar transaction is already in your ledger or Inbox.'
  : match.possibleTransfer ? 'An opposite payment on another account may be the other side of a transfer.'
  : draft.baseReason;
 return match;
}

function newDraft(state,row,source,now) {
 return {
  id:randomUUID(), status:'pending', source, receivedAt:new Date(now).toISOString(),
  accountId:row.accountId, amount:row.amount, date:row.date, description:row.description,
  reference:row.reference, category:row.category || ruleCategory(state,row.description,row.amount),
  reason:row.reason, baseReason:row.reason
 };
}

function addEntry(state,draft,link) {
 const entry = {
  id:randomUUID(), captureId:draft.id, source:draft.source,
  account:draft.accountId, amount:draft.amount, date:draft.date, description:draft.description,
  category:link ? 'Transfer' : draft.category, reference:draft.reference
 };
 if (link) entry.link = link;
 state.entries.unshift(entry);
 draft.status = link ? 'matched' : 'saved';
 draft.entryId = entry.id;
 return entry;
}

function matchDraft(state,inbox,draft,match) {
 if (match.duplicateOf) {
  draft.status = 'matched';
  draft.reason = 'Linked to an existing transaction or draft.';
  return;
 }
 requireThat(match.transferOf,409,'The matching transaction changed. Refresh the Inbox and review again.');
 if (!match.transferPending) {
  const other = state.entries.find(entry => entry.id === match.transferOf);
  requireThat(other && !other.link,409,'The matching transaction changed. Refresh the Inbox and review again.');
  const entry = addEntry(state,draft,other.id);
  other.link = entry.id;
 } else {
  const other = inbox.items.find(item => item.status === 'pending' && item.id === match.transferOf);
  requireThat(other && activeAccount(state,other.accountId),409,'The other transfer account is no longer active.');
  const otherEntry = addEntry(state,other,draft.id);
  const entry = addEntry(state,draft,otherEntry.id);
  otherEntry.link = entry.id;
  other.reason = 'Matched as a transfer and excluded from spending.';
 }
 draft.reason = 'Matched as a transfer and excluded from spending.';
}

function compact(inbox,now) {
 const retained = inbox.items.filter(item => item.status !== 'pending').slice(0,60);
 const keep = new Set(retained.map(item => item.id));
 inbox.items = inbox.items.filter(item => item.status === 'pending' || keep.has(item.id));
 inbox.events = inbox.events.filter(event => event.at > now - DAY);
}

async function savePath(path,doc,state,put,privateBlob) {
 const content = JSON.stringify(state);
 requireThat(Buffer.byteLength(content) <= MAX_LEDGER_BYTES,413,'The ledger exceeds 2 MB. Clear reviewed drafts or export a backup.');
 return (await put(path,content,{...privateBlob,allowOverwrite:true,ifMatch:doc.version})).etag;
}

function reviewDraft(state,inbox,body) {
 const item = inbox.items.find(draft => draft.id === body.id && draft.status === 'pending');
 requireThat(item,409,'This draft was already reviewed. Reload the Inbox.');
 requireThat(['save','dismiss','match'].includes(body.decision),400,'Choose a review action.');
 if (body.decision === 'dismiss') {
  item.status = 'dismissed';
  return;
 }
 const draft = {
  ...item,
  accountId:body.accountId ?? item.accountId,
  amount:body.amount ?? item.amount,
  date:body.date ?? item.date,
  description:asText(body.description ?? item.description,140),
  reference:asText(body.reference ?? item.reference,80),
  category:asText(body.category ?? item.category,60) || 'Other'
 };
 requireThat(activeAccount(state,draft.accountId) && validAmount(draft.amount) && validDate(draft.date) &&
  draft.description,400,'Enter a valid account, signed amount, date, and description.');
 const match = annotate(state,draft,inbox.items);
 if (body.decision === 'match') matchDraft(state,inbox,draft,match);
 else {
  requireThat(body.allowPossibleDuplicate === true || !(match.exactDuplicate || match.possibleDuplicate || match.possibleTransfer),
   409,'This may duplicate another transaction or be a transfer. Match it or confirm that it should be saved separately.');
  addEntry(state,draft);
  draft.reason = 'Saved after review.';
 }
 for (const field of ['exactDuplicate','possibleDuplicate','duplicateOf','duplicatePending','possibleTransfer','transferOf','transferPending']) delete item[field];
 Object.assign(item,draft);
}

function importRows(state,inbox,body,now) {
 requireThat(activeAccount(state,body.accountId),400,'Choose an active account for the statement.');
 requireThat(Array.isArray(body.rows) && body.rows.length > 0 && body.rows.length <= MAX_PDF_ROWS,
  400,'Stage between 1 and 150 statement rows at a time.');
 const rows = body.rows.map(row => {
  requireThat(validAmount(row?.amount) && validDate(row?.date) && asText(row?.description,140),
   400,'Each statement row needs a date, signed amount, and description.');
  return {
   accountId:body.accountId, date:row.date, amount:row.amount, reference:asText(row.reference,80),
   description:asText(row.description,140), category:asText(row.category,60), reason:'Imported from a GCash statement. Confirm before saving.'
  };
 });
 let staged = 0, skipped = 0;
 const pendingCount = inbox.items.filter(item => item.status === 'pending').length;
 for (const row of rows) {
  const item = newDraft(state,row,'gcash-pdf',now);
  const match = annotate(state,item,inbox.items);
  if (match.exactDuplicate) { skipped++; continue; }
  requireThat(pendingCount + staged < MAX_PENDING,429,'Review some drafts before importing more transactions.');
  inbox.items.unshift(item);
  staged++;
 }
 return {staged,skipped};
}

export async function manageInbox({req,res,owner,fetchDoc,put,privateBlob,fail}) {
 try {
  const body = req.body;
  const path = 'ledgers/' + owner;
  const doc = await fetchDoc(path);
  requireThat(doc,404,'Your ledger could not be found.');
  const action = body.action;
  if (action === 'inboxImport' || action === 'inboxReview' || body.version != null) {
   requireThat(body.version === doc.version,409,'The Inbox or ledger changed. Reload it before continuing.');
  }
  const state = doc.data;
  const inbox = inboxFor(state);
  const now = Date.now();
  let captureKey, summary;
  if (action === 'inboxConfigure') {
   const label = asText(body.label,80);
   const sender = asText(body.sender,100);
   const autoSave = body.autoSave === true;
   requireThat(label && activeAccount(state,body.accountId) && (!autoSave || sender),400,
    'Choose an active account and give the source a name. Auto-save also needs an exact sender.');
   const rotate = !inbox.source || body.rotate === true || inbox.source.accountId !== body.accountId;
   if (rotate) captureKey = owner + '.' + randomBytes(32).toString('base64url');
   inbox.source = {keyHash:rotate ? digest(captureKey) : inbox.source.keyHash, label, sender, accountId:body.accountId, autoSave};
  }
  if (action === 'inboxRevoke') inbox.source = null;
  if (action === 'inboxImport') summary = importRows(state,inbox,body,now);
  if (action === 'inboxReview') reviewDraft(state,inbox,body);
  if (action === 'inboxReview' || action === 'inboxImport') {
   for (const item of inbox.items) if (item.status === 'pending') annotate(state,item,inbox.items);
  }
  compact(inbox,now);
  const version = await savePath(path,doc,state,put,privateBlob);
  return res.json({data:publicInboxLedger(state),version,owner,...(captureKey ? {captureKey} : {}),...(summary ? {summary} : {})});
 } catch (error) {
  if (error instanceof InboxError) return fail(error.status,error.message);
  throw error;
 }
}

export async function captureInbox({req,res,fetchDoc,put,privateBlob,fail}) {
 try {
  const body = req.body;
  const type = req.headers['content-type'];
  requireThat(req.method === 'POST' && typeof type === 'string' && /^application\/json(?:\s*;|$)/i.test(type),400,
   'Use a JSON POST to capture an alert.');
  const bearer = typeof req.headers.authorization === 'string' && req.headers.authorization.match(/^Bearer (.+)$/i);
  const key = bearer && captureKeyPattern.exec(bearer[1]);
  requireThat(key,401,'Enter a valid Saldo capture key.');
  requireThat(typeof body?.text === 'string' && body.text.trim() && Buffer.byteLength(body.text) <= 4_000,400,'Send a payment alert under 4 KB.');
  requireThat(!emailOrPhoneSecret.test(body.text),400,'Passcodes and verification messages cannot be captured.');
  const sender = asText(body.sender,100);
  const received = Date.now();
  const parsed = parseCaptureAlert(body.text);
  const eventHash = digest(normalized(body.text));
  const actualHash = Buffer.from(digest(bearer[1]),'hex');
  const path = 'ledgers/' + key[1];
  for (let attempt = 0; attempt < 3; attempt++) {
   const doc = await fetchDoc(path);
   const state = doc?.data;
   const inbox = state?.trackingInbox;
   const source = inbox?.source;
   const storedHash = source?.keyHash;
   requireThat(typeof storedHash === 'string' && /^[a-f0-9]{64}$/.test(storedHash) &&
    timingSafeEqual(actualHash,Buffer.from(storedHash,'hex')),401,'Enter a valid Saldo capture key.');
   requireThat(activeAccount(state,source.accountId),409,'The capture source needs an active account.');
   compact(inbox,received);
   if (inbox.events.some(event => event.hash === eventHash)) return res.json({status:'duplicate'});
   requireThat(inbox.events.length < 200 && inbox.events.filter(event => event.at > received - HOUR).length < 40,
    429,'Capture limit reached. Try again later.');
   const draft = newDraft(state,{...parsed,accountId:source.accountId},'iphone-alert',received);
   const match = annotate(state,draft,inbox.items);
   const today = formatToday(received);
   const trusted = source.autoSave === true && normalized(source.sender) && normalized(sender) === normalized(source.sender);
   const autoSave = trusted && parsed.reliable && parsed.date <= today && datesBetween(parsed.date,today) <= 7 &&
    !match.exactDuplicate && !match.possibleDuplicate && !match.possibleTransfer;
   let status = 'duplicate';
   if (!match.exactDuplicate) {
    if (autoSave) {
     addEntry(state,draft);
     draft.reason = 'Automatically saved from your trusted capture source.';
    } else {
     requireThat(inbox.items.filter(item => item.status === 'pending').length < MAX_PENDING,
      429,'Review some Inbox drafts before capturing more alerts.');
    }
    inbox.items.unshift(draft);
    if (draft.status === 'pending') for (const item of inbox.items) if (item.status === 'pending') annotate(state,item,inbox.items);
    status = draft.status;
   }
   inbox.events.push({hash:eventHash,at:received});
   compact(inbox,received);
   try {
    await savePath(path,doc,state,put,privateBlob);
    return res.json({status});
   } catch (error) {
    if (!conflict(error) || attempt === 2) throw error;
   }
  }
 } catch (error) {
  if (error instanceof InboxError) return fail(error.status,error.message);
  throw error;
 }
}
