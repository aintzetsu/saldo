import DescopeClient from '@descope/node-sdk';

const project = 'P3MNeHmHFobNYGhOyAwMzq1cbtKO';
const descope = DescopeClient({projectId: project});
const emptyLedger = JSON.stringify({accounts: [], entries: []});

export async function emailAuth({body, owner, action, res, fail, fetchDoc, put, privateBlob, hash, signIn}) {
 if(action === 'emailLink' && body.owner !== owner) return fail(409, 'The signed-in account changed. Reload Saldo.');
 const token = body.sessionToken;
 if(typeof token !== 'string' || token.length > 16384 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
  return fail(401, 'Email sign-in could not be verified.');
 }
 let userId;
 try {
  const session = await descope.validateSession(token);
  userId = session.token.sub;
 } catch {
  return fail(401, 'Email sign-in could not be verified. Start again.');
 }
 if(typeof userId !== 'string' || !userId) return fail(401, 'Email sign-in could not be verified.');
 const identity = hash(`saldo-descope:${project}:${userId}`);
 const linkPath = 'email-identities/' + identity;
 let link = await fetchDoc(linkPath);
 if(!link) {
  const assignedOwner = owner || identity;
  try {
   await put(linkPath, JSON.stringify({owner: assignedOwner}), {...privateBlob, allowOverwrite: false});
   link = {data: {owner: assignedOwner}};
  } catch(error) {
   link = await fetchDoc(linkPath);
   if(!link) throw error;
  }
 }
 const ledgerOwner = link.data.owner;
 if(owner) {
  if(ledgerOwner !== owner) return fail(409, 'This email is already linked to another Saldo account.');
  return res.json({ok: true});
 }
 const ledgerPath = 'ledgers/' + ledgerOwner;
 if(ledgerOwner === identity && !await fetchDoc(ledgerPath)) {
  try {
   await put(ledgerPath, emptyLedger, {...privateBlob, allowOverwrite: false});
  } catch(error) {
   if(!await fetchDoc(ledgerPath)) throw error;
  }
 }
 await signIn(res, ledgerOwner);
 return res.json({ok: true});
}
