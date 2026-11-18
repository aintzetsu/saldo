import {passkeys} from '../lib/passkeys.js';
import { randomBytes, createHash } from 'node:crypto';
import { get, put, del, BlobPreconditionFailedError } from '@vercel/blob';

const privateBlob={access:'private',addRandomSuffix:false,contentType:'application/json'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const lifetime=7*24*60*60;
const cookie=(value,seconds)=>`__Host-saldo=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
async function fetchDoc(path){
 const r=await get(path,{access:'private',useCache:false});
 if(!r)return null;
 return {data:await new Response(r.stream).json(),version:r.blob.etag};
}
async function signIn(res,owner){
 const secret=token();
 await put('sessions/'+hash(secret),JSON.stringify({owner,until:Date.now()+lifetime*1000}),{...privateBlob,ttlDays:7});
 res.setHeader('Set-Cookie',cookie(secret,lifetime));
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 const fail=(status,error)=>res.status(status).json({error});
 try{
  if(!['GET','POST'].includes(req.method))return fail(405,'Unsupported method.');
  if(req.method==='POST'&&(req.headers.origin!=='https://'+req.headers.host||!req.headers['content-type']?.startsWith('application/json')))return fail(403,'Open Saldo to make changes.');
  const body=req.body||{},op=req.method==='GET'?'load':body.action;
  const keyFlow=owner=>passkeys({req,res,op,owner,fetchDoc,put,privateBlob,hash,token,signIn});
  if(op==='authenticateOptions'||op==='authenticateFinish')return await keyFlow(null);
  if(op==='create'||op==='login'){
   const key=body.key;
   if(!valid(key))return fail(400,'Enter a valid Saldo account key.');
   const owner=hash('saldo-account:'+key),path='ledgers/'+owner;
   if(op==='create'){
    await put(path,JSON.stringify({accounts:[],entries:[]}),privateBlob);
   }else if(!await fetchDoc(path))return fail(401,'Account key was not recognized.');
   await signIn(res,owner);return res.json({ok:true});
  }
  const secret=req.cookies?.['__Host-saldo'];
  if(!valid(secret))return fail(401,'Sign in to your account.');
  const path='sessions/'+hash(secret);
  if(op==='logout'){await del(path);res.setHeader('Set-Cookie',cookie('',0));return res.json({ok:true})}
  const session=await fetchDoc(path);
  if(!session||session.data.until<=Date.now())return fail(401,'Your session expired. Sign in again.');
  if(op==='registerOptions'||op==='registerFinish')return await keyFlow(session.data.owner);
  const ledger='ledgers/'+session.data.owner;
  if(op==='load'){const doc=await fetchDoc(ledger);return res.json({...doc,owner:session.data.owner})}
  if(op!=='save')return fail(400,'Unknown action.');
  if(body.owner!==session.data.owner)return fail(409,'The signed-in account changed. Reload Saldo.');
  if(typeof body.version!=='string'||!body.version||!Array.isArray(body.data?.accounts)||!Array.isArray(body.data?.entries))return fail(400,'Invalid ledger.');
  const json=JSON.stringify(body.data);
  if(Buffer.byteLength(json)>2000000)return fail(413,'Ledger exceeds the 2 MB account limit.');
  const saved=await put(ledger,json,{...privateBlob,allowOverwrite:true,ifMatch:body.version});
  return res.json({version:saved.etag});
 }catch(e){
  if(e instanceof BlobPreconditionFailedError)return fail(409,'Your ledger changed on another device. Reload before saving again.');
  return fail(503,'Account storage is unavailable. Try again shortly.');
 }
}
