'use strict';

/* The mark controls appearance for guests and signed-in users. */
(()=>{
 const root=document.documentElement;
 const system=matchMedia('(prefers-color-scheme: dark)');
 const get=key=>{try{return localStorage.getItem(key)}catch{return null}};
 const set=(key,value)=>{try{localStorage.setItem(key,value)}catch{}};
 const stored=get('saldo-theme');
 let preference=stored==='dark'||stored==='light'?stored:'system';

 function applyTheme(){
  const dark=preference==='dark'||(preference==='system'&&system.matches);
  root.dataset.theme=dark?'dark':'light';
  const toggle=document.getElementById('themeToggle');
  if(toggle){
   toggle.setAttribute('aria-pressed',String(dark));
   toggle.title=dark?'Switch to light mode':'Switch to dark mode';
  }
  const select=document.getElementById('themePreference');
  if(select)select.value=preference;
 }
 function selectTheme(value){
  preference=value;
  set('saldo-theme',value);
  applyTheme();
 }
 applyTheme();
 root.dataset.privacy=get('saldo-privacy')==='on'?'on':'off';
 system.addEventListener('change',applyTheme);
 document.addEventListener('DOMContentLoaded',()=>{
  applyTheme();
  document.getElementById('themeToggle').onclick=()=>selectTheme(root.dataset.theme==='dark'?'light':'dark');
  document.getElementById('themePreference').onchange=event=>selectTheme(event.target.value);
  const privacy=document.getElementById('privacyToggle');
  const syncPrivacy=()=>{
   const masked=root.dataset.privacy==='on';
   privacy.setAttribute('aria-pressed',String(masked));
   privacy.textContent=masked?'Show amounts':'Hide amounts';
  };
  syncPrivacy();
  privacy.onclick=()=>{
   root.dataset.privacy=root.dataset.privacy==='on'?'off':'on';
   set('saldo-privacy',root.dataset.privacy);
   syncPrivacy();
   if(typeof render==='function')render();
  };
  document.addEventListener('keydown',event=>{
   if(!event.altKey||!event.shiftKey||event.ctrlKey||event.metaKey||event.code!=='KeyE'||event.repeat)return;
   if(event.target.closest?.('input,select,textarea,[contenteditable]')||document.querySelector('dialog[open]')||document.getElementById('overview').hidden)return;
   const button=document.getElementById('quick');
   if(button.hidden||button.disabled)return;
   event.preventDefault();
   button.click();
  });
 });
})();
