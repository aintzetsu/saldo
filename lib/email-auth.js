const project = 'P3MNeHmHFobNYGhOyAwMzq1cbtKO';
const emptyLedger = JSON.stringify({accounts: [], entries: []});

export async function emailAuth({body, owner, action, res, fail, fetchDoc, put, privateBlob, hash, signIn}) {
 const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
 if(email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  return fail(400, 'Enter a valid email address.');
 }
 if(action === 'emailLink' && body.owner !== owner) return fail(409, 'The signed-in account changed. Reload Saldo.');

 const sending = action === 'emailSend';
 if(!sending && (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code))) {
  return fail(400, 'Enter the six-digit code.');
 }
 const response = await fetch(`https://api.descope.com/v1/auth/otp/${sending ? 'signup-in' : 'verify'}/email`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json', Authorization: `Bearer ${project}`},
  body: JSON.stringify(sending ? {loginId: email} : {loginId: email, code: body.code}),
  signal: AbortSignal.timeout(8000)
 });
 if(response.status === 429) return fail(429, 'Too many attempts. Wait before trying again.');
 if(response.status >= 500) return fail(503, 'Email sign-in is temporarily unavailable.');
 if(!response.ok) return sending
  ? fail(502, 'Could not send a code. Check the address and try again.')
  : fail(401, 'The code was invalid or expired.');
 if(sending) return res.json({ok: true});

 const {user} = await response.json();
 if(!user?.userId || user.verifiedEmail !== true || user.email?.toLowerCase() !== email) {
  return fail(401, 'Email verification could not be confirmed.');
 }
 const identity = hash(`saldo-descope:${project}:${user.userId}`);
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
