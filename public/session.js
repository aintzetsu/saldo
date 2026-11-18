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
  for(const name of ['app','features','upgrades']){
   await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/'+name+'.js';script.onload=resolve;script.onerror=reject;document.head.append(script)});
  }
  gate.hidden=true;element('overview').hidden=false;element('logout').hidden=false;
 }catch(err){if(err.status!==401)statusLine.textContent=err.message||'Unable to load Saldo.'}
}
const channel=new BroadcastChannel('saldo-sign-in');channel.onmessage=()=>location.reload();
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
async function authenticate(action,key){
 const buttons=gate.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
 try{await accountRequest({action,key});channel.postMessage('changed');location.reload()}
 catch(e){statusLine.textContent=e.message;buttons.forEach(b=>b.disabled=false)}
}
element('loginForm').onsubmit=e=>{e.preventDefault();authenticate('login',element('accountKey').value.trim())};
element('register').onclick=()=>{
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 element('newKey').value=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 element('loginForm').hidden=true;element('enroll').hidden=false;statusLine.textContent='';
};
element('copyKey').onclick=async()=>{try{await navigator.clipboard.writeText(element('newKey').value);statusLine.textContent='Key copied.'}catch{element('newKey').select();statusLine.textContent='Copy the selected key.'}};
element('cancelKey').onclick=()=>{element('newKey').value='';element('enroll').hidden=true;element('loginForm').hidden=false;statusLine.textContent=''};
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
