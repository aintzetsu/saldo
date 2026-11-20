'use strict';
const element=id=>document.getElementById(id);
const gate=element('gate'),statusLine=element('authMsg');
async function accountRequest(body){
 const res=await fetch('/api/account',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}:{cache:'no-store'});
 const data=await res.json();
 if(!res.ok){const err=new Error(data.error||'Account request failed.');err.status=res.status;throw err}
 return data;
}
async function saveLedger(data){
 const {owner,version}=window.saldoAccount;
 const saved=await accountRequest({action:'save',owner,version,data});
 window.saldoAccount={owner,version:saved.version,data};
}
async function start(){
 try{
  window.saldoAccount=await accountRequest();
  for(const name of ['app','features','upgrades','account-experience','transaction-experience','planning-experience']){
   await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/'+name+'.js';script.onload=resolve;script.onerror=reject;document.head.append(script)});
  }
  gate.hidden=true;element('overview').hidden=false;element('logout').hidden=false;
 }catch(err){if(err.status!==401)statusLine.textContent=err.message||'Unable to load Saldo.'}
}
const channel=new BroadcastChannel('saldo-sign-in');channel.onmessage=()=>location.reload();
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
async function authenticate(action,key){
 const buttons=gate.querySelectorAll('button:enabled');buttons.forEach(b=>b.disabled=true);
 try{await accountRequest({action,key});channel.postMessage('changed');location.reload()}
 catch(e){statusLine.textContent=e.message;buttons.forEach(b=>b.disabled=false)}
}
element('loginForm').onsubmit=e=>{e.preventDefault();authenticate('login',element('accountKey').value.trim())};
element('register').onclick=()=>{
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 element('newKey').value=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 element('loginForm').hidden=true;element('enroll').hidden=false;statusLine.textContent='';
 element('newKey').focus();
};
element('copyKey').onclick=async()=>{try{await navigator.clipboard.writeText(element('newKey').value);statusLine.textContent='Key copied.'}catch{element('newKey').select();statusLine.textContent='Copy the selected key.'}};
element('cancelKey').onclick=()=>{element('newKey').value='';element('enroll').hidden=true;element('loginForm').hidden=false;statusLine.textContent='';element('register').focus()};
element('confirmKey').onclick=()=>authenticate('create',element('newKey').value);
element('logout').onclick=async()=>{try{await accountRequest({action:'logout'});channel.postMessage('changed');location.reload()}catch(e){alert(e.message)}};
start();

async function usePasskey(register){
 const feedback=register?element('toolStatus'):statusLine;
 const btn=element(register?'passRegister':'passLogin');
 btn.disabled=true;
 try{
  const lib=window.SimpleWebAuthnBrowser;
  if(!lib?.browserSupportsWebAuthn())throw Error('Passkeys are unavailable here. Use your account key.');
  const prefix=register?'register':'authenticate';
  const optionsJSON=await accountRequest({action:prefix+'Options'});
  const response=await lib[register?'startRegistration':'startAuthentication']({optionsJSON});
  await accountRequest({action:prefix+'Finish',response});
  if(register)feedback.textContent='Passkey added. Keep your account key for recovery.';
  else{channel.postMessage('changed');location.reload()}
 }catch(e){feedback.textContent=e.name==='NotAllowedError'?'Passkey request canceled or timed out.':e.message}
 finally{btn.disabled=false}
}
element('passLogin').onclick=()=>usePasskey(false);
element('passRegister').onclick=()=>usePasskey(true);


let descopeComponent;
function setupEmailFlow(prefix, linking) {
 const button=element(prefix+'Start');
 const container=element(prefix+'Flow');
 const feedback=linking?element('toolStatus'):statusLine;
 const back=linking?null:element('emailBack');
 const reset=()=>{
  container.replaceChildren();
  button.disabled=false;
  if(back){
   element('signinMethods').hidden=false;
   back.hidden=true;
  }
 };
 if(back)back.onclick=()=>{
  reset();
  feedback.textContent='';
  button.focus();
 };
 button.onclick=async()=>{
  button.disabled=true;
  feedback.textContent='Loading sign-in…';
  try{
   descopeComponent ??= new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='/assets/descope.js';
    script.onload=resolve;
    script.onerror=()=>{descopeComponent=undefined;script.remove();reject(Error('Could not load email sign-in. Try again.'))};
    document.head.append(script);
   });
   await descopeComponent;
   const flow=document.createElement('descope-wc');
   flow.setAttribute('project-id','P3MNeHmHFobNYGhOyAwMzq1cbtKO');
   flow.setAttribute('flow-id','sign-up-or-in');
   flow.addEventListener('ready',()=>{
    feedback.textContent='';
    if(back){
     const focusWasInOptions=element('signinMethods').contains(document.activeElement)||document.activeElement===document.body;
     element('signinMethods').hidden=true;
     back.hidden=false;
     if(focusWasInOptions)container.focus();
    }
   });
   flow.addEventListener('error',()=>{
    const started=back&&!back.hidden;
    if(!started)reset();
    feedback.textContent='Email sign-in could not finish. Try again.';
    if(back&&!started)button.focus();
   });
   flow.addEventListener('success',async event=>{
    try{
     const sessionToken=event.detail?.sessionJwt;
     if(!sessionToken)throw Error('Email sign-in returned no session. Try again.');
     await accountRequest({action:linking?'emailLink':'emailLogin',sessionToken,owner:linking?window.saldoAccount.owner:undefined});
     if(linking){
      container.replaceChildren();
      button.disabled=false;
      feedback.textContent='Email linked. You can use it to sign in to this ledger.';
     }else{
      channel.postMessage('changed');
      location.reload();
     }
    }catch(error){
     if(!back)reset();
     feedback.textContent=error.message;
    }
   });
   container.replaceChildren(flow);
  }catch(error){feedback.textContent=error.message;button.disabled=false}
 };
}
setupEmailFlow('email',false);
setupEmailFlow('linkEmail',true);
